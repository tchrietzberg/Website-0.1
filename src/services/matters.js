const { allocateNumber, audit } = require('../db');
const customFields = require('./customFields');
const matterIndex = require('./matterIndex');

const STATUS_NAME_SEP = ' — ';

function formatBuiltInStatus(status) {
  const s = String(status || '').trim();
  if (s === 'open') return 'Open';
  if (s === 'closed') return 'Closed';
  return s;
}

/** Custom matter fields whose label indicates a status dropdown. */
function statusCustomFields(db, matter) {
  return db.prepare(`
    SELECT id, label, options_json
    FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = 'matter'
      AND lower(label) LIKE '%status%'
      AND (
        (matter_id IS NULL AND record_type_key IS NULL)
        OR (record_type_key = ? AND matter_id IS NULL)
        OR (matter_id = ?)
      )
    ORDER BY CASE WHEN lower(label) = 'status' THEN 0 ELSE 1 END, id
  `).all(matter.matter_type || customFields.DEFAULT_RECORD_TYPE_KEY, matter.id);
}

function stripStatusSuffix(name) {
  const raw = String(name || '');
  const idx = raw.lastIndexOf(STATUS_NAME_SEP);
  if (idx === -1) return raw.trim();
  return raw.slice(0, idx).trim();
}

function nameWithStatus(name, statusLabel) {
  const base = stripStatusSuffix(name);
  const status = String(statusLabel || '').trim();
  if (!status) return base;
  return `${base}${STATUS_NAME_SEP}${status}`;
}

/**
 * If status (built-in or a Status custom field) changed in this patch,
 * return the label to append on the matter name; otherwise null.
 */
function resolveStatusNameUpdate(db, matter, patch) {
  // Prefer an explicit custom Status field when present in the save payload.
  if (patch.customValues && typeof patch.customValues === 'object') {
    for (const field of statusCustomFields(db, matter)) {
      const key = String(field.id);
      if (!Object.prototype.hasOwnProperty.call(patch.customValues, key)
        && !Object.prototype.hasOwnProperty.call(patch.customValues, field.id)) {
        continue;
      }
      const next = patch.customValues[key] ?? patch.customValues[field.id];
      const prev = db.prepare(`
        SELECT value_text FROM custom_field_values
        WHERE matter_id = ? AND field_id = ?
      `).get(matter.id, field.id);
      const nextText = next == null ? '' : String(next).trim();
      const prevText = prev?.value_text == null ? '' : String(prev.value_text).trim();
      if (nextText !== prevText) return nextText;
      break;
    }
  }

  if (patch.status !== undefined) {
    const next = formatBuiltInStatus(patch.status);
    const prev = formatBuiltInStatus(matter.status);
    if (next !== prev) return next;
  }

  return null;
}

function createMatter(db, actor, input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');

  const openedOn = String(input.openedOn || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const year = Number(openedOn.slice(0, 4));
  if (!Number.isFinite(year)) throw new Error('invalid openedOn');
  const number = allocateNumber(db, 'matter', year, '');
  customFields.ensureRecordTypes(db);

  const matterType = customFields.DEFAULT_RECORD_TYPE_KEY;
  customFields.ensureTypeLayout(db, matterType);

  let clientId = input.clientId != null && input.clientId !== ''
    ? Number(input.clientId)
    : null;
  if (!clientId || !Number.isFinite(clientId)) {
    const firstClient = db.prepare('SELECT id FROM clients ORDER BY id LIMIT 1').get();
    if (!firstClient) throw new Error('add a client before creating matters');
    clientId = Number(firstClient.id);
  }

  const attorneyId = input.responsibleAttorneyId != null && input.responsibleAttorneyId !== ''
    ? Number(input.responsibleAttorneyId)
    : null;

  const info = db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?, ?)
  `).run(
    clientId,
    number,
    name,
    matterType,
    input.jurisdiction != null && input.jurisdiction !== '' ? String(input.jurisdiction) : null,
    input.court != null && input.court !== '' ? String(input.court) : null,
    Number.isFinite(attorneyId) ? attorneyId : null,
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

  // Record type is fixed to Default; ignore client attempts to change it.
  if (patch.matterType != null) delete patch.matterType;

  const statusForName = resolveStatusNameUpdate(db, current, patch);

  const map = {
    name: 'name',
    clientId: 'client_id',
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
      if (newVal != null && !Number.isFinite(newVal)) newVal = null;
      if (key === 'clientId' && !newVal) throw new Error('client required');
    } else if (newVal != null) {
      newVal = String(newVal);
    } else {
      newVal = null;
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

  // When status changes, keep the matter name ending with that status.
  if (statusForName != null) {
    const after = db.prepare('SELECT name FROM matters WHERE id = ?').get(id);
    const baseName = patch.name !== undefined ? String(patch.name) : after.name;
    const nextName = nameWithStatus(baseName, statusForName);
    if (nextName && nextName !== after.name) {
      db.prepare('UPDATE matters SET name = ? WHERE id = ?').run(nextName, id);
      db.prepare(`
        INSERT INTO matter_field_history(matter_id, field_name, old_value, new_value, changed_by)
        VALUES (?, 'name', ?, ?, ?)
      `).run(id, after.name, nextName, actor.id);
    }
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
