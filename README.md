# UUUMPIRE

An 8-bit strike-or-ball judging game, in the spirit of the umpire mode from プロ野球RISING.
You stand behind the plate. The pitch comes in. Call it.

## Play

Static site, no build step:

```sh
python3 -m http.server 8765
# open http://localhost:8765
```

Works on desktop and mobile (portrait). Live: https://hakexva.github.io/uuumpire/

Cache busting: `index.html` is a static shell that fetches `version.json` (never cached) and loads every
asset with `?v=<stamp>`, so a deploy is picked up even while GitHub Pages still serves the cached page.
Run `sh tools/install-hooks.sh` once; the pre-commit hook then stamps `version.json` on every commit
(`node tools/stamp.js` by hand otherwise).

| Action | PC | Mobile |
| --- | --- | --- |
| STRIKE | `←` or `S` | tap STRIKE |
| BALL | `→` or `B` | tap BALL |
| Menu | `↑` `↓` `Enter` | tap |
| Pause | `Space` or `P` | tap `II` |

## Rules

- Any part of the ball touching the zone is a strike.
- Call before the timer runs out. Three wrong calls and you're out.
- Streaks multiply score (up to x2). Edge pitches (+50) and quick calls (+30) earn bonus.
- The dotted zone guide shows during level 1 only (first 5 pitches); from level 2 you call it blind.
- Pitch speed, break and edge frequency ramp up every 5 pitches.
- Batters come short, average or tall (30/40/30%). The zone is knees to mid-chest of whoever is up, so a
  short batter's zone is about 11% shorter than a tall one's. Width is always 17 inches (33px).
  Every batter wears a different number (drawn at render time, not baked into the sprite) and one of
  six kits (home white, road gray, blue, red, gold, dark green), recoloured from the same sprites via `KITS`.
- From level 2 the batter sometimes swings through (a strike wherever the ball went) or checks his swing
  (held = no swing, judge the location). From level 2 the catcher also frames: after the catch the mitt
  drags the ball toward the zone. On a near-miss ball (about 45% of them at level 2, 80% by level 9) that
  makes it look like a strike; on edge strikes he just tidies it up. Framing is only there to mislead you:
  the call is always judged on where the ball crossed, and the score does not change.
- Wrong call (or any edge pitch): the reveal adds an ABS-style readout, e.g. `ABS: BALL BY 1.2 IN (LOW)`,
  with a measuring tick from the ball to the nearest zone edge. Scale: the 33px zone is 17 inches wide.

## Pitches

Thirteen types, each with its own speed band, break direction and break timing (see `PITCH_TYPES` in `core.js`).
Speeds creep up +1 km/h per level to level 8, then jump +3 km/h per level from level 10:

| Type | Speed | Movement |
| --- | --- | --- |
| 4-SEAM | 136-148 | straight, slight rise, fast spin (level 1+) |
| SLIDER | 128-140 | late glove-side sweep (2+) |
| CURVE | 98-110 | slow, loops up first then a big drop (2+) |
| CHANGEUP | 116-128 | fastball look, dies late to the arm side (2+) |
| SHOOT | 138-150 | runs arm-side early, no sink (2+) |
| 2-SEAM | 134-146 | runs arm-side late with a little sink (3+) |
| CUTTER | 140-152 | tiny, sudden glove-side bite (3+) |
| SINKER | 134-146 | arm-side, drops late (3+) |
| SPLITTER | 130-142 | straight, then a sudden drop (3+) |
| FORKBALL | 126-138 | straight, then falls off the table (6+) |
| SWEEPER | 122-136 | huge flat glove-side sweep, almost no drop (6+) |
| RISING | 138-150 | fastball that hops up at the last moment (6+) |
| KNUCKLE | 100-114 | no spin, flutters side to side all the way in (6+) |

Level ladder (every 5 pitches): 1 four-seamers with the zone guide · 2 breaking balls, guide off · 3 submarine
arms, sinkers and cutters · 4 batters swing and check-swing · 5 catcher framing · 6 the nasty stuff · 7+ faster
flights and shorter call windows · 10+ pro speed. The LEVEL banner says what just unlocked.

Faster pitches leave a longer trail and arrive sooner: flight time is the real 18.44 m at the shown speed,
stretched 1.3x (155 km/h ~ 0.5 s), tightened a little per level. Arsenal opens up by level (fastballs only at
level 1, topping out at 149 km/h there).

Pitchers come in both hands and two deliveries. From level 2 about 30% of pitches are thrown
**submarine**: the ball leaves from knee height, rides up a little and runs to the arm side.
Glove-side pitches (slider, cutter, curve, sweeper) break away from the arm; arm-side ones
(shoot, sinker, changeup) run toward it, so a left-hander's slider goes the other way.

## Replay, crowd, languages

- **REPLAY** (`R` or the button, top-right of the stage during the reveal): the pitch runs again at 0.35x with
  the zone box and the true landing spot shown. The reveal holds ~2.3 s so there is time to use it.
- **Reaction time** is shown on every call and averaged on the game-over screen.
- **Crowd / bench**: the CROWD meter (5 cells) fills one cell per correct call and loses two on a miss.
  Cheers, claps and boos follow your calls; a full meter gets the wave and a chant, an empty one gets
  heckled. The stadium music speeds up with it (+20% per cell, 2x at full). Atmosphere only: it never
  touches the call or the score.
- **Languages**: English, 繁體中文, 日本語, 台語 (教育部推薦漢字) (`i18n.js`, picked from the browser language,
  switchable in the menu). Cubic 11 covers the CJK text.

## Leaderboard

`server/` is a small Node + Postgres API (plain `http`, `pg`), deployed on Railway at
`https://api-production-c3f4.up.railway.app`. TODAY is the Asia/Taipei day. Scores are validated for
plausibility (max 400 pts per pitch, 12 posts per minute per IP) and names are 12 characters.

- `GET /api/scores?period=daily|all` top 20; `POST /api/scores` `{ name, score, pitches, accuracy, streak, reaction, lang }`.
- The game submits from the game-over screen (name is remembered) and shows TODAY / ALL TIME from the title menu.
  Each row shows pitches, accuracy and the average reaction time (rows posted before reaction was recorded show `-`).
- `API_BASE` in `game.js` points at the server; `?api=http://localhost:8787` overrides it. Without a reachable
  API the board says offline and the submit row stays hidden.
- Run locally: `cd server && npm install && node index.js` (in-memory without `DATABASE_URL`).
  Deploy: `railway up --service api` from `server/` (project `uuumpire`, Postgres linked via `DATABASE_URL`).

## Title menu options

- **SOUND / MUSIC** — SFX and the background theme, saved in `localStorage`.
- **PALETTE** — four looks: NIGHT GAME, DAY GAME, DOME, GAME BOY.
  Defined in `PALETTES` in `game.js`; each one sets the UI custom properties and the scene colors.

## Music

`music.js` holds three songs as note data (two pulse channels, triangle bass, noise drums) and a small
WebAudio player with 2A03-like duty-cycle pulse waves:

- `theme` — original Famicom-style gameplay theme (plays during the game).
- `entry` — original title fanfare in the spirit of a Taiwanese ballpark brass-band cheer (march, trumpet
  call-and-response, snare rolls).
- `ballgame` — "Take Me Out to the Ball Game" (Norworth / Von Tilzer, 1908, public domain), chorus in 3/4
  with oom-pah-pah tuba.
- `disco` — original level-10 track: from level 10 on, the PA switches to a four-on-the-floor disco inning.

On top of those, `assets/songs/*.json` holds ballpark standards imported from single-melody MIDI files
(flutetunes.com), all public domain, with an auto-generated comp:

| Key | Tune | Pool |
| --- | --- | --- |
| william-tell | William Tell Overture, finale (Rossini, 1829) | play |
| hat-dance | Mexican Hat Dance / Jarabe Tapatio (trad.) | play |
| gladiators | Entrance of the Gladiators (Fucik, 1897) | play |
| saints | When the Saints Go Marching In (trad.) | play |
| hava-nagila | Hava Nagila (trad.) | play |
| camptown | Camptown Races (Foster, 1850) | play |
| stars-and-stripes | The Stars and Stripes Forever (Sousa, 1896) | title |
| liberty-bell | The Liberty Bell (Sousa, 1893) | title |

`assets/songs/index.json` says which pool each belongs to. A loading bar fetches them (and the font) before
the title. The title screen picks a random title-pool song each time the menus come up; each new game
picks a random play-pool song. To add a tune: `node tools/import-midi.js in.mid assets/songs/key.json
--title "..."` (quantises the melody to 8ths, guesses I/IV/V/vi per bar for bass + brass), then list the
key in `index.json`. The three built-in songs export to Standard MIDI Files:

```sh
node tools/export-midi.js theme      # assets/uuumpire-theme.mid
node tools/export-midi.js entry      # assets/uuumpire-entry.mid
node tools/export-midi.js ballgame   # assets/uuumpire-ballgame.mid
node tools/export-midi.js disco      # assets/uuumpire-disco.mid
```

Edit the bars in `music.js` (8th-note steps, `.` = tie, `-` = rest) and re-run the export.

## Debug flags

- `?slow=4` — run game time at 1/4 speed.
- `?debug` — exposes `window.__uu` (`G` core state, `V` view state, `game`, `core`, `pause`, `startWindup`, `render`,
  `genPitch`, `step(dt)` to run a frame by hand).

## Code layout: core vs. art

The rules and the simulation are a separate library with no art in it, so they can be tested and reused
without a browser:

- `core.js` — `window.UU_CORE` in the page, `require('./core.js')` in Node. Pure data and functions, no DOM,
  canvas, audio, timers or UI strings: the pitch table and break profiles, zone geometry per batter height,
  `genPitch(level, { rng, kits, prevNumber })`, `ballPos(pitch, t)`, strike / edge-distance tests, the level
  ladder and call window, scoring (`scoreCall`), the crowd meter (`moodAfter`), the ABS readout data
  (`absInfo`), and `createGame({ rng, kits, onEvent })`, the state machine (idle → windup → flight → call →
  reveal / replay → over). It reports what happens as events: `next`, `windup`, `pitch`, `catch`, `resolve`,
  `replay`, `replayEnd`, `over`. Results carry keys (`fine`, `quick`, `swing`, `framed`, `chant`, `heckle`),
  never text. Every random draw goes through the injectable `rng`, so a seeded game replays exactly.
- `game.js` — the presentation: sprites, palettes, background and crowd, the chiptune `Sfx`, music pools,
  HUD and overlay text (i18n), particles, screen shake, the umpire's call styles, the title menu, the
  leaderboard client. It owns a `V` view-state object and maps core events to effects; nothing in it changes
  a call or a point.
- `tools/test-core.js` — headless checks: pitch-model invariants per level (strike flag, landing spot, speed
  bands, when swings / framing / submarine appear, ball distance) and scripted umpires playing whole games
  (perfect, always wrong, silent, early caller, replay, pause, 60 random seeds). Run `node tools/test-core.js`.

## Files

- `index.html`, `style.css`, `core.js`, `game.js` — the game (vanilla JS, canvas at 168x192, integer-scaled). `i18n.js` — UI strings.
- `server/` — leaderboard API (Node + Postgres) for Railway.
- `sprites.js` — pixel art as text (one char per pixel, keys map to the palette). Pitcher (overhand + submarine), catcher, mitt, batter, umpire.
- `tools/gen-sprites.js` — shape-based rasterizer for the batter (stance, check, swing, follow-through; posed after the
  behind-the-plate batters in Baseball Stars 2 and Clutch Hitter), catcher, mitt
  and pitcher (set, kick, cocked, release, follow-through; overhand + submarine) frames. Plate-side sprites are
  rasterized at `NEAR` = 1.4x their design size (the umpire's eye is right behind the catcher); the pitcher is 1x.
  `--write` splices them into `sprites.js`. Edit the shapes there, not the rows.
- `music.js` — song data + chiptune player. `tools/export-midi.js` — MIDI exporter. `tools/import-midi.js` — MIDI → song JSON importer.
- `assets/songs/` — imported ballpark tunes (JSON) + `index.json` pools.
- `assets/uuumpire-theme.mid`, `assets/uuumpire-entry.mid`, `assets/uuumpire-ballgame.mid` — exported songs.
- `fonts/Cubic_11.woff2` — [Cubic 11](https://github.com/ACh-K/Cubic-11) pixel font, SIL Open Font License (see `fonts/OFL.txt`).

Best scores are stored in `localStorage`.
