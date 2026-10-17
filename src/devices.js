// -----------------------------------------------------------------------------
// The beds -> Gladys devices and their states (pure).
//
// One device per bed, `ext:<selector>:bed:<bedId>` (someone in bed, and the
// shared parts of a single foundation), and one device per side somebody
// sleeps on, `ext:<selector>:side:<bedId>:left|right` (in bed, firmness,
// pressure, sleep score, its foundation, light, foot warming, climate). The
// bed id and the side are what the SleepIQ API keys them on: they never change.
//
// Readings are read only. The commands are a `text`/`select` (firmness,
// foundation preset) and a `button`/`push` (stop the foundation): never a
// switch nor a binary, so a "turn everything off" never reaches them. The
// night light is the one `light`/`binary` (a light being part of "turn the
// lights off" is what one expects), refused like the others unless the
// configuration allows the commands.
//
// Categories: in bed on `motion-sensor`/`binary`, as the core maps the
// Zigbee `occupancy` and `presence` sensors; the numbers without a unit the
// core lists (firmness, raw pressure, score, positions) on `unknown`/`integer`;
// the names on `text`. No unit anywhere: none of the core's units fits.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
} from '@gladysassistant/integration-sdk';
import { FEATURES, FIRMNESS_OPTIONS, NONE, SIDES } from './constants.js';
import {
  CLIMATE_NAMES,
  FEATURE_NAMES,
  FOOT_WARMING_NAMES,
  PRESET_NAMES,
  SIDE_NAMES,
  word,
} from './i18n.js';
import { actuatorKey } from './model.js';

const sensor = (definition) => ({
  read_only: true,
  has_feedback: false,
  keep_history: true,
  ...definition,
});

const binary = sensor({ category: C.MOTION_SENSOR, type: T.SENSOR.BINARY, min: 0, max: 1 });
const integer = (max, keepHistory = true) =>
  sensor({ category: C.UNKNOWN, type: T.SENSOR.INTEGER, min: 0, max, keep_history: keepHistory });
const text = sensor({ category: C.TEXT, type: T.TEXT.TEXT, min: 0, max: 0, keep_history: false });

const select = (options) => ({
  category: C.TEXT,
  type: T.TEXT.SELECT,
  min: 0,
  max: 0,
  read_only: false,
  has_feedback: true,
  keep_history: false,
  supported_options: options,
});

/** The read-only features, by role. */
export const DEFINITIONS = {
  [FEATURES.OCCUPIED]: binary,
  [FEATURES.IN_BED]: binary,
  [FEATURES.FIRMNESS]: integer(100),
  [FEATURES.PRESSURE]: integer(1_000_000),
  [FEATURES.SLEEP_SCORE]: integer(100),
  [FEATURES.HEAD_POSITION]: integer(100, false),
  [FEATURES.FOOT_POSITION]: integer(100, false),
  [FEATURES.PRESET]: text,
  [FEATURES.FOOT_WARMING]: text,
  [FEATURES.CLIMATE]: text,
  [FEATURES.STOP]: {
    category: C.BUTTON,
    type: T.BUTTON.PUSH,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: false,
    keep_history: false,
  },
  [FEATURES.LIGHT]: {
    category: C.LIGHT,
    type: T.LIGHT.BINARY,
    min: 0,
    max: 1,
    read_only: false,
    has_feedback: true,
    keep_history: true,
  },
};

/** The roles that take a command (refused unless allowed, src/app.js). */
export const COMMANDS = [FEATURES.SET_FIRMNESS, FEATURES.SET_PRESET, FEATURES.STOP, FEATURES.LIGHT];

export const bedIds = (gladys, bedId) => gladys.externalIds('bed', bedId);
export const sideIds = (gladys, bedId, side) => gladys.externalIds('side', `${bedId}:${side}`);

/** The ids of the owner of a part: the bed for a shared one, else its side. */
export const ownerIds = (gladys, bedId, owner) =>
  owner === NONE ? bedIds(gladys, bedId) : sideIds(gladys, bedId, owner);

export const firmnessOptions = () =>
  FIRMNESS_OPTIONS.map((value) => ({ value: String(value), label: String(value) }));

export const presetOptions = (values, language) =>
  values.map((value) => ({ value, label: word(PRESET_NAMES[value], language) }));

export const sideName = (bed, side, language) => {
  const sleeper = bed.sides[side]?.name;
  const base = `${bed.name} – ${word(SIDE_NAMES[side], language)}`;
  return sleeper ? `${base} (${sleeper})` : base;
};

/** The roles of the parts an owner (NONE = the bed, else a side) carries. */
export function partRoles(bed, owner) {
  const parts = bed.parts ?? {};
  const roles = [];
  for (const actuator of parts.actuators ?? []) {
    if (actuator.side === owner) {
      roles.push(actuator.end === 'head' ? FEATURES.HEAD_POSITION : FEATURES.FOOT_POSITION);
    }
  }
  if ((parts.presets ?? []).includes(owner)) {
    roles.push(FEATURES.PRESET, FEATURES.SET_PRESET, FEATURES.STOP);
  }
  if ((parts.lights ?? []).some((l) => l.side === owner)) {
    roles.push(FEATURES.LIGHT);
  }
  if ((parts.footWarming ?? []).includes(owner)) {
    roles.push(FEATURES.FOOT_WARMING);
  }
  if ((parts.climate ?? []).some((c) => c.side === owner)) {
    roles.push(FEATURES.CLIMATE);
  }
  return roles;
}

/** The roles of a device: the bed's own, or a side's. */
export function deviceRoles(bed, owner) {
  const own =
    owner === NONE
      ? [FEATURES.OCCUPIED]
      : [
          FEATURES.IN_BED,
          FEATURES.FIRMNESS,
          FEATURES.SET_FIRMNESS,
          FEATURES.PRESSURE,
          FEATURES.SLEEP_SCORE,
        ];
  return [...own, ...partRoles(bed, owner)];
}

function definitionOf(bed, role, language) {
  if (role === FEATURES.SET_FIRMNESS) {
    return select(firmnessOptions());
  }
  if (role === FEATURES.SET_PRESET) {
    return select(presetOptions(bed.parts.presetOptions, language));
  }
  return DEFINITIONS[role];
}

/** Only the fields a device feature is published with. */
const FEATURE_FIELDS = [
  'name',
  'external_id',
  'category',
  'type',
  'unit',
  'min',
  'max',
  'read_only',
  'has_feedback',
  'keep_history',
  'supported_options',
];
const pick = (feature) =>
  Object.fromEntries(
    FEATURE_FIELDS.filter((key) => feature[key] !== undefined && feature[key] !== null).map(
      (key) => [key, feature[key]],
    ),
  );

/**
 * A device keeps every feature of the device created from it: a feature a
 * reading no longer shows is published again as it was created, so the core
 * never sees a structure change (updating the device would drop its history).
 */
export function keepCreated(device, created = []) {
  const old = created.find((d) => d?.external_id === device.external_id);
  if (!old) {
    return device;
  }
  const have = new Set(device.features.map((f) => f.external_id));
  const kept = (old.features ?? [])
    .filter((f) => typeof f?.external_id === 'string' && !have.has(f.external_id))
    .map(pick);
  return kept.length === 0 ? device : { ...device, features: [...device.features, ...kept] };
}

/** The devices of the beds, for the Discovery tab. */
export function buildDevices(gladys, beds, { language }, created = []) {
  const devices = [];
  for (const bed of beds) {
    const owners = [NONE, ...SIDES.filter((side) => bed.sides[side])];
    for (const owner of owners) {
      const ids = ownerIds(gladys, bed.id, owner);
      const device = {
        name: owner === NONE ? bed.name : sideName(bed, owner, language),
        external_id: ids.device,
        ...(bed.model ? { model: bed.model } : {}),
        should_poll: false,
        features: deviceRoles(bed, owner).map((role) => ({
          name: word(FEATURE_NAMES[role], language),
          external_id: ids.feature(role),
          ...definitionOf(bed, role, language),
        })),
        params: [{ name: 'bed_generation', value: bed.kind }],
      };
      devices.push(keepCreated(device, created));
    }
  }
  return devices;
}

/** featureExternalId -> { bed, owner, role }: what a command addresses. */
export function featureIndex(gladys, beds) {
  const index = new Map();
  for (const bed of beds) {
    for (const owner of [NONE, ...SIDES.filter((side) => bed.sides[side])]) {
      const ids = ownerIds(gladys, bed.id, owner);
      for (const role of deviceRoles(bed, owner)) {
        index.set(ids.feature(role), { bed, owner, role });
      }
    }
  }
  return index;
}

/** The firmness of a side: the fuzion bamkey value first, else bed/familyStatus. */
export function firmnessOf(bed, side, presence, reading) {
  const fromParts = bed.kind === 'fuzion' ? reading?.firmness?.[side] : undefined;
  return fromParts ?? presence?.[side]?.sleepNumber;
}

/** 1 when someone is in bed, 0 when every side says no one, else undefined. */
export function occupiedOf(bed, presence) {
  const sides = SIDES.filter((side) => bed.sides[side]);
  const values = sides.map((side) => presence?.[side]?.inBed);
  if (values.some((v) => v === true)) {
    return 1;
  }
  return values.length > 0 && values.every((v) => v === false) ? 0 : undefined;
}

/** The light outlet of an owner. */
const lightOf = (bed, owner) => (bed.parts?.lights ?? []).find((l) => l.side === owner)?.outlet;

/**
 * The current values of the devices of one bed (sent when they change).
 * `presence`: { left?, right? } of familyStatus; `reading`: the parts read;
 * `sleep`: { left?, right? } scores.
 */
export function bedStates(gladys, bed, { presence, reading, sleep }, { language }) {
  const states = [];
  const push = (ids, role, value) =>
    states.push({ device_feature_external_id: ids.feature(role), ...value });
  const parts = (ids, owner) => {
    for (const role of [FEATURES.HEAD_POSITION, FEATURES.FOOT_POSITION]) {
      const end = role === FEATURES.HEAD_POSITION ? 'head' : 'foot';
      const value = reading?.positions?.[actuatorKey({ side: owner, end })];
      if (value !== undefined && partRoles(bed, owner).includes(role)) {
        push(ids, role, { state: value });
      }
    }
    if ((bed.parts?.presets ?? []).includes(owner)) {
      const preset = reading?.presets?.[owner];
      if (preset !== undefined) {
        push(ids, FEATURES.PRESET, { text: word(PRESET_NAMES[preset], language) });
        if (bed.parts.presetOptions.includes(preset)) {
          push(ids, FEATURES.SET_PRESET, { text: preset });
        }
      }
    }
    const outlet = lightOf(bed, owner);
    const on = outlet === undefined ? undefined : reading?.lights?.[outlet];
    if (on !== undefined) {
      push(ids, FEATURES.LIGHT, { state: on ? 1 : 0 });
    }
    const warming = reading?.footWarming?.[owner];
    if (warming && (bed.parts?.footWarming ?? []).includes(owner)) {
      push(ids, FEATURES.FOOT_WARMING, { text: word(FOOT_WARMING_NAMES[warming], language) });
    }
    const climate = reading?.climate?.[owner];
    if (climate && (bed.parts?.climate ?? []).some((c) => c.side === owner)) {
      push(ids, FEATURES.CLIMATE, { text: word(CLIMATE_NAMES[climate], language) });
    }
  };

  const bedId = bedIds(gladys, bed.id);
  const occupied = occupiedOf(bed, presence);
  if (occupied !== undefined) {
    push(bedId, FEATURES.OCCUPIED, { state: occupied });
  }
  parts(bedId, NONE);

  for (const side of SIDES.filter((s) => bed.sides[s])) {
    const ids = sideIds(gladys, bed.id, side);
    const data = presence?.[side];
    if (data?.inBed !== undefined) {
      push(ids, FEATURES.IN_BED, { state: data.inBed ? 1 : 0 });
    }
    const firmness = firmnessOf(bed, side, presence, reading);
    if (firmness !== undefined) {
      push(ids, FEATURES.FIRMNESS, { state: firmness });
      if (FIRMNESS_OPTIONS.includes(firmness)) {
        push(ids, FEATURES.SET_FIRMNESS, { text: String(firmness) });
      }
    }
    if (data?.pressure !== undefined) {
      push(ids, FEATURES.PRESSURE, { state: data.pressure });
    }
    if (sleep?.[side] !== undefined) {
      push(ids, FEATURES.SLEEP_SCORE, { state: sleep[side] });
    }
    parts(ids, side);
  }
  return states;
}
