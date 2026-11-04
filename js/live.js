import { requestToken, clearStored } from './storage.js';

const messages = {
  ROOM_NOT_FOUND: 'No encontramos esa sala. Comprueba el código.',
  INVALID_SESSION: 'La sesión ya no es válida. Vuelve a entrar con el código.',
  ROOM_STARTED: 'Esta partida ya ha empezado. Espera a la siguiente.',
  NAME_TAKEN: 'Ese nombre ya está en la sala. Prueba con otro apodo.',
  INVALID_NAME: 'Escribe un nombre de entre 1 y 24 caracteres.',
  ROOM_FULL: 'La sala está completa (100 participantes).',
  TOO_LATE: 'El tiempo ha terminado. Espera a la siguiente pregunta.',
  INVALID_ACTION: 'La partida ya ha avanzado. Actualizando…',
  NO_PLAYERS: 'Espera a que entre al menos una persona.',
};

export class LiveService {
  constructor(config) {
    this.url = config.supabaseUrl.replace(/\/$/, '') + '/rest/v1/rpc/';
    this.key = config.supabasePublishableKey || config.supabaseAnonKey;
  }
  async rpc(name, body) {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 9000);
    try {
      const response = await fetch(this.url + name, {
        method: 'POST', headers: { apikey: this.key, 'Content-Type': 'application/json',
          // Legacy anon JWTs need Authorization; publishable keys belong only in apikey.
          ...(this.key.startsWith('eyJ') ? { Authorization: `Bearer ${this.key}` } : {}) },
        body: JSON.stringify(body), signal: controller.signal,
      });
      let result;
      try { result = await response.json(); } catch { throw new Error('La sala no está disponible ahora. Inténtalo de nuevo en un momento.'); }
      if (!response.ok) {
        const code = Object.keys(messages).find(code => result.message?.includes(code));
        const error = new Error(messages[code] || 'No pudimos conectar con la sala. Inténtalo de nuevo.');
        error.code = code; throw error;
      }
      return result;
    } catch (error) {
      if (error.name === 'AbortError' || error instanceof TypeError) throw new Error('Sin conexión. Revisa internet e inténtalo de nuevo.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  async create() {
    const result = await this.rpc('quiz_create', { p_token: requestToken('hola-quiz-create-request') });
    clearStored('hola-quiz-create-request'); return result;
  }
  async join(code, name) {
    const key = `hola-quiz-join-request-${code}`;
    const result = await this.rpc('quiz_join', { p_code: code, p_name: name, p_token: requestToken(key) });
    clearStored(key); return result;
  }
  state(session) { return this.rpc('quiz_state', { p_code: session.code, p_token: session.token }); }
  action(session, action, index) { return this.rpc('quiz_action', { p_code: session.code, p_token: session.token, p_action: action, p_index: index }); }
  answer(session, index, choice) { return this.rpc('quiz_answer', { p_code: session.code, p_token: session.token, p_index: index, p_choice: choice }); }
}
