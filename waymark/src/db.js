const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = process.env.DB_FILE || path.join(ROOT, 'data', 'waymark.db');

function openDb(dbFile = DEFAULT_DB) {
  const dir = path.dirname(dbFile);
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA foreign_keys = ON;');
  return db;
}

function migrate(db) {
  const schema = fs.readFileSync(path.join(ROOT, 'db', 'schema.sql'), 'utf8');
  db.exec(schema);
}

function resetDb(dbFile = DEFAULT_DB) {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = dbFile + suffix;
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  const db = openDb(dbFile);
  migrate(db);
  return db;
}

function getSetting(db, key, fallback = null) {
  const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO app_settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function audit(db, {
  actorId,
  action,
  entityType,
  entityId = null,
  detail = null,
  ip = null,
  userAgent = null,
  req = null,
} = {}) {
  let resolvedIp = ip;
  let resolvedUa = userAgent;
  if (req) {
    try {
      const security = require('./security');
      if (resolvedIp == null) resolvedIp = security.clientIp(req);
      if (resolvedUa == null) resolvedUa = String(req.headers['user-agent'] || '').slice(0, 240);
    } catch {
      /* ignore */
    }
  }
  const detailJson = detail != null ? JSON.stringify(detail) : null;
  const createdAt = new Date().toISOString();
  const stateHash = crypto.createHash('sha256').update(JSON.stringify({
    actorId: actorId ?? null,
    action,
    entityType,
    entityId,
    detail: detailJson,
    ip: resolvedIp || null,
    createdAt,
  })).digest('hex');
  db.prepare(`
    INSERT INTO audit_log(actor_id, action, entity_type, entity_id, detail_json, ip, user_agent, state_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    actorId ?? null,
    action,
    entityType,
    entityId,
    detailJson,
    resolvedIp || null,
    resolvedUa || null,
    stateHash,
    createdAt
  );
}

module.exports = {
  ROOT,
  DEFAULT_DB,
  openDb,
  migrate,
  resetDb,
  getSetting,
  setSetting,
  audit,
};
