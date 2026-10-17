# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.1] - 2026-10-17

### Added

- Sign-in to the SleepIQ cloud with the e-mail and the password of the
  SleepIQ app (like asyncsleepiq); the session key kept in `/data` and reused,
  no sign-in per cycle.
- One device per Sleep Number bed (someone in bed, shared foundation, under-bed
  light) and one per side with a sleeper: in bed, firmness, raw pressure,
  sleep score of the night, head and foot positions, foundation preset, night
  light, foot warming and heating/cooling when the bed has them. Classic and
  "fuzion" beds.
- "Got into bed" and "Got out of bed" scene triggers, per bed and per side,
  never fired by the first reading after a start nor after a gap.
- Firmness (5 to 100 by 5), foundation presets, a foundation stop button and
  the night light, refused unless "Allow the commands" is on (off by
  default); each command reads the bed first and is answered within Gladys'
  5 s.
- Presence read every minute; foundation and lights every 5 minutes; sleep
  score every hour.
- Resilience: a refused password stops with one new try after 6 h then every
  24 h; a refused session after 1 h, 6 h, 24 h; 429 pauses every path (1
  minute to 6 hours), 403 one hour, kept in `/data`; 5xx and network errors
  retried after 2 to 30 minutes.
- "Test the connection" button; documentation in English and French;
  `LICENSE` and `THIRD_PARTY_NOTICES.md` shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-sleepiq/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/LM1LC3N7/gladys-sleepiq/releases/tag/v0.1.1
