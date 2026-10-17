# SleepIQ for Gladys

Shows your **Sleep Number** beds (United States) in Gladys, through the
SleepIQ cloud, with the account of the SleepIQ app.

> **Unofficial API, never tested with a real account nor a real bed.** The
> integration talks to the API of the SleepIQ app, like the asyncsleepiq
> library and the Home Assistant integration. Sleep Number may change it
> without notice. Not affiliated with Sleep Number.

## What you get

For each bed, **one device for the bed** and **one device per side**
somebody sleeps on (a side without a sleeper in the app has no device).

On the bed device:

| Feature                | Content                                                         |
| ---------------------- | --------------------------------------------------------------- |
| Someone in bed         | Yes when at least one side is occupied                          |
| Head / foot position   | 0 to 100, for a single foundation (shared by both sides)        |
| Foundation position    | The preset in use (Flat, Read…), for a single foundation        |
| Move the foundation to | Choice of presets (command, see below), for a single foundation |
| Stop the foundation    | Button (command), for a single foundation                       |
| Night light            | The under-bed light of the newer ("fuzion") beds (command)      |

On each side device:

| Feature                   | Content                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| In bed                    | Yes / no, read every minute                                       |
| Firmness (Sleep Number)   | 5 to 100                                                          |
| Set the firmness          | Choice 5 to 100 by 5 (command)                                    |
| Pressure (raw)            | The raw pressure value of SleepIQ, without a unit                 |
| Sleep score of last night | The SleepIQ score (0 to 100) of the main session, read every hour |
| Head / foot position      | 0 to 100, for a split foundation                                  |
| Foundation position       | The preset in use, for a split foundation                         |
| Move the foundation to    | Choice of presets (command)                                       |
| Stop the foundation       | Button (command)                                                  |
| Night light               | The night light of that side (command)                            |
| Foot warming              | Off, low, medium, high (read only)                                |
| Heating / cooling         | Off, heating or cooling low/medium/high (read only)               |

The foundation, light, foot warming and climate features appear only when
the bed has them. In bed and the firmness are read **every minute**; the
foundation, the lights, the foot warming and the climate every 5 minutes;
the sleep score every hour; the beds and their parts every 6 hours.

"In bed" uses the Gladys "motion sensor" category (as Gladys does for the
Zigbee presence and occupancy sensors): the dashboard may call it "motion".

## Scene triggers

In the scene editor (Gladys 5.1 or later), category **Integrations**:

- **Got into bed** and **Got out of bed**. Filter on the bed and/or the side
  (empty: any). The actions can read `{{triggerEvent.data.side}}` (`left` or
  `right`), `side_name`, `bed_name`, `sleeper_name` and `at` (the time the
  change was seen, UTC).

They fire within a minute of the change, **never on the first reading**
after a start (that is the state found, not a change), and never after an
outage or a pause of more than 5 minutes (the change happened at an unknown
time). The "In bed" feature can also start a scene, like any device.

## Setup

1. Install the integration from the Gladys store.
2. In its configuration, enter the **e-mail** and the **password** of the
   SleepIQ app. The password is kept by Gladys in its database, never shown
   again, sent only to the SleepIQ sign-in.
3. Check the **time zone of the bed** (America/Chicago by default): it is
   used to ask SleepIQ for the score of the right night.
4. Save, then add the bed and its sides from the **Discovery** tab.

The **Test the connection** button reads the beds once (at most every 30
seconds) and says who is in bed.

## Commands (off by default)

Firmness, foundation presets, the stop button and the night light refuse
every command while **Allow the commands** is off. On:

- **Set the firmness**: 5 to 100, by 5 only (any other value is refused);
- **Move the foundation to**: one of the presets the bed offers (Flat,
  Favorite, Read, Watch TV, Zero G, Snore). There is no command for a free
  head or foot position: only presets;
- **Stop the foundation**: stops a moving foundation;
- **Night light**: on or off.

Firmness and presets are choices, the stop is a button: a "turn everything
off" never reaches them. The night light is a Gladys light, so "turn the
lights off" in a room does turn it off (when the commands are allowed).

Before each command, the integration reads the state again (the firmness,
the preset, the light) and decides on it, never on a value in memory: a
useless command is not sent; a firmness change while the bed is already
adjusting is refused; a state that cannot be read refuses the command. The
stop is sent without a read (it is always safe). A command that cannot leave
within 3.5 seconds is refused unsent. Gladys gets an answer after 4.3 seconds
at most; the real state shows about 10 seconds later. One command at a time.

The foot warming and the heating/cooling are read only: the integration
never heats nor cools.

## Errors and limits

- **E-mail or password refused**: the integration stops and says so; one new
  try after 6 h, then every 24 h (not to lock the account). Saving new
  credentials or the test button try again at once.
- **Session refused**: the integration signs in again once (never at every
  cycle: the session key is kept and reused); refused again right after, a
  pause then one try after 1 h, 6 h, then every 24 h.
- **Sign-in rejected** (HTTP 403 "User Agent is blocked", or another error):
  the API has probably changed; one new try after 6 h, then every 24 h.
- **429 (too many requests)**: a pause of 1 minute to 6 hours (15 minutes
  without a hint), for everything (reads, button, commands), kept across a
  restart and a reconnection to Gladys. **403** of the main read: one hour.
- **Network, 5xx**: new try after 2, 5, 10, 15, then 30 minutes, never faster
  than every minute. A failing secondary read (foundation, score) never hides
  the presence and is not read again before its own interval.
- Stops and pauses are kept in `/data`, for 24 h at most. `/data` also keeps
  the SleepIQ session key, in clear, in a file reserved to the container user
  (0600), so also readable by the administrator of the machine and in the
  backups of the volume; never the e-mail nor the password.
- The nightstand sockets of the classic foundations (outlets 1 and 2) are
  not shown: they may power anything.
- Massage, pause (privacy) mode, the favorite firmness and the
  calibration are not supported.
- The logs never hold the e-mail, the password, the session key, nor the
  text of the SleepIQ error answers.

## Credits

Ported from [asyncsleepiq](https://github.com/kbickar/asyncsleepiq) (Keilin
Bickar, MIT) and the
[Home Assistant SleepIQ integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/sleepiq)
(Apache-2.0). Apache-2.0 license.
