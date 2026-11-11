#!/usr/bin/env python3
"""Import EVERY page in the wiki's character category, following continuation.

Works on a local PC too: python3 -m pip install Pillow; python3 scripts/scrape.py
Uses public MediaWiki endpoints; does not bypass access controls. Stages output
until all category/metadata requests succeed. Downloads are cached across reruns.
"""
import argparse
import concurrent.futures
import hashlib
import html
import io
import json
import re
import time
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
AGENT = 'SouthParkGuessWho/1.0 (fan character index; public MediaWiki API)'


def get(url, attempts=3):
    for attempt in range(attempts):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': AGENT}), timeout=45) as r:
                return r.read()
        except Exception:
            if attempt == attempts - 1:
                raise
            time.sleep(1 + attempt * 2)


def api(base, **params):
    url = base + '/api.php?' + urllib.parse.urlencode({'format': 'json', 'formatversion': 2, **params})
    cache = ROOT / '.cache' / 'scrape'
    cache.mkdir(parents=True, exist_ok=True)
    path = cache / (hashlib.sha256(url.encode()).hexdigest() + '.json')
    # Only use cached responses from an interrupted import for up to one day.
    raw = path.read_bytes() if path.exists() and time.time() - path.stat().st_mtime < 86400 else get(url)
    result = json.loads(raw)
    if 'error' in result:
        raise RuntimeError(result['error'])
    path.write_bytes(raw)
    return result


def clean(value):
    value = re.sub(r'<ref\b[^>]*>.*?</ref>|<ref\b[^>]*/>', '', value, flags=re.S)
    value = re.sub(r'\[\[(?:[^\]|]*\|)?([^\]]+)\]\]', r'\1', value)
    value = re.sub(r'\{\{.*?\}\}|<[^>]+>|\[https?[^\]]*\]', '', value, flags=re.S)
    return html.unescape(value.replace("'''", '').replace("''", '')).strip()[:160]


def parse_page(page, base):
    text = page.get('revisions', [{}])[0].get('slots', {}).get('main', {}).get('content', '')
    fields = dict((k.lower(), v.strip()) for k, v in re.findall(r'^\|\s*(\w+)\s*=\s*(.*?)(?=^\||^\}\})', text, re.M | re.S))
    image = fields.get('image', '')
    if '<gallery' in image:
        image = re.sub(r'^.*?<gallery[^>]*>\s*', '', image, flags=re.S).splitlines()[0].split('|')[0]
    else:
        match = re.search(r'(?:File:|Image:)?([^\[\]<>\n|{}]+?\.(?:png|webp|jpe?g|gif|svg))', image, re.I)
        if not match:
            match = re.search(r'\[\[(?:File|Image):([^|\]]+)', text, re.I)
        image = match.group(1) if match else ''
    image = re.sub(r'^(?:File|Image):', '', image, flags=re.I).strip()
    title = page['title']
    return {
        'id': str(page['pageid']), 'name': title,
        'gender': clean(fields.get('gender', '')), 'hair': clean(fields.get('hair', '')),
        'age': clean(fields.get('age', '')), 'occupation': clean(fields.get('job', '')),
        'source': base + '/wiki/' + urllib.parse.quote(title.replace(' ', '_')),
        'image': None, '_file': 'File:' + image if image else None,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', default='https://southpark.wiki')
    parser.add_argument('--workers', type=int, default=6)
    parser.add_argument('--no-images', action='store_true', help='Import metadata without downloading portraits')
    parser.add_argument('--portrait-dir', type=Path, help='Optional locally downloaded image archive; match exact normalized filenames')
    parser.add_argument('--root-only', action='store_true', help='Only import the root category, without its subcategories')
    args = parser.parse_args()
    base = args.source.rstrip('/')
    if not base.startswith('https://'):
        parser.error('Source must use HTTPS')
    output = ROOT / 'public' / 'data'
    images = ROOT / 'public' / 'portraits'
    output.mkdir(parents=True, exist_ok=True)
    images.mkdir(parents=True, exist_ok=True)
    members, continuation = {}, {}
    category_responses = 0
    while True:
        data = api(base, action='query', list='categorymembers', cmtitle='Category:Characters', cmnamespace=0, cmlimit=500, **continuation)
        category_responses += 1
        for page in data['query']['categorymembers']:
            if not page['title'].startswith(('Portal:', 'List of ', 'List_of_')):
                members[page['pageid']] = page
        continuation = data.get('continue', {})
        print(f'Indexed {len(members)} character pages', flush=True)
        if not continuation:
            break
    visited = {'Category:Characters'}
    if not args.root_only:
        data = api(base, action='query', list='categorymembers', cmtitle='Category:Characters', cmtype='subcat', cmlimit=500)
        queued = [c['title'] for c in data['query']['categorymembers']]
        while queued:
            category = queued.pop(0)
            if category in visited:
                continue
            visited.add(category)
            continuation = {}
            while True:
                data = api(base, action='query', list='categorymembers', cmtitle=category, cmnamespace='0|14', cmlimit=500, **continuation)
                category_responses += 1
                for p in data['query']['categorymembers']:
                    if p['ns'] == 14:
                        if p['title'] not in visited:
                            queued.append(p['title'])
                    elif not p['title'].startswith(('Portal:', 'List of ', 'List_of_')):
                        members[p['pageid']] = p
                continuation = data.get('continue', {})
                if not continuation:
                    break
            print(f'Indexed {len(members)} pages across {len(visited)} categories', flush=True)
    if len(members) < 100:
        raise RuntimeError('Unexpectedly small category; existing data left unchanged')
    pages = list(members.values())
    characters = []
    for offset in range(0, len(pages), 50):
        batch = pages[offset:offset + 50]
        data = api(base, action='query', prop='revisions', pageids='|'.join(str(p['pageid']) for p in batch), rvprop='content', rvslots='main')
        returned = data['query']['pages']
        if any('missing' in p or 'revisions' not in p for p in returned) or len(returned) != len(batch):
            raise RuntimeError('Missing revision metadata; existing data left unchanged')
        characters.extend(parse_page(p, base) for p in returned)
        print(f'Read {len(characters)}/{len(pages)} profiles', flush=True)
    files = sorted(set(c['_file'] for c in characters if c['_file']))
    thumbnails = {}
    for offset in range(0, len(files), 50):
        data = api(base, action='query', prop='imageinfo', titles='|'.join(files[offset:offset + 50]), iiprop='url', iiurlwidth=200, iiurlheight=220)
        normalized = {p['from']: p['to'] for p in data.get('query', {}).get('normalized', [])}
        results = {p['title']: p.get('imageinfo', [{}])[0] for p in data['query']['pages']}
        for title in files[offset:offset + 50]:
            info = results.get(normalized.get(title, title), {})
            url = info.get('thumburl') or info.get('url')
            if url:
                thumbnails[title] = url
        print(f'Resolved {min(offset+50,len(files))}/{len(files)} image sources', flush=True)
    failures = []
    if not args.no_images:
        from PIL import Image
        archive = {}
        def normalize(s):
            s = re.sub(r'\.(png|webp|jpe?g|gif)$', '', s, flags=re.I)
            s = re.sub(r'[. _-]transparent$', '', s, flags=re.I)
            s = re.sub(r'\s*\(Character\)$', '', s, flags=re.I)
            return re.sub(r'[^a-z0-9]', '', s.casefold())
        if args.portrait_dir:
            for path in args.portrait_dir.rglob('*'):
                if path.suffix.lower() in ('.png', '.webp', '.jpg', '.jpeg', '.gif'):
                    archive.setdefault(normalize(path.name), path)
            if 'chef' in archive:
                archive['jeromechef'] = archive['chef']
        blocked_hosts = set()

        def download(c):
            url = thumbnails.get(c['_file'])
            file_key = (c['_file'] or '').removeprefix('File:')
            local = archive.get(normalize(file_key)) or archive.get(normalize(c['name']))
            if not url and not local:
                return
            if not local and urllib.parse.urlparse(url).netloc in blocked_hosts:
                return
            path = images / (hashlib.sha256((str(local) if local else url).encode()).hexdigest()[:20] + '.webp')
            try:
                if not path.exists():
                    data = local.read_bytes() if local else get(url, attempts=1)
                    with Image.open(io.BytesIO(data)) as image:
                        image = image.convert('RGBA')
                        image.thumbnail((200, 220))
                        temp = path.with_suffix('.tmp')
                        image.save(temp, format='WEBP', quality=78, method=4)
                        temp.replace(path)
                c['image'] = '/portraits/' + path.name
            except Exception as e:
                if getattr(e, 'code', 0) in (401, 402, 403):
                    blocked_hosts.add(urllib.parse.urlparse(url).netloc)
                failures.append({'id': c['id'], 'name': c['name'], 'error': str(e)[:150]})

        with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, min(args.workers, 8))) as pool:
            for n, _ in enumerate(pool.map(download, characters), 1):
                if n % 100 == 0:
                    print(f'Processed {n}/{len(characters)} portraits', flush=True)
    for c in characters:
        del c['_file']
    characters.sort(key=lambda c: c['name'].casefold())
    metadata = {
        'source': base, 'category': 'Category:Characters', 'importedAt': datetime.now(timezone.utc).isoformat(),
        'count': len(characters), 'portraits': sum(bool(c['image']) for c in characters),
        'paginationComplete': True, 'categoryResponses': category_responses,
        'categoriesVisited': sorted(visited), 'recursive': not args.root_only,
        'coverage': 'All main-namespace pages in Category:Characters' + (' and its recursively visited subcategories' if not args.root_only else '') + ' at import time, excluding portal and list pages. Includes groups and variants. This is a wiki index, not a guarantee of every on-screen appearance.',
        'missingPortraits': [c['id'] for c in characters if not c['image']],
        'downloadFailures': failures,
        'blockedImageHosts': sorted(blocked_hosts) if not args.no_images else [],
        'portraitArchive': 'ChaconMoon/API-South-Park (see README for pinned revision)' if args.portrait_dir else None,
        'attribution': 'Character data: South Park Archives contributors (CC BY-SA). Characters and artwork belong to their respective owners. Unofficial fan project.',
    }
    payload = json.dumps({'meta': metadata, 'characters': characters}, ensure_ascii=False, separators=(',', ':'))
    staged = output / 'characters.json.tmp'
    staged.write_text(payload)
    staged.replace(output / 'characters.json')
    (output / 'import-report.json').write_text(json.dumps(metadata, indent=2))
    print(f'Saved {metadata["count"]} characters, {metadata["portraits"]} portraits, {len(failures)} download failures.', flush=True)


if __name__ == '__main__':
    main()
