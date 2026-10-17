/* UUUMPIRE leaderboard API. Plain Node http server + Postgres (falls back to memory without DATABASE_URL).

   GET  /health                           -> { ok: true }
   GET  /api/scores?period=daily|all      -> { period, day, scores: [{ rank, name, score, pitches, accuracy, streak, reaction, day }] }
   POST /api/plays                        -> { ok, counted }   one more game started today (PLAY BALL clicked)
   GET  /api/plays                        -> { day, today, total, from }
   POST /api/runs                         -> { run, seed }   a seed for one game (replayed on submit)
   POST /api/scores { name, score, pitches, accuracy, streak, reaction, lang, run, log }
                                          -> { ok, rankDaily, rankAll }  or 400 { error }

   Anti-cheat: a score must come with the run id the game was started on and its call log; the server
   replays the log on that seed with core.js (replayRun) and only takes the score the replay produces.
   A run is single-use and expires after RUN_TTL. REQUIRE_RUN=0 accepts bare scores (old clients).

   "Today" is the Asia/Taipei calendar day (the players are mostly in TW/JP). CORS is open: the game is a
   static page on another origin and nothing here is sensitive. */
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import pg from 'pg';

// core.js is the game itself. `railway up` ships server/ alone, so the pre-commit hook keeps a copy
// here (server/core.js); a repo checkout prefers the original one directory up.
const require = createRequire(import.meta.url);
const CORE_PATH = fs.existsSync(new URL('../core.js', import.meta.url)) ? '../core.js' : './core.js';
const C = require(CORE_PATH);

const PORT = process.env.PORT || 8787;
const TZ = process.env.BOARD_TZ || 'Asia/Taipei';
const LIMIT = 20; // rows shown per board; anything outside both top-20s is pruned (see prune())
const PLAYS_FROM = process.env.PLAYS_FROM || '2026-10-18'; // the play counter starts on this Taipei day; earlier starts are not counted
const RUN_TTL = 12 * 3600 * 1000; // a seed is good for one game started within this
const REQUIRE_RUN = process.env.REQUIRE_RUN !== '0';

// ---- storage -------------------------------------------------------------
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } })
  : null;
const mem = []; // fallback when no database is configured (dev)
const memPlays = new Map(); // day -> games started (dev fallback)
const memRuns = new Map(); // id -> { seed, created_at, used }

async function init() {
  if (!pool) { console.log('no DATABASE_URL: using in-memory scores'); return; }
  await pool.query(`CREATE TABLE IF NOT EXISTS scores (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    score INTEGER NOT NULL,
    pitches INTEGER NOT NULL,
    accuracy INTEGER NOT NULL,
    streak INTEGER NOT NULL DEFAULT 0,
    reaction REAL,
    lang TEXT,
    day TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS scores_day_score ON scores (day, score DESC)');
  await pool.query('CREATE INDEX IF NOT EXISTS scores_score ON scores (score DESC)');
  await pool.query('CREATE TABLE IF NOT EXISTS plays (day TEXT PRIMARY KEY, n INTEGER NOT NULL DEFAULT 0)');
  await pool.query(`CREATE TABLE IF NOT EXISTS runs (
    id TEXT PRIMARY KEY,
    seed INTEGER NOT NULL,
    created_at BIGINT NOT NULL,
    used INTEGER NOT NULL DEFAULT 0
  )`);
  await pruneRuns();
  console.log('postgres ready');
  await prune();
}

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

async function top(period) {
  const day = today();
  if (!pool) {
    const rows = mem.filter((r) => period !== 'daily' || r.day === day).sort((a, b) => b.score - a.score).slice(0, LIMIT);
    return { day, rows };
  }
  const q = period === 'daily'
    ? { text: 'SELECT name, score, pitches, accuracy, streak, reaction, day FROM scores WHERE day = $1 ORDER BY score DESC, created_at ASC LIMIT $2', values: [day, LIMIT] }
    : { text: 'SELECT name, score, pitches, accuracy, streak, reaction, day FROM scores ORDER BY score DESC, created_at ASC LIMIT $1', values: [LIMIT] };
  const { rows } = await pool.query(q);
  return { day, rows };
}

// Keep only what can ever be shown again: the all-time top LIMIT and today's top LIMIT. A row that is
// in neither will never appear on either board (yesterday's board is gone), so it goes. Runs after every
// insert and at startup. Ties break the same way top() orders them (earlier submission first).
async function prune() {
  const day = today();
  if (!pool) {
    const byScore = (a, b) => b.score - a.score || a.created_at - b.created_at;
    const keep = new Set([...mem].sort(byScore).slice(0, LIMIT).concat(mem.filter((r) => r.day === day).sort(byScore).slice(0, LIMIT)));
    for (let i = mem.length - 1; i >= 0; i--) if (!keep.has(mem[i])) mem.splice(i, 1);
    return;
  }
  const { rowCount } = await pool.query(
    `DELETE FROM scores WHERE id NOT IN (SELECT id FROM scores ORDER BY score DESC, created_at ASC LIMIT $1)
       AND id NOT IN (SELECT id FROM scores WHERE day = $2 ORDER BY score DESC, created_at ASC LIMIT $1)`, [LIMIT, day]);
  if (rowCount) console.log('pruned', rowCount, 'rows outside the top', LIMIT);
}

async function insert(rec) {
  const day = today();
  if (!pool) {
    mem.push({ ...rec, day, created_at: Date.now() });
    const rank = (filter) => mem.filter(filter).filter((r) => r.score > rec.score).length + 1;
    const ranks = { rankDaily: rank((r) => r.day === day), rankAll: rank(() => true) };
    await prune();
    return ranks;
  }
  await pool.query(
    'INSERT INTO scores (name, score, pitches, accuracy, streak, reaction, lang, day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [rec.name, rec.score, rec.pitches, rec.accuracy, rec.streak, rec.reaction, rec.lang, day]);
  const d = await pool.query('SELECT COUNT(*)::int AS n FROM scores WHERE day = $1 AND score > $2', [day, rec.score]);
  const a = await pool.query('SELECT COUNT(*)::int AS n FROM scores WHERE score > $1', [rec.score]);
  await prune();
  return { rankDaily: d.rows[0].n + 1, rankAll: a.rows[0].n + 1 };
}

// ---- play counter: one row per Taipei day, bumped when PLAY BALL is clicked ----------------------
async function countPlay() {
  const day = today();
  if (day < PLAYS_FROM) return false;
  if (!pool) { memPlays.set(day, (memPlays.get(day) || 0) + 1); return true; }
  await pool.query('INSERT INTO plays (day, n) VALUES ($1, 1) ON CONFLICT (day) DO UPDATE SET n = plays.n + 1', [day]);
  return true;
}
async function plays() {
  const day = today();
  if (!pool) { let total = 0; for (const n of memPlays.values()) total += n; return { day, today: memPlays.get(day) || 0, total, from: PLAYS_FROM }; }
  const t = await pool.query('SELECT n FROM plays WHERE day = $1', [day]);
  const a = await pool.query('SELECT COALESCE(SUM(n), 0)::int AS n FROM plays');
  return { day, today: t.rows.length ? t.rows[0].n : 0, total: a.rows[0].n, from: PLAYS_FROM };
}

// ---- runs: a seed per game, replayed on submit ---------------------------
async function newRun() {
  const id = crypto.randomUUID(), seed = crypto.randomInt(1, 2147483647), now = Date.now();
  if (!pool) { memRuns.set(id, { seed, created_at: now, used: 0 }); if (memRuns.size > 20000) await pruneRuns(); }
  else { await pool.query('INSERT INTO runs (id, seed, created_at) VALUES ($1,$2,$3)', [id, seed, now]); if (Math.random() < 0.02) await pruneRuns(); }
  return { run: id, seed };
}
// the run, marked used; null when unknown, already used or expired
async function takeRun(id) {
  if (typeof id !== 'string' || id.length > 64) return null;
  const since = Date.now() - RUN_TTL;
  if (!pool) {
    const r = memRuns.get(id);
    if (!r || r.used || r.created_at < since) return null;
    r.used = 1;
    return r;
  }
  const q = await pool.query('UPDATE runs SET used = 1 WHERE id = $1 AND used = 0 AND created_at > $2 RETURNING seed, created_at', [id, since]);
  return q.rows[0] ? { seed: q.rows[0].seed, created_at: Number(q.rows[0].created_at) } : null;
}
async function pruneRuns() {
  const since = Date.now() - RUN_TTL;
  if (!pool) { for (const [id, r] of memRuns) if (r.used || r.created_at < since) memRuns.delete(id); return; }
  await pool.query('DELETE FROM runs WHERE used = 1 OR created_at < $1', [since]);
}
// why a submitted score is not the one its log plays to (null = it is)
async function verify(rec, body) {
  if (body.run === undefined && body.log === undefined && !REQUIRE_RUN) return null;
  const run = await takeRun(body.run);
  if (!run) return 'run';
  const r = C.replayRun(run.seed, body.log);
  if (!r) return 'log';
  if (r.score !== rec.score || r.pitches !== rec.pitches || r.accuracy !== rec.accuracy || r.streak !== rec.streak) return 'score';
  if ((r.reaction === null) !== (rec.reaction === null) || (r.reaction !== null && Math.abs(r.reaction - rec.reaction) > 0.002)) return 'reaction';
  if (Date.now() - run.created_at < r.seconds * 1000 * 0.9) return 'clock'; // played faster than the game runs
  return null;
}

// ---- validation + rate limit --------------------------------------------
const MAX_PER_PITCH = 400; // best case per pitch: 100 x2.0 streak +50 +30, x1.5 guide off = 345
function validate(b) {
  if (!b || typeof b !== 'object') return null;
  const name = String(b.name || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 12);
  const score = Number(b.score), pitches = Number(b.pitches), accuracy = Number(b.accuracy), streak = Number(b.streak || 0);
  const reaction = b.reaction === null || b.reaction === undefined ? null : Number(b.reaction);
  if (!name) return null;
  if (![score, pitches, accuracy, streak].every(Number.isFinite)) return null;
  if (score < 0 || score > 1000000 || pitches < 1 || pitches > 1000 || accuracy < 0 || accuracy > 100 || streak < 0 || streak > pitches) return null;
  if (score > pitches * MAX_PER_PITCH) return null;
  if (reaction !== null && (!Number.isFinite(reaction) || reaction < 0 || reaction > 10)) return null;
  const lang = ['en', 'zh', 'ja', 'nan'].includes(b.lang) ? b.lang : null;
  return { name, score: Math.round(score), pitches: Math.round(pitches), accuracy: Math.round(accuracy), streak: Math.round(streak), reaction, lang };
}

const hits = new Map(); // ip -> [timestamps]
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return list.length > 12;
}

// ---- http ------------------------------------------------------------------
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
};
function send(res, status, body) {
  res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}
function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 16384) { reject(new Error('too large')); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    if (url.pathname === '/health' || url.pathname === '/') return send(res, 200, { ok: true, day: today(), db: !!pool });
    if (url.pathname === '/api/scores' && req.method === 'GET') {
      const period = url.searchParams.get('period') === 'all' ? 'all' : 'daily';
      const { day, rows } = await top(period);
      return send(res, 200, { period, day, scores: rows.map((r, i) => ({ rank: i + 1, ...r })) });
    }
    if (url.pathname === '/api/plays' && req.method === 'GET') return send(res, 200, await plays());
    if (url.pathname === '/api/plays' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      return send(res, 200, { ok: true, counted: await countPlay() });
    }
    // moderation: POST /api/admin/delete { name } with header x-admin-token (only when ADMIN_TOKEN is set)
    if (url.pathname === '/api/admin/delete' && req.method === 'POST' && process.env.ADMIN_TOKEN) {
      if (req.headers['x-admin-token'] !== process.env.ADMIN_TOKEN) return send(res, 403, { error: 'forbidden' });
      const body = await readJson(req);
      const name = String(body.name || '').trim();
      if (!name) return send(res, 400, { error: 'name required' });
      let removed = 0;
      if (pool) removed = (await pool.query('DELETE FROM scores WHERE name = $1', [name])).rowCount;
      else { const before = mem.length; for (let i = mem.length - 1; i >= 0; i--) if (mem[i].name === name) mem.splice(i, 1); removed = before - mem.length; }
      return send(res, 200, { ok: true, removed });
    }
    if (url.pathname === '/api/runs' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      return send(res, 200, await newRun());
    }
    if (url.pathname === '/api/scores' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      const body = await readJson(req);
      const rec = validate(body);
      if (!rec) return send(res, 400, { error: 'bad score' });
      const why = await verify(rec, body);
      if (why) { console.log(`rejected ${rec.name} ${rec.score} (${why}) from ${ip}`); return send(res, 400, { error: 'rejected', why }); }
      const ranks = await insert(rec);
      return send(res, 200, { ok: true, ...ranks });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'server error' });
  }
});

init().then(() => server.listen(PORT, () => console.log(`uuumpire api on :${PORT} (core ${CORE_PATH}, runs ${REQUIRE_RUN ? 'required' : 'optional'})`)))
  .catch((e) => { console.error('init failed', e); process.exit(1); });
