const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let catalog, byId, state = null, token = null, stream = null;
let page = 0, query = '', remainingOnly = false, guessing = false, choosing = false, undo = [], lastBoard = '', resultShown = '', online = false;
let actionQueue = Promise.resolve();
let toastTimer;
const PAGE_SIZE = 48;
function readStorage(store, key) { try { return store.getItem(key); } catch { return null; } }
function saveStorage(store, key, value) { try { value === null ? store.removeItem(key) : store.setItem(key, value); } catch { /* Private browsing can disable storage. */ } }
function toast(message) { $('#toast').textContent = message; $('#toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').hidden = true, 4500); }
function portrait(character, lazy = true) {
  if (!character) return '';
  return character.image ? `<img src="${escape(character.image)}" alt="" width="200" height="220" ${lazy ? 'loading="lazy"' : 'fetchpriority="high"'} decoding="async">` : `<span class="initials" aria-hidden="true">${escape(character.name.split(/\s+/).slice(0, 2).map(n => n[0]).join(''))}</span>`;
}
async function request(path, body, auth = token) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(auth ? { Authorization: `Bearer ${auth}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not connect. Try again.');
  return data;
}
function action(body) {
  const task = actionQueue.then(async () => {
    if (!state || !online) throw new Error('Reconnecting. Please wait a moment.');
    const next = await request(`/api/rooms/${state.code}/actions`, body);
    receiveState(next);
    return next;
  });
  actionQueue = task.catch(error => toast(error.message));
  return task;
}
function receiveState(next) {
  if (state && (next.code !== state.code || (next.version ?? 0) < (state.version ?? 0))) return;
  if (state && next.round !== state.round) { undo = []; guessing = false; choosing = false; page = 0; $('#modal').close(); }
  state = next; render();
}
function connect() {
  stream?.close(); online = false;
  if (catalog.transport === 'poll') {
    let closed = false, timer = null, etag = null;
    const code = state.code, sessionToken = token;
    const controller = new AbortController();
    const current = { close() { closed = true; clearTimeout(timer); controller.abort(); } };
    stream = current;
    const poll = async () => {
      if (closed) return;
      if (document.hidden) { timer = setTimeout(poll, 2000); return; }
      try {
        const response = await fetch(`/api/rooms/${code}`, { headers: { Authorization: `Bearer ${sessionToken}`, ...(etag ? { 'If-None-Match': etag } : {}) }, signal: controller.signal, cache: 'no-store' });
        if (closed || stream !== current) return;
        if (response.status === 304) { online = true; $('#connection').hidden = true; }
        else {
          const next = await response.json();
          if (!response.ok) throw new Error(next.error);
          etag = response.headers.get('etag');
          if (!state || (next.version ?? 0) >= (state.version ?? 0)) {
            online = true; $('#connection').hidden = true; receiveState(next);
          }
        }
      } catch { if (!closed) { online = false; $('#connection').hidden = false; } }
      if (!closed) timer = setTimeout(poll, catalog.pollInterval || 2000);
    };
    poll(); return;
  }
  const current = new EventSource(`/api/rooms/${state.code}/events?token=${encodeURIComponent(token)}`);
  stream = current;
  current.onmessage = (event) => {
    if (stream !== current) return;
    const next = JSON.parse(event.data);
    online = true; $('#connection').hidden = true; receiveState(next);
  };
  current.onerror = () => { if (stream === current) { online = false; $('#connection').hidden = false; } };
}
function enterRoom(data) {
  state = data.state; token = data.token; page = 0; undo = []; guessing = false; choosing = false; query = ''; $('#search').value = '';
  saveStorage(sessionStorage, 'sp-session', JSON.stringify({ code: state.code, token }));
  history.replaceState(null, '', `?room=${state.code}`);
  render(); connect();
  window.scrollTo({ top: 0, behavior: 'auto' });
}
function leaveRoom() {
  stream?.close(); stream = null; state = null; token = null; online = false; query = ''; page = 0; undo = []; guessing = false; choosing = false; remainingOnly = false;
  $('#search').value = ''; $('#connection').hidden = true; $('#modal').close();
  saveStorage(sessionStorage, 'sp-session', null); history.replaceState(null, '', location.pathname); render();
}
function render() {
  if (!catalog) return;
  const inRoom = !!state;
  $('#intro').hidden = inRoom; $('#home-panel').hidden = inRoom; $('#room-panel').hidden = !inRoom; $('#quick-rules').hidden = inRoom;
  $('#questions-panel').hidden = !inRoom || state.status === 'lobby';
  $('#guess-bar').hidden = !inRoom || state.status !== 'playing';
  const playing = inRoom && state.status === 'playing';
  for (const id of ['#remaining-filter', '#restore']) $(id).disabled = !playing;
  $('#undo').disabled = !playing || !undo.length;
  $('#remaining-filter').setAttribute('aria-pressed', String(remainingOnly));
  $('#guess-mode').textContent = guessing ? 'Cancel guess ✕' : 'Make a guess →';
  $('#board-title').firstChild.textContent = inRoom ? ({ classic: 'The usual suspects', random: 'The deep cuts', all: 'The whole town' }[state.mode]) : 'The usual suspects';
  $('#board-eyebrow').textContent = inRoom ? `ROUND ${state.round} · ${state.status === 'lobby' ? 'GET SETTLED IN' : state.status === 'finished' ? 'CASE CLOSED' : 'TRUST NO ONE. EXCEPT YOUR BUDDY.'}` : 'SMALL TOWN. BIG PERSONALITIES.';
  $('#board-count').textContent = inRoom ? state.deck.length.toLocaleString() : catalog.classic.length;
  $('#board-label').textContent = inRoom ? state.status === 'lobby' ? 'THE LINEUP' : state.status === 'finished' ? 'CASE CLOSED' : 'LIVE 1 VS 1' : 'THE PREVIEW LINEUP';
  $('#play-hint').lastChild.textContent = !inRoom ? ' Pick a room to get started. Your friend’s character is a mystery.' : state.status === 'lobby' ? choosing ? ' Tap a card to choose your secret character.' : ' Your secret is assigned. Get ready when your buddy joins.' : state.status === 'finished' ? ' Case closed. Want another round? Request a rematch.' : guessing ? ' Guess mode: tap the character you think your friend has.' : ' Tap to cross out a face. Tap again to bring them back.';
  if (inRoom) {
    $('#code-display').textContent = state.code; $('#you-name').textContent = state.you.name;
    $('#opponent-name').textContent = state.opponent?.name || 'Waiting for a friend…';
    $('#opponent-status').textContent = state.opponent ? (state.opponent.ready ? 'READY' : state.opponent.online ? 'HERE' : 'OFFLINE') : '';
    $('#opponent-dot').classList.toggle('green', !!state.opponent?.online);
    $('#room-status').textContent = state.status === 'lobby' ? (!state.opponent ? 'Copy your invite and send it to a friend.' : state.you.ready ? 'You’re ready. Waiting for your buddy…' : 'Your buddy is here. Ready when you are.') : state.status === 'playing' ? (state.opponent?.online ? 'Game on. Ask a question or make a guess.' : 'Your buddy disconnected. Their board is saved.') : 'Round over. Play again with the same buddy.';
    const secret = byId.get(state.you.secret);
    if ($('#secret-image').dataset.id !== secret.id) { $('#secret-image').innerHTML = portrait(secret, false); $('#secret-image').dataset.id = secret.id; }
    $('#secret-name').textContent = secret.name;
    $('#change-character').hidden = state.status !== 'lobby' || state.you.ready;
    $('#change-character').textContent = choosing ? 'Cancel selection ✕' : 'Change character ↻';
    $('#ready').hidden = state.status === 'playing';
    $('#ready').disabled = !online || (state.status === 'finished' && state.you.rematch);
    $('#ready').textContent = state.status === 'finished' ? state.you.rematch ? 'Rematch requested ✓' : 'Play again ↻' : state.you.ready ? 'Ready! Tap to undo ✓' : 'I’m ready →';
    $('#ready-note').textContent = state.status === 'finished' ? state.you.rematch ? 'Waiting for your buddy’s rematch.' : 'Both players must agree to a rematch.' : 'Keep your character a secret.';
    renderQuestions();
    if (state.result && resultShown !== `${state.code}-${state.round}`) { resultShown = `${state.code}-${state.round}`; showResult(); }
  }
  renderBoard();
}
function renderBoard() {
  if (!catalog) return;
  const deck = state ? state.deck : catalog.classic;
  const excluded = new Set(state?.you.eliminated || []);
  const term = query.toLocaleLowerCase().trim();
  const filtered = deck.filter(id => (!remainingOnly || !excluded.has(id)) && (!term || byId.get(id).name.toLocaleLowerCase().includes(term)));
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  page = Math.max(0, Math.min(page, pages - 1));
  const items = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const signature = JSON.stringify([items, [...excluded], guessing, choosing, state?.status, state?.you.ready, state?.you.secret]);
  if (lastBoard !== signature) {
    lastBoard = signature;
    const focusedId = document.activeElement?.dataset.character;
    $('#board').classList.toggle('guessing', guessing);
    $('#board').innerHTML = items.map(id => {
      const c = byId.get(id), removed = excluded.has(id);
      const enabled = state?.status === 'playing' || (state?.status === 'lobby' && choosing && !state.you.ready);
      const label = !enabled ? c.name : state.status === 'lobby' ? `Choose ${c.name} as your secret` : guessing ? `Guess ${c.name}` : `${removed ? 'Restore' : 'Cross out'} ${c.name}`;
      return `<button class="character ${removed ? 'excluded' : ''} ${choosing && state?.you.secret === id ? 'selected' : ''}" data-character="${escape(id)}" ${!enabled ? 'disabled' : ''} aria-label="${escape(label)}" ${state?.status === 'playing' && !guessing ? `aria-pressed="${removed}"` : ''}><span class="portrait">${portrait(c)}</span><span class="cross" aria-hidden="true">×</span><span class="character-name">${escape(c.name)}</span></button>`;
    }).join('') || '<p class="loading">No suspects found. Try another name or show all cards.</p>';
    if (focusedId) document.querySelector(`[data-character="${CSS.escape(focusedId)}"]`)?.focus({ preventScroll: true });
  }
  $('#pagination').hidden = pages === 1;
  $('#page-label').textContent = `${page + 1} / ${pages} · ${filtered.length.toLocaleString()} faces`;
  $('#previous-page').disabled = page === 0; $('#next-page').disabled = page >= pages - 1;
  $('#remaining-count').textContent = state ? `${(deck.length - excluded.size).toLocaleString()} of ${deck.length.toLocaleString()} suspects remaining` : `${deck.length} faces. One very good poker face.`;
}
let questionSignature = '';
function renderQuestions() {
  const signature = JSON.stringify([state.questions, state.status, state.you.id]);
  if (signature !== questionSignature) {
    questionSignature = signature;
    $('#question-log').innerHTML = state.questions.map(q => `<div class="question"><small>${q.from === state.you.id ? 'YOU ASKED' : escape(state.opponent?.name || 'YOUR BUDDY') + ' ASKED'}</small><span>${escape(q.text)}</span>${q.answer ? `<div class="answer" data-answer="${escape(q.answer)}">${escape(q.answer)}</div>` : q.from !== state.you.id && state.status === 'playing' ? `<div class="answers">${['Yes', 'No', 'Not sure'].map(a => `<button class="tool-button" data-answer="${a}" data-question="${q.id}">${a}</button>`).join('')}</div>` : '<div class="answer">Waiting for an answer…</div>'}</div>`).join('') || '<p class="small-note">The room is suspiciously quiet. Ask the first question.</p>';
    $('#question-log').scrollTop = $('#question-log').scrollHeight;
  }
  const pending = state.questions.some(q => q.from === state.you.id && !q.answer);
  $('#ask-button').disabled = !online || state.status !== 'playing' || pending;
  $('#ask-button').textContent = pending ? 'Waiting for an answer…' : 'Ask your buddy ↑';
  $('#question-text').disabled = state.status !== 'playing';
}
function modal(content) { $('#modal-content').innerHTML = content; if (!$('#modal').open) $('#modal').showModal(); }
function showResult() {
  const won = state.result.winner === state.you.id;
  const guess = byId.get(state.result.guess);
  const otherSecret = state.result.identities.find(p => p.id === state.opponent.id);
  modal(`<div class="result-tag">CASE CLOSED · ROUND ${state.round}</div><h2 id="modal-title">${won ? 'You cracked the case.' : 'Well played, buddy.'}</h2><p>${escape(state.result.guesser === state.you.id ? 'You' : state.opponent.name)} guessed <b>${escape(guess.name)}</b>. ${state.result.correct ? 'Right on the money!' : 'That wasn’t it. A wrong guess loses the round.'}</p>${portrait(byId.get(otherSecret?.secret), false)}<p>Your buddy’s character: <b>${escape(byId.get(otherSecret?.secret)?.name)}</b></p><button class="button red full" id="modal-rematch">Play again ↻</button>`);
}
$('#close-modal').onclick = () => $('#modal').close();
$('#modal').addEventListener('click', event => { if (event.target === $('#modal')) { const r = $('#modal').getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) $('#modal').close(); } });
$('#rules').onclick = () => modal('<h2 id="modal-title">A little friendly suspicion.</h2><ol><li>Create a room and send your buddy the invite link or six-character code.</li><li>Each player gets a secret character. You can change yours before hitting ready.</li><li>Ask yes-or-no questions here, or talk on a call. Tap cards to cross out characters. Your eliminations are private.</li><li>Make a guess <b>at any time</b>, even while a question is pending. A correct guess wins; a wrong one loses the round.</li></ol><p>No turn timer. No downloads. Just you and your buddy.</p>');
$('#sources').onclick = () => {
  if (!catalog) return toast('The character index is still loading.');
  const meta = catalog.meta;
  modal(`<h2 id="modal-title">Meet the whole town.</h2><p class="source-stats">${meta.count.toLocaleString()} character pages</p><p>${meta.portraits.toLocaleString()} local, compressed portraits. Imported ${escape(new Date(meta.importedAt).toLocaleDateString())}.</p><p>${escape(meta.coverage)}</p><p>${escape(meta.missingPortraits.length)} entries have no available portrait and use initials. Classic mode is the familiar cast; deep cuts samples characters with portraits.</p><p>Data from <a href="${escape(meta.source)}/wiki/Category:Characters" target="_blank" rel="noopener">South Park Archives</a>. <a href="/data/import-report.json" target="_blank" rel="noopener">Full import report ↗</a></p><p>${escape(meta.attribution)}</p><p>South Park Guess Who is an unofficial fan game, unaffiliated with South Park Studios, Paramount, or the original Guess Who game.</p>`);
};
$('#create-form').onsubmit = async event => {
  event.preventDefault(); if (!catalog) return toast('The character index is still loading.');
  const button = $('#create-button'); button.disabled = true;
  try { const name = $('#player-name').value.trim(); saveStorage(localStorage, 'sp-name', name); enterRoom(await request('/api/rooms', { name, mode: $('#deck-mode').value }, null)); }
  catch (error) { toast(error.message); } finally { button.disabled = false; }
};
$('#join-form').onsubmit = async event => {
  event.preventDefault(); if (!catalog) return toast('The character index is still loading.');
  if (!$('#player-name').value.trim()) { $('#player-name').reportValidity(); $('#player-name').focus(); return; }
  const button = $('#join-form button'); button.disabled = true;
  try { const name = $('#player-name').value.trim(); saveStorage(localStorage, 'sp-name', name); enterRoom(await request(`/api/rooms/${$('#room-code').value.trim().toUpperCase()}/join`, { name }, null)); }
  catch (error) { toast(error.message); } finally { button.disabled = false; }
};
$('#room-code').oninput = event => { event.target.value = event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ''); };
$('#copy-code').onclick = async () => {
  const invite = `${location.origin}/?room=${state.code}`;
  try { await navigator.clipboard.writeText(invite); toast('Invite copied. Send it to your buddy!'); }
  catch { modal(`<h2 id="modal-title">Invite your buddy.</h2><p>Room code: <b>${escape(state.code)}</b></p><label for="invite-link">INVITE LINK</label><input id="invite-link" readonly value="${escape(invite)}"><p>Select and copy this link.</p>`); $('#invite-link').select(); }
};
$('#leave').onclick = () => modal('<h2 id="modal-title">Leave this room?</h2><p>Your seat stays reserved until the room expires. You’ll need a new room to play again after leaving.</p><button class="button red full" id="confirm-leave">Leave room →</button>');
$('#change-character').onclick = () => { choosing = !choosing; render(); if (choosing) $('#board-title').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
$('#ready').onclick = () => { choosing = false; action({ type: state.status === 'finished' ? 'rematch' : 'ready' }).catch(() => {}); };
$('#search').oninput = event => { query = event.target.value; page = 0; renderBoard(); };
$('#remaining-filter').onclick = () => { remainingOnly = !remainingOnly; page = 0; render(); };
$('#guess-mode').onclick = () => { guessing = !guessing; render(); $('#board-title').scrollIntoView({ block: 'start', behavior: 'smooth' }); };
$('#restore').onclick = () => { action({ type: 'restore' }).then(() => { undo = []; render(); }).catch(() => {}); };
$('#undo').onclick = () => { const last = undo.pop(); if (last) action({ type: 'eliminate', id: last.id, excluded: last.excluded }).catch(() => undo.push(last)); render(); };
$('#board').onclick = event => {
  const button = event.target.closest('[data-character]'); if (!button || button.disabled || !state) return;
  const id = button.dataset.character;
  if (state.status === 'lobby' && choosing) return void action({ type: 'identity', id }).then(() => { choosing = false; render(); toast('Secret character updated. Don’t tell your buddy.'); }).catch(() => {});
  if (guessing) {
    const c = byId.get(id);
    modal(`<h2 id="modal-title">Is it ${escape(c.name)}?</h2><div class="confirm-portrait">${portrait(c, false)}</div><p class="modal-warning">This is your final guess. Get it right and you win. Get it wrong and your buddy wins.</p><button class="button red full" id="confirm-guess" data-guess="${escape(id)}">Lock in my guess →</button>`);
  } else {
    const excluded = state.you.eliminated.includes(id);
    action({ type: 'eliminate', id, excluded: !excluded }).then(() => { undo.push({ id, excluded }); render(); }).catch(() => {});
  }
};
$('#ask-form').onsubmit = event => { event.preventDefault(); const text = $('#question-text').value.trim(); action({ type: 'ask', text }).then(() => $('#question-text').value = '').catch(() => {}); };
$('#question-log').onclick = event => { const button = event.target.closest('[data-question]'); if (button) action({ type: 'answer', id: button.dataset.question, answer: button.dataset.answer }).catch(() => {}); };
$('#modal-content').onclick = event => {
  if (event.target.closest('#confirm-leave')) return leaveRoom();
  if (event.target.closest('#modal-rematch')) { $('#modal').close(); return void action({ type: 'rematch' }).catch(() => {}); }
  const button = event.target.closest('#confirm-guess');
  if (button) { button.disabled = true; action({ type: 'guess', id: button.dataset.guess }).catch(() => { button.disabled = false; }); }
};
for (const [id, delta] of [['#previous-page', -1], ['#next-page', 1]]) $(id).onclick = () => { page += delta; renderBoard(); $('#board-title').scrollIntoView({ block: 'start' }); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && state && stream?.readyState === EventSource.CLOSED) connect(); });
window.addEventListener('pagehide', () => stream?.close());
window.addEventListener('pageshow', event => { if (event.persisted && state) connect(); });

async function initialize() {
  $('#player-name').value = readStorage(localStorage, 'sp-name') || '';
  const inviteCode = new URLSearchParams(location.search).get('room');
  if (inviteCode && /^[A-Z2-9]{6}$/i.test(inviteCode)) $('#room-code').value = inviteCode.toUpperCase();
  try {
    catalog = await request('/api/catalog', undefined, null);
    byId = new Map(catalog.characters.map(c => [c.id, c]));
    const saved = readStorage(sessionStorage, 'sp-session');
    if (saved) {
      try {
        const session = JSON.parse(saved);
        if (!inviteCode || inviteCode.toUpperCase() === session.code) {
          const next = await request(`/api/rooms/${session.code}`, undefined, session.token);
          enterRoom({ state: next, token: session.token }); return;
        }
      } catch { saveStorage(sessionStorage, 'sp-session', null); toast('Your old room expired. Start a fresh one with your buddy.'); }
    }
    render();
  } catch {
    $('#board').innerHTML = '<p class="loading">Couldn’t load the town. Check your connection and reload.</p>';
    toast('Connection failed. Reload to try again.');
  }
}
initialize();
