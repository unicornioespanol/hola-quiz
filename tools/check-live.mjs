// Exercise the configured, real Supabase API. Creates one test room, closed on exit.
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { LiveService } from '../js/live.js';
import { questions } from '../js/questions.js';

const sandbox = { window: {} };
vm.runInNewContext(await readFile(new URL('../config.js', import.meta.url), 'utf8'), sandbox);
const config = sandbox.window.QUIZ_CONFIG;
if (!config?.supabaseUrl || !(config.supabasePublishableKey || config.supabaseAnonKey)) {
  console.error('Supabase is not configured. Connect the project before running check:live.'); process.exit(1);
}
const service = new LiveService(config);
let room;
try {
  room = await service.create();
  const host = { code: room.code, token: room.token };
  const a = await service.join(room.code, 'Prueba · A');
  const b = await service.join(room.code, 'Prueba · B');
  const studentA = { code: room.code, token: a.token };
  const studentB = { code: room.code, token: b.token };
  const initial = await service.state(host);
  assert.equal(initial.players.length, 2);
  await assert.rejects(service.action(studentA, 'next', -1), /sesión/);
  await service.action(host, 'next', -1);
  for (const q of questions) {
    await service.answer(studentA, q.id, q.correct);
    await service.answer(studentA, q.id, (q.correct + 1) % 4);
    const active = await service.state(studentA);
    assert.equal(active.status, 'question');
    assert.equal(active.myAnswer.correct, undefined);
    await service.answer(studentB, q.id, (q.correct + 1) % 4);
    assert.equal((await service.state(host)).status, 'reveal');
    await service.action(host, 'next', q.id);
  }
  const result = await service.state(host);
  assert.equal(result.status, 'finished');
  assert.equal(result.answers.length, 20);
  assert.equal(result.players.find(p => p.id === a.playerId).correct, 10);
  assert.equal(result.players.find(p => p.id === b.playerId).correct, 0);
  console.log('Real Supabase check passed: two participants, ten questions, host permissions, answer privacy, duplicate protection, final analytics.');
} finally {
  if (room) {
    await service.action({ code: room.code, token: room.token }, 'close', 9);
    console.log('The test room has been closed.');
  }
}
