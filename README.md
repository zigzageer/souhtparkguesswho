# South Park · Guess Who?

A lightweight online 1v1 game. Create a private room, share its six-character code or invite link, and play with a friend. Designed for touch screens down to the iPhone X's 375 × 812 CSS-pixel viewport.

## Run

Requires Node.js 24. Local play has **no runtime npm dependencies**, database, or API keys. The Vercel deployment uses the Redis integration described below.

```sh
cd /workspace/souhtparkguesswho
npm ci --cache /workspace/.npm --ignore-scripts
npm start
```

The local server binds to all interfaces on port 3000. Set `PORT` and optionally `HOST` for your host. `npm run dev` watches server modules; frontend files are read fresh during development. For a persistent Node host use `NODE_ENV=production node server.js` to also cache static files in memory. Both players must reach the same host.

Use the existing checkout in cloud tasks. Each task is already isolated; do not create a Git worktree unless explicitly requested.

## Deploy on Vercel

The Vercel configuration serves `public/` as static assets and routes `/api/*` to a stateless Node function. Rooms use Redis with atomic compare-and-set updates, so concurrent requests on different instances cannot overwrite each other or admit a third player. Clients poll every two seconds with private ETags; unchanged snapshots return 304, and polling pauses while the tab is hidden. The same client automatically uses SSE with the local server.

1. Import this GitHub repository into Vercel. Framework preset: Other. Build: `npm run build`. Output: `public`. The repository pins Node.js 24 and includes `vercel.json`.
2. In the Vercel project's Storage tab, connect Upstash Redis to Production and Preview with its environment variables enabled.
3. The function reads `KV_REST_API_URL` and `KV_REST_API_TOKEN`. It also supports `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. These are server-side secrets; never place them in `public/`, source control, or client-side variables. A read-only token is insufficient for room creation and gameplay.
4. Deploy. `/api/health` must return `ok: true` and `storage: redis`. Verify two independent browsers can create/join the same room and play.

Production and Preview use separate Redis key prefixes. Rooms expire after two hours without an authenticated poll or action; presence expires after 20 seconds without polling. Rooms survive function restarts and scaling. Local single-process play continues to work without Redis. For a local Redis-backed development server, provide the above variables securely and set `ROOM_STORAGE=redis`.

## How to play

1. Enter your name, choose a lineup, and create a room. Your friend enters their name and joins using the code or invite link.
2. Each player receives a secret identity. Change it by choosing a board card before marking yourself ready. Both players must be ready to start.
3. Ask yes-or-no questions in the room, or talk on a call. Your friend answers Yes, No, or Not sure. There is no turn timer.
4. Tap cards to cross them out; tap again to restore. Undo, reset, search, and remaining-only filtering help narrow the field. Eliminations are private and survive a page reload in the same browser tab.
5. Make a final guess at any time, including with a question pending. A correct guess wins; a wrong guess loses immediately. Both players can request a rematch.

The familiar lineup has 24 characters. Deep cuts chooses 48 characters with portraits. The whole-town mode includes the complete imported index, displayed 48 cards at a time with search.

## Character import and coverage

The bundled import contains **2,658 character pages**, discovered by exhausting MediaWiki pagination through **165 character categories**, and **1,009 compressed local portraits**. Includes background characters, celebrities, animals, groups, and alternate identities. This exhausts the indexed categories at import time, but cannot guarantee every on-screen appearance or a separate entry for each individual in a group article. The UI and [machine-readable report](public/data/import-report.json) expose the actual coverage and missing portraits.

The wiki's image host refused automated image downloads from this environment. Available portraits were matched by normalized filenames against the public [ChaconMoon/API-South-Park archive](https://github.com/ChaconMoon/API-South-Park/tree/9d2475db39f8f417f24d582e4c6da50f42853a90/img). Other entries keep name/initial placeholders rather than invented images. All 24 classic characters have portraits.

To refresh from a local PC or cloud machine with access to the public wiki:

```sh
python3 -m venv .cache/import-venv
.cache/import-venv/bin/python -m pip install -r scripts/requirements.txt
.cache/import-venv/bin/python scripts/scrape.py
```

The importer uses `https://southpark.wiki/api.php` and image URLs returned by that API (currently `southpark.wiki.gg`). It follows continuation tokens and recursively visits categories with cycle detection; saves a complete report; stages catalog output until metadata requests succeed; caches interrupted metadata requests for one day; and stops image requests to hosts that refuse access. It does not bypass access controls. Clear `.cache/scrape` for an immediate uncached refresh. Restart the server after refreshing data.

For archive-assisted importing, clone the source outside this checkout, check out the pinned revision above, and pass `--portrait-dir /path/to/API-South-Park/img`. On Windows use the virtual environment's `Scripts/python.exe` instead of `bin/python`. Runtime play uses only bundled local assets and needs no wiki access.

## Validation

```sh
npm test                         # game rules + HTTP/SSE integration
bash scripts/browser-deps.sh      # cloud Debian 13: user-local WebKit dependencies
bash scripts/redis-test-deps.sh    # user-local Redis binaries for integration tests
npm test                         # also tests the serverless adapter against real local Redis
npm run build                    # verify catalog, unique IDs, lineup and portrait files
npm run test:browser              # Chromium + WebKit, local SSE + Redis polling modes
```

The cloud image supplies Chromium at `/usr/bin/chromium`; override `CHROMIUM_PATH` if needed. Browser support files and Redis test binaries live under `/workspace/.cache`. The Debian setup uses signed official package indexes and extracts packages in user-owned directories, without modifying system packages. On other machines install `redis-server` and `redis-cli` with your system package manager, or set `REDIS_SERVER_BIN` and `REDIS_CLI_BIN`. Tests launch an isolated local Redis instance and HTTP bridge; no production credentials are needed. Browser tests cover two-player create/join, secret privacy, private elimination, questions and answers, reload recovery, an anytime guess, rematch, mobile overflow, real portrait loading, and full-catalog search/pagination. WebKit emulation is useful Safari-engine coverage, not a physical iPhone hardware test.

## Hosting and limits

- Standalone local mode uses one Node process per game instance. Its rooms live in memory; a server restart clears them. Disconnected rooms expire after two hours of inactivity. Vercel mode persists room state in Redis. No account is required.
- Standalone local events use Server-Sent Events; a reverse proxy must allow long-lived SSE responses without buffering and a timeout above the 20-second heartbeat. Vercel uses bounded authenticated HTTP requests and polling instead, with shared state across instances.
- Secrets, answers, guesses, capacity, and readiness are validated server-side. A player receives only their own secret and eliminations until the round ends. Final identities are revealed after a win/loss.
- Portraits are small WebP files, loaded lazily, with immutable cache headers. HTML/CSS/JavaScript/catalog responses support gzip. The client has no framework, third-party scripts, external fonts, or trackers. JavaScript and cookies are not used for advertising; sessionStorage keeps your per-tab reconnect token.

## Credits

Unofficial fan project; unaffiliated with South Park Studios, Paramount, or the original Guess Who game. South Park characters and artwork belong to their respective owners. Character metadata comes from [South Park Archives contributors](https://southpark.wiki/wiki/Category:Characters), distributed under the wiki's CC BY-SA terms; page URLs accompany each entry. Portrait archive provenance and the upstream GPL-3.0 license are retained in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
