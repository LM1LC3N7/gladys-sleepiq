# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported to JavaScript from the two projects below. The ported
parts were rewritten, not copied; the changes are described below.

## asyncsleepiq

<https://github.com/kbickar/asyncsleepiq> (package `asyncsleepiq`), by Keilin
Bickar. MIT License (`LICENSE` of the repository). Its notice:

```
MIT License

Copyright (c) 2022 Keilin Bickar

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Ported in `src/constants.js`, `src/sleepiq.js`, `src/client.js`,
`src/model.js` and `src/inventory.js`: the API host, the key sign-in
(`PUT /rest/login`, then `_k=<key>` on every call), the browser User-Agent
and the `Accept-Version: 5.3.30` header, the new sign-in on a 401 or 404
answer, the endpoints (`bed`, `sleeper`, `bed/familyStatus`, `sleepData`,
`pauseMode`, `sleepNumber`, `foundation/system`, `foundation/status`,
`foundation/preset`, `foundation/motion`, `foundation/outlet`,
`foundation/footwarming`) and the `bamkey` commands of the "fuzion" beds, the
foundation types and their actuators and presets, the feature flags, the
outlets, the foot warming and core climate values, the reading of the sleep
score of the night. Changed: one sign-in per cycle at most, and a refused
password or session stops with bounded, spaced new tries; a 429 pauses
every path; the sides are matched to the sleepers by their id (not by an
index); the nightstand outlets (1 and 2) are left out; a bamkey `FAIL`
answer is an error; the foot warming and the core climate are read only; the
date of the sleep data is the wall clock of a configured time zone.

## Home Assistant, SleepIQ integration

<https://github.com/home-assistant/core>, `homeassistant/components/sleepiq`,
by the Home Assistant authors. Apache License 2.0 (the same text as
`LICENSE`; no `NOTICE` file).

Ported in `src/model.js`, `src/devices.js` and `src/app.js`: the removal of
the "Firmness Control" controller that duplicates a bed and of the sleepers
seen twice, the features shown (in bed, firmness 5 to 100 by 5, pressure,
sleep score, actuator positions, foundation preset, lights, foot warming,
core climate), the presence read every minute and the sleep data every
hour. Changed: the firmness and the preset are selects refused unless the
configuration allows the commands, with a fresh read before each command;
the positions are read only (presets only, never a free position); the
foot warming and the core climate are read only; the foundation, lights and
climate are read every 5 minutes; "in bed" and "out of bed" scene triggers.
