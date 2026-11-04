import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LiveService } from '../js/live.js';
import { savedGames, saveSession } from '../js/storage.js';

test('a lost join response can be retried with the same identity', async () => {
  const memory = new Map(); const originalStorage = globalThis.localStorage, originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.localStorage = { getItem: key => memory.get(key) || null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  globalThis.fetch = async (_, request) => {
    const body = JSON.parse(request.body); calls.push(body);
    if (calls.length === 1) throw new TypeError('Connection lost after accepting join');
    return new Response(JSON.stringify({ token: body.p_token, playerId: 'student' }));
  };
  try {
    const service = new LiveService({ supabaseUrl: 'https://example.supabase.co', supabasePublishableKey: 'sb_publishable_example' });
    await assert.rejects(service.join('123456', 'María'), /Sin conexión/);
    const result = await service.join('123456', 'María');
    assert.equal(calls[0].p_token, calls[1].p_token);
    assert.equal(result.token, calls[0].p_token);
    assert.equal(memory.has('hola-quiz-join-request-123456'), false);
    saveSession({ code: '111111', token: 'host1', role: 'host' }, 'finished');
    saveSession({ code: '222222', token: 'host2', role: 'host' }, 'lobby');
    assert.equal(savedGames().length, 2);
    assert.equal(savedGames().find(g => g.code === '111111').status, 'finished');
  } finally { globalThis.localStorage = originalStorage; globalThis.fetch = originalFetch; }
});
