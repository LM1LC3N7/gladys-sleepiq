// -----------------------------------------------------------------------------
// The integration: the SleepIQ account (e-mail and password), one read of the
// in-bed presence per minute (bed/familyStatus), the foundation, lights, foot
// warming and climate every 5 minutes, the sleep score every hour, the beds
// and their parts every 6 hours; the Gladys devices and their states, the
// in-bed / out-of-bed scene triggers, the transport badges, the "Test the
// connection" button, and the commands (firmness, foundation preset, stop,
// night light), refused unless the configuration allows them. index.js only
// wires the SDK handlers to it.
// -----------------------------------------------------------------------------

import { DEVICE_TRANSPORTS, createLogger } from '@gladysassistant/integration-sdk';
import { SleepIQClient } from './client.js';
import { normalizeConfig } from './config.js';
import {
  FEATURES,
  FIRMNESS_OPTIONS,
  LIMITS,
  NONE,
  PATHS,
  PRESETS,
  SIDES,
  SIDE_KEY,
  SIDE_LETTER,
  TIMINGS,
} from './constants.js';
import {
  COMMANDS,
  bedIds,
  bedStates,
  buildDevices,
  featureIndex,
  ownerIds,
  sideIds,
  sideName,
} from './devices.js';
import { presenceEvents } from './events.js';
import { ERRORS, PRESET_NAMES, T, age, word } from './i18n.js';
import { probeBed, readParts, readSleep } from './inventory.js';
import {
  presetOf,
  readBeds,
  readClassicStatus,
  readFamilyStatus,
  readFuzionLight,
  readOutlet,
  readSleepNumberControls,
} from './model.js';
import { StatePublisher } from './publisher.js';
import { SleepIQError, errorReason } from './sleepiq.js';
import { fileStore, normalizeMemory } from './store.js';

/** Errors SleepIQ did not answer usefully for: the account is unreachable. */
const OFFLINE = new Set([
  'network',
  'timeout',
  'unavailable',
  'bad_response',
  'size',
  'http',
  'not_found',
  'not_signed_in',
]);
/** Errors that stop the polling, with the spaced new tries of each. */
const STOPS = {
  refused: TIMINGS.refusedRetry,
  login_rejected: TIMINGS.refusedRetry,
  session_refused: TIMINGS.sessionRetry,
};
/**
 * Errors of a command that also hold every other path (a 429 pause or a
 * stop). A 403 on a command is only that command refused.
 */
const HOLDS = new Set(['rate_limited', ...Object.keys(STOPS)]);

/** The fuzion word of a side (a shared part is read as the right side, as asyncsleepiq). */
const sideWord = (owner) => SIDE_KEY[owner].toLowerCase();

export class SleepIQApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'sleepiq' }),
    transport,
    now = Date.now,
    timers = globalThis,
    store = fileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.timers = timers;
    this.store = store;
    this.client = new SleepIQClient({ transport, now, onChange: () => this.persist() });
    this.publisher = new StatePublisher({ gladys, logger, now, timers });
    this.config = normalizeConfig();
    this.memory = normalizeMemory(null, now());
    this.timer = undefined;
    this.running = undefined;
    this.generation = 0;
    this.started = false;
    this.lastStatus = undefined;
    this.lastTestAt = -Infinity;
    /** A command in flight (one at a time). */
    this.commanding = false;
    this.pausedUntil = 0;
    /** 'rate' (a 429: every path waits), 'forbidden' (every path too) or 'backoff'. */
    this.pauseKind = undefined;
    this.reset();
  }

  // --- Lifecycle -------------------------------------------------------------

  async start(raw = {}, { clearBlock = false } = {}) {
    this.stop();
    await this.running;
    this.config = normalizeConfig(raw);
    this.reset();
    this.memory = normalizeMemory(await this.store.load().catch(() => null), this.now());
    const { email, password, account } = this.config;
    if (clearBlock && (this.memory.block || this.memory.session)) {
      this.memory.block = null;
      this.memory.session = null;
      await this.saveMemory();
    }
    // A 429 or 403 pause survives a restart and a change of account.
    const pause = this.memory.pause;
    if (pause && pause.until > Math.max(this.now(), this.pausedUntil)) {
      this.pausedUntil = pause.until;
      this.pauseKind = pause.kind;
    }
    const session = this.memory.session?.account === account ? this.memory.session : null;
    this.client.configure({ email, password, session });
    const block = this.memory.block?.account === account ? this.memory.block : null;
    this.block = block
      ? { kind: block.kind, retryAt: block.retryAt, retries: block.retries, status: block.status }
      : undefined;
    this.publisher.start();
    if (!this.client.hasCredentials) {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    if (this.block) {
      // Stopped before the restart: the next try keeps its time.
      await this.setStatus(false, this.blockMessage());
      this.scheduleNext();
      return;
    }
    await this.setStatus(false, this.pauseMessage() ?? T.connecting);
    await this.tick();
  }

  stop() {
    this.generation += 1;
    this.clearTimer();
    this.publisher.stop();
  }

  clearTimer() {
    if (this.timer) {
      this.timers.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  /** Forgets the beds, the readings and the failures: a new account, or a restart. A 429/403 pause stays. */
  reset() {
    /** { accountId, beds } of the last inventory, and when it was read. */
    this.inventory = undefined;
    this.inventoryAt = -Infinity;
    /** bedId -> { left?, right? } of the last bed/familyStatus. */
    this.presence = new Map();
    /** `${bedId}:${side}` -> { inBed, at }: the last known presence, for the scene events. */
    this.previous = new Map();
    /** bedId -> the parts read (positions, presets, lights, foot warming, climate). */
    this.readings = new Map();
    this.partsAt = -Infinity;
    /** bedId -> { left?, right? } sleep scores. */
    this.sleep = new Map();
    this.sleepAt = -Infinity;
    this.index = new Map();
    this.published = undefined;
    this.badges = undefined;
    this.block = undefined;
    this.retrying = undefined;
    this.offline = false;
    this.connectedOnce = false;
    this.failures = 0;
    if (this.pauseKind === 'backoff' || this.now() >= this.pausedUntil) {
      this.pausedUntil = 0;
      this.pauseKind = undefined;
    }
  }

  /**
   * Connected to Gladys. The first time, start; after a reconnection (Gladys
   * restarted), resend what Gladys keeps in memory only (status, Discovery
   * list, badges) and the last states. The pauses, the stops and the key stay.
   */
  async connected(raw = {}) {
    if (!this.started) {
      this.started = true;
      await this.start(raw);
      return;
    }
    await this.configUpdated(raw);
    this.published = undefined;
    this.badges = undefined;
    const status = this.lastStatus;
    this.lastStatus = undefined;
    if (status) {
      const [connected, message] = JSON.parse(status);
      await this.setStatus(connected, message ?? undefined);
    }
    await this.publishDevices();
    this.queueStates();
    await this.flush();
    await this.publishBadges();
  }

  /** New credentials restart (and lift a stop); a new language or timezone renames or reads again. */
  async configUpdated(raw = {}) {
    const next = normalizeConfig(raw);
    const previous = this.config;
    if (next.email !== previous.email || next.password !== previous.password) {
      // New credentials: the stop is lifted and the old key forgotten
      // (a password changed for the same e-mail must be checked again).
      return this.start(raw, { clearBlock: true });
    }
    this.config = next;
    if (next.timezone !== previous.timezone) {
      this.sleepAt = -Infinity;
    }
    if (next.language !== previous.language) {
      await this.publishDevices();
      this.queueStates();
      await this.flush();
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  /** The message of the last status (multi-language), or undefined. */
  get lastMessage() {
    return JSON.parse(this.lastStatus ?? '[false,null]')[1] ?? undefined;
  }

  async saveMemory() {
    await this.store
      .save(this.memory)
      .catch((err) => this.logger.warn(`Saving the state to /data failed: ${err.message}`));
  }

  /** The key of the client, with its account. */
  async persist() {
    const { session } = this.client;
    this.memory.session = session ? { account: this.config.account, ...session } : null;
    await this.saveMemory();
  }

  async flush() {
    await this.publisher
      .flush()
      .catch((err) => this.logger.warn(`Sending to Gladys failed: ${err.message}`));
  }

  // --- Polling ---------------------------------------------------------------

  /** The beds shown: those that answered (or not probed yet). */
  get beds() {
    return (this.inventory?.beds ?? []).filter((bed) => bed.valid !== false);
  }

  /** The next read: at the stop's next try, after the pause, else the interval (or `delay`). */
  scheduleNext(delay) {
    this.clearTimer();
    if (!this.client.hasCredentials) {
      return;
    }
    const now = this.now();
    let wait;
    if (this.block) {
      wait = this.block.retryAt - now;
    } else if (now < this.pausedUntil) {
      wait = this.pausedUntil - now;
    } else {
      wait = delay ?? TIMINGS.presenceInterval;
    }
    const generation = this.generation;
    this.timer = this.timers.setTimeout(
      () => {
        this.timer = undefined;
        if (generation === this.generation) {
          this.tick().catch(() => this.logger.error('SleepIQ refresh failed'));
        }
      },
      Math.max(0, wait),
    );
  }

  /** One run at a time: a tick during a run joins it. `quick`: for the button. */
  tick({ quick = false } = {}) {
    if (!this.running) {
      this.running = this.run({ quick }).finally(() => {
        this.running = undefined;
      });
    }
    return this.running;
  }

  /**
   * A secondary read failed: logged (reason only), never a stop. Only a 429 is
   * passed on, to pause every path once the main data is shown.
   */
  secondary(err, what) {
    this.logger.info(`SleepIQ ${what} not read: ${errorReason(err)}`);
    return err?.kind === 'rate_limited' ? err : undefined;
  }

  /** The beds and their sleepers (GET bed is the main read the first time). */
  async discover(options) {
    const beds = await this.client.read(PATHS.beds, options);
    let sleepers;
    try {
      sleepers = await this.client.read(PATHS.sleepers, { ...options, secondary: true });
    } catch (err) {
      if (err?.kind === 'rate_limited') {
        throw err;
      }
      this.logger.info(`SleepIQ sleepers not read: ${errorReason(err)}`);
    }
    const found = readBeds(beds, sleepers);
    if (found.skipped > 0) {
      this.logger.info(
        `SleepIQ: ${found.skipped} bed entr${found.skipped > 1 ? 'ies' : 'y'} skipped`,
      );
    }
    const before = new Map((this.inventory?.beds ?? []).map((bed) => [bed.id, bed]));
    for (const bed of found.beds) {
      // The parts known so far stay until the bed is probed again.
      bed.parts = before.get(bed.id)?.parts;
      bed.valid = before.get(bed.id)?.valid;
      bed.probed = false;
      bed.probeAt = -Infinity;
    }
    this.inventory = {
      accountId: found.accountId ?? this.inventory?.accountId,
      beds: found.beds,
    };
    this.inventoryAt = this.now();
  }

  async run({ quick = false } = {}) {
    const generation = this.generation;
    if (!this.client.hasCredentials) {
      return;
    }
    if (this.block && this.now() >= this.block.retryAt) {
      // The spaced new try of a stop.
      this.logger.info('SleepIQ: trying again after a stop');
      this.retrying = this.block;
      this.block = undefined;
    }
    if (this.block || this.now() < this.pausedUntil) {
      this.scheduleNext();
      return;
    }
    this.client.beginCycle();
    this.client.timeout = quick ? TIMINGS.quickTimeout : undefined;
    // The test button: one deadline for the whole run, within its 60 s.
    const options = quick ? { deadline: this.now() + TIMINGS.quickBudget } : {};
    try {
      if (!this.inventory) {
        await this.discover(options);
      }
      const status = readFamilyStatus(await this.client.read(PATHS.familyStatus, options));
      if (!status) {
        throw new SleepIQError('bad_response', 'SleepIQ sent no bed status');
      }
      if (generation !== this.generation) {
        return;
      }
      this.applyPresence(status);
      await this.succeeded();
      const held = await this.secondaries(options, generation);
      if (generation !== this.generation) {
        return;
      }
      await this.refresh();
      if (held) {
        await this.failed(held);
      }
    } catch (err) {
      if (generation !== this.generation) {
        return;
      }
      await this.failed(err);
    } finally {
      this.client.timeout = undefined;
    }
    await this.publishBadges();
    await this.flush();
    if (generation === this.generation) {
      this.scheduleNext();
    }
  }

  /**
   * The reads after the main one, each at its own pace, with the current key
   * only (no sign-in, no new try). A failure is never read again sooner than
   * its interval; a 429 stops the round and is returned.
   */
  async secondaries(options, generation) {
    const secondary = { ...options, secondary: true };
    const now = this.now();
    let held;
    const note = (err, what) => {
      held = this.secondary(err, what) ?? held;
    };
    if (now - this.inventoryAt >= TIMINGS.inventoryInterval) {
      try {
        await this.discover(secondary);
      } catch (err) {
        // Tried again at the next interval, not at the next minute.
        this.inventoryAt = now;
        note(err, 'beds');
      }
    }
    for (const bed of this.inventory.beds) {
      if (held || generation !== this.generation) {
        return held;
      }
      if (bed.probed || now - bed.probeAt < TIMINGS.foundationInterval) {
        continue;
      }
      bed.probeAt = now;
      try {
        const { valid, parts } = await probeBed(
          this.client,
          this.inventory.accountId,
          bed,
          options,
        );
        bed.valid = valid;
        bed.parts = parts;
        bed.probed = true;
        // Fresh parts are read at once.
        this.partsAt = -Infinity;
        if (!valid) {
          this.logger.info(`SleepIQ: bed ${bed.name} does not answer, skipped`);
        }
      } catch (err) {
        note(err, 'bed parts');
      }
    }
    if (!held && this.now() - this.partsAt >= TIMINGS.foundationInterval) {
      this.partsAt = this.now();
      for (const bed of this.beds.filter((b) => b.parts)) {
        if (held || generation !== this.generation) {
          return held;
        }
        try {
          const { reading, errors } = await readParts(
            this.client,
            this.inventory.accountId,
            bed,
            options,
          );
          this.readings.set(bed.id, reading);
          for (const err of errors) {
            note(err, 'foundation');
          }
        } catch (err) {
          note(err, 'foundation');
        }
      }
    }
    if (!held && this.now() - this.sleepAt >= TIMINGS.sleepInterval) {
      this.sleepAt = this.now();
      for (const bed of this.beds) {
        for (const side of SIDES.filter((s) => bed.sides[s])) {
          if (held || generation !== this.generation) {
            return held;
          }
          try {
            const score = await readSleep(this.client, bed.sides[side].sleeperId, {
              ...secondary,
              now: this.now(),
              timezone: this.config.timezone,
            });
            const scores = this.sleep.get(bed.id) ?? {};
            if (score === undefined) {
              delete scores[side];
            } else {
              scores[side] = score;
            }
            this.sleep.set(bed.id, scores);
          } catch (err) {
            note(err, 'sleep score');
          }
        }
      }
    }
    return held;
  }

  /** The presence just read, and the scene events of what changed. */
  applyPresence(status) {
    const now = this.now();
    this.presence = status;
    const at = new Date(now).toISOString();
    for (const bed of this.beds) {
      const { events, stale, next } = presenceEvents(this.previous, bed, status.get(bed.id), now);
      for (const [key, value] of next) {
        this.previous.set(key, value);
      }
      for (const event of stale) {
        this.logger.info(`SleepIQ: ${event.key} on ${bed.name} ${event.side} seen late, not fired`);
      }
      for (const event of events) {
        this.logger.info(`SleepIQ: ${event.key} on ${bed.name} ${event.side}`);
        const language = this.config.language;
        this.publisher.pushSceneEvent(event.key, {
          bed_device: bedIds(this.gladys, bed.id).device,
          side_device: sideIds(this.gladys, bed.id, event.side).device,
          side: event.side,
          bed_name: bed.name.slice(0, LIMITS.textLength),
          side_name: sideName(bed, event.side, language).slice(0, 200),
          sleeper_name: bed.sides[event.side]?.name ?? null,
          at,
        });
      }
    }
  }

  async succeeded() {
    this.failures = 0;
    this.offline = false;
    this.connectedOnce = true;
    this.retrying = undefined;
    if (this.pauseKind === 'backoff') {
      this.pauseKind = undefined;
    }
    if (this.memory.block) {
      this.memory.block = null;
      await this.saveMemory();
    }
    const count = this.beds.length;
    await this.setStatus(true, count === 0 ? T.noBed : T.connected(count));
  }

  blockMessage() {
    const wait = age(Math.max(0, this.block.retryAt - this.now()));
    switch (this.block.kind) {
      case 'refused':
        return T.refused(wait);
      case 'login_rejected':
        return T.loginRejected(this.block.status ?? '?', wait);
      default:
        return T.sessionRefused(wait);
    }
  }

  async failed(err) {
    const reason = errorReason(err);
    const schedule = STOPS[err?.kind];
    if (schedule) {
      // Never signed in again in a loop: refusals may lock the account. One
      // new try after 6 h then every 24 h (1 h, 6 h, 24 h for a refused session).
      const retries = this.retrying?.retries ?? 0;
      const wait = schedule[Math.min(retries, schedule.length - 1)];
      this.block = {
        kind: err.kind,
        retryAt: this.now() + wait,
        retries: retries + 1,
        status: err.status,
      };
      this.retrying = undefined;
      this.memory.block = { account: this.config.account, ...this.block };
      await this.saveMemory();
      this.logger.warn(
        `SleepIQ stopped: ${reason}; one new try in ${Math.round(wait / 60_000)} min`,
      );
      await this.setStatus(false, this.blockMessage());
      return;
    }
    if (err?.kind === 'no_credentials') {
      await this.setStatus(false, T.noCredentials);
      return;
    }
    let wait;
    let message;
    if (err?.kind === 'rate_limited') {
      wait = Math.min(
        TIMINGS.rateLimitMax,
        Math.max(TIMINGS.rateLimitMin, err.retryAfter ?? TIMINGS.rateLimitDefault),
      );
      this.pauseKind = 'rate';
      message = T.rateLimited(age(wait));
    } else if (err?.kind === 'forbidden') {
      wait = TIMINGS.forbiddenPause;
      this.pauseKind = 'forbidden';
      this.offline = true;
      message = T.forbidden(age(wait));
    } else {
      // Never read again sooner than the interval.
      wait = Math.max(
        TIMINGS.presenceInterval,
        TIMINGS.backoff[Math.min(this.failures, TIMINGS.backoff.length - 1)],
      );
      this.pauseKind = 'backoff';
      this.offline = OFFLINE.has(err?.kind) || this.offline;
      message = T.unreachable(reason, age(wait));
    }
    this.failures += 1;
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + wait);
    if (this.pauseKind === 'rate' || this.pauseKind === 'forbidden') {
      this.memory.pause = { kind: this.pauseKind, until: this.pausedUntil };
      await this.saveMemory();
    }
    const connected = err?.kind === 'rate_limited' && this.connectedOnce;
    await this.setStatus(connected, message);
    this.logger.warn(`SleepIQ: ${reason}; next try in ${Math.round(wait / 1000)} s`);
  }

  // --- Gladys ----------------------------------------------------------------

  async refresh() {
    await this.publishDevices();
    this.queueStates();
  }

  async publishDevices() {
    if (!this.inventory) {
      return;
    }
    const beds = this.beds;
    this.index = featureIndex(this.gladys, beds);
    const devices = buildDevices(this.gladys, beds, this.config, this.gladys.devices ?? []);
    const json = JSON.stringify(devices);
    if (json === this.published) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(devices);
      this.published = json;
    } catch (err) {
      this.logger.warn(`Publishing the discovered devices failed: ${err.message}`);
    }
  }

  createdFeatures() {
    return new Set(
      (this.gladys.devices ?? []).flatMap((d) => (d.features ?? []).map((f) => f.external_id)),
    );
  }

  queueStates(created = this.createdFeatures()) {
    if (!this.inventory) {
      return;
    }
    for (const bed of this.beds) {
      const states = bedStates(
        this.gladys,
        bed,
        {
          presence: this.presence.get(bed.id),
          reading: this.readings.get(bed.id),
          sleep: this.sleep.get(bed.id),
        },
        this.config,
      );
      for (const { device_feature_external_id: id, ...value } of states) {
        if (created.has(id)) {
          this.publisher.push(id, value);
        }
      }
    }
  }

  /** The external ids of our devices that Gladys created. */
  ownDevices() {
    const ours = new Set();
    for (const bed of this.beds) {
      for (const owner of [NONE, ...SIDES.filter((s) => bed.sides[s])]) {
        ours.add(ownerIds(this.gladys, bed.id, owner).device);
      }
    }
    return (this.gladys.devices ?? [])
      .map((d) => d.external_id)
      .filter((externalId) => ours.has(externalId));
  }

  async publishBadges() {
    const devices = this.ownDevices();
    if (devices.length === 0) {
      return;
    }
    const transport =
      this.block || this.offline ? DEVICE_TRANSPORTS.UNREACHABLE : DEVICE_TRANSPORTS.CLOUD;
    const entries = devices
      .slice(0, 100)
      .map((externalId) => ({ external_id: externalId, transport }));
    const json = JSON.stringify(entries);
    if (json === this.badges) {
      return;
    }
    try {
      await this.gladys.publishTransports(entries);
      this.badges = json;
    } catch (err) {
      this.logger.warn(`Transport badges failed: ${err.message}`);
    }
  }

  /** A device was created (or updated): send its last values at once. */
  async deviceCreated(device) {
    this.badges = undefined;
    const created = this.createdFeatures();
    for (const f of device?.features ?? []) {
      created.add(f.external_id);
    }
    this.queueStates(created);
    await this.flush();
    await this.publishBadges();
  }

  async deviceDeleted(device) {
    this.badges = undefined;
    if (device?.external_id) {
      this.publisher.forget(device.external_id);
    }
  }

  /** The Discovery tab asks for a scan: the devices of the last read (no extra request). */
  async scan() {
    await this.publishDevices();
  }

  // --- Configuration button --------------------------------------------------

  /** A 429 or 403 pause holds for every path, buttons and commands included. */
  pauseMessage() {
    const left = this.pausedUntil - this.now();
    if (left <= 0) {
      return undefined;
    }
    if (this.pauseKind === 'rate') {
      return T.rateLimited(age(left));
    }
    return this.pauseKind === 'forbidden' ? T.forbidden(age(left)) : undefined;
  }

  async testConnection() {
    if (!this.client.hasCredentials) {
      return T.noCredentials;
    }
    const paused = this.pauseMessage();
    if (paused) {
      return paused;
    }
    // At most one read per 30 s from this button, whatever happened before.
    if (this.now() - this.lastTestAt < TIMINGS.testCooldown) {
      const last = this.connectedOnce && !this.block ? this.summary() : this.lastMessage;
      return last
        ? { en: `${T.test.cooldown.en} ${last.en}`, fr: `${T.test.cooldown.fr} ${last.fr}` }
        : T.test.cooldown;
    }
    if (this.running) {
      return T.busy;
    }
    this.lastTestAt = this.now();
    // One try per click: the button is how a stopped account is tried again.
    if (this.block) {
      this.retrying = this.block;
      this.block = undefined;
    }
    this.pausedUntil = 0;
    this.pauseKind = undefined;
    await this.tick({ quick: true });
    const [connected, message] = JSON.parse(this.lastStatus ?? '[false,null]');
    if (!connected) {
      return message ?? T.noCredentials;
    }
    return this.summary();
  }

  summary() {
    if (this.beds.length === 0) {
      return T.noBed;
    }
    return T.test.summary(
      this.beds.map((bed) => {
        const presence = this.presence.get(bed.id) ?? {};
        return T.test.bed({
          name: bed.name,
          inBed: SIDES.filter((side) => bed.sides[side] && presence[side]?.inBed === true),
        });
      }),
    );
  }

  // --- Commands --------------------------------------------------------------

  error(text) {
    return new Error(word(text, this.config.language));
  }

  /** A command from Gladys: checks, a fresh read of the state, then one request. */
  async setValue(device, feature, value) {
    const received = this.now();
    const target = this.index.get(feature?.external_id);
    if (!target || !COMMANDS.includes(target.role)) {
      throw this.error(ERRORS.readOnly);
    }
    if (!this.config.allowCommands) {
      throw this.error(ERRORS.disabled);
    }
    if (!this.client.hasCredentials || this.block || !this.inventory) {
      throw this.error(ERRORS.notConnected);
    }
    const paused = this.pauseMessage();
    if (paused) {
      throw this.error(paused);
    }
    if (this.commanding) {
      throw this.error(ERRORS.stillRunning);
    }
    const wanted = this.wanted(target, value);
    this.commanding = true;
    let background;
    try {
      ({ background } = await this.command({
        target,
        wanted,
        received,
        generation: this.generation,
      }));
    } finally {
      if (background) {
        background.finally(() => {
          this.commanding = false;
        });
      } else {
        this.commanding = false;
      }
    }
  }

  /** The value a command asks for, checked. */
  wanted({ bed, role }, value) {
    switch (role) {
      case FEATURES.SET_FIRMNESS: {
        const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        if (!FIRMNESS_OPTIONS.includes(n)) {
          throw this.error(ERRORS.invalidFirmness);
        }
        return n;
      }
      case FEATURES.SET_PRESET: {
        const preset = String(value);
        if (!bed.parts.presetOptions.includes(preset)) {
          throw this.error(ERRORS.invalidValue);
        }
        return preset;
      }
      case FEATURES.LIGHT: {
        const n = Number(value);
        if (n !== 0 && n !== 1) {
          throw this.error(ERRORS.invalidValue);
        }
        return n === 1;
      }
      default:
        return true;
    }
  }

  /** A command error that holds every path (429, a stop) is applied like a polling one. */
  async hold(err) {
    if (HOLDS.has(err?.kind)) {
      await this.failed(err);
      await this.publishBadges();
      this.scheduleNext();
      return this.pauseMessage() ?? (this.block ? this.blockMessage() : undefined);
    }
    return undefined;
  }

  /**
   * Reads the current state the command depends on (never decided on the one
   * in memory) and returns the request to send, or `{ done }` with the state
   * to show when it is already so.
   */
  async plan({ bed, owner, role }, wanted, deadline) {
    const account = this.inventory.accountId;
    const fuzion = bed.kind === 'fuzion';
    const read = { deadline };
    const ids = ownerIds(this.gladys, bed.id, owner);
    const unknown = (value) => {
      if (value === undefined) {
        throw this.error(ERRORS.unknownState);
      }
      return value;
    };
    if (role === FEATURES.SET_FIRMNESS) {
      let current;
      if (fuzion) {
        const controls = readSleepNumberControls(
          await this.client.bamkey(account, bed.id, 'GET_SLEEP_NUMBER_CONTROLS', [owner], read),
        );
        if (controls.updating === true) {
          throw this.error(ERRORS.adjusting);
        }
        unknown(controls.updating);
        current = unknown(controls.value);
      } else {
        const status = readFamilyStatus(await this.client.read(PATHS.familyStatus, read));
        current = unknown(status?.get(bed.id)?.[owner]?.sleepNumber);
      }
      if (current === wanted) {
        return {
          done: [
            [ids.feature(FEATURES.FIRMNESS), { state: current }],
            [ids.feature(FEATURES.SET_FIRMNESS), { text: String(current) }],
          ],
        };
      }
      return {
        send: (sendBy) =>
          fuzion
            ? this.client.bamkeyCommand(
                account,
                bed.id,
                'START_SLEEP_NUMBER_ADJUSTMENT',
                [owner, String(wanted)],
                { sendBy },
              )
            : this.client.command('PUT', PATHS.sleepNumber(bed.id), {
                payload: { sleepNumber: wanted, side: SIDE_LETTER[owner] },
                sendBy,
              }),
      };
    }
    if (role === FEATURES.SET_PRESET) {
      const current = unknown(
        fuzion
          ? presetOf(
              await this.client.bamkey(
                account,
                bed.id,
                'GET_CURRENT_PRESET',
                [sideWord(owner)],
                read,
              ),
            )
          : readClassicStatus(
              await this.client.read(PATHS.foundationStatus(bed.id), read),
              bed.parts,
            ).presets[owner],
      );
      if (current === wanted) {
        return {
          done: [
            [
              ids.feature(FEATURES.PRESET),
              { text: word(PRESET_NAMES[current], this.config.language) },
            ],
            [ids.feature(FEATURES.SET_PRESET), { text: current }],
          ],
        };
      }
      return {
        send: (sendBy) =>
          fuzion
            ? this.client.bamkeyCommand(
                account,
                bed.id,
                'SET_PRESET',
                [sideWord(owner), PRESETS[wanted].fuzion],
                { sendBy },
              )
            : this.client.command('PUT', PATHS.foundationPreset(bed.id), {
                payload: { preset: PRESETS[wanted].classic, side: SIDE_LETTER[owner], speed: 0 },
                sendBy,
              }),
      };
    }
    if (role === FEATURES.LIGHT) {
      const outlet = bed.parts.lights.find((l) => l.side === owner)?.outlet;
      const current = unknown(
        fuzion
          ? readFuzionLight(
              await this.client.bamkey(account, bed.id, 'GET_UNDERBED_LIGHT', [], read),
            )
          : readOutlet(
              await this.client.read(PATHS.outlet(bed.id), {
                ...read,
                query: { outletId: outlet },
              }),
            ),
      );
      if (current === wanted) {
        return { done: [[ids.feature(FEATURES.LIGHT), { state: current ? 1 : 0 }]] };
      }
      return {
        send: (sendBy) =>
          fuzion
            ? this.client.bamkeyCommand(
                account,
                bed.id,
                'SET_UNDERBED_LIGHT',
                [wanted ? 'high' : 'off', '0'],
                { sendBy },
              )
            : this.client.command('PUT', PATHS.outlet(bed.id), {
                payload: { outletId: outlet, setting: wanted ? 1 : 0 },
                sendBy,
              }),
      };
    }
    // Stop: always safe, sent without a read (there is nothing to compare).
    return {
      send: (sendBy) =>
        fuzion
          ? this.client.bamkeyCommand(account, bed.id, 'HALT_ALL_ACTUATORS', [], { sendBy })
          : this.client.command('PUT', PATHS.foundationMotion(bed.id), {
              payload: { footMotion: 1, headMotion: 1, massageMotion: 1, side: SIDE_LETTER[owner] },
              sendBy,
            }),
    };
  }

  /**
   * Reads, decides, sends. Gladys waits 5 s: nothing is sent later than 3.5 s
   * after the click, and Gladys is answered at 4.3 s at the latest (the
   * request then finishes in the background, whose promise is returned as
   * `background`).
   */
  async command({ target, wanted, received, generation }) {
    const sendBy = received + TIMINGS.commandSendBy;
    if (sendBy - this.now() < TIMINGS.commandMinRead) {
      throw this.error(ERRORS.tooSlow);
    }
    let plan;
    try {
      plan = await this.plan(target, wanted, sendBy - TIMINGS.commandMinSend);
    } catch (err) {
      if (!(err instanceof SleepIQError)) {
        throw err;
      }
      const held = await this.hold(err);
      throw this.error(held ?? ERRORS.unknownState);
    }
    if (generation !== this.generation || this.block) {
      throw this.error(ERRORS.notConnected);
    }
    if (!this.config.allowCommands) {
      throw this.error(ERRORS.disabled);
    }
    if (plan.done) {
      // Already so: show the state just read.
      for (const [id, value] of plan.done) {
        this.publisher.push(id, value);
      }
      await this.flush();
      return {};
    }
    if (sendBy - this.now() < TIMINGS.commandMinSend) {
      throw this.error(ERRORS.tooSlow);
    }
    const { role, bed, owner } = target;
    this.logger.info(
      `SleepIQ command: ${role} on ${bed.name} ${owner} -> ${role === FEATURES.STOP ? 'stop' : wanted}`,
    );
    const request = plan.send(sendBy);
    // The parts (positions, presets, lights) are read again with the next read.
    const followUp = () => {
      if (generation === this.generation) {
        this.partsAt = -Infinity;
        this.scheduleNext(TIMINGS.refreshAfterCommand);
      }
    };
    let handle;
    const ack = new Promise((resolve) => {
      handle = this.timers.setTimeout(
        () => resolve({ pending: true }),
        Math.max(0, received + TIMINGS.commandAck - this.now()),
      );
    });
    const outcome = await Promise.race([
      request.then(
        () => ({ done: true }),
        (err) => ({ err }),
      ),
      ack,
    ]);
    this.timers.clearTimeout(handle);
    if (outcome.done) {
      followUp();
      return {};
    }
    if (outcome.pending) {
      // Sent, SleepIQ still at work: Gladys is answered now, the state follows.
      const background = request
        .then(
          () => this.logger.info(`SleepIQ command ${role} done`),
          async (err) => {
            this.logger.warn(`SleepIQ command ${role} failed: ${errorReason(err)}`);
            // A late 429 (or a stop) still holds every path.
            if (generation === this.generation) {
              await this.hold(err);
            }
          },
        )
        .finally(followUp);
      return { background };
    }
    const { err } = outcome;
    const held = await this.hold(err);
    if (held) {
      throw this.error(held);
    }
    followUp();
    const reason = errorReason(err);
    this.logger.warn(`SleepIQ command ${role} failed: ${reason}`);
    if (err?.notSent) {
      throw this.error(ERRORS.tooSlow);
    }
    if (err?.status) {
      throw this.error(ERRORS.refused(reason));
    }
    throw this.error(ERRORS.unsure(reason));
  }
}
