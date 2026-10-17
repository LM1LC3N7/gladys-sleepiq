// -----------------------------------------------------------------------------
// SleepIQ answers -> the beds, their sides and their readings (pure). Every
// field is checked: an unexpected value is "unknown" (never published, never
// decided on), never a guess.
//
// Field names follow asyncsleepiq (MIT): `bed` (bedId, accountId, name,
// model, generation, sleeperLeftId/RightId), `sleeper` (sleeperId,
// firstName), `bed/familyStatus` (leftSide/rightSide: isInBed, pressure,
// sleepNumber), `foundation/system` (fsBedType, fsBoardFeatures),
// `foundation/status` (fs<Side><Head|Foot>Position in hex,
// fsCurrentPositionPreset<Side>), `foundation/outlet` (setting),
// `foundation/footwarming` (footWarmingStatus<Side>), `sleepData` (sessions,
// sleepQuotient). The fuzion beds answer bamkey texts instead.
// -----------------------------------------------------------------------------

import {
  CLIMATE,
  FOOT_WARMING,
  FOOT_WARMING_LEVELS,
  FOUNDATION_TYPES,
  FUZION_FLAGS,
  LIMITS,
  NONE,
  NO_PRESET,
  PRESETS,
  PRESET_VALUES,
  SIDES,
  SIDE_KEY,
} from './constants.js';

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** The ids of the API (numbers, sometimes negative, as strings): safe in an external id. */
export const validId = (value) =>
  (typeof value === 'string' || (typeof value === 'number' && Number.isSafeInteger(value))) &&
  /^-?[A-Za-z0-9_]{1,64}$/.test(String(value));

/** A name from the API: printable, trimmed, bounded; undefined when empty. */
export function cleanText(value, max = LIMITS.textLength) {
  if (typeof value !== 'string') {
    return undefined;
  }
  // Control characters become spaces (no regex of them: no-control-regex).
  const printable = [...value].map((c) => (c < ' ' || c === '\u007f' ? ' ' : c)).join('');
  const text = printable.replace(/\s+/g, ' ').trim();
  return text === '' ? undefined : text.slice(0, max);
}

/** A sleeper id that names someone (asyncsleepiq skips the empty ones; "0" is no one too). */
const sleeperId = (value) => (validId(value) && String(value) !== '0' ? String(value) : undefined);

/** The model of a bed (asyncsleepiq: `model`, else the BASE component's). */
function modelOf(bed) {
  const direct = cleanText(bed.model);
  if (direct) {
    return direct;
  }
  const base = Array.isArray(bed.components)
    ? bed.components.find((c) => isObject(c) && c.base === 'BASE')
    : undefined;
  return cleanText(base?.model);
}

/**
 * GET /rest/bed and GET /rest/sleeper -> the account and its beds. Skipped,
 * as Home Assistant does: the "Firmness Control" controller that duplicates a
 * real bed, a bed id seen twice, a sleeper id seen twice in a bed.
 * @returns {{ accountId?: string, beds: object[], skipped: number }}
 */
export function readBeds(bedsJson, sleepersJson) {
  const list = Array.isArray(bedsJson?.beds) ? bedsJson.beds : [];
  const sleepers = Array.isArray(sleepersJson?.sleepers) ? sleepersJson.sleepers : [];
  const beds = [];
  const seen = new Set();
  let skipped = 0;
  let accountId;
  for (const raw of list) {
    if (!isObject(raw) || !validId(raw.bedId) || seen.has(String(raw.bedId))) {
      skipped += 1;
      continue;
    }
    const model = modelOf(raw);
    if ((model ?? '').toLowerCase().includes('firmness control')) {
      skipped += 1;
      continue;
    }
    if (accountId === undefined && validId(raw.accountId)) {
      accountId = String(raw.accountId);
    }
    const id = String(raw.bedId);
    seen.add(id);
    const sides = {};
    const ids = new Set();
    for (const side of SIDES) {
      const sid = sleeperId(raw[`sleeper${SIDE_KEY[side]}Id`]);
      if (!sid || ids.has(sid)) {
        continue;
      }
      ids.add(sid);
      const person = sleepers.find((s) => isObject(s) && String(s.sleeperId) === sid);
      sides[side] = { sleeperId: sid, name: cleanText(person?.firstName, 40) };
    }
    beds.push({
      id,
      name: cleanText(raw.name) ?? 'Sleep Number',
      model,
      kind: raw.generation === 'fuzion' ? 'fuzion' : 'classic',
      sides,
    });
    if (beds.length >= LIMITS.beds) {
      break;
    }
  }
  return { accountId, beds, skipped };
}

const finiteInteger = (value, min, max) => {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max
    ? Math.round(n)
    : undefined;
};

/** One side of bed/familyStatus: in bed (boolean only), pressure, Sleep Number. */
function readSide(raw) {
  if (!isObject(raw)) {
    return undefined;
  }
  return {
    inBed: typeof raw.isInBed === 'boolean' ? raw.isInBed : undefined,
    pressure: finiteInteger(raw.pressure, 0, 1_000_000),
    sleepNumber: finiteInteger(raw.sleepNumber, 0, 100),
  };
}

/** GET bed/familyStatus -> Map bedId -> { left?, right? }. */
export function readFamilyStatus(json) {
  if (!isObject(json) || !Array.isArray(json.beds)) {
    return undefined;
  }
  const status = new Map();
  for (const bed of json.beds) {
    if (!isObject(bed) || !validId(bed.bedId)) {
      continue;
    }
    const sides = {};
    for (const side of SIDES) {
      const data = readSide(bed[`${side}Side`]);
      if (data) {
        sides[side] = data;
      }
    }
    status.set(String(bed.bedId), sides);
  }
  return status;
}

/** The actuators and presets of a classic foundation type (asyncsleepiq's init_actuators/init_presets). */
export function classicLayout(type) {
  if (type === 'single' || type === 'easternKing') {
    return {
      actuators: [
        { side: NONE, end: 'head' },
        { side: NONE, end: 'foot' },
      ],
      presets: [NONE],
    };
  }
  if (type === 'splitHead') {
    return {
      actuators: [
        { side: 'left', end: 'head' },
        { side: 'right', end: 'head' },
        { side: NONE, end: 'foot' },
      ],
      presets: ['left', 'right'],
    };
  }
  return {
    actuators: [
      { side: 'left', end: 'head' },
      { side: 'right', end: 'head' },
      { side: 'left', end: 'foot' },
      { side: 'right', end: 'foot' },
    ],
    presets: ['left', 'right'],
  };
}

/** GET foundation/system of a classic bed -> its type and features, undefined when unknown. */
export function readClassicSystem(json) {
  if (!isObject(json)) {
    return undefined;
  }
  const flags = Number(json.fsBoardFeatures ?? 0);
  const bits = Number.isInteger(flags) && flags >= 0 ? flags : 0;
  const index = Number(json.fsBedType ?? -1);
  const type = Number.isInteger(index) ? FOUNDATION_TYPES[index] : undefined;
  return {
    type,
    footWarming: Boolean(bits & (1 << 3)),
  };
}

/** A hex position of foundation/status ("1f") -> 0..100, else undefined. */
export function hexPosition(value) {
  if (typeof value !== 'string' || !/^[0-9a-fA-F]{1,4}$/.test(value.trim())) {
    return undefined;
  }
  return finiteInteger(parseInt(value.trim(), 16), 0, 100);
}

/**
 * A preset as the API names it ("Watch TV", "Not at preset", "zero_g")
 * -> one of PRESET_VALUES, NO_PRESET, or undefined.
 */
export function presetOf(value) {
  if (typeof value !== 'string') {
    return undefined;
  }
  const key = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if (PRESET_VALUES.includes(key)) {
    return key;
  }
  if (key === 'not_at_preset' || key === 'none' || key === 'no_preset') {
    return NO_PRESET;
  }
  return undefined;
}

const actuatorKey = ({ side, end }) => `${side}-${end}`;

/** GET foundation/status of a classic bed -> positions and presets of its layout. */
export function readClassicStatus(json, layout) {
  const positions = {};
  const presets = {};
  if (!isObject(json)) {
    return { positions, presets };
  }
  for (const actuator of layout.actuators) {
    const end = actuator.end === 'head' ? 'Head' : 'Foot';
    const value = hexPosition(json[`fs${SIDE_KEY[actuator.side]}${end}Position`]);
    if (value !== undefined) {
      positions[actuatorKey(actuator)] = value;
    }
  }
  for (const side of layout.presets) {
    const value = presetOf(json[`fsCurrentPositionPreset${SIDE_KEY[side]}`]);
    if (value !== undefined) {
      presets[side] = value;
    }
  }
  return { positions, presets };
}

export { actuatorKey };

/** GET foundation/outlet -> true (on), false (off), undefined. */
export function readOutlet(json) {
  const setting = isObject(json) ? json.setting : undefined;
  if (setting === 1 || setting === '1') {
    return true;
  }
  if (setting === 0 || setting === '0') {
    return false;
  }
  return undefined;
}

/** GET foundation/footwarming of a classic bed -> { left?, right? } levels. */
export function readClassicFootWarming(json) {
  const levels = {};
  if (!isObject(json)) {
    return levels;
  }
  for (const side of SIDES) {
    const level = FOOT_WARMING[Number(json[`footWarmingStatus${SIDE_KEY[side]}`])];
    if (level) {
      levels[side] = level;
    }
  }
  return levels;
}

const YES = new Set(['yes', 'true', '1']);
const NO = new Set(['no', 'false', '0']);

/** GetSystemConfiguration of a fuzion bed -> its flags (asyncsleepiq's fetch_features). */
export function readFuzionFlags(text) {
  const flags = {};
  const words = String(text ?? '')
    .trim()
    .split(/\s+/);
  FUZION_FLAGS.forEach((name, i) => {
    const word = (words[i] ?? '').toLowerCase();
    flags[name] = YES.has(word) && name !== 'bedType';
  });
  return flags;
}

/** A yes/no bamkey answer ("1", "true") -> boolean. */
export const bamkeyYes = (text) =>
  YES.has(
    String(text ?? '')
      .trim()
      .toLowerCase(),
  );

/** The fuzion actuators of the flags (asyncsleepiq's init_actuators: sides only). */
export function fuzionActuators(flags) {
  const actuators = [];
  for (const side of ['right', 'left']) {
    for (const end of ['head', 'foot']) {
      if (flags[`${side}${end === 'head' ? 'Head' : 'Foot'}Actuator`]) {
        actuators.push({ side, end });
      }
    }
  }
  return actuators;
}

/** The fuzion presets the flags allow. */
export const fuzionPresetOptions = (flags) =>
  PRESET_VALUES.filter((value) => flags[PRESETS[value].flag]);

/** "low 120" (GetFootwarmingSettings) -> 'low', else undefined. */
export function readFuzionFootWarming(text) {
  const level = String(text ?? '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  return FOOT_WARMING_LEVELS.includes(level) ? level : undefined;
}

/** "heating_push_low 240" (GetHeidiMode, GetClimateMode) -> 'heating_low', else undefined. */
export function readClimate(text) {
  const word = String(text ?? '')
    .trim()
    .split(/\s+/)[0]
    .toUpperCase();
  return Object.hasOwn(CLIMATE, word) ? CLIMATE[word] : undefined;
}

/** "120" (GetActuatorPosition) -> 0..100, else undefined. */
export const readNumber = (text, min = 0, max = 100) =>
  /^\d{1,3}$/.test(String(text ?? '').trim())
    ? finiteInteger(String(text).trim(), min, max)
    : undefined;

/** "off 0" / "high 0" (GetUnderbedLightSettings) -> boolean, else undefined. */
export function readFuzionLight(text) {
  const word = String(text ?? '')
    .trim()
    .split(/\s+/)[0]
    .toLowerCase();
  if (word === '') {
    return undefined;
  }
  return word !== 'off';
}

/**
 * "false 30 45" (GetSleepNumberControls: is updating, ambient, user number)
 * -> { updating, value }; undefined pieces when unreadable.
 */
export function readSleepNumberControls(text) {
  const [updating, , user] = String(text ?? '')
    .trim()
    .split(/\s+/);
  const word = String(updating ?? '').toLowerCase();
  return {
    updating: YES.has(word) ? true : NO.has(word) ? false : undefined,
    value: readNumber(user, 0, 100),
  };
}

/**
 * GET sleepData -> the SleepIQ score (0..100) of the primary session of the
 * night (the `longest` one, else the longest by time), else the night's
 * average, as asyncsleepiq reads it; undefined when there is none.
 */
export function readSleepScore(json) {
  if (!isObject(json)) {
    return undefined;
  }
  const sessions = (Array.isArray(json.sleepData) ? json.sleepData : []).flatMap((day) =>
    isObject(day) && Array.isArray(day.sessions) ? day.sessions.filter(isObject) : [],
  );
  let primary = sessions.find((s) => s.longest === true);
  if (!primary && sessions.length > 0) {
    primary = sessions.reduce((best, s) =>
      Number(s.totalSleepSessionTime ?? 0) > Number(best.totalSleepSessionTime ?? 0) ? s : best,
    );
  }
  const raw = primary ? primary.sleepQuotient : json.avgSleepIQ || json.sleepIQAvg; // `or`, as asyncsleepiq
  const score = finiteInteger(raw, 0, 100);
  return score === undefined || score === 0 ? undefined : score;
}

/** Whether `zone` is an IANA time zone Node knows. */
export function validTimezone(zone) {
  if (typeof zone !== 'string' || zone === '') {
    return false;
  }
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/** The wall clock of `now` in `zone`, as sleepData wants its date: "2026-10-17T07:30:00". */
export function localDateTime(now, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(now))
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
