const { audit } = require('../db');
const matterIndex = require('./matterIndex');
const fieldTypes = require('./fieldTypes');

/** Seeded default matter record types. Firms can add more via createRecordType. */
const RECORD_TYPES = [
  { key: 'billable', label: 'Billable' },
  { key: 'non_billable', label: 'Non-Billable' },
  { key: 'do_not_charge', label: 'Do not charge' },
];
/** Seeded default contact record types. */
const CONTACT_RECORD_TYPES = [
  { key: 'client', label: 'Client' },
  { key: 'company', label: 'Company' },
];
const DEFAULT_RECORD_TYPE_KEY = 'billable';
const DEFAULT_RECORD_TYPE_LABEL = 'Billable';
const DEFAULT_CONTACT_RECORD_TYPE_KEY = 'client';
const DEFAULT_CONTACT_RECORD_TYPE_LABEL = 'Client';
const KNOWN_RECORD_TYPE_KEYS = RECORD_TYPES.map((t) => t.key);
/** Old keys remapped onto Billable; firm-added types are preserved. */
const LEGACY_RECORD_TYPE_KEYS = ['default', 'litigation', 'sw_admin', 'other'];
/** Old contact type key remapped onto Client. */
const LEGACY_CONTACT_RECORD_TYPE_KEYS = ['person'];

const STANDARD_FIELDS = [
  { key: 'std:number', label: 'Matter number', type: 'text', readonly: true, width: 'half' },
  { key: 'std:name', label: 'Matter name', type: 'text', width: 'full' },
  { key: 'std:client', label: 'Client', type: 'select', width: 'half' },
  { key: 'std:matter_type', label: 'Record type', type: 'select',
    options: KNOWN_RECORD_TYPE_KEYS, width: 'half', readonly: true },
  { key: 'std:status', label: 'Status', type: 'select', options: ['open', 'closed'], width: 'half' },
  { key: 'std:jurisdiction', label: 'Jurisdiction', type: 'text', width: 'half' },
  { key: 'std:court', label: 'Court', type: 'text', width: 'half' },
  { key: 'std:responsible_attorney', label: 'Responsible attorney', type: 'select', width: 'half' },
  { key: 'std:opened_on', label: 'Opened on', type: 'date', width: 'half' },
];

/** Contact type layout built-ins (name only). */
const CONTACT_LAYOUT_FIELDS = [
  { key: 'std:name', label: 'Name', type: 'text', width: 'half' },
];

/** Shown on every new matter / type layout. */
const CORE_LAYOUT_KEYS = ['std:number', 'std:name'];
/** Shown on every contact record type layout. */
const CONTACT_CORE_LAYOUT_KEYS = ['std:name'];

/** Record type is chosen at create; not offered as an addable layout field. */
const HIDDEN_STANDARD_KEYS = ['std:matter_type'];

/** Optional standard fields — add later on a matter record page. */
const OPTIONAL_STANDARD_KEYS = STANDARD_FIELDS
  .map((f) => f.key)
  .filter((key) => !CORE_LAYOUT_KEYS.includes(key) && !HIDDEN_STANDARD_KEYS.includes(key));

function recordTypeAppliesTo(db, recordTypeKey) {
  if (!recordTypeKey) return 'matter';
  const row = db.prepare(
    'SELECT applies_to FROM record_types WHERE key = ?'
  ).get(recordTypeKey);
  return row?.applies_to === 'client' ? 'client' : 'matter';
}

function coreLayoutKeysFor(appliesTo) {
  return appliesTo === 'client' ? CONTACT_CORE_LAYOUT_KEYS : CORE_LAYOUT_KEYS;
}

function fieldLabelForKey(db, fieldKey, appliesTo = 'matter') {
  if (fieldKey === 'std:name' && appliesTo === 'client') return 'Name';
  const contactStd = CONTACT_LAYOUT_FIELDS.find((f) => f.key === fieldKey);
  if (appliesTo === 'client' && contactStd) return contactStd.label;
  const std = STANDARD_FIELDS.find((f) => f.key === fieldKey);
  if (std) return std.label;
  if (String(fieldKey).startsWith('cf:')) {
    const id = Number(String(fieldKey).slice(3));
    const f = db.prepare('SELECT label FROM custom_fields WHERE id = ?').get(id);
    return f?.label || fieldKey;
  }
  return fieldKey;
}

function describeLayoutFields(db, layoutId) {
  const layout = db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
  const appliesTo = recordTypeAppliesTo(db, layout?.record_type_key);
  const coreKeys = coreLayoutKeysFor(appliesTo);
  return layoutItems(db, layoutId).map((item) => {
    const isCustom = String(item.field_key).startsWith('cf:');
    let required = false;
    let isDefault = false;
    let fieldId = null;
    let fieldType = null;
    let options = null;
    if (isCustom) {
      fieldId = Number(String(item.field_key).slice(3));
      const row = getCustomField(db, fieldId);
      if (row) {
        required = !!row.required;
        isDefault = !!row.isDefault;
        fieldType = row.field_type;
        options = row.options;
      }
    }
    return {
      fieldKey: item.field_key,
      label: fieldLabelForKey(db, item.field_key, appliesTo),
      width: item.width,
      section: item.section,
      removable: !coreKeys.includes(item.field_key),
      kind: isCustom ? 'custom' : 'standard',
      required,
      isDefault,
      is_default: isDefault ? 1 : 0,
      fieldId,
      fieldType,
      type: fieldType,
      options,
      scope: 'record_type',
    };
  });
}

function isBlankCustomValue(field, value) {
  return fieldTypes.isBlankCustomValue(field, value);
}

/** Ensure all required custom fields for the scope have non-blank values. */
function assertRequiredCustomValues(db, {
  appliesTo = 'matter',
  matterId = null,
  clientId = null,
  recordTypeKey = null,
  values = {},
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  let fields;
  if (target === 'time_entry') {
    fields = listCustomFields(db, { appliesTo: target });
  } else if (target === 'client') {
    fields = listCustomFields(db, {
      appliesTo: 'client',
      recordTypeKey: recordTypeKey || DEFAULT_CONTACT_RECORD_TYPE_KEY,
      clientId: clientId != null ? Number(clientId) : null,
    });
  } else {
    fields = listCustomFields(db, {
      recordTypeKey: recordTypeKey || DEFAULT_RECORD_TYPE_KEY,
      matterId: matterId != null ? Number(matterId) : null,
      appliesTo: 'matter',
    });
  }
  const required = fields.filter((f) => !!f.required
    && !fieldTypes.isSystemManagedFieldType(f.field_type || f.fieldType));
  const missing = [];
  for (const f of required) {
    const raw = values[f.id] !== undefined ? values[f.id] : values[String(f.id)];
    if (isBlankCustomValue(f, raw)) missing.push(f.label);
  }
  if (missing.length) {
    throw new Error(
      `Required field${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
    );
  }
}

/** Fill auto-numbers (and drop user edits to formula fields) before save. */
function prepareCustomValuesForSave(db, fields, values = {}) {
  const out = {};
  const incoming = values && typeof values === 'object' ? values : {};
  const readIncoming = (id) => {
    if (incoming[id] !== undefined) return incoming[id];
    if (incoming[String(id)] !== undefined) return incoming[String(id)];
    return undefined;
  };
  for (const f of fields || []) {
    const type = fieldTypes.normalizeFieldType(f.field_type || f.fieldType);
    const id = Number(f.id);
    if (!Number.isFinite(id)) continue;
    if (type === 'formula') continue;
    if (type === 'auto_number') {
      const cur = readIncoming(id);
      if (isBlankCustomValue(f, cur)) {
        const row = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
        if (row) out[id] = fieldTypes.allocateAutoNumber(db, row);
      } else {
        out[id] = String(cur);
      }
      continue;
    }
    const raw = readIncoming(id);
    if (raw === undefined) continue;
    out[id] = fieldTypes.normalizeCustomValue(
      {
        ...f,
        options_json: f.options_json
          || (f.options != null ? JSON.stringify(f.options) : null),
      },
      raw
    );
  }
  return out;
}

function upsertRecordTypeRow(db, key, label, appliesTo = 'matter') {
  const entity = normalizeAppliesTo(appliesTo) === 'client' ? 'client' : 'matter';
  db.prepare(`
    INSERT INTO record_types(key, label, applies_to, active) VALUES (?, ?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET
      label = excluded.label,
      active = 1,
      applies_to = COALESCE(record_types.applies_to, excluded.applies_to)
  `).run(key, label, entity);
}

function createTypeLayoutRow(db, recordTypeKey) {
  let layout = db.prepare(
    'SELECT * FROM page_layouts WHERE record_type_key = ? AND matter_id IS NULL'
  ).get(recordTypeKey);
  if (layout) return layout;

  const appliesTo = recordTypeAppliesTo(db, recordTypeKey);
  const coreKeys = coreLayoutKeysFor(appliesTo);
  const info = db.prepare(`
    INSERT INTO page_layouts(record_type_key, matter_id, name) VALUES (?, NULL, 'Default')
  `).run(recordTypeKey);
  const layoutId = Number(info.lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
    VALUES (?, ?, 'details', ?, ?)
  `);
  coreKeys.forEach((key, i) => {
    const std = appliesTo === 'client'
      ? CONTACT_LAYOUT_FIELDS.find((f) => f.key === key)
      : STANDARD_FIELDS.find((f) => f.key === key);
    insert.run(layoutId, key, i, std?.width || 'half');
  });
  return db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
}

/** Move matters/fields/layout items from one type key onto another, then drop the old type. */
function remapRecordTypeKey(db, fromKey, toKey) {
  if (fromKey === toKey) return;
  const fromType = db.prepare('SELECT key, applies_to FROM record_types WHERE key = ?').get(fromKey);
  if (!fromType) return;
  const appliesTo = fromType.applies_to === 'client' ? 'client' : 'matter';
  const label = (appliesTo === 'client' ? CONTACT_RECORD_TYPES : RECORD_TYPES)
    .find((t) => t.key === toKey)?.label || toKey;
  upsertRecordTypeRow(db, toKey, label, appliesTo);
  createTypeLayoutRow(db, toKey);

  db.prepare('UPDATE matters SET matter_type = ? WHERE matter_type = ?').run(toKey, fromKey);
  const clientCols = db.prepare('PRAGMA table_info(clients)').all().map((c) => c.name);
  if (clientCols.includes('record_type')) {
    db.prepare('UPDATE clients SET record_type = ? WHERE record_type = ?').run(toKey, fromKey);
  }
  db.prepare(`
    UPDATE custom_fields SET record_type_key = ? WHERE record_type_key = ?
  `).run(toKey, fromKey);

  const fromLayout = db.prepare(`
    SELECT id FROM page_layouts WHERE record_type_key = ? AND matter_id IS NULL
  `).get(fromKey);
  const toLayout = db.prepare(`
    SELECT id FROM page_layouts WHERE record_type_key = ? AND matter_id IS NULL
  `).get(toKey);
  if (fromLayout && toLayout && fromLayout.id !== toLayout.id) {
    const items = db.prepare(
      'SELECT field_key, width FROM page_layout_items WHERE layout_id = ?'
    ).all(fromLayout.id);
    for (const item of items) {
      addFieldToLayout(db, toLayout.id, item.field_key, item.width || 'half');
    }
    db.prepare('DELETE FROM page_layout_items WHERE layout_id = ?').run(fromLayout.id);
    db.prepare('DELETE FROM page_layouts WHERE id = ?').run(fromLayout.id);
  }

  db.prepare('DELETE FROM record_types WHERE key = ?').run(fromKey);
}

function ensureRecordTypes(db) {
  for (const t of RECORD_TYPES) {
    upsertRecordTypeRow(db, t.key, t.label, 'matter');
  }
  for (const t of CONTACT_RECORD_TYPES) {
    upsertRecordTypeRow(db, t.key, t.label, 'client');
  }

  // Remap only known legacy keys onto Billable; keep firm-added types.
  for (const fromKey of LEGACY_RECORD_TYPE_KEYS) {
    if (db.prepare('SELECT key FROM record_types WHERE key = ?').get(fromKey)) {
      remapRecordTypeKey(db, fromKey, DEFAULT_RECORD_TYPE_KEY);
    }
  }
  // Remap Person → Client for contacts.
  for (const fromKey of LEGACY_CONTACT_RECORD_TYPE_KEYS) {
    if (db.prepare(`
      SELECT key FROM record_types
      WHERE key = ? AND IFNULL(applies_to, 'matter') = 'client'
    `).get(fromKey)) {
      remapRecordTypeKey(db, fromKey, DEFAULT_CONTACT_RECORD_TYPE_KEY);
    }
  }

  // Orphaned matter/field keys with no matching type → Billable
  db.prepare(`
    UPDATE matters SET matter_type = ?
    WHERE matter_type NOT IN (SELECT key FROM record_types WHERE IFNULL(applies_to, 'matter') = 'matter')
  `).run(DEFAULT_RECORD_TYPE_KEY);
  db.prepare(`
    UPDATE custom_fields SET record_type_key = ?
    WHERE record_type_key IS NOT NULL
      AND IFNULL(applies_to, 'matter') = 'matter'
      AND record_type_key NOT IN (SELECT key FROM record_types WHERE IFNULL(applies_to, 'matter') = 'matter')
  `).run(DEFAULT_RECORD_TYPE_KEY);

  const clientCols = db.prepare("PRAGMA table_info(clients)").all().map((c) => c.name);
  if (clientCols.includes('record_type')) {
    db.prepare(`
      UPDATE clients SET record_type = ?
      WHERE record_type IS NULL
         OR record_type = ''
         OR record_type NOT IN (
           SELECT key FROM record_types WHERE IFNULL(applies_to, 'matter') = 'client'
         )
    `).run(DEFAULT_CONTACT_RECORD_TYPE_KEY);
  }

  const types = db.prepare('SELECT key FROM record_types WHERE active = 1').all();
  for (const t of types) {
    createTypeLayoutRow(db, t.key);
  }
}

function createRecordType(db, actor, input = {}) {
  ensureRecordTypes(db);
  const appliesTo = normalizeAppliesTo(input.appliesTo || input.applies_to || 'matter');
  if (appliesTo === 'time_entry') throw new Error('record types are for matters or contacts');
  const label = String(input.label || '').trim();
  if (!label) throw new Error('label required');
  let key = String(input.key || slugify(label)).trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]*$/.test(key)) {
    throw new Error('key must be snake_case starting with a letter');
  }
  if (appliesTo === 'matter' && LEGACY_RECORD_TYPE_KEYS.includes(key)) {
    throw new Error('reserved record type key');
  }
  const existing = db.prepare('SELECT key FROM record_types WHERE key = ?').get(key);
  if (existing) throw new Error('record type already exists');

  upsertRecordTypeRow(db, key, label, appliesTo);
  createTypeLayoutRow(db, key);
  audit(db, {
    actorId: actor?.id || null,
    action: 'record_type.create',
    entityType: 'record_type',
    entityId: null,
    detail: { key, label, appliesTo },
  });
  return db.prepare('SELECT * FROM record_types WHERE key = ?').get(key);
}

function normalizeRecordTypeKey(db, key, { required = false, appliesTo = 'matter' } = {}) {
  ensureRecordTypes(db);
  const entity = normalizeAppliesTo(appliesTo) === 'client' ? 'client' : 'matter';
  const defaultKey = entity === 'client'
    ? DEFAULT_CONTACT_RECORD_TYPE_KEY
    : DEFAULT_RECORD_TYPE_KEY;
  let raw = key == null || key === '' ? null : String(key).trim();
  if (!raw) {
    if (required) throw new Error('record type required');
    return defaultKey;
  }
  // Legacy aliases
  if (entity === 'matter' && raw === 'default') raw = DEFAULT_RECORD_TYPE_KEY;
  if (entity === 'client' && raw === 'person') raw = DEFAULT_CONTACT_RECORD_TYPE_KEY;
  const row = db.prepare(`
    SELECT key FROM record_types
    WHERE key = ? AND active = 1 AND IFNULL(applies_to, 'matter') = ?
  `).get(raw, entity);
  if (!row) throw new Error('unknown record type');
  return row.key;
}

function ensureTypeLayout(db, recordTypeKey) {
  const appliesTo = recordTypeAppliesTo(db, recordTypeKey);
  const key = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo });
  return createTypeLayoutRow(db, key);
}

function getTypeLayout(db, recordTypeKey) {
  ensureRecordTypes(db);
  const type = db.prepare(
    'SELECT * FROM record_types WHERE key = ? AND active = 1'
  ).get(recordTypeKey);
  if (!type) throw new Error('unknown record type');
  const appliesTo = type.applies_to === 'client' ? 'client' : 'matter';
  const key = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo });
  const layout = ensureTypeLayout(db, key);
  const fields = describeLayoutFields(db, layout.id);
  const present = new Set(fields.map((f) => f.fieldKey));
  const availableStandardFields = appliesTo === 'client'
    ? []
    : STANDARD_FIELDS
      .filter((f) => OPTIONAL_STANDARD_KEYS.includes(f.key) && !present.has(f.key))
      .map((f) => ({ ...f, kind: 'standard' }));
  return {
    recordTypeKey: key,
    label: type?.label || key,
    appliesTo,
    layout: { id: layout.id, name: layout.name, source: 'record_type' },
    fields,
    availableStandardFields,
    customFields: listCustomFields(db, {
      recordTypeKey: key,
      appliesTo,
    }),
  };
}

function addFieldToLayout(db, layoutId, fieldKey, width = 'half') {
  const existing = db.prepare(
    'SELECT id FROM page_layout_items WHERE layout_id = ? AND field_key = ?'
  ).get(layoutId, fieldKey);
  if (existing) return false;
  const max = db.prepare(
    'SELECT COALESCE(MAX(sort_order), -1) AS m FROM page_layout_items WHERE layout_id = ?'
  ).get(layoutId).m;
  db.prepare(`
    INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
    VALUES (?, ?, 'details', ?, ?)
  `).run(layoutId, fieldKey, max + 1, width);
  return true;
}

function addStandardFieldToType(db, actor, recordTypeKey, fieldKey) {
  const appliesTo = recordTypeAppliesTo(db, recordTypeKey);
  if (appliesTo === 'client') throw new Error('field cannot be added');
  const key = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo });
  if (!OPTIONAL_STANDARD_KEYS.includes(fieldKey)) throw new Error('field cannot be added');
  const std = STANDARD_FIELDS.find((f) => f.key === fieldKey);
  if (!std) throw new Error('unknown field');
  const layout = ensureTypeLayout(db, key);
  addFieldToLayout(db, layout.id, fieldKey, std.width || 'half');
  audit(db, {
    actorId: actor.id,
    action: 'type.layout.add_field',
    entityType: 'record_type',
    entityId: null,
    detail: { recordTypeKey: key, fieldKey },
  });
  return getTypeLayout(db, key);
}

function removeFieldFromType(db, actor, recordTypeKey, fieldKey) {
  const appliesTo = recordTypeAppliesTo(db, recordTypeKey);
  const key = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo });
  const coreKeys = coreLayoutKeysFor(appliesTo);
  if (coreKeys.includes(fieldKey)) throw new Error('core fields cannot be removed');
  const layout = ensureTypeLayout(db, key);
  db.prepare(
    'DELETE FROM page_layout_items WHERE layout_id = ? AND field_key = ?'
  ).run(layout.id, fieldKey);
  if (String(fieldKey).startsWith('cf:')) {
    const id = Number(String(fieldKey).slice(3));
    const field = db.prepare(
      'SELECT * FROM custom_fields WHERE id = ? AND record_type_key = ? AND matter_id IS NULL'
    ).get(id, key);
    if (field) {
      db.prepare('UPDATE custom_fields SET active = 0 WHERE id = ?').run(id);
    }
  }
  audit(db, {
    actorId: actor.id,
    action: 'type.layout.remove_field',
    entityType: 'record_type',
    entityId: null,
    detail: { recordTypeKey: key, fieldKey },
  });
  return getTypeLayout(db, key);
}

function listRecordTypes(db, { appliesTo = 'matter' } = {}) {
  ensureRecordTypes(db);
  const entity = normalizeAppliesTo(appliesTo) === 'client' ? 'client' : 'matter';
  return db.prepare(`
    SELECT * FROM record_types
    WHERE active = 1 AND IFNULL(applies_to, 'matter') = ?
    ORDER BY CASE key
      WHEN 'billable' THEN 0
      WHEN 'non_billable' THEN 1
      WHEN 'do_not_charge' THEN 2
      WHEN 'client' THEN 0
      WHEN 'company' THEN 1
      ELSE 3
    END, label
  `).all(entity);
}

function slugify(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `field_${Date.now()}`;
}

function normalizeFieldLabelKey(label) {
  return String(label || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/** Built-in labels that custom fields must not reuse for each object. */
function reservedFieldLabels(appliesTo) {
  const target = normalizeAppliesTo(appliesTo);
  if (target === 'client') {
    return CONTACT_LAYOUT_FIELDS.map((f) => normalizeFieldLabelKey(f.label));
  }
  if (target === 'time_entry') {
    return ['date', 'hours', 'timekeeper', 'billable', 'description'];
  }
  // Status may be a custom picklist used in matter naming; allow that label once.
  return STANDARD_FIELDS
    .filter((f) => f.key !== 'std:status')
    .map((f) => normalizeFieldLabelKey(f.label));
}

/**
 * Reject duplicate field labels / api names within an object (matter, contact,
 * or time entry) at every scope — type defaults, record-only, and firm-wide.
 */
function assertUniqueCustomFieldName(db, {
  label,
  apiName = null,
  appliesTo = 'matter',
  excludeId = null,
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  const labelKey = normalizeFieldLabelKey(label);
  if (!labelKey) throw new Error('label required');

  if (reservedFieldLabels(target).includes(labelKey)) {
    throw new Error(`A built-in field named “${String(label).trim()}” already exists`);
  }

  const rows = db.prepare(`
    SELECT id, label, api_name
    FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = ?
      AND (? IS NULL OR id != ?)
  `).all(target, excludeId, excludeId);

  for (const row of rows) {
    if (normalizeFieldLabelKey(row.label) === labelKey) {
      throw new Error(`A field named “${String(label).trim()}” already exists`);
    }
  }

  const api = apiName != null ? String(apiName).trim().toLowerCase() : '';
  if (api) {
    for (const row of rows) {
      if (String(row.api_name || '').toLowerCase() === api) {
        throw new Error(`A field named “${String(label).trim()}” already exists`);
      }
    }
  }
}

function normalizeAppliesTo(value) {
  const v = String(value || 'matter').trim().toLowerCase();
  if (v === 'time' || v === 'time_entry' || v === 'time-entry') return 'time_entry';
  if (v === 'client' || v === 'contact' || v === 'contacts') return 'client';
  return 'matter';
}

function normalizeFieldType(fieldType) {
  return fieldTypes.normalizeFieldType(fieldType);
}

function parseFieldOptions(input) {
  return fieldTypes.parseFieldOptions(input);
}

function createCustomField(db, actor, input) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('label required');
  const fieldType = normalizeFieldType(input.fieldType || input.field_type || 'text');
  if (!fieldTypes.isAllowedFieldType(fieldType)) {
    throw new Error('invalid fieldType');
  }
  let options;
  try {
    options = fieldTypes.encodeFieldOptions(fieldType, input, null);
  } catch (e) {
    throw e;
  }

  let appliesTo = normalizeAppliesTo(input.appliesTo || input.applies_to || 'matter');
  let recordTypeKey = input.recordTypeKey || input.record_type_key || null;
  let matterId = input.matterId != null ? Number(input.matterId) : null;
  let clientId = input.clientId != null ? Number(input.clientId)
    : (input.client_id != null ? Number(input.client_id) : null);

  if (appliesTo === 'time_entry') {
    // Firm-wide time-entry fields — not tied to a record type layout.
    recordTypeKey = null;
    matterId = null;
    clientId = null;
  } else if (clientId || appliesTo === 'client') {
    matterId = null;
    if (clientId) {
      const c = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
      if (!c) throw new Error('contact not found');
      recordTypeKey = null; // contact-only (not type-dependent)
      appliesTo = 'client';
    } else if (recordTypeKey) {
      recordTypeKey = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo: 'client' });
      clientId = null;
      appliesTo = 'client';
    } else {
      // Firm-wide contact field when type omitted (legacy / shared across types).
      recordTypeKey = null;
      clientId = null;
      appliesTo = 'client';
    }
  } else if (matterId) {
    const m = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
    if (!m) throw new Error('matter not found');
    recordTypeKey = null; // record-based
    clientId = null;
    appliesTo = 'matter';
  } else if (recordTypeKey) {
    recordTypeKey = normalizeRecordTypeKey(db, recordTypeKey, { appliesTo: 'matter' });
    clientId = null;
    appliesTo = 'matter';
  } else {
    // Default (Billable) type field when scope omitted
    recordTypeKey = normalizeRecordTypeKey(db, DEFAULT_RECORD_TYPE_KEY, { appliesTo: 'matter' });
    clientId = null;
    appliesTo = 'matter';
  }

  if (!fieldTypes.isAllowedFieldTypeForAppliesTo(fieldType, appliesTo)) {
    throw new Error(
      appliesTo === 'time_entry'
        ? 'That field type is not available for time entry fields'
        : 'invalid fieldType for this object'
    );
  }

  // Default / record-type matter fields are admin-managed (Settings → Matter page).
  if (appliesTo === 'matter' && recordTypeKey && !matterId && actor?.role !== 'admin') {
    const err = new Error('Only admins can add default matter fields');
    err.code = 'FORBIDDEN';
    throw err;
  }

  let apiName = String(input.apiName || slugify(label));
  if (!/^[a-z][a-z0-9_]*$/.test(apiName)) {
    throw new Error('apiName must be snake_case starting with a letter');
  }

  assertUniqueCustomFieldName(db, {
    label,
    apiName,
    appliesTo,
  });

  // Contact/matter record-only fields are never "default on type"
  const allowDefault = !matterId && !clientId;
  const isDefault = allowDefault && (
    input.isDefault === true || input.isDefault === 1 || input.is_default === true
    || input.is_default === 1 || input.isDefault === 'on'
  )
    ? 1
    : 0;
  const required = fieldTypes.isSystemManagedFieldType(fieldType)
    ? 0
    : (input.required ? 1 : 0);

  const info = db.prepare(`
    INSERT INTO custom_fields(
      api_name, label, field_type, options_json, applies_to, record_type_key, matter_id,
      client_id, required, is_default, active, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    apiName,
    label,
    fieldType,
    options,
    appliesTo,
    recordTypeKey,
    matterId,
    clientId,
    required,
    isDefault,
    actor.id
  );
  const id = Number(info.lastInsertRowid);

  // Auto-add type-scoped fields to the relevant layout(s)
  if ((appliesTo === 'matter' || appliesTo === 'client') && recordTypeKey && !matterId && !clientId) {
    const width = fieldTypes.fieldWidthForType(fieldType);
    const fieldKey = `cf:${id}`;
    const layout = ensureTypeLayout(db, recordTypeKey);
    addFieldToLayout(db, layout.id, fieldKey, width);
    if (appliesTo === 'matter') {
      // Also attach to existing matter-specific layouts so the field appears on open matters.
      const matterLayouts = db.prepare(`
        SELECT pl.id
        FROM page_layouts pl
        JOIN matters m ON m.id = pl.matter_id
        WHERE pl.matter_id IS NOT NULL
          AND m.matter_type = ?
      `).all(recordTypeKey);
      for (const ml of matterLayouts) {
        addFieldToLayout(db, ml.id, fieldKey, width);
      }
    }
  }

  audit(db, {
    actorId: actor.id,
    action: 'custom_field.create',
    entityType: 'custom_field',
    entityId: id,
    detail: {
      apiName,
      label,
      recordTypeKey,
      matterId,
      clientId,
      appliesTo,
      required: !!(input.required ? 1 : 0),
      isDefault: !!isDefault,
    },
  });

  return getCustomField(db, id);
}

function getCustomField(db, id) {
  const f = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
  if (!f) return null;
  const appliesTo = f.applies_to || 'matter';
  const storedType = f.field_type;
  const fieldType = fieldTypes.uiFieldType(storedType);
  const isDefault = !!f.is_default;
  const decoded = fieldTypes.decodeFieldOptions(storedType, f.options_json);
  return {
    ...f,
    field_type: fieldType,
    fieldType,
    applies_to: appliesTo,
    appliesTo,
    is_default: isDefault ? 1 : 0,
    isDefault,
    options: fieldTypes.needsOptionList(storedType)
      ? decoded
      : (Array.isArray(decoded) ? decoded : null),
    config: decoded && !Array.isArray(decoded) ? decoded : null,
    expression: decoded && decoded.expression ? decoded.expression : null,
    prefix: decoded && decoded.prefix != null ? decoded.prefix : null,
    pad: decoded && decoded.pad != null ? decoded.pad : null,
    clientId: f.client_id != null ? Number(f.client_id) : null,
    scope: appliesTo === 'time_entry'
      ? 'time_entry'
      : appliesTo === 'client'
        ? (f.client_id ? 'record' : (f.record_type_key ? 'record_type' : 'client'))
        : (f.matter_id ? 'record' : (f.record_type_key ? 'record_type' : 'global')),
  };
}

function listCustomFields(db, {
  recordTypeKey = null,
  matterId = null,
  clientId = null,
  appliesTo = 'matter',
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  if (target === 'time_entry') {
    return db.prepare(`
      SELECT * FROM custom_fields
      WHERE active = 1
        AND IFNULL(applies_to, 'matter') = ?
      ORDER BY label, id
    `).all(target).map((f) => getCustomField(db, f.id));
  }
  if (target === 'client') {
    // Firm-wide (null type) ∪ selected contact record type ∪ this contact only.
    return db.prepare(`
      SELECT * FROM custom_fields
      WHERE active = 1
        AND IFNULL(applies_to, 'matter') = 'client'
        AND matter_id IS NULL
        AND (
          (
            client_id IS NULL
            AND (
              record_type_key IS NULL
              OR (? IS NOT NULL AND record_type_key = ?)
            )
          )
          OR (? IS NOT NULL AND client_id = ?)
        )
      ORDER BY label, id
    `).all(recordTypeKey, recordTypeKey, clientId, clientId).map((f) => getCustomField(db, f.id));
  }
  return db.prepare(`
    SELECT * FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = 'matter'
      AND client_id IS NULL
      AND (
        (matter_id IS NULL AND record_type_key IS NULL)
        OR (? IS NOT NULL AND record_type_key = ? AND matter_id IS NULL)
        OR (? IS NOT NULL AND matter_id = ?)
      )
    ORDER BY label
  `).all(recordTypeKey, recordTypeKey, matterId, matterId).map((f) => getCustomField(db, f.id));
}

function deactivateCustomField(db, actor, fieldId) {
  const field = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(fieldId);
  if (!field) throw new Error('field not found');
  db.prepare('UPDATE custom_fields SET active = 0 WHERE id = ?').run(fieldId);
  if ((field.applies_to || 'matter') === 'matter' || field.applies_to === 'client') {
    // Drop from layouts when this definition is retired
    db.prepare(`
      DELETE FROM page_layout_items WHERE field_key = ?
    `).run(`cf:${fieldId}`);
  }
  audit(db, {
    actorId: actor?.id || null,
    action: 'custom_field.deactivate',
    entityType: 'custom_field',
    entityId: fieldId,
    detail: { appliesTo: field.applies_to || 'matter' },
  });
  return { ok: true, id: fieldId };
}

function updateCustomField(db, actor, fieldId, patch = {}) {
  const existing = db.prepare(
    'SELECT * FROM custom_fields WHERE id = ? AND active = 1'
  ).get(fieldId);
  if (!existing) throw new Error('field not found');

  const appliesTo = normalizeAppliesTo(existing.applies_to || 'matter');
  let label = existing.label;
  if (patch.label !== undefined) {
    label = String(patch.label || '').trim();
    if (!label) throw new Error('label required');
  }
  if (normalizeFieldLabelKey(label) !== normalizeFieldLabelKey(existing.label)) {
    assertUniqueCustomFieldName(db, {
      label,
      apiName: existing.api_name,
      appliesTo,
      excludeId: fieldId,
    });
  }

  let fieldType = existing.field_type;
  if (patch.fieldType !== undefined || patch.field_type !== undefined) {
    fieldType = normalizeFieldType(patch.fieldType || patch.field_type);
    if (!fieldTypes.isAllowedFieldType(fieldType)) {
      throw new Error('invalid fieldType');
    }
    if (!fieldTypes.isAllowedFieldTypeForAppliesTo(fieldType, appliesTo)) {
      throw new Error(
        appliesTo === 'time_entry'
          ? 'That field type is not available for time entry fields'
          : 'invalid fieldType for this object'
      );
    }
  }

  let optionsJson = existing.options_json;
  const optionsTouched = patch.options !== undefined
    || patch.optionsText !== undefined
    || patch.expression !== undefined
    || patch.formula !== undefined
    || patch.prefix !== undefined
    || patch.autoNumberPrefix !== undefined
    || patch.pad !== undefined
    || patch.autoNumberPad !== undefined
    || patch.next !== undefined
    || fieldType !== existing.field_type;
  if (optionsTouched) {
    optionsJson = fieldTypes.encodeFieldOptions(fieldType, patch, existing.options_json);
  } else if (
    !fieldTypes.needsOptionList(fieldType)
    && fieldType !== 'auto_number'
    && fieldType !== 'formula'
  ) {
    optionsJson = null;
  }

  let required = existing.required ? 1 : 0;
  if (fieldTypes.isSystemManagedFieldType(fieldType)) {
    required = 0;
  } else if (patch.required !== undefined) {
    required = patch.required === 0 || patch.required === false ? 0 : 1;
  }

  let isDefault = existing.is_default ? 1 : 0;
  if (patch.isDefault !== undefined || patch.is_default !== undefined) {
    const raw = patch.isDefault !== undefined ? patch.isDefault : patch.is_default;
    isDefault = raw === 0 || raw === false || raw === '0' || raw === '' ? 0 : 1;
  }

  db.prepare(`
    UPDATE custom_fields
    SET label = ?, field_type = ?, options_json = ?, required = ?, is_default = ?
    WHERE id = ?
  `).run(label, fieldType, optionsJson, required, isDefault, fieldId);

  if (fieldType !== existing.field_type) {
    const width = fieldTypes.fieldWidthForType(fieldType);
    db.prepare(`
      UPDATE page_layout_items SET width = ? WHERE field_key = ?
    `).run(width, `cf:${fieldId}`);
  }

  audit(db, {
    actorId: actor?.id || null,
    action: 'custom_field.update',
    entityType: 'custom_field',
    entityId: fieldId,
    detail: {
      label,
      fieldType,
      required: !!required,
      isDefault: !!isDefault,
      fromType: existing.field_type,
    },
  });
  return getCustomField(db, fieldId);
}

function listTimeEntryFieldDefs(db) {
  return listCustomFields(db, { appliesTo: 'time_entry' }).map((f) => ({
    key: `cf:${f.id}`,
    label: f.label,
    type: f.field_type,
    options: f.options,
    config: f.config,
    expression: f.expression,
    required: !!f.required,
    isDefault: !!f.isDefault,
    scope: 'time_entry',
    fieldId: f.id,
    kind: 'custom',
    width: fieldTypes.fieldWidthForType(f.field_type),
    value: null,
    readonly: fieldTypes.isSystemManagedFieldType(f.field_type),
  }));
}

function listClientFieldDefs(db, { recordTypeKey = null, clientId = null } = {}) {
  return listCustomFields(db, {
    appliesTo: 'client',
    recordTypeKey: recordTypeKey || null,
    clientId: clientId != null ? Number(clientId) : null,
  }).map((f) => ({
    key: `cf:${f.id}`,
    label: f.label,
    type: f.field_type,
    options: f.options,
    config: f.config,
    expression: f.expression,
    required: !!f.required,
    isDefault: !!f.isDefault,
    scope: f.client_id || f.clientId
      ? 'record'
      : (f.record_type_key ? 'record_type' : 'client'),
    recordTypeKey: f.record_type_key || null,
    clientId: f.client_id != null ? Number(f.client_id) : (f.clientId != null ? Number(f.clientId) : null),
    fieldId: f.id,
    kind: 'custom',
    width: fieldTypes.fieldWidthForType(f.field_type),
    value: null,
    readonly: fieldTypes.isSystemManagedFieldType(f.field_type),
  }));
}

function setClientCustomValues(db, actor, clientId, customValues) {
  const client = db.prepare('SELECT id, record_type FROM clients WHERE id = ?').get(clientId);
  if (!client) throw new Error('contact not found');
  const clientType = client.record_type || DEFAULT_CONTACT_RECORD_TYPE_KEY;
  const scoped = listCustomFields(db, {
    appliesTo: 'client',
    recordTypeKey: clientType,
    clientId,
  });
  const prepared = prepareCustomValuesForSave(db, scoped, customValues);
  const upsert = db.prepare(`
    INSERT INTO client_custom_field_values(client_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(client_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(prepared || {})) {
    const id = Number(fieldId);
    const field = db.prepare(`
      SELECT * FROM custom_fields
      WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'client'
    `).get(id);
    if (!field) continue;
    const contactOnly = field.client_id != null;
    const ok = contactOnly
      ? Number(field.client_id) === Number(clientId)
      : (!field.record_type_key || field.record_type_key === clientType);
    if (!ok) continue;
    const text = value == null ? null : String(value);
    upsert.run(clientId, id, text, actor?.id || null);
  }
}

function getClientCustomValues(db, clientId) {
  return db.prepare(`
    SELECT field_id, value_text FROM client_custom_field_values
    WHERE client_id = ?
  `).all(clientId);
}

function setTimeCustomValues(db, actor, timeEntryId, customValues) {
  const entry = db.prepare('SELECT id FROM time_entries WHERE id = ?').get(timeEntryId);
  if (!entry) throw new Error('time entry not found');
  const scoped = listCustomFields(db, { appliesTo: 'time_entry' });
  const prepared = prepareCustomValuesForSave(db, scoped, customValues);
  const upsert = db.prepare(`
    INSERT INTO time_entry_custom_field_values(time_entry_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(time_entry_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(prepared || {})) {
    const id = Number(fieldId);
    const field = db.prepare(`
      SELECT * FROM custom_fields
      WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'time_entry'
    `).get(id);
    if (!field) continue;
    const text = value == null ? null : String(value);
    upsert.run(timeEntryId, id, text, actor?.id || null);
  }
}

function getTimeCustomValues(db, timeEntryId) {
  return db.prepare(`
    SELECT field_id, value_text FROM time_entry_custom_field_values
    WHERE time_entry_id = ?
  `).all(timeEntryId);
}

function ensureMatterLayout(db, matterId) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  let layout = db.prepare('SELECT * FROM page_layouts WHERE matter_id = ?').get(matterId);
  if (layout) return layout;

  // Clone from type layout
  const typeLayout = ensureTypeLayout(db, matter.matter_type);
  const info = db.prepare(`
    INSERT INTO page_layouts(record_type_key, matter_id, name)
    VALUES (NULL, ?, ?)
  `).run(matterId, `${matter.number} layout`);
  const layoutId = Number(info.lastInsertRowid);
  const items = db.prepare(
    'SELECT * FROM page_layout_items WHERE layout_id = ? ORDER BY sort_order'
  ).all(typeLayout.id);
  const insert = db.prepare(`
    INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
    VALUES (?, ?, ?, ?, ?)
  `);
  for (const item of items) {
    insert.run(layoutId, item.field_key, item.section, item.sort_order, item.width);
  }
  // Include any existing record-only fields not already on type layout
  const recordFields = db.prepare(
    'SELECT id FROM custom_fields WHERE matter_id = ? AND active = 1'
  ).all(matterId);
  let order = items.length;
  for (const f of recordFields) {
    insert.run(layoutId, `cf:${f.id}`, 'details', order++, 'half');
  }
  return db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
}

function resolveLayout(db, matter) {
  // Type page layout is the source of truth for shared fields.
  const typeLayout = ensureTypeLayout(db, matter.matter_type);
  return { layout: typeLayout, source: 'record_type' };
}

function appendMissingMatterOnlyFields(db, matter, items, layoutId) {
  const present = new Set(items.map((i) => i.field_key));
  const recordFields = db.prepare(`
    SELECT id, field_type FROM custom_fields
    WHERE matter_id = ? AND active = 1
    ORDER BY id
  `).all(matter.id);
  let order = items.length;
  for (const f of recordFields) {
    const key = `cf:${f.id}`;
    if (present.has(key)) continue;
    items.push({
      id: null,
      layout_id: layoutId,
      field_key: key,
      section: 'details',
      sort_order: order++,
      width: fieldTypes.fieldWidthForType(f.field_type),
    });
    present.add(key);
  }
  return items;
}

/** Display items = matter layout (if customized) or record-type layout + matter-only fields. */
function buildMatterDisplayItems(db, matter) {
  const typeLayout = ensureTypeLayout(db, matter.matter_type || DEFAULT_RECORD_TYPE_KEY);
  const matterLayout = db.prepare('SELECT * FROM page_layouts WHERE matter_id = ?').get(matter.id);

  if (matterLayout) {
    // Pull in any new type-layout fields added since this matter layout was cloned.
    const typeItems = layoutItems(db, typeLayout.id);
    for (const item of typeItems) {
      addFieldToLayout(db, matterLayout.id, item.field_key, item.width || 'half');
    }
    const items = layoutItems(db, matterLayout.id).map((item) => ({ ...item }));
    appendMissingMatterOnlyFields(db, matter, items, matterLayout.id);
    return {
      items,
      typeLayout,
      matterLayout,
      layout: matterLayout,
      source: 'matter',
    };
  }

  const typeItems = layoutItems(db, typeLayout.id);
  const items = typeItems.map((item) => ({ ...item }));
  appendMissingMatterOnlyFields(db, matter, items, typeLayout.id);
  return {
    items,
    typeLayout,
    matterLayout: null,
    layout: typeLayout,
    source: 'record_type',
  };
}

/** Persist field order/widths on a matter-specific layout (clones type layout on first save). */
function saveMatterLayoutItems(db, actor, matterId, items) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');
  const layout = ensureMatterLayout(db, matterId);
  const incoming = Array.isArray(items) ? items : [];
  const incomingKeys = new Set(incoming.map((item) => item.fieldKey).filter(Boolean));
  // Keep layout fields the UI may hide (e.g. std:number) so they are not dropped.
  const preserved = layoutItems(db, layout.id)
    .filter((row) => row.field_key && !incomingKeys.has(row.field_key))
    .map((row) => ({
      fieldKey: row.field_key,
      section: row.section || 'details',
      width: row.width || 'half',
    }));
  const merged = [
    ...preserved,
    ...incoming.filter((item) => item && item.fieldKey),
  ].map((item, i) => ({
    fieldKey: item.fieldKey,
    section: item.section || 'details',
    width: item.width || 'half',
    sortOrder: i,
  }));
  saveLayoutItems(db, actor, layout.id, merged);
  return getMatterPage(db, matterId, actor);
}

function layoutItems(db, layoutId) {
  return db.prepare(`
    SELECT * FROM page_layout_items WHERE layout_id = ? ORDER BY sort_order, id
  `).all(layoutId);
}

function fieldDefsForMatter(db, matter) {
  const fields = listCustomFields(db, {
    recordTypeKey: matter.matter_type,
    matterId: matter.id,
  });
  const byKey = new Map(STANDARD_FIELDS.map((f) => [f.key, { ...f, kind: 'standard' }]));
  for (const f of fields) {
    byKey.set(`cf:${f.id}`, {
      key: `cf:${f.id}`,
      label: f.label,
      type: f.field_type,
      options: f.options,
      config: f.config,
      expression: f.expression,
      required: !!f.required,
      isDefault: !!f.isDefault,
      scope: f.scope,
      fieldId: f.id,
      kind: 'custom',
      width: fieldTypes.fieldWidthForType(f.field_type),
      readonly: fieldTypes.isSystemManagedFieldType(f.field_type),
    });
  }
  return byKey;
}

/** Ensure type-scoped custom fields also appear on matter-specific layouts. */
function syncTypeCustomFieldsToMatterLayout(db, matter, layout) {
  if (!layout?.matter_id) return;
  const typeLayout = ensureTypeLayout(db, matter.matter_type || DEFAULT_RECORD_TYPE_KEY);
  const typeItems = layoutItems(db, typeLayout.id)
    .filter((item) => String(item.field_key).startsWith('cf:'));
  for (const item of typeItems) {
    addFieldToLayout(db, layout.id, item.field_key, item.width || 'half');
  }
}

function getMatterPage(db, matterId, actor = null) {
  const permissions = require('./permissions');
  const matter = db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    LEFT JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE m.id = ?
  `).get(matterId);
  if (!matter) return null;

  const { items, typeLayout, layout: activeLayout, source } = buildMatterDisplayItems(db, matter);
  const defs = fieldDefsForMatter(db, matter);
  const values = db.prepare(
    'SELECT field_id, value_text FROM custom_field_values WHERE matter_id = ?'
  ).all(matterId);
  const valueMap = Object.fromEntries(values.map((v) => [v.field_id, v.value_text]));
  const role = actor?.role || null;
  const canEdit = role ? permissions.canModifyAll(db, role, 'matter') : true;
  const canDelete = role ? permissions.canDelete(db, role, 'matter') : false;
  const pageAccess = canEdit ? 'read_write' : 'read_only';

  const sections = {};
  for (const item of items) {
    const def = defs.get(item.field_key);
    if (!def) continue;
    if (role && !permissions.isFieldVisibleForProfile(db, 'matter', role, item.field_key)) {
      continue;
    }
    const section = item.section || 'details';
    if (!sections[section]) sections[section] = [];
    let value = null;
    if (def.kind === 'standard') {
      const map = {
        'std:number': matter.number,
        'std:name': matter.name,
        'std:client': matter.client_id,
        'std:matter_type': matter.matter_type,
        'std:status': matter.status,
        'std:jurisdiction': matter.jurisdiction,
        'std:court': matter.court,
        'std:responsible_attorney': matter.responsible_attorney_id,
        'std:opened_on': matter.opened_on,
      };
      value = map[def.key] ?? null;
    } else {
      value = valueMap[def.fieldId] ?? null;
      if (fieldTypes.normalizeFieldType(def.type) === 'formula') {
        const siblings = listCustomFields(db, {
          recordTypeKey: matter.matter_type,
          matterId: matter.id,
          appliesTo: 'matter',
        }).map((f) => ({
          id: f.id,
          api_name: f.api_name,
          label: f.label,
        }));
        value = fieldTypes.evaluateFormula(def.expression || def.config?.expression, siblings, valueMap);
      }
    }
    const fieldWritable = !role
      || permissions.isFieldWritableForRole(db, 'matter', role, item.field_key);
    sections[section].push({
      ...def,
      width: item.width || def.width || 'half',
      value,
      readonly: !!(def.readonly
        || fieldTypes.isSystemManagedFieldType(def.type)
        || !fieldWritable),
    });
  }

  const presentKeys = new Set(items.map((i) => i.field_key));
  const availableStandardFields = STANDARD_FIELDS
    .filter((f) => OPTIONAL_STANDARD_KEYS.includes(f.key) && !presentKeys.has(f.key))
    .map((f) => ({ ...f, kind: 'standard' }));

  const typeLayoutFields = describeLayoutFields(db, typeLayout.id);
  const typeKeys = new Set(typeLayoutFields.map((f) => f.fieldKey));
  const matterOnlyFields = items
    .filter((item) => !typeKeys.has(item.field_key))
    .map((item) => {
      const def = defs.get(item.field_key);
      return {
        fieldKey: item.field_key,
        label: def?.label || item.field_key,
        width: item.width,
        section: item.section || 'details',
        removable: true,
        kind: def?.kind || 'custom',
        required: !!def?.required,
        isDefault: !!def?.isDefault,
        is_default: def?.isDefault ? 1 : 0,
        fieldId: def?.fieldId ?? null,
        fieldType: def?.type || null,
        type: def?.type || null,
        options: def?.options || null,
        scope: def?.scope || 'record',
      };
    });

  const onedrive = require('./onedrive');
  return {
    matter,
    layout: {
      id: activeLayout.id,
      name: activeLayout.name,
      source,
      typeLayoutId: typeLayout.id,
    },
    sections,
    layoutFields: [...typeLayoutFields, ...matterOnlyFields],
    availableFields: [...defs.values()],
    availableStandardFields,
    typeLayout: getTypeLayout(db, matter.matter_type),
    onedrive: onedrive.getMatterOneDrive(db, matterId),
    onedriveSuggestedName: onedrive.suggestFolderName(matter),
    pageAccess,
    canEdit,
    canDelete,
  };
}

/** Add an optional standard field to this matter's record-type page layout. */
function addStandardFieldToMatter(db, actor, matterId, fieldKey) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');
  addStandardFieldToType(db, actor, matter.matter_type, fieldKey);
  return getMatterPage(db, matterId);
}

function removeFieldFromMatter(db, actor, matterId, fieldKey) {
  if (CORE_LAYOUT_KEYS.includes(fieldKey)) throw new Error('core fields cannot be removed');
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  if (String(fieldKey).startsWith('cf:')) {
    const id = Number(String(fieldKey).slice(3));
    const recordField = db.prepare(
      'SELECT * FROM custom_fields WHERE id = ? AND matter_id = ?'
    ).get(id, matterId);
    if (recordField) {
      db.prepare('UPDATE custom_fields SET active = 0 WHERE id = ?').run(id);
      // Also drop from any legacy matter-specific layout clone
      const matterLayout = db.prepare('SELECT id FROM page_layouts WHERE matter_id = ?').get(matterId);
      if (matterLayout) {
        db.prepare(
          'DELETE FROM page_layout_items WHERE layout_id = ? AND field_key = ?'
        ).run(matterLayout.id, fieldKey);
      }
      audit(db, {
        actorId: actor.id,
        action: 'matter.layout.remove_field',
        entityType: 'matter',
        entityId: matterId,
        detail: { fieldKey },
      });
      return getMatterPage(db, matterId);
    }
  }

  // Shared std / type-scoped fields are removed from the record-type page layout.
  removeFieldFromType(db, actor, matter.matter_type, fieldKey);
  return getMatterPage(db, matterId);
}

function setCustomValues(db, actor, matterId, customValues) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');
  const scoped = listCustomFields(db, {
    recordTypeKey: matter.matter_type,
    matterId,
    appliesTo: 'matter',
  });
  const prepared = prepareCustomValuesForSave(db, scoped, customValues);
  const upsert = db.prepare(`
    INSERT INTO custom_field_values(matter_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(matter_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(prepared || {})) {
    const id = Number(fieldId);
    const field = db.prepare(
      `SELECT * FROM custom_fields
       WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'matter'`
    ).get(id);
    if (!field) continue;
    const ok = (!field.matter_id && !field.record_type_key)
      || (field.record_type_key && field.record_type_key === matter.matter_type)
      || (field.matter_id === matterId);
    if (!ok) continue;
    const text = value == null ? null : String(value);
    upsert.run(matterId, id, text, actor.id);
    db.prepare(`
      INSERT INTO matter_field_history(matter_id, field_name, old_value, new_value, changed_by)
      VALUES (?, ?, NULL, ?, ?)
    `).run(matterId, `cf:${id}`, text, actor.id);
  }
  matterIndex.indexMatter(db, matterId);
}

function saveLayoutItems(db, actor, layoutId, items) {
  const layout = db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
  if (!layout) throw new Error('layout not found');
  db.prepare('DELETE FROM page_layout_items WHERE layout_id = ?').run(layoutId);
  const insert = db.prepare(`
    INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
    VALUES (?, ?, ?, ?, ?)
  `);
  (items || []).forEach((item, i) => {
    insert.run(
      layoutId,
      item.fieldKey,
      item.section || 'details',
      item.sortOrder != null ? item.sortOrder : i,
      item.width || 'half'
    );
  });
  audit(db, {
    actorId: actor.id,
    action: 'layout.update',
    entityType: 'page_layout',
    entityId: layoutId,
    detail: { itemCount: (items || []).length },
  });
  return layoutItems(db, layoutId);
}

module.exports = {
  RECORD_TYPES,
  CONTACT_RECORD_TYPES,
  KNOWN_RECORD_TYPE_KEYS,
  LEGACY_RECORD_TYPE_KEYS,
  DEFAULT_RECORD_TYPE_KEY,
  DEFAULT_RECORD_TYPE_LABEL,
  DEFAULT_CONTACT_RECORD_TYPE_KEY,
  DEFAULT_CONTACT_RECORD_TYPE_LABEL,
  STANDARD_FIELDS,
  CONTACT_LAYOUT_FIELDS,
  CORE_LAYOUT_KEYS,
  CONTACT_CORE_LAYOUT_KEYS,
  OPTIONAL_STANDARD_KEYS,
  ensureRecordTypes,
  createRecordType,
  normalizeRecordTypeKey,
  ensureTypeLayout,
  ensureMatterLayout,
  listRecordTypes,
  buildMatterDisplayItems,
  createCustomField,
  updateCustomField,
  getCustomField,
  listCustomFields,
  deactivateCustomField,
  listTimeEntryFieldDefs,
  listClientFieldDefs,
  setTimeCustomValues,
  getTimeCustomValues,
  setClientCustomValues,
  getClientCustomValues,
  assertRequiredCustomValues,
  isBlankCustomValue,
  prepareCustomValuesForSave,
  getMatterPage,
  getTypeLayout,
  setCustomValues,
  saveLayoutItems,
  saveMatterLayoutItems,
  resolveLayout,
  addStandardFieldToMatter,
  removeFieldFromMatter,
  addStandardFieldToType,
  removeFieldFromType,
};
