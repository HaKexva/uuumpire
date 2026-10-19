/* UUUMPIRE core: the rules and the simulation, with no art in it.
   Pure data and functions: no DOM, canvas, audio, timers or UI strings. It runs in the browser as
   window.UU_CORE and in Node (tools/test-core.js plays whole games headless with it). game.js is the
   presentation layer: sprites, palettes, sound, HUD, and the mapping of core events to effects.

   Coordinates are scene pixels (168x192, the umpire's eye right behind the catcher). Text is never
   produced here: results carry keys ('fine', 'quick', 'swing', 'chant', ...) and the UI translates them. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.UU_CORE = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ------------------------------------------------------------
  // Geometry
  // ------------------------------------------------------------
  const ZONE_X0 = 68, ZONE_X1 = 101;                      // 33px = the 17in plate
  const BATTER_FEET_Y = 172;                              // where every batter's cleats sit
  const BATTER_H = { short: 0.88, mid: 1, tall: 1.12 };   // batter scale; same numbers as tools/gen-sprites.js
  const BALL_R = 5;                                       // ball radius at the plate (px)
  const IN_PER_PX = 17 / (ZONE_X1 - ZONE_X0);
  // rulebook zone: midpoint of shoulders and belt (52px above the cleats on the mid batter) down to
  // the hollow of the knee (24px above)
  const zoneFor = (h) => ({ x0: ZONE_X0, x1: ZONE_X1, y0: Math.round(BATTER_FEET_Y - 52 * h), y1: Math.round(BATTER_FEET_Y - 24 * h) });
  // Release points = the throwing hand of each pitcher pose. R = right-hander (arm on the umpire's left).
  const RELEASE = {
    OVERHAND:  { R: { x: 75, y: 36 }, L: { x: 93, y: 36 } },
    SUBMARINE: { R: { x: 74, y: 66 }, L: { x: 94, y: 66 } },
  };
  const MITT_REST = { x: 84, y: 170 };

  // ------------------------------------------------------------
  // Tuning
  // ------------------------------------------------------------
  const TIMING = {
    windup: 0.55,      // s from the set to the release
    snap: 0.1,         // mitt snaps onto the ball
    frameStart: 0.08, frameDur: 0.16, // catcher's framing tug after the catch
    early: 0.9,        // a call this far into the flight counts (the ball snaps in)
    reveal: 2.3,       // reveal hold: time to read the ABS line and hit REPLAY
    replaySpeed: 0.35, replayHold: 0.25, replayBack: 1.3, // slow-mo, hold on the catch, reveal time left after
    firstPitch: 0.9, nextPitch: 0.35, levelUp: 2.4, congrats: 3.6, // delay before the next windup
  };
  const RULES = {
    misses: 3, pitchesPerLevel: 5, maxLevel: 11, moodMax: 5, reprieveMinLevel: 6,
    base: 100, streakStep: 0.1, streakCap: 10,   // x1.0 .. x2.0
    fineEdge: 3.8, finePts: 50,                   // edge pitch bonus (px from the zone edge)
    quick: 0.6, quickPts: 30,                     // quick call bonus (s)
    late: 0.3, latePts: 50,                       // held call bonus: a correct call inside the last 0.3 s of the window
    swingLevel: 4, framingLevel: 5, submarineLevel: 3, nastyLevel: 6, discoLevel: 10,
    breakGain: 1.1,   // every pitch but the four-seamer moves this much more than its table says
    nastyWeight: 1.2, // a nasty pitch (level 6+) comes this many times as often as an ordinary type
  };
  // What each level adds (the UI shows lvl.<level>). Levels not listed just get faster/tighter.
  const UNLOCKS = { 2: 'breaking', 3: 'submarine', 4: 'swings', 5: 'framing', 6: 'nasty', 7: 'faster', 10: 'pro' };

  function levelFor(pitchIndex) { return Math.min(RULES.maxLevel, 1 + Math.floor(pitchIndex / RULES.pitchesPerLevel)); }
  function callWindowFor(level) { return Math.max(0.9, 2.2 - level * 0.12); }

  // ------------------------------------------------------------
  // Pitches
  // ------------------------------------------------------------
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
    // level 1: four-seamers only. 2: breaking stuff. 3: the sinking/running family. 6: the nasty pitches.
    { name: 'FOURSEAM', w: 5, speed: [136, 148], bx: [0, 2],   side: 'any',   by: [-4, -2],  fx: 'std',   fy: 'std',    spin: 14, minLv: 1 }, // +level: 137-149 at lv1, 157-169 at lv12
    { name: 'SLIDER',   w: 3, speed: [128, 140], bx: [9, 15],  side: 'glove', by: [2, 5],    fx: 'late',  fy: 'late',   spin: 8,  minLv: 2 },
    { name: 'CURVE',    w: 2, speed: [98, 110],  bx: [6, 10],  side: 'glove', by: [14, 20],  fx: 'std',   fy: 'std',    spin: 5,  minLv: 2, hump: [7, 10] }, // slow, loops up then drops
    { name: 'CHANGEUP', w: 2, speed: [116, 128], bx: [4, 7],   side: 'arm',   by: [4, 7],    fx: 'late',  fy: 'late',   spin: 4,  minLv: 2 }, // fastball look, dies late
    { name: 'SHOOT',    w: 2, speed: [138, 150], bx: [6, 10],  side: 'arm',   by: [1, 3],    fx: 'early', fy: 'std',    spin: 12, minLv: 2 }, // runs early, no sink
    { name: 'TWOSEAM',  w: 2, speed: [134, 146], bx: [5, 9],   side: 'arm',   by: [3, 6],    fx: 'late',  fy: 'late',   spin: 12, minLv: 3 }, // runs late with a bit of sink
    { name: 'CUTTER',   w: 2, speed: [140, 152], bx: [4, 7],   side: 'glove', by: [1, 2],    fx: 'sharp', fy: 'std',    spin: 12, minLv: 3 },
    { name: 'SINKER',   w: 2, speed: [134, 146], bx: [6, 10],  side: 'arm',   by: [11, 16],  fx: 'late',  fy: 'sharp',  spin: 9,  minLv: 3 }, // bowling-ball: runs in and dives late
    { name: 'SPLITTER', w: 2, speed: [130, 142], bx: [0, 2],   side: 'any',   by: [10, 14],  fx: 'std',   fy: 'sharp',  spin: 3,  minLv: 3 }, // straight, then a sudden drop
    { name: 'FORKBALL', w: 2, speed: [126, 138], bx: [0, 2],   side: 'any',   by: [12, 18],  fx: 'std',   fy: 'tumble', spin: 2,  minLv: 6 },
    { name: 'SWEEPER',  w: 3, speed: [130, 142], bx: [16, 24], side: 'glove', by: [0, 3],    fx: 'std',   fy: 'std',    spin: 7,  minLv: 6 },
    { name: 'RISING',   w: 2, speed: [138, 150], bx: [0, 3],   side: 'any',   by: [-14, -10], fx: 'std',  fy: 'late',   spin: 16, minLv: 6 },
    { name: 'KNUCKLE',  w: 2, speed: [100, 114], bx: [0, 3],   side: 'any',   by: [2, 6],    fx: 'std',   fy: 'late',   spin: 0,  minLv: 6, wobble: [3, 5] },
  ];

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  // random helpers over an injectable generator (tests pass a seeded one)
  const R = (rng) => {
    const rnd = (a, b) => a + rng() * (b - a);
    const rndInt = (n) => Math.floor(rng() * n);
    return { rnd, rndInt, pick: (arr) => arr[rndInt(arr.length)], sgn: () => (rng() < 0.5 ? -1 : 1) };
  };

  // Pitcher delivery: submarine shows up from level 3, releases at knee height, and its ball naturally
  // rises and runs to the arm side.
  function pickForm(level, rng) {
    return level >= RULES.submarineLevel && (rng || Math.random)() < 0.3 ? 'SUBMARINE' : 'OVERHAND';
  }

  // the weight each type carries at a level (0 = not yet in the arsenal)
  function typeWeight(t, level) {
    if (level < t.minLv) return 0;
    let w = t.w;
    if (t.name === 'FOURSEAM') w += Math.max(0, 5 - level); // early levels: mostly fastballs
    if (t.minLv >= RULES.nastyLevel) w *= RULES.nastyWeight;  // the nasty stuff shows up more than its share
    return w;
  }
  function pickType(level, rng) {
    // one draw over the weighted arsenal (one rng call, like the old pool pick, so replays stay exact)
    const ws = PITCH_TYPES.map((t) => typeWeight(t, level));
    let r = (rng || Math.random)() * ws.reduce((a, b) => a + b, 0);
    for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r < 0) return PITCH_TYPES[i]; }
    return PITCH_TYPES[0];
  }

  function isStrikeAt(zone, x, y) {
    return x >= zone.x0 - BALL_R && x <= zone.x1 + BALL_R && y >= zone.y0 - BALL_R && y <= zone.y1 + BALL_R;
  }
  // distance from the ball centre to the strike boundary (the zone grown by the ball radius);
  // inside the zone it is the distance to the nearest edge
  function edgeDistance(zone, x, y) {
    const ex0 = zone.x0 - BALL_R, ex1 = zone.x1 + BALL_R, ey0 = zone.y0 - BALL_R, ey1 = zone.y1 + BALL_R;
    const dx = Math.max(ex0 - x, 0, x - ex1), dy = Math.max(ey0 - y, 0, y - ey1);
    if (dx === 0 && dy === 0) return Math.min(x - ex0, ex1 - x, y - ey0, ey1 - y);
    return Math.hypot(dx, dy);
  }

  // One pitch, with the batter who faces it. opts: rng, kits (how many batter kits the art has),
  // prevNumber (jersey numbers never repeat back to back).
  function genPitch(level, opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const { rnd, rndInt, pick, sgn } = R(rng);
    // who is up: a short, average or tall batter; the zone is sized to him before the pitch is placed
    const r0 = rng();
    const batterSize = r0 < 0.3 ? 'short' : r0 < 0.7 ? 'mid' : 'tall';
    const zone = zoneFor(BATTER_H[batterSize]);
    const ex0 = zone.x0 - BALL_R, ex1 = zone.x1 + BALL_R;
    const ey0 = zone.y0 - BALL_R, ey1 = zone.y1 + BALL_R;
    const isStrike = rng() < 0.5;
    const edgeProb = clamp(0.2 + level * 0.07, 0.2, 0.8);
    const edge = rng() < edgeProb;
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
      const d = edge ? rnd(1, 3.6) : rnd(3, 10);   // clear balls still miss, but not by a mile
      const spread = edge ? 3 : 7;
      if (side === 0) { x = ex0 - d; y = rnd(ey0 - spread, ey1 + spread); }
      else if (side === 1) { x = ex1 + d; y = rnd(ey0 - spread, ey1 + spread); }
      else if (side === 2) { y = ey0 - d; x = rnd(ex0 - spread, ex1 + spread); }
      else { y = ey1 + d; x = rnd(ex0 - spread, ex1 + spread); }
    }
    x = clamp(x, 46, 122); y = clamp(y, zone.y0 - 25, zone.y1 + 25);

    const type = pickType(level, rng);
    const form = pickForm(level, rng);
    const hand = sgn(); // +1 right-hander: arm on the umpire's left (-x), glove side = +x
    const dir = type.side === 'glove' ? hand : type.side === 'arm' ? -hand : sgn();
    // breaking balls move a bit more than the table says; the four-seamer is the straight reference
    const gain = type.name === 'FOURSEAM' ? 1 : RULES.breakGain;
    let bx = rnd(type.bx[0], type.bx[1]) * dir * gain;
    let by = rnd(type.by[0], type.by[1]) * gain;
    const hump = type.hump ? rnd(type.hump[0], type.hump[1]) * gain : 0;
    // speed creeps up with level, then jumps from level 10 on
    let speed = Math.round(rnd(type.speed[0], type.speed[1]) + Math.min(level, 8) + Math.max(0, level - 9) * 3);
    // knuckleball: no spin, flutters side to side on the way in (sin terms vanish at t=1, so it still lands on target)
    const wob = type.wobble ? {
      ax: rnd(type.wobble[0], type.wobble[1]) * gain * sgn(), ay: rnd(type.wobble[0], type.wobble[1]) * 0.6 * gain * sgn(),
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
    dur *= clamp(1 - (level - 1) * 0.03, 0.72, 1); // each level is a noticeable tick quicker

    const located = isStrikeAt(zone, x, y);
    const edgeDist = edgeDistance(zone, x, y);
    // batter: sometimes swings through (a strike wherever it is), sometimes checks (held = no swing)
    let swing = 'none';
    if (level >= RULES.swingLevel) {
      const r = rng();
      if (r < 0.21) swing = 'full';
      else if (r < 0.29) swing = 'check';
    }
    // catcher framing: from the framing level he works every pitch he catches. A near-miss ball is pulled
    // inside the zone (the trap: it ends up looking like a strike); a far ball gets a short tug toward
    // the zone that visibly falls short; a strike is tidied toward the middle.
    // Only ever a visual: the call is judged where the ball crossed.
    let frame = null;
    if (swing !== 'full' && level >= RULES.framingLevel) {
      if (!located) {
        const ix = clamp(x, zone.x0 - BALL_R + 3, zone.x1 + BALL_R - 3);
        const iy = clamp(y, zone.y0 - BALL_R + 3, zone.y1 + BALL_R - 3);
        let dx = ix - x, dy = iy - y;
        const trap = edgeDist < 11, d = Math.hypot(dx, dy);
        if (!trap && d > 7) { dx *= 7 / d; dy *= 7 / d; }
        frame = { dx, dy, trap };
      } else {
        const cx = (zone.x0 + zone.x1) / 2, cy = (zone.y0 + zone.y1) / 2;
        const d = Math.hypot(cx - x, cy - y) || 1, m = Math.min(5.5, d);
        frame = { dx: (cx - x) / d * m, dy: (cy - y) / d * m, trap: false };
      }
    }
    // jersey numbers: a new one for every batter, never the same twice in a row
    let number;
    do { number = rndInt(100); } while (number === opts.prevNumber);

    return {
      x, y, bx, by, hump, fx: PROFILE[type.fx], fy: PROFILE[type.fy], spin: type.spin,
      type: type.name, speed, dur, form, hand: hand > 0 ? 'R' : 'L', wob,
      rel: RELEASE[form][hand > 0 ? 'R' : 'L'],
      strike: located || swing === 'full',
      located, edgeDist, swing, frame, zone,
      batterLeft: rng() < 0.35, batterSize, number, kit: rndInt(opts.kits || 1),
    };
  }

  // ball centre and apparent radius at flight fraction t (0 = release, 1 = the plate)
  function ballPos(p, t) {
    let sx = p.rel.x + (p.x - p.bx - p.rel.x) * t + p.bx * p.fx(t);
    let sy = p.rel.y + (p.y - p.by - p.rel.y) * t + p.by * p.fy(t) - p.hump * Math.sin(Math.PI * t);
    if (p.wob) {
      sx += p.wob.ax * Math.sin(Math.PI * p.wob.nx * t) * t;
      sy += p.wob.ay * Math.sin(Math.PI * p.wob.ny * t) * t;
    }
    return { x: sx, y: sy, r: 1 + (BALL_R - 1) * t * t };
  }

  // ------------------------------------------------------------
  // Scoring and crowd
  // ------------------------------------------------------------
  // Points for a correct call. streak counts this call. bonus lists the keys earned ('fine', 'quick', 'late').
  // window is the call window (s): a call within RULES.late of it was held to the last moment, like a real umpire's timing
  function scoreCall(streak, pitch, reaction, window) {
    const mult = 1 + Math.min(streak - 1, RULES.streakCap) * RULES.streakStep;
    let pts = RULES.base * mult;
    const bonus = [];
    // framing never changes the call or the score: the ball is judged where it crossed the plate
    if (pitch.edgeDist < RULES.fineEdge && pitch.swing !== 'full') { pts += RULES.finePts; bonus.push('fine'); }
    if (reaction < RULES.quick) { pts += RULES.quickPts; bonus.push('quick'); }
    if (window && reaction >= window - RULES.late) { pts += RULES.latePts; bonus.push('late'); }
    return { pts: Math.round(pts), mult, bonus };
  }
  // Crowd heat (0..moodMax): every correct call fills a cell, a miss knocks two out. Atmosphere only.
  function moodAfter(mood, correct) {
    return correct ? Math.min(RULES.moodMax, mood + 1) : Math.max(0, mood - 2);
  }
  // ABS readout data: how far the ball was from the zone and which way it missed (relative to the batter)
  function absInfo(p) {
    const zone = p.zone;
    const info = { located: p.located, px: p.edgeDist, inches: p.edgeDist * IN_PER_PX, where: null };
    if (p.located) return info;
    const ex0 = zone.x0 - BALL_R, ex1 = zone.x1 + BALL_R, ey0 = zone.y0 - BALL_R, ey1 = zone.y1 + BALL_R;
    const dx = p.x < ex0 ? p.x - ex0 : p.x > ex1 ? p.x - ex1 : 0;
    const dy = p.y < ey0 ? p.y - ey0 : p.y > ey1 ? p.y - ey1 : 0;
    if (Math.abs(dy) >= Math.abs(dx)) info.where = dy < 0 ? 'high' : 'low';
    else info.where = (dx < 0) === !p.batterLeft ? 'inside' : 'outside';
    return info;
  }

  // ------------------------------------------------------------
  // Game: the state machine
  // ------------------------------------------------------------
  // Deterministic generator (mulberry32) so a game can be replayed from its seed: the leaderboard
  // server hands the client a seed, the client plays on it and logs its calls, and the server plays
  // the log back (replayRun) to check the score before it goes on the board.
  function seededRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = Math.imul(a ^ (a >>> 15), a | 1);
      t = (t + Math.imul(t ^ (t >>> 7), t | 61)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Plays a call log back on a seed. log: one entry per pitch, [call, t] with call 'strike' | 'ball'
  // and t the seconds after the catch, or [null] for a pitch left to the clock. Returns the summary
  // the game produced plus `seconds` of game time, or null when the log cannot be played (a call
  // outside its window, a log longer or shorter than the game, ...). Frame length does not matter:
  // every phase change resets the clock, so the call time is the only timing that reaches the score.
  function replayRun(seed, log) {
    if (!Array.isArray(log) || log.length > RULES.maxLevel * RULES.pitchesPerLevel + 1) return null;
    // A save-a-miss run carries one ['save', 1|0] entry; reprieve is enabled only when the log has it, so
    // logs without one replay exactly as before (three misses end the game, no reprieve phase to stall in).
    const reprieve = log.some((e) => Array.isArray(e) && e[0] === 'save');
    const game = createGame({ rng: seededRng(seed), kits: 1, reprieve });
    const G = game.state;
    const DT = 1 / 60, MAX_STEPS = 400000;
    let steps = 0;
    const stepUntil = (done) => { while (!done()) { if (steps++ > MAX_STEPS) return false; game.update(DT); } return true; };
    const atStop = () => G.phase === 'call' || G.phase === 'over' || G.phase === 'reprieve';
    game.start();
    for (const e of log) {
      if (!Array.isArray(e) || !stepUntil(atStop) || G.phase === 'over') return null;
      if (G.phase === 'reprieve') { // the prompt is up: this entry must answer it
        if (e[0] !== 'save') return null;
        game.resolveReprieve(!!e[1]);
        continue;
      }
      const call = e[0], t = e[1];
      if (call === 'save') return null; // a save answer with no prompt pending
      if (call === null) { if (!stepUntil(() => G.phase !== 'call')) return null; continue; }
      if ((call !== 'strike' && call !== 'ball') || typeof t !== 'number' || !(t >= 0) || t >= G.callWindow) return null;
      G.t = t;
      if (!game.call(call)) return null;
    }
    if (!stepUntil(atStop) || G.phase !== 'over') return null; // the log stops before the game did
    return Object.assign(game.summary(), { seconds: steps * DT });
  }

  // createGame({ rng, kits, onEvent }) -> { state, start, update(dt), call(c), replay(), setPaused(on), summary() }
  // Phases: idle | windup | flight | call | reveal | replay | over. Events (type, data) in order of a pitch:
  //   next     { pitchIndex, level, levelUp, banner, congrats, pitch }  a pitch is set up (windup pending)
  //   windup   {}                                                       the delivery starts
  //   pitch    { pitch }                                                release: the ball is in flight
  //   catch    { x, y, early, replay }                                  the ball hits the mitt
  //   resolve  { call, correct, timeout, strike, reaction, pts, mult, bonus, tags, crowd, mood, abs }
  //   replay   {}  /  replayEnd {}                                      slow-motion replay start / back to the reveal
  //   over     { score, pitches, accuracy, streak, reaction, won }      three misses, or (won) the last
  //                                                                        pitch of level maxLevel called
  function createGame(opts) {
    opts = opts || {};
    const rng = opts.rng || Math.random;
    const kits = opts.kits || 1;
    // the save-a-miss reprieve is opt-in (the live game turns it on; replayRun never does, so the
    // deterministic replay the server verifies with is unchanged). It can fire once per game.
    const reprieveOn = !!opts.reprieve;
    let reprieveUsed = false;
    const emit = (type, data) => { if (opts.onEvent) opts.onEvent(type, data || {}); };
    const G = {
      phase: 'idle', t: 0, paused: false,
      pitchIndex: 0, score: 0, streak: 0, bestStreak: 0, misses: 0, correct: 0,
      pitch: null, level: 1, callWindow: 2, userCall: null, result: null,
      ball: null, mitt: { x: MITT_REST.x, y: MITT_REST.y },
      zone: zoneFor(1),             // mutated in place per batter (the UI keeps a reference)
      mood: 0, reactSum: 0, reactN: 0, lastReaction: null, lastNumber: -1,
    };

    function summary() {
      const pitches = G.pitchIndex + 1;
      const avg = G.reactN ? G.reactSum / G.reactN : null;
      return { score: G.score, pitches, accuracy: Math.round(G.correct / pitches * 100), streak: G.bestStreak, reaction: avg === null ? null : +avg.toFixed(3) };
    }

    function startWindup(delay, levelUp) {
      G.phase = 'windup';
      G.t = -(delay || 0);
      G.level = levelFor(G.pitchIndex);
      G.pitch = genPitch(G.level, { rng, kits, prevNumber: G.lastNumber });
      G.lastNumber = G.pitch.number;
      Object.assign(G.zone, G.pitch.zone);
      G.pitch.zone = G.zone;
      G.callWindow = callWindowFor(G.level);
      G.ball = null; G.userCall = null; G.result = null;
      G.mitt = { x: MITT_REST.x, y: MITT_REST.y };
      const banner = G.pitchIndex > 0 && G.pitchIndex % RULES.pitchesPerLevel === 0;
      emit('next', { pitchIndex: G.pitchIndex, level: G.level, levelUp: !!levelUp, banner, congrats: banner && G.level === RULES.discoLevel + 1, pitch: G.pitch });
    }

    function start(opts) {
      // opts.level jumps the start to that level (dev aid; the server always replays from pitch 0,
      // so a run begun mid-game will not verify and cannot rank).
      const lvl = opts && opts.level ? Math.min(RULES.maxLevel, Math.max(1, opts.level | 0)) : 1;
      const idx = (lvl - 1) * RULES.pitchesPerLevel;
      reprieveUsed = false; // every game gets its own one-shot save (Play Again resets it too)
      Object.assign(G, {
        phase: 'idle', t: 0, paused: false, pitchIndex: idx, score: 0, streak: 0, bestStreak: 0, misses: 0, correct: 0,
        pitch: null, level: lvl, userCall: null, result: null, ball: null,
        mood: 0, reactSum: 0, reactN: 0, lastReaction: null,
      });
      G.mitt = { x: MITT_REST.x, y: MITT_REST.y };
      startWindup(TIMING.firstPitch, false);
    }

    function catchBall(early) {
      const p = G.pitch;
      G.phase = 'call'; G.t = 0;
      G.ball = { x: p.x, y: p.y, r: BALL_R };
      emit('catch', { x: p.x, y: p.y, early: !!early, replay: false });
    }

    function resolveCall(call) {
      const p = G.pitch;
      const reaction = G.t;
      G.userCall = call;
      const correct = call !== null && call === (p.strike ? 'strike' : 'ball');
      G.phase = 'reveal'; G.t = 0;
      if (call !== null) { G.lastReaction = reaction; G.reactSum += reaction; G.reactN++; } else G.lastReaction = null;

      let pts = 0, mult = 1, bonus = [];
      if (correct) {
        G.streak++;
        G.correct++;
        G.bestStreak = Math.max(G.bestStreak, G.streak);
        ({ pts, mult, bonus } = scoreCall(G.streak, p, reaction, G.callWindow));
        G.score += pts;
      } else {
        G.streak = 0;
        G.misses++;
      }
      G.mood = moodAfter(G.mood, correct);
      const tags = [];
      if (p.swing === 'full') tags.push('swing');
      else if (p.swing === 'check') tags.push('check');
      if (p.frame && p.frame.trap) tags.push('framed');
      // full stands chant (and do the wave); an empty meter after a miss gets you heckled
      const crowd = !correct && G.mood === 0 ? 'heckle' : correct && G.mood >= RULES.moodMax ? 'chant' : null;
      // ABS readout on a wrong call, or on any edge pitch (never on a swing: location did not matter)
      const abs = p.swing !== 'full' && (!correct || p.edgeDist < RULES.fineEdge);
      G.result = { call, correct, timeout: call === null, strike: p.strike, reaction: G.lastReaction, pts, mult, bonus, tags, crowd, mood: G.mood, abs };
      emit('resolve', G.result);
    }

    function update(dt) {
      if (G.paused || G.phase === 'idle' || G.phase === 'over' || G.phase === 'reprieve') return;
      G.t += G.phase === 'replay' ? dt * TIMING.replaySpeed : dt;
      switch (G.phase) {
        case 'windup':
          if (G.t >= 0 && G.t - dt < 0) emit('windup');
          if (G.t >= TIMING.windup) {
            G.phase = 'flight'; G.t = 0;
            emit('pitch', { pitch: G.pitch });
          }
          break;

        case 'flight': {
          const p = G.pitch;
          const tt = Math.min(1, G.t / p.dur);
          G.ball = ballPos(p, tt);
          if (tt >= 1) catchBall(false);
          break;
        }

        case 'replay': {
          const p = G.pitch;
          const tt = Math.min(1, G.t / p.dur);
          G.ball = ballPos(p, tt);
          if (tt >= 1) {
            if (!G.replayCaught) { G.replayCaught = true; emit('catch', { x: p.x, y: p.y, early: false, replay: true }); }
            G.mitt.x = p.x; G.mitt.y = p.y;
            if (G.t >= p.dur + TIMING.replayHold) { // hold on the catch, then back to the reveal
              G.phase = 'reveal'; G.t = TIMING.replayBack; G.ball = null;
              emit('replayEnd');
            }
          }
          break;
        }

        case 'call': {
          // mitt snaps onto the ball shortly after it arrives
          const p = G.pitch;
          const k = clamp(G.t / TIMING.snap, 0, 1);
          G.mitt.x = MITT_REST.x + (p.x - MITT_REST.x) * k;
          G.mitt.y = MITT_REST.y + (p.y - MITT_REST.y) * k;
          if (p.frame) {
            // framing: after the catch the mitt (ball inside) drifts toward the zone
            const f = clamp((G.t - TIMING.frameStart) / TIMING.frameDur, 0, 1);
            const e = f * f * (3 - 2 * f);
            G.mitt.x += p.frame.dx * e; G.mitt.y += p.frame.dy * e;
            G.ball = { x: p.x + p.frame.dx * e, y: p.y + p.frame.dy * e, r: BALL_R };
          }
          if (G.t >= G.callWindow) resolveCall(null);
          break;
        }

        case 'reveal':
          if (G.t >= TIMING.reveal) {
            if (G.misses >= RULES.misses) {
              if (reprieveOn && !reprieveUsed && G.level >= RULES.reprieveMinLevel && G.pitchIndex + 1 < RULES.maxLevel * RULES.pitchesPerLevel) {
                reprieveUsed = true; // one shot a game: hold for the save-a-miss prompt instead of ending
                G.phase = 'reprieve'; G.t = 0;
                emit('reprieve', { level: G.level });
              } else {
                G.phase = 'over';
                emit('over', summary());
              }
            } else if (G.pitchIndex + 1 >= RULES.maxLevel * RULES.pitchesPerLevel) {
              // the last pitch of the last level is in: the season is complete
              G.phase = 'over';
              emit('over', Object.assign(summary(), { won: true }));
            } else {
              G.pitchIndex++;
              const next = levelFor(G.pitchIndex), up = next > G.level;
              // level up: hold on the banner while the jingle plays (longer for the congratulations)
              startWindup(up ? (next === RULES.discoLevel + 1 ? TIMING.congrats : TIMING.levelUp) : TIMING.nextPitch, up);
            }
          }
          break;
      }
    }

    // STRIKE / BALL. Accepted from the mitt pop until the call window runs out, or a hair early
    // (the ball snaps in). Returns true when the call was taken.
    function call(c) {
      if (G.paused) return false;
      if (G.phase === 'flight' && G.t / G.pitch.dur >= TIMING.early) catchBall(true);
      if (G.phase !== 'call') return false;
      resolveCall(c);
      return true;
    }

    // Slow-motion replay of the pitch just called: the same flight at replaySpeed, then back to the reveal.
    function replay() {
      if (G.phase !== 'reveal' || G.paused) return false;
      G.phase = 'replay'; G.t = 0; G.ball = null; G.replayCaught = false;
      G.mitt = { x: MITT_REST.x, y: MITT_REST.y };
      emit('replay');
      return true;
    }

    function setPaused(on) {
      if (G.phase === 'idle' || G.phase === 'over') on = false;
      if (on === G.paused) return false;
      G.paused = on;
      return true;
    }

    // answer to the save-a-miss prompt. saved=true refunds the miss and play continues to the next
    // pitch (same hand-off as a normal reveal); otherwise the game ends. Only valid while 'reprieve'.
    function resolveReprieve(saved) {
      if (G.phase !== 'reprieve') return false;
      if (saved) {
        G.misses = Math.max(0, G.misses - 1);
        G.pitchIndex++;
        const next = levelFor(G.pitchIndex), up = next > G.level;
        startWindup(up ? (next === RULES.discoLevel + 1 ? TIMING.congrats : TIMING.levelUp) : TIMING.nextPitch, up);
      } else {
        G.phase = 'over';
        emit('over', summary());
      }
      return true;
    }

    // fraction of the call window left (1 = just caught, 0 = too late)
    const callRemain = () => (G.phase === 'call' ? Math.max(0, 1 - G.t / G.callWindow) : 0);

    return { state: G, start, startWindup, update, call, replay, setPaused, summary, callRemain, resolveReprieve };
  }

  return {
    BALL_R, BATTER_H, BATTER_FEET_Y, IN_PER_PX, RELEASE, MITT_REST, TIMING, RULES, UNLOCKS, PROFILE, PITCH_TYPES,
    zoneFor, levelFor, callWindowFor, pickForm, pickType, typeWeight, isStrikeAt, edgeDistance, genPitch, ballPos,
    scoreCall, moodAfter, absInfo, createGame, seededRng, replayRun,
  };
});
