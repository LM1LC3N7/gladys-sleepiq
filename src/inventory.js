// -----------------------------------------------------------------------------
// The requests that discover a bed's parts (foundation, lights, foot warming,
// core climate) and read them, for the classic beds (REST) and the "fuzion"
// beds (bamkey), as asyncsleepiq (MIT) does. Every read but the bed list is
// secondary: no sign-in, no new try. A missing part (a 4xx, a refused bamkey)
// is absent; a 429, a 5xx or no answer is an error the caller handles.
// -----------------------------------------------------------------------------

import {
  FUZION_LIGHT,
  NIGHT_LIGHTS,
  NONE,
  PATHS,
  PRESET_VALUES,
  SIDES,
  SIDE_KEY,
} from './constants.js';
import {
  actuatorKey,
  bamkeyYes,
  classicLayout,
  fuzionActuators,
  fuzionPresetOptions,
  localDateTime,
  readClassicFootWarming,
  readClassicStatus,
  readClassicSystem,
  readClimate,
  readFuzionFlags,
  readFuzionFootWarming,
  readFuzionLight,
  readNumber,
  readOutlet,
  readSleepNumberControls,
  readSleepScore,
  presetOf,
} from './model.js';
import { SleepIQError } from './sleepiq.js';

/** A part the API says is not there: a 4xx (but a 429), or a bamkey failure. */
export const absent = (err) =>
  err instanceof SleepIQError &&
  (err.kind === 'bamkey_failed' ||
    (err.status >= 400 && err.status < 500 && err.kind !== 'rate_limited'));

/** The fuzion side word of a part (a shared one is read as the right side, as asyncsleepiq). */
const word = (side) => SIDE_KEY[side].toLowerCase();

/** Runs a probe: false when the API says the part is absent, the error otherwise. */
async function present(fn) {
  try {
    return await fn();
  } catch (err) {
    if (absent(err)) {
      return false;
    }
    throw err;
  }
}

/**
 * The parts of one bed, and whether the bed answers at all (asyncsleepiq's
 * `valid()`: pauseMode for a classic bed, the privacy state for a fuzion one).
 * @returns {Promise<{ valid: boolean, parts: object }>}
 */
export async function probeBed(client, accountId, bed, options = {}) {
  const read = { ...options, secondary: true };
  const parts = {
    actuators: [],
    presets: [],
    presetOptions: [],
    lights: [],
    footWarming: [],
    climate: [],
  };
  if (bed.kind === 'fuzion') {
    if (!accountId) {
      return { valid: false, parts };
    }
    const bam = (key, args = []) => client.bamkey(accountId, bed.id, key, args, read);
    const valid = await present(async () => {
      await bam('GET_PRIVACY_STATE');
      return true;
    });
    if (!valid) {
      return { valid: false, parts };
    }
    const flags = readFuzionFlags(await bam('GET_SYSTEM_CONFIGURATION'));
    if (flags.underbedLightEnableFlag) {
      parts.lights.push({ outlet: FUZION_LIGHT, side: NONE });
    }
    if (flags.articulationEnableFlag) {
      parts.actuators = fuzionActuators(flags);
    }
    parts.presetOptions = fuzionPresetOptions(flags);
    if (parts.presetOptions.length > 0) {
      parts.presets = [...SIDES];
    }
    for (const side of SIDES) {
      if (
        await present(async () => bamkeyYes(await bam('GET_FOOT_WARMING_PRESENCE', [word(side)])))
      ) {
        parts.footWarming.push(side);
      }
      if (await present(async () => bamkeyYes(await bam('GET_HEIDI_PRESENCE', [word(side)])))) {
        parts.climate.push({ side, kind: 'heidi' });
      } else if (
        await present(async () => bamkeyYes(await bam('GET_CLIMATE_PRESENCE', [word(side)])))
      ) {
        parts.climate.push({ side, kind: 'climate' });
      }
    }
  } else {
    const valid = (await client.check(PATHS.pauseMode(bed.id), options)) < 300;
    if (!valid) {
      return { valid: false, parts };
    }
    const system = await present(async () =>
      readClassicSystem(await client.read(PATHS.foundationSystem(bed.id), read)),
    );
    if (system?.type) {
      const layout = classicLayout(system.type);
      parts.actuators = layout.actuators;
      parts.presets = layout.presets;
      parts.presetOptions = [...PRESET_VALUES];
    }
    if (system?.footWarming) {
      parts.footWarming = [...SIDES];
    }
    for (const light of NIGHT_LIGHTS) {
      const status = await client.check(PATHS.outlet(bed.id), {
        ...options,
        query: { outletId: light.outlet },
      });
      if (status < 300) {
        parts.lights.push(light);
      }
    }
  }
  // A part of a side nobody sleeps on has no device: left out.
  const owned = (side) => side === NONE || Boolean(bed.sides[side]);
  return {
    valid: true,
    parts: {
      ...parts,
      actuators: parts.actuators.filter((a) => owned(a.side)),
      presets: parts.presets.filter(owned),
      lights: parts.lights.filter((l) => owned(l.side)),
      footWarming: parts.footWarming.filter(owned),
      climate: parts.climate.filter((c) => owned(c.side)),
    },
  };
}

/**
 * Reads the parts of one bed (secondary reads, each on its own: one failing
 * never hides the others).
 * @returns {Promise<{ reading: object, errors: Error[] }>}
 */
export async function readParts(client, accountId, bed, options = {}) {
  const read = { ...options, secondary: true };
  const parts = bed.parts;
  const reading = {
    positions: {},
    presets: {},
    lights: {},
    footWarming: {},
    climate: {},
    firmness: {},
  };
  const errors = [];
  const attempt = async (fn) => {
    try {
      await fn();
    } catch (err) {
      errors.push(err);
    }
  };
  if (bed.kind === 'fuzion') {
    const bam = (key, args = []) => client.bamkey(accountId, bed.id, key, args, read);
    for (const actuator of parts.actuators) {
      await attempt(async () => {
        const value = readNumber(
          await bam('GET_ACTUATOR_POSITION', [word(actuator.side), actuator.end]),
        );
        if (value !== undefined) {
          reading.positions[actuatorKey(actuator)] = value;
        }
      });
    }
    for (const side of parts.presets) {
      await attempt(async () => {
        const value = presetOf(await bam('GET_CURRENT_PRESET', [word(side)]));
        if (value !== undefined) {
          reading.presets[side] = value;
        }
      });
    }
    if (parts.lights.length > 0) {
      await attempt(async () => {
        const on = readFuzionLight(await bam('GET_UNDERBED_LIGHT'));
        if (on !== undefined) {
          reading.lights[FUZION_LIGHT] = on;
        }
      });
    }
    for (const side of parts.footWarming) {
      await attempt(async () => {
        const level = readFuzionFootWarming(await bam('GET_FOOT_WARMING', [word(side)]));
        if (level) {
          reading.footWarming[side] = level;
        }
      });
    }
    for (const { side, kind } of parts.climate) {
      await attempt(async () => {
        const key = kind === 'heidi' ? 'GET_HEIDI_MODE' : 'GET_CLIMATE_MODE';
        const value = readClimate(await bam(key, [word(side)]));
        if (value) {
          reading.climate[side] = value;
        }
      });
    }
    for (const side of Object.keys(bed.sides)) {
      await attempt(async () => {
        const { value } = readSleepNumberControls(
          await bam('GET_SLEEP_NUMBER_CONTROLS', [word(side)]),
        );
        if (value !== undefined) {
          reading.firmness[side] = value;
        }
      });
    }
  } else {
    if (parts.actuators.length > 0 || parts.presets.length > 0) {
      await attempt(async () => {
        const json = await client.read(PATHS.foundationStatus(bed.id), read);
        Object.assign(reading, readClassicStatus(json, parts));
      });
    }
    for (const light of parts.lights) {
      await attempt(async () => {
        const on = readOutlet(
          await client.read(PATHS.outlet(bed.id), { ...read, query: { outletId: light.outlet } }),
        );
        if (on !== undefined) {
          reading.lights[light.outlet] = on;
        }
      });
    }
    if (parts.footWarming.length > 0) {
      await attempt(async () => {
        reading.footWarming = readClassicFootWarming(
          await client.read(PATHS.footWarming(bed.id), read),
        );
      });
    }
  }
  return { reading, errors };
}

/** The sleep score of last night for one side (asyncsleepiq's fetch_sleep_data). */
export async function readSleep(client, sleeperId, { now, timezone, ...options }) {
  const json = await client.read(PATHS.sleepData, {
    ...options,
    secondary: true,
    query: {
      date: localDateTime(now, timezone),
      interval: 'D1',
      sleeper: sleeperId,
      includeSlices: 'false',
    },
  });
  return readSleepScore(json);
}
