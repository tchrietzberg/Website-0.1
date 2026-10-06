const customFields = require('./customFields');

const NAME_SEP = ' - ';
const CASE_TYPE_LABEL = 'Case Type';
const STATUS_LABEL = 'Status';
const TICKER_LABEL = 'Ticker';
const CASE_TYPE_OPTIONS = ['Securities Class Action'];
const STATUS_OPTIONS = [
  'Possible',
  'Open',
  'Closed',
  'Outreach',
  'Archived',
  'Post Settlement',
];
const DEFAULT_STATUS = 'Possible';

function systemActor() {
  return { id: null, role: 'admin' };
}

function yearFromOpenedOn(openedOn) {
  const y = String(openedOn || '').trim().slice(0, 4);
  return /^\d{4}$/.test(y) ? y : String(new Date().getUTCFullYear());
}

function findTypeField(db, { appliesTo, recordTypeKey, label, apiName }) {
  return db.prepare(`
    SELECT * FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = ?
      AND IFNULL(record_type_key, '') = IFNULL(?, '')
      AND matter_id IS NULL
      AND client_id IS NULL
      AND (lower(label) = lower(?) OR api_name = ?)
    ORDER BY CASE WHEN api_name = ? THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get(appliesTo, recordTypeKey || null, label, apiName, apiName);
}

function ensureTypeField(db, {
  appliesTo,
  recordTypeKey,
  label,
  apiName,
  fieldType,
  options,
  required = false,
  isDefault = true,
}) {
  const existing = findTypeField(db, { appliesTo, recordTypeKey, label, apiName });
  if (existing) {
    const type = String(existing.field_type || '');
    if (options && (type === 'select' || type === 'dropdown')) {
      const field = customFields.getCustomField(db, existing.id);
      const have = new Set((field.options || []).map((o) => String(o)));
      const missing = (options || []).filter((o) => !have.has(String(o)));
      if (missing.length) {
        customFields.updateCustomField(db, systemActor(), existing.id, {
          options: [...(field.options || []), ...missing],
        });
      }
    }
    return customFields.getCustomField(db, existing.id);
  }
  return customFields.createCustomField(db, systemActor(), {
    label,
    apiName,
    fieldType,
    options,
    appliesTo,
    recordTypeKey,
    required,
    isDefault,
  });
}

function ensureStandardMatterNomenclature(db) {
  customFields.ensureRecordTypes(db);
  const matterTypes = customFields.listRecordTypes(db, { appliesTo: 'matter' }) || [];
  const caseTypeFields = [];
  const statusFields = [];
  for (const type of matterTypes) {
    const caseType = ensureTypeField(db, {
      appliesTo: 'matter',
      recordTypeKey: type.key,
      label: CASE_TYPE_LABEL,
      apiName: 'case_type',
      fieldType: 'select',
      options: CASE_TYPE_OPTIONS,
      required: false,
      isDefault: true,
    });
    const status = ensureTypeField(db, {
      appliesTo: 'matter',
      recordTypeKey: type.key,
      label: STATUS_LABEL,
      apiName: 'nomenclature_status',
      fieldType: 'select',
      options: STATUS_OPTIONS,
      required: false,
      isDefault: true,
    });
    caseTypeFields.push(caseType);
    statusFields.push(status);
  }
  const ticker = ensureTypeField(db, {
    appliesTo: 'client',
    recordTypeKey: 'company',
    label: TICKER_LABEL,
    apiName: 'ticker',
    fieldType: 'text',
    required: false,
    isDefault: true,
  });
  return {
    ticker,
    caseTypeFields,
    statusFields,
    separator: NAME_SEP,
    pattern: 'Ticker - Year - Company - Case Type - Status',
    statusOptions: STATUS_OPTIONS,
    caseTypeOptions: CASE_TYPE_OPTIONS,
    defaultStatus: DEFAULT_STATUS,
  };
}

function tickerField(db) {
  return db.prepare(`
    SELECT id FROM custom_fields
    WHERE active = 1
      AND IFNULL(applies_to, 'matter') = 'client'
      AND lower(label) = 'ticker'
    ORDER BY CASE WHEN record_type_key = 'company' THEN 0 ELSE 1 END, id
    LIMIT 1
  `).get();
}

function tickerForClient(db, clientId) {
  if (clientId == null) return '';
  const field = tickerField(db);
  if (!field) return '';
  const row = db.prepare(`
    SELECT value_text FROM client_custom_field_values
    WHERE client_id = ? AND field_id = ?
  `).get(Number(clientId), field.id);
  return row?.value_text ? String(row.value_text).trim() : '';
}

function ensureClientTicker(db, clientId, ticker) {
  const value = String(ticker || '').trim();
  if (!clientId) return '';
  const spec = ensureStandardMatterNomenclature(db);
  const fieldId = spec.ticker?.id;
  if (!fieldId) return value;
  if (value) {
    db.prepare(`
      INSERT INTO client_custom_field_values(client_id, field_id, value_text)
      VALUES (?, ?, ?)
      ON CONFLICT(client_id, field_id) DO UPDATE SET value_text = excluded.value_text
    `).run(Number(clientId), fieldId, value);
    db.prepare(`
      UPDATE clients SET record_type = 'company',
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ? AND IFNULL(record_type, '') != 'company'
    `).run(Number(clientId));
  }
  return tickerForClient(db, clientId);
}

function companyName(db, clientId) {
  if (clientId == null) return '';
  const row = db.prepare('SELECT name FROM clients WHERE id = ?').get(Number(clientId));
  return row?.name ? String(row.name).trim() : '';
}

function fieldValueFromCustom(customValues, field) {
  if (!field || !customValues) return '';
  const raw = customValues[field.id] ?? customValues[String(field.id)];
  return raw == null ? '' : String(raw).trim();
}

function caseTypeFieldForMatter(db, recordTypeKey) {
  const spec = ensureStandardMatterNomenclature(db);
  return (spec.caseTypeFields || []).find((f) => f.record_type_key === recordTypeKey)
    || spec.caseTypeFields[0]
    || null;
}

function statusFieldForMatter(db, recordTypeKey) {
  const spec = ensureStandardMatterNomenclature(db);
  return (spec.statusFields || []).find((f) => f.record_type_key === recordTypeKey)
    || spec.statusFields[0]
    || null;
}

function customValuesForMatter(db, matterId) {
  const rows = db.prepare(`
    SELECT field_id, value_text FROM custom_field_values WHERE matter_id = ?
  `).all(matterId);
  const values = {};
  for (const row of rows) values[row.field_id] = row.value_text;
  return values;
}

function buildRequiredMatterName(db, {
  clientId = null,
  ticker = null,
  company = null,
  customValues = {},
  openedOn = null,
  recordTypeKey = customFields.DEFAULT_RECORD_TYPE_KEY,
} = {}) {
  ensureStandardMatterNomenclature(db);
  const tickerValue = String(ticker || tickerForClient(db, clientId) || '').trim();
  const year = yearFromOpenedOn(openedOn);
  const companyValue = String(company || companyName(db, clientId) || '').trim();
  const caseTypeField = caseTypeFieldForMatter(db, recordTypeKey);
  const statusField = statusFieldForMatter(db, recordTypeKey);
  const caseType = fieldValueFromCustom(customValues, caseTypeField);
  const status = fieldValueFromCustom(customValues, statusField) || DEFAULT_STATUS;
  const missing = [];
  if (!tickerValue) missing.push('Ticker');
  if (!companyValue) missing.push('Company');
  if (!caseType) missing.push('Case Type');
  const name = [tickerValue, year, companyValue, caseType, status]
    .filter(Boolean)
    .join(NAME_SEP);
  return {
    name,
    complete: missing.length === 0 && !!caseType,
    missing,
    parts: { ticker: tickerValue, year, company: companyValue, caseType, status },
    fields: {
      tickerId: tickerField(db)?.id || null,
      caseTypeId: caseTypeField?.id || null,
      statusId: statusField?.id || null,
    },
  };
}

function rebuildMatterDisplayName(db, actor, matterId) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) return null;
  const built = buildRequiredMatterName(db, {
    clientId: matter.client_id,
    customValues: customValuesForMatter(db, matterId),
    openedOn: matter.opened_on,
    recordTypeKey: matter.matter_type,
  });
  if (!built.complete) return built;
  const clash = db.prepare(`
    SELECT id, name, number FROM matters
    WHERE id != ? AND lower(name) = lower(?)
  `).get(matterId, built.name);
  if (clash) {
    throw new Error(
      `A matter named “${clash.name}” already exists${clash.number ? ` (${clash.number})` : ''}`
    );
  }
  if (built.name !== matter.name) {
    db.prepare('UPDATE matters SET name = ? WHERE id = ?').run(built.name, matterId);
    db.prepare(`
      INSERT INTO matter_field_history(matter_id, field_name, old_value, new_value, changed_by)
      VALUES (?, 'name', ?, ?, ?)
    `).run(matterId, matter.name, built.name, actor?.id || null);
  }
  return built;
}

function rebuildMattersForClient(db, actor, clientId) {
  const rows = db.prepare('SELECT id FROM matters WHERE client_id = ?').all(clientId);
  for (const row of rows) {
    rebuildMatterDisplayName(db, actor, row.id);
  }
}

function getNomenclatureConfig(db) {
  const spec = ensureStandardMatterNomenclature(db);
  return {
    required: true,
    separator: NAME_SEP,
    pattern: spec.pattern,
    previewExample: `FRD${NAME_SEP}2026${NAME_SEP}FORD${NAME_SEP}Securities Class Action${NAME_SEP}Possible`,
    defaultStatus: DEFAULT_STATUS,
    statusOptions: STATUS_OPTIONS,
    caseTypeOptions: CASE_TYPE_OPTIONS,
    tickerFieldId: spec.ticker?.id || null,
    caseTypeFieldIds: (spec.caseTypeFields || []).map((f) => f.id),
    statusFieldIds: (spec.statusFields || []).map((f) => f.id),
  };
}

module.exports = {
  NAME_SEP,
  DEFAULT_STATUS,
  CASE_TYPE_OPTIONS,
  STATUS_OPTIONS,
  ensureStandardMatterNomenclature,
  tickerForClient,
  ensureClientTicker,
  buildRequiredMatterName,
  rebuildMatterDisplayName,
  rebuildMattersForClient,
  getNomenclatureConfig,
  yearFromOpenedOn,
};
