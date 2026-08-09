const { audit } = require('../db');
const matterIndex = require('./matterIndex');

/** Single built-in record type; layouts and type fields attach here. */
const DEFAULT_RECORD_TYPE_KEY = 'default';
const DEFAULT_RECORD_TYPE_LABEL = 'Default';

const STANDARD_FIELDS = [
  { key: 'std:number', label: 'Matter number', type: 'text', readonly: true, width: 'half' },
  { key: 'std:name', label: 'Matter name', type: 'text', width: 'full' },
  { key: 'std:client', label: 'Client', type: 'select', width: 'half' },
  { key: 'std:matter_type', label: 'Record type', type: 'select',
    options: [DEFAULT_RECORD_TYPE_KEY], width: 'half', readonly: true },
  { key: 'std:status', label: 'Status', type: 'select', options: ['open', 'closed'], width: 'half' },
  { key: 'std:jurisdiction', label: 'Jurisdiction', type: 'text', width: 'half' },
  { key: 'std:court', label: 'Court', type: 'text', width: 'half' },
  { key: 'std:responsible_attorney', label: 'Responsible attorney', type: 'select', width: 'half' },
  { key: 'std:opened_on', label: 'Opened on', type: 'date', width: 'half' },
];

/** Shown on every new matter / type layout. */
const CORE_LAYOUT_KEYS = ['std:number', 'std:name'];

/** Not offered as an addable field — every matter uses the default record type. */
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
    if (isCustom) {
      const fieldId = Number(String(item.field_key).slice(3));
      const row = db.prepare(
        'SELECT required FROM custom_fields WHERE id = ? AND active = 1'
      ).get(fieldId);
      required = !!row?.required;
    }
    return {
      fieldKey: item.field_key,
      label: fieldLabelForKey(db, item.field_key),
      width: item.width,
      section: item.section,
      removable: !CORE_LAYOUT_KEYS.includes(item.field_key),
      kind: isCustom ? 'custom' : 'standard',
      required,
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
  const fields = target === 'time_entry'
    ? listCustomFields(db, { appliesTo: 'time_entry' })
    : listCustomFields(db, {
      recordTypeKey: recordTypeKey || DEFAULT_RECORD_TYPE_KEY,
      matterId: matterId != null ? Number(matterId) : null,
      appliesTo: 'matter',
    });
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

function ensureDefaultRecordTypeRow(db) {
  db.prepare(`
    INSERT INTO record_types(key, label, active) VALUES (?, ?, 1)
    ON CONFLICT(key) DO UPDATE SET label = excluded.label, active = 1
  `).run(DEFAULT_RECORD_TYPE_KEY, DEFAULT_RECORD_TYPE_LABEL);
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

function ensureRecordTypes(db) {
  ensureDefaultRecordTypeRow(db);

  // Collapse legacy seeded types (litigation / sw_admin / other) onto Default.
  const legacy = db.prepare(`
    SELECT key FROM record_types WHERE key != ?
  `).all(DEFAULT_RECORD_TYPE_KEY);
  if (!legacy.length) return;

  createTypeLayoutRow(db, DEFAULT_RECORD_TYPE_KEY);
  db.prepare(`
    UPDATE matters SET matter_type = ? WHERE matter_type != ?
  `).run(DEFAULT_RECORD_TYPE_KEY, DEFAULT_RECORD_TYPE_KEY);
  db.prepare(`
    UPDATE custom_fields SET record_type_key = ?
    WHERE record_type_key IS NOT NULL AND record_type_key != ?
  `).run(DEFAULT_RECORD_TYPE_KEY, DEFAULT_RECORD_TYPE_KEY);

  for (const row of legacy) {
    const oldLayout = db.prepare(`
      SELECT id FROM page_layouts WHERE record_type_key = ? AND matter_id IS NULL
    `).get(row.key);
    if (oldLayout) {
      db.prepare('DELETE FROM page_layout_items WHERE layout_id = ?').run(oldLayout.id);
      db.prepare('DELETE FROM page_layouts WHERE id = ?').run(oldLayout.id);
    }
    db.prepare('DELETE FROM record_types WHERE key = ?').run(row.key);
  }
}

function ensureTypeLayout(db, _recordTypeKey) {
  ensureRecordTypes(db);
  // Product uses a single default record type; ignore other keys.
  return createTypeLayoutRow(db, DEFAULT_RECORD_TYPE_KEY);
}

function getTypeLayout(db, _recordTypeKey) {
  const recordTypeKey = DEFAULT_RECORD_TYPE_KEY;
  const layout = ensureTypeLayout(db, recordTypeKey);
  const fields = describeLayoutFields(db, layout.id);
  const present = new Set(fields.map((f) => f.fieldKey));
  const availableStandardFields = STANDARD_FIELDS
    .filter((f) => OPTIONAL_STANDARD_KEYS.includes(f.key) && !present.has(f.key))
    .map((f) => ({ ...f, kind: 'standard' }));
  const type = db.prepare('SELECT * FROM record_types WHERE key = ?').get(recordTypeKey);
  return {
    recordTypeKey,
    label: type?.label || recordTypeKey,
    layout: { id: layout.id, name: layout.name, source: 'record_type' },
    fields,
    availableStandardFields,
    customFields: listCustomFields(db, { recordTypeKey }),
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

function addStandardFieldToType(db, actor, _recordTypeKey, fieldKey) {
  const recordTypeKey = DEFAULT_RECORD_TYPE_KEY;
  if (!OPTIONAL_STANDARD_KEYS.includes(fieldKey)) throw new Error('field cannot be added');
  const std = STANDARD_FIELDS.find((f) => f.key === fieldKey);
  if (!std) throw new Error('unknown field');
  const layout = ensureTypeLayout(db, recordTypeKey);
  addFieldToLayout(db, layout.id, fieldKey, std.width || 'half');
  audit(db, {
    actorId: actor.id,
    action: 'type.layout.add_field',
    entityType: 'record_type',
    entityId: null,
    detail: { recordTypeKey, fieldKey },
  });
  return getTypeLayout(db, recordTypeKey);
}

function removeFieldFromType(db, actor, _recordTypeKey, fieldKey) {
  const recordTypeKey = DEFAULT_RECORD_TYPE_KEY;
  if (CORE_LAYOUT_KEYS.includes(fieldKey)) throw new Error('core fields cannot be removed');
  const layout = ensureTypeLayout(db, recordTypeKey);
  db.prepare(
    'DELETE FROM page_layout_items WHERE layout_id = ? AND field_key = ?'
  ).run(layout.id, fieldKey);
  if (String(fieldKey).startsWith('cf:')) {
    const id = Number(String(fieldKey).slice(3));
    const field = db.prepare(
      'SELECT * FROM custom_fields WHERE id = ? AND record_type_key = ? AND matter_id IS NULL'
    ).get(id, recordTypeKey);
    if (field) {
      db.prepare('UPDATE custom_fields SET active = 0 WHERE id = ?').run(id);
    }
  }
  audit(db, {
    actorId: actor.id,
    action: 'type.layout.remove_field',
    entityType: 'record_type',
    entityId: null,
    detail: { recordTypeKey, fieldKey },
  });
  return getTypeLayout(db, recordTypeKey);
}

function listRecordTypes(db) {
  ensureRecordTypes(db);
  return db.prepare('SELECT * FROM record_types WHERE active = 1 ORDER BY label').all();
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
  const v = String(value || 'matter').trim();
  if (v === 'time' || v === 'time_entry' || v === 'time-entry') return 'time_entry';
  return 'matter';
}

function normalizeFieldType(fieldType) {
  const raw = String(fieldType || 'text').trim().toLowerCase();
  if (raw === 'dropdown') return 'select';
  return raw;
}

function parseFieldOptions(input) {
  if (Array.isArray(input.options)) {
    return input.options.map((o) => String(o).trim()).filter(Boolean);
  }
  if (typeof input.options === 'string') {
    return input.options.split(',').map((o) => o.trim()).filter(Boolean);
  }
  if (typeof input.optionsText === 'string') {
    return input.optionsText.split(',').map((o) => o.trim()).filter(Boolean);
  }
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

  if (appliesTo === 'time_entry') {
    // Firm-wide time-entry fields — not tied to a matter layout.
    recordTypeKey = null;
    matterId = null;
  } else if (matterId) {
    const m = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
    if (!m) throw new Error('matter not found');
    recordTypeKey = null; // record-based
    appliesTo = 'matter';
  } else if (recordTypeKey) {
    ensureRecordTypes(db);
    recordTypeKey = DEFAULT_RECORD_TYPE_KEY;
    appliesTo = 'matter';
  } else {
    // Default matter type field when scope omitted
    ensureRecordTypes(db);
    recordTypeKey = DEFAULT_RECORD_TYPE_KEY;
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
    scope: appliesTo === 'time_entry'
      ? 'time_entry'
      : (f.matter_id ? 'record' : (f.record_type_key ? 'record_type' : 'global')),
  };
}

function listCustomFields(db, {
  recordTypeKey = null,
  matterId = null,
  appliesTo = 'matter',
} = {}) {
  const target = normalizeAppliesTo(appliesTo);
  if (target === 'time_entry') {
    return db.prepare(`
      SELECT * FROM custom_fields
      WHERE active = 1
        AND IFNULL(applies_to, 'matter') = 'time_entry'
      ORDER BY label, id
    `).all().map((f) => getCustomField(db, f.id));
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
  DEFAULT_RECORD_TYPE_KEY,
  DEFAULT_RECORD_TYPE_LABEL,
  STANDARD_FIELDS,
  CORE_LAYOUT_KEYS,
  OPTIONAL_STANDARD_KEYS,
  ensureRecordTypes,
  ensureTypeLayout,
  ensureMatterLayout,
  listRecordTypes,
  createCustomField,
  getCustomField,
  listCustomFields,
  deactivateCustomField,
  listTimeEntryFieldDefs,
  setTimeCustomValues,
  getTimeCustomValues,
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
