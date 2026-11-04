// Browser-only recovery. Room tokens never go into URLs or exported reports.
const CURRENT = 'hola-quiz-session';
const HISTORY = 'hola-quiz-history';
export function readStored(key, fallback = null) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
export function writeStored(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
}
export function currentSession() { return readStored(CURRENT); }
export function forgetSession() { try { localStorage.removeItem(CURRENT); } catch { /* Storage may be disabled. */ } }
export function savedGames() {
  const rows = readStored(HISTORY, []);
  return Array.isArray(rows) ? rows.filter(row => /^\d{6}$/.test(row.code) && row.role === 'host' && row.token && row.savedAt > Date.now() - 7 * 86400000) : [];
}
export function saveSession(session, status) {
  const saved = writeStored(CURRENT, session);
  if (session.role === 'host') {
    const previous = savedGames();
    const old = previous.find(row => row.token === session.token);
    const entry = { ...session, status: status || old?.status || 'lobby', savedAt: old?.savedAt || Date.now() };
    writeStored(HISTORY, [entry, ...previous.filter(row => row.token !== session.token)].slice(0, 30));
  }
  return saved;
}
export function requestToken(key) {
  const existing = readStored(key);
  if (typeof existing === 'string' && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
  const token = crypto.randomUUID(); writeStored(key, token); return token;
}
export function clearStored(key) { try { localStorage.removeItem(key); } catch { /* No persistent storage. */ } }
