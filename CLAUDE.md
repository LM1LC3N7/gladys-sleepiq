# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for
human contributors. Read **[TODO.md](./TODO.md) first**: status, decisions
already taken and the next milestones.

## What this is

A Gladys Assistant **external integration** of type `device`: a Node.js
service (Node 22+, ESM, no build step) in its own sandboxed Docker container,
talking to Gladys through `@gladysassistant/integration-sdk` (v0.15), its only
runtime dependency (HTTPS goes through `node:https`). It signs in to the
SleepIQ cloud (e-mail and password of the app), reads the Sleep Number beds
and shows one Gladys device per bed and one per side; firmness, foundation
presets, a foundation stop and the night light can be changed behind an
off-by-default option. Unofficial API, never tested with a real account, not
affiliated with Sleep Number.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npm run audit                             # npm audit --omit=dev
npx github:GladysAssistant/integration-store .   # store admission checks
```

Run `format:check`, `lint`, `test` (Node 22 and 24) and `audit` before every
commit.

## Architecture

```
index.js            SDK bootstrap only
src/handlers.js     every SDK handler -> the app (shared with the tests)
src/app.js          SleepIQApp: cycle and its timer, failures, stops and pauses,
                    devices, states, scene events, badges, the test button, the commands
src/client.js       key sign-in, reads (one new sign-in + retry), checks, commands (never retried), bamkey
src/sleepiq.js      the only network access (node:https, bounded), errors (no secret)
src/inventory.js    bed parts: probes and reads, classic (REST) and fuzion (bamkey)
src/model.js        answers -> beds, presence, positions, presets, lights, score (pure)
src/devices.js      -> the Gladys devices and their states (pure)
src/events.js       in bed / out of bed scene events (pure)
src/publisher.js    states and scene events within 300/min
src/store.js        /data/sleepiq-state.json: key, pause, stop (bounded to 24 h)
src/config.js       config_schema normalized, account key (hash of the e-mail)
src/constants.js    host, paths, bamkey codes, presets, feature roles, limits, timings
src/i18n.js         runtime texts, device, feature and value names (en/fr)
test/fixtures/      answers shaped like what asyncsleepiq reads
test/helpers/       a fake SleepIQ behind the transport; Gladys is the SDK's fake
```

## Rules

- **External ids are forever**: devices `bed:<bedId>` and
  `side:<bedId>:left|right`; features `occupied`, `in-bed`, `firmness`,
  `set-firmness`, `pressure`, `sleep-score`, `head-position`,
  `foot-position`, `foundation-preset`, `set-foundation-preset`,
  `stop-foundation`, `night-light`, `foot-warming`, `climate`. A republished
  device keeps every feature of the created one (`keepCreated`).
- Manifest keys (`email`, `password`, `allow_commands`, `timezone`,
  `language`, the action `test_connection`, the scene triggers `in_bed` and
  `out_of_bed` and their field/variable keys) are frozen.
- **Commands**: never a switch nor a binary feature, except the night light
  (a light); refused unless `allow_commands`; a fresh read before acting
  (the stop excepted), never sent after 3.5 s, never retried, one at a time.
  Presets only, never a free foundation position; foot warming and climate
  are read only (the integration never heats nor cools).
- **Never sign in in a loop**: one sign-in per cycle at most, stops with
  spaced new tries (6 h, 24 h). 429 pauses every path. Never log or put in a
  message the e-mail, the password, the key (it is in the query string:
  never log a URL), or the free text of an answer.
- Units only from the core's `DEVICE_FEATURE_UNITS_BY_CATEGORY` (none here);
  a `secret` field is kept by Gladys in its database, never write that it is
  encrypted.
- Files are UTF-8 without BOM (`test/encoding.test.js`); tests never touch
  the network.
- Code, comments, README in English; `docs/en.md` and `docs/fr.md` kept in sync.
- Every user-visible change adds a line under `## [Unreleased]` in
  `CHANGELOG.md`; versions belong to the Release workflow.
