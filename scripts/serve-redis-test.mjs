import { redisFixture } from '../test/redis-fixture.js';
import { RedisRooms } from '../lib/redis-rooms.js';
import { createApp } from '../server.js';
import { readFile } from 'node:fs/promises';
const catalog = JSON.parse(await readFile(new URL('../public/data/characters.json', import.meta.url)));
const fixture = await redisFixture();
const { server } = await createApp({ store: new RedisRooms(catalog.characters, fixture) });
server.listen(3001, '127.0.0.1');
async function stop() { server.closeAllConnections(); server.close(); await fixture.close(); process.exit(); }
process.on('SIGTERM', stop); process.on('SIGINT', stop);
