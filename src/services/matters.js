const { allocateNumber, audit, getSetting, setSetting } = require('../db');
const customFields = require('./customFields');
const matterIndex = require('./matterIndex');
const permissions = require('./permissions');

const NAME_SEP = ' - ';
const MATTER_NAME_FORMULA_SETTING = 'matter_name_formula';
const DEFAULT_MATTER_NAME_FORMULA = {
  enabled: false,
  separator: '-',
  parts: [],
  appendStatusYear: false,
};

function normalizeFormulaParts(parts) {
  if (!Array.isArray(parts)) return [];
  const out = [];
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const kind = String(raw.kind || (raw.fieldId != null ? 'custom_field' : '')).trim();
    if (kind === 'token') {
      const token = String(raw.token || '').trim().toLowerCase();
      if (token === 'opened_year' || token === 'year') {
        out.push({ kind: 'token', token: 'opened_year' });
      }
      continue;
    }
    if (kind === 'custom_field' || raw.fieldId != null) {
      const fieldId = Number(raw.fieldId);
      if (Number.isFinite(fieldId) && fieldId > 0) {
        out.push({ kind: 'custom_field', fieldId });
      }
    }
  }
  return out;
}

function getMatterNameFormula(db) {
  const raw = getSetting(db, MATTER_NAME_FORMULA_SETTING, null);
  if (raw == null || raw === '') {
    return { ...DEFAULT_MATTER_NAME_FORMULA, parts: [] };
  }
  try {
    const parsed = JSON.parse(raw) || {};
    const separator = String(parsed.separator ?? '-');
    return {
      enabled: !!parsed.enabled,
      separator: separator.length ? separator : '-',
      parts: normalizeFormulaParts(parsed.parts),
      appendStatusYear: !!parsed.appendStatusYear,
    };
  } catch {
    return { ...DEFAULT_MATTER_NAME_FORMULA, parts: [] };
  }
}

function setMatterNameFormula(db, actor, input = {}) {
  const current = getMatterNameFormula(db);
  const next = {
    enabled: input.enabled !== undefined ? !!input.enabled : current.enabled,
    separator: input.separator !== undefined
      ? (String(input.separator ?? '-').length ? String(input.separator) : '-')
      : current.separator,
    parts: input.parts !== undefined ? normalizeFormulaParts(input.parts) : current.parts,
    appendStatusYear: input.appendStatusYear !== undefined
      ? !!input.appendStatusYear
      : current.appendStatusYear,
  };

  // Keep only active matter custom fields in the formula.
  next.parts = next.parts.filter((part) => {
    if (part.kind !== 'custom_field') return true;
    const field = db.prepare(`
      SELECT id FROM custom_fields
      WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'matter'
    `).get(part.fieldId);
    return !!field;
  });

  setSetting(db, MATTER_NAME_FORMULA_SETTING, JSON.stringify(next));
  audit(db, {
    actorId: actor?.id || null,
    action: 'matter_name_formula.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: next,
  });
  return getMatterNameFormulaConfig(db);
}

function formulaPartLabel(part, fieldRow) {
  if (part.kind === 'token' && part.token === 'opened_year') return 'Year';
  return fieldRow?.label || `Field ${part.fieldId}`;
}

function summarizeFormulaField(f) {
  if (!f) return null;
  return {
    id: f.id,
    label: f.label,
    fieldType: f.field_type || f.fieldType,
    recordTypeKey: f.record_type_key || null,
    required: !!f.required,
    isDefault: !!f.isDefault,
  };
}

function getMatterNameFormulaConfig(db) {
  const formula = getMatterNameFormula(db);
  // All firm/type matter fields (not matter-only), for the Settings picker.
  const availableFields = db.prepare(`
    SELECT id FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = 'matter'
      AND matter_id IS NULL
    ORDER BY label COLLATE NOCASE, id
  `).all()
    .map((row) => summarizeFormulaField(customFields.getCustomField(db, row.id)))
    .filter(Boolean);
  const byId = new Map(availableFields.map((f) => [f.id, f]));
  const parts = formula.parts.map((part) => {
    if (part.kind === 'token') {
      return { ...part, label: formulaPartLabel(part) };
    }
    const field = byId.get(part.fieldId)
      || summarizeFormulaField(customFields.getCustomField(db, part.fieldId));
    return {
      ...part,
      label: formulaPartLabel(part, field),
      field: field || null,
    };
  });
  const preview = parts.map((p) => p.label || '?').join(formula.separator || '-');
  return {
    ...formula,
    parts,
    availableFields,
    previewExample: preview || 'Ticker-Year-Company Name-Case Type',
  };
}

function customValueText(customValues, fieldId) {
  if (!customValues || typeof customValues !== 'object') return '';
  const raw = customValues[fieldId] ?? customValues[String(fieldId)];
  if (raw == null) return '';
  return String(raw).trim();
}

/** Build a matter name from the firm formula and create-time values. */
function buildNameFromFormula(db, formula, {
  customValues = {},
  openedOn = null,
  requireAll = true,
} = {}) {
  const cfg = formula && typeof formula === 'object' ? formula : getMatterNameFormula(db);
  if (!cfg.enabled || !cfg.parts?.length) return '';
  const sep = cfg.separator == null || cfg.separator === '' ? '-' : String(cfg.separator);
  const pieces = [];
  for (const part of cfg.parts) {
    let value = '';
    if (part.kind === 'token' && part.token === 'opened_year') {
      value = yearFromOpenedOn(openedOn || new Date().toISOString().slice(0, 10));
    } else if (part.kind === 'custom_field') {
      value = customValueText(customValues, part.fieldId);
      if (!value && requireAll) {
        const field = customFields.getCustomField(db, part.fieldId);
        throw new Error(`${field?.label || 'Name field'} is required for the matter name`);
      }
    }
    if (value) pieces.push(value);
  }
  return pieces.join(sep);
}

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

/** Case-insensitive match on the undecorated matter name (ignores Status - Year suffix). */
function findDuplicateMatter(db, name, { excludeId = null } = {}) {
  const base = stripNameDecorations(name).toLowerCase();
  if (!base) return null;
  const rows = db.prepare('SELECT id, name, number FROM matters').all();
  for (const row of rows) {
    if (excludeId != null && Number(row.id) === Number(excludeId)) continue;
    if (stripNameDecorations(row.name).toLowerCase() === base) return row;
  }
  return null;
}

function assertUniqueMatterName(db, name, { excludeId = null } = {}) {
  const dup = findDuplicateMatter(db, name, { excludeId });
  if (!dup) return;
  const label = stripNameDecorations(dup.name) || dup.name;
  throw new Error(
    `A matter named “${label}” already exists${dup.number ? ` (${dup.number})` : ''}`
  );
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
  permissions.assertCanModifyRecords(db, actor, 'matter');
  const formula = getMatterNameFormula(db);
  const formulaActive = formula.enabled && formula.parts.length > 0;
  const name = String(input.name || '').trim();

  const openedOn = String(input.openedOn || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const year = Number(openedOn.slice(0, 4));
  if (!Number.isFinite(year)) throw new Error('invalid openedOn');
  const number = allocateNumber(db, 'matter', year, '');
  customFields.ensureRecordTypes(db);

  const matterType = customFields.normalizeRecordTypeKey(
    db,
    input.recordTypeKey || input.matterType || customFields.DEFAULT_RECORD_TYPE_KEY
  );
  customFields.ensureTypeLayout(db, matterType);

  let clientId = input.clientId != null && input.clientId !== ''
    ? Number(input.clientId)
    : null;
  if (clientId != null) {
    if (!Number.isFinite(clientId) || clientId <= 0) {
      throw new Error('invalid client');
    }
    const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
    if (!client) throw new Error('client not found');
  } else {
    clientId = null;
  }

  const attorneyId = input.responsibleAttorneyId != null && input.responsibleAttorneyId !== ''
    ? Number(input.responsibleAttorneyId)
    : null;

  const initialStatus = formatBuiltInStatus(input.status || 'open');
  const customValues = input.customValues && typeof input.customValues === 'object'
    ? input.customValues
    : {};
  customFields.assertRequiredCustomValues(db, {
    appliesTo: 'matter',
    recordTypeKey: matterType,
    values: customValues,
  });

  let baseName = name;
  if (formulaActive) {
    baseName = buildNameFromFormula(db, formula, {
      customValues,
      openedOn,
      requireAll: true,
    });
  } else if (!baseName) {
    throw new Error('name required');
  }

  assertUniqueMatterName(db, baseName);

  const displayName = formulaActive && !formula.appendStatusYear
    ? baseName
    : composeMatterName(baseName, initialStatus, openedOn);

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

  // Always run so Auto Number fields allocate even when the form omits them.
  customFields.setCustomValues(db, actor, id, customValues);
  if (Object.keys(customValues).length || formulaActive) {
    const matterRow = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
    const statusLabel = currentStatusLabel(db, matterRow) || initialStatus;
    let nextName;
    if (formulaActive) {
      nextName = buildNameFromFormula(db, formula, {
        customValues,
        openedOn,
        requireAll: true,
      });
      if (formula.appendStatusYear) {
        nextName = composeMatterName(nextName, statusLabel, openedOn);
      }
    } else {
      nextName = composeMatterName(name, statusLabel, openedOn);
    }
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
  return getMatter(db, id, actor);
}

function updateMatter(db, actor, id, patch) {
  permissions.assertCanModifyRecords(db, actor, 'matter');
  const current = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
  if (!current) throw new Error('matter not found');
  permissions.assertCanWriteMatterFields(db, actor, patch);

  // Record type is chosen at create and stays fixed afterward.
  if (patch.matterType != null) delete patch.matterType;
  if (patch.recordTypeKey != null) delete patch.recordTypeKey;

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
      if (key === 'clientId' && newVal != null) {
        const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(newVal);
        if (!client) throw new Error('client not found');
      }
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
    const existing = Object.fromEntries(
      db.prepare('SELECT field_id, value_text FROM custom_field_values WHERE matter_id = ?')
        .all(id)
        .map((v) => [v.field_id, v.value_text])
    );
    const merged = { ...existing, ...patch.customValues };
    customFields.assertRequiredCustomValues(db, {
      appliesTo: 'matter',
      recordTypeKey: current.matter_type,
      matterId: id,
      values: merged,
    });
    customFields.setCustomValues(db, actor, id, patch.customValues);
  }

  // Keep matter name as: Matter Name - Status - Year
  if (statusForName != null || openedOnChanging || nameChanging) {
    const after = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
    const baseName = patch.name !== undefined ? String(patch.name) : after.name;
    if (nameChanging) assertUniqueMatterName(db, baseName, { excludeId: id });
    const statusLabel = statusForName != null
      ? statusForName
      : currentStatusLabel(db, after);
    const openedOn = after.opened_on;
    const nextName = composeMatterName(baseName, statusLabel, openedOn);
    writeMatterName(db, actor, id, after.name, nextName);
  }

  matterIndex.indexMatter(db, id);

  audit(db, { actorId: actor.id, action: 'matter.update', entityType: 'matter', entityId: id, detail: patch });
  return getMatter(db, id, actor);
}

/** All matters (dropdowns / internal). */
function listMatters(db, filters = {}) {
  const status = filters.status || null;
  const matterType = filters.matterType || filters.recordType || null;
  const clientId = filters.clientId != null ? Number(filters.clientId) : null;

  return db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    LEFT JOIN clients c ON c.id = m.client_id
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

function getMatter(db, id, actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'matter');
  return customFields.getMatterPage(db, id, actor);
}

function deleteMatter(db, actor, id) {
  permissions.assertCanDeleteRecords(db, actor, 'matter');
  const current = db.prepare('SELECT * FROM matters WHERE id = ?').get(id);
  if (!current) throw new Error('matter not found');

  const timeCount = db.prepare(
    'SELECT COUNT(*) AS n FROM time_entries WHERE matter_id = ?'
  ).get(id)?.n || 0;
  if (timeCount > 0) {
    throw new Error(
      `Cannot delete “${current.name}” while ${timeCount} time entr${timeCount === 1 ? 'y' : 'ies'} still reference this matter`
    );
  }

  const invoiceCount = db.prepare(
    'SELECT COUNT(*) AS n FROM invoices WHERE matter_id = ?'
  ).get(id)?.n || 0;
  if (invoiceCount > 0) {
    throw new Error(
      `Cannot delete “${current.name}” while ${invoiceCount} invoice${invoiceCount === 1 ? '' : 's'} still reference this matter`
    );
  }

  db.prepare('DELETE FROM matter_field_history WHERE matter_id = ?').run(id);
  db.prepare('DELETE FROM custom_field_values WHERE matter_id = ?').run(id);
  db.prepare('DELETE FROM matter_onedrive_items WHERE matter_id = ?').run(id);
  db.prepare('DELETE FROM matter_onedrive WHERE matter_id = ?').run(id);
  db.prepare('DELETE FROM rates WHERE scope = ? AND scope_id = ?').run('matter', id);

  const matterLayouts = db.prepare(
    'SELECT id FROM page_layouts WHERE matter_id = ?'
  ).all(id);
  for (const layout of matterLayouts) {
    db.prepare('DELETE FROM page_layout_items WHERE layout_id = ?').run(layout.id);
  }
  db.prepare('DELETE FROM page_layouts WHERE matter_id = ?').run(id);
  db.prepare('UPDATE custom_fields SET matter_id = NULL, active = 0 WHERE matter_id = ?').run(id);

  matterIndex.removeMatterFromIndex(db, id);
  db.prepare('DELETE FROM matters WHERE id = ?').run(id);

  audit(db, {
    actorId: actor?.id || null,
    action: 'matter.delete',
    entityType: 'matter',
    entityId: id,
    detail: { name: current.name, number: current.number },
  });
  return { ok: true, id: Number(id), name: current.name, number: current.number };
}

function listClients(db) {
  return require('./clients').listClients(db);
}

module.exports = {
  createMatter,
  updateMatter,
  deleteMatter,
  listMatters,
  searchMatters,
  listClients,
  getMatter,
  getMatterNameFormula,
  setMatterNameFormula,
  getMatterNameFormulaConfig,
  buildNameFromFormula,
  stripNameDecorations,
  findDuplicateMatter,
  MATTER_NAME_FORMULA_SETTING,
};
