# gladys-sleepiq

[Gladys Assistant](https://gladysassistant.com) external integration for
**Sleep Number** beds (United States) through the SleepIQ cloud: per side,
in bed (read every minute, with "in bed" / "out of bed" scene triggers),
firmness, raw pressure and the sleep score of the night; the foundation
(head and foot positions, preset), the night light, the foot warming and the
core climate when the bed has them. The firmness, the foundation presets,
the foundation stop and the night light can be changed behind an
off-by-default option. **Unofficial API, never tested with a real account.
Not affiliated with Sleep Number.**

User documentation: [docs/en.md](docs/en.md) · [docs/fr.md](docs/fr.md).

## How it works

```
Gladys ⇄ SDK ⇄ src/handlers.js ⇄ src/app.js (SleepIQApp)
                                  ├─ src/client.js     key sign-in, reads (one new sign-in + retry), commands
                                  ├─ src/sleepiq.js    the only HTTP access, errors (no secret, no free text)
                                  ├─ src/inventory.js  bed parts: probes and reads (classic REST, fuzion bamkey)
                                  ├─ src/model.js      answers -> beds, presence, positions, presets, score (pure)
                                  ├─ src/devices.js    the devices and their states (pure)
                                  ├─ src/events.js     in bed / out of bed scene events (pure)
                                  ├─ src/publisher.js  states and scene events within 300/min
                                  └─ src/store.js      /data/sleepiq-state.json
```

- **Sign-in** (as asyncsleepiq): `PUT /rest/login` with the e-mail and the
  password answers a key, sent as `_k=<key>` on every call; the key is kept
  (in `/data`, with a hash of the e-mail) and reused at every cycle and after
  a restart. A 401 (or a 404, as asyncsleepiq reads it) of a main read signs
  in once and retries once: never more than one sign-in per cycle.
- **Devices**: `bed:<bedId>` (someone in bed, the shared parts of a single
  foundation, the fuzion under-bed light) and `side:<bedId>:left|right` for
  each side with a sleeper. Ids come from the API's bed id and the side: they
  never change. A republished device keeps every feature of the created one.
- **Reads**: `bed/familyStatus` every minute (main: in bed, firmness,
  pressure); the foundation, the lights, the foot warming and the climate
  every 5 minutes, the sleep score every hour, the beds and their parts every
  6 hours (secondary: no sign-in, a failure never hides the presence).
- **Scene triggers** `in_bed` / `out_of_bed`, per side, never at the first
  reading nor after a gap of more than 5 minutes.
- **Commands** (`allow_commands`, off by default): the firmness (5 to 100 by 5) and the foundation preset are `text`/`select`, the stop a
  `button`/`push`, the night light the only `light`/`binary`. Each command
  reads the state first (except the stop), is sent within 3.5 s of the click
  or refused unsent, and Gladys is answered within 4.3 s; one at a time;
  never retried. The foot warming and the climate are read only.
- **Errors**: a refused password or a rejected sign-in stops, one new try
  after 6 h then every 24 h; a key refused right after a new sign-in: 1 h,
  6 h, then 24 h; 429: `Retry-After` bounded to 1 min – 6 h (15 min without),
  every path; 403 of the main read: one hour; 5xx/network: 2 to 30 minutes,
  never under the minute. Pauses and stops are kept in `/data`, bounded to
  24 h at a restart, and survive a reconnection to Gladys.

## Credits

The sign-in, the endpoints, the bamkey commands and the reading of the beds
are ported from [asyncsleepiq](https://github.com/kbickar/asyncsleepiq)
(Keilin Bickar, MIT); the features and intervals from the
[Home Assistant SleepIQ integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/sleepiq)
(Apache-2.0). See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). Modelled
on the sibling integrations
[gladys-surepetcare](https://github.com/LM1LC3N7/gladys-surepetcare) (cloud
account, scene triggers) and [gladys-ohme](https://github.com/LM1LC3N7/gladys-ohme)
(e-mail and password, commands).

## Development

```bash
npm install
npm test                                        # node --test, no network
npm run lint && npm run format:check
npm run audit                                   # npm audit --omit=dev
npx github:GladysAssistant/integration-store .  # store admission checks
```

Tests never touch the network: SleepIQ is a fake behind the injected
transport, Gladys is the SDK's fake; `test/sleepiq.test.js` runs the real
transport against a loopback server.

## Releasing

**Actions → Release → Run workflow** (patch / minor / major): bumps the
version in `package.json` and the manifest, rolls `CHANGELOG.md`, tags, builds
the multi-arch image to GHCR and publishes the GitHub Release.

## License

Apache-2.0 (`LICENSE`). The ported logic comes from MIT and Apache-2.0
projects, credited in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) (also
shipped in the Docker image).
