import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsFor, PracticeGame, csvReport, summarize } from '../js/game.js';
import { questions } from '../js/questions.js';

test('speed scoring stays between 500 and 1000 for correct responses', () => {
  assert.equal(pointsFor(true, 0), 1000);
  assert.equal(pointsFor(true, 10000), 750);
  assert.equal(pointsFor(true, 20000), 500);
  assert.equal(pointsFor(false, 1), 0);
});
test('practice completes ten questions without counting duplicate answers', () => {
  const game = new PracticeGame();
  game.next();
  for (const q of questions) {
    game.answer(q.correct);
    game.answer(q.correct);
    game.next();
  }
  const state = game.state();
  assert.equal(state.status, 'finished');
  assert.equal(state.answers.length, 10);
  assert.equal(state.players[0].correct, 10);
  assert.equal(summarize(state).accuracy, 100);
});
test('missing answers remain in the accuracy denominator and CSV', () => {
  const g = { players: [{ id: 'p', name: '=SUM(1;2)', score: 0, correct: 0 }], answers: [] };
  assert.equal(summarize(g).accuracy, 0);
  const csv = csvReport(g);
  assert.equal(csv.split('\r\n').length, 11);
  assert.match(csv, /"'=SUM\(1;2\)"/);
  assert.match(csv, /Sin respuesta/);
});
