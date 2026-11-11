import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Games } from '../game.js';

const names = ['Eric Cartman', 'Stan Marsh', 'Kyle Broflovski', 'Kenny McCormick', 'Butters Stotch', 'Wendy Testaburger', 'Randy Marsh', 'Tweek Tweak', 'Craig Tucker', 'Clyde Donovan', 'Tolkien Black', 'Jimmy Valmer', 'Timmy Burch', 'Ike Broflovski', 'Bebe Stevens', 'Heidi Turner', 'Sharon Marsh', 'Sheila Broflovski', 'Gerald Broflovski', 'Liane Cartman', 'Mr. Mackey', 'Herbert Garrison', 'Jerome "Chef" McElroy', 'Towelie (Character)', 'ManBearPig (Character)'];
const characters = names.map((name, index) => ({ id: String(index), name, image: '/portrait.webp' }));
function pair(mode = 'classic') {
  const games = new Games(characters);
  const { room, player: first } = games.create({ name: 'Same name', mode });
  const { player: second } = games.join(room.code, { name: 'Same name' });
  return { games, room, first, second };
}
function readyAll(games, room, first, second) {
  games.action(room, first, { type: 'ready' }); games.action(room, second, { type: 'ready' });
}
test('private room codes, two-player capacity, authentication and hidden identities', () => {
  const { games, room, first, second } = pair();
  assert.match(room.code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(room.deck.length, 25);
  assert.throws(() => games.join(room.code, { name: 'Third' }), /two players/);
  assert.throws(() => games.authenticate(room, 'wrong'), /session/);
  const view = games.view(room, first);
  assert.equal(view.you.secret, first.secret);
  assert.equal(view.opponent.id, second.id);
  assert.ok(!('secret' in view.opponent)); assert.ok(!('token' in view.you)); assert.ok(!('token' in view.opponent));
  assert.equal(view.result, null);
});
test('both players must ready; identities lock and guesses are server-authoritative', () => {
  const { games, room, first, second } = pair();
  assert.throws(() => games.action(room, first, { type: 'guess', id: second.secret }), /ready/);
  games.action(room, first, { type: 'identity', id: '1' });
  games.action(room, first, { type: 'ready' });
  assert.equal(room.status, 'lobby');
  assert.throws(() => games.action(room, first, { type: 'identity', id: '2' }), /Unready/);
  games.action(room, second, { type: 'ready' }); assert.equal(room.status, 'playing');
  assert.throws(() => games.action(room, first, { type: 'identity', id: '2' }), /Unready/);
  assert.throws(() => games.action(room, first, { type: 'guess', id: 'fake' }), /board/);
});
test('eliminations are private, reversible and retained in a reconnect snapshot', () => {
  const { games, room, first, second } = pair(); readyAll(games, room, first, second);
  games.action(room, first, { type: 'eliminate', id: '1', excluded: true });
  assert.deepEqual(games.view(room, first).you.eliminated, ['1']);
  assert.deepEqual(games.view(room, second).you.eliminated, []);
  assert.ok(!('eliminated' in games.view(room, second).opponent));
  assert.equal(games.authenticate(room, first.token), first);
  games.action(room, first, { type: 'eliminate', id: '1', excluded: false });
  assert.deepEqual(games.view(room, first).you.eliminated, []);
});
test('ask/answer validation and a guess at any time, even with an unanswered question', () => {
  const { games, room, first, second } = pair(); readyAll(games, room, first, second);
  games.action(room, first, { type: 'ask', text: 'Do they wear a hat?' });
  const id = room.questions[0].id;
  assert.throws(() => games.action(room, first, { type: 'answer', id, answer: 'Yes' }), /cannot be answered/);
  assert.throws(() => games.action(room, first, { type: 'ask', text: 'Another?' }), /last question/);
  assert.throws(() => games.action(room, second, { type: 'answer', id, answer: 'anything' }), /Choose Yes/);
  games.action(room, second, { type: 'answer', id, answer: 'Yes' });
  games.action(room, first, { type: 'ask', text: 'Are they a kid?' });
  games.action(room, first, { type: 'guess', id: second.secret });
  assert.equal(room.status, 'finished'); assert.equal(room.result.winner, first.id);
  assert.equal(games.view(room, first).result.identities.find(p => p.id === second.id).secret, second.secret);
  assert.throws(() => games.action(room, second, { type: 'guess', id: first.secret }), /ready/);
});
test('wrong guess loses; rematch requires both players and clears all round state', () => {
  const { games, room, first, second } = pair(); readyAll(games, room, first, second);
  const wrong = room.deck.find(id => id !== second.secret);
  games.action(room, first, { type: 'eliminate', id: '1', excluded: true });
  games.action(room, first, { type: 'guess', id: wrong });
  assert.equal(room.result.winner, second.id); assert.equal(room.result.correct, false);
  games.action(room, first, { type: 'rematch' }); assert.equal(room.status, 'finished');
  games.action(room, second, { type: 'rematch' });
  assert.equal(room.status, 'lobby'); assert.equal(room.round, 2); assert.equal(room.result, null);
  assert.deepEqual(room.questions, []); assert.equal(first.eliminated.size, 0); assert.equal(first.ready, false);
});
test('all-character mode includes every imported entry; random mode uses portraits', () => {
  const { games, room } = pair('all'); assert.equal(room.deck.length, characters.length);
  assert.deepEqual(new Set(room.deck), new Set(characters.map(c => c.id)));
  assert.equal(new Set(games.deck('random')).size, 25);
  assert.throws(() => games.create({ name: 'A', mode: '__proto__' }), /valid/);
});
test('invalid actions and expired room cleanup', () => {
  const { games, room, first } = pair();
  assert.throws(() => games.create({ name: ' ' }), /name/);
  assert.throws(() => games.action(room, first, { type: 'bad' }), /Unknown/);
  room.updated = Date.now() - 3 * 3600_000; games.expire();
  assert.throws(() => games.get(room.code), /expired/);
});
