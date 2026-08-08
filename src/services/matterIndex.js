/**
 * Matter Search index (portable — no FTS5 required).
 * Each matter has a denormalized body document updated on create/update.
 */

function ensureMatterIndex(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS matter_search_index (
      matter_id INTEGER PRIMARY KEY REFERENCES matters(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_matter_search_body
      ON matter_search_index(body);
  `);
}

function buildCustomText(db, matterId) {
  const rows = db.prepare(`
    SELECT cf.label, v.value_text
    FROM custom_field_values v
    JOIN custom_fields cf ON cf.id = v.field_id
    WHERE v.matter_id = ?
  `).all(matterId);
  return rows
    .map((r) => `${r.label || ''} ${r.value_text || ''}`)
    .join(' ')
    .trim();
}

function indexMatter(db, matterId) {
  ensureMatterIndex(db);
  const row = db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE m.id = ?
  `).get(matterId);
  if (!row) {
    db.prepare('DELETE FROM matter_search_index WHERE matter_id = ?').run(matterId);
    return;
  }
  const customText = buildCustomText(db, matterId);
  const od = db.prepare(
    'SELECT folder_name, folder_url FROM matter_onedrive WHERE matter_id = ?'
  ).get(matterId);
  const body = [
    row.number,
    row.name,
    row.client_name,
    row.court,
    row.jurisdiction,
    row.matter_type,
    row.status,
    row.attorney_name,
    customText,
    od?.folder_name,
    od?.folder_url,
    od ? 'onedrive' : null,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  db.prepare(`
    INSERT INTO matter_search_index(matter_id, body, updated_at)
    VALUES (?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(matter_id) DO UPDATE SET
      body = excluded.body,
      updated_at = excluded.updated_at
  `).run(matterId, body);
}

function removeMatterFromIndex(db, matterId) {
  ensureMatterIndex(db);
  db.prepare('DELETE FROM matter_search_index WHERE matter_id = ?').run(matterId);
}

function reindexAllMatters(db) {
  ensureMatterIndex(db);
  db.exec('DELETE FROM matter_search_index');
  const ids = db.prepare('SELECT id FROM matters').all();
  for (const { id } of ids) indexMatter(db, id);
}

function tokenize(q) {
  return String(q || '')
    .trim()
    .toLowerCase()
    .split(/[\s,]+/)
    .map((t) => t.replace(/[%_]/g, ''))
    .filter((t) => t.length > 0);
}

function searchMatters(db, filters = {}) {
  ensureMatterIndex(db);
  const tokens = tokenize(filters.q);
  if (!tokens.length) return []; // Matter Search only returns indexed hits

  const status = filters.status || null;
  const matterType = filters.matterType || filters.recordType || null;
  const clientId = filters.clientId != null ? Number(filters.clientId) : null;

  // AND all tokens against the indexed body
  const tokenClauses = tokens.map(() => 'idx.body LIKE ?').join(' AND ');
  const tokenParams = tokens.map((t) => `%${t}%`);

  return db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matter_search_index idx
    JOIN matters m ON m.id = idx.matter_id
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE ${tokenClauses}
      AND (? IS NULL OR m.status = ?)
      AND (? IS NULL OR m.matter_type = ?)
      AND (? IS NULL OR m.client_id = ?)
    ORDER BY m.number DESC
  `).all(
    ...tokenParams,
    status, status,
    matterType, matterType,
    clientId, clientId
  );
}

module.exports = {
  ensureMatterIndex,
  indexMatter,
  removeMatterFromIndex,
  reindexAllMatters,
  searchMatters,
  tokenize,
};
