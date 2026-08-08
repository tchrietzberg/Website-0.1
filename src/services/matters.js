const { allocateNumber, audit } = require('../db');
const customFields = require('./customFields');

function createMatter(db, actor, input) {
  const year = Number(String(input.openedOn || new Date().toISOString()).slice(0, 4));
  const number = allocateNumber(db, 'matter', year, '');
  customFields.ensureRecordTypes(db);
  customFields.ensureTypeLayout(db, input.matterType);

  const info = db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    input.clientId,
    number,
    input.name,
    input.matterType,
    input.jurisdiction || null,
    input.court || null,
    input.responsibleAttorneyId || null,
    input.openedOn
  );
  const id = Number(info.lastInsertRowid);

  if (input.customValues) {
    customFields.setCustomValues(db, actor, id, input.customValues);
  }

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

  const map = {
    name: 'name',
    matterType: 'matter_type',
    jurisdiction: 'jurisdiction',
    court: 'court',
    status: 'status',
    responsibleAttorneyId: 'responsible_attorney_id',
  };

  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    const oldVal = current[col];
    const newVal = patch[key];
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

  audit(db, { actorId: actor.id, action: 'matter.update', entityType: 'matter', entityId: id, detail: patch });
  return getMatter(db, id);
}

function listMatters(db, filters = {}) {
  const q = filters.q ? `%${String(filters.q).trim().toLowerCase()}%` : null;
  const status = filters.status || null;
  const matterType = filters.matterType || filters.recordType || null;
  const clientId = filters.clientId != null ? Number(filters.clientId) : null;

  return db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE (? IS NULL OR (
      lower(m.number) LIKE ? OR lower(m.name) LIKE ? OR lower(c.name) LIKE ?
      OR lower(IFNULL(m.court,'')) LIKE ? OR lower(IFNULL(m.jurisdiction,'')) LIKE ?
    ))
      AND (? IS NULL OR m.status = ?)
      AND (? IS NULL OR m.matter_type = ?)
      AND (? IS NULL OR m.client_id = ?)
    ORDER BY m.number DESC
  `).all(
    q, q, q, q, q, q,
    status, status,
    matterType, matterType,
    clientId, clientId
  );
}

function getMatter(db, id) {
  return customFields.getMatterPage(db, id);
}

function listClients(db) {
  return db.prepare('SELECT * FROM clients ORDER BY name').all();
}

module.exports = { createMatter, updateMatter, listMatters, listClients, getMatter };
