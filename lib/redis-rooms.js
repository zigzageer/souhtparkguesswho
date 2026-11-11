import { createHash } from 'node:crypto';
import { GameError, Games } from '../game.js';

const TTL = 7200;
const COMPARE_AND_SET = `if redis.call('GET',KEYS[1]) == ARGV[1] then redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3]); return 1 end; return 0`;
const RATE_LIMIT = `local n=redis.call('INCR',KEYS[1]); if n == 1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end; return n`;
const encode = room => JSON.stringify({ ...room, players: room.players.map(({ connections, present, ...p }) => ({ ...p, eliminated: [...p.eliminated] })) });
const decode = raw => { const room = JSON.parse(raw); for (const p of room.players) { p.eliminated = new Set(p.eliminated); p.connections = new Set(); } return room; };

export class RedisRooms {
  constructor(characters, { url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL, token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN, allowLoopback = false, prefix = 'spgw:' + (process.env.VERCEL_ENV || 'local') } = {}) {
    if (!url || !token) throw new GameError('Multiplayer storage is not configured.', 503);
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && !(allowLoopback && ['127.0.0.1', 'localhost'].includes(parsed.hostname))) throw new GameError('Storage requires HTTPS.', 503);
    if (parsed.username || parsed.password || parsed.search) throw new GameError('Invalid storage URL.', 503);
    this.url = url.replace(/\/$/, ''); this.token = token; this.characters = characters; this.prefix = prefix;
  }
  async call(commands) {
    try {
      const response = await fetch(this.url + '/pipeline', { method: 'POST', redirect: 'error', headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(commands), signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Storage request failed.');
      const results = await response.json();
      if (!Array.isArray(results) || results.length !== commands.length || results.some(r => r.error)) throw new Error('Storage command failed.');
      return results.map(r => r.result);
    } catch { throw new GameError('The room service is temporarily unavailable. Please try again.', 503); }
  }
  async command(...command) { return (await this.call([command]))[0]; }
  key(code) { return `${this.prefix}:room:${code}`; }
  async rate(identity, limit, seconds) {
    const key = this.prefix + ':rate:' + createHash('sha256').update(identity).digest('hex');
    if (await this.command('EVAL', RATE_LIMIT, 1, key, seconds) > limit) throw new GameError('Too many requests. Please wait a moment.', 429);
  }
  async create(body) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const games = new Games(this.characters);
      const { room, player } = games.create(body);
      if (await this.command('SET', this.key(room.code), encode(room), 'EX', TTL, 'NX')) return { token: player.token, state: games.view(room, player) };
    }
    throw new GameError('Could not allocate a room. Please try again.', 503);
  }
  async load(code) {
    const raw = await this.command('GET', this.key(code));
    if (!raw) throw new GameError('Room not found or expired. Check the code.', 404);
    const room = decode(raw), games = new Games(this.characters);
    games.rooms.set(code, room);
    return { raw, room, games };
  }
  async mutate(code, change) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const { raw, room, games } = await this.load(code);
      const result = change(games, room);
      if (await this.command('EVAL', COMPARE_AND_SET, 1, this.key(code), raw, encode(room), TTL)) return result;
      await new Promise(resolve => setTimeout(resolve, 10 + Math.random() * 30));
    }
    throw new GameError('The room is busy. Please try that action again.', 409);
  }
  async join(code, body) {
    return this.mutate(code, (games, room) => { const { player } = games.join(code, body); return { token: player.token, state: games.view(room, player) }; });
  }
  async action(code, token, body) {
    return this.mutate(code, (games, room) => games.action(room, games.authenticate(room, token), body));
  }
  async view(code, token) {
    const { games, room } = await this.load(code);
    const player = games.authenticate(room, token);
    const opponent = room.players.find(p => p !== player);
    const presenceKey = id => `${this.prefix}:presence:${code}:${id}`;
    const commands = [['SET', presenceKey(player.id), '1', 'EX', 20], ['EXPIRE', this.key(code), TTL]];
    if (opponent) commands.push(['EXISTS', presenceKey(opponent.id)]);
    const results = await this.call(commands);
    if (opponent) opponent.present = results[2] === 1;
    return games.view(room, player);
  }
}
