const { allocateNumber, audit } = require('../db');
const customFields = require('./customFields');
const matterIndex = require('./matterIndex');

function createMatter(db, actor, input) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');

  const openedOn = input.openedOn || new Date().toISOString().slice(0, 10);
  const year = Number(String(openedOn).slice(0, 4));
  const number = allocateNumber(db, 'matter', year, '');
  customFields.ensureRecordTypes(db);

  const matterType = input.matterType || 'other';
  customFields.ensureTypeLayout(db, matterType);

  let clientId = input.clientId != null ? Number(input.clientId) : null;
  if (!clientId) {
    const firstClient = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get();
    if (!firstClient) throw new Error('add a client before creating matters');
    clientId = firstClient.id;
  }

  const info = db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    clientId,
    number,
    name,
    matterType,
    input.jurisdiction || null,
    input.court || null,
    input.responsibleAttorneyId || null,
    openedOn
  );
  const id = Number(info.lastInsertRowid);

  if (input.customValues) {
    customFields.setCustomValues(db, actor, id, input.customValues);
  }

  matterIndex.indexMatter(db, id);

  audit(db, {
    actorId: actor.id,
    action: 'matter.create',
    entityType: 'matter',
    entityId: id,
    detail: { number },
  });
  return getMatter(db, id);
}

function updateMatter(db, actor, id, patch) {
  const current = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
  if (!current) throw new Error('matter not found');

  if (patch.matterType) {
    customFields.ensureTypeLayout(db, patch.matterType);
  }

  const map = {
    name: 'name',
    clientId: 'client_id',
    matterType: 'matter_type',
    jurisdiction: 'jurisdiction',
    court: 'court',
    status: 'status',
    responsibleAttorneyId: 'responsible_attorney_id',
    openedOn: 'opened_on',
  };

  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    const oldVal = current[col];
    let newVal = patch[key];
    if (key === 'clientId' || key === 'responsibleAttorneyId') {
      newVal = newVal === '' || newVal == null ? null : Number(newVal);
      if (key === 'clientId' && !newVal) throw new Error('client required');
    }
    if (String(oldVal ?? '') === String(newVal ?? '')) continue;
    db.prepare(`UPDATE matters SET ${col} = ? WHERE id = ?`).run(newVal, id);
    db.prepare(`
      INSERT INTO matter_field_history(matter_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, col, oldVal == null ? null : String(oldVal), newVal == null ? null : String(newVal), actor.id);
  }

  if (patch.customValues) {
    customFields.setCustomValues(db, actor, id, patch.customValues);
  }

  matterIndex.indexMatter(db, id);

  audit(db, { actorId: actor.id, action: 'matter.update', entityType: 'matter', entityId: id, detail: patch });
  return getMatter(db, id);
}

/** All matters (dropdowns / internal). */
function listMatters(db, filters = {}) {
  const status = filters.status || null;
  const matterType = filters.matterType || filters.recordType || null;
  const clientId = filters.clientId != null ? Number(filters.clientId) : null;

  return db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE (? IS NULL OR m.status = ?)
      AND (? IS NULL OR m.matter_type = ?)
      AND (? IS NULL OR m.client_id = ?)
    ORDER BY m.number DESC
  `).all(status, status, matterType, matterType, clientId, clientId);
}

/**
 * Matter Search against the FTS index.
 * Requires a query string — empty query returns no rows (index-backed search only).
 */
function searchMatters(db, filters = {}) {
  return matterIndex.searchMatters(db, filters);
}

function getMatter(db, id) {
  return customFields.getMatterPage(db, id);
}

function listClients(db) {
  return db.prepare('SELECT * FROM clients ORDER BY name').all();
}

module.exports = {
  createMatter,
  updateMatter,
  listMatters,
  searchMatters,
  listClients,
  getMatter,
};
