/*
 * server.js
 * 事業計画シミュレーターを Railway 等で公開するための小さなサーバー。
 *  - 静的ファイル（index.html / css / js）の配信
 *  - 会社ごとの事業計画データの保存・コピー・一覧・削除API（/api/...）
 *
 * 保存先：環境変数 DATABASE_URL があれば PostgreSQL（Railway の Postgres）、
 *         無ければ DATA_DIR（既定 ./data）配下のJSONファイル（ローカル確認用）。
 * 管理用パスワード：環境変数 ADMIN_PASSWORD。会社一覧・削除・全件エクスポートに必要。
 *   （本番で未設定の場合、これらのAPIは安全のため無効になります）
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const IS_PROD = process.env.NODE_ENV === 'production' || !!process.env.RAILWAY_ENVIRONMENT;
const ROOT = __dirname;
const MAX_BODY = 4 * 1024 * 1024;

/* ---------------- 保存層 ---------------- */
function makePgStore(url) {
  const { Pool } = require('pg');
  // Railway内部ネットワーク(.railway.internal)・localhostはSSL不要。それ以外は接続文字列の sslmode に従う
  // （証明書検証を無効化することはしない）。
  const pool = new Pool({ connectionString: url });
  const toRec = r => ({
    id: r.id, companyName: r.company_name, openDate: r.open_date, year1: r.year1 === null ? null : Number(r.year1),
    year2: r.year2 === null ? null : Number(r.year2), copiedFrom: r.copied_from,
    createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(), data: r.data
  });
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`CREATE TABLE IF NOT EXISTS companies (
        id TEXT PRIMARY KEY, company_name TEXT NOT NULL DEFAULT '', open_date TEXT NOT NULL DEFAULT '',
        year1 BIGINT, year2 BIGINT, copied_from TEXT, data JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now())`);
    },
    async list() {
      const r = await pool.query('SELECT id, company_name, open_date, year1, year2, copied_from, created_at, updated_at, \'null\'::jsonb AS data FROM companies ORDER BY updated_at DESC');
      return r.rows.map(x => { const o = toRec(x); delete o.data; return o; });
    },
    async get(id) { const r = await pool.query('SELECT * FROM companies WHERE id=$1', [id]); return r.rows[0] ? toRec(r.rows[0]) : null; },
    async create(rec) {
      await pool.query('INSERT INTO companies (id, company_name, open_date, year1, year2, copied_from, data) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [rec.id, rec.companyName, rec.openDate, rec.year1, rec.year2, rec.copiedFrom, rec.data]);
      return this.get(rec.id);
    },
    async update(id, rec) {
      const r = await pool.query('UPDATE companies SET company_name=$2, open_date=$3, year1=$4, year2=$5, data=$6, updated_at=now() WHERE id=$1',
        [id, rec.companyName, rec.openDate, rec.year1, rec.year2, rec.data]);
      return r.rowCount ? this.get(id) : null;
    },
    async remove(id) { const r = await pool.query('DELETE FROM companies WHERE id=$1', [id]); return r.rowCount > 0; },
    async all() { const r = await pool.query('SELECT * FROM companies ORDER BY created_at'); return r.rows.map(toRec); }
  };
}

function makeFileStore(dir) {
  const file = path.join(dir, 'companies.json');
  let db = {};
  const flush = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(db)); fs.renameSync(tmp, file); };
  const strip = r => { const o = { ...r }; delete o.data; return o; };
  return {
    kind: 'file',
    async init() { fs.mkdirSync(dir, { recursive: true }); if (fs.existsSync(file)) db = JSON.parse(fs.readFileSync(file, 'utf8')); },
    async list() { return Object.values(db).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(strip); },
    async get(id) { return db[id] || null; },
    async create(rec) { const now = new Date().toISOString(); db[rec.id] = { ...rec, createdAt: now, updatedAt: now }; flush(); return db[rec.id]; },
    async update(id, rec) { if (!db[id]) return null; db[id] = { ...db[id], ...rec, id, updatedAt: new Date().toISOString() }; flush(); return db[id]; },
    async remove(id) { if (!db[id]) return false; delete db[id]; flush(); return true; },
    async all() { return Object.values(db).sort((a, b) => a.createdAt.localeCompare(b.createdAt)); }
  };
}

const store = process.env.DATABASE_URL ? makePgStore(process.env.DATABASE_URL) : makeFileStore(process.env.DATA_DIR || path.join(ROOT, 'data'));

/* ---------------- ユーティリティ ---------------- */
const newId = () => crypto.randomBytes(8).toString('hex');
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('データが大きすぎます'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch (e) { reject(Object.assign(new Error('JSONの形式が正しくありません'), { status: 400 })); } });
    req.on('error', reject);
  });
}
function isAdmin(req) {
  if (!ADMIN_PASSWORD) return !IS_PROD; // 本番で未設定なら管理APIは無効
  const given = String(req.headers['x-admin-password'] || '');
  const a = crypto.createHash('sha256').update(given).digest();
  const b = crypto.createHash('sha256').update(ADMIN_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}
function requireAdmin(req, res) {
  if (isAdmin(req)) return true;
  const disabled = !ADMIN_PASSWORD && IS_PROD;
  setTimeout(() => json(res, disabled ? 403 : 401, { ok: false, error: disabled ? '管理用パスワード(ADMIN_PASSWORD)が未設定のため無効です' : '管理パスワードが正しくありません' }), 400);
  return false;
}
function cleanData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw Object.assign(new Error('data が不正です'), { status: 400 });
  return data;
}
function fieldsFrom(body, data) {
  const meta = body.meta || {};
  const num = v => (typeof v === 'number' && isFinite(v) ? Math.round(v) : null);
  return {
    companyName: String(body.companyName || (data.meta && data.meta.companyName) || '').slice(0, 100),
    openDate: String(meta.openDate || (data.meta && data.meta.openDate) || '').slice(0, 20),
    year1: num(meta.year1OperatingIncome), year2: num(meta.year2OperatingIncome)
  };
}

/* ---------------- API ---------------- */
async function handleApi(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api', 'companies', id, 'copy']
  const method = req.method;
  if (parts[1] === 'health') return json(res, 200, { ok: true, app: 'bk-plan', store: store.kind });

  if (parts[1] === 'export' && method === 'GET') {
    if (!requireAdmin(req, res)) return;
    return json(res, 200, { ok: true, exportedAt: new Date().toISOString(), companies: await store.all() });
  }
  if (parts[1] !== 'companies') return json(res, 404, { ok: false, error: 'not found' });

  const id = parts[2];
  if (!id) {
    if (method === 'GET') { if (!requireAdmin(req, res)) return; return json(res, 200, { ok: true, companies: await store.list() }); }
    if (method === 'POST') {
      const body = await readBody(req); const data = cleanData(body.data);
      const rec = { id: newId(), ...fieldsFrom(body, data), copiedFrom: /^[a-f0-9]{8,32}$/.test(String(body.copiedFrom || '')) ? body.copiedFrom : null, data };
      data.meta = { ...(data.meta || {}), companyName: rec.companyName };
      const saved = await store.create(rec);
      return json(res, 201, { ok: true, id: saved.id });
    }
    return json(res, 405, { ok: false, error: 'method not allowed' });
  }
  if (!/^[a-f0-9]{8,32}$/.test(id)) return json(res, 404, { ok: false, error: '指定されたIDのデータが見つかりません' });

  if (parts[3] === 'copy' && method === 'POST') {
    const src = await store.get(id);
    if (!src) return json(res, 404, { ok: false, error: '指定されたIDのデータが見つかりません' });
    const body = await readBody(req);
    const name = String(body.companyName || '').trim().slice(0, 100);
    if (!name) return json(res, 400, { ok: false, error: '新しい会社名を入力してください' });
    const data = JSON.parse(JSON.stringify(src.data));
    data.meta = { ...(data.meta || {}), companyName: name, createdAt: new Date().toISOString().slice(0, 10) };
    const rec = { id: newId(), companyName: name, openDate: src.openDate, year1: src.year1, year2: src.year2, copiedFrom: src.id, data };
    const saved = await store.create(rec);
    return json(res, 201, { ok: true, id: saved.id });
  }
  if (parts[3]) return json(res, 404, { ok: false, error: 'not found' });

  if (method === 'GET') {
    const rec = await store.get(id);
    if (!rec) return json(res, 404, { ok: false, error: '指定されたIDのデータが見つかりません' });
    return json(res, 200, { ok: true, id: rec.id, companyName: rec.companyName, updatedAt: rec.updatedAt, data: rec.data });
  }
  if (method === 'PUT') {
    const body = await readBody(req); const data = cleanData(body.data);
    const saved = await store.update(id, { ...fieldsFrom(body, data), data });
    if (!saved) return json(res, 404, { ok: false, error: '指定されたIDのデータが見つかりません' });
    return json(res, 200, { ok: true, id: saved.id });
  }
  if (method === 'DELETE') {
    if (!requireAdmin(req, res)) return;
    const ok = await store.remove(id);
    return json(res, ok ? 200 : 404, { ok, error: ok ? undefined : '指定されたIDのデータが見つかりません' });
  }
  return json(res, 405, { ok: false, error: 'method not allowed' });
}

/* ---------------- 静的ファイル ---------------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/favicon.ico') rel = '/img/favicon.ico'; // ブラウザが既定で取りに来るパス
  // 公開するのは index.html / css / js のみ（server.js やデータ置き場は配信しない）
  if (!(rel === '/index.html' || /^\/(css|js|img)\/[\w.\-]+$/.test(rel))) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, rel);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': rel === '/index.html' ? 'no-cache' : 'public, max-age=300' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }
    return serveStatic(req, res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) json(res, e.status || 500, { ok: false, error: e.status ? e.message : 'サーバーエラーが発生しました' });
  }
});

store.init().then(() => {
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`bk-plan listening on :${PORT} (store: ${store.kind}${ADMIN_PASSWORD ? '' : ', ADMIN_PASSWORD 未設定'})`);
  });
}).catch(e => { console.error('起動に失敗しました', e); process.exit(1); });
