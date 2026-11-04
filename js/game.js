import { questions } from './questions.js';

export function pointsFor(correct, elapsedMs, seconds = 20) {
  if (!correct) return 0;
  return Math.round(1000 * (1 - Math.min(1, Math.max(0, elapsedMs / (seconds * 1000))) / 2));
}

export function rankPlayers(players) {
  return [...players].sort((a, b) => b.score - a.score || b.correct - a.correct || a.name.localeCompare(b.name, 'es'));
}

export function summarize(game) {
  const players = game.players || [];
  const answers = game.answers || [];
  const correct = answers.filter(a => a.correct).length;
  const possible = players.length * questions.length;
  return {
    accuracy: possible ? Math.round(100 * correct / possible) : 0,
    averageSeconds: answers.length ? answers.reduce((sum, a) => sum + a.elapsedMs, 0) / answers.length / 1000 : 0,
    perQuestion: questions.map(q => {
      const rows = answers.filter(a => a.question === q.id);
      return { ...q, answered: rows.length, correctCount: rows.filter(a => a.correct).length,
        counts: q.options.map((_, i) => rows.filter(a => a.choice === i).length) };
    }),
  };
}

export function csvReport(game) {
  const quote = value => {
    let text = String(value ?? '');
    // Keep spreadsheet formula characters inert, including user supplied names.
    if (/^[\s]*[=+@-]/.test(text)) text = "'" + text;
    return '"' + text.replaceAll('"', '""') + '"';
  };
  const rows = [['Posición', 'Nombre', 'Puntos totales', 'Aciertos', 'Pregunta n.º', 'Pregunta', 'Respuesta', 'Respuesta correcta', 'Resultado', 'Puntos de la pregunta', 'Segundos']];
  rankPlayers(game.players).forEach((p, i) => questions.forEach(q => {
    const a = game.answers.find(a => a.playerId === p.id && a.question === q.id);
    rows.push([i + 1, p.name, p.score, p.correct, q.id + 1, q.text, a ? q.options[a.choice] : 'Sin respuesta', q.options[q.correct], a ? a.correct ? 'Correcta' : 'Incorrecta' : 'Sin respuesta', a?.points || 0, a ? (a.elapsedMs / 1000).toFixed(2) : '']);
  }));
  return '\uFEFF' + rows.map(r => r.map(quote).join(';')).join('\r\n');
}

export class PracticeGame {
  constructor() {
    this.game = { code: 'PRÁCTICA', status: 'lobby', index: -1, players: [{ id: 'practice', name: 'Tú', score: 0, correct: 0 }], answers: [] };
  }
  next() {
    if (this.game.index === questions.length - 1) this.game.status = 'finished';
    else { this.game.index++; this.game.status = 'question'; this.game.startedAt = Date.now(); this.game.deadline = Date.now() + questions[this.game.index].seconds * 1000; }
    return this.state();
  }
  answer(choice) {
    const g = this.game;
    if (g.status !== 'question') return this.state();
    if (Date.now() >= g.deadline) { g.status = 'reveal'; return this.state(); }
    const q = questions[g.index];
    const correct = choice === q.correct;
    const elapsedMs = Date.now() - g.startedAt;
    const points = pointsFor(correct, elapsedMs, q.seconds);
    g.answers.push({ playerId: 'practice', question: q.id, choice, correct, elapsedMs, points });
    g.players[0].score += points;
    g.players[0].correct += Number(correct);
    g.status = 'reveal';
    return this.state();
  }
  state() {
    if (this.game.status === 'question' && Date.now() >= this.game.deadline) this.game.status = 'reveal';
    return structuredClone(this.game);
  }
}
