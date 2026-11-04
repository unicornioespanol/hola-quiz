// Local browser integration with real PostgreSQL functions (PGlite), no cloud account needed.
import { chromium } from 'playwright';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { questions } from '../js/questions.js';

const root = path.resolve(import.meta.dirname, '..');
const db = new PGlite();
await db.exec('create role anon; create role authenticated;');
await db.exec(await readFile(path.join(root, 'supabase/schema.sql'), 'utf8'));
await db.exec(await readFile(path.join(root, 'supabase/seed.sql'), 'utf8'));
const errors = [];
let origin;
const server = createServer(async (req, res) => {
  try {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (pathname.startsWith('/rest/v1/rpc/')) {
      let text = ''; for await (const chunk of req) text += chunk;
      const body = JSON.parse(text); const name = pathname.split('/').at(-1);
      if (!['quiz_create', 'quiz_join', 'quiz_state', 'quiz_action', 'quiz_answer'].includes(name)) throw new Error('Unknown RPC');
      const entries = Object.entries(body);
      if (entries.some(([key]) => !/^p_[a-z]+$/.test(key))) throw new Error('Bad parameter');
      try {
        const result = await db.transaction(async tx => {
          await tx.exec('set local role anon');
          return tx.query(`select public.${name}(${entries.map(([key], i) => `${key} => $${i + 1}`).join(',')}) as data`, entries.map(([, value]) => value));
        });
        res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(result.rows[0].data));
      } catch (error) { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ message: error.message })); }
      return;
    }
    if (pathname === '/config.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(`window.QUIZ_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabasePublishableKey:'sb_publishable_local_test'};`); return; }
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : decodeURIComponent(pathname)));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403); res.end(); return; }
    const data = await readFile(file); const ext = path.extname(file);
    res.writeHead(200, { 'Content-Type': ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' })[ext] || 'application/octet-stream' }); res.end(data);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
origin = `http://127.0.0.1:${server.address().port}`;
await mkdir(path.join(root, 'test-results'), { recursive: true });
let browser;
try {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const hostContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const p1Context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p2Context = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
  const host = await hostContext.newPage(), p1 = await p1Context.newPage(), p2 = await p2Context.newPage();
  for (const page of [host, p1, p2]) { page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message)); }
  const shot = (page, file) => page.screenshot({ path: path.join(root, 'test-results', file), fullPage: true, animations: 'disabled' });
  const noOverflow = async page => assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Horizontal overflow');
  await host.goto(origin); await host.getByRole('heading', { name: 'América Latina.' }).waitFor();
  await shot(host, '01-home-desktop.png');
  await p1.goto(origin); await noOverflow(p1); await shot(p1, '02-home-mobile.png');
  await host.getByRole('button', { name: 'Solo quiero practicar' }).click();
  console.log('Testing practice');
  for (const q of questions) {
    await host.locator(`[data-answer="${q.correct}"]`).click();
    await host.getByRole('button', { name: q.id === 9 ? 'Ver resultados' : 'Siguiente pregunta' }).click();
  }
  assert.equal(await host.locator('.personal-result p').innerText(), '10 de 10 respuestas correctas. ¡Gracias por viajar con nosotros!');
  await host.goto(origin);
  console.log('Testing live game');
  await host.getByRole('button', { name: 'Crear una partida' }).click();
  await host.locator('.room-code').waitFor();
  const code = (await host.locator('.room-code').innerText()).trim();
  await host.locator('#room-qr img').waitFor({ state: 'visible' });
  assert((await host.locator('#room-qr img').getAttribute('src')).startsWith('data:image/png;'));
  for (const [page, name] of [[p1, 'María'], [p2, 'Luz <b>']]) {
    await page.goto(`${origin}/?room=${code}`); await page.getByLabel('¿Cómo te llamas?').fill(name);
    await page.getByRole('button', { name: 'Entrar a la sala' }).click();
    await page.getByRole('heading', { name: `¡Hola, ${name}!` }).waitFor();
    await noOverflow(page);
  }
  await host.locator('#player-count').filter({ hasText: '2' }).waitFor();
  assert.equal(await host.locator('#player-chips b').count(), 0, 'Names must remain plain text');
  await shot(host, '03-lobby.png');
  await host.getByRole('button', { name: 'Empezar' }).click();
  for (const q of questions) {
    await p1.getByRole('heading', { name: q.text, exact: true }).waitFor();
    await p2.getByRole('heading', { name: q.text, exact: true }).waitFor();
    if (q.id === 0) { await noOverflow(p1); await shot(p1, '04-question-mobile.png'); }
    await p1.locator(`[data-answer="${q.correct}"]`).click();
    if (q.id === 0) {
      await p1.reload();
      await p1.getByText('Respuesta enviada. Esperando al grupo…').waitFor();
      assert(await p1.locator('[data-answer]').first().isDisabled(), 'Reload must preserve the accepted answer');
    }
    await p2.locator(`[data-answer="${(q.correct + 1) % 4}"]`).click();
    await host.getByRole('button', { name: q.id === 9 ? 'Ver resultados' : 'Siguiente pregunta' }).waitFor();
    if (q.id === 0) { await shot(host, '05-reveal-desktop.png'); }
    await host.getByRole('button', { name: q.id === 9 ? 'Ver resultados' : 'Siguiente pregunta' }).click();
  }
  await host.getByRole('heading', { name: '¡Qué bien nos lo pasamos!' }).waitFor();
  assert.equal(await host.locator('tbody tr').count(), 2);
  assert.match(await host.locator('tbody tr').first().innerText(), /María/);
  assert.equal(await host.locator('tbody tr').first().locator('td').nth(2).innerText(), '10 / 10');
  assert.match(await host.locator('.stats-grid').innerText(), /50%/);
  await shot(host, '06-results-desktop.png');
  await host.getByRole('button', { name: 'Ver respuestas de María' }).click();
  assert.equal(await host.locator('dialog[open] .detail-row').count(), 10);
  await host.locator('dialog[open]').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await host.getByRole('tab', { name: 'Pregunta a pregunta' }).click();
  assert.equal(await host.locator('.question-report').count(), 10);
  await host.locator('[data-question="0"]').click();
  assert.equal(await host.locator('dialog[open] .detail-row').count(), 5);
  assert.match(await host.locator('dialog[open]').innerText(), /María/);
  await host.locator('dialog[open]').getByRole('button', { name: 'Cerrar', exact: true }).click();
  await noOverflow(host);
  await p1.getByRole('heading', { name: '¡Qué bien nos lo pasamos!' }).waitFor();
  await p1.getByRole('tab', { name: 'Pregunta a pregunta' }).click();
  await noOverflow(p1); await shot(p1, '07-results-mobile.png');
  const downloadPromise = host.waitForEvent('download');
  await host.getByRole('button', { name: 'Descargar resultados' }).click();
  const download = await downloadPromise; await download.saveAs(path.join(root, 'test-results', 'results.csv'));
  assert.equal((await readFile(path.join(root, 'test-results/results.csv'), 'utf8')).split('\r\n').length, 21);
  await host.reload(); await host.getByRole('heading', { name: '¡Qué bien nos lo pasamos!' }).waitFor();
  await host.getByRole('button', { name: 'Crear otra partida' }).click();
  await host.locator('.room-code').waitFor();
  await host.getByRole('button', { name: 'Cerrar sala' }).click();
  await host.locator('dialog[open]').getByRole('button', { name: 'Cerrar sala', exact: true }).click();
  await host.getByRole('button', { name: 'Volver al inicio' }).click();
  await host.getByRole('button', { name: 'Mis partidas y resultados' }).click();
  await host.locator('.history-item').filter({ hasText: code }).click();
  await host.getByRole('heading', { name: '¡Qué bien nos lo pasamos!' }).waitFor();
  assert.equal(await host.locator('tbody tr').count(), 2);
  assert.deepEqual(errors, []);
  console.log('Browser QA passed: desktop + 390/360px phones, practice, 2-player live game, reload/rejoin, QR, all questions, rankings, analytics, CSV, restored final report.');
} finally {
  await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await db.close();
}
