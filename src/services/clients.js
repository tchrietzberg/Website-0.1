const { audit, getSetting, setSetting } = require('../db');
const customFields = require('./customFields');

/** Always shown on contacts. */
const CONTACT_CORE_FIELD = {
  key: 'name',
  label: 'Name',
  type: 'text',
  width: 'half',
  required: true,
};

/** Optional built-in contact fields — firm enables which appear on create/edit. */
const CONTACT_OPTIONAL_STANDARD_FIELDS = [
  { key: 'company', label: 'Company', type: 'text', width: 'half' },
  { key: 'email', label: 'Email', type: 'email', width: 'half' },
  { key: 'phone', label: 'Phone', type: 'text', width: 'half' },
  { key: 'notes', label: 'Notes', type: 'textarea', width: 'full' },
];

const CONTACT_OPTIONAL_KEYS = CONTACT_OPTIONAL_STANDARD_FIELDS.map((f) => f.key);
const CONTACT_STANDARD_SETTING = 'contact_standard_fields';

function normalizeContactStandardKeys(keys) {
  const wanted = new Set(
    (Array.isArray(keys) ? keys : [])
      .map((k) => String(k || '').trim())
      .filter((k) => CONTACT_OPTIONAL_KEYS.includes(k))
  );
  return CONTACT_OPTIONAL_KEYS.filter((k) => wanted.has(k));
}

/** Default: none of the optional built-ins — users pick which to show. */
function getEnabledContactStandardKeys(db) {
  const raw = getSetting(db, CONTACT_STANDARD_SETTING, null);
  if (raw == null || raw === '') return [];
  try {
    return normalizeContactStandardKeys(JSON.parse(raw));
  } catch {
    return [];
  }
}

function setEnabledContactStandardKeys(db, actor, keys) {
  const enabled = normalizeContactStandardKeys(keys);
  setSetting(db, CONTACT_STANDARD_SETTING, JSON.stringify(enabled));
  audit(db, {
    actorId: actor?.id || null,
    action: 'contact.standard_fields.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: { enabled },
  });
  return getContactFieldConfig(db);
}

function getContactFieldConfig(db) {
  const enabledKeys = getEnabledContactStandardKeys(db);
  const enabledSet = new Set(enabledKeys);
  return {
    core: [CONTACT_CORE_FIELD],
    enabledStandard: CONTACT_OPTIONAL_STANDARD_FIELDS
      .filter((f) => enabledSet.has(f.key))
      .map((f) => ({ ...f, kind: 'standard', removable: true })),
    availableStandard: CONTACT_OPTIONAL_STANDARD_FIELDS
      .filter((f) => !enabledSet.has(f.key))
      .map((f) => ({ ...f, kind: 'standard' })),
    enabledKeys,
  };
}

function listClients(db, { q = '' } = {}) {
  const query = String(q || '').trim();
  if (!query) {
    return db.prepare(`
      SELECT id, name, email, phone, company, notes, created_at, updated_at
      FROM clients
      ORDER BY name COLLATE NOCASE, id
    `).all();
  }
  const like = `%${query.replace(/%/g, '')}%`;
  return db.prepare(`
    SELECT id, name, email, phone, company, notes, created_at, updated_at
    FROM clients
    WHERE name LIKE ? COLLATE NOCASE
       OR IFNULL(email,'') LIKE ? COLLATE NOCASE
       OR IFNULL(phone,'') LIKE ? COLLATE NOCASE
       OR IFNULL(company,'') LIKE ? COLLATE NOCASE
    ORDER BY name COLLATE NOCASE, id
  `).all(like, like, like, like);
}

function getClientRow(db, id) {
  return db.prepare(`
    SELECT id, name, email, phone, company, notes, created_at, updated_at
    FROM clients WHERE id = ?
  `).get(id);
}

function getClient(db, id) {
  const client = getClientRow(db, id);
  if (!client) return null;
  const fieldDefs = customFields.listClientFieldDefs(db).map((f) => {
    const stored = db.prepare(`
      SELECT value_text FROM client_custom_field_values
      WHERE client_id = ? AND field_id = ?
    `).get(id, f.fieldId);
    return { ...f, value: stored?.value_text ?? null };
  });
  const customValues = Object.fromEntries(
    fieldDefs.filter((f) => f.value != null).map((f) => [f.fieldId, f.value])
  );
  return {
    client,
    fields: fieldDefs,
    customValues,
    fieldConfig: getContactFieldConfig(db),
  };
}

function createClient(db, actor, input = {}) {
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const email = input.email != null ? String(input.email).trim() || null : null;
  const phone = input.phone != null ? String(input.phone).trim() || null : null;
  const company = input.company != null ? String(input.company).trim() || null : null;
  const notes = input.notes != null ? String(input.notes).trim() || null : null;
  const customValues = input.customValues && typeof input.customValues === 'object'
    ? input.customValues
    : {};

  customFields.assertRequiredCustomValues(db, {
    appliesTo: 'client',
    values: customValues,
  });

  const info = db.prepare(`
    INSERT INTO clients(name, email, phone, company, notes)
    VALUES (?, ?, ?, ?, ?)
  `).run(name, email, phone, company, notes);
  const id = Number(info.lastInsertRowid);

  if (Object.keys(customValues).length) {
    customFields.setClientCustomValues(db, actor, id, customValues);
  }

  audit(db, {
    actorId: actor?.id || null,
    action: 'client.create',
    entityType: 'client',
    entityId: id,
    detail: { name },
  });
  return getClient(db, id);
}

function updateClient(db, actor, id, patch = {}) {
  const current = getClientRow(db, id);
  if (!current) throw new Error('contact not found');

  const map = {
    name: 'name',
    email: 'email',
    phone: 'phone',
    company: 'company',
    notes: 'notes',
  };
  for (const [key, col] of Object.entries(map)) {
    if (patch[key] === undefined) continue;
    let newVal = patch[key];
    if (key === 'name') {
      newVal = String(newVal || '').trim();
      if (!newVal) throw new Error('name required');
    } else {
      newVal = newVal == null || newVal === '' ? null : String(newVal).trim();
    }
    if (String(current[col] ?? '') === String(newVal ?? '')) continue;
    db.prepare(`UPDATE clients SET ${col} = ? WHERE id = ?`).run(newVal, id);
  }

  if (patch.customValues) {
    const existing = Object.fromEntries(
      db.prepare('SELECT field_id, value_text FROM client_custom_field_values WHERE client_id = ?')
        .all(id)
        .map((v) => [v.field_id, v.value_text])
    );
    const merged = { ...existing, ...patch.customValues };
    customFields.assertRequiredCustomValues(db, {
      appliesTo: 'client',
      values: merged,
    });
    customFields.setClientCustomValues(db, actor, id, patch.customValues);
  }

  db.prepare(`
    UPDATE clients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
  `).run(id);

  audit(db, {
    actorId: actor?.id || null,
    action: 'client.update',
    entityType: 'client',
    entityId: id,
  });
  return getClient(db, id);
}

module.exports = {
  CONTACT_OPTIONAL_STANDARD_FIELDS,
  CONTACT_OPTIONAL_KEYS,
  listClients,
  getClient,
  createClient,
  updateClient,
  getContactFieldConfig,
  getEnabledContactStandardKeys,
  setEnabledContactStandardKeys,
};
