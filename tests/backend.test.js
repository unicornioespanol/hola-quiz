import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

test('PostgreSQL: complete classroom game, authorization, deadlines and answer privacy', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated;');
    await db.exec(await readFile(new URL('../supabase/schema.sql', import.meta.url), 'utf8'));
    await db.exec(await readFile(new URL('../supabase/seed.sql', import.meta.url), 'utf8'));
    const rpc = async (name, args) => {
      const placeholders = args.map((_, i) => `$${i + 1}`).join(',');
      return (await db.query(`select public.${name}(${placeholders}) as data`, args)).rows[0].data;
    };
    const host = crypto.randomUUID(), token1 = crypto.randomUUID(), token2 = crypto.randomUUID();
    const room = await rpc('quiz_create', [host]);
    const code = room.code;
    assert.match(code, /^\d{6}$/);
    const p1 = await rpc('quiz_join', [code, 'María', token1]);
    assert.equal((await rpc('quiz_join', [code, 'María retry', token1])).playerId, p1.playerId);
    const p2 = await rpc('quiz_join', [code, '<img src=x>', token2]);
    await assert.rejects(rpc('quiz_join', [code, 'MARÍA', crypto.randomUUID()]), /NAME_TAKEN/);
    await assert.rejects(rpc('quiz_state', [code, crypto.randomUUID()]), /INVALID_SESSION/);
    await assert.rejects(rpc('quiz_action', [code, token1, 'next', -1]), /INVALID_SESSION/);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from quiz_private.rooms'), /permission denied/);
    await db.exec('reset role');
    const questions = JSON.parse(await readFile(new URL('../supabase/questions.json', import.meta.url), 'utf8'));
    await rpc('quiz_action', [code, host, 'next', -1]);
    await assert.rejects(rpc('quiz_join', [code, 'Late', crypto.randomUUID()]), /ROOM_STARTED/);
    for (const q of questions) {
      await rpc('quiz_answer', [code, token1, q.id, q.correct]);
      const hidden = await rpc('quiz_state', [code, token1]);
      assert.equal(hidden.status, 'question');
      assert.equal(hidden.myAnswer.choice, q.correct);
      assert.equal(hidden.myAnswer.correct, undefined);
      assert.equal(hidden.counts, null);
      assert.equal(hidden.answers.length, 0);
      // No correctness leaks through scores while the question is active.
      assert.equal(hidden.players.find(p => p.id === p1.playerId).correct, q.id);
      await rpc('quiz_answer', [code, token1, q.id, (q.correct + 1) % 4]);
      await rpc('quiz_answer', [code, token2, q.id, (q.correct + 1) % 4]);
      const reveal = await rpc('quiz_state', [code, token1]);
      assert.equal(reveal.status, 'reveal');
      assert.equal(reveal.myAnswer.correct, true);
      assert.equal(reveal.counts[q.correct], 1);
      assert.equal(reveal.players.find(p => p.id === p1.playerId).correct, q.id + 1);
      await rpc('quiz_action', [code, host, 'next', q.id]);
      await assert.rejects(rpc('quiz_action', [code, host, 'next', q.id]), /INVALID_ACTION/);
    }
    const final = await rpc('quiz_state', [code, host]);
    assert.equal(final.status, 'finished');
    assert.equal(final.answers.length, 20);
    assert.equal(final.players.find(p => p.id === p1.playerId).correct, 10);
    assert.equal(final.players.find(p => p.id === p2.playerId).score, 0);
    assert(!JSON.stringify(final).includes(token1));
    assert(!JSON.stringify(final).includes(host));

    const room2 = await rpc('quiz_create', [crypto.randomUUID()]);
    const lateToken = crypto.randomUUID();
    await rpc('quiz_join', [room2.code, 'Tiempo', lateToken]);
    await rpc('quiz_action', [room2.code, room2.token, 'next', -1]);
    await db.query("update quiz_private.rooms set deadline=now()-interval '1 second' where code=$1", [room2.code]);
    await assert.rejects(rpc('quiz_answer', [room2.code, lateToken, 0, 1]), /TOO_LATE/);
    assert.equal((await rpc('quiz_state', [room2.code, lateToken])).status, 'reveal');
    await rpc('quiz_action', [room2.code, room2.token, 'close', 0]);
    assert.equal((await rpc('quiz_state', [room2.code, lateToken])).status, 'closed');
    // Exposed RPCs remain callable with the browser's anonymous role.
    await db.exec('set role anon');
    assert.equal((await rpc('quiz_state', [code, host])).status, 'finished');
    await db.exec('reset role');
  } finally { await db.close(); }
});
