import { createHash } from 'node:crypto';
import { GameError, Games } from '../game.js';
import { RedisRooms } from './redis-rooms.js';

async function body(req) {
  if (!(req.headers['content-type'] || '').startsWith('application/json')) throw new GameError('Send JSON.', 415);
  let value;
  if (req.body !== undefined) value = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else { value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 4096) throw new GameError('Request too large.', 413); } }
  if (Buffer.byteLength(value) > 4096) throw new GameError('Request too large.', 413);
  try { const result = JSON.parse(value); if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error(); return result; }
  catch { throw new GameError('Invalid JSON.'); }
}

export function createServerlessApi(catalog, { store } = {}) {
  const classic = new Games(catalog.characters).classic;
  return async function handler(req, res) {
    function json(status, data) { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(data)); }
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff'); res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      const url = new URL(req.url, 'https://localhost');
      const route = url.searchParams.get('route');
      const path = route ? '/api/' + route.replace(/^\/+/, '') : url.pathname;
      if (path === '/api/catalog' && req.method === 'GET') { res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=3600'); return json(200, { ...catalog, classic, transport: 'poll', pollInterval: 2000 }); }
      const rooms = store || new RedisRooms(catalog.characters);
      if (path === '/api/health' && req.method === 'GET') { await rooms.command('PING'); return json(200, { ok: true, storage: 'redis', characters: catalog.characters.length }); }
      if (req.method === 'POST') {
        const origin = req.headers.origin;
        if (origin && new URL(origin).host !== req.headers.host) throw new GameError('Cross-site requests are not allowed.', 403);
        await rooms.rate('actions:' + (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'), 240, 60);
      }
      if (path === '/api/rooms' && req.method === 'POST') {
        await rooms.rate('create:' + (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'), 20, 900);
        return json(201, await rooms.create(await body(req)));
      }
      const match = /^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|actions))?$/.exec(path);
      if (!match) throw new GameError('Route not found.', 404);
      const [, code, operation] = match;
      if (operation === 'join' && req.method === 'POST') return json(201, await rooms.join(code, await body(req)));
      const token = req.headers.authorization?.replace(/^Bearer /, '');
      if (operation === 'actions' && req.method === 'POST') return json(200, await rooms.action(code, token, await body(req)));
      if (!operation && req.method === 'GET') {
        const state = await rooms.view(code, token);
        const etag = '"' + createHash('sha256').update(JSON.stringify(state)).digest('hex') + '"';
        res.setHeader('ETag', etag);
        if (req.headers['if-none-match'] === etag) { res.statusCode = 304; return res.end(); }
        return json(200, state);
      }
      throw new GameError('Route not found.', 404);
    } catch (error) {
      // Never log Redis URLs, tokens, room contents, or upstream response bodies.
      if (!(error instanceof GameError)) console.error('SERVERLESS_REQUEST_FAILED');
      return json(error.status || 500, { error: error instanceof GameError ? error.message : 'Something went wrong. Please try again.' });
    }
  };
}
