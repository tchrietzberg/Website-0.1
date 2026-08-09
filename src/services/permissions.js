const { getSetting, setSetting, audit } = require('../db');

const PROFILES = [
  { key: 'admin', label: 'Admin' },
  { key: 'attorney', label: 'Attorney' },
  { key: 'paralegal', label: 'Paralegal' },
  { key: 'billing_clerk', label: 'Billing clerk' },
];

const PROFILE_KEYS = PROFILES.map((p) => p.key);
const ACCESS_MODES = ['read_only', 'read_write'];
const PROFILE_PERMISSIONS_KEY = 'profile_permissions';
const RECORD_PAGE_LAYOUT_KEY = 'record_page_layout';

const DEFAULT_PROFILE_PERMISSIONS = Object.fromEntries(
  PROFILE_KEYS.map((key) => [key, 'read_write'])
);

function normalizeAccessMode(value, fallback = 'read_write') {
  const mode = String(value || '').trim().toLowerCase().replace(/[-\s]+/g, '_');
  if (mode === 'readonly' || mode === 'read_only') return 'read_only';
  if (mode === 'readwrite' || mode === 'read_write' || mode === 'write') return 'read_write';
  return fallback;
}

function getProfilePermissions(db) {
  const raw = getSetting(db, PROFILE_PERMISSIONS_KEY, null);
  let parsed = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw) || {};
    } catch {
      parsed = {};
    }
  }
  const out = {};
  for (const key of PROFILE_KEYS) {
    out[key] = normalizeAccessMode(parsed[key], DEFAULT_PROFILE_PERMISSIONS[key]);
  }
  return out;
}

function setProfilePermissions(db, actor, input = {}) {
  const current = getProfilePermissions(db);
  const next = { ...current };
  for (const key of PROFILE_KEYS) {
    if (input[key] !== undefined) {
      next[key] = normalizeAccessMode(input[key], current[key]);
    }
  }
  // Admin always keeps write access so settings cannot lock the firm out.
  next.admin = 'read_write';
  setSetting(db, PROFILE_PERMISSIONS_KEY, JSON.stringify(next));
  audit(db, {
    actorId: actor?.id || null,
    action: 'profile_permissions.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: next,
  });
  return next;
}

function getProfileAccess(db, role) {
  const key = PROFILE_KEYS.includes(role) ? role : null;
  if (!key) return 'read_only';
  return getProfilePermissions(db)[key] || 'read_write';
}

function assertCanWriteRecords(db, actor, areaLabel = 'records') {
  const mode = getProfileAccess(db, actor?.role);
  if (mode !== 'read_write') {
    throw new Error(`${areaLabel} are read only for your profile`);
  }
}

function getRecordPageLayout(db) {
  const raw = getSetting(db, RECORD_PAGE_LAYOUT_KEY, null);
  if (!raw) return { matter: {}, contact: {} };
  try {
    const parsed = JSON.parse(raw) || {};
    return {
      matter: parsed.matter && typeof parsed.matter === 'object' ? parsed.matter : {},
      contact: parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {},
    };
  } catch {
    return { matter: {}, contact: {} };
  }
}

function normalizeVisibilityMap(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [fieldKey, profileMap] of Object.entries(input)) {
    const key = String(fieldKey || '').trim();
    if (!key) continue;
    const row = {};
    const src = profileMap && typeof profileMap === 'object' ? profileMap : {};
    for (const profile of PROFILE_KEYS) {
      if (src[profile] === undefined) continue;
      row[profile] = !!src[profile];
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

function setRecordPageLayout(db, actor, input = {}) {
  const current = getRecordPageLayout(db);
  const next = {
    matter: input.matter !== undefined
      ? normalizeVisibilityMap(input.matter)
      : current.matter,
    contact: input.contact !== undefined
      ? normalizeVisibilityMap(input.contact)
      : current.contact,
  };
  setSetting(db, RECORD_PAGE_LAYOUT_KEY, JSON.stringify(next));
  audit(db, {
    actorId: actor?.id || null,
    action: 'record_page_layout.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: {
      matterFields: Object.keys(next.matter).length,
      contactFields: Object.keys(next.contact).length,
    },
  });
  return next;
}

/** Missing entries default to visible. Core name is always shown. */
function isFieldVisibleForProfile(db, page, role, fieldKey) {
  const key = String(fieldKey || '');
  if (key === 'name' || key === 'std:name') return true;
  const layout = getRecordPageLayout(db);
  const pageMap = layout[page] || {};
  const row = pageMap[key];
  if (!row || typeof row !== 'object') return true;
  if (!PROFILE_KEYS.includes(role)) return true;
  if (row[role] === undefined) return true;
  return !!row[role];
}

function catalogMatterLayoutFields(db) {
  const customFields = require('./customFields');
  customFields.ensureRecordTypes(db);
  const standards = customFields.STANDARD_FIELDS
    .filter((f) => f.key !== 'std:number')
    .map((f) => ({
      key: f.key,
      label: f.label,
      kind: 'standard',
      group: 'Matter fields',
    }));
  const customs = [];
  for (const type of customFields.listRecordTypes(db)) {
    for (const f of customFields.listCustomFields(db, {
      appliesTo: 'matter',
      recordTypeKey: type.key,
    })) {
      customs.push({
        key: `cf:${f.id}`,
        label: `${f.label} (${type.label})`,
        kind: 'custom',
        group: 'Custom fields',
        fieldId: f.id,
      });
    }
  }
  // Dedupe custom keys (same field should not appear twice)
  const seen = new Set();
  const uniqueCustoms = customs.filter((f) => {
    if (seen.has(f.key)) return false;
    seen.add(f.key);
    return true;
  });
  return [...standards, ...uniqueCustoms];
}

function catalogContactLayoutFields(db) {
  const clientsSvc = require('./clients');
  const customFields = require('./customFields');
  const config = clientsSvc.getContactFieldConfig(db);
  const standards = [
    ...config.core.map((f) => ({
      key: f.key,
      label: f.label,
      kind: 'standard',
      group: 'Contact fields',
    })),
    ...config.enabledStandard.map((f) => ({
      key: f.key,
      label: f.label,
      kind: 'standard',
      group: 'Contact fields',
    })),
  ];
  const customs = customFields.listCustomFields(db, { appliesTo: 'client' }).map((f) => ({
    key: `cf:${f.id}`,
    label: f.label,
    kind: 'custom',
    group: 'Custom fields',
    fieldId: f.id,
  }));
  return [...standards, ...customs];
}

function getPermissionsSettings(db) {
  const layout = getRecordPageLayout(db);
  return {
    profiles: PROFILES,
    profilePermissions: getProfilePermissions(db),
    recordPageLayout: layout,
    matterFields: catalogMatterLayoutFields(db),
    contactFields: catalogContactLayoutFields(db),
  };
}

module.exports = {
  PROFILES,
  PROFILE_KEYS,
  ACCESS_MODES,
  getProfilePermissions,
  setProfilePermissions,
  getProfileAccess,
  assertCanWriteRecords,
  getRecordPageLayout,
  setRecordPageLayout,
  isFieldVisibleForProfile,
  catalogMatterLayoutFields,
  catalogContactLayoutFields,
  getPermissionsSettings,
};
