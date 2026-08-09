const { audit } = require('../db');
const matterIndex = require('./matterIndex');

/** Built-in matter record types. Custom fields attach per type. */
const RECORD_TYPES = [
  { key: 'billable', label: 'Billable' },
  { key: 'non_billable', label: 'Non-Billable' },
];
const DEFAULT_RECORD_TYPE_KEY = 'billable';
const DEFAULT_RECORD_TYPE_LABEL = 'Billable';
const KNOWN_RECORD_TYPE_KEYS = RECORD_TYPES.map((t) => t.key);

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

/** Shown on every new matter / type layout. */
const CORE_LAYOUT_KEYS = ['std:number', 'std:name'];

/** Record type is chosen at create; not offered as an addable layout field. */
const HIDDEN_STANDARD_KEYS = ['std:matter_type'];

/** Optional standard fields — add later on a matter record page. */
const OPTIONAL_STANDARD_KEYS = STANDARD_FIELDS
  .map((f) => f.key)
  .filter((key) => !CORE_LAYOUT_KEYS.includes(key) && !HIDDEN_STANDARD_KEYS.includes(key));

function fieldLabelForKey(db, fieldKey) {
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
  return layoutItems(db, layoutId).map((item) => {
    const isCustom = String(item.field_key).startsWith('cf:');
    let required = false;
    let fieldId = null;
    let fieldType = null;
    let options = null;
    if (isCustom) {
      fieldId = Number(String(item.field_key).slice(3));
      const row = getCustomField(db, fieldId);
      if (row) {
        required = !!row.required;
        fieldType = row.field_type;
        options = row.options;
      }
    }
    return {
      fieldKey: item.field_key,
      label: fieldLabelForKey(db, item.field_key),
      width: item.width,
      section: item.section,
      removable: !CORE_LAYOUT_KEYS.includes(item.field_key),
      kind: isCustom ? 'custom' : 'standard',
      required,
      fieldId,
      fieldType,
      type: fieldType,
      options,
    };
  });
}

function isBlankCustomValue(field, value) {
  if (value == null) return true;
  const text = String(value).trim();
  const type = field.field_type || field.fieldType || field.type;
  if (type === 'checkbox') {
    return text !== '1' && text.toLowerCase() !== 'true';
  }
  return text === '';
}

/** Ensure all required custom fields for the scope have non-blank values. */
function assertRequiredCustomValues(db, {
  appliesTo = 'matter',
  matterId = null,
  recordTypeKey = null,
  values = {},
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  let fields;
  if (target === 'time_entry' || target === 'client') {
    fields = listCustomFields(db, { appliesTo: target });
  } else {
    fields = listCustomFields(db, {
      recordTypeKey: recordTypeKey || DEFAULT_RECORD_TYPE_KEY,
      matterId: matterId != null ? Number(matterId) : null,
      appliesTo: 'matter',
    });
  }
  const required = fields.filter((f) => !!f.required);
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

function upsertRecordTypeRow(db, key, label) {
  db.prepare(`
    INSERT INTO record_types(key, label, active) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, active = 1
  `).run(key, label);
}

function createTypeLayoutRow(db, recordTypeKey) {
  let layout = db.prepare(
    'SELECT * FROM page_layouts WHERE record_type_key = ? AND matter_id IS NULL'
  ).get(recordTypeKey);
  if (layout) return layout;

  const info = db.prepare(`
    INSERT INTO page_layouts(record_type_key, matter_id, name) VALUES (?, NULL, 'Default')
  `).run(recordTypeKey);
  const layoutId = Number(info.lastInsertRowid);
  const insert = db.prepare(`
    INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
    VALUES (?, ?, 'details', ?, ?)
  `);
  CORE_LAYOUT_KEYS.forEach((key, i) => {
    const std = STANDARD_FIELDS.find((f) => f.key === key);
    insert.run(layoutId, key, i, std?.width || 'half');
  });
  return db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
}

/** Move matters/fields/layout items from one type key onto another, then drop the old type. */
function remapRecordTypeKey(db, fromKey, toKey) {
  if (fromKey === toKey) return;
  const fromType = db.prepare('SELECT key FROM record_types WHERE key = ?').get(fromKey);
  if (!fromType) return;
  upsertRecordTypeRow(
    db,
    toKey,
    RECORD_TYPES.find((t) => t.key === toKey)?.label || toKey
  );
  createTypeLayoutRow(db, toKey);

  db.prepare('UPDATE matters SET matter_type = ? WHERE matter_type = ?').run(toKey, fromKey);
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
    upsertRecordTypeRow(db, t.key, t.label);
  }

  // Legacy single type "default" → Billable
  if (db.prepare("SELECT key FROM record_types WHERE key = 'default'").get()) {
    remapRecordTypeKey(db, 'default', DEFAULT_RECORD_TYPE_KEY);
  }

  // Collapse other legacy seeded types onto Billable; keep Non-Billable.
  const known = new Set(KNOWN_RECORD_TYPE_KEYS);
  const legacy = db.prepare('SELECT key FROM record_types').all()
    .filter((row) => !known.has(row.key));
  for (const row of legacy) {
    remapRecordTypeKey(db, row.key, DEFAULT_RECORD_TYPE_KEY);
  }

  // Any stray matter/field keys still pointing at unknown types → Billable
  db.prepare(`
    UPDATE matters SET matter_type = ?
    WHERE matter_type NOT IN (${KNOWN_RECORD_TYPE_KEYS.map(() => '?').join(',')})
  `).run(DEFAULT_RECORD_TYPE_KEY, ...KNOWN_RECORD_TYPE_KEYS);
  db.prepare(`
    UPDATE custom_fields SET record_type_key = ?
    WHERE record_type_key IS NOT NULL
      AND record_type_key NOT IN (${KNOWN_RECORD_TYPE_KEYS.map(() => '?').join(',')})
  `).run(DEFAULT_RECORD_TYPE_KEY, ...KNOWN_RECORD_TYPE_KEYS);

  for (const t of RECORD_TYPES) {
    createTypeLayoutRow(db, t.key);
  }
}

function normalizeRecordTypeKey(db, key, { required = false } = {}) {
  ensureRecordTypes(db);
  let raw = key == null || key === '' ? null : String(key).trim();
  if (!raw) {
    if (required) throw new Error('record type required');
    return DEFAULT_RECORD_TYPE_KEY;
  }
  // Legacy alias from the single-type era
  if (raw === 'default') raw = DEFAULT_RECORD_TYPE_KEY;
  const row = db.prepare(
    'SELECT key FROM record_types WHERE key = ? AND active = 1'
  ).get(raw);
  if (!row) throw new Error('unknown record type');
  return row.key;
}

function ensureTypeLayout(db, recordTypeKey) {
  const key = normalizeRecordTypeKey(db, recordTypeKey);
  return createTypeLayoutRow(db, key);
}

function getTypeLayout(db, recordTypeKey) {
  const key = normalizeRecordTypeKey(db, recordTypeKey);
  const layout = ensureTypeLayout(db, key);
  const fields = describeLayoutFields(db, layout.id);
  const present = new Set(fields.map((f) => f.fieldKey));
  const availableStandardFields = STANDARD_FIELDS
    .filter((f) => OPTIONAL_STANDARD_KEYS.includes(f.key) && !present.has(f.key))
    .map((f) => ({ ...f, kind: 'standard' }));
  const type = db.prepare('SELECT * FROM record_types WHERE key = ?').get(key);
  return {
    recordTypeKey: key,
    label: type?.label || key,
    layout: { id: layout.id, name: layout.name, source: 'record_type' },
    fields,
    availableStandardFields,
    customFields: listCustomFields(db, { recordTypeKey: key }),
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
  const key = normalizeRecordTypeKey(db, recordTypeKey);
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
  const key = normalizeRecordTypeKey(db, recordTypeKey);
  if (CORE_LAYOUT_KEYS.includes(fieldKey)) throw new Error('core fields cannot be removed');
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

function listRecordTypes(db) {
  ensureRecordTypes(db);
  return db.prepare(`
    SELECT * FROM record_types
    WHERE active = 1
    ORDER BY CASE key
      WHEN 'billable' THEN 0
      WHEN 'non_billable' THEN 1
      ELSE 2
    END, label
  `).all();
}

function slugify(label) {
  return String(label)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || `field_${Date.now()}`;
}

function normalizeAppliesTo(value) {
  const v = String(value || 'matter').trim().toLowerCase();
  if (v === 'time' || v === 'time_entry' || v === 'time-entry') return 'time_entry';
  if (v === 'client' || v === 'contact' || v === 'contacts') return 'client';
  return 'matter';
}

function normalizeFieldType(fieldType) {
  const raw = String(fieldType || 'text').trim().toLowerCase();
  if (raw === 'dropdown') return 'select';
  return raw;
}

function parseFieldOptions(input) {
  const split = (raw) => String(raw || '')
    .split(/[\n,]+/)
    .map((o) => o.trim())
    .filter(Boolean);
  if (Array.isArray(input.options)) {
    return input.options.map((o) => String(o).trim()).filter(Boolean);
  }
  if (typeof input.options === 'string') return split(input.options);
  if (typeof input.optionsText === 'string') return split(input.optionsText);
  return [];
}

function createCustomField(db, actor, input) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('label required');
  const fieldType = normalizeFieldType(input.fieldType || input.field_type || 'text');
  if (!['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(fieldType)) {
    throw new Error('invalid fieldType');
  }
  const optionList = fieldType === 'select' ? parseFieldOptions(input) : [];
  if (fieldType === 'select' && !optionList.length) {
    throw new Error('dropdown fields need at least one option');
  }

  let appliesTo = normalizeAppliesTo(input.appliesTo || input.applies_to || 'matter');
  let recordTypeKey = input.recordTypeKey || null;
  let matterId = input.matterId != null ? Number(input.matterId) : null;

  if (appliesTo === 'time_entry' || appliesTo === 'client') {
    // Firm-wide time-entry / contact fields — not tied to a matter layout.
    recordTypeKey = null;
    matterId = null;
  } else if (matterId) {
    const m = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
    if (!m) throw new Error('matter not found');
    recordTypeKey = null; // record-based
    appliesTo = 'matter';
  } else if (recordTypeKey) {
    recordTypeKey = normalizeRecordTypeKey(db, recordTypeKey);
    appliesTo = 'matter';
  } else {
    // Default (Billable) type field when scope omitted
    recordTypeKey = normalizeRecordTypeKey(db, DEFAULT_RECORD_TYPE_KEY);
    appliesTo = 'matter';
  }

  let apiName = String(input.apiName || slugify(label));
  if (!/^[a-z][a-z0-9_]*$/.test(apiName)) {
    throw new Error('apiName must be snake_case starting with a letter');
  }

  // Ensure unique api_name within scope
  const clash = db.prepare(`
    SELECT id FROM custom_fields
    WHERE api_name = ?
      AND IFNULL(applies_to, 'matter') = ?
      AND IFNULL(record_type_key,'') = IFNULL(?, '')
      AND IFNULL(matter_id,0) = IFNULL(?, 0)
  `).get(apiName, appliesTo, recordTypeKey, matterId);
  if (clash) apiName = `${apiName}_${Date.now().toString(36)}`;

  const options = fieldType === 'select'
    ? JSON.stringify(optionList)
    : null;

  const info = db.prepare(`
    INSERT INTO custom_fields(
      api_name, label, field_type, options_json, applies_to, record_type_key, matter_id,
      required, active, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    apiName,
    label,
    fieldType,
    options,
    appliesTo,
    recordTypeKey,
    matterId,
    input.required ? 1 : 0,
    actor.id
  );
  const id = Number(info.lastInsertRowid);

  // Auto-add matter fields to the relevant layout(s)
  if (appliesTo === 'matter') {
    const width = fieldType === 'textarea' ? 'full' : 'half';
    const fieldKey = `cf:${id}`;
    if (matterId) {
      ensureMatterLayout(db, matterId);
      const layout = db.prepare('SELECT id FROM page_layouts WHERE matter_id = ?').get(matterId);
      addFieldToLayout(db, layout.id, fieldKey, width);
    } else if (recordTypeKey) {
      const layout = ensureTypeLayout(db, recordTypeKey);
      addFieldToLayout(db, layout.id, fieldKey, width);
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
      appliesTo,
      required: !!(input.required ? 1 : 0),
    },
  });

  return getCustomField(db, id);
}

function getCustomField(db, id) {
  const f = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
  if (!f) return null;
  const appliesTo = f.applies_to || 'matter';
  const fieldType = f.field_type === 'select' ? 'dropdown' : f.field_type;
  return {
    ...f,
    field_type: fieldType,
    fieldType,
    applies_to: appliesTo,
    appliesTo,
    options: f.options_json ? JSON.parse(f.options_json) : null,
    scope: appliesTo === 'time_entry' || appliesTo === 'client'
      ? appliesTo
      : (f.matter_id ? 'record' : (f.record_type_key ? 'record_type' : 'global')),
  };
}

function listCustomFields(db, {
  recordTypeKey = null,
  matterId = null,
  appliesTo = 'matter',
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  if (target === 'time_entry' || target === 'client') {
    return db.prepare(`
      SELECT * FROM custom_fields
      WHERE active = 1
        AND IFNULL(applies_to, 'matter') = ?
      ORDER BY label, id
    `).all(target).map((f) => getCustomField(db, f.id));
  }
  return db.prepare(`
    SELECT * FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = 'matter'
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
  if ((field.applies_to || 'matter') === 'matter') {
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

  let label = existing.label;
  if (patch.label !== undefined) {
    label = String(patch.label || '').trim();
    if (!label) throw new Error('label required');
  }

  let fieldType = existing.field_type;
  if (patch.fieldType !== undefined || patch.field_type !== undefined) {
    fieldType = normalizeFieldType(patch.fieldType || patch.field_type);
    if (!['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(fieldType)) {
      throw new Error('invalid fieldType');
    }
  }

  let optionsJson = existing.options_json;
  if (fieldType === 'select') {
    const optionsProvided = patch.options !== undefined || patch.optionsText !== undefined;
    if (optionsProvided || existing.field_type !== 'select') {
      const optionList = parseFieldOptions(patch);
      if (!optionList.length) {
        if (existing.field_type === 'select' && existing.options_json && !optionsProvided) {
          optionsJson = existing.options_json;
        } else {
          throw new Error('dropdown fields need at least one option');
        }
      } else {
        optionsJson = JSON.stringify(optionList);
      }
    }
  } else {
    optionsJson = null;
  }

  let required = existing.required ? 1 : 0;
  if (patch.required !== undefined) {
    required = patch.required === 0 || patch.required === false ? 0 : 1;
  }

  db.prepare(`
    UPDATE custom_fields
    SET label = ?, field_type = ?, options_json = ?, required = ?
    WHERE id = ?
  `).run(label, fieldType, optionsJson, required, fieldId);

  if (fieldType !== existing.field_type) {
    const width = fieldType === 'textarea' ? 'full' : 'half';
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
    required: !!f.required,
    scope: 'time_entry',
    fieldId: f.id,
    kind: 'custom',
    width: f.field_type === 'textarea' ? 'full' : 'half',
    value: null,
  }));
}

function listClientFieldDefs(db) {
  return listCustomFields(db, { appliesTo: 'client' }).map((f) => ({
    key: `cf:${f.id}`,
    label: f.label,
    type: f.field_type,
    options: f.options,
    required: !!f.required,
    scope: 'client',
    fieldId: f.id,
    kind: 'custom',
    width: f.field_type === 'textarea' ? 'full' : 'half',
    value: null,
  }));
}

function setClientCustomValues(db, actor, clientId, customValues) {
  const client = db.prepare('SELECT id FROM clients WHERE id = ?').get(clientId);
  if (!client) throw new Error('contact not found');
  const upsert = db.prepare(`
    INSERT INTO client_custom_field_values(client_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(client_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(customValues || {})) {
    const id = Number(fieldId);
    const field = db.prepare(`
      SELECT * FROM custom_fields
      WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'client'
    `).get(id);
    if (!field) continue;
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
  const upsert = db.prepare(`
    INSERT INTO time_entry_custom_field_values(time_entry_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(time_entry_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(customValues || {})) {
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
  const matterLayout = db.prepare('SELECT * FROM page_layouts WHERE matter_id = ?').get(matter.id);
  if (matterLayout) return { layout: matterLayout, source: 'record' };
  const typeLayout = ensureTypeLayout(db, matter.matter_type);
  return { layout: typeLayout, source: 'record_type' };
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
      required: !!f.required,
      scope: f.scope,
      fieldId: f.id,
      kind: 'custom',
      width: f.field_type === 'textarea' ? 'full' : 'half',
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

function getMatterPage(db, matterId) {
  const matter = db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE m.id = ?
  `).get(matterId);
  if (!matter) return null;

  let { layout, source } = resolveLayout(db, matter);
  if (source === 'record') {
    syncTypeCustomFieldsToMatterLayout(db, matter, layout);
    ({ layout, source } = resolveLayout(db, matter));
  }
  const items = layoutItems(db, layout.id);
  const defs = fieldDefsForMatter(db, matter);
  const values = db.prepare(
    'SELECT field_id, value_text FROM custom_field_values WHERE matter_id = ?'
  ).all(matterId);
  const valueMap = Object.fromEntries(values.map((v) => [v.field_id, v.value_text]));

  const sections = {};
  for (const item of items) {
    const def = defs.get(item.field_key);
    if (!def) continue;
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
    }
    sections[section].push({
      ...def,
      width: item.width || def.width || 'half',
      value,
    });
  }

  const presentKeys = new Set(items.map((i) => i.field_key));
  const availableStandardFields = STANDARD_FIELDS
    .filter((f) => OPTIONAL_STANDARD_KEYS.includes(f.key) && !presentKeys.has(f.key))
    .map((f) => ({ ...f, kind: 'standard' }));

  const onedrive = require('./onedrive');
  return {
    matter,
    layout: { id: layout.id, name: layout.name, source },
    sections,
    layoutFields: describeLayoutFields(db, layout.id),
    availableFields: [...defs.values()],
    availableStandardFields,
    typeLayout: getTypeLayout(db, matter.matter_type),
    onedrive: onedrive.getMatterOneDrive(db, matterId),
    onedriveSuggestedName: onedrive.suggestFolderName(matter),
  };
}

/** Add an optional standard field to this matter's record layout. */
function addStandardFieldToMatter(db, actor, matterId, fieldKey) {
  if (!OPTIONAL_STANDARD_KEYS.includes(fieldKey)) {
    throw new Error('field cannot be added');
  }
  const std = STANDARD_FIELDS.find((f) => f.key === fieldKey);
  if (!std) throw new Error('unknown field');

  const layout = ensureMatterLayout(db, matterId);
  addFieldToLayout(db, layout.id, fieldKey, std.width || 'half');

  audit(db, {
    actorId: actor.id,
    action: 'matter.layout.add_field',
    entityType: 'matter',
    entityId: matterId,
    detail: { fieldKey },
  });
  return getMatterPage(db, matterId);
}

function removeFieldFromMatter(db, actor, matterId, fieldKey) {
  if (CORE_LAYOUT_KEYS.includes(fieldKey)) throw new Error('core fields cannot be removed');
  const layout = ensureMatterLayout(db, matterId);
  db.prepare(
    'DELETE FROM page_layout_items WHERE layout_id = ? AND field_key = ?'
  ).run(layout.id, fieldKey);
  if (String(fieldKey).startsWith('cf:')) {
    const id = Number(String(fieldKey).slice(3));
    const field = db.prepare(
      'SELECT * FROM custom_fields WHERE id = ? AND matter_id = ?'
    ).get(id, matterId);
    if (field) {
      db.prepare('UPDATE custom_fields SET active = 0 WHERE id = ?').run(id);
    }
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

function setCustomValues(db, actor, matterId, customValues) {
  const upsert = db.prepare(`
    INSERT INTO custom_field_values(matter_id, field_id, value_text, updated_by, updated_at)
    VALUES (?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(matter_id, field_id) DO UPDATE SET
      value_text = excluded.value_text,
      updated_by = excluded.updated_by,
      updated_at = excluded.updated_at
  `);
  for (const [fieldId, value] of Object.entries(customValues || {})) {
    const id = Number(fieldId);
    const field = db.prepare(
      `SELECT * FROM custom_fields
       WHERE id = ? AND active = 1 AND IFNULL(applies_to, 'matter') = 'matter'`
    ).get(id);
    if (!field) continue;
    // Must be in scope for this matter
    const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
    if (!matter) throw new Error('matter not found');
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
  KNOWN_RECORD_TYPE_KEYS,
  DEFAULT_RECORD_TYPE_KEY,
  DEFAULT_RECORD_TYPE_LABEL,
  STANDARD_FIELDS,
  CORE_LAYOUT_KEYS,
  OPTIONAL_STANDARD_KEYS,
  ensureRecordTypes,
  normalizeRecordTypeKey,
  ensureTypeLayout,
  ensureMatterLayout,
  listRecordTypes,
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
  getMatterPage,
  getTypeLayout,
  setCustomValues,
  saveLayoutItems,
  resolveLayout,
  addStandardFieldToMatter,
  removeFieldFromMatter,
  addStandardFieldToType,
  removeFieldFromType,
};
