# TODO — SleepIQ v1

Handoff document: what is done, what was decided, what comes next. Keep it
up to date at the end of every milestone.

## Working method

- One milestone at a time, one commit per milestone, tests green before moving on.
- After each milestone: `npm run format:check`, `npm run lint`, `npm test`
  (Node 22 and 24), `npm run audit`, `npx github:GladysAssistant/integration-store .`,
  then update README, `docs/en.md`, `docs/fr.md`, `CHANGELOG.md` and this file.
- No forum topic of its own, no forum post from a module session: the batch
  reserved in /t/10385 (post #241) gets one recap message there.
- The `gladys-assistant-integration` topic is added at the first real release only.

## Status

- [x] **Milestone 1 — core** (2026-10-17): key sign-in, key kept in `/data`
      and reused, one device per bed and one per side with a sleeper, in bed
      (every minute), firmness, raw pressure, sleep score (hourly), foundation
      positions and preset, night lights, foot warming and climate (every 5
      min, read only for the last two), classic and fuzion beds, in bed / out
      of bed scene triggers, firmness / preset / stop / night light behind
      `allow_commands` (off), stops and pauses persisted and bounded, test
      button, docs en/fr, cover. Tested against made-up answers only.
- [ ] **Milestone 2 — real account**: run against a real account and bed
      (see "To check"), turn the answers (anonymized) into fixtures.
- [ ] **Milestone 3 — more**: privacy (pause) mode as a read-only state, the
      sleep duration / heart rate / breathing of the night (Home Assistant's
      newer sensors), favorite firmness, a responsive presence (shorter
      interval while someone is getting up?) if the API tolerates it.

## To check on a real account

- The sign-in: `PUT /rest/login` answers `{ key }` (asyncsleepiq's
  `LOGIN_KEY`); a wrong password is a 401; a 403 means "User Agent is
  blocked". How long does a key live, and is a stale key a 401 or a 404
  (asyncsleepiq signs in again on both)? Are the cookies of the sign-in
  needed with the key (they are kept in memory and sent back, not
  persisted)?
- `bed/familyStatus`: `isInBed` a boolean, `pressure` and `sleepNumber`
  numbers, for both kinds of bed? For a fuzion bed, does `sleepNumber` follow
  the bed (here the bamkey `GetSleepNumberControls` value is preferred when
  known)? The format of `GetSleepNumberControls` ("false 30 45"?): the
  "updating" word is read as yes/true/1 or no/false/0, anything else refuses
  a firmness command.
- `foundation/status`: the hex positions and the preset names ("Flat", "Not
  at preset"…); `foundation/outlet` answering 404 for a missing outlet;
  `foundation/footwarming` values (0, 31, 57, 72).
- `sleepData`: which night does a wall-clock date of the configured time zone
  give (asyncsleepiq passes the local "now")? `sleepQuotient` 0 when there is
  no session (read as "no score" here).
- Bamkey answers: always `PASS:<text>`? What does a failure look like (read
  here as `FAIL…` / `ERR…`)? `HaltAllActuators` stops both sides.
- Rate limits: none documented; watch for 429, `Retry-After`. About 5
  requests per minute per bed at most outside the 5-minute reads.

## Decisions

- **Version 0.1.0 set by hand** in `package.json`, `package-lock.json`, the
  manifest and the `docker_image` tag (`ghcr.io/lm1lc3n7/gladys-sleepiq:0.1.0`);
  the first patch release gives 0.1.1. `test/manifest.test.js` checks the
  four agree.
- **Own client on `node:https`, no Python**: asyncsleepiq (MIT, the library
  of Home Assistant) ported (~1,200 lines with comments); the Home Assistant integration
  (Apache-2.0) for the features and the intervals. No maintained npm client
  exists. Credited in README and `THIRD_PARTY_NOTICES.md` (full MIT notice,
  shipped in the image with `LICENSE`, the standard Apache-2.0 text without
  any name, copied from gladys-tedee). Runtime dependency: the SDK only.
- **User-Agent**: a fixed browser User-Agent, like asyncsleepiq (which picks
  a random one): the SleepIQ sign-in answers 403 "User Agent is blocked" to
  some clients, so an honest `gladys-sleepiq/0.1` would likely be refused.
  Plus `Accept-Version: 5.3.30` as asyncsleepiq.
- **Password**: in the Gladys `secret` field (kept by Gladys in its database,
  never shown again, sent only to the SleepIQ sign-in). `/data` never holds
  the e-mail nor the password; it holds the key (0600), the account as
  `sha256(e-mail)[0..16]`, the 429/403 pause and the stop. The key is in the
  query string (`_k`): no URL is ever logged.
- **Session (brief: "renouvelée sans reconnexion à chaque cycle")**: the key
  is reused until the API refuses it; a 401 or 404 of a main read signs in
  once and retries once (asyncsleepiq); at most one sign-in per cycle; a 401
  right after a new sign-in is `session_refused` (1 h, 6 h, 24 h); a 404 then
  is a real 404 (backoff). Secondary reads never sign in. A command never
  signs in in a loop (a 401 there is left to the next main read).
- **Stops (brief: "refus → arrêt avec relance bornée")**: a refused
  e-mail/password (401) or a rejected sign-in (403 "User Agent is blocked",
  other 4xx) stops, with one new try after 6 h then every 24 h (never dead
  without a timer, spaced so a wrong password cannot lock the account);
  persisted per account and bounded to 24 h at a restart; a change of
  credentials or the test button lifts it.
- **429**: `Retry-After` bounded to 1 min – 6 h, 15 min without it; applies
  to the polling, the secondary reads, the button and the commands (also
  answered in the background); persisted and kept across Gladys
  reconnections and account changes. **403** of the main read: one hour,
  same scope. **5xx/network**: 2, 5, 10, 15, then 30 minutes, never shorter
  than the 1-minute interval.
- **Intervals**: presence (`bed/familyStatus`: in bed, firmness, pressure)
  every 60 s (brief, Home Assistant); foundation, lights, foot warming,
  climate (and the fuzion firmness) every 5 minutes; sleep score every hour
  (Home Assistant); beds, sleepers and their parts every 6 hours. A failed
  secondary read waits its own interval (lot-6 lesson); a part probe that
  fails is tried again after 5 minutes.
- **Devices and ids**: `bed:<bedId>` and `side:<bedId>:left|right` (brief:
  bed id + side, not the sleeper id Home Assistant uses for its firmness).
  Bed ids are checked (`-?[A-Za-z0-9_]{1,64}`). A side gets a device only
  when the app has a sleeper on it (asyncsleepiq builds sleepers the same
  way); its foundation parts are left out otherwise. Single-foundation parts
  (side "none" in asyncsleepiq) belong to the bed device. The bed device
  always has "Someone in bed" (any side).
- **Never lose a feature**: the devices published to Discovery always keep
  every feature of the created device (`gladys.devices`, read at each
  publish), copied as created (lot-6 lesson).
- **Beds skipped**: the "Firmness Control" controller and duplicate sleepers
  (Home Assistant); a bed whose `pauseMode` (classic) or privacy state
  (fuzion) answers a 4xx (asyncsleepiq `valid()`); 10 beds at most.
- **Features and units**: in bed and someone in bed on `motion-sensor`/
  `binary` (the core maps the Zigbee `occupancy` and `presence` sensors
  there; `presence-sensor` is the core's user presence, not used);
  firmness, raw pressure, sleep score, head and foot positions on
  `unknown`/`integer` without unit (no core unit fits: Sleep Number is a
  setting, the pressure is a raw value, the positions are 0-100 of the
  actuator, the score has no unit); preset, foot warming and climate as
  `text`. All fixed at creation. Sleep score: an integer (the brief allowed
  text or integer), not published when there is none (a 0 is "no score").
- **Scene triggers** `in_bed` / `out_of_bed` with two `source: devices`
  filters (bed, side) and five variables. Never on the first reading of a
  side (start, restart, new account), never when the previous reading is
  more than 5 minutes old (an outage, a pause: logged only), never on an
  unknown value. The previous presence is in memory only (a restart starts
  a new baseline). `gladys_version >= 5.1.0` for `scene_triggers`.
- **Commands** (`allow_commands`, off by default; brief): firmness as a
  `text`/`select` of 5 to 100 by 5 (any other value refused), foundation
  presets as a `text`/`select` of the presets the bed offers, a
  `button`/`push` "Stop the foundation" (added for safety: a preset moves
  the bed with someone on it), the night light as `light`/`binary`. A fresh
  read before each command (familyStatus or the fuzion controls for the
  firmness, foundation status / current preset, the outlet / under-bed
  light), nothing sent when already so, a firmness change refused while a
  fuzion bed reports it is adjusting, refused when the state cannot be read;
  the stop is sent without a read (always safe). One command at a time,
  never retried; nothing sent after 3.5 s, Gladys answered at 4.3 s at the
  latest, a read 10 s after.
- **Night light as a light (brief: "switch acceptable pour une lumière ?
  juge et note")**: yes, `light`/`binary`. A "turn the lights off" reaching
  a night light is what a user expects, and both directions are harmless;
  still refused while the commands are off. Only the night lights (classic
  outlets 3 right and 4 left, the fuzion under-bed light): the nightstand
  outlets 1 and 2 may power any appliance and are not shown at all.
- **No free positions**: the head and foot positions are read only; only
  presets move the foundation (brief: "presets, jamais en continu"). No
  massage.
- **Foot warming and climate read only**: the brief lists them as readings;
  heating or cooling a bed from an automation was not asked for.
- **Timezone**: a configuration field (default America/Chicago, Sleep
  Number's home time zone) used for the date of the sleep data
  (asyncsleepiq sends the local wall clock; the container runs in UTC).
- **Language**: default `fr`, as the sibling integrations (the bed itself is
  sold in the US: an English user switches it).
- **Reconnection to Gladys** (`connected`): republishes the status, the
  devices, the states and the badges (their dedup caches emptied); never
  clears the pauses, the stops, the key nor the presence baseline.
- **Category `appliances`** in the store.
- **Not checked here (PIPELINE step 1, main session)**: duplicates in the
  store, the core and the forum were checked when the batch was reserved
  (post #241). No Docker on this PC: the image was not built locally.
