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
  // Rules, pitch model and the state machine live in core.js (no art in there). This file is the
  // presentation: sprites, palettes, sound, HUD, and the mapping of core events to effects.
  // Zone geometry, batter heights and the pitchers' release points come from there too, so the art
  // (tools/gen-sprites.js: pitcher hand pixels, cleat line) and the rules agree on the same numbers.
  const C = window.UU_CORE;
  const { BALL_R, BATTER_H, BATTER_FEET_Y, MITT_REST, UNLOCKS } = C;
  // where the jersey number sits on each batter frame (stance, start, mid-swing, finish), in sprite design
  // units: the stance and start torsos are crouched 3 units lower; the finish shows his back square on
  const BATTER_NUM = [[17, 36], [17, 36], [17, 33], [18, 28]];
  const POS = { pitcher: [68, 33], catcher: [53, 138], batterR: [23, 78], batterL: [78, 78] }; // batter body ~6px off the zone edge
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
      css: { night: '#1c1c1c', gold: '#3cbcfc', navy: '#0078a8', white: '#fcfcfc', red: '#f85898', gray: '#bcbcbc', dim: '#5c5c5c', ink: '#000000', panel: '#000000', btn: '#fcfcfc',
             // the stacked logo/call shadows need darker blues than this palette's mid-blue "navy"
             'logo-shadow': '4px 4px 0 #0b3d5c, 8px 8px 0 #06263a, 12px 12px 0 #000000', 'call-shadow': '3px 3px 0 #0b3d5c, 6px 6px 0 #000000' },
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
      umpHand: makeSprite(SPR.umpHand),
      // batter frames: stance, start (bat off the shoulder), mid-swing (barrel coming round; a check swing
      // stops here), finish (turned all the way round, bat across his back)
      // batter: [kit][size][hand][frame]
      batter: KITS.map((kit) => Object.fromEntries(Object.keys(BATTER_H).map((size) =>
        [size, frames(['batter_' + size, 'batterStart_' + size, 'batterCheck_' + size, 'batterSwing_' + size], kit)]))),
      // umpire call inset: ump[strike|ball][style] = frames (sprites.js ump_<call>_<style>_<n>)
      ump: (() => {
        const out = { strike: {}, ball: {} };
        for (const key of Object.keys(SPR)) {
          const m = /^ump_(strike|ball)_([a-z]+)_(\d+)$/.exec(key);
          if (!m) continue;
          (out[m[1]][m[2]] = out[m[1]][m[2]] || [])[+m[3]] = makeSprite(SPR[key]);
        }
        return out;
      })(),
    };
    BG = makeBackground();
    CROWD = [makeCrowd(0), makeCrowd(1)];
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

    // crowd backdrop + tier edges; the fans themselves are a separate animated layer (makeCrowd)
    x.fillStyle = PAL.m; x.fillRect(0, HORIZON - 14, W, 14);
    for (let row = 0; row < 4; row++) {
      const ry = HORIZON - 14 + row * 3 + (row === 3 ? 1 : 0);
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

  // Crowd layer: tiered rows of heads + shirts (Pawapuro-style). Two frames: at rest, and with a third
  // of the fans bobbed up a pixel; render() alternates them and lifts columns for the wave.
  const CROWD_Y = 26, CROWD_H = 14;
  function makeCrowd(frame) {
    const c = document.createElement('canvas');
    c.width = W; c.height = CROWD_H + 2;
    const x = c.getContext('2d');
    const rnd = seededRand(20261013);
    const shirts = sceneDay ? ['W', 'R', 'B', 'G', 'u', 'y', 'g', 'o'] : ['R', 'B', 'G', 'u', 'g', 'd', 'W', 'l'];
    const heads = ['s', 'z', 'k', 's'];
    for (let row = 0; row < 4; row++) {
      const ry = 2 + row * 3 + (row === 3 ? 1 : 0);
      const off = (row % 2) * 2;
      for (let xx = off; xx < W; xx += 4) {
        if (rnd() < 0.08) continue; // empty seat
        const head = PAL[heads[(rnd() * heads.length) | 0]];
        const shirt = PAL[shirts[(rnd() * shirts.length) | 0]];
        const banner = rnd() < 0.06;
        const bob = frame && rnd() < 0.33 ? 1 : 0;
        x.fillStyle = head; x.fillRect(xx, ry - bob, 2, 1);
        x.fillStyle = shirt; x.fillRect(xx - 1, ry + 1 - bob, 4, 2);
        if (banner) { x.fillStyle = PAL.W; x.fillRect(xx, ry - 2 - bob, 2, 2); }
      }
    }
    return c;
  }
  let CROWD = null;
  function drawCrowd() {
    if (!CROWD) return;
    const hot = (G.mood || 0) >= 4 || G.level >= 10;
    const frame = Math.floor(V.crowdT / (hot ? 0.2 : 0.55)) % 2;
    const img = CROWD[frame];
    if (V.wave > 0) { // the wave rolls right to left across the stands
      const ph = (2.2 - V.wave) * 9;
      for (let xx = 0; xx < W; xx += 4) {
        const lift = Math.sin(xx / 14 + ph) > 0.6 ? 2 : 0;
        ctx.drawImage(img, xx, 0, 4, CROWD_H + 2, xx, CROWD_Y - 2 - lift, 4, CROWD_H + 2);
      }
    } else ctx.drawImage(img, 0, CROWD_Y - 2);
  }

  // Level 10: disco court. A mirror ball over the field, the grass cycling through colours and light
  // spots dancing over everything. Pure dressing, drawn on top of the scene each frame.
  const DISCO_COLS = ['R', 'B', 'G', 'p', 'u', 'y'];
  function drawDiscoField() {
    const tick = Math.floor(V.crowdT / 0.2);
    ctx.globalAlpha = 0.5;
    let yy = 46, band = 3, k = 0;
    while (yy < 140) { // same band layout as the grass stripes, two colours checkered
      ctx.fillStyle = PAL[DISCO_COLS[(k * 2 + tick) % DISCO_COLS.length]];
      ctx.fillRect(0, yy, W, band);
      yy += band; band += 1; k++;
    }
    // two spotlight beams sweeping from the mirror ball across the field
    for (let b = 0; b < 2; b++) {
      const a = Math.sin(V.crowdT * 1.3 + b * 2.1) * 0.9;
      const cx = 84 + a * 110, cy = 172;
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = PAL[DISCO_COLS[(tick + b * 3) % DISCO_COLS.length]];
      ctx.beginPath(); ctx.moveTo(84, 14); ctx.lineTo(cx - 26, cy); ctx.lineTo(cx + 26, cy); ctx.closePath(); ctx.fill();
    }
    ctx.globalAlpha = 1;
    // mirror ball hanging over the mound
    ctx.fillStyle = PAL.K; ctx.fillRect(84, 0, 1, 5);
    fillCircle(84, 11, 6, PAL.K); fillCircle(84, 11, 5, PAL.g);
    ctx.fillStyle = PAL.W;
    for (let j = -4; j <= 4; j++) for (let i = -4; i <= 4; i++) if ((i + j + tick) % 2 === 0 && i * i + j * j <= 20) ctx.fillRect(84 + i, 11 + j, 1, 1);
  }
  function drawDiscoLights() {
    const tick = Math.floor(V.crowdT / 0.1);
    const rnd = seededRand(tick * 7919 + 13);
    for (let n = 0; n < 70; n++) { // coloured light spots on everything
      const x = (rnd() * W) | 0, y = 26 + ((rnd() * 160) | 0), sz = rnd() < 0.3 ? 3 : 2;
      ctx.fillStyle = PAL[DISCO_COLS[(n + tick) % DISCO_COLS.length]];
      ctx.globalAlpha = 0.7 + rnd() * 0.3;
      ctx.fillRect(x, y, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = PAL.W;
    for (let n = 0; n < 16; n++) { // white sparkles: little plus signs that twinkle
      const x = (rnd() * W) | 0, y = 26 + ((rnd() * 160) | 0);
      ctx.fillRect(x - 1, y, 3, 1); ctx.fillRect(x, y - 1, 1, 3);
    }
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
    // crowd noise: 'cheer' (bright swell + a couple of whistles), 'clap' (short, polite), 'boo' (low swell).
    // intensity 0..1 scales volume and length. Pure noise through filters, no samples.
    noiseBuf: null,
    crowd(kind, intensity = 0.6) {
      if (!this.enabled || !this.ctx) return;
      const ctx = this.ctx;
      if (!this.noiseBuf) {
        this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const d = this.noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      const t0 = ctx.currentTime;
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass';
      const g = ctx.createGain();
      const k = clamp(intensity, 0.2, 1);
      let attack, hold, release, vol;
      if (kind === 'boo') { f.frequency.setValueAtTime(420, t0); f.frequency.exponentialRampToValueAtTime(260, t0 + 1.2); f.Q.value = 0.9; attack = 0.25; hold = 0.5 * k; release = 0.9; vol = 0.10 * k; }
      else if (kind === 'clap') { f.frequency.value = 1800; f.Q.value = 0.6; attack = 0.05; hold = 0.15; release = 0.35; vol = 0.05 * k; }
      else { f.frequency.setValueAtTime(900, t0); f.frequency.exponentialRampToValueAtTime(1600, t0 + 0.4); f.Q.value = 0.7; attack = 0.12; hold = 0.4 * k; release = 0.8; vol = 0.09 * k; }
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
      g.gain.setValueAtTime(vol, t0 + attack + hold);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + hold + release);
      src.connect(f).connect(g).connect(ctx.destination);
      src.start(t0); src.stop(t0 + attack + hold + release + 0.05);
      if (kind === 'cheer' && k > 0.5) for (let i = 0; i < 2; i++) this.tone(2200 + Math.random() * 700, 0.25, { type: 'sine', vol: 0.02, delay: 0.2 + i * 0.3, slide: 2600 });
    },
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
  let settings = Object.assign({ sound: true, music: true, palette: 0, records: [], lang: detectLang(), name: '' }, store.load());
  const saveSettings = () => store.save(settings);

  // ------------------------------------------------------------
  // Strings (i18n.js): t(key, ...args) fills {0} {1}; applyLang() rewrites the static page text.
  // ------------------------------------------------------------
  const I18N = window.UU_I18N || { en: { name: 'ENGLISH', html: 'en' } };
  const LANGS = Object.keys(I18N);
  function detectLang() {
    const l = (navigator.language || 'en').toLowerCase();
    return l.startsWith('nan') ? 'nan' : l.startsWith('zh') ? 'zh' : l.startsWith('ja') ? 'ja' : 'en';
  }
  if (!I18N[settings.lang]) settings.lang = 'en';
  function t(key, ...args) {
    const tbl = I18N[settings.lang] || I18N.en;
    let s = tbl[key];
    if (s === undefined) s = I18N.en[key];
    if (s === undefined) s = key;
    if (Array.isArray(s)) s = s[rndInt(s.length)];
    return String(s).replace(/\{(\d)\}/g, (m, i) => (args[+i] === undefined ? '' : args[+i]));
  }
  function applyLang() {
    const tbl = I18N[settings.lang] || I18N.en;
    document.documentElement.lang = tbl.html || 'en';
    document.querySelectorAll('[data-i18n]').forEach((n) => { n.textContent = t(n.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach((n) => { n.innerHTML = t(n.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-ph]').forEach((n) => { n.placeholder = t(n.dataset.i18nPh); });
  }

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
        p.setTempo(1); // menu songs always play straight
        if (p.playing && TITLE_SONGS.includes(p.current)) return; // already on a menu song: keep it
        song = pick(TITLE_SONGS);
      } else if (song === 'play') {
        song = pick(PLAY_SONGS);
      }
      p.setEnabled(true); p.start(song);
    },
    stop() { const p = this.player; if (p) p.stop(); },
    tempo(mult) { const p = this.player; if (p) p.setTempo(mult); },
    apply() { const p = this.player; if (!p) return; p.setEnabled(settings.music); if (settings.music) p.start(); },
  };
  // don't lose a pitch to a tab switch, another window taking focus, or a system overlay
  // (iOS Screen Distance "too close" warning fires no visibilitychange; it does take focus / stall frames)
  function autoPause() { if (currentScreen === 'play' && G.phase !== 'idle' && G.phase !== 'over' && !G.paused) setPaused(true); }
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { Music.stop(); autoPause(); }
    else if (Sfx.ctx && currentScreen !== 'over' && !G.paused) Music.start();
  });
  window.addEventListener('blur', autoPause);

  const rndInt = (n) => Math.floor(Math.random() * n);
  const pick = (arr) => arr[rndInt(arr.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

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
    call: $('call-text'), judge: $('judge-text'), bonus: $('bonus-text'), abs: $('abs-text'), react: $('react-text'), style: $('style-text'),
    pause: $('pause-text'), btnPause: $('btn-pause'), btnReplay: $('btn-replay'), btnQuit: $('btn-quit'), crowd: $('hud-crowd'), langLabel: $('lang-label'),
    info: $('pitch-info'), count: $('pitch-count'), timer: $('timer-fill'),
    btnStrike: $('btn-strike'), btnBall: $('btn-ball'), stage: $('stage'),
    titleBest: $('title-best'), soundLabel: $('sound-label'), musicLabel: $('music-label'),
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
  window.addEventListener('resize', () => { fitCanvas(); if (currentScreen === 'board') Board.fitNames(); });

  // ------------------------------------------------------------
  // Game state: the simulation is core.js; this layer keeps the view-only state and turns core
  // events into sound, text and particles.
  // ------------------------------------------------------------
  const game = C.createGame({ kits: KITS.length, onEvent: onGameEvent });
  const G = game.state;      // phase, t, pitch, score, streak, misses, mood, ball, mitt, zone, result ...

  // The 3D era (era3d.js): from ERA3D_LEVEL the scene is drawn in 3D over the same stage box. The module and
  // its models load in the background two levels early; the pixel scene keeps drawing until it is ready.
  const ERA3D_LEVEL = 12;
  let era3d = null, era3dLoading = null;
  function loadEra3D() {
    if (era3dLoading) return era3dLoading;
    era3dLoading = import('./era3d.js?v=' + (window.UU_V || '')).then((m) => {
      era3d = m.createEra3D({ C, game, stage: el.stage, canvas2d: canvas, assetsBase: window.UU_ERA3D_ASSETS || '../uuumpire-3d/assets/', firstLevel: ERA3D_LEVEL });
      return era3d.ready.then(() => era3d);
    }).catch((e) => { console.error('3D era failed to load', e); era3d = null; });
    return era3dLoading;
  }
  // Level 11 cleared: hold the game and run a "new ballpark" loading bar over the stage (at least a few
  // seconds, longer if the models are still coming), then swap the stage to 3D and show the level banner.
  // If the era never loads, the bar ends and the pixel game simply carries on.
  function eraTransition(e) {
    game.setPaused(true); // the core clock only; no PAUSED overlay
    hideText();
    const box = $('era-load'), text = $('era-load-text'), fill = $('era-load-fill');
    const lines = [t('era.1'), t('era.2'), t('era.3'), t('era.4')];
    box.classList.remove('hidden');
    fill.style.width = '0%';
    const started = performance.now(), MIN_MS = 3800, MAX_MS = 20000;
    let ready = false;
    loadEra3D().then(() => { ready = true; });
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      fill.style.width = '100%';
      text.textContent = lines[lines.length - 1];
      syncEra3D();
      setTimeout(() => {
        box.classList.add('hidden');
        if (currentScreen === 'play') {
          showText(el.call, t('level.n', e.level), '');
          showText(el.bonus, t('lvl.' + e.level), '');
          setTimeout(() => Sfx.crowd('cheer', 1), 150);
        }
        game.setPaused(false);
      }, 400);
    };
    // a timer, not an animation frame: a tab in the background still finishes the bar
    const timer = setInterval(() => {
      if (currentScreen !== 'play') { box.classList.add('hidden'); done = true; clearInterval(timer); return; } // quit to title mid-bar
      const ms = performance.now() - started;
      const k = Math.min(1, ms / MIN_MS);
      fill.style.width = Math.round((ready ? k : Math.min(k, 0.92)) * 100) + '%';
      text.textContent = lines[Math.floor(ms / 950) % lines.length]; // keeps cycling while the models are still coming
      if ((k >= 1 && ready) || ms > MAX_MS) { clearInterval(timer); finish(); }
    }, 50);
  }
  // show the 3D scene when its level is on and it is loaded (now, or as soon as the models land)
  function syncEra3D() {
    if (G.level < ERA3D_LEVEL || currentScreen !== 'play') { if (era3d) era3d.hide(); return; }
    loadEra3D().then(() => { if (era3d && G.level >= ERA3D_LEVEL && currentScreen === 'play') era3d.show(); });
  }
  const ZONE = G.zone;       // sized per batter by the core; same object for the whole game
  const V = {                // view state: nothing here changes a call or a point
    shake: 0, flash: 0, wave: 0, crowdT: 0, particles: [], trail: [], umpStyle: null,
  };
  let lastGame = null;       // summary of the last game (game-over screen, leaderboard submit)

  function newGame() {
    Object.assign(V, { shake: 0, flash: 0, wave: 0, crowdT: 0, particles: [], trail: [], umpStyle: null });
    el.pause.classList.remove("show"); el.btnPause.classList.remove("pressed");
    hideText();
    el.info.textContent = ' ';
    showScreen('play');
    Music.tempo(1);
    Music.start('play');
    game.start();
    // debug: ?level=N starts the run at that level (localhost only)
    const startLevel = DEBUG ? parseInt(QS.get('level'), 10) : 0;
    if (startLevel > 1 && startLevel <= C.RULES.maxLevel) { G.pitchIndex = (startLevel - 1) * C.RULES.pitchesPerLevel; game.startWindup(C.TIMING.firstPitch, true); }
    syncEra3D();
    updateHud();
  }

  function onGameEvent(type, e) {
    if (era3d) era3d.onEvent(type, e);
    switch (type) {
      case 'next': { // a pitch is set up; the windup starts after the delay the core chose
        if (e.level >= ERA3D_LEVEL - 2) loadEra3D();
        if (e.levelUp || e.pitchIndex === 0) syncEra3D();
        V.trail = [];
        el.count.textContent = t('pitch.n', e.pitchIndex + 1);
        el.timer.style.width = '0%';
        el.timer.classList.remove('warn');
        hideText();
        el.btnReplay.classList.add('hidden');
        if (e.levelUp) Sfx.levelUp();
        if (e.levelUp && e.level >= C.RULES.discoLevel) Music.start('disco'); // level 10: the disco inning takes over the PA
        if (e.levelUp && e.level === ERA3D_LEVEL) { eraTransition(e); updateHud(); break; } // level 11 cleared: the ballpark changes
        if (e.congrats) { // cleared the disco inning
          showText(el.call, t('congrats'), 'small', 'party');
          showText(el.bonus, t('congrats.sub'), '', 'wobble');
          spawnConfetti();
          setTimeout(() => Sfx.crowd('cheer', 1), 200);
        } else if (e.banner) {
          showText(el.call, t('level.n', e.level), '');
          const unlock = UNLOCKS[e.level] ? t('lvl.' + e.level) : t('lvl.faster');
          showText(el.bonus, e.level === 2 ? unlock + ' · ' + t('guide.gone') : unlock, '');
        }
        updateHud();
        break;
      }
      case 'windup': Sfx.windup(); break;
      case 'pitch': hideText(); Sfx.whoosh(); break;
      case 'catch':
        Sfx.pop();
        spawnDust(e.x, e.y);
        if (!e.replay) V.flash = 0.06;
        break;
      case 'resolve': onResolve(e); break;
      case 'replay': V.trail = []; hideText(); el.btnReplay.classList.add('hidden'); Sfx.select(); break;
      case 'replayEnd':
        showRevealTexts();
        setTimeout(() => { if (G.phase === 'reveal') el.btnReplay.classList.remove('hidden'); }, 350);
        break;
      case 'over': onGameOver(e); break;
    }
  }

  // Dust kicked up when the ball hits the mitt: a few short-lived pixels
  function spawnDust(x, y) {
    for (let i = 0; i < 7; i++) {
      V.particles.push({ x: x + (Math.random() - 0.5) * 4, y: y + (Math.random() - 0.5) * 4,
        vx: (Math.random() - 0.5) * 50, vy: -10 - Math.random() * 30, life: 0.22 + Math.random() * 0.15, age: 0 });
    }
  }
  function spawnConfetti() {
    for (let i = 0; i < 80; i++) {
      V.particles.push({ x: Math.random() * W, y: -2 - Math.random() * 40, vx: (Math.random() - 0.5) * 24, vy: 18 + Math.random() * 30,
        g: 8, size: 2, color: DISCO_COLS[i % DISCO_COLS.length], life: 2.6 + Math.random() * 1.2, age: 0 });
    }
  }

  // Per-frame view bookkeeping, after game.update(dt): timers, particles, the ball's trail, the call timer.
  function updateView(dt) {
    if (V.shake > 0) V.shake -= dt;
    if (V.flash > 0) V.flash -= dt;
    if (V.wave > 0) V.wave -= dt;
    V.crowdT += dt;
    for (const q of V.particles) { q.age += dt; q.x += (q.vx + (q.size === 2 ? Math.sin(q.age * 6 + q.x) * 10 : 0)) * dt; q.y += q.vy * dt; q.vy += (q.g === undefined ? 90 : q.g) * dt; }
    V.particles = V.particles.filter((q) => q.age < q.life);
    if ((G.phase === 'flight' || G.phase === 'replay') && G.ball) {
      const b = G.ball, last = V.trail[V.trail.length - 1];
      if (!last || Math.hypot(b.x - last.x, b.y - last.y) > 2) {
        V.trail.push({ x: b.x, y: b.y, r: b.r });
        const maxTrail = G.phase === 'replay' ? 6 : G.pitch.speed >= 140 ? 5 : G.pitch.speed >= 125 ? 3 : 2; // faster = longer streak
        while (V.trail.length > maxTrail) V.trail.shift();
      }
    }
    if (G.phase === 'call') {
      const remain = game.callRemain();
      el.timer.style.width = remain * 100 + '%';
      el.timer.classList.toggle('warn', remain < 0.35);
    }
  }

  // Slow-motion replay of the pitch just called (R / REPLAY).
  function startReplay() { game.replay(); }

  // Pause (space / P / the || button). Freezes the game clock and the music; the scene stays drawn.
  function setPaused(on) {
    if (currentScreen !== 'play') on = false;
    if (!game.setPaused(on)) return;
    el.pause.classList.toggle('show', G.paused);
    el.btnQuit.classList.toggle('show', G.paused);
    el.btnPause.classList.toggle('pressed', G.paused);
    if (G.paused) Music.stop(); else Music.start();
    Sfx.init(); Sfx.select();
  }

  function makeCall(call) { game.call(call); }

  // leave a game in progress (Escape, or EXIT TO TITLE on the pause overlay); the run is not recorded
  function quitToTitle() { setPaused(false); Sfx.select(); Music.start('title'); showScreen('title'); if (era3d) era3d.hide(); }

  // the call is in: sound, crowd, the umpire's style for this reveal, the texts
  function onResolve(r) {
    const p = G.pitch;
    V.umpStyle = pickUmpStyle(p.strike);
    el.timer.style.width = '0%';
    if (r.call === 'strike') Sfx.strikeCall(); else if (r.call === 'ball') Sfx.ballCall();
    if (r.correct) setTimeout(() => Sfx.good(), 120);
    else {
      V.shake = 0.3;
      setTimeout(() => Sfx.bad(), 120);
      el.stage.classList.remove('game-shake'); void el.stage.offsetWidth; el.stage.classList.add('game-shake');
    }
    Music.tempo(1 + 0.2 * r.mood);    // the band plays faster as the stands heat up: +20% per cell, 2x when full
    if (r.crowd === 'chant') V.wave = 2.2;
    setTimeout(() => {
      if (!r.correct) Sfx.crowd('boo', r.mood === 0 ? 1 : 0.6);
      else Sfx.crowd(r.call === 'strike' ? 'cheer' : 'clap', 0.4 + 0.12 * r.mood);
    }, 250);
    showRevealTexts();
    el.info.textContent = (p.form === 'SUBMARINE' ? t('sub') : '') + t('pt.' + p.type) + ' ' + p.speed + ' ' + t('kmh');
    el.btnReplay.classList.add('hidden');
    setTimeout(() => { if (G.phase === 'reveal') el.btnReplay.classList.remove('hidden'); }, 350);
    updateHud();
  }

  // the reveal overlay texts (also re-shown after a replay)
  function showRevealTexts() {
    const p = G.pitch, r = G.result;
    const only = (fn) => { if (G.phase === 'reveal') fn(); };
    showText(el.call, p.strike ? t('call.strike') : t('call.ball'), p.strike ? '' : 'ball');
    const judge = r.timeout ? t('judge.late') : r.correct ? t('judge.ok') : t('judge.ng');
    setTimeout(() => only(() => showText(el.judge, judge, r.correct ? 'ok' : 'ng')), 180);
    if (r.reaction !== null) setTimeout(() => only(() => showText(el.react, t('reaction', r.reaction.toFixed(2)), '')), 240);
    if (V.umpStyle) setTimeout(() => only(() => showText(el.style, t('ump.' + V.umpStyle), '')), 500);
    // crowd line, then swing / framing tags, then (on a correct call) the multiplier and bonuses
    const msgs = (r.crowd ? [t('tag.' + r.crowd)] : []).concat(r.tags.map((k) => t('tag.' + k)));
    if (r.correct) {
      if (r.mult > 1) msgs.push('x' + r.mult.toFixed(1));
      for (const k of r.bonus) msgs.push(t('tag.' + k));
    }
    if (msgs.length) setTimeout(() => only(() => showText(el.bonus, msgs.join('  '), '')), 300);
    if (r.abs) setTimeout(() => only(() => showText(el.abs, absText(p), '')), 450);
  }

  // One screen for both endings: a win (last pitch of the last level called) swaps the title and the
  // subtitle for the congratulations, keeps the result panel and the leaderboard entry
  function onGameOver(s) {
    Music.stop();
    if (s.won) { Sfx.levelUp(); setTimeout(() => Sfx.crowd('cheer', 1), 200); } else Sfx.over();
    $('screen-over').classList.toggle('won', !!s.won);
    for (const [id, key] of [['over-title', 'title'], ['over-sub', 'sub']]) {
      const n = $(id);
      n.dataset.i18n = (s.won ? 'win.' : 'over.') + key;  // so a language switch on this screen keeps the right ending
      n.textContent = t(n.dataset.i18n);
    }
    $('over-score').textContent = s.score;
    $('over-pitches').textContent = s.pitches;
    $('over-acc').textContent = s.accuracy + '%';
    $('over-streak').textContent = s.streak;
    $('over-react').textContent = s.reaction === null ? '-' : s.reaction.toFixed(2) + 's';
    lastGame = s;
    Board.resetSubmit();
    const prevBest = settings.records.length ? settings.records[0].score : 0;
    const isBest = s.score > prevBest && s.score > 0;
    $('over-newbest').classList.toggle('hidden', !isBest);
    settings.records.push({ score: s.score, pitches: s.pitches, acc: s.accuracy, date: new Date().toISOString().slice(0, 10) });
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
    // crowd meter: one cell per correct call, two lost per miss
    const lit = G.mood || 0;
    el.crowd.classList.toggle('cold', lit === 0 && !!(G.result && !G.result.correct));
    el.crowd.querySelectorAll('i').forEach((d, i) => d.classList.toggle('on', i < lit));
  }
  // text goes on a dark plate (.plate) inside the overlay node; inner = extra classes for the plate
  function showText(node, text, cls, inner) {
    node.textContent = '';
    const span = document.createElement('span');
    span.className = 'plate' + (inner ? ' ' + inner : '');
    span.textContent = text;
    node.appendChild(span);
    node.className = node.className.split(' ')[0] + ' ' + (cls || '') + ' show game-pop';
  }
  function hideText() {
    for (const n of [el.call, el.judge, el.bonus, el.abs, el.react, el.style]) n.className = n.className.split(' ')[0];
  }

  // ABS-style readout: how far the ball was from the zone (core.absInfo), in inches for English and
  // centimetres for 中文 / 日本語 (the strings carry the unit)
  function absText(p) {
    const a = C.absInfo(p);
    const n = (a.inches * (t('abs.unit') === 'cm' ? 2.54 : 1)).toFixed(1);
    return a.located ? t('abs.strike', n) : t('abs.ball', n, t(a.where));
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

  // Umpire call inset (bottom-right) during the reveal: an animated call in the style picked for this
  // pitch. Each style is a frame sequence (indices into its sprite frames); the last frame holds.
  const UMP_SEQ = {
    strike: { hammer: [0, 0, 1], bow: [0, 0, 1, 1, 2], chainsaw: [0, 0, 1], punch: [0, 1], disco: [0, 1, 0, 1, 0, 1], windmill: [0, 1, 2, 3, 0, 1, 2, 3, 4] },
    ball: { stone: [0, 0, 0, 0, 0, 0, 1, 0], shrug: [0, 1, 0, 1], nope: [0, 1, 2, 1, 2], shake: [0, 1, 2, 3], duster: [0, 1, 0, 1, 0], bark: [0, 1, 1, 0] },
  };
  function pickUmpStyle(strike) {
    const call = strike ? 'strike' : 'ball';
    const styles = Object.keys(UMP_SEQ[call]).filter((k) => IMG.ump[call][k]);
    return styles.length ? pick(styles) : null;
  }
  function drawUmpire(strike) {
    const bx = W - 56, by = H - 56, bw = 52, bh = 52;
    ctx.fillStyle = PAL.K; ctx.fillRect(bx - 1, by - 1, bw + 2, bh + 2);
    ctx.fillStyle = PAL.W; ctx.fillRect(bx, by, bw, bh);
    ctx.fillStyle = PAL.n; ctx.fillRect(bx + 2, by + 2, bw - 4, bh - 4);
    const call = strike ? 'strike' : 'ball';
    const style = V.umpStyle && IMG.ump[call][V.umpStyle] ? V.umpStyle : Object.keys(IMG.ump[call])[0];
    const frames = IMG.ump[call][style];
    if (!frames) return;
    const seq = UMP_SEQ[call][style] || [0];
    const i = Math.min(seq.length - 1, Math.floor(Math.max(0, G.t - 0.15) / 0.11));
    ctx.drawImage(frames[seq[i]] || frames[0], bx + 2, by + 2);
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
      case 'replay': return t < 0.12 ? 3 : 4;
      case 'call': return t < 0.35 ? 4 : 0;
      default: return 0;
    }
  }

  function batterFrame() {
    const p = G.pitch;
    if (!p || p.swing === 'none') return 0;
    const flying = G.phase === 'flight' || G.phase === 'replay';
    const tt = flying ? G.t / p.dur : G.phase === 'windup' ? 0 : 2;
    // both swings begin the same way: the bat comes off the shoulder, then the barrel comes round toward
    // us as the ball arrives. A check swing holds there; a full swing goes on round to the finish, back
    // square to us with the bat across it, so the two are unmistakable once the call is up.
    if (tt < 0.68) return 0;
    if (tt < 0.82) return 1;
    if (p.swing === 'check') return 2;
    if ((flying && tt < 1) || (G.phase === 'replay' && G.t < p.dur + 0.06) || (G.phase === 'call' && G.t < 0.12)) return 2;
    return 3;
  }

  // ground shadow under a ball in flight: its height above the ground is the gap between ball and shadow
  function drawBallShadow(b, tt) {
    const gy = 70 + (168 - 70) * tt;           // mound base to plate front
    const r = 1.5 + 3 * tt;
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = PAL.k;
    for (let j = -1; j <= 1; j++) { const w = Math.round(Math.sqrt(1 - (j * j) / 2.25) * r); ctx.fillRect(Math.round(b.x) - w, Math.round(gy) + j, w * 2 + 1, 1); }
    ctx.globalAlpha = 1;
  }
  function drawParticles() {
    for (const q of V.particles) {
      ctx.fillStyle = q.color ? PAL[q.color] : (q.age < q.life * 0.5 ? PAL.w : PAL.c);
      ctx.fillRect(Math.round(q.x), Math.round(q.y), q.size || 1, q.size || 1);
    }
  }

  function render() {
    ctx.save();
    if (V.shake > 0) ctx.translate(rndInt(3) - 1, rndInt(3) - 1);
    ctx.drawImage(BG, 0, 0);
    drawCrowd();
    const disco = G.level >= 10 && G.phase !== 'idle';
    if (disco) drawDiscoField();

    // pitcher: set -> kick -> cocked (windup), release -> follow-through (flight)
    const pf = IMG.pitcher[G.pitch ? G.pitch.form : 'OVERHAND'][G.pitch ? G.pitch.hand : 'R'];
    ctx.drawImage(pf[pitcherFrame()], POS.pitcher[0], POS.pitcher[1]);

    // batter: stance, or a swing / check swing timed to the ball's arrival
    const left = !!(G.pitch && G.pitch.batterLeft);
    const kit = G.pitch ? G.pitch.kit : 0;
    const bf = batterFrame();
    const bimg = IMG.batter[kit][G.pitch ? G.pitch.batterSize : 'mid'][left ? 'L' : 'R'][bf];
    // cleats on the ground line; righty keeps his plate-side edge, lefty his (mirrored) plate-side edge
    const bx = left ? POS.batterL[0] : POS.batterR[0] + IMG.batter[0].mid.R[0].width - bimg.width;
    const by = BATTER_FEET_Y - bimg.height + 2;
    ctx.drawImage(bimg, bx, by);
    // jersey number on his back, centred on BATTER_NUM[frame] (sprite design units)
    if (G.pitch) {
      const sc = 1.4 * BATTER_H[G.pitch.batterSize], [nx, ny] = BATTER_NUM[bf];
      const ncx = left ? bx + bimg.width - nx * sc : bx + nx * sc;
      drawNumber(G.pitch.number, ncx, by + ny * sc, PAL[KITS[kit].num]);
    }

    // zone guide: only while learning (level 1), only if enabled
    const guideOn = G.level === 1 && (G.phase === 'windup' || G.phase === 'flight' || G.phase === 'call');
    // catcher body
    ctx.drawImage(IMG.catcher, POS.catcher[0], POS.catcher[1]);
    if (disco) drawDiscoLights();
    if (guideOn) drawZoneGuide(false); // drawn over the catcher like a TV K-zone box, so his helmet never hides it

    // replay: the zone box and the true landing spot stay up while the pitch runs again in slow motion
    if (G.phase === 'replay' && G.pitch) {
      drawZoneGuide(true);
      fillCircle(G.pitch.x, G.pitch.y, BALL_R + 0.6, PAL.K);
      fillCircle(G.pitch.x, G.pitch.y, BALL_R, G.pitch.strike ? PAL.G : PAL.g);
    }

    // ball (+ shadow, trail)
    if ((G.phase === 'flight' || G.phase === 'replay') && G.ball) {
      drawBallShadow(G.ball, Math.min(1, G.t / G.pitch.dur));
      for (const tr of V.trail) drawBall(tr, true);
      drawBall(G.ball, false, Math.floor(G.t * G.pitch.spin));
    } else if (G.phase === 'call' && G.ball) {
      drawBall(G.ball, false, 0);
    }

    // mitt (covers the ball once caught)
    const mittVisible = !(G.phase === 'reveal');
    if (mittVisible) ctx.drawImage(IMG.mitt, Math.round(G.mitt.x) - (IMG.mitt.width >> 1), Math.round(G.mitt.y) - (IMG.mitt.height >> 1));
    drawParticles();

    // the umpire's own hand with the indicator, bottom corner (the call inset takes that corner on reveal)
    if (G.phase !== 'reveal') ctx.drawImage(IMG.umpHand, W - IMG.umpHand.width - 1, H - IMG.umpHand.height);

    // reveal: zone + true ball location
    if (G.phase === 'reveal' && G.pitch) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)';
      ctx.fillRect(0, 0, W, H);
      drawZoneGuide(true);
      const p = G.pitch;
      const blink = Math.floor(G.t * 6) % 2 === 0;
      fillCircle(p.x, p.y, BALL_R + 0.6, PAL.K);
      fillCircle(p.x, p.y, BALL_R, blink ? (p.strike ? PAL.G : PAL.W) : PAL.g);
      if (G.result && G.result.abs && G.t > 0.3) drawAbsTick(p);
      if (G.t > 0.15) drawUmpire(p.strike);
    }

    // flash on catch
    if (V.flash > 0) { ctx.fillStyle = 'rgba(252,252,252,0.25)'; ctx.fillRect(0, 0, W, H); }
    ctx.restore();
  }

  // ------------------------------------------------------------
  // Main loop
  // ------------------------------------------------------------
  // debug flags work only on a local dev server; the deployed page ignores them
  const LOCAL = ['localhost', '127.0.0.1', '[::1]', ''].includes(location.hostname);
  const QS = new URLSearchParams(LOCAL ? location.search : '');
  const SLOW = parseFloat(QS.get('slow')) || 1; // debug: ?slow=4 slows game time
  const DEBUG = QS.has('debug');               // debug: ?debug exposes window.__uu to pose frames
  if (DEBUG) window.__uu = { G, V, ZONE, game, core: C, pause: false, startWindup: (d) => game.startWindup(d), render, genPitch: (lv) => C.genPitch(lv, { kits: KITS.length }), ballPos: C.ballPos, showScreen, newGame, img: () => IMG, step: (dt) => { game.update(dt); updateView(dt); if (era3d && era3d.active) era3d.frame(dt); else render(); }, era: () => era3d, sfx: Sfx };
  let last = performance.now();
  function loop(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 1) autoPause(); // frames stopped for a second: the page was covered or frozen, hold the pitch
    if (dt > 0.1) dt = 0.1;
    dt /= SLOW;
    const paused = G.paused || (DEBUG && window.__uu.pause);
    if (!paused && currentScreen === 'play' && G.phase !== 'idle' && G.phase !== 'over') { game.update(dt); updateView(dt); }
    if (currentScreen === 'play') { if (era3d && era3d.active) era3d.frame(dt); else render(); }
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
    el.soundLabel.textContent = settings.sound ? t('on') : t('off');
    el.musicLabel.textContent = settings.music ? t('on') : t('off');
    el.paletteLabel.textContent = t('pal.' + (PALETTES[settings.palette] ? settings.palette : 0));
    el.langLabel.textContent = (I18N[settings.lang] || I18N.en).name;
    setMenu(menuIndex);
  }
  function menuAction(action) {
    Sfx.init(); Sfx.resume();
    Music.start('title');
    switch (action) {
      case 'start': Sfx.select(); newGame(); break;
      case 'sound': settings.sound = !settings.sound; Sfx.enabled = settings.sound; saveSettings(); Sfx.select(); refreshTitle(); break;
      case 'music': settings.music = !settings.music; saveSettings(); Music.apply(); Sfx.select(); refreshTitle(); break;
      case 'palette': settings.palette = (settings.palette + 1) % PALETTES.length; saveSettings(); applyPalette(settings.palette); Sfx.select(); refreshTitle(); break;
      case 'lang': settings.lang = LANGS[(LANGS.indexOf(settings.lang) + 1) % LANGS.length]; saveSettings(); applyLang(); Sfx.select(); refreshTitle(); break;
      case 'howto': Sfx.select(); showScreen('howto'); break;
      case 'records': Sfx.select(); showScreen('records'); break;
      case 'board': Sfx.select(); showScreen('board'); Board.show(Board.period); break;
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
      const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('records.empty'); list.appendChild(li); return;
    }
    for (const r of settings.records) {
      const li = document.createElement('li');
      li.innerHTML = '<span>' + t('records.row', r.pitches, r.acc) + '</span><b>' + r.score + '</b>';
      list.appendChild(li);
    }
  }

  // ------------------------------------------------------------
  // Leaderboard (server/ on Railway). API_BASE empty = feature hidden. ?api=http://localhost:8787 to test.
  // ------------------------------------------------------------
  const API_BASE = (new URLSearchParams(location.search).get('api') || 'https://api-production-c3f4.up.railway.app').replace(/\/$/, '');
  const Board = {
    period: 'daily',
    busy: false,
    enabled: !!API_BASE,
    async fetchJson(path, opts) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      try {
        const r = await fetch(API_BASE + path, Object.assign({ signal: ctl.signal }, opts || {}));
        if (!r.ok) throw new Error('http ' + r.status);
        return await r.json();
      } finally { clearTimeout(timer); }
    },
    async show(period) {
      this.period = period;
      document.querySelectorAll('#screen-board .tab').forEach((b) => b.classList.toggle('active', b.dataset.period === period));
      const list = $('board-list'), status = $('board-status');
      list.innerHTML = '';
      status.textContent = this.enabled ? t('board.loading') : t('board.offline');
      if (!this.enabled) return;
      try {
        const data = await this.fetchJson('/api/scores?period=' + period);
        if (this.period !== period) return;
        status.textContent = '';
        if (!data.scores.length) { status.textContent = t('board.empty'); return; }
        const mine = (settings.name || '').trim();
        for (const s of data.scores) {
          const li = document.createElement('li');
          if (mine && s.name === mine && lastGame && s.score === lastGame.score) li.className = 'me';
          const who = document.createElement('span'); who.className = 'who';
          // names are shown as typed: translate="no" keeps browser page translation off them
          const nm = document.createElement('span'); nm.className = 'nm'; nm.translate = false;
          const nmIn = document.createElement('span'); nmIn.className = 'nm-in'; nmIn.textContent = s.name; nm.appendChild(nmIn);
          const meta = document.createElement('span'); meta.className = 'meta'; meta.textContent = t('board.row', s.pitches, s.accuracy, s.reaction === null || s.reaction === undefined ? '-' : Number(s.reaction).toFixed(2));
          who.appendChild(nm); who.appendChild(meta);
          const b = document.createElement('b'); b.textContent = s.score;
          li.appendChild(who); li.appendChild(b);
          list.appendChild(li);
        }
        this.fitNames();
      } catch (e) {
        if (this.period === period) status.textContent = t('board.offline');
      }
    },
    // a name wider than its column (narrow phones) slides back and forth so the whole thing can be read
    fitNames() {
      for (const nm of document.querySelectorAll('#board-list .nm')) {
        const over = nm.scrollWidth - nm.clientWidth;
        const go = over > 3;
        nm.classList.toggle('scroll', go);
        nm.style.setProperty('--nm-dx', go ? -over + 'px' : '0px');
        if (go) nm.style.setProperty('--nm-t', (2 + over / 20) + 's');
      }
    },
    resetSubmit() {
      const row = $('submit-row'), st = $('submit-status'), input = $('name-input'), btn = $('btn-submit');
      row.classList.toggle('hidden', !this.enabled || !lastGame || lastGame.score <= 0);
      st.textContent = '';
      input.value = settings.name || '';
      btn.disabled = false;
      this.busy = false;
    },
    async submit() {
      if (!this.enabled || this.busy || !lastGame) return;
      const name = $('name-input').value.trim().slice(0, 12);
      if (!name) { $('name-input').focus(); return; }
      settings.name = name; saveSettings();
      this.busy = true; $('btn-submit').disabled = true;
      $('submit-status').textContent = t('submit.sending');
      try {
        const r = await this.fetchJson('/api/scores', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.assign({ name, lang: settings.lang }, lastGame)),
        });
        $('submit-status').textContent = t('submit.sent', r.rankDaily, r.rankAll);
        Sfx.good();
      } catch (e) {
        $('submit-status').textContent = t('submit.fail');
        this.busy = false; $('btn-submit').disabled = false;
      }
    },
  };
  $('btn-submit').addEventListener('click', () => Board.submit());
  $('name-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); Board.submit(); } e.stopPropagation(); });
  document.querySelectorAll('#screen-board .tab').forEach((b) => b.addEventListener('click', () => { Sfx.select(); Board.show(b.dataset.period); }));

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
    const text = t('share.text', G.score, G.pitchIndex + 1, $('over-acc').textContent);
    const url = location.href.split('#')[0].split('?')[0];
    try {
      if (navigator.share) await navigator.share({ title: 'UUUMPIRE', text, url });
      else { await navigator.clipboard.writeText(text + ' ' + url); $('btn-share').textContent = t('btn.copied'); setTimeout(() => $('btn-share').textContent = t('btn.share'), 1500); }
    } catch (e) { /* user cancelled */ }
  });
  el.btnReplay.addEventListener('click', () => startReplay());
  el.btnQuit.addEventListener('click', () => quitToTitle());

  // keyboard
  document.addEventListener('keydown', (e) => {
    const k = e.key;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return; // typing a name
    if (currentScreen === 'title') {
      if (k === 'ArrowUp' || k === 'w') { setMenu(menuIndex - 1); Sfx.init(); Sfx.move(); e.preventDefault(); }
      else if (k === 'ArrowDown' || k === 's') { setMenu(menuIndex + 1); Sfx.init(); Sfx.move(); e.preventDefault(); }
      else if (k === 'Enter' || k === ' ') { menuAction(menuItems[menuIndex].dataset.action); e.preventDefault(); }
    } else if (currentScreen === 'play') {
      if (k === ' ' || k === 'p' || k === 'P') { setPaused(!G.paused); e.preventDefault(); }
      else if (k === 'r' || k === 'R') { startReplay(); e.preventDefault(); }
      else if (k === 'ArrowLeft' || k === 's' || k === 'S' || k === '1') { makeCall('strike'); flashBtn(el.btnStrike); e.preventDefault(); }
      else if (k === 'ArrowRight' || k === 'b' || k === 'B' || k === '2') { makeCall('ball'); flashBtn(el.btnBall); e.preventDefault(); }
      else if (k === 'Escape') quitToTitle();
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
  applyLang();
  showScreen('loading');
  fitCanvas();
  requestAnimationFrame(loop);

  // Loading screen: the pixel font plus the ballpark tunes in assets/songs (index.json lists them and
  // which pool, title or play, each belongs to). A tune that fails to load is simply left out.
  // the little baseball that rolls along the loading bar: 12x12, seams spin as it travels
  function drawLoadBall(c, frame) {
    c.clearRect(0, 0, 12, 12);
    const disc = (cx, cy, r, color) => {
      c.fillStyle = color;
      for (let y = -6; y <= 6; y++) for (let x = -6; x <= 6; x++) if (x * x + y * y <= r * r) c.fillRect(cx + x, cy + y, 1, 1);
    };
    disc(6, 6, 5.3, PAL.K);
    disc(6, 6, 4.3, PAL.w);
    disc(5, 5, 3.2, PAL.W);
    c.fillStyle = PAL.R;
    for (const [dx, dy] of SEAMS[frame & 3]) c.fillRect(6 + dx, 6 + dy, 1, 1);
  }

  async function boot() {
    const fill = $('load-fill'), text = $('load-text'), ball = $('load-ball');
    const bctx = ball.getContext('2d');
    let frame = 0;
    const roll = setInterval(() => { drawLoadBall(bctx, frame++); ball.style.left = fill.style.width || '0%'; }, 90);
    drawLoadBall(bctx, 0);
    const tasks = [];
    let done = 0, total = 0; // total is set once every task is registered, so the bar never runs backwards
    const show = () => { if (total) fill.style.width = Math.round(done / total * 100) + '%'; };
    const tick = (label) => { done++; show(); text.textContent = label; };
    const addTask = (label, p) => tasks.push(p.catch(() => {}).then(() => tick(label)));
    // the page is hidden (html.fonts-loading) until the pixel font is really usable, so no text is
    // ever shown in a fallback font; a 3 s safety timeout reveals it regardless
    const fontReady = document.fonts
      ? Promise.race([document.fonts.load('16px "Cubic 11"').then(() => document.fonts.ready), new Promise((r) => setTimeout(r, 3000))])
      : Promise.resolve();
    fontReady.then(() => document.documentElement.classList.remove('fonts-loading'));
    addTask('FONT', fontReady);
    let index = { play: [], title: [] };
    const V = window.UU_V ? '?v=' + window.UU_V : '';
    try { index = await (await fetch('assets/songs/index.json' + V)).json(); } catch (e) { /* no extra songs */ }
    const loadSong = (key, pool) => fetch('assets/songs/' + key + '.json' + V)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((song) => { if (window.UUMusic) { window.UUMusic.Player.addSong(key, song); pool.push(key); } });
    for (const key of index.play || []) addTask(key.toUpperCase(), loadSong(key, PLAY_SONGS));
    for (const key of index.title || []) addTask(key.toUpperCase(), loadSong(key, TITLE_SONGS));
    total = tasks.length; show();
    await Promise.all(tasks);
    fill.style.width = '100%'; text.textContent = t('loading.done');
    await new Promise((r) => setTimeout(r, 350));
    clearInterval(roll);
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
