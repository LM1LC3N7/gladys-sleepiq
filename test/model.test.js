// -----------------------------------------------------------------------------
// The pure readers of the SleepIQ answers, and the time zone of the sleep data.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classicLayout,
  hexPosition,
  localDateTime,
  presetOf,
  readBeds,
  readClimate,
  readFamilyStatus,
  readFuzionFlags,
  readFuzionFootWarming,
  readFuzionLight,
  readOutlet,
  readSleepNumberControls,
  readSleepScore,
  validId,
  validTimezone,
} from '../src/model.js';
import { presenceEvents } from '../src/events.js';
import { BED, LEFT_SLEEPER, MINUTE, bed, sleepData, sleepers } from './fixtures/sleepiq.js';

test('readBeds: sides by sleeper id, names, the duplicates of Home Assistant skipped', () => {
  const { accountId, beds, skipped } = readBeds(
    {
      beds: [
        bed(),
        bed(),
        bed({ bedId: '77', model: 'Firmness Control', name: 'Remote' }),
        bed({ bedId: 'bad id!' }),
        bed({ bedId: '88', sleeperLeftId: '5', sleeperRightId: '5', name: '\u0007 Kids\n bed ' }),
        bed({ bedId: '99', sleeperLeftId: '', sleeperRightId: '0', model: undefined }),
      ],
    },
    sleepers(),
  );
  assert.equal(accountId, '-9223372019953519136');
  assert.equal(skipped, 3);
  assert.deepEqual(
    beds.map((b) => [b.id, b.name, Object.keys(b.sides)]),
    [
      [BED, 'Master bed', ['left', 'right']],
      ['88', 'Kids bed', ['left']],
      ['99', 'Master bed', []],
    ],
  );
  assert.deepEqual(beds[0].sides.left, { sleeperId: LEFT_SLEEPER, name: 'Ann' });
  assert.equal(beds[0].kind, 'classic');
  assert.equal(readBeds({ beds: [bed({ generation: 'fuzion' })] }).beds[0].kind, 'fuzion');
  assert.equal(
    readBeds({
      beds: [bed({ model: undefined, components: [{ base: 'BASE', model: 'FlexFit 3' }] })],
    }).beds[0].model,
    'FlexFit 3',
  );
  assert.deepEqual(readBeds(undefined, undefined).beds, []);
});

test('validId: digits, a minus sign, letters; nothing that could break an external id', () => {
  assert.ok(validId('-9223372019941084149'));
  assert.ok(validId(12345));
  assert.ok(!validId('a:b'));
  assert.ok(!validId('../x'));
  assert.ok(!validId(''));
  assert.ok(!validId(1.5));
});

test('readFamilyStatus: isInBed is a boolean or unknown, numbers bounded', () => {
  const status = readFamilyStatus({
    beds: [
      {
        bedId: BED,
        leftSide: { isInBed: true, pressure: '1200', sleepNumber: 35 },
        rightSide: { isInBed: 'true', pressure: -3, sleepNumber: 140 },
      },
      { bedId: 'x:y', leftSide: { isInBed: true } },
    ],
  });
  assert.deepEqual([...status.keys()], [BED]);
  assert.deepEqual(status.get(BED).left, { inBed: true, pressure: 1200, sleepNumber: 35 });
  assert.deepEqual(status.get(BED).right, {
    inBed: undefined,
    pressure: undefined,
    sleepNumber: undefined,
  });
  assert.equal(readFamilyStatus({}), undefined);
  assert.equal(readFamilyStatus(null), undefined);
});

test('the classic foundation: layouts, hex positions, presets', () => {
  assert.deepEqual(
    classicLayout('single').actuators.map((a) => `${a.side}-${a.end}`),
    ['none-head', 'none-foot'],
  );
  assert.deepEqual(classicLayout('splitHead').presets, ['left', 'right']);
  assert.equal(classicLayout('splitHead').actuators.at(-1).side, 'none');
  assert.equal(hexPosition('1e'), 30);
  assert.equal(hexPosition('64'), 100);
  assert.equal(hexPosition('ff'), undefined, 'above 100');
  assert.equal(hexPosition('zz'), undefined);
  assert.equal(hexPosition(30), undefined);
  assert.equal(presetOf('Watch TV'), 'watch_tv');
  assert.equal(presetOf('Zero G'), 'zero_g');
  assert.equal(presetOf('zero_g'), 'zero_g');
  assert.equal(presetOf('Not at preset'), 'none');
  assert.equal(presetOf('Massage'), undefined);
  assert.equal(readOutlet({ setting: 1 }), true);
  assert.equal(readOutlet({ setting: 0 }), false);
  assert.equal(readOutlet({ setting: 2 }), undefined);
});

test('the fuzion bamkey texts', () => {
  const flags = readFuzionFlags('dual yes yes yes yes no yes yes yes yes yes yes no yes no no');
  assert.equal(flags.bedType, false);
  assert.equal(flags.articulationEnableFlag, true);
  assert.equal(flags.thermalControlEnabledFlag, false);
  assert.equal(flags.readPreset, false);
  assert.equal(readFuzionFlags('').flatPreset, false, 'an empty answer has no feature');
  assert.equal(readFuzionFootWarming('medium 60'), 'medium');
  assert.equal(readFuzionFootWarming('boiling 60'), undefined);
  assert.equal(readClimate('heating_push_high 120'), 'heating_high');
  assert.equal(readClimate('cooling_pull_med 30'), 'cooling_medium');
  assert.equal(readClimate('toString'), undefined, 'own keys only');
  assert.equal(readFuzionLight('off 0'), false);
  assert.equal(readFuzionLight('high 0'), true);
  assert.equal(readFuzionLight(''), undefined);
  assert.deepEqual(readSleepNumberControls('false 30 45'), { updating: false, value: 45 });
  assert.deepEqual(readSleepNumberControls('1 30 45'), { updating: true, value: 45 });
  assert.deepEqual(readSleepNumberControls('maybe x'), { updating: undefined, value: undefined });
});

test('the sleep score: the longest session, else the longest by time, else the average', () => {
  assert.equal(readSleepScore(sleepData(82)), 82);
  assert.equal(
    readSleepScore({
      sleepData: [
        {
          sessions: [
            { sleepQuotient: 50, totalSleepSessionTime: 100 },
            { sleepQuotient: 70, totalSleepSessionTime: 900 },
          ],
        },
      ],
    }),
    70,
  );
  assert.equal(readSleepScore({ sleepData: [], avgSleepIQ: 64 }), 64);
  assert.equal(readSleepScore({ sleepData: [], sleepIQAvg: 61 }), 61);
  assert.equal(readSleepScore({ sleepData: [] }), undefined);
  assert.equal(readSleepScore({ avgSleepIQ: 0 }), undefined, 'no score is not a score of 0');
  assert.equal(readSleepScore({ avgSleepIQ: 150 }), undefined);
});

test('the date sent for the sleep data is the wall clock of the bed, west and east of it, around midnight', () => {
  // 2026-10-17 04:30 UTC: 23:30 the day before in Chicago, 21:30 in Los Angeles, 06:30 in Paris.
  const at = Date.UTC(2026, 9, 17, 4, 30, 0);
  assert.equal(localDateTime(at, 'America/Chicago'), '2026-10-16T23:30:00');
  assert.equal(localDateTime(at, 'America/Los_Angeles'), '2026-10-16T21:30:00');
  assert.equal(localDateTime(at, 'America/New_York'), '2026-10-17T00:30:00');
  assert.equal(localDateTime(at, 'Europe/Paris'), '2026-10-17T06:30:00');
  // Midnight itself is 00, never 24.
  assert.equal(
    localDateTime(Date.UTC(2026, 9, 17, 5, 0, 0), 'America/Chicago'),
    '2026-10-17T00:00:00',
  );
  assert.ok(validTimezone('America/Chicago'));
  assert.ok(!validTimezone('Mars/Olympus'));
  assert.ok(!validTimezone(''));
});

test('presence events: never at the first reading, never after a gap, never on an unknown value', () => {
  const b = { id: BED, sides: { left: {}, right: {} } };
  const t0 = 1_000_000;
  const first = presenceEvents(
    new Map(),
    b,
    { left: { inBed: true }, right: { inBed: false } },
    t0,
  );
  assert.deepEqual(first.events, []);
  const second = presenceEvents(
    first.next,
    b,
    { left: { inBed: false }, right: { inBed: 'yes' } },
    t0 + MINUTE,
  );
  assert.deepEqual(second.events, [{ key: 'out_of_bed', bedId: BED, side: 'left' }]);
  assert.deepEqual(second.next.get(`${BED}:right`), { inBed: false, at: t0 }, 'kept as it was');
  const late = presenceEvents(second.next, b, { left: { inBed: true } }, t0 + 30 * MINUTE);
  assert.deepEqual(late.events, []);
  assert.equal(late.stale.length, 1);
});
