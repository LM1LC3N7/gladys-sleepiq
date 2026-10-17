// -----------------------------------------------------------------------------
// The network layer: the real transport against a loopback server (bounded
// body, timeout, cookies), and the reasons it logs (never a secret).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { SleepIQError, errorReason, httpRequest, networkError } from '../src/sleepiq.js';

async function server(handler) {
  const srv = createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${srv.address().port}`, close: () => srv.close() };
}

test('the transport: answers with their cookies, a bounded body, a timeout', async (t) => {
  const s = await server((req, res) => {
    if (req.url === '/big') {
      res.end('x'.repeat(2000));
    } else if (req.url === '/slow') {
      setTimeout(() => res.end('late'), 500);
    } else {
      res.writeHead(200, { 'set-cookie': ['A=1; Path=/', 'B=2'] });
      res.end('{"key":"k"}');
    }
  });
  t.after(() => s.close());
  let sent = false;
  const ok = await httpRequest(`${s.url}/`, { onSent: () => (sent = true) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body, '{"key":"k"}');
  assert.deepEqual(ok.headers['set-cookie'], ['A=1; Path=/', 'B=2']);
  assert.ok(sent);
  await assert.rejects(
    httpRequest(`${s.url}/big`, { maxBytes: 100 }),
    (err) => err.kind === 'size',
  );
  await assert.rejects(
    httpRequest(`${s.url}/slow`, { timeout: 50 }),
    (err) => err instanceof SleepIQError && err.kind === 'timeout' && !err.notSent,
  );
  const aborted = new AbortController();
  aborted.abort();
  let left = false;
  await assert.rejects(
    httpRequest(`${s.url}/`, { signal: aborted.signal, onSent: () => (left = true) }),
    (err) => err.kind === 'timeout' && err.notSent,
    'aborted before it left: never sent',
  );
  assert.equal(left, false);
  await assert.rejects(
    httpRequest('http://127.0.0.1:1/', { timeout: 2000 }),
    (err) => err.kind === 'network' && err.notSent,
  );
});

test('the reasons logged hold no secret', () => {
  assert.equal(errorReason(new Error('https://x/rest/bed?_k=secret')), 'internal error');
  assert.equal(
    errorReason(new SleepIQError('http', 'request failed', { status: 418 })),
    'request failed (HTTP 418)',
  );
  const err = networkError(
    Object.assign(new Error('connect ECONNREFUSED ?_k=secret'), { code: 'ECONNREFUSED' }),
  );
  assert.equal(err.message, 'connection refused');
  assert.equal(networkError({ code: 'weird code!' }).message, 'network error');
});
