/* UUUMPIRE - 8-bit strike/ball judging game. Vanilla JS, no deps. */
(() => {
  'use strict';

  // ------------------------------------------------------------
  // Constants
  // ------------------------------------------------------------
  const W = 168, H = 192;
  // Layout: umpire crouched in the slot, eyes just above the catcher, looking slightly down.
  // Horizon high, zone around mid-frame, dirt visible below the players' feet.
  // Everything at the plate is drawn 1.4x (the umpire stands right behind the catcher); the pitcher is 1x.
  // Strike zone at the plate (px): 33 wide = 17in. Its height follows the batter at the plate
  // (knees to mid-chest), so y0/y1 are reset by genPitch() for each batter height.
  const ZONE = { x0: 68, x1: 101, y0: 120, y1: 148 };
  const BATTER_H = { short: 0.88, mid: 1, tall: 1.12 };   // sprite scale; same numbers as tools/gen-sprites.js
  const BATTER_FEET_Y = 172;                              // where every batter's cleats sit
  // rulebook zone: midpoint of shoulders and belt (52px above the cleats on the mid batter) down to
  // the hollow of the knee (24px above)
  const zoneFor = (h) => ({ y0: Math.round(BATTER_FEET_Y - 52 * h), y1: Math.round(BATTER_FEET_Y - 24 * h) });
  const BALL_R = 5;                                     // ball radius at the plate (px)
  // Release points = the throwing hand pixel of each pitcher sprite (POS.pitcher + hand offset).
  // R = right-hander (arm on the umpire's left); L mirrors it.
  const RELEASE = {
    OVERHAND:  { R: { x: 77, y: 43 }, L: { x: 90, y: 43 } },
    SUBMARINE: { R: { x: 76, y: 66 }, L: { x: 92, y: 66 } },
  };
  const MITT_REST = { x: 84, y: 170 };
  const POS = { pitcher: [72, 41], catcher: [53, 138], batterR: [23, 78], batterL: [78, 78] }; // batter body ~6px off the zone edge
  const PLATE_Y = 150;                                  // front edge of home plate
  const STORE_KEY = 'uuumpire.v1';

  // Scene palette keys: K black, W white, g gray, d dim, n sky, N navy, G gold, R red, s skin,
  // B uniform blue, b dirt, c dirt light, e grass dark, E grass light, y light yellow,
  // p green text, u crowd blue, m dark gray.
  // Shading keys (SFC-style 3 tones + outline): w off-white, z skin shadow, L light blue,
  // l dark blue, r dark red, k dark brown, o helmet highlight.
  const BASE_PAL = {
    K: '#000000', W: '#fcfcfc', g: '#bcbcbc', d: '#7c7c7c',
    n: '#01215b', N: '#24188c', G: '#f8b800', R: '#d82800',
    s: '#f0b088', B: '#2038ec', b: '#a05020', c: '#c8783c',
    e: '#007800', E: '#00a800', y: '#fce07c', p: '#58d854',
    u: '#5c94fc', m: '#3c3c3c',
    w: '#d8d8d8', z: '#c07050', L: '#5c94fc', l: '#0000a8',
    r: '#a80020', k: '#5a2800', o: '#f87858',
    J: '#fcfcfc', j: '#d8d8d8',                           // batter jersey + shade (recoloured per kit)
    t: '#0c5a30', T: '#063a1e',                           // team dark green + shade (darker than the grass)
  };
  // Batter kits: which palette keys the jersey (J/j), helmet (R/r/o), socks (B/l) and number take.
  const KITS = [
    { name: 'HOME',  J: 'J', j: 'j', R: 'R', r: 'r', o: 'o', B: 'B', l: 'l', num: 'N' },  // white, red helmet
    { name: 'ROAD',  J: 'g', j: 'd', R: 'N', r: 'l', o: 'L', B: 'N', l: 'l', num: 'N' },  // gray, navy helmet
    { name: 'BLUE',  J: 'B', j: 'l', R: 'B', r: 'l', o: 'L', B: 'B', l: 'l', num: 'W' },
    { name: 'RED',   J: 'R', j: 'r', R: 'N', r: 'l', o: 'L', B: 'R', l: 'r', num: 'W' },
    { name: 'GOLD',  J: 'G', j: 'c', R: 'N', r: 'l', o: 'L', B: 'N', l: 'l', num: 'N' },
    { name: 'GREEN', J: 't', j: 'T', R: 't', r: 'T', o: 'p', B: 't', l: 'T', num: 'y' },  // dark green, yellow number
  ];
  const PAL = Object.assign({}, BASE_PAL);

  // Monochrome mapping: palette key -> shade index (0 darkest .. 3 lightest)
  const SHADE_OF = {
    K: 0, W: 3, g: 2, d: 1, n: 0, N: 1, G: 3, R: 1, s: 2, B: 1, b: 1, c: 2, e: 1, E: 2, y: 3, p: 2, u: 2, m: 0,
    w: 2, z: 1, L: 2, l: 0, r: 0, k: 0, o: 2, J: 3, j: 2, t: 1, T: 0,
  };

  // Six selectable palettes. `css` feeds the UI custom properties, `pal` overrides scene colors,
  // `shades` (4 colors) turns the whole scene monochrome.
  const PALETTES = [
    { name: 'NIGHT GAME',
      css: { night: '#01215b', gold: '#f8b800', navy: '#24188c', white: '#fcfcfc', red: '#d82800', gray: '#bcbcbc', dim: '#7c7c7c', ink: '#000000', panel: '#000000', btn: '#fcfcfc' },
      pal: {} },
    { name: 'DAY GAME', day: true,
      css: { night: '#0058f8', gold: '#fce06c', navy: '#0000a8', white: '#fcfcfc', red: '#f83800', gray: '#d8d8d8', dim: '#6888c0', ink: '#000000', panel: '#000040', btn: '#fcfcfc' },
      pal: { n: '#3cbcfc', N: '#0058f8', u: '#0078f8', m: '#787878', e: '#00a800', E: '#58d854', b: '#c84c0c', c: '#e4a060', y: '#f8d878' } },
    { name: 'DOME',
      css: { night: '#1c1c1c', gold: '#3cbcfc', navy: '#0078a8', white: '#fcfcfc', red: '#f85898', gray: '#bcbcbc', dim: '#5c5c5c', ink: '#000000', panel: '#000000', btn: '#fcfcfc' },
      pal: { n: '#2c2c2c', N: '#3c3c3c', u: '#3cbcfc', m: '#505050', e: '#00a800', E: '#00c800', b: '#a05020', c: '#c8783c', y: '#fcfcfc', G: '#3cbcfc', B: '#f85898' } },
    { name: 'GAME BOY',
      css: { night: '#9bbc0f', gold: '#0f380f', navy: '#306230', white: '#0f380f', red: '#0f380f', gray: '#306230', dim: '#306230', ink: '#0f380f', panel: '#8bac0f', btn: '#9bbc0f', 'btn-accent': '#8bac0f',
             'logo-shadow': '3px 3px 0 #8bac0f', 'text-shadow': 'none',
             // text drawn over the canvas: lightest shade with a dark outline, since the scene is dimmed on reveal
             call: '#9bbc0f', 'call-ball': '#9bbc0f', overlay: '#9bbc0f', 'overlay-accent': '#9bbc0f', ok: '#9bbc0f', ng: '#9bbc0f',
             'call-shadow': '3px 3px 0 #0f380f', 'overlay-shadow': '2px 0 0 #0f380f, -2px 0 0 #0f380f, 0 2px 0 #0f380f, 0 -2px 0 #0f380f',
             // menu highlight bar: dark bar, light text (the page's "white" is the dark shade here)
             'hi-bg': '#0f380f', 'hi-fg': '#9bbc0f', 'hi-val': '#8bac0f' },
      shades: ['#0f380f', '#306230', '#8bac0f', '#9bbc0f'] },
  ];

  function applyPalette(index) {
    const p = PALETTES[index] || PALETTES[0];
    Object.assign(PAL, BASE_PAL);
    if (p.shades) for (const k in SHADE_OF) PAL[k] = p.shades[SHADE_OF[k]];
    else Object.assign(PAL, p.pal);
    sceneDay = !!p.day;
    const rs = document.documentElement.style;
    rs.setProperty('--g-btn-accent', p.css.gold);
    // optional per-palette overrides: clear them first so the CSS fallbacks apply again
    for (const k of ['logo-shadow', 'call-shadow', 'text-shadow', 'overlay-shadow', 'call', 'call-ball', 'overlay', 'overlay-accent', 'ok', 'ng', 'hi-bg', 'hi-fg', 'hi-val']) rs.removeProperty('--g-' + k);
    for (const k in p.css) rs.setProperty('--g-' + k, p.css[k]);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', p.css.night);
    buildAssets();
  }

  // ------------------------------------------------------------
  // Sprites (char rows -> palette)
  // ------------------------------------------------------------
  const SPR = window.UU_SPRITES;

  function makeSprite(rows, flip, remap) {
    const h = rows.length, w = rows[0].length;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d');
    if (remap) rows = rows.map((r) => r.replace(/[A-Za-z]/g, (ch) => remap[ch] || ch)); // kit recolour
    for (let j = 0; j < h; j++) {
      for (let i = 0; i < w; i++) {
        const ch = rows[j][i];
        if (ch === '.' || !PAL[ch]) continue;
        x.fillStyle = PAL[ch];
        x.fillRect(flip ? w - 1 - i : i, j, 1, 1);
      }
    }
    return c;
  }

  let IMG = null, BG = null;
  const frames = (names, remap) => ({
    R: names.map((n) => makeSprite(SPR[n], false, remap)),
    L: names.map((n) => makeSprite(SPR[n], true, remap)),
  });
  function buildAssets() {
    IMG = {
      // delivery frames: set, leg kick, cocked, release, follow-through (R = right-hander, L = mirrored)
      pitcher: {
        OVERHAND:  frames(['pitcherSet', 'pitcherKick', 'pitcherCock', 'pitcherThrow', 'pitcherFollow']),
        SUBMARINE: frames(['pitcherSetUnder', 'pitcherKick', 'pitcherCockUnder', 'pitcherThrowUnder', 'pitcherFollowUnder']),
      },
      catcher: makeSprite(SPR.catcher),
      mitt: makeSprite(SPR.mitt),
      // batter frames: stance, check swing, full swing, follow-through
      // batter: [kit][size][hand][frame]
      batter: KITS.map((kit) => Object.fromEntries(Object.keys(BATTER_H).map((size) =>
        [size, frames(['batter_' + size, 'batterCheck_' + size, 'batterSwing_' + size, 'batterFollow_' + size], kit)]))),
      umpStrike: makeSprite(SPR.umpStrike),
      umpBall: makeSprite(SPR.umpBall),
    };
    BG = makeBackground();
  }

  // ------------------------------------------------------------
  // Background (pre-rendered once)
  // ------------------------------------------------------------
  function seededRand(seed) {
    let s = seed >>> 0;
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  }

  let sceneDay = false; // set by applyPalette

  function makeBackground() {
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const x = c.getContext('2d');
    const rnd = seededRand(20261013);
    const HORIZON = 40;

    // sky
    x.fillStyle = PAL.n; x.fillRect(0, 0, W, HORIZON);
    if (sceneDay) {
      // sun + a few clouds
      x.fillStyle = PAL.y;
      x.fillRect(138, 6, 8, 8); x.fillRect(137, 7, 10, 6); x.fillRect(139, 5, 6, 10);
      x.fillStyle = PAL.W;
      for (const [cx, cy, cw] of [[22, 12, 16], [60, 20, 12], [108, 9, 14]]) {
        x.fillRect(cx, cy + 2, cw, 3); x.fillRect(cx + 3, cy, cw - 6, 2); x.fillRect(cx - 2, cy + 3, cw + 4, 1);
      }
    } else {
      x.fillStyle = PAL.W;
      for (let i = 0; i < 26; i++) x.fillRect((rnd() * W) | 0, (rnd() * 26) | 0, 1, 1);
      x.fillStyle = PAL.y;
      x.fillRect(140, 8, 6, 6); x.fillRect(139, 9, 8, 4); x.fillRect(141, 7, 4, 8); // moon
      x.fillStyle = PAL.n; x.fillRect(143, 9, 3, 3);
    }

    // stadium light towers (lit at night, off by day)
    for (const lx of [10, 150]) {
      x.fillStyle = PAL.m; x.fillRect(lx + 3, 6, 2, HORIZON - 6);
      x.fillStyle = PAL.K; x.fillRect(lx - 1, 2, 10, 6);
      x.fillStyle = sceneDay ? PAL.d : PAL.y;
      for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) x.fillRect(lx + i * 2, 3 + j * 2, 1, 1);
    }

    // crowd: tiered rows of heads + shirts (Pawapuro-style), staggered per row, dim backdrop
    x.fillStyle = PAL.m; x.fillRect(0, HORIZON - 14, W, 14);
    const shirts = sceneDay ? ['W', 'R', 'B', 'G', 'u', 'y', 'g', 'o'] : ['R', 'B', 'G', 'u', 'g', 'd', 'W', 'l'];
    const heads = ['s', 'z', 'k', 's'];
    for (let row = 0; row < 4; row++) {
      const ry = HORIZON - 14 + row * 3 + (row === 3 ? 1 : 0);
      const off = (row % 2) * 2;
      for (let xx = off; xx < W; xx += 4) {
        if (rnd() < 0.08) continue; // empty seat
        x.fillStyle = PAL[heads[(rnd() * heads.length) | 0]];
        x.fillRect(xx, ry, 2, 1);
        x.fillStyle = PAL[shirts[(rnd() * shirts.length) | 0]];
        x.fillRect(xx - 1, ry + 1, 4, 2);
        if (rnd() < 0.06) { x.fillStyle = PAL.W; x.fillRect(xx, ry - 2, 2, 2); } // raised banner
      }
      x.fillStyle = PAL.K; x.fillRect(0, ry + 3, W, 1); // tier edge
    }
    // outfield wall
    x.fillStyle = PAL.N; x.fillRect(0, HORIZON, W, 6);
    x.fillStyle = PAL.G; x.fillRect(0, HORIZON + 1, W, 1);
    x.fillStyle = PAL.K; x.fillRect(0, HORIZON + 5, W, 1);

    // grass with mowing stripes (bands get taller toward the viewer)
    let yy = HORIZON + 6, band = 3, k = 0;
    while (yy < H) {
      x.fillStyle = (k % 2) ? PAL.e : PAL.E;
      x.fillRect(0, yy, W, band);
      yy += band; band += 1; k++;
    }

    // infield dirt: mound + home plate area (big, we are looking down at it)
    const dirt = (cx, cy, rx, ry, col) => {
      x.fillStyle = col;
      for (let j = -ry; j <= ry; j++) {
        const w = Math.sqrt(1 - (j * j) / (ry * ry)) * rx;
        x.fillRect(Math.round(cx - w), cy + j, Math.round(w * 2), 1);
      }
    };
    dirt(84, 66, 16, 4, PAL.c);       // mound
    x.fillStyle = PAL.W; x.fillRect(82, 65, 5, 1); // rubber
    // home plate dirt: a flat ellipse along the bottom (low camera, so it is heavily foreshortened)
    dirt(84, 200, 106, 60, PAL.b);
    dirt(84, 202, 102, 56, PAL.c);

    // foul lines from the plate corners to the wall
    const line = (x0, y0, x1, y1) => {
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x.fillStyle = PAL.W;
      for (let i = 0; i <= steps; i++) {
        x.fillRect(Math.round(x0 + (x1 - x0) * i / steps), Math.round(y0 + (y1 - y0) * i / steps), 1, 1);
      }
    };
    line(70, PLATE_Y, 14, HORIZON + 6);
    line(97, PLATE_Y, 154, HORIZON + 6);

    // batter's boxes (seen from above-behind: trapezoids widening toward us)
    x.fillStyle = PAL.W;
    const box = (xa, xb, dir) => {
      for (let j = 0; j <= 30; j++) {
        const spread = Math.round(j * 0.2);
        x.fillRect(xa - spread * dir, PLATE_Y - 8 + j, 1, 1);
      }
      x.fillRect(Math.min(xa, xb), PLATE_Y - 8, Math.abs(xb - xa) + 1, 1);
      x.fillRect(Math.min(xa - 6 * dir, xb), PLATE_Y + 22, Math.abs(xb - xa) + 7, 1);
    };
    box(30, 64, 1);
    box(138, 104, -1);

    // home plate (pentagon, mostly hidden behind the catcher)
    x.fillStyle = PAL.W;
    x.fillRect(70, PLATE_Y, 28, 4);
    x.fillRect(71, PLATE_Y + 4, 26, 3);
    x.fillRect(73, PLATE_Y + 7, 22, 3);
    x.fillRect(77, PLATE_Y + 10, 14, 3);
    x.fillRect(81, PLATE_Y + 13, 6, 2);
    x.fillStyle = PAL.d; x.fillRect(70, PLATE_Y, 28, 1);

    return c;
  }

  // ------------------------------------------------------------
  // Audio (tiny 8-bit synth)
  // ------------------------------------------------------------
  const Sfx = {
    ctx: null, enabled: true,
    init() {
      if (this.ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      if (window.UUMusic) window.UUMusic.Player.attach(this.ctx);
    },
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); },
    tone(freq, dur, { type = 'square', vol = 0.06, slide = null, delay = 0 } = {}) {
      if (!this.enabled || !this.ctx) return;
      const t0 = this.ctx.currentTime + delay;
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t0);
      if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
      g.gain.setValueAtTime(vol, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(this.ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    },
    // pitch sounds sit above the music: windup tick, ball cutting the air, mitt pop
    windup() { this.tone(220, 0.08, { vol: 0.07 }); },
    whoosh() { this.tone(900, 0.35, { type: 'sawtooth', vol: 0.07, slide: 180 }); },
    pop() { this.tone(140, 0.1, { vol: 0.2, slide: 60 }); this.tone(1200, 0.03, { type: 'triangle', vol: 0.11 }); },
    good() { this.tone(660, 0.08); this.tone(880, 0.12, { delay: 0.08 }); this.tone(1320, 0.18, { delay: 0.17 }); },
    bad() { this.tone(200, 0.18, { type: 'sawtooth', vol: 0.05 }); this.tone(150, 0.3, { type: 'sawtooth', vol: 0.05, delay: 0.15 }); },
    strikeCall() { this.tone(520, 0.06, { vol: 0.05 }); this.tone(780, 0.1, { vol: 0.05, delay: 0.06 }); },
    ballCall() { this.tone(400, 0.1, { vol: 0.05 }); },
    select() { this.tone(990, 0.05, { vol: 0.04 }); },
    move() { this.tone(500, 0.04, { vol: 0.03 }); },
    over() { [392, 370, 349, 330].forEach((f, i) => this.tone(f, 0.25, { delay: i * 0.22, vol: 0.05 })); },
    // level-up jingle (~1s): quick run up, bounce, then a held chord
    levelUp() {
      const run = [[523, 0.09, 0], [659, 0.09, 0.09], [784, 0.09, 0.18], [1047, 0.14, 0.27], [784, 0.14, 0.44], [1047, 0.55, 0.6]];
      for (const [f, d, at] of run) this.tone(f, d, { delay: at, vol: 0.07 });
      this.tone(659, 0.55, { delay: 0.6, vol: 0.035 });
      this.tone(523, 0.55, { delay: 0.6, vol: 0.03, type: 'triangle' });
    },
  };

  // ------------------------------------------------------------
  // Storage
  // ------------------------------------------------------------
  const store = {
    load() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
    },
    save(obj) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(obj)); } catch (e) { /* ignore */ }
    },
  };
  let settings = Object.assign({ guide: true, sound: true, music: true, palette: 0, records: [] }, store.load());
  const saveSettings = () => store.save(settings);

  // Music wrapper (music.js). Starts only after a user gesture.
  // 'title' = a random menu song (entry fanfare, Take Me Out to the Ball Game, plus the marches loaded
  // from assets/songs), kept while you move around the menus; 'play' = a random game song (the original
  // theme plus the loaded ballpark tunes), picked per game. start() with no name resumes the current song.
  const TITLE_SONGS = ['entry', 'ballgame'];
  const PLAY_SONGS = ['theme'];
  const Music = {
    get player() { return window.UUMusic ? window.UUMusic.Player : null; },
    start(song) {
      Sfx.init(); Sfx.resume();
      const p = this.player;
      if (!p || !settings.music) return;
      if (song === 'title') {
        if (p.playing && TITLE_SONGS.includes(p.current)) return; // already on a menu song: keep it
        song = pick(TITLE_SONGS);
      } else if (song === 'play') {
        song = pick(PLAY_SONGS);
      }
      p.setEnabled(true); p.start(song);
    },
    stop() { const p = this.player; if (p) p.stop(); },
    apply() { const p = this.player; if (!p) return; p.setEnabled(settings.music); if (settings.music) p.start(); },
  };
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      Music.stop();
      if (currentScreen === 'play' && G.phase !== 'idle' && G.phase !== 'over') setPaused(true); // don't lose a pitch to a tab switch
    } else if (Sfx.ctx && currentScreen !== 'over' && !G.paused) Music.start();
  });

  // ------------------------------------------------------------
  // Pitch generation
  // ------------------------------------------------------------
  const rnd = (a, b) => a + Math.random() * (b - a);
  const rndInt = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rndInt(arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const sgn = () => (Math.random() < 0.5 ? -1 : 1);

  // Break profiles: f(0)=0, f(1)=1. Shape = when the movement happens.
  const PROFILE = {
    std:    (t) => t * t,                                        // steady bend
    late:   (t) => t * t * t,                                    // most movement in the last third
    sharp:  (t) => t * t * t * t,                                // tiny then sudden
    early:  (t) => 1 - (1 - t) * (1 - t),                        // runs early, then straight
    tumble: (t) => (t < 0.55 ? 0 : Math.pow((t - 0.55) / 0.45, 2)), // nothing, then falls off the table
  };

  // side: 'glove' breaks away from the pitcher's arm side, 'arm' runs toward it, 'any' = random.
  // hump: rises first (curveball loop). spin: seam animation speed. minLv: first level it appears.
  const PITCH_TYPES = [
    { name: 'FASTBALL', w: 5, speed: [136, 148], bx: [0, 2],   side: 'any',   by: [-4, -2],  fx: 'std',   fy: 'std',    spin: 14, minLv: 1 }, // +level: 137-149 at lv1, 157-169 at lv12
    { name: 'SHOOT',    w: 2, speed: [138, 150], bx: [6, 10],  side: 'arm',   by: [2, 4],    fx: 'early', fy: 'std',    spin: 12, minLv: 2 },
    { name: 'CUTTER',   w: 2, speed: [140, 152], bx: [4, 7],   side: 'glove', by: [1, 2],    fx: 'sharp', fy: 'std',    spin: 12, minLv: 3 },
    { name: 'SLIDER',   w: 3, speed: [128, 140], bx: [9, 15],  side: 'glove', by: [2, 5],    fx: 'late',  fy: 'late',   spin: 8,  minLv: 2 },
    { name: 'CURVE',    w: 2, speed: [106, 120], bx: [5, 9],   side: 'glove', by: [12, 18],  fx: 'std',   fy: 'std',    spin: 5,  minLv: 2, hump: [6, 9] },
    { name: 'SINKER',   w: 2, speed: [134, 146], bx: [4, 8],   side: 'arm',   by: [7, 11],   fx: 'std',   fy: 'late',   spin: 9,  minLv: 3 },
    { name: 'FORKBALL', w: 2, speed: [126, 138], bx: [0, 2],   side: 'any',   by: [12, 18],  fx: 'std',   fy: 'tumble', spin: 2,  minLv: 4 },
    { name: 'CHANGEUP', w: 2, speed: [110, 124], bx: [2, 5],   side: 'arm',   by: [5, 8],    fx: 'std',   fy: 'late',   spin: 4,  minLv: 3 },
    { name: 'SWEEPER',  w: 2, speed: [122, 136], bx: [16, 24], side: 'glove', by: [0, 3],    fx: 'std',   fy: 'std',    spin: 7,  minLv: 3 },
    { name: 'RISING',   w: 2, speed: [138, 150], bx: [0, 3],   side: 'any',   by: [-14, -10], fx: 'std',  fy: 'late',   spin: 16, minLv: 3 },
    { name: 'KNUCKLE',  w: 2, speed: [100, 114], bx: [0, 3],   side: 'any',   by: [2, 6],    fx: 'std',   fy: 'late',   spin: 0,  minLv: 4, wobble: [3, 5] },
  ];

  // Pitcher delivery. Submarine shows up from level 2, releases at knee height, and its ball
  // naturally rises and runs to the arm side. The sprite + release point follow the form.
  function pickForm(level) {
    return level >= 2 && Math.random() < 0.3 ? 'SUBMARINE' : 'OVERHAND';
  }

  function pickType(level) {
    // early levels: mostly fastballs; the arsenal opens up with level
    const pool = [];
    for (const t of PITCH_TYPES) {
      if (level < t.minLv) continue;
      let w = t.w;
      if (t.name === 'FASTBALL') w += Math.max(0, 5 - level);
      for (let i = 0; i < w; i++) pool.push(t);
    }
    return pick(pool);
  }

  // jersey numbers: a new one for every batter, never the same twice in a row
  let lastNumber = -1;
  function nextNumber() {
    let n;
    do { n = rndInt(100); } while (n === lastNumber);
    lastNumber = n;
    return n;
  }

  function genPitch(level) {
    // who is up: a short, average or tall batter; the zone is sized to him before the pitch is placed
    const r0 = Math.random();
    const batterSize = r0 < 0.3 ? 'short' : r0 < 0.7 ? 'mid' : 'tall';
    Object.assign(ZONE, zoneFor(BATTER_H[batterSize]));
    const ex0 = ZONE.x0 - BALL_R, ex1 = ZONE.x1 + BALL_R;
    const ey0 = ZONE.y0 - BALL_R, ey1 = ZONE.y1 + BALL_R;
    const isStrike = Math.random() < 0.5;
    const edgeProb = clamp(0.2 + level * 0.07, 0.2, 0.8);
    const edge = Math.random() < edgeProb;
    let x, y;
    const side = rndInt(4); // 0 left, 1 right, 2 top, 3 bottom

    if (isStrike) {
      if (edge) {
        const d = rnd(1, 3.6);
        if (side === 0) { x = ex0 + d; y = rnd(ey0 + 2, ey1 - 2); }
        else if (side === 1) { x = ex1 - d; y = rnd(ey0 + 2, ey1 - 2); }
        else if (side === 2) { y = ey0 + d; x = rnd(ex0 + 2, ex1 - 2); }
        else { y = ey1 - d; x = rnd(ex0 + 2, ex1 - 2); }
      } else {
        x = rnd(ex0 + 3, ex1 - 3); y = rnd(ey0 + 3, ey1 - 3);
      }
    } else {
      const d = edge ? rnd(1, 3.6) : rnd(4, 18);
      const spread = edge ? 3 : 10;
      if (side === 0) { x = ex0 - d; y = rnd(ey0 - spread, ey1 + spread); }
      else if (side === 1) { x = ex1 + d; y = rnd(ey0 - spread, ey1 + spread); }
      else if (side === 2) { y = ey0 - d; x = rnd(ex0 - spread, ex1 + spread); }
      else { y = ey1 + d; x = rnd(ex0 - spread, ex1 + spread); }
    }
    x = clamp(x, 46, 122); y = clamp(y, ZONE.y0 - 25, ZONE.y1 + 25);

    const type = pickType(level);
    const form = pickForm(level);
    const hand = sgn(); // +1 right-hander: arm on the umpire's left (-x), glove side = +x
    const dir = type.side === 'glove' ? hand : type.side === 'arm' ? -hand : sgn();
    let bx = rnd(type.bx[0], type.bx[1]) * dir;
    let by = rnd(type.by[0], type.by[1]);
    const hump = type.hump ? rnd(type.hump[0], type.hump[1]) : 0;
    // speed creeps up with level, then jumps from level 10 on
    let speed = Math.round(rnd(type.speed[0], type.speed[1]) + Math.min(level, 8) + Math.max(0, level - 9) * 3);
    // knuckleball: no spin, flutters side to side on the way in (sin terms vanish at t=1, so it still lands on target)
    const wob = type.wobble ? {
      ax: rnd(type.wobble[0], type.wobble[1]) * sgn(), ay: rnd(type.wobble[0], type.wobble[1]) * 0.6 * sgn(),
      nx: pick([2, 3]), ny: pick([2, 3, 4]),
    } : null;
    if (form === 'SUBMARINE') {
      by -= rnd(3, 5);            // comes up from the knee: everything rides a little
      bx += rnd(2, 4) * -hand;    // arm-side run
      speed -= 6;
    }
    // flight time from the real distance (18.44 m) at the shown speed, stretched 1.3x so it stays
    // readable, then tightened a little per level. 137 km/h at level 1 ~ 0.62 s; 169 at level 12 ~ 0.41 s.
    let dur = (18.44 / (speed / 3.6)) * 1.3;
    dur *= clamp(1 - level * 0.02, 0.8, 1);

    const located = isStrikeAt(x, y);
    const edgeDist = edgeDistance(x, y);
    // batter: sometimes swings through (a strike wherever it is), sometimes checks (held = no swing)
    let swing = 'none';
    if (level >= 2) {
      const r = Math.random();
      if (r < 0.14) swing = 'full';
      else if (level >= 3 && r < 0.22) swing = 'check';
    }
    // catcher framing: after the catch he pulls the mitt toward the zone. On a near-miss ball that is the
    // trap (ball ends up looking inside); on an edge strike he just tidies it up toward the middle.
    let frame = null;
    if (swing !== 'full' && level >= 2 && edgeDist < 11) {
      const pTrap = clamp(0.35 + level * 0.05, 0, 0.8);
      if (!located && Math.random() < pTrap) {
        const ix = clamp(x, ZONE.x0 - BALL_R + 3, ZONE.x1 + BALL_R - 3);
        const iy = clamp(y, ZONE.y0 - BALL_R + 3, ZONE.y1 + BALL_R - 3);
        frame = { dx: ix - x, dy: iy - y, trap: true };
      } else if (located && edgeDist < 4 && Math.random() < 0.5) {
        const cx = (ZONE.x0 + ZONE.x1) / 2, cy = (ZONE.y0 + ZONE.y1) / 2;
        const d = Math.hypot(cx - x, cy - y) || 1;
        frame = { dx: (cx - x) / d * 5.5, dy: (cy - y) / d * 5.5, trap: false };
      }
    }

    return {
      x, y, bx, by, hump, fx: PROFILE[type.fx], fy: PROFILE[type.fy], spin: type.spin,
      type: type.name, speed, dur, form, hand: hand > 0 ? 'R' : 'L', wob,
      rel: RELEASE[form][hand > 0 ? 'R' : 'L'],
      strike: located || swing === 'full',
      located, edgeDist, swing, frame,
      batterLeft: Math.random() < 0.35, batterSize, number: nextNumber(), kit: rndInt(KITS.length),
    };
  }

  function isStrikeAt(x, y) {
    return x >= ZONE.x0 - BALL_R && x <= ZONE.x1 + BALL_R && y >= ZONE.y0 - BALL_R && y <= ZONE.y1 + BALL_R;
  }
  function edgeDistance(x, y) {
    const ex0 = ZONE.x0 - BALL_R, ex1 = ZONE.x1 + BALL_R, ey0 = ZONE.y0 - BALL_R, ey1 = ZONE.y1 + BALL_R;
    const dx = Math.max(ex0 - x, 0, x - ex1), dy = Math.max(ey0 - y, 0, y - ey1);
    if (dx === 0 && dy === 0) return Math.min(x - ex0, ex1 - x, y - ey0, ey1 - y); // inside
    return Math.hypot(dx, dy);
  }

  function ballPos(p, t) {
    let sx = p.rel.x + (p.x - p.bx - p.rel.x) * t + p.bx * p.fx(t);
    let sy = p.rel.y + (p.y - p.by - p.rel.y) * t + p.by * p.fy(t) - p.hump * Math.sin(Math.PI * t);
    if (p.wob) {
      sx += p.wob.ax * Math.sin(Math.PI * p.wob.nx * t) * t;
      sy += p.wob.ay * Math.sin(Math.PI * p.wob.ny * t) * t;
    }
    return { x: sx, y: sy, r: 1 + (BALL_R - 1) * t * t };
  }

  function levelFor(pitchIndex) { return Math.min(12, 1 + Math.floor(pitchIndex / 5)); }
  function callWindowFor(level) { return Math.max(0.9, 2.2 - level * 0.12); }

  // ------------------------------------------------------------
  // DOM
  // ------------------------------------------------------------
  const $ = (id) => document.getElementById(id);
  // every <section class="screen" id="screen-x"> in the page, keyed by x (so a screen added to the HTML
  // can never be left visible by a script that does not know it)
  const screens = Object.fromEntries([...document.querySelectorAll('.screen')].map((s) => [s.id.replace('screen-', ''), s]));
  const canvas = $('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  const el = {
    score: $('hud-score'), streak: $('hud-streak'), level: $('hud-level'), miss: $('hud-miss'),
    call: $('call-text'), judge: $('judge-text'), bonus: $('bonus-text'), abs: $('abs-text'),
    pause: $('pause-text'), btnPause: $('btn-pause'),
    info: $('pitch-info'), count: $('pitch-count'), timer: $('timer-fill'),
    btnStrike: $('btn-strike'), btnBall: $('btn-ball'), stage: $('stage'),
    titleBest: $('title-best'), guideLabel: $('guide-label'), soundLabel: $('sound-label'), musicLabel: $('music-label'),
    paletteLabel: $('palette-label'),
  };

  let currentScreen = 'title';
  function showScreen(name) {
    for (const k in screens) screens[k].classList.toggle('hidden', k !== name);
    currentScreen = name;
    if (name === 'title') refreshTitle();
    if (name === 'records') renderRecords();
    if (name === 'play') fitCanvas();
  }

  function fitCanvas() {
    const availW = Math.min(window.innerWidth - 40, 560);
    const availH = window.innerHeight - 250;
    let s = Math.min(availW / W, availH / H);
    if (s >= 2) s = Math.floor(s);
    s = Math.max(s, 1.2);
    canvas.style.width = Math.round(W * s) + 'px';
    canvas.style.height = Math.round(H * s) + 'px';
  }
  window.addEventListener('resize', fitCanvas);

  // ------------------------------------------------------------
  // Game state
  // ------------------------------------------------------------
  const G = {
    phase: 'idle',   // idle | windup | flight | call | reveal | over
    t: 0,            // phase timer (s)
    pitchIndex: 0, score: 0, streak: 0, bestStreak: 0, misses: 0, correct: 0,
    pitch: null, level: 1, callTime: 0, callWindow: 2, userCall: null, result: null,
    ball: null, mitt: { x: MITT_REST.x, y: MITT_REST.y }, trail: [],
    shake: 0, flash: 0,
  };

  function newGame() {
    Object.assign(G, {
      phase: 'idle', t: 0, pitchIndex: 0, score: 0, streak: 0, bestStreak: 0, misses: 0, correct: 0,
      pitch: null, level: 1, userCall: null, result: null, ball: null, trail: [], shake: 0, flash: 0,
    });
    G.mitt = { x: MITT_REST.x, y: MITT_REST.y };
    G.paused = false; el.pause.classList.remove("show"); el.btnPause.classList.remove("pressed");
    hideText();
    updateHud();
    el.info.textContent = ' ';
    showScreen('play');
    Music.start('play');
    startWindup(0.9);
  }

  function startWindup(delay) {
    G.phase = 'windup';
    G.t = -(delay || 0);
    G.level = levelFor(G.pitchIndex);
    G.pitch = genPitch(G.level);
    G.callWindow = callWindowFor(G.level);
    G.ball = null; G.trail = []; G.userCall = null; G.result = null;
    G.mitt = { x: MITT_REST.x, y: MITT_REST.y };
    el.count.textContent = 'PITCH ' + (G.pitchIndex + 1);
    el.timer.style.width = '0%';
    el.timer.classList.remove('warn');
    hideText();
    if (G.pitchIndex > 0 && G.pitchIndex % 5 === 0) {
      showText(el.call, 'LEVEL ' + G.level, '');
      if (G.level === 2 && settings.guide) showText(el.bonus, 'ZONE GUIDE OFF', '');
    }
    updateHud();
  }

  function update(dt) {
    G.t += dt;
    if (G.shake > 0) G.shake -= dt;
    if (G.flash > 0) G.flash -= dt;

    switch (G.phase) {
      case 'windup':
        if (G.t >= 0 && G.t - dt < 0) Sfx.windup();
        if (G.t >= 0.55) {
          G.phase = 'flight'; G.t = 0;
          hideText();
          Sfx.whoosh();
        }
        break;

      case 'flight': {
        const p = G.pitch;
        const tt = Math.min(1, G.t / p.dur);
        G.ball = ballPos(p, tt);
        if (G.trail.length === 0 || Math.hypot(G.ball.x - G.trail[G.trail.length - 1].x, G.ball.y - G.trail[G.trail.length - 1].y) > 2) {
          G.trail.push({ x: G.ball.x, y: G.ball.y, r: G.ball.r });
          const maxTrail = G.pitch.speed >= 140 ? 5 : G.pitch.speed >= 125 ? 3 : 2; // faster = longer streak
          while (G.trail.length > maxTrail) G.trail.shift();
        }
        if (tt >= 1) {
          G.phase = 'call'; G.t = 0; G.callTime = 0;
          G.ball = { x: p.x, y: p.y, r: BALL_R };
          Sfx.pop();
          G.flash = 0.06;
        }
        break;
      }

      case 'call': {
        // mitt snaps onto the ball shortly after it arrives
        const p = G.pitch;
        const k = clamp(G.t / 0.1, 0, 1);
        G.mitt.x = MITT_REST.x + (p.x - MITT_REST.x) * k;
        G.mitt.y = MITT_REST.y + (p.y - MITT_REST.y) * k;
        if (p.frame) {
          // framing: after the catch the mitt (ball inside) drifts toward the zone
          const f = clamp((G.t - 0.08) / 0.16, 0, 1); // quick tug, right after the catch
          const e = f * f * (3 - 2 * f);
          G.mitt.x += p.frame.dx * e; G.mitt.y += p.frame.dy * e;
          G.ball = { x: p.x + p.frame.dx * e, y: p.y + p.frame.dy * e, r: BALL_R };
        }
        const remain = 1 - G.t / G.callWindow;
        el.timer.style.width = Math.max(0, remain * 100) + '%';
        el.timer.classList.toggle('warn', remain < 0.35);
        if (G.t >= G.callWindow) resolveCall(null);
        break;
      }

      case 'reveal':
        if (G.t >= 1.5) {
          if (G.misses >= 3) gameOver();
          else {
            G.pitchIndex++;
            const up = levelFor(G.pitchIndex) > G.level;
            if (up) Sfx.levelUp();
            startWindup(up ? 2.4 : 0.35); // level up: hold on the banner while the jingle plays
          }
        }
        break;
    }
  }

  // Pause (space / P / the || button). Freezes the game clock and the music; the scene stays drawn.
  function setPaused(on) {
    if (currentScreen !== 'play' || G.phase === 'idle' || G.phase === 'over') on = false;
    if (on === !!G.paused) return;
    G.paused = on;
    el.pause.classList.toggle('show', on);
    el.btnPause.classList.toggle('pressed', on);
    if (on) Music.stop(); else Music.start();
    Sfx.init(); Sfx.select();
  }

  function makeCall(call) {
    if (G.paused) return;
    if (G.phase === 'flight' && G.t / G.pitch.dur >= 0.9) {
      // early (but acceptable) call: snap the ball in
      G.phase = 'call'; G.t = 0; G.ball = { x: G.pitch.x, y: G.pitch.y, r: BALL_R };
      Sfx.pop();
    }
    if (G.phase !== 'call') return;
    resolveCall(call);
  }

  function resolveCall(call) {
    const p = G.pitch;
    const reaction = G.t;
    G.userCall = call;
    const correct = call !== null && call === (p.strike ? 'strike' : 'ball');
    G.result = { correct, timeout: call === null };
    G.phase = 'reveal'; G.t = 0;
    el.timer.style.width = '0%';

    if (call === 'strike') Sfx.strikeCall(); else if (call === 'ball') Sfx.ballCall();

    let bonusMsgs = [];
    if (correct) {
      G.streak++;
      G.correct++;
      G.bestStreak = Math.max(G.bestStreak, G.streak);
      let pts = 100;
      const mult = 1 + Math.min(G.streak - 1, 10) * 0.1;
      pts *= mult;
      // framing never changes the call or the score: the ball is judged where it crossed the plate
      if (p.edgeDist < 3.8 && p.swing !== 'full') { pts += 50; bonusMsgs.push('FINE CALL +50'); }
      if (reaction < 0.6) { pts += 30; bonusMsgs.push('QUICK +30'); }
      if (!settings.guide) pts *= 1.5;
      if (mult > 1) bonusMsgs.unshift('x' + mult.toFixed(1));
      pts = Math.round(pts);
      G.score += pts;
      setTimeout(() => Sfx.good(), 120);
    } else {
      G.streak = 0;
      G.misses++;
      G.shake = 0.3;
      setTimeout(() => Sfx.bad(), 120);
      el.stage.classList.remove('game-shake'); void el.stage.offsetWidth; el.stage.classList.add('game-shake');
    }

    // texts
    showText(el.call, p.strike ? 'STRIKE!' : 'BALL', p.strike ? '' : 'ball');
    const judge = G.result.timeout ? 'TOO LATE!' : correct ? 'CORRECT!' : 'WRONG!';
    setTimeout(() => showText(el.judge, judge, correct ? 'ok' : 'ng'), 180);
    // what actually happened on the play, then any bonus
    const tags = [];
    if (p.swing === 'full') tags.push('SWING & MISS!');
    else if (p.swing === 'check') tags.push('CHECK SWING - NO SWING');
    if (p.frame) tags.push('FRAMED!');
    const msgs = tags.concat(correct ? bonusMsgs : []);
    if (msgs.length) setTimeout(() => showText(el.bonus, msgs.join('  '), ''), 300);
    // ABS readout on a wrong call, or on any edge pitch (never on a swing: location did not matter)
    G.showAbs = p.swing !== 'full' && (!correct || p.edgeDist < 3.8);
    if (G.showAbs) setTimeout(() => showText(el.abs, absText(p), ''), 450);
    el.info.textContent = (p.form === 'SUBMARINE' ? 'SUB ' : '') + p.type + ' ' + p.speed + ' km/h';
    updateHud();
  }

  function gameOver() {
    G.phase = 'over';
    Music.stop();
    Sfx.over();
    const acc = G.pitchIndex + 1 > 0 ? Math.round(G.correct / (G.pitchIndex + 1) * 100) : 0;
    $('over-score').textContent = G.score;
    $('over-pitches').textContent = G.pitchIndex + 1;
    $('over-acc').textContent = acc + '%';
    $('over-streak').textContent = G.bestStreak;
    const prevBest = settings.records.length ? settings.records[0].score : 0;
    const isBest = G.score > prevBest && G.score > 0;
    $('over-newbest').classList.toggle('hidden', !isBest);
    settings.records.push({ score: G.score, pitches: G.pitchIndex + 1, acc, date: new Date().toISOString().slice(0, 10) });
    settings.records.sort((a, b) => b.score - a.score);
    settings.records = settings.records.slice(0, 5);
    saveSettings();
    setTimeout(() => showScreen('over'), 600);
  }

  // ------------------------------------------------------------
  // HUD / text helpers
  // ------------------------------------------------------------
  function updateHud() {
    el.score.textContent = G.score;
    el.streak.textContent = G.streak;
    el.level.textContent = G.level;
    const dots = el.miss.querySelectorAll('i');
    dots.forEach((d, i) => d.classList.toggle('on', i < G.misses));
  }
  function showText(node, text, cls) {
    node.textContent = text;
    node.className = node.className.split(' ')[0] + ' ' + (cls || '') + ' show game-pop';
  }
  function hideText() {
    for (const n of [el.call, el.judge, el.bonus, el.abs]) n.className = n.className.split(' ')[0];
  }

  // ABS-style readout: how far the ball was from the zone, in inches (zone is 28px = 17in wide)
  const IN_PER_PX = 17 / (ZONE.x1 - ZONE.x0);
  function absText(p) {
    const inches = (p.edgeDist * IN_PER_PX).toFixed(1);
    if (p.located) return 'ABS: STRIKE BY ' + inches + ' IN';
    const ex0 = ZONE.x0 - BALL_R, ex1 = ZONE.x1 + BALL_R, ey0 = ZONE.y0 - BALL_R, ey1 = ZONE.y1 + BALL_R;
    const dx = p.x < ex0 ? p.x - ex0 : p.x > ex1 ? p.x - ex1 : 0;
    const dy = p.y < ey0 ? p.y - ey0 : p.y > ey1 ? p.y - ey1 : 0;
    let where;
    if (Math.abs(dy) >= Math.abs(dx)) where = dy < 0 ? 'HIGH' : 'LOW';
    else where = (dx < 0) === !p.batterLeft ? 'INSIDE' : 'OUTSIDE'; // relative to the batter
    return 'ABS: BALL BY ' + inches + ' IN (' + where + ')';
  }
  // gold measuring tick from the ball's edge to the nearest point of the zone box
  function drawAbsTick(p) {
    const nx = clamp(p.x, ZONE.x0, ZONE.x1), ny = clamp(p.y, ZONE.y0, ZONE.y1);
    const d = Math.hypot(nx - p.x, ny - p.y);
    if (p.located || d < 0.5) return;
    const ux = (nx - p.x) / d, uy = (ny - p.y) / d;
    const x0 = p.x + ux * BALL_R, y0 = p.y + uy * BALL_R;
    const steps = Math.max(1, Math.round(d - BALL_R));
    ctx.fillStyle = PAL.G;
    for (let i = 0; i <= steps; i++) ctx.fillRect(Math.round(x0 + ux * i), Math.round(y0 + uy * i), 1, 1);
    // tick mark at the zone end, perpendicular to the line
    const tx = Math.round(nx), ty = Math.round(ny);
    if (Math.abs(ux) >= Math.abs(uy)) ctx.fillRect(tx, ty - 2, 1, 5); else ctx.fillRect(tx - 2, ty, 5, 1);
  }

  // ------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------
  function fillCircle(x, y, r, color) {
    const cx = Math.round(x), cy = Math.round(y);
    const ri = Math.ceil(r);
    ctx.fillStyle = color;
    if (r < 1.5) { ctx.fillRect(cx, cy, 1, 1); if (r >= 1) ctx.fillRect(cx - 1, cy, 1, 1), ctx.fillRect(cx, cy - 1, 1, 1); return; }
    for (let j = -ri; j <= ri; j++) {
      for (let i = -ri; i <= ri; i++) {
        if (i * i + j * j <= r * r) ctx.fillRect(cx + i, cy + j, 1, 1);
      }
    }
  }

  // Seam pixel sets for 4 spin frames (relative to the ball center)
  const SEAMS = [
    [[-1, -2], [0, -1], [0, 1], [1, 2]],
    [[-2, 0], [-1, 0], [1, 0], [2, 0]],
    [[1, -2], [0, -1], [0, 1], [-1, 2]],
    [[0, -2], [0, -1], [0, 1], [0, 2]],
  ];
  function drawBall(b, dim, spinFrame) {
    fillCircle(b.x, b.y, b.r + 0.6, PAL.K);
    fillCircle(b.x, b.y, b.r, dim ? PAL.g : PAL.w);
    if (!dim && b.r >= 2) fillCircle(b.x - 0.6, b.y - 0.6, b.r - 0.8, PAL.W); // light from upper-left
    if (b.r >= 2.5 && !dim) {
      ctx.fillStyle = PAL.R;
      const cx = Math.round(b.x), cy = Math.round(b.y);
      for (const [dx, dy] of SEAMS[(spinFrame || 0) & 3]) ctx.fillRect(cx + dx, cy + dy, 1, 1);
    }
  }

  // Umpire call inset (bottom-right) during the reveal
  function drawUmpire(strike) {
    const bx = W - 46, by = H - 46, bw = 42, bh = 42;
    ctx.fillStyle = PAL.K; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = PAL.W; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = PAL.n; ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
    ctx.drawImage(strike ? IMG.umpStrike : IMG.umpBall, bx + 3, by + 5);
  }

  function drawZoneGuide(strong) {
    ctx.fillStyle = strong ? PAL.W : PAL.y;
    const { x0, x1, y0, y1 } = ZONE;
    const step = strong ? 1 : 3;
    for (let x = x0; x <= x1; x += step) { ctx.fillRect(x, y0, 1, 1); ctx.fillRect(x, y1, 1, 1); }
    for (let y = y0; y <= y1; y += step) { ctx.fillRect(x0, y, 1, 1); ctx.fillRect(x1, y, 1, 1); }
    if (strong) {
      ctx.fillStyle = PAL.K;
      for (let x = x0 - 1; x <= x1 + 1; x++) { ctx.fillRect(x, y0 - 1, 1, 1); ctx.fillRect(x, y1 + 1, 1, 1); }
      for (let y = y0 - 1; y <= y1 + 1; y++) { ctx.fillRect(x0 - 1, y, 1, 1); ctx.fillRect(x1 + 1, y, 1, 1); }
    }
  }

  // 3x5 pixel digits, drawn with 2x2 cells, centred on (cx, cy)
  const DIGITS = [
    '111101101101111', '010110010010111', '111001111100111', '111001111001111', '101101111001001',
    '111100111001111', '111100111101111', '111001001001001', '111101111101111', '111101111001111',
  ];
  function drawNumber(n, cx, cy, color) {
    const str = String(n);
    const cell = 2, dw = 3 * cell, gap = cell;
    const total = str.length * dw + (str.length - 1) * gap;
    let x0 = Math.round(cx - total / 2), y0 = Math.round(cy - 5 * cell / 2);
    ctx.fillStyle = color;
    for (const ch of str) {
      const bits = DIGITS[+ch];
      for (let i = 0; i < 15; i++) if (bits[i] === '1') ctx.fillRect(x0 + (i % 3) * cell, y0 + Math.floor(i / 3) * cell, cell, cell);
      x0 += dw + gap;
    }
  }

  function pitcherFrame() {
    const t = G.t;
    switch (G.phase) {
      case 'windup': return t < 0.1 ? 0 : t < 0.35 ? 1 : 2;
      case 'flight': return t < 0.12 ? 3 : 4;
      case 'call': return t < 0.35 ? 4 : 0;
      default: return 0;
    }
  }

  function batterFrame() {
    const p = G.pitch;
    if (!p || p.swing === 'none') return 0;
    const tt = G.phase === 'flight' ? G.t / p.dur : G.phase === 'windup' ? 0 : 2;
    if (p.swing === 'check') return tt >= 0.86 ? 1 : 0;
    // full swing: straight from the stance to the bat through the zone as the ball arrives, then the
    // follow-through. (It never shows the tipped-bat pose, so a held check swing is unmistakable.)
    if (tt < 0.9) return 0;
    if (G.phase === 'flight' || (G.phase === 'call' && G.t < 0.12)) return 2;
    return 3;
  }

  function render() {
    ctx.save();
    if (G.shake > 0) ctx.translate(rndInt(3) - 1, rndInt(3) - 1);
    ctx.drawImage(BG, 0, 0);

    // pitcher: set -> kick -> cocked (windup), release -> follow-through (flight)
    const pf = IMG.pitcher[G.pitch ? G.pitch.form : 'OVERHAND'][G.pitch ? G.pitch.hand : 'R'];
    ctx.drawImage(pf[pitcherFrame()], POS.pitcher[0], POS.pitcher[1]);

    // batter: stance, or a swing / check swing timed to the ball's arrival
    const left = !!(G.pitch && G.pitch.batterLeft);
    const kit = G.pitch ? G.pitch.kit : 0;
    const bimg = IMG.batter[kit][G.pitch ? G.pitch.batterSize : 'mid'][left ? 'L' : 'R'][batterFrame()];
    // cleats on the ground line; righty keeps his plate-side edge, lefty his (mirrored) plate-side edge
    const bx = left ? POS.batterL[0] : POS.batterR[0] + IMG.batter[0].mid.R[0].width - bimg.width;
    const by = BATTER_FEET_Y - bimg.height + 2;
    ctx.drawImage(bimg, bx, by);
    // jersey number on his back (sprite design units: torso centre x 16.5, number band y 24..34)
    if (G.pitch) {
      const sc = 1.4 * BATTER_H[G.pitch.batterSize];
      const ncx = left ? bx + bimg.width - 16.5 * sc : bx + 16.5 * sc;
      drawNumber(G.pitch.number, ncx, by + 29 * sc, PAL[KITS[kit].num]);
    }

    // zone guide: only while learning (level 1), only if enabled
    const guideOn = settings.guide && G.level === 1 && (G.phase === 'windup' || G.phase === 'flight' || G.phase === 'call');
    // catcher body
    ctx.drawImage(IMG.catcher, POS.catcher[0], POS.catcher[1]);
    if (guideOn) drawZoneGuide(false); // drawn over the catcher like a TV K-zone box, so his helmet never hides it

    // ball (+ trail)
    if (G.phase === 'flight' && G.ball) {
      for (const tr of G.trail) drawBall(tr, true);
      drawBall(G.ball, false, Math.floor(G.t * G.pitch.spin));
    } else if (G.phase === 'call' && G.ball) {
      drawBall(G.ball, false, 0);
    }

    // mitt (covers the ball once caught)
    const mittVisible = !(G.phase === 'reveal');
    if (mittVisible) ctx.drawImage(IMG.mitt, Math.round(G.mitt.x) - (IMG.mitt.width >> 1), Math.round(G.mitt.y) - (IMG.mitt.height >> 1));

    // reveal: zone + true ball location
    if (G.phase === 'reveal' && G.pitch) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      drawZoneGuide(true);
      const p = G.pitch;
      const blink = Math.floor(G.t * 6) % 2 === 0;
      fillCircle(p.x, p.y, BALL_R + 0.6, PAL.K);
      fillCircle(p.x, p.y, BALL_R, blink ? (p.strike ? PAL.G : PAL.W) : PAL.g);
      if (G.showAbs && G.t > 0.3) drawAbsTick(p);
      if (G.t > 0.15) drawUmpire(p.strike);
    }

    // flash on catch
    if (G.flash > 0) { ctx.fillStyle = 'rgba(252,252,252,0.25)'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // ------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------
  const QS = new URLSearchParams(location.search);
  const SLOW = parseFloat(QS.get('slow')) || 1; // debug: ?slow=4 slows game time
  const DEBUG = QS.has('debug');               // debug: ?debug exposes window.__uu to pose frames
  if (DEBUG) window.__uu = { G, ZONE, pause: false, startWindup, render, genPitch, ballPos, showScreen, newGame, img: () => IMG, step: (dt) => { update(dt); render(); }, sfx: Sfx };
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    dt /= SLOW;
    const paused = G.paused || (DEBUG && window.__uu.pause);
    if (!paused && currentScreen === 'play' && G.phase !== 'idle' && G.phase !== 'over') update(dt);
    if (currentScreen === 'play') render();
    requestAnimationFrame(loop);
  }

  // ------------------------------------------------------------
  // Title menu & navigation
  // ------------------------------------------------------------
  const menuItems = Array.from(document.querySelectorAll('#title-menu .menu-item'));
  let menuIndex = 0;
  function setMenu(i) {
    menuIndex = (i + menuItems.length) % menuItems.length;
    menuItems.forEach((m, k) => m.classList.toggle('active', k === menuIndex));
  }
  function refreshTitle() {
    el.titleBest.textContent = settings.records.length ? settings.records[0].score : 0;
    el.guideLabel.textContent = settings.guide ? 'ON' : 'OFF (x1.5)';
    el.soundLabel.textContent = settings.sound ? 'ON' : 'OFF';
    el.musicLabel.textContent = settings.music ? 'ON' : 'OFF';
    el.paletteLabel.textContent = (PALETTES[settings.palette] || PALETTES[0]).name;
    setMenu(menuIndex);
  }
  function menuAction(action) {
    Sfx.init(); Sfx.resume();
    Music.start('title');
    switch (action) {
      case 'start': Sfx.select(); newGame(); break;
      case 'guide': settings.guide = !settings.guide; saveSettings(); Sfx.select(); refreshTitle(); break;
      case 'sound': settings.sound = !settings.sound; Sfx.enabled = settings.sound; saveSettings(); Sfx.select(); refreshTitle(); break;
      case 'music': settings.music = !settings.music; saveSettings(); Music.apply(); Sfx.select(); refreshTitle(); break;
      case 'palette': settings.palette = (settings.palette + 1) % PALETTES.length; saveSettings(); applyPalette(settings.palette); Sfx.select(); refreshTitle(); break;
      case 'howto': Sfx.select(); showScreen('howto'); break;
      case 'records': Sfx.select(); showScreen('records'); break;
      case 'back': Sfx.select(); showScreen('title'); break;
    }
  }
  menuItems.forEach((m, i) => {
    m.addEventListener('pointerenter', () => setMenu(i));
    m.addEventListener('click', () => { setMenu(i); menuAction(m.dataset.action); });
  });
  document.querySelectorAll('[data-action="back"]').forEach((b) => b.addEventListener('click', () => menuAction('back')));

  function renderRecords() {
    const list = $('records-list');
    list.innerHTML = '';
    if (!settings.records.length) {
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = 'NO CALLS YET.'; list.appendChild(li); return;
    }
    for (const r of settings.records) {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + r.pitches + ' pitches / ' + r.acc + '%</span><b>' + r.score + '</b>';
      list.appendChild(li);
    }
  }

  // play buttons
  const press = (btn, call) => {
    btn.addEventListener('pointerdown', (e) => { e.preventDefault(); Sfx.init(); Sfx.resume(); btn.classList.add('pressed'); makeCall(call); });
    btn.addEventListener('pointerup', () => btn.classList.remove('pressed'));
    btn.addEventListener('pointerleave', () => btn.classList.remove('pressed'));
    btn.addEventListener('click', (e) => e.preventDefault());
  };
  press(el.btnStrike, 'strike');
  press(el.btnBall, 'ball');

  $('btn-retry').addEventListener('click', () => { Sfx.select(); newGame(); });
  $('btn-title').addEventListener('click', () => { Sfx.select(); Music.start('title'); showScreen('title'); });
  $('btn-pause').addEventListener('pointerdown', (e) => { e.preventDefault(); setPaused(!G.paused); });
  $('btn-share').addEventListener('click', async () => {
    const text = 'UUUMPIRE: I scored ' + G.score + ' pts in ' + (G.pitchIndex + 1) + ' pitches (' + $('over-acc').textContent + ' accuracy). Can you call it better?';
    const url = location.href.split('#')[0];
    try {
      if (navigator.share) await navigator.share({ title: 'UUUMPIRE', text, url });
      else { await navigator.clipboard.writeText(text + ' ' + url); $('btn-share').textContent = 'COPIED!'; setTimeout(() => $('btn-share').textContent = 'SHARE', 1500); }
    } catch (e) { /* user cancelled */ }
  });

  // keyboard
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (currentScreen === 'title') {
      if (k === 'ArrowUp' || k === 'w') { setMenu(menuIndex - 1); Sfx.init(); Sfx.move(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's') { setMenu(menuIndex + 1); Sfx.init(); Sfx.move(); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') { menuAction(menuItems[menuIndex].dataset.action); e.preventDefault(); }
    } else if (currentScreen === 'play') {
      if (k === ' ' || k === 'p' || k === 'P') { setPaused(!G.paused); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 's' || k === 'S' || k === '1') { makeCall('strike'); flashBtn(el.btnStrike); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'b' || k === 'B' || k === '2') { makeCall('ball'); flashBtn(el.btnBall); e.preventDefault(); }
      else if (k === 'Escape') { setPaused(false); showScreen('title'); }
    } else if (currentScreen === 'over') {
      if (k === 'Enter' || k === ' ') { newGame(); e.preventDefault(); }
      else if (k === 'Escape') showScreen('title');
    } else {
      if (k === 'Escape' || k === 'Enter' || k === 'Backspace') menuAction('back');
    }
  });
  function flashBtn(btn) { btn.classList.add('pressed'); setTimeout(() => btn.classList.remove('pressed'), 120); }

  // ------------------------------------------------------------
  // Boot
  // ------------------------------------------------------------
  Sfx.enabled = settings.sound;
  if (!PALETTES[settings.palette]) settings.palette = 0;
  applyPalette(settings.palette);
  showScreen('loading');
  fitCanvas();
  requestAnimationFrame(loop);

  // Loading screen: the pixel font plus the ballpark tunes in assets/songs (index.json lists them and
  // which pool, title or play, each belongs to). A tune that fails to load is simply left out.
  async function boot() {
    const fill = $('load-fill'), text = $('load-text');
    const tasks = [];
    let done = 0;
    const tick = (label) => { done++; fill.style.width = Math.round(done / tasks.length * 100) + '%'; text.textContent = label; };
    const addTask = (label, p) => tasks.push(p.catch(() => {}).then(() => tick(label)));
    // the page is hidden (html.fonts-loading) until the pixel font is really usable, so no text is
    // ever shown in a fallback font; a 3 s safety timeout reveals it regardless
    const fontReady = document.fonts
      ? Promise.race([document.fonts.load('16px "Cubic 11"').then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 3000))])
      : Promise.resolve();
    fontReady.then(() => document.documentElement.classList.remove('fonts-loading'));
    addTask('FONT', fontReady);
    let index = { play: [], title: [] };
    try { index = await (await fetch('assets/songs/index.json')).json(); } catch (e) { /* no extra songs */ }
    const loadSong = (key, pool) => fetch('assets/songs/' + key + '.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((song) => { if (window.UUMusic) { window.UUMusic.Player.addSong(key, song); pool.push(key); } });
    for (const key of index.play || []) addTask(key.toUpperCase(), loadSong(key, PLAY_SONGS));
    for (const key of index.title || []) addTask(key.toUpperCase(), loadSong(key, TITLE_SONGS));
    fill.style.width = '0%';
    await Promise.all(tasks);
    fill.style.width = '100%'; text.textContent = 'PLAY BALL!';
    await new Promise((r) => setTimeout(r, 250));
    showScreen('title');
    armTitleMusic();
  }

  // Title music: start right away when the browser lets audio run without a gesture (Chrome does once
  // it trusts the site), otherwise on the very first tap / click / key anywhere on the page.
  // The browser's autoplay policy decides whether that first attempt is allowed; nothing on the page
  // can force it. Until the audio context is running, the title shows a blinking "tap for music" line.
  function armTitleMusic() {
    Sfx.init();
    const ctx = Sfx.ctx;
    const hint = $('music-hint');
    if (!ctx) return;
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      hint.classList.add('hidden');
      if (currentScreen !== 'play' && currentScreen !== 'over') { Music.stop(); Music.start('title'); }
    };
    const tryNow = () => {
      if (ctx.state === 'running') { go(); return; }
      ctx.resume().then(() => { if (ctx.state === 'running') go(); }).catch(() => {});
    };
    const once = () => {
      document.removeEventListener('pointerdown', once, true);
      document.removeEventListener('keydown', once, true);
      Sfx.resume(); go();
    };
    document.addEventListener('pointerdown', once, true);
    document.addEventListener('keydown', once, true);
    ctx.addEventListener('statechange', () => { if (ctx.state === 'running') go(); });
    tryNow();
    if (!done && settings.music) hint.classList.remove('hidden');
  }

  boot();
})();
