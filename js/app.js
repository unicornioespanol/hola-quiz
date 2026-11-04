import { questions } from './questions.js';
import { PracticeGame, rankPlayers, summarize, csvReport } from './game.js';
import { currentSession, forgetSession, savedGames, saveSession as persistSession } from './storage.js';

const app = document.querySelector('#app');
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const number = n => Number(n || 0).toLocaleString('es-ES');
let session = null, state = null, practice = null, service = null;
let pollTimer, clockTimer, pollBusy = false, actionBusy = false, lastView = '', reportTab = 'players';
let serverOffset = 0, selectedChoice = null;
const config = window.QUIZ_CONFIG || {};
const connected = Boolean(config.supabaseUrl && (config.supabasePublishableKey || config.supabaseAnonKey));

function toast(message) {
  const el = document.querySelector('#toast');
  el.textContent = message; el.classList.add('show');
  clearTimeout(toast.timeout); toast.timeout = setTimeout(() => el.classList.remove('show'), 3500);
}
function setPage(content, focus = true) {
  app.innerHTML = content;
  if (focus) { app.focus({ preventScroll: true }); window.scrollTo(0, 0); }
}
function stopTimers() { clearInterval(pollTimer); clearInterval(clockTimer); pollTimer = null; clockTimer = null; }
function goHome() { stopTimers(); session = null; state = null; practice = null; lastView = ''; selectedChoice = null; history.replaceState(null, '', location.pathname); renderHome(); }
function errorIn(form, message) { const el = form.querySelector('.error'); if (el) el.textContent = message; else toast(message); }
function showSetup() { document.querySelector('#setup-dialog').showModal(); }
function top(label, right = '') { return `<div class="screen-top"><span class="eyebrow">${label}</span>${right}</div>`; }
function saveSession() {
  if (session && !practice && !persistSession(session, state?.code === session.code ? state.status : undefined)) {
    toast('Activa el almacenamiento del navegador para volver a entrar si cierras esta página.');
  }
}
function getName() { try { return localStorage.getItem('hola-quiz-name') || ''; } catch { return ''; } }

function renderHome() {
  setPage(`<section class="hero"><div class="hero-copy"><span class="eyebrow">UN CONTINENTE. MIL DESCUBRIMIENTOS.</span><h1>América<br><em>Latina.</em></h1><p class="hero-description">De las Galápagos al Amazonas.<br>¿Cuánto sabes de este rincón del mundo?<br>Descubrámoslo juntos.</p><div class="hero-meta"><div><strong>10</strong><small>preguntas</small></div><div><strong>20 s</strong><small>por pregunta</small></div><div><strong>A2</strong><small>nivel de español</small></div></div></div><div class="join-card"><div class="card-topline"><span class="micro-label">LA CLASE SE CONVIERTE EN JUEGO</span><span class="edition">vol. 10</span></div><div class="card-art" aria-hidden="true"><div class="art-orbit"><span class="art-star">✳</span></div><span class="art-small">✧</span><span class="art-note">EXPLORA.<br>ELIGE. APRENDE.</span></div><h2>¿Nos vamos?</h2><p>Una pantalla compartida. Cada uno a su ritmo de respuesta.</p><button class="button primary wide" data-action="create">Crear una partida <span>↗</span></button><div class="or-line">¿TIENES UN CÓDIGO?</div><form id="code-form"><label class="sr-only" for="room-code">Código de partida</label><div class="input-row"><input id="room-code" class="code-input" name="code" placeholder="Código de partida" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" minlength="6" required autocomplete="off"><button class="button" aria-label="Entrar en la partida">→</button></div><div class="error" role="alert"></div></form><button class="practice-link" data-action="practice">Solo quiero practicar ↗</button></div></section>`);
  if (savedGames().length) app.querySelector('.join-card').insertAdjacentHTML('beforeend', '<button class="practice-link" data-action="history">Mis partidas y resultados ↗</button>');
  app.querySelector('#code-form').addEventListener('submit', e => { e.preventDefault(); if (!connected) return showSetup(); renderJoin(new FormData(e.target).get('code')); });
}

function renderJoin(code) {
  setPage(`<section class="screen narrow-screen">${top('TU PRÓXIMA PARADA', `<span class="room-tag">SALA ${esc(code)}</span>`)}<h1 class="screen-title">Tu nombre,<br>y empezamos.</h1><p class="helper">Así aparecerás en la partida y en el ranking.</p><form id="name-form" class="join-card"><label for="player-name">¿Cómo te llamas?</label><input id="player-name" name="name" maxlength="24" minlength="1" placeholder="Tu nombre o apodo" value="${esc(getName())}" required autocomplete="nickname"><button class="button primary wide">Entrar a la sala <span>→</span></button><div class="error" role="alert"></div></form><button class="text-button" data-action="home">← Volver al inicio</button></section>`);
  app.querySelector('#name-form').addEventListener('submit', async e => {
    e.preventDefault(); const form = e.target; const name = new FormData(form).get('name').trim();
    if (!name) return errorIn(form, 'Escribe un nombre para entrar.');
    const button = form.querySelector('button'); button.disabled = true;
    try {
      await ensureService();
      const result = await service.join(code, name);
      session = { code, role: 'player', token: result.token, playerId: result.playerId };
      try { localStorage.setItem('hola-quiz-name', name); } catch { /* The active game still works. */ }
      saveSession();
      await beginLive();
    } catch (error) { errorIn(form, error.message); button.disabled = false; }
  });
}

async function ensureService() {
  if (!connected) throw new Error('La conexión de las salas todavía no está configurada.');
  if (!service) { const { LiveService } = await import('./live.js'); service = new LiveService(config); }
}
async function createGame(button) {
  if (!connected) return showSetup();
  button.disabled = true;
  try {
    await ensureService(); const result = await service.create();
    session = { code: result.code, token: result.token, role: 'host' }; saveSession();
    history.replaceState(null, '', `${location.pathname}?host=${result.code}`);
    await beginLive();
  } catch (error) { toast(error.message); button.disabled = false; }
}
async function beginLive() {
  stopTimers(); practice = null; lastView = ''; selectedChoice = null;
  setPage(`<section class="screen waiting-screen"><span class="eyebrow">UN MOMENTO</span><h1 class="screen-title">Buscando nuestra sala…</h1><div id="connection-note" class="connection-note" role="status"></div></section>`);
  const valid = await poll();
  if (valid !== false && !['finished', 'closed'].includes(state?.status)) { pollTimer = setInterval(poll, 1100); clockTimer = setInterval(updateClock, 150); }
}
async function poll() {
  if (pollBusy || !session || practice) return;
  pollBusy = true;
  try {
    const requestStarted = Date.now();
    const next = await service.state(session);
    if (next.serverNow) serverOffset = next.serverNow - (requestStarted + Date.now()) / 2;
    const previousStatus = state?.status;
    state = next;
    if (previousStatus !== state.status) saveSession();
    renderState();
    const note = document.querySelector('#connection-note'); if (note) note.textContent = '';
  } catch (error) {
    if (error.code === 'INVALID_SESSION' || error.code === 'ROOM_NOT_FOUND') { stopTimers(); renderClosed(error.message); return false; }
    else { const note = document.querySelector('#connection-note'); if (note) note.textContent = 'Reconectando… Tu respuesta se conserva.'; }
  } finally { pollBusy = false; }
}
function startPractice() {
  stopTimers(); session = { role: 'practice', playerId: 'practice' }; practice = new PracticeGame();
  state = practice.next(); selectedChoice = null; lastView = ''; serverOffset = 0; renderState();
  clockTimer = setInterval(() => { state = practice.state(); renderState(); updateClock(); }, 150);
}
const isHost = () => session?.role === 'host';
const ownAnswer = () => state?.answers?.find(a => a.playerId === session?.playerId && a.question === state.index) || state?.myAnswer;
function renderState() {
  if (!state) return;
  const view = `${state.status}:${state.index}`;
  const changed = view !== lastView;
  if (changed) { selectedChoice = null; lastView = view; }
  if (state.status === 'lobby') {
    if (isHost()) renderLobby(changed); else if (changed) renderWaiting();
  } else if (state.status === 'question') {
    if (changed) renderQuestion(); else updateQuestion();
  } else if (state.status === 'reveal') {
    if (changed) renderReveal();
  } else if (state.status === 'finished') {
    if (changed) { stopTimers(); renderReport(); }
  } else if (state.status === 'closed') { stopTimers(); renderClosed('El anfitrión ha cerrado esta partida.'); }
}
function joinUrl() { const url = new URL(location.pathname, location.origin); url.searchParams.set('room', session.code); return url.href; }
function drawQr(target, text, size = 208) {
  const el = document.querySelector(target); if (!el) return;
  if (typeof window.QRCode === 'undefined') { el.innerHTML = '<span class="helper">Usa el código o copia el enlace.</span>'; return; }
  new window.QRCode(el, { text, width: size, height: size, colorDark: '#233e35', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
  const img = el.querySelector('img'); if (img) img.alt = 'Escanea para entrar en la partida';
}
function renderLobby(changed) {
  if (changed) {
    setPage(`<section class="screen">${top('EL PUNTO DE ENCUENTRO', '<button class="text-button" data-action="close">Cerrar sala ×</button>')}<h1 class="screen-title">El viaje empieza aquí.</h1><p class="helper">Escanea una vez, escribe tu nombre y quédate en la partida.</p><div class="lobby-layout"><div class="qr-card"><span class="micro-label">ESCANEA PARA UNIRTE</span><div id="room-qr" class="qr-wrap"></div><span class="micro-label">O USA ESTE CÓDIGO</span><div class="room-code">${esc(session.code)}</div><div class="input-row" style="justify-content:center"><button class="button" data-action="copy-link">Copiar enlace ↗</button><button class="button" data-action="enlarge-qr" aria-label="Ampliar QR">⤢</button></div></div><div><div class="players-head"><h3>Ya estamos aquí</h3><span class="count-badge" id="player-count">0</span></div><div class="player-chips" id="player-chips"></div><div class="lobby-actions"><span class="helper">Cuando estéis todos, empezamos la aventura.</span><button class="button primary" id="start-button" data-action="next">Empezar <span>→</span></button></div></div></div><div id="connection-note" class="connection-note" role="status"></div></section>`);
    drawQr('#room-qr', joinUrl());
  }
  document.querySelector('#player-count').textContent = state.players.length;
  document.querySelector('#player-chips').innerHTML = state.players.length ? state.players.map(p => `<span class="player-chip"><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span>${esc(p.name)}</span>`).join('') : '<p class="empty-state">La sala está lista.<br>Esperando a los primeros viajeros…</p>';
  document.querySelector('#start-button').disabled = state.players.length === 0;
}
function renderWaiting() {
  const me = state.players.find(p => p.id === session.playerId);
  setPage(`<section class="screen waiting-screen"><div class="waiting-mark" aria-hidden="true">✳</div><span class="eyebrow">ESTÁS DENTRO · SALA ${esc(session.code)}</span><h1 class="screen-title">¡Hola, ${esc(me?.name)}!</h1><p class="helper">Mira la pantalla principal.<br>El anfitrión empezará la partida en un momento.</p><div class="waiting-dots" aria-hidden="true"><i></i><i></i><i></i></div><p class="helper">Puedes dejar esta página abierta.<br>Los próximos pasos aparecerán aquí.</p><div id="connection-note" class="connection-note" role="status"></div></section>`);
}
function questionHeader() {
  return `${top(practice ? 'MODO PRÁCTICA' : isHost() ? 'EN DIRECTO' : 'AMÉRICA LATINA', `<span class="room-tag">${practice ? 'A TU RITMO' : `SALA ${esc(session.code)}`}</span>`)}<div class="question-meta"><span>PREGUNTA ${String(state.index + 1).padStart(2, '0')} / ${questions.length}</span><div class="question-progress" role="progressbar" aria-label="Progreso del quiz" aria-valuenow="${state.index + 1}" aria-valuemin="0" aria-valuemax="${questions.length}"><span style="width:${100 * (state.index + 1) / questions.length}%"></span></div></div>`;
}
function answerCards(reveal = false) {
  const q = questions[state.index]; const a = ownAnswer(); const chosen = a?.choice ?? selectedChoice;
  return q.options.map((option, i) => `<button class="answer${reveal ? i === q.correct ? ' correct' : ' incorrect' : ''}${chosen === i ? ' selected' : ''}" data-answer="${i}" ${reveal || isHost() || chosen !== null && chosen !== undefined ? 'disabled' : ''}><span class="answer-letter">${'ABCD'[i]}</span><span class="answer-text">${esc(option)}</span>${reveal && i === q.correct ? '<span class="answer-tail" aria-label="Respuesta correcta">✓</span>' : ''}</button>`).join('');
}
function renderQuestion() {
  const q = questions[state.index];
  setPage(`<section class="screen">${questionHeader()}<div class="question-heading"><h1>${esc(q.text)}</h1><div id="timer" class="timer" role="timer" aria-label="Segundos restantes">${q.seconds}</div></div><div class="answers-grid" id="answers">${answerCards()}</div><div class="question-bottom"><span class="answer-status" id="answer-status"></span>${isHost() ? '<button class="text-button" data-action="reveal">Ver respuestas →</button>' : ''}${practice ? '<button class="text-button" data-action="exit-practice">Salir de práctica ×</button>' : ''}</div><div id="connection-note" class="connection-note" role="status"></div></section>`);
  updateQuestion(); updateClock();
}
function updateQuestion() {
  const a = ownAnswer();
  const el = document.querySelector('#answer-status'); if (!el) return;
  if (isHost()) el.textContent = `${state.answerCount || 0} de ${state.players.length} respuestas recibidas`;
  else el.textContent = a || selectedChoice !== null ? 'Respuesta enviada. Esperando al grupo…' : 'Elige una respuesta. ¡Tú puedes!';
  if (a || selectedChoice !== null) { document.querySelectorAll('[data-answer]').forEach(b => { b.disabled = true; b.classList.toggle('selected', Number(b.dataset.answer) === (a?.choice ?? selectedChoice)); }); }
}
function updateClock() {
  const el = document.querySelector('#timer'); if (!el || !state?.deadline) return;
  const seconds = Math.max(0, Math.ceil((state.deadline - Date.now() - serverOffset) / 1000));
  el.textContent = seconds; el.classList.toggle('urgent', seconds <= 5);
  if (seconds === 0) document.querySelectorAll('[data-answer]').forEach(b => b.disabled = true);
}
async function submitAnswer(choice) {
  if (actionBusy || state.status !== 'question' || ownAnswer() || selectedChoice !== null) return;
  actionBusy = true; selectedChoice = choice; updateQuestion();
  try {
    if (practice) { state = practice.answer(choice); renderState(); }
    else { await service.answer(session, state.index, choice); await poll(); }
  } catch (error) { selectedChoice = null; toast(error.message); if (state.status === 'question') renderQuestion(); }
  finally { actionBusy = false; }
}
function renderReveal() {
  const q = questions[state.index]; const a = ownAnswer();
  const rows = state.answers?.filter(a => a.question === state.index) || [];
  const counts = state.counts || q.options.map((_, i) => rows.filter(a => a.choice === i).length);
  const max = Math.max(1, ...counts);
  const feedback = isHost() ? '¡Una parada más en el mapa!' : a?.correct ? '¡Exacto! Bien visto.' : a ? 'Casi… Seguimos descubriendo.' : 'Se acabó el tiempo. ¡Vamos a la próxima!';
  setPage(`<section class="screen">${questionHeader()}<div class="question-heading"><h1>${esc(q.text)}</h1></div><div class="answers-grid">${answerCards(true)}</div><div class="feedback-banner ${!isHost() && !a?.correct ? 'wrong' : ''}"><strong>${feedback}</strong><small>${isHost() ? `${counts[q.correct]} de ${state.players.length} aciertos` : a?.correct ? `+${number(a.points)} puntos` : 'Respuesta correcta: ' + esc(q.options[q.correct])}</small></div><div class="reveal-grid"><div><h2 class="section-label">ASÍ RESPONDIÓ EL GRUPO</h2><div class="distribution" role="img" aria-label="${counts.map((n, i) => `${'ABCD'[i]}: ${n} respuestas`).join(', ')}">${counts.map((n, i) => `<div class="bar-col"><b>${n}</b><div class="bar ${i === q.correct ? 'is-correct' : ''}" style="height:${Math.max(3, n / max * 90)}px"></div><span>${'ABCD'[i]} ${i === q.correct ? '✓' : ''}</span></div>`).join('')}</div></div><div><h2 class="section-label">${practice ? 'TU MARCADOR' : 'ASÍ VA EL VIAJE'}</h2><ol class="ranking-list">${rankPlayers(state.players).slice(0, 5).map((p, i) => `<li class="ranking-row"><span class="rank">${i + 1}</span><span class="avatar">${esc(p.name.slice(0, 1).toUpperCase())}</span><span>${esc(p.name)}</span><span class="score">${number(p.score)}</span></li>`).join('')}</ol></div></div><div class="question-bottom"><span class="helper">${practice ? 'La curiosidad siempre suma.' : isHost() ? 'Continúa cuando el grupo esté listo.' : 'Espera a que el anfitrión continúe.'}</span>${isHost() || practice ? `<button class="button primary" data-action="next">${state.index === questions.length - 1 ? 'Ver resultados' : 'Siguiente pregunta'} <span>→</span></button>` : ''}</div><div id="connection-note" class="connection-note" role="status"></div></section>`);
}
function renderReport() {
  const report = summarize(state); const ranked = rankPlayers(state.players); const me = ranked.find(p => p.id === session.playerId);
  setPage(`<section class="screen">${top('EL FINAL DE UN GRAN VIAJE', '<span class="room-tag">10 DE 10 PREGUNTAS</span>')}<div class="report-heading"><div><h1 class="screen-title">¡Qué bien nos lo pasamos!</h1><p class="helper">Cada respuesta, un lugar nuevo por descubrir.</p></div>${isHost() || practice ? '<button class="button" data-action="download">Descargar resultados <span>↓</span></button>' : ''}</div>${me ? `<div class="personal-result"><span class="eyebrow">${esc(me.name)} · PUESTO ${ranked.indexOf(me) + 1}</span><strong>${number(me.score)} <small style="font-size:18px">puntos</small></strong><p>${me.correct} de ${questions.length} respuestas correctas. ¡Gracias por viajar con nosotros!</p></div>` : ''}<div class="stats-grid"><div class="stat"><strong>${state.players.length}</strong><span>${state.players.length === 1 ? 'viajero' : 'viajeros'}</span></div><div class="stat"><strong>${report.accuracy}%</strong><span>de respuestas correctas</span></div><div class="stat"><strong>${report.averageSeconds.toFixed(1)} s</strong><span>por respuesta, de media</span></div></div><div class="tabs" role="tablist" aria-label="Resultados"><button class="tab ${reportTab === 'players' ? 'active' : ''}" role="tab" aria-selected="${reportTab === 'players'}" data-tab="players">Clasificación</button><button class="tab ${reportTab === 'questions' ? 'active' : ''}" role="tab" aria-selected="${reportTab === 'questions'}" data-tab="questions">Pregunta a pregunta</button></div><div id="report-content" role="tabpanel">${reportTab === 'players' ? playerTable(ranked) : questionReport(report)}</div><div class="report-bottom"><p class="helper">Las cosas que hoy descubrimos se quedan con nosotros.</p><button class="button primary" data-action="${practice ? 'practice' : isHost() ? 'new-game' : 'leave'}">${practice ? 'Volver a practicar' : isHost() ? 'Crear otra partida' : 'Volver al inicio'} <span>↗</span></button></div></section>`);
  if (isHost()) app.querySelector('.report-bottom').insertAdjacentHTML('beforeend', '<button class="text-button" data-action="history">Mis partidas ↗</button>');
}
function playerTable(players) {
  return `<div class="table-wrap"><table><thead><tr><th>PUESTO</th><th>NOMBRE</th><th>ACIERTOS</th><th>PUNTOS</th></tr></thead><tbody>${players.map((p, i) => `<tr><td><span class="medal">${i + 1}</span></td><td>${isHost() || practice ? `<button class="student-link" data-student="${esc(p.id)}" aria-label="Ver respuestas de ${esc(p.name)}">${esc(p.name)} <span aria-hidden="true">↗</span></button>` : esc(p.name)}</td><td>${p.correct} / ${questions.length}</td><td>${number(p.score)}</td></tr>`).join('')}</tbody></table></div>`;
}
function studentDetails(id) {
  if (!isHost() && !practice) return;
  const player = state.players.find(p => p.id === id); if (!player) return;
  const dialog = document.createElement('dialog'); dialog.className = 'detail-dialog';
  const answers = state.answers.filter(a => a.playerId === id);
  const seconds = answers.length ? (answers.reduce((sum, a) => sum + a.elapsedMs, 0) / answers.length / 1000).toFixed(1) : '—';
  dialog.innerHTML = `<form method="dialog"><button class="icon-button close-dialog" aria-label="Cerrar">×</button></form><span class="eyebrow">RESPUESTAS DEL VIAJERO</span><h2>${esc(player.name)}</h2><p class="helper">${player.correct} / ${questions.length} aciertos · ${number(player.score)} puntos · ${seconds} s por respuesta</p><div>${questions.map(q => {
    const a = answers.find(a => a.question === q.id);
    return `<div class="detail-row"><span class="detail-status ${a?.correct ? 'right' : 'wrong'}" aria-label="${a ? a.correct ? 'Correcta' : 'Incorrecta' : 'Sin respuesta'}">${a ? a.correct ? '✓' : '×' : '—'}</span><div><p>${q.id + 1}. ${esc(q.text)}</p><small>${a ? esc(q.options[a.choice]) : 'Sin respuesta'}${a && !a.correct ? ` · Correcta: ${esc(q.options[q.correct])}` : ''}</small></div><span class="detail-points">${a?.points || 0}<small>${a ? (a.elapsedMs / 1000).toFixed(1) + ' s' : '—'}</small></span></div>`;
  }).join('')}</div>`;
  document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
}
function showHistory() {
  const dialog = document.createElement('dialog'); dialog.className = 'detail-dialog';
  const games = savedGames();
  const labels = { lobby: 'Sala abierta', question: 'En juego', reveal: 'En juego', finished: 'Ver resultados', closed: 'Cerrada' };
  dialog.innerHTML = `<form method="dialog"><button class="icon-button close-dialog" aria-label="Cerrar">×</button></form><span class="eyebrow">PARA EL ANFITRIÓN</span><h2>Mis partidas.</h2><p class="helper">Guardadas en este navegador durante 7 días.</p><div class="history-list">${games.map((g, i) => `<button class="history-item" data-saved-game="${i}"><span>Sala ${esc(g.code)}<small>${new Date(g.savedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}</small></span><span>${labels[g.status] || 'Abrir'} →</span></button>`).join('') || '<p class="helper">Todavía no hay partidas guardadas.</p>'}</div>`;
  dialog.addEventListener('click', async e => {
    const button = e.target.closest('[data-saved-game]'); if (!button) return;
    session = { ...games[Number(button.dataset.savedGame)] }; state = null; practice = null;
    saveSession(); dialog.close();
    try { await ensureService(); await beginLive(); } catch (error) { toast(error.message); }
  });
  document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
}
function questionReport(report) {
  return report.perQuestion.map(q => { const pct = state.players.length ? Math.round(q.correctCount / state.players.length * 100) : 0; return `<div class="question-report"><span class="number">${String(q.id + 1).padStart(2, '0')}</span><div><p>${isHost() || practice ? `<button class="student-link" data-question="${q.id}">${esc(q.text)} <span aria-hidden="true">↗</span></button>` : esc(q.text)}</p><small>✓ ${esc(q.options[q.correct])} · ${q.answered} respuestas</small></div><div class="accuracy-value">${pct}%<div class="accuracy-meter"><span style="width:${pct}%"></span></div></div></div>`; }).join('');
}
function questionDetails(index) {
  if (!isHost() && !practice) return;
  const q = questions[index]; if (!q) return;
  const answers = state.answers.filter(a => a.question === index);
  const answered = new Set(answers.map(a => a.playerId));
  const dialog = document.createElement('dialog'); dialog.className = 'detail-dialog';
  const names = ids => state.players.filter(p => ids.has(p.id)).map(p => esc(p.name)).join(', ') || 'Nadie';
  dialog.innerHTML = `<form method="dialog"><button class="icon-button close-dialog" aria-label="Cerrar">×</button></form><span class="eyebrow">PREGUNTA ${index + 1} · ASÍ RESPONDIERON</span><h2>${esc(q.text)}</h2><div>${q.options.map((option, i) => {
    const ids = new Set(answers.filter(a => a.choice === i).map(a => a.playerId));
    return `<div class="detail-row"><span class="detail-status ${q.correct === i ? 'right' : ''}">${'ABCD'[i]}</span><div><p>${esc(option)} ${q.correct === i ? '✓' : ''}</p><small>${names(ids)}</small></div><span class="detail-points">${ids.size}</span></div>`;
  }).join('')}<div class="detail-row"><span class="detail-status wrong">—</span><div><p>Sin respuesta</p><small>${names(new Set(state.players.filter(p => !answered.has(p.id)).map(p => p.id)))}</small></div><span class="detail-points">${state.players.length - answered.size}</span></div></div>`;
  document.body.append(dialog); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
}
function renderClosed(message) {
  setPage(`<section class="screen closed-screen"><span class="eyebrow">HASTA LA PRÓXIMA</span><h1 class="screen-title">Esta parada ha terminado.</h1><p class="helper">${esc(message)}</p><button class="button primary" data-action="leave">Volver al inicio <span>→</span></button></section>`);
}
async function hostAction(action) {
  if (actionBusy) return; actionBusy = true;
  document.querySelectorAll('[data-action="next"], [data-action="reveal"]').forEach(b => b.disabled = true);
  try {
    if (practice) { state = practice.next(); renderState(); }
    else { await service.action(session, action, state.index); await poll(); }
  } catch (error) { toast(error.message); document.querySelectorAll('[data-action="next"], [data-action="reveal"]').forEach(b => b.disabled = false); }
  finally { actionBusy = false; }
}
async function closeRoom() {
  const dialog = document.createElement('dialog');
  dialog.innerHTML = '<h2>¿Cerrar la partida?</h2><p>La sala dejará de aceptar respuestas.</p><div class="input-row"><button class="button" data-cancel>Seguir jugando</button><button class="button primary" data-confirm>Cerrar sala</button></div>';
  document.body.append(dialog); dialog.showModal();
  dialog.querySelector('[data-cancel]').onclick = () => dialog.close();
  dialog.querySelector('[data-confirm]').onclick = async () => { dialog.close(); await hostAction('close'); };
  dialog.addEventListener('close', () => dialog.remove());
}
function enlargeQr() {
  const dialog = document.createElement('dialog'); dialog.className = 'qr-dialog';
  dialog.innerHTML = `<form method="dialog"><button class="icon-button close-dialog" aria-label="Cerrar">×</button></form><span class="eyebrow">ESCANEA Y ÚNETE</span><div class="qr-wrap" id="big-qr"></div><div class="room-code">${esc(session.code)}</div>`;
  document.body.append(dialog); drawQr('#big-qr', joinUrl(), 340); dialog.showModal(); dialog.addEventListener('close', () => dialog.remove());
}
app.addEventListener('click', async e => {
  const student = e.target.closest('[data-student]'); if (student) return studentDetails(student.dataset.student);
  const question = e.target.closest('[data-question]'); if (question) return questionDetails(Number(question.dataset.question));
  const answer = e.target.closest('[data-answer]'); if (answer && !answer.disabled) return submitAnswer(Number(answer.dataset.answer));
  const tab = e.target.closest('[data-tab]'); if (tab) { reportTab = tab.dataset.tab; renderReport(); return; }
  const button = e.target.closest('[data-action]'); if (!button || button.disabled) return;
  switch (button.dataset.action) {
    case 'create': case 'new-game': await createGame(button); break;
    case 'practice': startPractice(); break;
    case 'exit-practice': case 'home': goHome(); break;
    case 'leave': forgetSession(); goHome(); break;
    case 'history': showHistory(); break;
    case 'next': await hostAction('next'); break;
    case 'reveal': await hostAction('reveal'); break;
    case 'close': await closeRoom(); break;
    case 'copy-link': try { await navigator.clipboard.writeText(joinUrl()); toast('Enlace copiado. ¡Compártelo con la clase!'); } catch { toast(joinUrl()); } break;
    case 'enlarge-qr': enlargeQr(); break;
    case 'download': {
      const blob = new Blob([csvReport(state)], { type: 'text/csv;charset=utf-8' }); const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `america-latina-${new Date().toISOString().slice(0, 10)}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); break;
    }
  }
});
document.querySelector('#setup-practice').onclick = () => { document.querySelector('#setup-dialog').close(); startPractice(); };
document.addEventListener('visibilitychange', () => { if (!document.hidden && session && !practice) poll(); });
window.addEventListener('online', () => { if (session && !practice) poll(); });
async function boot() {
  const params = new URLSearchParams(location.search); const room = params.get('room');
  const saved = currentSession();
  if (saved && connected && (!room || room === saved.code)) {
    session = saved;
    try { await ensureService(); await beginLive(); return; } catch { session = null; }
  }
  if (room && /^\d{6}$/.test(room)) renderJoin(room); else renderHome();
}
boot();
