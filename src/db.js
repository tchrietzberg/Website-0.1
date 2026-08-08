const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.join(__dirname, '..');
const DEFAULT_DB = process.env.DB_FILE || path.join(ROOT, 'data', 'billing.db');

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
  const row = db.prepare('SELECT value FROM firm_settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

function setSetting(db, key, value) {
  db.prepare(`
    INSERT INTO firm_settings(key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(key, String(value));
}

function audit(db, { actorId, action, entityType, entityId = null, detail = null }) {
  db.prepare(`
    INSERT INTO audit_log(actor_id, action, entity_type, entity_id, detail_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(actorId ?? null, action, entityType, entityId, detail ? JSON.stringify(detail) : null);
}

function allocateNumber(db, name, year, prefix) {
  const existing = db.prepare(
    'SELECT next_value FROM number_counters WHERE name = ? AND year = ?'
  ).get(name, year);
  let n;
  if (!existing) {
    db.prepare('INSERT INTO number_counters(name, year, next_value) VALUES (?, ?, 2)')
      .run(name, year);
    n = 1;
  } else {
    n = existing.next_value;
    db.prepare('UPDATE number_counters SET next_value = next_value + 1 WHERE name = ? AND year = ?')
      .run(name, year);
  }
  return `${prefix}${year}-${String(n).padStart(4, '0')}`;
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
  allocateNumber,
};
