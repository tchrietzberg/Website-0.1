const { allocateNumber, audit } = require('../db');
const customFields = require('./customFields');
const matterIndex = require('./matterIndex');

const NAME_SEP = ' - ';

function formatBuiltInStatus(status) {
  const s = String(status || '').trim();
  if (s === 'open') return 'Open';
  if (s === 'closed') return 'Closed';
  return s;
}

function yearFromOpenedOn(openedOn) {
  const y = String(openedOn || '').trim().slice(0, 4);
  return /^\d{4}$/.test(y) ? y : '';
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

/** Strip managed " - Status - Year" (and legacy em-dash) suffixes. */
function stripNameDecorations(name) {
  let base = String(name || '').trim();
  // Name - Status - 2026  (or em dash)
  let m = base.match(/^(.*?)(?:\s+[—-]\s+.+?\s+[—-]\s+\d{4})$/);
  if (m) return m[1].trim();
  // Name - 2026
  m = base.match(/^(.*?)\s+[—-]\s+(\d{4})$/);
  if (m) return m[1].trim();
  // Legacy Name — Status
  m = base.match(/^(.*?)\s+[—-]\s+(.+)$/);
  if (m && !/^\d{4}$/.test(m[2].trim())) return m[1].trim();
  return base;
}

/** Matter Name - Status - Year */
function composeMatterName(baseName, statusLabel, openedOn) {
  const base = stripNameDecorations(baseName);
  const status = String(statusLabel || '').trim();
  const year = yearFromOpenedOn(openedOn);
  const parts = [base];
  if (status) parts.push(status);
  if (year) parts.push(year);
  return parts.filter(Boolean).join(NAME_SEP);
}

function customStatusValue(db, matterId, fieldId) {
  const row = db.prepare(`
    SELECT value_text FROM custom_field_values
    WHERE matter_id = ? AND field_id = ?
  `).get(matterId, fieldId);
  return row?.value_text == null ? '' : String(row.value_text).trim();
}

/** Prefer custom Status field value, else built-in open/closed. */
function currentStatusLabel(db, matter) {
  for (const field of statusCustomFields(db, matter)) {
    const text = customStatusValue(db, matter.id, field.id);
    if (text) return text;
  }
  return formatBuiltInStatus(matter.status);
}

/**
 * If status (built-in or a Status custom field) changed in this patch,
 * return the label to use in the matter name; otherwise null.
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
      const nextText = next == null ? '' : String(next).trim();
      const prevText = customStatusValue(db, matter.id, field.id);
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

function writeMatterName(db, actor, id, oldName, nextName) {
  if (!nextName || nextName === oldName) return false;
  db.prepare('UPDATE matters SET name = ? WHERE id = ?').run(nextName, id);
  db.prepare(`
    INSERT INTO matter_field_history(matter_id, field_name, old_value, new_value, changed_by)
    VALUES (?, 'name', ?, ?, ?)
  `).run(id, oldName, nextName, actor.id);
  return true;
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

  const initialStatus = formatBuiltInStatus(input.status || 'open');
  const displayName = composeMatterName(name, initialStatus, openedOn);

  const info = db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, status,
      responsible_attorney_id, opened_on)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    clientId,
    number,
    displayName,
    matterType,
    input.jurisdiction != null && input.jurisdiction !== '' ? String(input.jurisdiction) : null,
    input.court != null && input.court !== '' ? String(input.court) : null,
    String(input.status || 'open'),
    Number.isFinite(attorneyId) ? attorneyId : null,
    openedOn
  );
  const id = Number(info.lastInsertRowid);

  if (input.customValues) {
    customFields.setCustomValues(db, actor, id, input.customValues);
    const matterRow = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
    const statusLabel = currentStatusLabel(db, matterRow) || initialStatus;
    const nextName = composeMatterName(name, statusLabel, openedOn);
    writeMatterName(db, actor, id, matterRow.name, nextName);
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
  const openedOnChanging = patch.openedOn !== undefined
    && String(patch.openedOn || '').slice(0, 10) !== String(current.opened_on || '').slice(0, 10);
  const nameChanging = patch.name !== undefined
    && stripNameDecorations(patch.name) !== stripNameDecorations(current.name);

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
    // Name is rewritten below into Name - Status - Year; skip raw overwrite here
    // when we will recompose, unless status/year are unchanged and only name base changes.
    if (key === 'name' && (statusForName != null || openedOnChanging)) continue;
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

  // Keep matter name as: Matter Name - Status - Year
  if (statusForName != null || openedOnChanging || nameChanging) {
    const after = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
    const baseName = patch.name !== undefined ? String(patch.name) : after.name;
    const statusLabel = statusForName != null
      ? statusForName
      : currentStatusLabel(db, after);
    const openedOn = after.opened_on;
    const nextName = composeMatterName(baseName, statusLabel, openedOn);
    writeMatterName(db, actor, id, after.name, nextName);
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
