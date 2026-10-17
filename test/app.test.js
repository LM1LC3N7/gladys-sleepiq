// -----------------------------------------------------------------------------
// End to end: the real SDK wiring (src/handlers.js) against the SDK's fake
// Gladys and a fake SleepIQ API behind the transport. Timers and Date are
// mocked: the tests move the clock.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { SleepIQApp } from '../src/app.js';
import { accountKey } from '../src/config.js';
import { ACTIONS, TIMINGS } from '../src/constants.js';
import { registerHandlers } from '../src/handlers.js';
import {
  BED,
  EMAIL,
  FUZION_BED,
  HOUR,
  MINUTE,
  NOW,
  PASSWORD,
  bed,
  fuzionBed,
} from './fixtures/sleepiq.js';
import { fakeSleepIQ, memoryStore, settle } from './helpers/fakeSleepIQ.js';

const MANIFEST = JSON.parse(
  readFileSync(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const CONFIG = { email: EMAIL, password: PASSWORD };
const COMMANDS_ON = { ...CONFIG, allow_commands: true };
const ACCOUNT = accountKey(EMAIL);
const BED_DEVICE = `ext:test-integration:bed:${BED}`;
const LEFT = `ext:test-integration:side:${BED}:left`;
const RIGHT = `ext:test-integration:side:${BED}:right`;
const feature = (device, role) => `${device}:${role}`;

async function setup(
  t,
  {
    config = CONFIG,
    store = memoryStore(),
    server = fakeSleepIQ(),
    now = NOW,
    create = true,
    logs = [],
  } = {},
) {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval', 'Date'], now });
  const gladys = createFakeGladys({ config });
  const app = new SleepIQApp({
    gladys,
    logger: recorder(logs),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(gladys, app);
  await gladys.connect();
  await settle();
  t.after(() => app.stop());
  const advance = async (ms, step = 10_000) => {
    for (let elapsed = 0; elapsed < ms; elapsed += step) {
      t.mock.timers.tick(Math.min(step, ms - elapsed));
      await settle();
    }
  };
  if (create) {
    for (const device of gladys.fake.discoveredDevices) {
      await gladys.fake.deviceCreated(device);
    }
    await settle();
  }
  return { gladys, app, server, store, advance, logs };
}

/** A logger keeping every line, to check that no secret ever reaches the logs. */
const recorder = (logs) =>
  Object.fromEntries(
    ['debug', 'info', 'warn', 'error'].map((level) => [
      level,
      (...args) => logs.push(args.map((a) => (a instanceof Error ? a.stack : String(a))).join(' ')),
    ]),
  );

const last = (gladys, id) => gladys.fake.lastState(id);
const message = (gladys) => gladys.fake.connectionStatus?.message ?? {};
const deviceOf = (gladys, id) => gladys.fake.discoveredDevices.find((d) => d.external_id === id);
const created = (gladys, id) => gladys.fake.devices.find((d) => d.external_id === id);
const featureOf = (gladys, device, role) =>
  created(gladys, device).features.find((f) => f.external_id === feature(device, role));
const set = (gladys, device, role, value) =>
  gladys.fake.setValue(created(gladys, device), featureOf(gladys, device, role), value);
const roles = (device) =>
  device.features.map((f) => [
    f.external_id.slice(device.external_id.length + 1),
    f.category,
    f.type,
    f.read_only,
  ]);

test('without credentials, the status asks for them and nothing is requested', async (t) => {
  const { gladys, server } = await setup(t, { config: { email: EMAIL } });
  assert.equal(server.requests.length, 0);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /e-mail and the password/);
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.fr, /mot de passe/);
  assert.equal(server.requests.length, 0);
});

test('one sign-in, the beds, the presence, the parts and the score: devices, states, status', async (t) => {
  const logs = [];
  const { gladys, server, store } = await setup(t, { logs });
  assert.equal(server.logins().length, 1);
  const [login] = server.logins();
  assert.deepEqual(login.json, { login: EMAIL, password: PASSWORD });
  assert.equal(login.method, 'PUT');
  const call = server.of('/rest/bed/familyStatus')[0];
  assert.equal(call.key, 'key-1-secret', 'the key goes in `_k`');
  assert.match(call.headers['User-Agent'], /^Mozilla\/5\.0/);
  assert.equal(call.headers['Accept-Version'], '5.3.30');
  assert.match(call.headers.Cookie, /AWSALB=lb1/, 'the cookies of the sign-in are sent back');

  const saved = JSON.stringify(store.data);
  assert.ok(!saved.includes(PASSWORD), 'the password never reaches /data');
  assert.ok(!saved.includes(EMAIL), 'nor the e-mail');
  assert.equal(store.data.session.account, ACCOUNT);
  assert.equal(store.data.session.key, 'key-1-secret');

  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.deepEqual(ids, [BED_DEVICE, LEFT, RIGHT]);
  assert.equal(deviceOf(gladys, LEFT).name, 'Master bed – côté gauche (Ann)');
  assert.equal(deviceOf(gladys, BED_DEVICE).model, 'P6');
  assert.deepEqual(roles(deviceOf(gladys, BED_DEVICE)), [
    ['occupied', 'motion-sensor', 'binary', true],
  ]);
  assert.deepEqual(roles(deviceOf(gladys, LEFT)), [
    ['in-bed', 'motion-sensor', 'binary', true],
    ['firmness', 'unknown', 'integer', true],
    ['set-firmness', 'text', 'select', false],
    ['pressure', 'unknown', 'integer', true],
    ['sleep-score', 'unknown', 'integer', true],
    ['head-position', 'unknown', 'integer', true],
    ['foot-position', 'unknown', 'integer', true],
    ['foundation-preset', 'text', 'text', true],
    ['set-foundation-preset', 'text', 'select', false],
    ['stop-foundation', 'button', 'push', false],
    ['night-light', 'light', 'binary', false],
    ['foot-warming', 'text', 'text', true],
  ]);
  for (const device of gladys.fake.discoveredDevices) {
    for (const f of device.features) {
      assert.equal(f.unit, undefined, `${f.external_id}: no unit`);
    }
  }
  const firmness = featureOf(gladys, LEFT, 'set-firmness');
  assert.deepEqual(
    firmness.supported_options.map((o) => o.value),
    Array.from({ length: 20 }, (_, i) => String(5 + i * 5)),
  );

  assert.equal(last(gladys, feature(BED_DEVICE, 'occupied')), 0);
  assert.equal(last(gladys, feature(LEFT, 'in-bed')), 0);
  assert.equal(last(gladys, feature(LEFT, 'firmness')), 40);
  assert.equal(last(gladys, feature(LEFT, 'set-firmness')), '40');
  assert.equal(last(gladys, feature(RIGHT, 'firmness')), 55);
  assert.equal(last(gladys, feature(RIGHT, 'pressure')), 1500);
  assert.equal(last(gladys, feature(LEFT, 'sleep-score')), 82);
  assert.equal(last(gladys, feature(RIGHT, 'head-position')), 30, 'hex 1e');
  assert.equal(last(gladys, feature(LEFT, 'foundation-preset')), 'À plat');
  assert.equal(last(gladys, feature(LEFT, 'set-foundation-preset')), 'flat');
  assert.equal(last(gladys, feature(RIGHT, 'foundation-preset')), 'Hors position enregistrée');
  assert.equal(last(gladys, feature(RIGHT, 'night-light')), 0, 'outlet 3 is the right side');
  assert.equal(last(gladys, feature(LEFT, 'night-light')), 1, 'outlet 4 is the left side');
  assert.equal(last(gladys, feature(RIGHT, 'foot-warming')), 'Faible');

  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.match(message(gladys).en, /1 bed/);
  assert.deepEqual(
    [...new Set(gladys.fake.transports.map((e) => e.transport))],
    [DEVICE_TRANSPORTS.CLOUD],
  );
  const text = logs.join('\n');
  for (const secret of [PASSWORD, ...server.secrets]) {
    assert.ok(!text.includes(secret), 'no secret in the logs');
  }
  assert.ok(!text.includes(EMAIL), 'nor the e-mail');
  assert.equal(server.of('/rest/bed/-9223372019941084149/foundation/outlet').length, 4);
});

test('the key is reused at every cycle, and after a restart', async (t) => {
  const store = memoryStore();
  const server = fakeSleepIQ();
  const { advance, app } = await setup(t, { store, server });
  await advance(10 * MINUTE);
  assert.equal(server.logins().length, 1, 'no sign-in per cycle');
  assert.ok(server.of('/rest/bed/familyStatus').length >= 10, 'presence every minute');
  assert.equal(server.of('/rest/bed/-9223372019941084149/foundation/status').length, 3, '5 min');
  app.stop();
  const again = createFakeGladys({ config: CONFIG });
  const next = new SleepIQApp({
    gladys: again,
    logger: recorder([]),
    transport: server.transport,
    now: () => Date.now(),
    store,
  });
  registerHandlers(again, next);
  await again.connect();
  await settle();
  t.after(() => next.stop());
  assert.equal(server.logins().length, 1, 'the stored key is used after a restart');
  assert.equal(again.fake.connectionStatus.connected, true);
});

test('a refused key signs in once and retries; refused right after, the session stops (1 h)', async (t) => {
  const store = memoryStore();
  const { gladys, server, advance } = await setup(t, { store });
  server.revoke();
  await advance(MINUTE);
  assert.equal(server.logins().length, 2, 'one new sign-in');
  assert.equal(gladys.fake.connectionStatus.connected, true);

  // Now every key is refused, even a fresh one.
  server.queue.push(
    { match: (r) => r.path === '/rest/bed/familyStatus', status: 401, body: {} },
    { match: (r) => r.path === '/rest/bed/familyStatus', status: 401, body: {} },
  );
  await advance(MINUTE);
  assert.equal(server.logins().length, 3);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /refused the session again/);
  assert.equal(store.data.block.kind, 'session_refused');
  const before = server.requests.length;
  await advance(50 * MINUTE);
  assert.equal(server.requests.length, before, 'nothing during the stop');
  await advance(15 * MINUTE);
  assert.ok(server.requests.length > before, 'one new try after 1 h');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.block, null);
});

test('a refused password stops, tries again after 6 h, and new credentials lift the stop', async (t) => {
  const server = fakeSleepIQ();
  server.password = 'other';
  const store = memoryStore();
  const { gladys, advance } = await setup(t, { server, store });
  assert.equal(server.logins().length, 1);
  assert.match(message(gladys).fr, /a refusé l'e-mail ou le mot de passe/);
  assert.equal(store.data.block.kind, 'refused');
  await advance(5 * HOUR, MINUTE);
  assert.equal(server.logins().length, 1, 'never signed in again in a loop');
  await advance(HOUR + MINUTE, MINUTE);
  assert.equal(server.logins().length, 2, 'one new try after 6 h');
  assert.match(message(gladys).en, /24 h/);
  await gladys.fake.configUpdated({ ...CONFIG, password: 'other' });
  await settle();
  assert.equal(server.logins().length, 3, 'new credentials are tried at once');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(store.data.block, null);
});

test('a 429 pauses every path (Retry-After bounded), survives a restart and a Gladys reconnection', async (t) => {
  const store = memoryStore();
  const { gladys, server, advance, app } = await setup(t, { store });
  server.queue.push({
    match: (r) => r.path === '/rest/bed/familyStatus',
    status: 429,
    headers: { 'retry-after': '1' },
  });
  await advance(MINUTE);
  assert.match(message(gladys).en, /slow down: pausing for 1 min/, 'bounded to 1 minute at least');
  assert.equal(gladys.fake.connectionStatus.connected, true, 'still connected, only slowed');
  assert.ok(store.data.pause.until > Date.now());
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /slow down/, 'the button waits too');
  const before = server.requests.length;
  await app.connected(CONFIG);
  await settle();
  assert.equal(server.requests.length, before, 'a reconnection reads nothing during the pause');
  await advance(MINUTE, 10_000);
  assert.ok(server.requests.length > before, 'read again after the pause');

  server.queue.push({ match: (r) => r.path === '/rest/bed/familyStatus', status: 429 });
  await advance(2 * MINUTE);
  assert.match(message(gladys).en, /15 min/, '15 minutes without Retry-After');
  server.queue.push({
    match: (r) => r.path === '/rest/bed/familyStatus',
    status: 429,
    headers: { 'retry-after': String(48 * 3600) },
  });
  await advance(16 * MINUTE, MINUTE);
  assert.match(message(gladys).en, /6 h/, 'bounded to 6 hours at most');
});

test('a 429 of a secondary read pauses every path too, after the presence is shown', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.queue.push({
    match: (r) => r.path.endsWith('/foundation/status'),
    status: 429,
    headers: { 'retry-after': '600' },
  });
  await advance(5 * MINUTE);
  assert.match(message(gladys).en, /slow down: pausing for 10 min/);
  const before = server.requests.length;
  await advance(9 * MINUTE);
  assert.equal(server.requests.length, before);
});

test('a failing secondary endpoint never blocks the presence, and is not read again before 5 min', async (t) => {
  const { gladys, server, advance } = await setup(t);
  for (let i = 0; i < 3; i += 1) {
    server.queue.push({ match: (r) => r.path.endsWith('/foundation/status'), status: 500 });
  }
  server.sides[`${BED}:left`] = { isInBed: true };
  await advance(5 * MINUTE);
  assert.equal(last(gladys, feature(LEFT, 'in-bed')), 1);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  const reads = server.of('/rest/bed/-9223372019941084149/foundation/status').length;
  await advance(4 * MINUTE);
  assert.equal(server.of('/rest/bed/-9223372019941084149/foundation/status').length, reads);
});

test('network errors back off (2, 5, 10 min…) and the badge turns unreachable', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.down = true;
  await advance(MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.match(message(gladys).en, /cannot be reached \(connection refused\)\. Next try in 2 min/);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.UNREACHABLE);
  const before = server.requests.length;
  await advance(MINUTE);
  assert.equal(server.requests.length, before, 'never read again sooner than the backoff');
  await advance(MINUTE);
  assert.match(message(gladys).en, /5 min/);
  server.down = false;
  await advance(5 * MINUTE);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.transports.at(-1).transport, DEVICE_TRANSPORTS.CLOUD);
});

test('in bed and out of bed fire scene triggers per side, never at the first reading', async (t) => {
  const server = fakeSleepIQ();
  server.sides[`${BED}:right`] = { isInBed: true };
  const { gladys, advance } = await setup(t, { server });
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the state found at start is no event');
  assert.equal(last(gladys, feature(BED_DEVICE, 'occupied')), 1);

  server.sides[`${BED}:left`] = { isInBed: true };
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 1);
  const [event] = gladys.fake.sceneEvents;
  assert.equal(event.key, 'in_bed');
  assert.deepEqual(
    { ...event.data, at: undefined },
    {
      bed_device: BED_DEVICE,
      side_device: LEFT,
      side: 'left',
      bed_name: 'Master bed',
      side_name: 'Master bed – côté gauche (Ann)',
      sleeper_name: 'Ann',
      at: undefined,
    },
  );
  assert.equal(event.data.at, new Date(Date.now()).toISOString());
  const declared = MANIFEST.scene_triggers.find((s) => s.key === 'in_bed');
  assert.deepEqual(
    Object.keys(event.data).sort(),
    [...declared.fields, ...declared.variables].map((f) => f.key).sort(),
    'exactly the keys the manifest declares',
  );

  server.sides[`${BED}:right`] = { isInBed: false };
  await advance(MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => [e.key, e.data.side]),
    [
      ['in_bed', 'left'],
      ['out_of_bed', 'right'],
    ],
  );
  await advance(3 * MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 2, 'no change, no event');

  // An unknown value fires nothing and keeps the last reading.
  server.sides[`${BED}:left`] = { isInBed: 'maybe' };
  await advance(MINUTE);
  server.sides[`${BED}:left`] = { isInBed: true };
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 2);
});

test('a change seen after an outage is history: no scene trigger', async (t) => {
  const { gladys, server, advance } = await setup(t);
  server.down = true;
  await advance(10 * MINUTE);
  server.down = false;
  server.sides[`${BED}:left`] = { isInBed: true };
  await advance(20 * MINUTE);
  assert.equal(last(gladys, feature(LEFT, 'in-bed')), 1, 'the state is shown');
  assert.equal(gladys.fake.sceneEvents.length, 0, 'but fires nothing');
});

test('commands are refused while not allowed, read-only features always', async (t) => {
  const { gladys, server } = await setup(t);
  const puts = server.commands().length;
  const ack = await set(gladys, LEFT, 'set-firmness', '50');
  assert.equal(ack.success, false);
  assert.match(ack.error, /commandes sont désactivées/);
  const light = await set(gladys, LEFT, 'night-light', 0);
  assert.match(light.error, /désactivées/);
  const readOnly = await set(gladys, LEFT, 'firmness', 50);
  assert.match(readOnly.error, /lecture seule/);
  assert.equal(server.commands().length, puts);
});

test('firmness: a fresh read, then one PUT; 5 to 100 by 5 only; nothing when already so', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: COMMANDS_ON });
  const reads = server.of('/rest/bed/familyStatus').length;
  const ack = await set(gladys, LEFT, 'set-firmness', '50');
  assert.equal(ack.success, true, ack.error);
  assert.equal(server.of('/rest/bed/familyStatus').length, reads + 1, 'read just before');
  const [put] = server.commands();
  assert.equal(put.path, `/rest/bed/${BED}/sleepNumber`);
  assert.deepEqual(put.json, { sleepNumber: 50, side: 'L' });

  for (const value of ['42', '0', '105', 'abc']) {
    const bad = await set(gladys, LEFT, 'set-firmness', value);
    assert.match(bad.error, /5 à 100/);
  }
  const same = await set(gladys, RIGHT, 'set-firmness', '55');
  assert.equal(same.success, true);
  assert.equal(server.commands().length, 1, 'already 55: nothing sent');
  await advance(TIMINGS.refreshAfterCommand);
  assert.ok(server.of('/rest/bed/familyStatus').length > reads + 2, 'read again after');
});

test('foundation preset, stop and night light: read, decide, send once', async (t) => {
  const { gladys, server } = await setup(t, { config: COMMANDS_ON });
  const preset = await set(gladys, RIGHT, 'set-foundation-preset', 'zero_g');
  assert.equal(preset.success, true, preset.error);
  assert.deepEqual(server.commands().at(-1).json, { preset: 5, side: 'R', speed: 0 });
  const already = await set(gladys, LEFT, 'set-foundation-preset', 'flat');
  assert.equal(already.success, true);
  assert.equal(server.commands().length, 1, 'already flat');
  const invalid = await set(gladys, LEFT, 'set-foundation-preset', 'massage');
  assert.match(invalid.error, /Valeur invalide/);

  const stop = await set(gladys, LEFT, 'stop-foundation', 1);
  assert.equal(stop.success, true);
  assert.equal(server.commands().at(-1).path, `/rest/bed/${BED}/foundation/motion`);
  assert.deepEqual(server.commands().at(-1).json, {
    footMotion: 1,
    headMotion: 1,
    massageMotion: 1,
    side: 'L',
  });

  const light = await set(gladys, RIGHT, 'night-light', 1);
  assert.equal(light.success, true);
  assert.deepEqual(server.commands().at(-1).json, { outletId: 3, setting: 1 });
  const same = await set(gladys, LEFT, 'night-light', 1);
  assert.equal(same.success, true);
  assert.equal(server.commands().length, 3, 'the left light is already on');
});

test('a command whose state cannot be read is not sent', async (t) => {
  const { gladys, server } = await setup(t, { config: COMMANDS_ON });
  server.queue.push({ match: (r) => r.path.endsWith('/foundation/status'), status: 500 });
  const ack = await set(gladys, LEFT, 'set-foundation-preset', 'read');
  assert.match(ack.error, /n'a pas pu être lu/);
  assert.equal(server.commands().length, 0);
});

test('a slow command is answered within 5 s, one at a time', async (t) => {
  const { gladys, server, advance } = await setup(t, { config: COMMANDS_ON });
  let release;
  server.queue.push({
    match: (r) => r.method === 'PUT' && r.path.endsWith('/sleepNumber'),
    wait: new Promise((resolve) => {
      release = resolve;
    }),
    status: 200,
    body: {},
  });
  const pending = set(gladys, LEFT, 'set-firmness', '60');
  await settle();
  t.mock.timers.tick(TIMINGS.commandAck);
  await settle();
  const ack = await pending;
  assert.equal(ack.success, true, 'answered at 4.3 s, the request still running');
  // The next one waits in line; past its own deadline it is refused unsent.
  const queued = set(gladys, RIGHT, 'set-firmness', '60');
  await settle();
  t.mock.timers.tick(TIMINGS.commandSendBy);
  await settle();
  assert.match((await queued).error, /précédente a pris trop de temps/);
  assert.equal(server.commands().length, 1);
  // The stop never waits in line.
  const stop = await set(gladys, LEFT, 'stop-foundation', 1);
  assert.equal(stop.success, true, stop.error);
  release();
  await settle();
  await advance(TIMINGS.refreshAfterCommand);
  const next = await set(gladys, RIGHT, 'set-firmness', '60');
  assert.equal(next.success, true, next.error);
});

test('two commands at once: the second waits for the first, then goes', async (t) => {
  const { gladys, server } = await setup(t, { config: COMMANDS_ON });
  const [a, b] = await Promise.all([
    set(gladys, LEFT, 'night-light', 0),
    set(gladys, RIGHT, 'night-light', 1),
  ]);
  assert.equal(a.success, true, a.error);
  assert.equal(b.success, true, b.error);
  assert.deepEqual(
    server.commands().map((c) => c.json),
    [
      { outletId: 4, setting: 0 },
      { outletId: 3, setting: 1 },
    ],
  );
});

test('a command never signs in nor drops the key', async (t) => {
  const { gladys, server, app } = await setup(t, { config: COMMANDS_ON });
  server.revoke();
  const ack = await set(gladys, LEFT, 'set-firmness', '50');
  assert.match(ack.error, /n'a pas pu être lu/);
  assert.equal(server.logins().length, 1, 'no sign-in from a command');
  assert.ok(app.client.session, 'the key is kept: the next main read decides');
  app.client.session = null;
  const none = await set(gladys, LEFT, 'set-firmness', '50');
  assert.match(none.error, /Pas connecté/);
  assert.equal(server.logins().length, 1);
  assert.equal(server.commands().length, 0);
});

test('a scene event Gladys cannot take within 5 min is dropped, not delivered late', async (t) => {
  const { gladys, server, advance } = await setup(t);
  const publish = gladys.publishSceneEvent.bind(gladys);
  let gladysDown = true;
  gladys.publishSceneEvent = async (...args) => {
    if (gladysDown) {
      throw Object.assign(new Error('Gladys unreachable'), { status: 503 });
    }
    return publish(...args);
  };
  server.sides[`${BED}:left`] = { isInBed: true };
  await advance(MINUTE);
  await advance(10 * MINUTE);
  gladysDown = false;
  await advance(MINUTE);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'too late: dropped');
  server.sides[`${BED}:left`] = { isInBed: false };
  await advance(MINUTE);
  assert.deepEqual(
    gladys.fake.sceneEvents.map((e) => e.key),
    ['out_of_bed'],
  );
});

test('a 401 or 403 of a probe never hides a bed; two 404 in a row do', async (t) => {
  const { gladys, server, app, advance } = await setup(t);
  const pause = `/rest/bed/${BED}/pauseMode`;
  server.queue.push({ match: (r) => r.path === pause, status: 403 });
  await advance(TIMINGS.inventoryInterval, 5 * MINUTE);
  assert.equal(app.beds.length, 1, 'a 403: the bed stays');
  assert.equal(app.beds[0].probed, false, 'probed again later');
  await advance(5 * MINUTE, MINUTE);
  assert.equal(app.beds[0].probed, true);
  // One 404: kept and probed again; a second 404 in a row: gone.
  server.queue.push({ match: (r) => r.path === pause, status: 404 });
  await advance(TIMINGS.inventoryInterval + 10 * MINUTE, 5 * MINUTE);
  assert.equal(server.queue.length, 0);
  assert.equal(app.beds.length, 1, 'one 404 then an answer: kept');
  assert.equal(app.beds[0].notFound, 0);
  server.queue.push(
    { match: (r) => r.path === pause, status: 404 },
    { match: (r) => r.path === pause, status: 404 },
  );
  await advance(TIMINGS.inventoryInterval + 10 * MINUTE, 5 * MINUTE);
  assert.equal(server.queue.length, 0, 'probed again');
  assert.equal(app.beds.length, 0, 'two 404 in a row');
  assert.ok(gladys.fake.discoveredDevices.length === 0);
});

test('a bed list without beds is an error; a bed missing once stays; no bed: read again in 5 min', async (t) => {
  const server = fakeSleepIQ();
  const { app, advance } = await setup(t, { server });
  server.queue.push({ match: (r) => r.path === '/rest/bed', status: 200, body: {} });
  await advance(TIMINGS.inventoryInterval, 5 * MINUTE);
  assert.equal(app.beds.length, 1, 'an answer without its list changes nothing');
  const saved = server.beds;
  server.beds = [];
  await advance(TIMINGS.inventoryInterval, 5 * MINUTE);
  assert.equal(app.beds.length, 1, 'missing from one list: kept');
  await advance(TIMINGS.inventoryInterval, 5 * MINUTE);
  assert.equal(app.beds.length, 0, 'missing twice: gone');
  const reads = server.of('/rest/bed', 'GET').length;
  server.beds = saved;
  await advance(5 * MINUTE, MINUTE);
  assert.equal(server.of('/rest/bed', 'GET').length, reads + 1, 'no bed: read again after 5 min');
  assert.equal(app.beds.length, 1);
});

test('right after a refused password, the test button waits a few minutes', async (t) => {
  const server = fakeSleepIQ();
  server.password = 'other';
  const { gladys, advance } = await setup(t, { server });
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(ack.data.message.en, /wait 5 min/);
  assert.equal(server.logins().length, 1);
  await advance(5 * MINUTE, MINUTE);
  await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(server.logins().length, 2, 'then one try per click');
});

test('a Gladys reconnection republishes the devices, the status and the states', async (t) => {
  const { gladys, app } = await setup(t);
  const published = () => gladys.fake.bodies('POST', '/discovered_device').length;
  const devices = published();
  const statuses = gladys.fake.connectionStatuses.length;
  await app.connected(CONFIG);
  await settle();
  assert.equal(published(), devices + 1, 'Discovery republished');
  assert.equal(gladys.fake.connectionStatuses.length, statuses + 1, 'status republished');
  assert.equal(gladys.fake.connectionStatus.connected, true);
});

test('a republished device never loses a feature of the created one', async (t) => {
  const { gladys, server, advance, app } = await setup(t);
  // The lights disappear from the account (or their probe fails): the
  // created device keeps its night-light feature.
  server.outlets[BED] = {};
  await advance(TIMINGS.inventoryInterval, 5 * MINUTE);
  await app.scan();
  assert.deepEqual(app.beds[0].parts.lights, [], 'probed again: no light any more');
  const left = deviceOf(gladys, LEFT);
  assert.ok(left.features.some((f) => f.external_id === feature(LEFT, 'night-light')));
  assert.deepEqual(
    left.features.map((f) => f.external_id).sort(),
    created(gladys, LEFT)
      .features.map((f) => f.external_id)
      .sort(),
  );
  assert.deepEqual(
    left.features.find((f) => f.external_id === feature(LEFT, 'night-light')),
    created(gladys, LEFT).features.find((f) => f.external_id === feature(LEFT, 'night-light')),
    'published again as it was created',
  );
});

test('the test button reads once, summarizes, and waits 30 s', async (t) => {
  const server = fakeSleepIQ();
  server.sides[`${BED}:right`] = { isInBed: true };
  const { gladys } = await setup(t, { server });
  const ack = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.equal(ack.data.message.en, 'Master bed: in bed on the right side.');
  assert.equal(ack.data.message.fr, 'Master bed : au lit côté droit.');
  const again = await gladys.fake.action(ACTIONS.TEST_CONNECTION);
  assert.match(again.data.message.en, /less than 30 seconds/);
});

test('a fuzion bed: bamkey probes and reads, firmness by bamkey', async (t) => {
  const server = fakeSleepIQ({ beds: [fuzionBed()] });
  const { gladys, advance } = await setup(t, { server, config: COMMANDS_ON });
  const FB = `ext:test-integration:bed:${FUZION_BED}`;
  const FL = `ext:test-integration:side:${FUZION_BED}:left`;
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [FB, FL],
    'no device for the right side: nobody sleeps there',
  );
  assert.deepEqual(roles(deviceOf(gladys, FB)), [
    ['occupied', 'motion-sensor', 'binary', true],
    ['night-light', 'light', 'binary', false],
  ]);
  assert.deepEqual(
    roles(deviceOf(gladys, FL)).map(([role]) => role),
    [
      'in-bed',
      'firmness',
      'set-firmness',
      'pressure',
      'sleep-score',
      'head-position',
      'foot-position',
      'foundation-preset',
      'set-foundation-preset',
      'stop-foundation',
      'foot-warming',
      'climate',
    ],
  );
  assert.deepEqual(
    featureOf(gladys, FL, 'set-foundation-preset').supported_options.map((o) => o.value),
    ['flat', 'favorite', 'zero_g'],
  );
  assert.equal(last(gladys, feature(FL, 'firmness')), 45, 'the bamkey value');
  assert.equal(last(gladys, feature(FL, 'head-position')), 15);
  assert.equal(last(gladys, feature(FL, 'foundation-preset')), 'Favorite');
  assert.equal(last(gladys, feature(FL, 'foot-warming')), 'Moyen');
  assert.equal(last(gladys, feature(FL, 'climate')), 'Refroidissement faible');
  assert.equal(last(gladys, feature(FB, 'night-light')), 0);

  const ack = await set(gladys, FL, 'set-firmness', '50');
  assert.equal(ack.success, true, ack.error);
  const [command] = server.commands();
  assert.deepEqual(command.json, {
    args: 'left 50',
    key: 'PSNS',
    sourceApplication: 'Gladys SleepIQ',
  });
  server.bamkeys.GET_SLEEP_NUMBER_CONTROLS = 'true 30 45';
  await advance(TIMINGS.refreshAfterCommand);
  const busy = await set(gladys, FL, 'set-firmness', '60');
  assert.match(busy.error, /déjà en train/);
  const light = await set(gladys, FB, 'night-light', 1);
  assert.equal(light.success, true, light.error);
  assert.deepEqual(server.commands().at(-1).json.args, 'high 0');
});

test('a bed that does not answer its pause mode is skipped (asyncsleepiq valid())', async (t) => {
  const server = fakeSleepIQ({ beds: [bed(), bed({ bedId: '123', name: 'Ghost' })] });
  server.queue.push({ match: (r) => r.path === '/rest/bed/123/pauseMode', status: 404 });
  const { gladys } = await setup(t, { server });
  assert.ok(!gladys.fake.discoveredDevices.some((d) => d.name.startsWith('Ghost')));
  assert.ok(gladys.fake.discoveredDevices.some((d) => d.external_id === BED_DEVICE));
});
