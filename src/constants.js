// -----------------------------------------------------------------------------
// SleepIQ cloud constants, manifest keys, limits and timings.
//
// The API is the one of the SleepIQ app, undocumented. The host, the key
// sign-in (`PUT /rest/login`, then `_k=<key>` on every call), the paths, the
// bamkey commands of the "fuzion" beds and the values of the presets, the
// foot warming and the core climate are those of asyncsleepiq (MIT,
// kbickar/asyncsleepiq); the intervals and the features shown follow the
// SleepIQ integration of Home Assistant (Apache-2.0).
// -----------------------------------------------------------------------------

export const API_URL = 'https://prod-api.sleepiq.sleepnumber.com/rest';
export const API_HOST = new URL(API_URL).host;

/**
 * asyncsleepiq sends a browser User-Agent, because the sign-in answers 403
 * ("User Agent is blocked") to some others; it also asks for the API version
 * 5.3.30. A fixed one here (asyncsleepiq picks one at random).
 */
export const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/97.0.4692.99 Safari/537.36',
  'Accept-Version': '5.3.30',
};

/** Shown to the API as `sourceApplication` of the bamkey calls (asyncsleepiq sends its own name). */
export const SOURCE_APPLICATION = 'Gladys SleepIQ';

const id = (value) => encodeURIComponent(value);

/** API paths, relative to API_URL. */
export const PATHS = {
  login: 'login',
  beds: 'bed',
  sleepers: 'sleeper',
  familyStatus: 'bed/familyStatus',
  sleepData: 'sleepData',
  pauseMode: (bed) => `bed/${id(bed)}/pauseMode`,
  sleepNumber: (bed) => `bed/${id(bed)}/sleepNumber`,
  foundationSystem: (bed) => `bed/${id(bed)}/foundation/system`,
  foundationStatus: (bed) => `bed/${id(bed)}/foundation/status`,
  foundationPreset: (bed) => `bed/${id(bed)}/foundation/preset`,
  foundationMotion: (bed) => `bed/${id(bed)}/foundation/motion`,
  outlet: (bed) => `bed/${id(bed)}/foundation/outlet`,
  footWarming: (bed) => `bed/${id(bed)}/foundation/footwarming`,
  bamkey: (account, bed) => `sn/v1/accounts/${id(account)}/beds/${id(bed)}/bamkey`,
};

/** The bamkey commands of the "fuzion" beds (asyncsleepiq's BAMKEY). */
export const BAMKEY = {
  HALT_ALL_ACTUATORS: 'ACHA',
  GET_SYSTEM_CONFIGURATION: 'SYCG',
  GET_PRIVACY_STATE: 'SPRG',
  START_SLEEP_NUMBER_ADJUSTMENT: 'PSNS',
  GET_SLEEP_NUMBER_CONTROLS: 'SNCG',
  SET_UNDERBED_LIGHT: 'UBLS',
  GET_UNDERBED_LIGHT: 'UBLG',
  GET_ACTUATOR_POSITION: 'ACTG',
  SET_PRESET: 'ASTP',
  GET_CURRENT_PRESET: 'AGCP',
  GET_FOOT_WARMING_PRESENCE: 'FWPG',
  GET_FOOT_WARMING: 'FWTG',
  GET_HEIDI_PRESENCE: 'THPG',
  GET_HEIDI_MODE: 'THMG',
  GET_CLIMATE_PRESENCE: 'CLPG',
  GET_CLIMATE_MODE: 'CLMG',
};

/** The flags of GetSystemConfiguration, in order (asyncsleepiq's FEATURE_NAMES). */
export const FUZION_FLAGS = [
  'bedType',
  'pressureControlEnabledFlag',
  'articulationEnableFlag',
  'underbedLightEnableFlag',
  'rapidSleepSettingEnableFlag',
  'thermalControlEnabledFlag',
  'rightHeadActuator',
  'rightFootActuator',
  'leftHeadActuator',
  'leftFootActuator',
  'flatPreset',
  'favoritePreset',
  'snorePreset',
  'zeroGravityPreset',
  'watchTvPreset',
  'readPreset',
];

/** fsBedType of a classic foundation (asyncsleepiq's FOUNDATION_TYPES). */
export const FOUNDATION_TYPES = ['single', 'splitHead', 'splitKing', 'easternKing'];

export const SIDES = ['left', 'right'];
/** A shared part of the bed (a single foundation): it belongs to the bed device. */
export const NONE = 'none';
export const SIDE_LETTER = { left: 'L', right: 'R', [NONE]: 'R' };
/** asyncsleepiq reads a shared part under the "Right" keys. */
export const SIDE_KEY = { left: 'Left', right: 'Right', [NONE]: 'Right' };

/** The foundation presets: our value -> the classic API number and the fuzion bamkey word. */
export const PRESETS = {
  flat: { classic: 4, fuzion: 'flat', flag: 'flatPreset' },
  favorite: { classic: 1, fuzion: 'favorite', flag: 'favoritePreset' },
  read: { classic: 2, fuzion: 'read', flag: 'readPreset' },
  watch_tv: { classic: 3, fuzion: 'watch_tv', flag: 'watchTvPreset' },
  zero_g: { classic: 5, fuzion: 'zero_g', flag: 'zeroGravityPreset' },
  snore: { classic: 6, fuzion: 'snore', flag: 'snorePreset' },
};
export const PRESET_VALUES = Object.keys(PRESETS);
/** What the foundation shows between two presets. */
export const NO_PRESET = 'none';

/**
 * The classic night lights: outlets 3 (right) and 4 (left). Outlets 1 and 2
 * are the nightstand sockets, which may power anything: never shown.
 */
export const NIGHT_LIGHTS = [
  { outlet: 3, side: 'right' },
  { outlet: 4, side: 'left' },
];
/** The single under-bed light of a fuzion bed. */
export const FUZION_LIGHT = 1;

/** Foot warming levels (classic values of asyncsleepiq's FootWarmingTemps). */
export const FOOT_WARMING = { 0: 'off', 31: 'low', 57: 'medium', 72: 'high' };
export const FOOT_WARMING_LEVELS = ['off', 'low', 'medium', 'high'];

/** Core climate (heating, cooling) of asyncsleepiq's CoreTemps -> our value. */
export const CLIMATE = {
  OFF: 'off',
  HEATING_PUSH_LOW: 'heating_low',
  HEATING_PUSH_MED: 'heating_medium',
  HEATING_PUSH_HIGH: 'heating_high',
  COOLING_PULL_LOW: 'cooling_low',
  COOLING_PULL_MED: 'cooling_medium',
  COOLING_PULL_HIGH: 'cooling_high',
};

/** Sleep Number: 5 to 100, by 5. */
export const FIRMNESS = { min: 5, max: 100, step: 5 };
export const FIRMNESS_OPTIONS = Array.from({ length: 20 }, (_, i) => 5 + i * 5);

/** Feature roles (the last part of the feature external ids): frozen. */
export const FEATURES = {
  OCCUPIED: 'occupied',
  IN_BED: 'in-bed',
  FIRMNESS: 'firmness',
  SET_FIRMNESS: 'set-firmness',
  PRESSURE: 'pressure',
  SLEEP_SCORE: 'sleep-score',
  HEAD_POSITION: 'head-position',
  FOOT_POSITION: 'foot-position',
  PRESET: 'foundation-preset',
  SET_PRESET: 'set-foundation-preset',
  STOP: 'stop-foundation',
  LIGHT: 'night-light',
  FOOT_WARMING: 'foot-warming',
  CLIMATE: 'climate',
};

export const ACTIONS = {
  TEST_CONNECTION: 'test_connection',
};

/** Scene triggers of the manifest: frozen. */
export const SCENE_TRIGGERS = {
  IN_BED: 'in_bed',
  OUT_OF_BED: 'out_of_bed',
};

export const LIMITS = {
  /** Gladys: 300 states per minute, 300 scene events per minute. */
  statesPerMinute: 300,
  sceneEventsPerMinute: 300,
  statesPerRequest: 100,
  /** Scene events kept while Gladys is unreachable. */
  queuedEvents: 100,
  /** Largest answer read: a household's beds and sleepers are a few KB. */
  responseBytes: 1024 * 1024,
  /** Longest name kept from an answer (bed, sleeper, model). */
  textLength: 60,
  /** Beds of one account shown at most. */
  beds: 10,
  /** Cookies kept from the API (load balancer stickiness). */
  cookies: 20,
  cookieLength: 4096,
};

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;

export const TIMINGS = {
  /** asyncsleepiq waits 10 s. */
  requestTimeout: 10_000,
  /** The test button (60 s for Gladys): shorter requests, the worst case stays under 50 s. */
  quickTimeout: 8_000,
  quickBudget: 50_000,
  /** In-bed presence and firmness every minute (Home Assistant's interval). */
  presenceInterval: MINUTE,
  /** Foundation, lights, foot warming and climate every 5 minutes. */
  foundationInterval: 5 * MINUTE,
  /** The sleep score every hour (Home Assistant's interval). */
  sleepInterval: HOUR,
  /** The beds, the sleepers and the foundation features again every 6 hours. */
  inventoryInterval: 6 * HOUR,
  /**
   * A change of presence fires a scene trigger only when the previous reading
   * is at most this old: after a pause or an outage, it is history, not news.
   */
  eventMaxGap: 5 * MINUTE,
  /** Pauses after a failed read: 2, 5, 10, 15, then 30 minutes (never less than the interval). */
  backoff: [2 * MINUTE, 5 * MINUTE, 10 * MINUTE, 15 * MINUTE, 30 * MINUTE],
  /** 429: Retry-After bounded to 1 minute .. 6 hours, 15 minutes without it. */
  rateLimitMin: MINUTE,
  rateLimitMax: 6 * HOUR,
  rateLimitDefault: 15 * MINUTE,
  /** A 403 of the main read (bed/familyStatus): one hour, every path. */
  forbiddenPause: HOUR,
  /** A key refused right after a new sign-in: one new try after 1 h, 6 h, then every 24 h. */
  sessionRetry: [HOUR, 6 * HOUR, 24 * HOUR],
  /** A refused e-mail/password or a rejected sign-in: one new try after 6 h, then every 24 h. */
  refusedRetry: [6 * HOUR, 24 * HOUR],
  /** Longest a persisted pause or stop may still hold at a restart. */
  persistedMax: 24 * HOUR,
  /** The publisher sends what is pending every second; unchanged states again every 30 min. */
  flushInterval: 1_000,
  stateHeartbeat: 30 * MINUTE,
  /** The "Test the connection" button reads SleepIQ at most this often. */
  testCooldown: 30_000,
  /**
   * Commands (Gladys waits 5 s for the ack): the fresh read and the command
   * must be sent within 3.5 s of the click, or the command is refused unsent;
   * Gladys is answered at 4.3 s at the latest, the request finishing in the
   * background.
   */
  commandSendBy: 3_500,
  commandAck: 4_300,
  commandMinRead: 1_200,
  commandMinSend: 700,
  /** The read that follows a command, to show its effect. */
  refreshAfterCommand: 10_000,
};
