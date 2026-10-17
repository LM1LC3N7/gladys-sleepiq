// -----------------------------------------------------------------------------
// The key shared by two callers at once (the polling and a command), the
// errors of the sign-in, the bamkey answers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SleepIQClient } from '../src/client.js';
import { PATHS } from '../src/constants.js';
import { SleepIQError, apiError, bamkeyText, loginError, parseRetryAfter } from '../src/sleepiq.js';
import { normalizeMemory } from '../src/store.js';
import { EMAIL, PASSWORD } from './fixtures/sleepiq.js';
import { fakeSleepIQ } from './helpers/fakeSleepIQ.js';

const client = (server, session = null) => {
  const c = new SleepIQClient({ transport: server.transport });
  c.configure({ email: EMAIL, password: PASSWORD, session });
  c.beginCycle();
  return c;
};

test('two callers without a key: one sign-in', async () => {
  const server = fakeSleepIQ();
  const c = client(server);
  const results = await Promise.all([c.ensureKey(), c.ensureKey()]);
  assert.deepEqual(results, [true, true]);
  assert.equal(server.logins().length, 1);
});

test('a joined sign-in that is refused gives its real error to both callers', async () => {
  const server = fakeSleepIQ();
  server.password = 'other';
  const c = client(server);
  const results = await Promise.allSettled([c.ensureKey(), c.ensureKey()]);
  assert.deepEqual(
    results.map((r) => r.reason?.kind),
    ['refused', 'refused'],
  );
  assert.equal(server.logins().length, 1);
});

test('one sign-in per cycle at most', async () => {
  const server = fakeSleepIQ();
  const c = client(server, { key: 'stale', at: 0 });
  await c.read(PATHS.familyStatus);
  assert.equal(server.logins().length, 1, 'the stale key was replaced once');
  server.revoke();
  await assert.rejects(c.read(PATHS.familyStatus), (err) => err.kind === 'not_signed_in');
  assert.equal(server.logins().length, 1, 'never a second one in the same cycle');
  c.beginCycle();
  await c.read(PATHS.familyStatus);
  assert.equal(server.logins().length, 2);
});

test('a 404 with a fresh key is a real 404, not a refused session', async () => {
  const server = fakeSleepIQ();
  const c = client(server);
  await assert.rejects(c.read('bed/nothing/here'), (err) => err.kind === 'not_found');
});

test('a secondary read never signs in', async () => {
  const server = fakeSleepIQ();
  const c = client(server);
  await assert.rejects(c.read(PATHS.beds, { secondary: true }), (err) => err.notSent);
  assert.equal(server.logins().length, 0);
});

test('the sign-in errors: 401 refused, 403 and other 4xx rejected, 429 and 5xx passing', () => {
  assert.equal(loginError({ status: 200 }), undefined);
  assert.equal(loginError({ status: 401 }).kind, 'refused');
  assert.equal(loginError({ status: 403 }).kind, 'login_rejected', 'User Agent is blocked');
  assert.equal(loginError({ status: 400 }).kind, 'login_rejected');
  assert.equal(loginError({ status: 503 }).kind, 'unavailable');
  const limited = loginError({ status: 429, headers: { 'retry-after': '120' } });
  assert.equal(limited.kind, 'rate_limited');
  assert.equal(limited.retryAfter, 120_000);
  assert.equal(apiError({ status: 404 }).kind, 'not_found');
  assert.equal(apiError({ status: 403 }).kind, 'forbidden');
  assert.equal(parseRetryAfter('Sat, 17 Oct 2026 12:01:00 GMT', Date.UTC(2026, 9, 17, 12)), 60_000);
});

test('bamkey answers: PASS stripped, FAIL is an error', () => {
  assert.equal(bamkeyText({ cdcResponse: 'PASS:off 0' }), 'off 0');
  assert.equal(bamkeyText({ cdcResponse: 'low 120' }), 'low 120');
  assert.equal(bamkeyText({}), '');
  assert.throws(
    () => bamkeyText({ cdcResponse: 'FAIL:unknown command' }),
    (err) => err instanceof SleepIQError && err.kind === 'bamkey_failed',
  );
});

test('a 404 that survives a fresh sign-in signs in no more for a while; a 401 still does', async () => {
  const server = fakeSleepIQ();
  let now = 0;
  const c = new SleepIQClient({ transport: server.transport, now: () => now });
  c.configure({ email: EMAIL, password: PASSWORD, session: { key: 'stale', at: 0 } });
  c.beginCycle();
  await assert.rejects(c.read('bed/nothing'), (err) => err.kind === 'not_found');
  assert.equal(server.logins().length, 1);
  c.beginCycle();
  await assert.rejects(c.read('bed/nothing'), (err) => err.kind === 'not_found');
  assert.equal(server.logins().length, 1, 'a real 404: no sign-in for it');
  server.revoke();
  await c.read(PATHS.familyStatus);
  assert.equal(server.logins().length, 2, 'a 401 still signs in');
  now += 7 * 3600_000;
  c.beginCycle();
  await assert.rejects(c.read('bed/nothing'));
  assert.equal(server.logins().length, 3, 'hours later, a 404 may be a stale key again');
});

test('the pauses read back from /data are bounded by their kind', () => {
  const now = 0;
  const far = 48 * 3600_000;
  assert.equal(
    normalizeMemory({ pause: { kind: 'rate', until: far } }, now).pause.until,
    6 * 3600_000,
  );
  assert.equal(
    normalizeMemory({ pause: { kind: 'forbidden', until: far } }, now).pause.until,
    3600_000,
  );
  assert.equal(normalizeMemory({ pause: { kind: 'other', until: far } }, now).pause, null);
  assert.equal(normalizeMemory({ pause: { kind: 'toString', until: far } }, now).pause, null);
});

test('only plain cookies are kept, bounded', () => {
  const c = new SleepIQClient();
  c.storeCookies({ 'set-cookie': ['A=1; Path=/', 'bad name=2', `B=${'x'.repeat(5000)}`] });
  assert.deepEqual([...c.cookies], [['A', '1']]);
});
