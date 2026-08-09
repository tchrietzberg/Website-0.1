/**
 * Custom field type catalog (Salesforce-style subset).
 * Excludes roll-up summary, lookup, and master-detail relationships.
 */

const ALLOWED_FIELD_TYPES = [
  'text',
  'textarea',
  'long_text',
  'rich_text',
  'number',
  'currency',
  'percent',
  'date',
  'datetime',
  'email',
  'phone',
  'url',
  'checkbox',
  'select',
  'multiselect',
  'auto_number',
  'geolocation',
  'formula',
];

/** Practical types for logging time — no formulas, geo, rich text, etc. */
const TIME_ENTRY_FIELD_TYPES = [
  'text',
  'textarea',
  'number',
  'currency',
  'percent',
  'date',
  'checkbox',
  'select',
  'multiselect',
];

const FIELD_TYPE_ALIASES = {
  dropdown: 'select',
  picklist: 'select',
  multi_select: 'multiselect',
  multipicklist: 'multiselect',
  picklist_multi: 'multiselect',
  'picklist (multi-select)': 'multiselect',
  date_time: 'datetime',
  'date/time': 'datetime',
  autonumber: 'auto_number',
  'auto-number': 'auto_number',
  auto: 'auto_number',
  long: 'long_text',
  long_textarea: 'long_text',
  textarea_long: 'long_text',
  rich: 'rich_text',
  richtext: 'rich_text',
  'rich text': 'rich_text',
  geo: 'geolocation',
  location: 'geolocation',
  latlong: 'geolocation',
};

const FULL_WIDTH_TYPES = new Set([
  'textarea',
  'long_text',
  'rich_text',
  'formula',
  'geolocation',
  'multiselect',
]);

const SYSTEM_MANAGED_TYPES = new Set(['auto_number', 'formula']);
const OPTION_LIST_TYPES = new Set(['select', 'multiselect']);

function normalizeFieldType(fieldType) {
  const raw = String(fieldType || 'text').trim().toLowerCase();
  const mapped = FIELD_TYPE_ALIASES[raw] || raw;
  return mapped;
}

function isAllowedFieldType(fieldType) {
  return ALLOWED_FIELD_TYPES.includes(normalizeFieldType(fieldType));
}

function allowedFieldTypesForAppliesTo(appliesTo) {
  const scope = String(appliesTo || 'matter').trim().toLowerCase();
  if (scope === 'time' || scope === 'time_entry' || scope === 'time-entry') {
    return TIME_ENTRY_FIELD_TYPES.slice();
  }
  return ALLOWED_FIELD_TYPES.slice();
}

function isAllowedFieldTypeForAppliesTo(fieldType, appliesTo) {
  const type = normalizeFieldType(fieldType);
  return allowedFieldTypesForAppliesTo(appliesTo).includes(type);
}

function fieldWidthForType(fieldType) {
  const t = normalizeFieldType(fieldType);
  return FULL_WIDTH_TYPES.has(t) ? 'full' : 'half';
}

function isSystemManagedFieldType(fieldType) {
  return SYSTEM_MANAGED_TYPES.has(normalizeFieldType(fieldType));
}

function needsOptionList(fieldType) {
  return OPTION_LIST_TYPES.has(normalizeFieldType(fieldType));
}

/** UI-facing type (select → dropdown for existing clients). */
function uiFieldType(fieldType) {
  const t = normalizeFieldType(fieldType);
  if (t === 'select') return 'dropdown';
  return t;
}

function parseFieldOptions(input = {}) {
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

function encodeFieldOptions(fieldType, input = {}, existingJson = null) {
  const t = normalizeFieldType(fieldType);
  if (needsOptionList(t)) {
    const optionList = parseFieldOptions(input);
    if (!optionList.length) {
      if (existingJson) {
        try {
          const prev = JSON.parse(existingJson);
          const prevList = Array.isArray(prev) ? prev : (prev?.options || []);
          if (prevList.length) return JSON.stringify(prevList);
        } catch { /* fall through */ }
      }
      throw new Error('picklist fields need at least one option');
    }
    return JSON.stringify(optionList);
  }
  if (t === 'auto_number') {
    let prev = {};
    if (existingJson) {
      try { prev = JSON.parse(existingJson) || {}; } catch { prev = {}; }
    }
    const prefix = String(
      input.prefix ?? input.autoNumberPrefix ?? prev.prefix ?? 'AN-'
    ).slice(0, 32);
    const pad = Math.min(
      12,
      Math.max(1, Number(input.pad ?? input.autoNumberPad ?? prev.pad ?? 4) || 4)
    );
    const next = Math.max(
      1,
      Number(input.next ?? input.autoNumberNext ?? prev.next ?? 1) || 1
    );
    return JSON.stringify({ prefix, pad, next });
  }
  if (t === 'formula') {
    let prev = {};
    if (existingJson) {
      try { prev = JSON.parse(existingJson) || {}; } catch { prev = {}; }
    }
    const expression = String(
      input.expression ?? input.formula ?? prev.expression ?? ''
    ).trim();
    if (!expression) throw new Error('formula expression required');
    return JSON.stringify({ expression });
  }
  return null;
}

function decodeFieldOptions(fieldType, optionsJson) {
  if (!optionsJson) return null;
  let parsed;
  try { parsed = JSON.parse(optionsJson); } catch { return null; }
  const t = normalizeFieldType(fieldType);
  if (needsOptionList(t)) {
    return Array.isArray(parsed) ? parsed : (parsed?.options || []);
  }
  return parsed;
}

function isBlankCustomValue(field, value) {
  if (value == null) return true;
  const type = normalizeFieldType(field.field_type || field.fieldType || field.type);
  if (type === 'checkbox') {
    const text = String(value).trim();
    return text !== '1' && text.toLowerCase() !== 'true';
  }
  if (type === 'multiselect') {
    if (Array.isArray(value)) return value.length === 0;
    const text = String(value).trim();
    if (!text) return true;
    try {
      const arr = JSON.parse(text);
      return Array.isArray(arr) ? arr.length === 0 : text === '';
    } catch {
      return text === '';
    }
  }
  if (type === 'geolocation') {
    const text = String(value).trim();
    if (!text) return true;
    const [lat, lng] = text.split(',').map((p) => String(p || '').trim());
    return !lat && !lng;
  }
  return String(value).trim() === '';
}

/** Coerce + lightly validate a value for storage. Returns string or null. */
function normalizeCustomValue(field, value) {
  const type = normalizeFieldType(field.field_type || field.fieldType || field.type);
  if (value == null) return null;
  if (type === 'checkbox') {
    const t = String(value).trim().toLowerCase();
    return (t === '1' || t === 'true' || t === 'on' || t === 'yes') ? '1' : '0';
  }
  if (type === 'multiselect') {
    let arr;
    if (Array.isArray(value)) arr = value;
    else {
      const text = String(value).trim();
      if (!text) return null;
      try {
        const parsed = JSON.parse(text);
        arr = Array.isArray(parsed) ? parsed : text.split(/[\n,]+/);
      } catch {
        arr = text.split(/[\n,]+/);
      }
    }
    const cleaned = arr.map((o) => String(o).trim()).filter(Boolean);
    const allowed = decodeFieldOptions(type, field.options_json)
      || (Array.isArray(field.options) ? field.options : null);
    const filtered = allowed?.length
      ? cleaned.filter((o) => allowed.includes(o))
      : cleaned;
    return filtered.length ? JSON.stringify(filtered) : null;
  }
  if (type === 'number' || type === 'currency' || type === 'percent') {
    const text = String(value).trim();
    if (!text) return null;
    const n = Number(String(text).replace(/[^0-9.+-]/g, ''));
    if (!Number.isFinite(n)) throw new Error(`${field.label || 'Number'} must be numeric`);
    return String(n);
  }
  if (type === 'email') {
    const text = String(value).trim();
    if (!text) return null;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)) {
      throw new Error(`${field.label || 'Email'} must be a valid email`);
    }
    return text;
  }
  if (type === 'url') {
    const text = String(value).trim();
    if (!text) return null;
    const withProto = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
    try {
      // eslint-disable-next-line no-new
      new URL(withProto);
    } catch {
      throw new Error(`${field.label || 'URL'} must be a valid URL`);
    }
    return withProto;
  }
  if (type === 'phone') {
    const text = String(value).trim();
    if (!text) return null;
    return text.replace(/[^\d+().\-\s]/g, '').trim() || null;
  }
  if (type === 'date') {
    const text = String(value).trim();
    if (!text) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new Error(`${field.label || 'Date'} must be YYYY-MM-DD`);
    }
    return text;
  }
  if (type === 'datetime') {
    const text = String(value).trim();
    if (!text) return null;
    // Accept datetime-local (YYYY-MM-DDTHH:mm) or with seconds
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?/.test(text)) {
      throw new Error(`${field.label || 'Date/Time'} must include date and time`);
    }
    return text.slice(0, 19);
  }
  if (type === 'geolocation') {
    if (typeof value === 'object' && value && ('lat' in value || 'lng' in value)) {
      const lat = value.lat == null ? '' : String(value.lat).trim();
      const lng = value.lng == null ? '' : String(value.lng).trim();
      if (!lat && !lng) return null;
      return `${lat},${lng}`;
    }
    const text = String(value).trim();
    if (!text) return null;
    const parts = text.split(',').map((p) => p.trim());
    if (parts.length < 2) throw new Error(`${field.label || 'Geolocation'} needs latitude and longitude`);
    const lat = Number(parts[0]);
    const lng = Number(parts[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new Error(`${field.label || 'Geolocation'} must be numeric coordinates`);
    }
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      throw new Error(`${field.label || 'Geolocation'} coordinates out of range`);
    }
    return `${lat},${lng}`;
  }
  if (type === 'text') {
    return String(value).slice(0, 255);
  }
  if (type === 'long_text') {
    return String(value).slice(0, 131000);
  }
  if (type === 'rich_text' || type === 'textarea') {
    return String(value).slice(0, 131000);
  }
  if (type === 'auto_number' || type === 'formula') {
    const text = String(value).trim();
    return text || null;
  }
  const text = String(value).trim();
  return text === '' ? null : text;
}

function allocateAutoNumber(db, fieldRow) {
  const cfg = decodeFieldOptions('auto_number', fieldRow.options_json) || {
    prefix: 'AN-',
    pad: 4,
    next: 1,
  };
  const n = Math.max(1, Number(cfg.next) || 1);
  const pad = Math.min(12, Math.max(1, Number(cfg.pad) || 4));
  const prefix = String(cfg.prefix ?? 'AN-');
  const value = `${prefix}${String(n).padStart(pad, '0')}`;
  const nextCfg = { prefix, pad, next: n + 1 };
  db.prepare('UPDATE custom_fields SET options_json = ? WHERE id = ?')
    .run(JSON.stringify(nextCfg), fieldRow.id);
  return value;
}

function safeEvalMath(expr) {
  const cleaned = String(expr || '').replace(/\s+/g, '');
  if (!cleaned) return '';
  if (!/^[0-9+\-*/().]+$/.test(cleaned)) return '';
  try {
    // Controlled arithmetic only (charset-gated above).
    // eslint-disable-next-line no-new-func
    const result = Function(`"use strict"; return (${cleaned});`)();
    if (typeof result === 'number' && Number.isFinite(result)) {
      return Number.isInteger(result) ? String(result) : String(Math.round(result * 1000) / 1000);
    }
    return result == null ? '' : String(result);
  } catch {
    return '';
  }
}

/**
 * Evaluate a formula expression using sibling field values.
 * Tokens: {api_name}, {Label}, {cf:id}
 */
function evaluateFormula(expression, fields, valuesById) {
  let expr = String(expression || '');
  if (!expr) return '';

  const byApi = new Map();
  const byLabel = new Map();
  for (const f of fields || []) {
    const id = Number(f.id);
    const raw = valuesById[id] ?? valuesById[String(id)] ?? '';
    const num = Number(String(raw).replace(/[^0-9.+-]/g, ''));
    const tokenVal = Number.isFinite(num) && String(raw).trim() !== '' ? String(num) : '0';
    if (f.api_name) byApi.set(String(f.api_name).toLowerCase(), tokenVal);
    if (f.label) byLabel.set(String(f.label).toLowerCase(), tokenVal);
    byApi.set(`cf:${id}`, tokenVal);
  }

  expr = expr.replace(/\{([^}]+)\}/g, (_, rawKey) => {
    const key = String(rawKey).trim();
    const lower = key.toLowerCase();
    if (byApi.has(lower)) return byApi.get(lower);
    if (byLabel.has(lower)) return byLabel.get(lower);
    if (/^cf:\d+$/i.test(key) && byApi.has(key.toLowerCase())) return byApi.get(key.toLowerCase());
    return '0';
  });

  return safeEvalMath(expr);
}

/** SQL CHECK list for migrations / schema. */
function fieldTypeCheckSql() {
  return ALLOWED_FIELD_TYPES.map((t) => `'${t}'`).join(',');
}

module.exports = {
  ALLOWED_FIELD_TYPES,
  TIME_ENTRY_FIELD_TYPES,
  FIELD_TYPE_ALIASES,
  FULL_WIDTH_TYPES,
  SYSTEM_MANAGED_TYPES,
  normalizeFieldType,
  isAllowedFieldType,
  allowedFieldTypesForAppliesTo,
  isAllowedFieldTypeForAppliesTo,
  fieldWidthForType,
  isSystemManagedFieldType,
  needsOptionList,
  uiFieldType,
  parseFieldOptions,
  encodeFieldOptions,
  decodeFieldOptions,
  isBlankCustomValue,
  normalizeCustomValue,
  allocateAutoNumber,
  evaluateFormula,
  fieldTypeCheckSql,
};
