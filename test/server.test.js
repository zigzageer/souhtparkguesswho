import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../server.js';

test('HTTP workflow: create/join, private live updates, reject unauthorized actions, static serving', async (t) => {
  const { server } = await createApp();
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = async (path, data, token) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(data) });
    return { status: r.status, data: await r.json() };
  };
  const health = await (await fetch(base + '/api/health')).json(); assert.ok(health.characters > 2000);
  const first = await post('/api/rooms', { name: 'First', mode: 'classic' }); assert.equal(first.status, 201);
  const { token, state } = first.data; const path = '/api/rooms/' + state.code;
  assert.equal((await post(path + '/actions', { type: 'ready' }, 'fake')).status, 401);
  const second = await post(path + '/join', { name: 'Second' }); assert.equal(second.status, 201);
  assert.equal((await post(path + '/join', { name: 'Third' })).status, 409);
  const abort = new AbortController();
  const events = await fetch(base + path + `/events?token=${token}`, { signal: abort.signal });
  assert.match(events.headers.get('content-type'), /text\/event-stream/);
  const reader = events.body.getReader(); const decoder = new TextDecoder(); let text = '';
  while (!text.includes('data:')) { const { value } = await reader.read(); text += decoder.decode(value); }
  const live = JSON.parse(text.split('data: ')[1].split('\n\n')[0]);
  assert.equal(live.opponent.name, 'Second'); assert.ok(!('secret' in live.opponent));
  abort.abort();
  await post(path + '/actions', { type: 'ready' }, token);
  const active = await post(path + '/actions', { type: 'ready' }, second.data.token);
  assert.equal(active.data.status, 'playing');
  const win = await post(path + '/actions', { type: 'guess', id: second.data.state.you.secret }, token);
  assert.equal(win.data.result.correct, true);
  const cross = await fetch(base + '/api/rooms', { method: 'POST', headers: { Origin: 'https://elsewhere.example', 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(cross.status, 403);
  const html = await fetch(base + '/'); assert.equal(html.status, 200); assert.match(await html.text(), /Guess Who/);
  const catalog = await fetch(base + '/api/catalog'); const c = await catalog.json(); assert.equal(c.characters.length, c.meta.count);
  const img = c.characters.find(c => c.image); const portrait = await fetch(base + img.image); assert.equal(portrait.status, 200); assert.equal(portrait.headers.get('content-type'), 'image/webp');
  const cached = await fetch(base + img.image, { headers: { 'If-None-Match': portrait.headers.get('etag') } }); assert.equal(cached.status, 304);
  assert.equal((await fetch(base + '/missing.png')).status, 404);
});
