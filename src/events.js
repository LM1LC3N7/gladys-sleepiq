// -----------------------------------------------------------------------------
// The scene events of the beds (pure): who got into or out of bed between two
// readings of bed/familyStatus.
//
// Never on the first reading of a side (a start, a restart, a new account):
// that is the state found, not a change. Never either when the previous
// reading is older than TIMINGS.eventMaxGap (a pause, an outage): the change
// happened at an unknown time, it is history, not news. An unknown value
// (isInBed not a boolean) keeps the previous reading and fires nothing.
// -----------------------------------------------------------------------------

import { SCENE_TRIGGERS, SIDES, TIMINGS } from './constants.js';

/**
 * The events of one bed, and the readings to keep for the next comparison.
 * @param {Map<string, { inBed: boolean, at: number }>} previous - `${bedId}:${side}` -> last reading
 * @returns {{ events: object[], stale: object[], next: Map }}
 */
export function presenceEvents(previous, bed, presence, now) {
  const events = [];
  const stale = [];
  const next = new Map();
  for (const side of SIDES.filter((s) => bed.sides[s])) {
    const key = `${bed.id}:${side}`;
    const before = previous.get(key);
    const inBed = presence?.[side]?.inBed;
    if (typeof inBed !== 'boolean') {
      if (before) {
        next.set(key, before);
      }
      continue;
    }
    next.set(key, { inBed, at: now });
    if (!before || before.inBed === inBed) {
      continue;
    }
    const event = {
      key: inBed ? SCENE_TRIGGERS.IN_BED : SCENE_TRIGGERS.OUT_OF_BED,
      bedId: bed.id,
      side,
    };
    (now - before.at <= TIMINGS.eventMaxGap ? events : stale).push(event);
  }
  return { events, stale, next };
}
