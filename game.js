import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const CLASSIC = ['Eric Cartman', 'Stan Marsh', 'Kyle Broflovski', 'Kenny McCormick', 'Butters Stotch', 'Wendy Testaburger', 'Randy Marsh', 'Tweek Tweak', 'Craig Tucker', 'Clyde Donovan', 'Tolkien Black', 'Jimmy Valmer', 'Timmy Burch', 'Bebe Stevens', 'Heidi Turner', 'Mr. Mackey', 'Herbert Garrison', 'Jerome "Chef" McElroy', 'Sharon Marsh', 'Sheila Broflovski', 'Gerald Broflovski', 'Liane Cartman', 'Ike Broflovski', 'Towelie (Character)'];
export class GameError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const requireThat = (condition, message, status) => { if (!condition) throw new GameError(message, status); };
const shuffle = (items) => {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
const playerName = (name) => {
  requireThat(typeof name === 'string', 'Enter a player name.');
  const trimmed = name.trim();
  requireThat(trimmed.length >= 1 && trimmed.length <= 24, 'Use a name between 1 and 24 characters.');
  return trimmed;
};

export class Games {
  constructor(characters) {
    this.characters = characters;
    this.byId = new Map(characters.map(c => [c.id, c]));
    this.classic = CLASSIC.map(name => characters.find(c => c.name === name)).filter(Boolean).slice(0, 24).map(c => c.id);
    requireThat(this.classic.length >= 12, 'Character catalogue is incomplete.', 500);
    this.rooms = new Map();
  }
  deck(mode) {
    if (mode === 'classic') return shuffle(this.classic);
    if (mode === 'all') return this.characters.map(c => c.id);
    return shuffle(this.characters.filter(c => c.image).map(c => c.id)).slice(0, 48);
  }
  newPlayer(name, deck) {
    return { id: randomUUID(), token: randomBytes(32).toString('hex'), name: playerName(name), secret: deck[randomInt(deck.length)], ready: false, eliminated: new Set(), connections: new Set(), rematch: false };
  }
  create({ name, mode = 'classic' }) {
    requireThat(['classic', 'random', 'all'].includes(mode), 'Choose a valid character pool.');
    this.expire();
    requireThat(this.rooms.size < 1000, 'The server is full. Try again shortly.', 503);
    let code;
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    do { code = Array.from({ length: 6 }, () => alphabet[randomInt(alphabet.length)]).join(''); } while (this.rooms.has(code));
    const deck = this.deck(mode);
    const player = this.newPlayer(name, deck);
    const room = { code, mode, deck, players: [player], status: 'lobby', questions: [], result: null, round: 1, version: 0, updated: Date.now() };
    this.rooms.set(code, room);
    return { room, player };
  }
  get(code) {
    const room = this.rooms.get(String(code).toUpperCase());
    requireThat(room, 'Room not found or expired. Check the code.', 404);
    return room;
  }
  join(code, { name }) {
    const room = this.get(code);
    requireThat(room.players.length < 2, 'This room already has two players.', 409);
    const player = this.newPlayer(name, room.deck);
    room.players.push(player);
    room.version = (room.version || 0) + 1;
    room.updated = Date.now();
    this.broadcast(room);
    return { room, player };
  }
  authenticate(room, token) {
    const player = room.players.find(p => p.token === token);
    requireThat(player, 'Your session is missing or expired. Rejoin a new room.', 401);
    return player;
  }
  view(room, player) {
    const opponent = room.players.find(p => p !== player);
    return {
      code: room.code, mode: room.mode, status: room.status, round: room.round, version: room.version || 0, deck: room.deck,
      you: { id: player.id, name: player.name, secret: player.secret, ready: player.ready, eliminated: [...player.eliminated], rematch: player.rematch },
      opponent: opponent ? { id: opponent.id, name: opponent.name, ready: opponent.ready, online: opponent.connections.size > 0 || !!opponent.present, rematch: opponent.rematch } : null,
      questions: room.questions,
      result: room.result ? { ...room.result, identities: room.players.map(p => ({ id: p.id, name: p.name, secret: p.secret })) } : null,
    };
  }
  broadcast(room) {
    for (const player of room.players) {
      const data = `data: ${JSON.stringify(this.view(room, player))}\n\n`;
      for (const response of player.connections) if (!response.destroyed) response.write(data);
    }
  }
  action(room, player, action) {
    requireThat(action && typeof action.type === 'string', 'Missing action.');
    const opponent = room.players.find(p => p !== player);
    if (action.type === 'identity') {
      requireThat(room.status === 'lobby' && !player.ready, 'Unready before changing your character.');
      requireThat(room.deck.includes(action.id), 'Choose a character on this board.');
      player.secret = action.id;
    } else if (action.type === 'ready') {
      requireThat(room.status === 'lobby', 'The round has already started.');
      player.ready = !player.ready;
      if (room.players.length === 2 && room.players.every(p => p.ready)) room.status = 'playing';
    } else if (action.type === 'eliminate') {
      requireThat(room.status === 'playing', 'Start the round first.');
      requireThat(room.deck.includes(action.id) && typeof action.excluded === 'boolean', 'Invalid character.');
      if (action.excluded) player.eliminated.add(action.id); else player.eliminated.delete(action.id);
    } else if (action.type === 'restore') {
      requireThat(room.status === 'playing', 'Start the round first.');
      player.eliminated.clear();
    } else if (action.type === 'guess') {
      requireThat(room.status === 'playing' && opponent, 'Wait for both players to be ready.');
      requireThat(room.deck.includes(action.id), 'Choose a character on this board.');
      const correct = action.id === opponent.secret;
      room.result = { winner: correct ? player.id : opponent.id, guesser: player.id, guess: action.id, correct };
      room.status = 'finished';
    } else if (action.type === 'ask') {
      requireThat(room.status === 'playing', 'Start the round first.');
      requireThat(typeof action.text === 'string' && action.text.trim().length > 0 && action.text.trim().length <= 180, 'Ask a question of 1–180 characters.');
      requireThat(!room.questions.some(q => q.from === player.id && q.answer === null), 'Wait for an answer to your last question.');
      requireThat(room.questions.length < 100, 'Question limit reached. You can still make a guess.');
      room.questions.push({ id: randomUUID(), from: player.id, text: action.text.trim(), answer: null });
    } else if (action.type === 'answer') {
      requireThat(room.status === 'playing', 'The round has ended.');
      const question = room.questions.find(q => q.id === action.id);
      requireThat(question && question.from !== player.id && question.answer === null, 'This question cannot be answered.');
      requireThat(['Yes', 'No', 'Not sure'].includes(action.answer), 'Choose Yes, No, or Not sure.');
      question.answer = action.answer;
    } else if (action.type === 'rematch') {
      requireThat(room.status === 'finished', 'Finish the round first.');
      player.rematch = true;
      if (room.players.every(p => p.rematch)) {
        room.deck = this.deck(room.mode);
        room.status = 'lobby'; room.questions = []; room.result = null; room.round++;
        for (const p of room.players) {
          p.secret = room.deck[randomInt(room.deck.length)]; p.ready = false; p.rematch = false; p.eliminated.clear();
        }
      }
    } else throw new GameError('Unknown action.');
    room.updated = Date.now();
    room.version = (room.version || 0) + 1;
    this.broadcast(room);
    return this.view(room, player);
  }
  expire() {
    for (const [code, room] of this.rooms) {
      if (Date.now() - room.updated > 2 * 60 * 60 * 1000 && room.players.every(p => !p.connections.size)) this.rooms.delete(code);
    }
  }
}
