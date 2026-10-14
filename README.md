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

When you change `style.css` or any script, bump the `?v=` query on their tags in `index.html` so GitHub
Pages' 10-minute cache (and browsers) pick up the new files together.

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
- ZONE GUIDE shows the zone during level 1 only (first 5 pitches). Turn it off on the title screen for x1.5 score.
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

Eleven types, each with its own speed band, break direction and break timing (see `PITCH_TYPES` in `game.js`).
Speeds creep up +1 km/h per level to level 8, then jump +3 km/h per level from level 10:

| Type | Speed | Movement |
| --- | --- | --- |
| FASTBALL | 136-148 | straight, slight rise, fast spin |
| SHOOT | 138-150 | runs arm-side early |
| CUTTER | 140-152 | tiny, sudden glove-side bite |
| SLIDER | 128-140 | late glove-side sweep |
| CURVE | 106-120 | rises first, then big loop down |
| SINKER | 134-146 | arm-side, drops late |
| FORKBALL | 126-138 | straight, then falls off the table |
| CHANGEUP | 110-124 | fastball look, slow, late fade |
| SWEEPER | 122-136 | huge flat glove-side sweep, almost no drop |
| RISING | 138-150 | fastball that hops up at the last moment |
| KNUCKLE | 100-114 | no spin, flutters side to side all the way in |

Faster pitches leave a longer trail and arrive sooner: flight time is the real 18.44 m at the shown speed,
stretched 1.3x (155 km/h ~ 0.5 s), tightened a little per level. Arsenal opens up by level (fastballs only at
level 1, topping out at 149 km/h there).

Pitchers come in both hands and two deliveries. From level 2 about 30% of pitches are thrown
**submarine**: the ball leaves from knee height, rides up a little and runs to the arm side.
Glove-side pitches (slider, cutter, curve, sweeper) break away from the arm; arm-side ones
(shoot, sinker, changeup) run toward it, so a left-hander's slider goes the other way.

## Title menu options

- **ZONE GUIDE** — dotted zone during level 1 pitches (off = x1.5 score).
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
```

Edit the bars in `music.js` (8th-note steps, `.` = tie, `-` = rest) and re-run the export.

## Debug flags

- `?slow=4` — run game time at 1/4 speed.
- `?debug` — exposes `window.__uu` (`G` state, `pause`, `startWindup`, `render`, `genPitch`).

## Files

- `index.html`, `style.css`, `game.js` — the game (vanilla JS, canvas at 168x192, integer-scaled).
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
