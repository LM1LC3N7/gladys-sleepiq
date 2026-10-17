// -----------------------------------------------------------------------------
// Made-up SleepIQ answers, shaped like what asyncsleepiq reads (no real
// account was available: the field names are those asyncsleepiq and Home
// Assistant use).
// -----------------------------------------------------------------------------

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

/** 2026-10-17 12:00 UTC (07:00 in Chicago). */
export const NOW = Date.UTC(2026, 9, 17, 12, 0, 0);

export const EMAIL = 'sleeper@example.com';
export const PASSWORD = 'Sécret-Pass 42!';
export const ACCOUNT_ID = '-9223372019953519136';
/** A classic split king with a foundation, two night lights and foot warming. */
export const BED = '-9223372019941084149';
/** A fuzion bed (bamkey). */
export const FUZION_BED = '-9223372019941099999';
export const LEFT_SLEEPER = '-9223372019953519137';
export const RIGHT_SLEEPER = '-9223372019953519138';
export const FUZION_SLEEPER = '-9223372019953519139';

export const bed = (overrides = {}) => ({
  registrationSiteId: '-9223372019953519135',
  reference: '5000000-1',
  macAddress: '64DBA0000000',
  version: '',
  purchaseDate: '2024-01-01T00:00:00Z',
  accountId: ACCOUNT_ID,
  sleeperRightId: RIGHT_SLEEPER,
  base: 'FlexFit',
  returnRequestStatus: 0,
  size: 'KING',
  name: 'Master bed',
  serial: '',
  isKidsBed: false,
  dualSleep: true,
  bedId: BED,
  status: 1,
  sleeperLeftId: LEFT_SLEEPER,
  generation: '360',
  model: 'P6',
  ...overrides,
});

export const fuzionBed = (overrides = {}) =>
  bed({
    bedId: FUZION_BED,
    name: 'Guest bed',
    generation: 'fuzion',
    model: 'Climate360',
    sleeperLeftId: FUZION_SLEEPER,
    sleeperRightId: '0',
    ...overrides,
  });

export const sleepers = () => ({
  sleepers: [
    { sleeperId: LEFT_SLEEPER, bedId: BED, firstName: 'Ann', side: 0, active: true },
    { sleeperId: RIGHT_SLEEPER, bedId: BED, firstName: 'Bob', side: 1, active: true },
    { sleeperId: FUZION_SLEEPER, bedId: FUZION_BED, firstName: 'Cleo', side: 0, active: true },
  ],
});

export const side = (overrides = {}) => ({
  isInBed: false,
  alertDetailedMessage: 'No Alert',
  sleepNumber: 40,
  alertId: 0,
  lastLink: '00:00:00',
  pressure: 1088,
  ...overrides,
});

export const familyStatus = (beds = [BED], sides = {}) => ({
  beds: beds.map((bedId) => ({
    status: 1,
    bedId,
    leftSide: side(sides[`${bedId}:left`]),
    rightSide: side({ sleepNumber: 55, pressure: 1500, ...sides[`${bedId}:right`] }),
  })),
});

/** fsBedType 2 (splitKing), fsBoardFeatures with foot warming (bit 3). */
export const foundationSystem = (overrides = {}) => ({
  fsBedType: 2,
  fsBoardFeatures: 0b1000,
  fsBoardHWRevisionCode: 1,
  fsBoardStatus: 0,
  fsLeftUnderbedLightPWM: 1,
  fsRightUnderbedLightPWM: 1,
  ...overrides,
});

export const foundationStatus = (overrides = {}) => ({
  fsCurrentPositionPresetLeft: 'Flat',
  fsCurrentPositionPresetRight: 'Not at preset',
  fsLeftHeadPosition: '00',
  fsLeftFootPosition: '00',
  fsRightHeadPosition: '1e',
  fsRightFootPosition: '0a',
  fsNeedsHoming: false,
  fsType: 'Split King',
  ...overrides,
});

export const footWarming = (overrides = {}) => ({
  footWarmingStatusLeft: 0,
  footWarmingStatusRight: 31,
  footWarmingTimerLeft: 0,
  footWarmingTimerRight: 120,
  ...overrides,
});

export const sleepData = (score = 82) => ({
  sleeperId: LEFT_SLEEPER,
  inBedTotal: 28000,
  avgSleepIQ: 70,
  sleepData: [
    {
      date: '2026-10-17',
      sessions: [
        { startDate: '2026-10-16T23:10:00', longest: false, sleepQuotient: 40, inBed: 1200 },
        { startDate: '2026-10-17T00:05:00', longest: true, sleepQuotient: score, inBed: 26000 },
      ],
    },
  ],
});
