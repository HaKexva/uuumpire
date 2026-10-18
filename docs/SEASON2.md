# UUUMPIRE Season 2

Season 1 is levels 1–11 and stays the ending of the current game. Season 2 is a second ladder of
unlocks on top of it, in a new look. The 3D era branch (PR 24) stays a draft; what it taught (the
ump-cam framing, bones-to-zone mapping, the asset weight) feeds this plan.

Decided (2026-10-18):

| Theme | In | Out |
| --- | --- | --- |
| Positions | home plate plays, first base, third base | — |
| Pressure | count and situation, manager argues / ejection, fatigue drift | ABS challenge |
| Pitchers with faces | a roster keyed by level, each with a face and a trick | — |
| Ballparks and weather | day glare, rain, fog, dome, named parks | — |
| Look | HD-2D (Octopath Traveler style), spike first, JS unless the spike fails | — |

## 1. Level ladder (proposal)

Five pitches per level as before. The LEVEL banner names the unlock. Numbers are a first cut.

| Lv | Unlock | What the player does |
| --- | --- | --- |
| 12 | **Season 2** — new park, HD-2D look, count and situation shown | strike / ball, with a count that carries |
| 13 | **Check-swing appeal** | batter holds up: WENT / HELD. Bat head past the plate's front edge = went |
| 14 | **Foul tip** | a tick before the mitt pop: FOUL TIP / STRIKE. Mostly an audio call |
| 15 | **Pitcher: the eephus man** | 60 km/h lob among 150s; the call window is the same, the flight is not |
| 16 | **Hit by pitch** | ball at the batter: HIT / NO (he leaned in, or it hit the knob) |
| 17 | **First base** | crew rotates. SAFE / OUT on bang-bang plays: footstep vs. glove pop, by ear |
| 18 | **Pitcher: the quick-pitcher** | pitches before you are set; windup cue shortened at random |
| 19 | **Third base** | fair / foul down the line, check swings from the side |
| 20 | **Manager** | a miss brings him out. HOLD / EJECT. Hold: mood dips; eject: crowd swings |
| 21 | **Plays at the plate** | runner, tag, slide: SAFE / OUT. The umpire moves |
| 22 | **Fatigue** | zone drifts a few px per inning; a called strike you can see recalibrates it |
| 23 | **Pitcher: the headhunter** | HBP and brushbacks mixed with strikes on the corner |
| 24 | **Game 7** | everything on, rain, bottom of the ninth, 3-2, bases loaded |

Every new call keeps the Season 1 shape: a window, a two-button call, a reveal with the truth and
the distance. `core.js` grows a `kind` per pitch (`pitch`, `checkswing`, `fouletip`, `hbp`, `first`,
`line`, `plate`), and the two buttons relabel per kind. The run log stays `[call, seconds]`, so the
anti-cheat replay covers all of it.

## 2. Positions

- **Home plate** is Season 1 plus plays at the plate. A play at the plate is a runner sprite from
  third, a throw, a tag: the truth is the frame order of foot-on-plate vs. tag, 1–6 frames apart at
  the hard levels.
- **First base** cuts to a side view behind the bag. The truth is the ordering of two sounds, the
  footstep and the mitt pop, with the picture lagging the sound by design (the umpire's eyes are on
  the bag, the ears on the glove). Audio must be on for this level; a visual fallback (a flash on
  the glove) is kept for muted play, with a wider margin.
- **Third base** is a side view down the line: a ball landing left or right of the chalk, and
  check swings seen from the side where the bat angle is honest.

Each position is a scene in the same stage box; the camera cut is the level banner.

## 3. Pressure

- **Count and situation**: a scoreboard strip (count, outs, runners, inning). The count carries
  across pitches; 3-2 and runners on raise the score multiplier and switch the heckle set.
- **Manager**: after a miss at level 20+, he comes out (walk-in animation, two lines of argument from
  the heckle pool). HOLD: he goes back, mood -1. EJECT: a thumb, the crowd roars, mood +2 or -2 by
  whether the call was right.
- **Fatigue**: from level 22, `ZONE` drifts by up to 3 px, slowly, per inning. A pitch down the middle
  is shown with its true position at the reveal, so the drift is readable and correctable. The drift
  is in the view only; the rules keep the true zone.

## 4. Pitchers with faces

A roster keyed by level, each a face (portrait in the HUD when he takes the mound), a delivery, and
one trick. Season 1 types stay; the trick is layered on.

| Lv | Pitcher | Trick |
| --- | --- | --- |
| 12 | The Rookie | nervous: wild balls (far misses) |
| 15 | The Eephus Man | lob among fastballs |
| 18 | The Quick-Pitcher | shortened windup at random |
| 20 | The Knuckler | wobble ×2; his catcher misses too (mitt late) |
| 23 | The Headhunter | brushbacks, HBP |
| 24 | The Ace | everything, with a two-strike put-away pitch |

Faces are small pixel portraits in the same sheet style as the batters' kits.

## 5. Ballparks and weather

- **Parks** as palettes plus a backdrop: Tianmu (hills, night), Taoyuan (big, day), Taichung
  Intercontinental (dome-ish, bright), plus the Season 1 night park. Each park has a crowd colour and a
  cheer-squad tune.
- **Weather**: day glare (ball washes out on the sunny side), rain (ball darker, flight 5 % slower, the
  mound visit on the level banner), fog (the pitcher is a silhouette; the ball appears late), dome (no
  weather, louder crowd).
- Weather is per level, drawn from the park's climate; Game 7 is rain.

## 6. HD-2D: what it is and how it is done on the web

HD-2D is Square Enix's trademark for Octopath Traveler's look: pixel-art characters as billboards
in a 3D diorama, with dynamic lights and shadows, depth of field and tilt-shift blur, bloom on
light sources, colour grading and a vignette ([Wikipedia](https://en.wikipedia.org/wiki/HD-2D),
[Unreal spotlight](https://www.unrealengine.com/spotlights/octopath-traveler-s-hd-2d-art-style-and-story-make-for-a-jrpg-dream-come-true)).
The stack, in one line: **low-res pixel sprites + a real 3D scene + a post stack**. Nothing in it is
exotic; the taste is in the tilt-shift and the lighting.

### Option A: JavaScript (three.js), in this repo

- Pixel look: three.js ships `RenderPixelatedPass` (render at low resolution, upscale with nearest
  filtering, optional one-pixel outlines) and the official `webgl_postprocessing_pixel` example is
  exactly a pixel scene with shadows ([docs](https://threejs.org/docs/pages/RenderPixelatedPass.html),
  [example](https://fossies.org/linux/three.js/examples/webgl_postprocessing_pixel.html)).
- Depth of field / tilt-shift: `BokehPass` (focus, aperture, maxblur), or a two-tap vertical blur
  masked by screen height for a cheaper tilt-shift ([BokehPass](https://threejs.org/docs/pages/BokehPass.html)).
  Each pass is a full-screen render, so blur passes run at half resolution on phones.
- Bloom, vignette, AO, shadows, quality tiers, the watchdog that steps a slow phone down: already
  written in `era3d.js` (`EffectComposer`, `UnrealBloomPass`, `GTAOPass`, `VignetteShader`, `TIERS`).
  Roughly 70 % of the post stack carries over.
- Sprites: `sprites.js` is already one char per pixel; the same sheets become `THREE.Sprite` /
  billboard quads with `NearestFilter`, cast shadows with a custom depth material that respects
  the alpha. The batter, pitcher and catcher stay pixel art; the diorama is low-poly with pixel
  textures (dirt, grass, chalk, the stands).
- Cost: three.js is loaded already for the 3D era (CDN); no new runtime. No models to host: the
  19 MB GLB problem from PR 24 disappears, the diorama is a few KB of geometry and small textures.
- Risk: fill-rate on phones (several full-screen passes at device resolution). Mitigated by rendering
  the scene at 336×384 (2× the stage) and letting the pixel pass upscale; the post passes then run on
  a tiny buffer.

### Option B: Godot 4

- The Godot port is a brief only (`tubaxenor/uuumpire-godot`, two commits, no game), so Season 2 in
  Godot is a rebuild of Season 1 first.
- Web export runs on the **Compatibility renderer only** (WebGL 2). Compatibility has **no depth
  of field**, a reduced glow with fixed levels, and no 2D HDR
  ([renderers](https://docs.godotengine.org/en/stable/tutorials/rendering/renderers.html),
  [environment and post-processing](https://docs.godotengine.org/en/4.4/tutorials/3d/environment_and_post_processing.html),
  [glow note](https://forum.godotengine.org/t/how-can-i-adjust-hdr2d-glow-size/128616/2)). The two
  effects that make HD-2D read would be hand-written shaders on blurred viewports.
- Hosting: single-threaded exports (default since 4.3) run on plain GitHub Pages; threaded ones need
  COOP/COEP headers Pages cannot send, only a service-worker workaround
  ([exporting for the web](https://docs.godotengine.org/en/latest/tutorials/export/exporting_for_web.html),
  [Pages issue](https://github.com/godotengine/godot-docs/issues/7084),
  [server configs](https://gist.github.com/nisovin/cf9dd74678641fb70902866c79692b17)).
- Weight: a stock web export is about 40 MB raw, 7–10 MB compressed, before any game
  ([size write-up](https://popcar.bearblog.dev/how-to-minify-godots-build-size/),
  [PixelGameCraft](https://pixelgamecraft.com/blog/godot-web-build-size/),
  [optimizing for size](https://docs.godotengine.org/en/4.4/contributing/development/compiling/optimizing_for_size.html)).
  The current game is under 400 KB. Phone load goes from instant to several seconds.
- Upside: an editor for the diorama and lighting, a real scene tree, and a native build later.

### Recommendation

**Spike in JS first.** The look's two signature effects are post-processing, which the browser does
well and Godot's web renderer does not; the rest (sprites in a 3D set, lights, shadows) is ordinary
three.js and most of it is already in the repo. Godot's web story adds a rebuild, an 8 MB download
and faked DoF, in exchange for an editor. Go to Godot only if the spike fails the gate below.

### The spike (`hd2d-spike` branch, `hd2d.js` beside `era3d.js`)

Build one scene: the home-plate view of Season 1 as a diorama.

1. Diorama: plate, batter's boxes, dirt circle, grass, the backstop and one tier of stands, as
   low-poly meshes with 16-colour pixel textures. Camera: the Season 1 angle (behind the umpire,
   slightly above), tilted so the diorama reads.
2. Sprites: batter, catcher, pitcher from `sprites.js` as billboards at their Season 1 scale,
   nearest-filtered, casting shadows.
3. Lights: four stadium lights as point lights with bloom, a dim hemisphere, shadows on the dirt.
4. Post: pixel pass at 2× stage resolution, tilt-shift (top and bottom bands blurred), bloom,
   vignette, a touch of grading.
5. Pitch: reuse `era3d.js`'s `worldAt` so the ball flies the rules' path.

Gate (go / no-go):

- Look: a side-by-side with Octopath screenshots; the user says yes.
- Phone: 60 fps on an iPhone from 2022, 30 fps on the slow tier, with the watchdog stepping down.
- Weight: under 1 MB added, no external models.
- Time: two days. If the look is not there in two days, Godot.

## 7. Music

Season 1 keeps the chip band. Season 2 gets per-band tracks: the Suno "Pressure" tracks the user is
making map to level bands through `assets/songs/index.json` `"audio"` (one mp3 per band, 3–4 MB
each, loaded in the background). The chip synth stays as the fallback and for menus.

## 8. Open questions

- Audio-only truth at first base: how many players play muted on phones? Keep the visual fallback
  with a wider margin, and tell them in the level banner.
- Count carry: does a walk or strikeout end the batter (new batter, count reset) or does the count
  just tick? Proposal: it ends him; the next batter steps in, like Season 1's jersey change.
- Season 2 scores: the same board, or a second one? Proposal: same board, the run log says how far
  the game went; the daily board already separates days.
