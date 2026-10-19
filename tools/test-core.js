#!/usr/bin/env node
/* Headless checks of core.js: the pitch model and the whole state machine, played by scripted umpires.
   No browser, no art.  Run: node tools/test-core.js  (exit code 1 on any failure) */
'use strict';
const C = require('../core.js');

let fails = 0, checks = 0;
const ok = (cond, msg) => { checks++; if (!cond) { fails++; console.log('FAIL ' + msg); } };
const near = (a, b, eps) => Math.abs(a - b) <= (eps || 1e-6);
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// ---------------------------------------------------------------- pitch model
console.log('pitch model');
console.log('  lv  strike%  edge%   sub%  swing%  frame%  speed');
const byName = Object.fromEntries(C.PITCH_TYPES.map((t) => [t.name, t]));
for (let level = 1; level <= 12; level++) {
  const rng = mulberry32(level * 101);
  const N = 3000;
  let strikes = 0, edges = 0, subs = 0, swings = 0, frames = 0, speedSum = 0, prev = -1;
  for (let i = 0; i < N; i++) {
    const p = C.genPitch(level, { rng, kits: 6, prevNumber: prev });
    const type = byName[p.type];
    ok(type && type.minLv <= level, `lv${level}: ${p.type} before its level`);
    ok(p.strike === (p.located || p.swing === 'full'), 'strike flag = located or full swing');
    ok(p.located === C.isStrikeAt(p.zone, p.x, p.y), 'located agrees with isStrikeAt');
    ok(near(p.edgeDist, C.edgeDistance(p.zone, p.x, p.y)), 'edgeDist agrees with edgeDistance');
    if (!p.located) ok(p.edgeDist >= 1 - 1e-9 && p.edgeDist <= 12.3, `ball ${p.edgeDist.toFixed(2)}px off: at least 1px, never a mile`);
    if (level < C.RULES.swingLevel) ok(p.swing === 'none', 'no swings before level 4');
    if (level < C.RULES.framingLevel) ok(p.frame === null, 'no framing before level 5');
    if (level < C.RULES.submarineLevel) ok(p.form === 'OVERHAND', 'no submarine before level 3');
    if (level >= C.RULES.framingLevel) ok((p.frame !== null) === (p.swing !== 'full'), 'from level 5 every caught pitch is framed');
    if (p.frame) {
      ok(p.swing !== 'full', 'no framing on a swing');
      ok(p.frame.trap ? !p.located && p.edgeDist < 11 : p.located || p.edgeDist >= 11, 'trap = near ball; tidy = strike or far ball');
      ok(Math.hypot(p.frame.dx, p.frame.dy) <= p.edgeDist + 2 * C.BALL_R + 1e-9, 'tug never longer than it takes to get inside');
      if (!p.located && !p.frame.trap) ok(Math.hypot(p.frame.dx, p.frame.dy) <= 7 + 1e-9, 'far ball: short tug');
    }
    const lo = type.speed[0] + Math.min(level, 8) + Math.max(0, level - 9) * 3 - (p.form === 'SUBMARINE' ? 6 : 0);
    ok(p.speed >= lo - 0.5 && p.speed <= lo + (type.speed[1] - type.speed[0]) + 0.5, `${p.type} speed ${p.speed} in band at lv${level}`);
    ok(p.dur > 0.3 && p.dur < 0.9, 'flight time sane');
    const end = C.ballPos(p, 1), start = C.ballPos(p, 0);
    ok(near(end.x, p.x) && near(end.y, p.y) && near(end.r, C.BALL_R), 'ball lands on the generated spot');
    ok(near(start.x, p.rel.x) && near(start.y, p.rel.y), 'ball leaves from the release point');
    ok(p.number !== prev && p.number >= 0 && p.number < 100, 'new jersey number');
    ok(p.kit >= 0 && p.kit < 6, 'kit index');
    ok(['short', 'mid', 'tall'].includes(p.batterSize), 'batter size');
    const z = C.zoneFor(C.BATTER_H[p.batterSize]);
    ok(z.y0 === p.zone.y0 && z.y1 === p.zone.y1 && z.y0 < z.y1, 'zone sized to the batter');
    const a = C.absInfo(p);
    ok(a.located === p.located && (a.located ? a.where === null : ['high', 'low', 'inside', 'outside'].includes(a.where)), 'absInfo');
    prev = p.number;
    strikes += p.strike; edges += p.edgeDist < C.RULES.fineEdge; subs += p.form === 'SUBMARINE'; swings += p.swing !== 'none'; frames += !!p.frame; speedSum += p.speed;
  }
  const pc = (n) => (n / N * 100).toFixed(0).padStart(5);
  console.log(`  ${String(level).padStart(2)}  ${pc(strikes)}   ${pc(edges)}  ${pc(subs)}   ${pc(swings)}   ${pc(frames)}   ${(speedSum / N).toFixed(0)}`);
  ok(strikes / N > 0.42 && strikes / N < 0.62, `lv${level}: about half strikes (${(strikes / N * 100).toFixed(0)}%)`);
}
ok(C.levelFor(0) === 1 && C.levelFor(4) === 1 && C.levelFor(5) === 2 && C.levelFor(45) === 10 && C.levelFor(999) === 11, 'level ladder');
ok(C.callWindowFor(1) > C.callWindowFor(12) && C.callWindowFor(12) >= 0.9, 'call window shrinks, floors at 0.9');

// ---------------------------------------------------------------- state machine
console.log('state machine');
const DT = 1 / 60;
function play(umpire, opts) {
  // umpire(game, events) is called every frame; returns nothing. Stops at game over or maxPitches.
  const log = [];
  const game = C.createGame({ rng: mulberry32(opts.seed || 1), kits: 6, onEvent: (type, e) => log.push({ type, e, phase: game.state.phase }) });
  game.start();
  const max = opts.maxPitches || 1000;
  let guard = 0;
  while (game.state.phase !== 'over' && game.state.pitchIndex < max && guard++ < 2e6) {
    game.update(DT);
    umpire(game, log);
  }
  return { game, G: game.state, log };
}
const types = (log) => log.map((l) => l.type);
const count = (log, type) => log.filter((l) => l.type === type).length;

// perfect umpire, calls 0.3 s after the catch
{
  const { G, log } = play((g) => { if (g.state.phase === 'call' && g.state.t >= 0.3) g.call(g.state.pitch.strike ? 'strike' : 'ball'); }, { maxPitches: 60, seed: 7 });
  ok(G.phase === 'over' && G.misses === 0 && G.correct === 55, `perfect umpire: no misses (${G.misses}), 55 correct (${G.correct})`);
  ok(G.level === 11 && G.pitchIndex === 54, `run complete on the last pitch of level 11 (lv ${G.level}, pitch ${G.pitchIndex + 1})`);
  const over = log.find((l) => l.type === 'over');
  ok(over && over.e.won === true && over.e.pitches === 55, 'over event marks the win after 55 pitches');
  ok(G.streak === 55 && G.bestStreak === 55, 'streak counts every call');
  ok(G.mood === 5, 'crowd meter full');
  const resolves = log.filter((l) => l.type === 'resolve').map((l) => l.e);
  ok(resolves.every((r) => r.correct && !r.timeout && r.pts >= 100), 'every resolve correct and paid');
  ok(resolves[0].mult === 1 && near(resolves[10].mult, 2) && near(resolves[54].mult, 2), 'multiplier x1.0 .. x2.0 (capped)');
  ok(resolves.every((r) => r.bonus.includes('quick')), 'a 0.3 s call is quick');
  ok(resolves.slice(4).every((r) => r.crowd === 'chant' && r.mood === 5), 'full stands chant on every call from the fifth');
  ok(G.score === resolves.reduce((a, r) => a + r.pts, 0), 'score is the sum of the points paid');
  ok(G.score <= 60 * 400, 'never beyond the server plausibility cap');
  // event order per pitch
  const seq = types(log).filter((t) => ['next', 'windup', 'pitch', 'catch', 'resolve'].includes(t));
  let good = true;
  for (let i = 0; i < 55; i++) { const s = seq.slice(i * 5, i * 5 + 5).join(','); if (s !== 'next,windup,pitch,catch,resolve') { good = false; break; } }
  ok(good && seq.length === 5 * 55, 'next > windup > pitch > catch > resolve for every pitch, no next after the last');
  const nexts = log.filter((l) => l.type === 'next').map((l) => l.e);
  ok(nexts.filter((n) => n.levelUp).map((n) => n.level).join(',') === '2,3,4,5,6,7,8,9,10,11', 'level-up flags on every fifth pitch');
  ok(nexts.filter((n) => n.banner).length === 10 && nexts.filter((n) => n.congrats).length === 1 && nexts.find((n) => n.congrats).level === 11, 'banners each level, one congratulation at level 11');
  ok(G.reactN === 55 && near(G.reactSum / G.reactN, 0.3, 0.02), 'reaction times averaged');
  const s = log[0] && G; // summary shape
  const sum = { score: G.score, pitches: G.pitchIndex + 1 };
  ok(sum.pitches === 55, 'summary counts every pitch of the season');
}

// always wrong: out after three pitches
{
  const { G, log } = play((g) => { if (g.state.phase === 'call') g.call(g.state.pitch.strike ? 'ball' : 'strike'); }, { seed: 3 });
  ok(G.phase === 'over' && G.misses === 3 && G.score === 0, 'three wrong calls end the game with no points');
  const over = log.find((l) => l.type === 'over');
  ok(over && over.e.pitches === 3 && over.e.accuracy === 0 && over.e.streak === 0 && typeof over.e.reaction === 'number', 'over summary');
  ok(count(log, 'over') === 1, 'over fires once');
  const r = log.filter((l) => l.type === 'resolve').map((l) => l.e);
  ok(r.every((x) => !x.correct && !x.timeout && x.pts === 0), 'wrong calls pay nothing');
  ok(r[0].mood === 0 && r[0].crowd === 'heckle', 'empty stands heckle a miss');
}

// never calls: timeouts
{
  const { G, log } = play(() => {}, { seed: 5 });
  ok(G.phase === 'over', 'silence ends the game');
  const r = log.filter((l) => l.type === 'resolve').map((l) => l.e);
  ok(r.length === 3 && r.every((x) => x.timeout && x.call === null && x.reaction === null), 'timeouts resolve with no call and no reaction time');
  const over = log.find((l) => l.type === 'over');
  ok(over.e.reaction === null, 'no reaction average without a call');
}

// early call: accepted from 90% of the flight, the ball snaps in
{
  let early = null;
  const { log } = play((g) => {
    const s = g.state;
    if (s.phase === 'flight' && s.t / s.pitch.dur >= 0.92 && early === null) early = g.call(s.pitch.strike ? 'strike' : 'ball');
    else if (s.phase === 'call') g.call(s.pitch.strike ? 'strike' : 'ball');
  }, { maxPitches: 1, seed: 9 });
  const c = log.find((l) => l.type === 'catch');
  ok(early === true && c && c.e.early === true, 'a call at 92% of the flight is taken, with an early catch');
}
// too early: ignored
{
  const game = C.createGame({ rng: mulberry32(11), kits: 6 });
  game.start();
  ok(game.call('strike') === false && game.state.phase === 'windup', 'a call during the windup is ignored');
  while (game.state.phase !== 'flight') game.update(DT);
  ok(game.call('strike') === false && game.state.phase === 'flight', 'a call at release is ignored');
}

// replay: back to the reveal with time left, then the next pitch
{
  const game = C.createGame({ rng: mulberry32(13), kits: 6, onEvent: (type, e) => log.push({ type, e }) });
  const log = [];
  game.start();
  while (game.state.phase !== 'call') game.update(DT);
  game.call('ball');
  ok(game.state.phase === 'reveal', 'reveal after the call');
  ok(game.replay() === true && game.state.phase === 'replay', 'replay starts from the reveal');
  ok(game.replay() === false, 'no replay inside a replay');
  let steps = 0;
  while (game.state.phase === 'replay' && steps++ < 5000) game.update(DT);
  ok(game.state.phase === 'reveal' && near(game.state.t, C.TIMING.replayBack), 'replay returns to the reveal at replayBack');
  const c = log.filter((l) => l.type === 'catch');
  ok(c.length === 2 && c[1].e.replay === true, 'the replay catch is flagged');
  ok(types(log).slice(-2).join(',') === 'catch,replayEnd', 'replayEnd event');
  ok(steps > (game.state.pitch.dur / C.TIMING.replaySpeed) / DT * 0.9, 'replay runs in slow motion');
  while (game.state.phase === 'reveal') game.update(DT);
  ok(game.state.phase === 'windup' && game.state.pitchIndex === 1, 'then the next pitch');
}

// pause freezes the clock and blocks calls
{
  const game = C.createGame({ rng: mulberry32(17), kits: 6 });
  ok(game.setPaused(true) === false, 'no pause before the game starts');
  game.start();
  while (game.state.phase !== 'call') game.update(DT);
  const t0 = game.state.t;
  ok(game.setPaused(true) === true && game.state.paused, 'paused');
  for (let i = 0; i < 100; i++) game.update(DT);
  ok(game.state.t === t0 && game.state.phase === 'call', 'clock frozen while paused');
  ok(game.call('strike') === false, 'calls blocked while paused');
  ok(game.replay() === false, 'replay blocked while paused');
  game.setPaused(false);
  game.update(DT);
  ok(game.state.t > t0, 'clock runs again');
  ok(game.callRemain() > 0 && game.callRemain() < 1, 'call window remaining');
}

// patient umpire: holds every call to the last 0.2 s of the window
{
  const { G, log } = play((g) => { if (g.state.phase === 'call' && g.state.t >= g.state.callWindow - 0.2) g.call(g.state.pitch.strike ? 'strike' : 'ball'); }, { maxPitches: 90, seed: 7 });
  const resolves = log.filter((l) => l.type === 'resolve').map((l) => l.e);
  ok(G.misses === 0 && resolves.length > 50 && resolves.every((r) => r.correct && !r.timeout && r.bonus.includes('late')), `every held call pays the late bonus (${resolves.length} calls, ${G.misses} misses)`);
}

// scoring rules
{
  const p = { edgeDist: 1, swing: 'none' };
  ok(C.scoreCall(1, p, 1).pts === 150 && C.scoreCall(1, p, 1).bonus.join() === 'fine', 'edge bonus');
  ok(C.scoreCall(1, { edgeDist: 1, swing: 'full' }, 1).pts === 100, 'no edge bonus on a swing');
  ok(C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 0.2).pts === 130, 'quick bonus');
  ok(C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 1.85, 2.08).pts === 150 && C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 1.85, 2.08).bonus.join() === 'late', 'late bonus inside the last 0.3 s');
  ok(C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 1.7, 2.08).pts === 100, 'no late bonus 0.38 s before the deadline');
  ok(C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 0.5, 0.7).bonus.join() === 'quick,late', 'a tight window can pay both');
  ok(C.scoreCall(1, { edgeDist: 9, swing: 'none' }, 1.9).pts === 100, 'no window given, no late bonus');
  ok(C.scoreCall(11, { edgeDist: 9, swing: 'none' }, 1).pts === 200 && C.scoreCall(50, { edgeDist: 9, swing: 'none' }, 1).mult === 2, 'x2 cap');
  ok(C.moodAfter(0, true) === 1 && C.moodAfter(5, true) === 5 && C.moodAfter(1, false) === 0 && C.moodAfter(5, false) === 3, 'crowd meter +1 / -2');
}

// random umpires, many seeds: no exceptions, invariants hold
{
  let games = 0, overs = 0;
  for (let seed = 100; seed < 160; seed++) {
    const rng = mulberry32(seed * 7);
    let lastScore = 0, bad = false;
    const { G, log } = play((g) => {
      const s = g.state;
      if (s.phase === 'call' && rng() < 0.1) g.call(rng() < 0.5 ? 'strike' : 'ball');
      if (s.phase === 'reveal' && rng() < 0.01) g.replay();
      if (s.score < lastScore || s.misses > 3 || s.mood < 0 || s.mood > 5) bad = true;
      lastScore = s.score;
    }, { seed, maxPitches: 200 });
    ok(!bad, `seed ${seed}: score never drops, misses <= 3, mood 0..5`);
    ok(G.score <= (G.pitchIndex + 1) * 400, `seed ${seed}: score under the plausibility cap`);
    if (G.phase === 'over') { overs++; ok(count(log, 'over') === 1 && G.misses === 3, `seed ${seed}: over once, at three misses`); }
    games++;
  }
  console.log(`  ${games} random games, ${overs} ended by three misses`);
}

// save-a-miss (reprieve): a one-shot miss refund from level 6 on, opt-in, reset every game
console.log('save-a-miss');
{
  const mk = (reprieve) => C.createGame({ rng: mulberry32(21), kits: 6, reprieve });
  const step = (game, done) => { let g = 0; while (!done() && g++ < 2e5) game.update(DT); };
  const toStop = (game) => step(game, () => ['call', 'over', 'reprieve'].includes(game.state.phase));
  const toHold = (game) => step(game, () => ['reprieve', 'over'].includes(game.state.phase));
  const miss = (game) => { const s = game.state; game.call(s.pitch.strike ? 'ball' : 'strike'); };
  const missThrice = (game) => { for (let i = 0; i < 3; i++) { toStop(game); if (game.state.phase === 'call') miss(game); } toHold(game); };

  // opt-in: the default game (replayRun's, with no reprieve) still ends at three misses on level 6
  { const game = mk(false); game.start({ level: 6 }); missThrice(game); ok(game.state.phase === 'over' && game.state.misses === 3, 'reprieve off: three misses end the game at level 6'); }

  // level gate: on but below level 6 there is no prompt
  { const game = mk(true); game.start({ level: 5 }); missThrice(game); ok(game.state.phase === 'over' && game.state.misses === 3, 'reprieve on but below level 6: still ends at three misses'); }

  // level 6, reprieve on: the third miss holds for the prompt instead of ending
  { const game = mk(true); game.start({ level: 6 }); missThrice(game); ok(game.state.phase === 'reprieve' && game.state.misses === 3, 'level 6, reprieve on: the third miss holds for the prompt'); ok(game.resolveReprieve(false) === true && game.state.phase === 'over', 'declining the prompt ends the game'); }

  // a save refunds one miss, play continues, and it is one-shot (no second prompt that game)
  {
    const game = mk(true); game.start({ level: 6 }); missThrice(game);
    ok(game.state.phase === 'reprieve', 'prompt is up before the save');
    ok(game.resolveReprieve(true) === true && game.state.misses === 2, 'a save refunds one miss (3 -> 2)');
    toStop(game); ok(game.state.phase !== 'over', 'play continues after a save');
    let guard = 0; while (game.state.phase !== 'over' && guard++ < 2e6) { toStop(game); if (game.state.phase === 'call') miss(game); else break; }
    toHold(game);
    ok(game.state.phase === 'over' && game.state.misses === 3, 'the save is one-shot: the next three-miss ends the game, no second prompt');
  }

  // resolveReprieve does nothing outside the prompt
  { const game = mk(true); game.start({ level: 6 }); ok(game.resolveReprieve(true) === false, 'resolveReprieve is ignored outside the prompt'); }

  // regression: reprieveUsed resets on start(), so Play Again (same game object) gets a fresh save
  {
    const game = mk(true);
    const toPrompt = () => { game.start({ level: 6 }); missThrice(game); return game.state.phase === 'reprieve'; };
    const first = toPrompt();
    game.resolveReprieve(true);            // use the save in game one
    const second = toPrompt();             // Play Again on the same instance
    ok(first && second, 'the one-shot save resets each game (Play Again / start restores it)');
  }
}

// replay: a logged game plays back to the same summary; a doctored one does not
console.log('replay');
{
  const seed = 4242;
  const rng = mulberry32(99);
  const log = [];
  const game = C.createGame({ rng: C.seededRng(seed), kits: 6, onEvent: (type, e) => { if (type === 'resolve') log.push(e.timeout ? [null] : [e.call, e.reaction]); } });
  game.start();
  let guard = 0;
  while (game.state.phase !== 'over' && guard++ < 2e6) {
    const dt = 1 / 60 + rng() * 0.02; // uneven frames, like a browser
    game.update(dt);
    const s = game.state;
    if (s.phase === 'call' && rng() < 0.08) game.call(rng() < 0.7 ? (s.pitch.strike ? 'strike' : 'ball') : (s.pitch.strike ? 'ball' : 'strike'));
    if (s.phase === 'reveal' && rng() < 0.01) game.replay();
  }
  const want = game.summary();
  const got = C.replayRun(seed, log);
  ok(got && got.score === want.score && got.pitches === want.pitches && got.accuracy === want.accuracy && got.streak === want.streak, `replay reproduces the summary (${want.score} pts, ${want.pitches} pitches)`);
  ok(got && near(got.reaction, want.reaction, 1e-9), 'replay reproduces the average reaction');
  ok(got && got.seconds > 0, 'replay reports game time');
  ok(want.score > 0 && log.length === want.pitches, 'the log has one entry per pitch');
  ok(C.replayRun(seed + 1, log) === null || C.replayRun(seed + 1, log).score !== want.score, 'another seed does not play to the same score');
  const late = log.map((e) => (e[0] === null ? e : [e[0], 99]));
  ok(C.replayRun(seed, late) === null, 'a call after the window is refused');
  ok(C.replayRun(seed, log.slice(0, -1)) === null, 'a log shorter than the game is refused');
  ok(C.replayRun(seed, log.concat([['strike', 0.1]])) === null, 'a log longer than the game is refused');
  ok(C.replayRun(seed, 'nope') === null && C.replayRun(seed, [['strike']]) === null, 'junk is refused');
  const strikes = log.map((e) => (e[0] === null ? e : ['strike', 0.2]));
  const r2 = C.replayRun(seed, strikes);
  ok(r2 === null || r2.score !== want.score || r2.pitches !== want.pitches, 'changing the calls changes the outcome');
}
// the server ships with its own copy of core.js as core.cjs (pre-commit hook): it must be this one
{
  const fs = require('fs'), path = require('path');
  const here = path.join(__dirname, '..');
  const copy = path.join(here, 'server', 'core.cjs');
  ok(fs.existsSync(copy) && fs.readFileSync(copy, 'utf8') === fs.readFileSync(path.join(here, 'core.js'), 'utf8'), 'server/core.cjs is a copy of core.js (run tools/install-hooks.sh)');
}

console.log(`${checks} checks, ${fails} failed`);
process.exit(fails ? 1 : 0);
