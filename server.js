import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, extname } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { Games, GameError } from './game.js';
import { createServerlessApi } from './lib/serverless-api.js';

const root = resolve(fileURLToPath(new URL('./public/', import.meta.url)));
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

export async function createApp({ store } = {}) {
  const catalog = JSON.parse(await readFile(resolve(root, 'data/characters.json'), 'utf8'));
  const games = new Games(catalog.characters);
  const redisApi = store || process.env.ROOM_STORAGE === 'redis' ? createServerlessApi(catalog, { store }) : null;
  const cacheStatic = process.env.NODE_ENV === 'production';
  const files = new Map();
  const rates = new Map();
  function rate(key, max, period) {
    let record = rates.get(key);
    if (!record || Date.now() > record.until) { record = { n: 0, until: Date.now() + period }; rates.set(key, record); }
    if (++record.n > max) throw new GameError('Too many requests. Please wait a moment.', 429);
  }
  function json(res, status, data) {
    const buffer = Buffer.from(JSON.stringify(data));
    const zipped = buffer.length > 1024 && res.wantsGzip;
    res.writeHead(status, { 'Content-Type': mime['.json'], 'Cache-Control': 'no-store', 'Vary': 'Accept-Encoding', ...(zipped ? { 'Content-Encoding': 'gzip' } : {}) });
    res.end(zipped ? gzipSync(buffer) : buffer);
  }
  async function body(req) {
    if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new GameError('Send JSON.', 415);
    let text = '';
    for await (const chunk of req) {
      text += chunk;
      if (Buffer.byteLength(text) > 4096) throw new GameError('Request too large.', 413);
    }
    try { return JSON.parse(text); } catch { throw new GameError('Invalid JSON.'); }
  }
  const server = http.createServer(async (req, res) => {
    res.wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Content-Security-Policy', "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost');
      if (redisApi && url.pathname.startsWith('/api/')) return redisApi(req, res);
      if (req.method === 'POST') {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new GameError('Cross-site requests are not allowed.', 403);
        rate(req.socket.remoteAddress, 240, 60_000);
      }
      if (url.pathname === '/api/health' && req.method === 'GET') return json(res, 200, { ok: true, characters: catalog.characters.length });
      if (url.pathname === '/api/catalog' && req.method === 'GET') return json(res, 200, { ...catalog, classic: games.classic });
      if (url.pathname === '/api/rooms' && req.method === 'POST') {
        rate('create:' + req.socket.remoteAddress, 20, 15 * 60_000);
        const { room, player } = games.create(await body(req));
        return json(res, 201, { token: player.token, state: games.view(room, player) });
      }
      const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|events|actions))?$/.exec(url.pathname);
      if (match) {
        const [, code, operation] = match;
        const room = games.get(code);
        if (operation === 'join' && req.method === 'POST') {
          const { player } = games.join(code, await body(req));
          return json(res, 201, { token: player.token, state: games.view(room, player) });
        }
        const token = operation === 'events' ? url.searchParams.get('token') : req.headers.authorization?.replace(/^Bearer /, '');
        const player = games.authenticate(room, token);
        if (operation === 'events' && req.method === 'GET') {
          if (player.connections.size >= 3) throw new GameError('Too many open tabs. Close another game tab.', 429);
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
          res.write('retry: 1500\n\n');
          player.connections.add(res);
          games.broadcast(room);
          const keepAlive = setInterval(() => { room.updated = Date.now(); res.write(': heartbeat\n\n'); }, 20_000);
          req.on('close', () => { clearInterval(keepAlive); player.connections.delete(res); games.broadcast(room); });
          return;
        }
        if (operation === 'actions' && req.method === 'POST') return json(res, 200, games.action(room, player, await body(req)));
        if (!operation && req.method === 'GET') return json(res, 200, games.view(room, player));
        throw new GameError('Route not found.', 404);
      }
      if (!['GET', 'HEAD'].includes(req.method)) throw new GameError('Route not found.', 404);
      let pathname;
      try { pathname = decodeURIComponent(url.pathname); } catch { throw new GameError('Bad path.'); }
      const path = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
      if (!path.startsWith(root + '/') || !mime[extname(path)]) throw new GameError('File not found.', 404);
      let file = cacheStatic ? files.get(path) : undefined;
      if (!file) {
        let buffer;
        try { buffer = await readFile(path); } catch { throw new GameError('File not found.', 404); }
        file = { buffer, etag: '"' + createHash('sha256').update(buffer).digest('hex').slice(0, 20) + '"' };
        if (['.js', '.css', '.html', '.json', '.svg'].includes(extname(path))) file.gzip = gzipSync(buffer);
        if (cacheStatic) files.set(path, file);
      }
      res.setHeader('ETag', file.etag);
      res.setHeader('Vary', 'Accept-Encoding');
      res.setHeader('Cache-Control', pathname.startsWith('/portraits/') ? 'public, max-age=31536000, immutable' : 'no-cache');
      if (req.headers['if-none-match'] === file.etag) { res.writeHead(304); return res.end(); }
      const zipped = res.wantsGzip && file.gzip;
      res.setHeader('Content-Type', mime[extname(path)]);
      if (zipped) res.setHeader('Content-Encoding', 'gzip');
      const buffer = zipped ? file.gzip : file.buffer;
      res.setHeader('Content-Length', buffer.length);
      res.writeHead(200); res.end(req.method === 'HEAD' ? undefined : buffer);
    } catch (error) {
      if (!(error instanceof GameError)) console.error(error.message);
      if (!res.headersSent) json(res, error.status || 500, { error: error instanceof GameError ? error.message : 'Something went wrong. Please try again.' });
      else res.end();
    }
  });
  const cleanup = setInterval(() => { games.expire(); for (const [key, record] of rates) if (Date.now() > record.until) rates.delete(key); }, 60_000);
  cleanup.unref();
  server.on('close', () => clearInterval(cleanup));
  return { server, games };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT || 3000);
  server.listen(port, process.env.HOST || '0.0.0.0', () => console.log(`South Park Guess Who listening on port ${port}`));
}
