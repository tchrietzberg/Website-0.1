const { audit } = require('../db');
const matterIndex = require('./matterIndex');

const STANDARD_FIELDS = [
  { key: 'std:number', label: 'Matter number', type: 'text', readonly: true, width: 'half' },
  { key: 'std:name', label: 'Matter name', type: 'text', width: 'full' },
  { key: 'std:client', label: 'Client', type: 'select', width: 'half' },
  { key: 'std:matter_type', label: 'Record type', type: 'select',
    options: ['litigation', 'sw_admin', 'other'], width: 'half' },
  { key: 'std:status', label: 'Status', type: 'select', options: ['open', 'closed'], width: 'half' },
  { key: 'std:jurisdiction', label: 'Jurisdiction', type: 'text', width: 'half' },
  { key: 'std:court', label: 'Court', type: 'text', width: 'half' },
  { key: 'std:responsible_attorney', label: 'Responsible attorney', type: 'select', width: 'half' },
  { key: 'std:opened_on', label: 'Opened on', type: 'date', width: 'half' },
];

const DEFAULT_LAYOUT_KEYS = STANDARD_FIELDS.map((f) => f.key);

function ensureRecordTypes(db) {
  const defaults = [
    ['litigation', 'Litigation'],
    ['sw_admin', 'SW Admin'],
    ['other', 'Other'],
  ];
  for (const [key, label] of defaults) {
    db.prepare(`
      INSERT INTO record_types(key, label) VALUES (?, ?)
      ON CONFLICT(key) DO NOTHING
    `).run(key, label);
  }
}

function ensureTypeLayout(db, recordTypeKey) {
  ensureRecordTypes(db);
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
  DEFAULT_LAYOUT_KEYS.forEach((key, i) => {
    const std = STANDARD_FIELDS.find((f) => f.key === key);
    insert.run(layoutId, key, i, std?.width || 'half');
  });
  return db.prepare('SELECT * FROM page_layouts WHERE id = ?').get(layoutId);
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

function createCustomField(db, actor, input) {
  const label = String(input.label || '').trim();
  if (!label) throw new Error('label required');
  const fieldType = input.fieldType || 'text';
  if (!['text', 'textarea', 'number', 'date', 'select', 'checkbox'].includes(fieldType)) {
    throw new Error('invalid fieldType');
  }

  let recordTypeKey = input.recordTypeKey || null;
  let matterId = input.matterId != null ? Number(input.matterId) : null;
  if (matterId) {
    const m = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
    if (!m) throw new Error('matter not found');
    recordTypeKey = null; // record-based
  } else if (recordTypeKey) {
    ensureRecordTypes(db);
    const rt = db.prepare('SELECT key FROM record_types WHERE key = ?').get(recordTypeKey);
    if (!rt) throw new Error('record type not found');
  }

  let apiName = String(input.apiName || slugify(label));
  if (!/^[a-z][a-z0-9_]*$/.test(apiName)) {
    throw new Error('apiName must be snake_case starting with a letter');
  }

  // Ensure unique api_name within scope
  const clash = db.prepare(`
    SELECT id FROM custom_fields
    WHERE api_name = ?
      AND IFNULL(record_type_key,'') = IFNULL(?, '')
      AND IFNULL(matter_id,0) = IFNULL(?, 0)
  `).get(apiName, recordTypeKey, matterId);
  if (clash) apiName = `${apiName}_${Date.now().toString(36)}`;

  const options = fieldType === 'select'
    ? JSON.stringify(input.options || [])
    : null;

  const info = db.prepare(`
    INSERT INTO custom_fields(
      api_name, label, field_type, options_json, record_type_key, matter_id,
      required, active, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
  `).run(
    apiName,
    label,
    fieldType,
    options,
    recordTypeKey,
    matterId,
    input.required ? 1 : 0,
    actor.id
  );
  const id = Number(info.lastInsertRowid);

  // Auto-add to the relevant layout
  if (matterId) {
    ensureMatterLayout(db, matterId);
    const layout = db.prepare('SELECT id FROM page_layouts WHERE matter_id = ?').get(matterId);
    const max = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM page_layout_items WHERE layout_id = ?'
    ).get(layout.id).m;
    db.prepare(`
      INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
      VALUES (?, ?, 'details', ?, ?)
    `).run(layout.id, `cf:${id}`, max + 1, fieldType === 'textarea' ? 'full' : 'half');
  } else if (recordTypeKey) {
    const layout = ensureTypeLayout(db, recordTypeKey);
    const max = db.prepare(
      'SELECT COALESCE(MAX(sort_order), -1) AS m FROM page_layout_items WHERE layout_id = ?'
    ).get(layout.id).m;
    db.prepare(`
      INSERT INTO page_layout_items(layout_id, field_key, section, sort_order, width)
      VALUES (?, ?, 'details', ?, ?)
    `).run(layout.id, `cf:${id}`, max + 1, fieldType === 'textarea' ? 'full' : 'half');
  }

  audit(db, {
    actorId: actor.id,
    action: 'custom_field.create',
    entityType: 'custom_field',
    entityId: id,
    detail: { apiName, label, recordTypeKey, matterId },
  });

  return getCustomField(db, id);
}

function getCustomField(db, id) {
  const f = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(id);
  if (!f) return null;
  return {
    ...f,
    options: f.options_json ? JSON.parse(f.options_json) : null,
    scope: f.matter_id ? 'record' : (f.record_type_key ? 'record_type' : 'global'),
  };
}

function listCustomFields(db, { recordTypeKey = null, matterId = null } = {}) {
  return db.prepare(`
    SELECT * FROM custom_fields
    WHERE active = 1
      AND (
        (matter_id IS NULL AND record_type_key IS NULL)
        OR (? IS NOT NULL AND record_type_key = ? AND matter_id IS NULL)
        OR (? IS NOT NULL AND matter_id = ?)
      )
    ORDER BY label
  `).all(recordTypeKey, recordTypeKey, matterId, matterId).map((f) => ({
    ...f,
    options: f.options_json ? JSON.parse(f.options_json) : null,
    scope: f.matter_id ? 'record' : (f.record_type_key ? 'record_type' : 'global'),
  }));
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

function getMatterPage(db, matterId) {
  const matter = db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE m.id = ?
  `).get(matterId);
  if (!matter) return null;

  const { layout, source } = resolveLayout(db, matter);
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

  return {
    matter,
    layout: { id: layout.id, name: layout.name, source },
    sections,
    availableFields: [...defs.values()],
  };
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
      'SELECT * FROM custom_fields WHERE id = ? AND active = 1'
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
  STANDARD_FIELDS,
  ensureRecordTypes,
  ensureTypeLayout,
  ensureMatterLayout,
  listRecordTypes,
  createCustomField,
  getCustomField,
  listCustomFields,
  getMatterPage,
  setCustomValues,
  saveLayoutItems,
  resolveLayout,
};
