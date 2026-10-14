/* UUUMPIRE leaderboard API. Plain Node http server + Postgres (falls back to memory without DATABASE_URL).

   GET  /health                           -> { ok: true }
   GET  /api/scores?period=daily|all      -> { period, day, scores: [{ rank, name, score, pitches, accuracy, streak, reaction, day }] }
   POST /api/scores { name, score, pitches, accuracy, streak, reaction, lang }
                                          -> { ok, rankDaily, rankAll }

   "Today" is the Asia/Taipei calendar day (the players are mostly in TW/JP). CORS is open: the game is a
   static page on another origin and nothing here is sensitive. */
import http from 'node:http';
import pg from 'pg';

const PORT = process.env.PORT || 8787;
const TZ = process.env.BOARD_TZ || 'Asia/Taipei';
const LIMIT = 20;

// ---- storage -------------------------------------------------------------
const pool = process.env.DATABASE_URL
  ? new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'disable' ? false : { rejectUnauthorized: false } })
  : null;
const mem = []; // fallback when no database is configured (dev)

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
  console.log('postgres ready');
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

async function insert(rec) {
  const day = today();
  if (!pool) {
    mem.push({ ...rec, day, created_at: Date.now() });
    const rank = (filter) => mem.filter(filter).filter((r) => r.score > rec.score).length + 1;
    return { rankDaily: rank((r) => r.day === day), rankAll: rank(() => true) };
  }
  await pool.query(
    'INSERT INTO scores (name, score, pitches, accuracy, streak, reaction, lang, day) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [rec.name, rec.score, rec.pitches, rec.accuracy, rec.streak, rec.reaction, rec.lang, day]);
  const d = await pool.query('SELECT COUNT(*)::int AS n FROM scores WHERE day = $1 AND score > $2', [day, rec.score]);
  const a = await pool.query('SELECT COUNT(*)::int AS n FROM scores WHERE score > $1', [rec.score]);
  return { rankDaily: d.rows[0].n + 1, rankAll: a.rows[0].n + 1 };
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
  const lang = ['en', 'zh', 'ja'].includes(b.lang) ? b.lang : null;
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
    req.on('data', (c) => { data += c; if (data.length > 4096) { reject(new Error('too large')); req.destroy(); } });
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
    if (url.pathname === '/api/scores' && req.method === 'POST') {
      const ip = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').toString().split(',')[0].trim();
      if (limited(ip)) return send(res, 429, { error: 'slow down' });
      const rec = validate(await readJson(req));
      if (!rec) return send(res, 400, { error: 'bad score' });
      const ranks = await insert(rec);
      return send(res, 200, { ok: true, ...ranks });
    }
    send(res, 404, { error: 'not found' });
  } catch (e) {
    console.error(e);
    send(res, 500, { error: 'server error' });
  }
});

init().then(() => server.listen(PORT, () => console.log('uuumpire api on :' + PORT)))
  .catch((e) => { console.error('init failed', e); process.exit(1); });
