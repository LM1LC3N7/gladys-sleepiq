// -----------------------------------------------------------------------------
// What must survive a restart, in /data (the only writable place of the
// container), never the e-mail nor the password:
//   - the SleepIQ key, with the account it belongs to (a hash of the e-mail),
//     so a restart does not sign in again;
//   - the end of a 429 or 403 pause (kept across restarts and account changes);
//   - a stop after a refusal and its next try (per account), so a restart
//     never sends refused credentials again before their time.
// Every time read back is bounded: a stop holds at most 24 h after a
// restart, a 429 pause 6 h, a 403 pause 1 h. The file is readable by the container user only (0600).
// -----------------------------------------------------------------------------

import { readFile, rename, writeFile } from 'node:fs/promises';
import { TIMINGS } from './constants.js';

export const STATE_FILE = '/data/sleepiq-state.json';

export function fileStore(path = STATE_FILE) {
  // One write at a time: two saves never share the temporary file.
  let chain = Promise.resolve();
  return {
    async load() {
      try {
        return JSON.parse(await readFile(path, 'utf8'));
      } catch {
        return null;
      }
    },
    save(data) {
      const text = JSON.stringify(data);
      const write = chain.then(async () => {
        const temporary = `${path}.tmp`;
        await writeFile(temporary, text, { mode: 0o600 });
        await rename(temporary, path);
      });
      chain = write.catch(() => {});
      return write;
    },
  };
}

const time = (value) => (Number.isFinite(value) ? value : undefined);
const string = (value, max) =>
  typeof value === 'string' && value !== '' && value.length <= max ? value : undefined;

/** A time read back from /data: in the future, at most `max` away (24 h), else undefined. */
export const bounded = (value, now, max = TIMINGS.persistedMax) => {
  const t = time(value);
  return t !== undefined && t > now ? Math.min(t, now + max) : undefined;
};

/** The longest pause of each kind: a 429 at most 6 h, a 403 at most 1 h. */
const PAUSE_MAX = { rate: TIMINGS.rateLimitMax, forbidden: TIMINGS.forbiddenPause };

const STOPS = new Set(['refused', 'login_rejected', 'session_refused']);

/** The persisted state, repaired and bounded. */
export function normalizeMemory(raw, now) {
  const s = raw?.session;
  const session =
    string(s?.account, 64) && string(s?.key, 512)
      ? { account: s.account, key: s.key, at: time(s.at) ?? 0 }
      : null;
  const b = raw?.block;
  const retryAt = bounded(b?.retryAt, now);
  const block =
    string(b?.account, 64) && STOPS.has(b?.kind) && retryAt !== undefined
      ? {
          account: b.account,
          kind: b.kind,
          retryAt,
          retries: Number.isInteger(b.retries) && b.retries >= 0 ? Math.min(b.retries, 10) : 0,
          status: Number.isInteger(b.status) ? b.status : undefined,
        }
      : null;
  const pause = raw?.pause;
  const max = Object.hasOwn(PAUSE_MAX, pause?.kind) ? PAUSE_MAX[pause.kind] : undefined;
  const until = max === undefined ? undefined : bounded(pause.until, now, max);
  return {
    session,
    pause: until !== undefined ? { kind: pause.kind, until } : null,
    block,
  };
}
