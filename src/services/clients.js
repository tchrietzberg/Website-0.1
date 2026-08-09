const { audit, getSetting, setSetting } = require('../db');
const customFields = require('./customFields');
const permissions = require('./permissions');
const matterIndex = require('./matterIndex');

/** Always shown on contacts. */
const CONTACT_CORE_FIELD = {
  key: 'name',
  label: 'Name',
  type: 'text',
  width: 'half',
  required: true,
};

/**
 * Optional built-in contact fields — firm enables which appear on create/edit.
 * Company, email, phone, and notes were removed as default contact fields;
 * add custom contact fields in Settings when needed.
 */
const CONTACT_OPTIONAL_STANDARD_FIELDS = [];

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
      SELECT id, name, email, phone, company, notes, record_type, created_at, updated_at
      FROM clients
      ORDER BY name COLLATE NOCASE, id
    `).all();
  }
  const like = `%${query.replace(/%/g, '')}%`;
  return db.prepare(`
    SELECT id, name, email, phone, company, notes, record_type, created_at, updated_at
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
    SELECT id, name, email, phone, company, notes, record_type, created_at, updated_at
    FROM clients WHERE id = ?
  `).get(id);
}

function getClient(db, id, actor = null) {
  const client = getClientRow(db, id);
  if (!client) return null;
  const role = actor?.role || null;
  if (role) permissions.assertCanViewRecords(db, actor, 'contact');
  const canEdit = role ? permissions.canModifyAll(db, role, 'contact') : true;
  const canDelete = role ? permissions.canDelete(db, role, 'contact') : false;
  const pageAccess = canEdit ? 'read_write' : 'read_only';
  const fieldConfig = getContactFieldConfig(db);
  if (role) {
    const visibleStd = (fieldConfig.enabledStandard || []).filter((f) =>
      permissions.isFieldVisibleForProfile(db, 'contact', role, f.key)
    );
    fieldConfig.enabledStandard = visibleStd.map((f) => ({
      ...f,
      readonly: !permissions.isFieldWritableForRole(db, 'contact', role, f.key),
    }));
    fieldConfig.enabledKeys = visibleStd.map((f) => f.key);
  }
  const recordTypeKey = customFields.normalizeRecordTypeKey(
    db,
    client.record_type || customFields.DEFAULT_CONTACT_RECORD_TYPE_KEY,
    { appliesTo: 'client' }
  );
  const fieldTypes = require('./fieldTypes');
  const valueMap = Object.fromEntries(
    customFields.getClientCustomValues(db, id).map((v) => [v.field_id, v.value_text])
  );
  const allClientFields = customFields.listCustomFields(db, {
    appliesTo: 'client',
    recordTypeKey,
    clientId: id,
  });
  const fieldDefs = customFields.listClientFieldDefs(db, { recordTypeKey, clientId: id })
    .filter((f) => !role || permissions.isFieldVisibleForProfile(db, 'contact', role, `cf:${f.fieldId}`))
    .map((f) => {
      let value = valueMap[f.fieldId] ?? null;
      if (fieldTypes.normalizeFieldType(f.type) === 'formula') {
        value = fieldTypes.evaluateFormula(
          f.expression || f.config?.expression,
          allClientFields.map((x) => ({ id: x.id, api_name: x.api_name, label: x.label })),
          valueMap
        );
      }
      const writable = !role || permissions.isFieldWritableForRole(db, 'contact', role, `cf:${f.fieldId}`);
      const system = fieldTypes.isSystemManagedFieldType(f.type);
      return { ...f, value, readonly: system || !writable };
    });
  const customValues = Object.fromEntries(
    fieldDefs.filter((f) => f.value != null).map((f) => [f.fieldId, f.value])
  );
  const recordTypes = customFields.listRecordTypes(db, { appliesTo: 'client' });
  const recordTypeLabel = (recordTypes.find((t) => t.key === recordTypeKey) || {}).label
    || recordTypeKey;
  return {
    client: { ...client, record_type: recordTypeKey },
    recordTypeKey,
    recordTypeLabel,
    fields: fieldDefs,
    customValues,
    fieldConfig,
    pageAccess,
    canEdit,
    canDelete,
  };
}

function createClient(db, actor, input = {}) {
  permissions.assertCanModifyRecords(db, actor, 'contact');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name required');
  const email = input.email != null ? String(input.email).trim() || null : null;
  const phone = input.phone != null ? String(input.phone).trim() || null : null;
  const company = input.company != null ? String(input.company).trim() || null : null;
  const notes = input.notes != null ? String(input.notes).trim() || null : null;
  const customValues = input.customValues && typeof input.customValues === 'object'
    ? input.customValues
    : {};
  const recordTypeKey = customFields.normalizeRecordTypeKey(
    db,
    input.recordTypeKey || input.record_type || customFields.DEFAULT_CONTACT_RECORD_TYPE_KEY,
    { appliesTo: 'client' }
  );

  customFields.assertRequiredCustomValues(db, {
    appliesTo: 'client',
    recordTypeKey,
    values: customValues,
  });

  const info = db.prepare(`
    INSERT INTO clients(name, email, phone, company, notes, record_type)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(name, email, phone, company, notes, recordTypeKey);
  const id = Number(info.lastInsertRowid);

  // Always run so Auto Number fields allocate even when the form omits them.
  customFields.setClientCustomValues(db, actor, id, customValues);

  audit(db, {
    actorId: actor?.id || null,
    action: 'client.create',
    entityType: 'client',
    entityId: id,
    detail: { name, recordTypeKey },
  });
  return getClient(db, id, actor);
}

function updateClient(db, actor, id, patch = {}) {
  permissions.assertCanModifyRecords(db, actor, 'contact');
  const current = getClientRow(db, id);
  if (!current) throw new Error('contact not found');
  permissions.assertCanWriteContactFields(db, actor, patch);

  // Record type is chosen at create and stays fixed afterward.
  if (patch.recordTypeKey != null) delete patch.recordTypeKey;
  if (patch.record_type != null) delete patch.record_type;

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
      clientId: id,
      recordTypeKey: current.record_type || customFields.DEFAULT_CONTACT_RECORD_TYPE_KEY,
      values: merged,
    });
    customFields.setClientCustomValues(db, actor, id, patch.customValues);
  }

  db.prepare(`
    UPDATE clients SET updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
  `).run(id);

  // Keep matter search / global lookup in sync when contact text changes.
  if (patch.name !== undefined || patch.company !== undefined || patch.email !== undefined) {
    const linked = db.prepare('SELECT id FROM matters WHERE client_id = ?').all(id);
    for (const row of linked) matterIndex.indexMatter(db, row.id);
  }

  audit(db, {
    actorId: actor?.id || null,
    action: 'client.update',
    entityType: 'client',
    entityId: id,
  });
  return getClient(db, id, actor);
}

function deleteClient(db, actor, id) {
  permissions.assertCanDeleteRecords(db, actor, 'contact');
  const current = getClientRow(db, id);
  if (!current) throw new Error('contact not found');

  // Payments keep a firm billing history link — block until reassigned/removed.
  let paymentCount = 0;
  try {
    paymentCount = db.prepare(
      'SELECT COUNT(*) AS n FROM payments WHERE client_id = ?'
    ).get(id)?.n || 0;
  } catch (_) {
    paymentCount = 0;
  }
  if (paymentCount > 0) {
    throw new Error(
      `Cannot delete “${current.name}” while ${paymentCount} payment${paymentCount === 1 ? '' : 's'} still reference this contact`
    );
  }

  const linkedMatters = db.prepare(
    'SELECT id FROM matters WHERE client_id = ?'
  ).all(id);
  const matterCount = linkedMatters.length;
  // Matters may exist without a client — unlink before removing the contact.
  if (matterCount > 0) {
    db.prepare('UPDATE matters SET client_id = NULL WHERE client_id = ?').run(id);
    const matterIndex = require('./matterIndex');
    for (const row of linkedMatters) {
      matterIndex.indexMatter(db, row.id);
    }
  }

  const rateCount = db.prepare(`
    SELECT COUNT(*) AS n FROM rates
    WHERE scope = 'client' AND scope_id = ?
  `).get(id)?.n || 0;
  if (rateCount > 0) {
    db.prepare(`DELETE FROM rates WHERE scope = 'client' AND scope_id = ?`).run(id);
  }

  db.prepare('DELETE FROM client_custom_field_values WHERE client_id = ?').run(id);
  // Contact-only field definitions (not type-dependent)
  db.prepare(`
    UPDATE custom_fields SET active = 0
    WHERE IFNULL(applies_to, 'matter') = 'client' AND client_id = ?
  `).run(id);
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);

  audit(db, {
    actorId: actor?.id || null,
    action: 'client.delete',
    entityType: 'client',
    entityId: id,
    detail: { name: current.name, unlinkedMatters: matterCount },
  });
  return {
    ok: true,
    id: Number(id),
    name: current.name,
    unlinkedMatters: matterCount,
  };
}

module.exports = {
  CONTACT_OPTIONAL_STANDARD_FIELDS,
  CONTACT_OPTIONAL_KEYS,
  listClients,
  getClient,
  createClient,
  updateClient,
  deleteClient,
  getContactFieldConfig,
  getEnabledContactStandardKeys,
  setEnabledContactStandardKeys,
};
