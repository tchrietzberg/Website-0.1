const { getSetting, setSetting, audit } = require('../db');

const ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'attorney', label: 'Attorney' },
  { key: 'paralegal', label: 'Paralegal' },
  { key: 'billing_clerk', label: 'Billing clerk' },
];

/** @deprecated use ROLES */
const PROFILES = ROLES;

const ROLE_KEYS = ROLES.map((r) => r.key);
/** @deprecated use ROLE_KEYS */
const PROFILE_KEYS = ROLE_KEYS;

const OBJECT_KEYS = ['matter', 'contact', 'time'];
const OBJECT_LABELS = {
  matter: 'Matters',
  contact: 'Contacts',
  time: 'Time entries',
};

const FIELD_MODES = ['hidden', 'read', 'write'];
const ACCESS_MODES = ['read_only', 'read_write']; // legacy compat

const ROLE_PERMISSIONS_KEY = 'role_permissions';
const PROFILE_PERMISSIONS_KEY = 'profile_permissions'; // legacy
const RECORD_PAGE_LAYOUT_KEY = 'record_page_layout';

function defaultObjectPerms(full = true) {
  return {
    viewAll: full,
    modifyAll: full,
    delete: full,
  };
}

function defaultRolePermissions(full = true) {
  return Object.fromEntries(
    ROLE_KEYS.map((key) => [
      key,
      {
        objects: Object.fromEntries(
          OBJECT_KEYS.map((obj) => [obj, defaultObjectPerms(full)])
        ),
      },
    ])
  );
}

function normalizeBool(value, fallback = true) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(v)) return true;
    if (['0', 'false', 'no', 'off'].includes(v)) return false;
  }
  return !!value;
}

function normalizeObjectPerms(input = {}, fallback = defaultObjectPerms(true)) {
  return {
    viewAll: normalizeBool(input.viewAll ?? input.view_all, fallback.viewAll),
    modifyAll: normalizeBool(input.modifyAll ?? input.modify_all, fallback.modifyAll),
    delete: normalizeBool(input.delete, fallback.delete),
  };
}

function normalizeRoleEntry(input, fallback = null) {
  const base = fallback || {
    objects: Object.fromEntries(OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true)])),
  };
  // Legacy string mode: 'read_only' | 'read_write'
  if (typeof input === 'string') {
    const mode = String(input).trim().toLowerCase().replace(/[-\s]+/g, '_');
    const full = !(mode === 'readonly' || mode === 'read_only');
    return {
      objects: Object.fromEntries(
        OBJECT_KEYS.map((o) => [o, {
          viewAll: true,
          modifyAll: full,
          delete: full,
        }])
      ),
    };
  }
  const src = input && typeof input === 'object' ? input : {};
  const objectsSrc = src.objects && typeof src.objects === 'object' ? src.objects : src;
  const objects = {};
  for (const obj of OBJECT_KEYS) {
    objects[obj] = normalizeObjectPerms(
      objectsSrc[obj] || {},
      base.objects?.[obj] || defaultObjectPerms(true)
    );
  }
  return { objects };
}

function readRawRolePermissions(db) {
  const raw = getSetting(db, ROLE_PERMISSIONS_KEY, null)
    || getSetting(db, PROFILE_PERMISSIONS_KEY, null);
  if (!raw) return null;
  try {
    return JSON.parse(raw) || null;
  } catch {
    return null;
  }
}

function getRolePermissions(db) {
  const parsed = readRawRolePermissions(db) || {};
  const out = {};
  for (const key of ROLE_KEYS) {
    out[key] = normalizeRoleEntry(parsed[key], defaultRolePermissions(true)[key]);
  }
  // Admin always keeps full access so settings cannot lock the firm out.
  out.admin = {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true)])
    ),
  };
  return out;
}

/** @deprecated use getRolePermissions */
function getProfilePermissions(db) {
  const roles = getRolePermissions(db);
  const legacy = {};
  for (const key of ROLE_KEYS) {
    const objs = roles[key].objects;
    const canModify = OBJECT_KEYS.every((o) => objs[o].modifyAll);
    legacy[key] = canModify ? 'read_write' : 'read_only';
  }
  return legacy;
}

function setRolePermissions(db, actor, input = {}) {
  const current = getRolePermissions(db);
  const next = {};
  for (const key of ROLE_KEYS) {
    if (input[key] !== undefined) {
      next[key] = normalizeRoleEntry(input[key], current[key]);
    } else {
      next[key] = current[key];
    }
  }
  next.admin = {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true)])
    ),
  };
  setSetting(db, ROLE_PERMISSIONS_KEY, JSON.stringify(next));
  // Keep legacy key in sync for older readers.
  setSetting(db, PROFILE_PERMISSIONS_KEY, JSON.stringify(getProfilePermissionsFromRoles(next)));
  audit(db, {
    actorId: actor?.id || null,
    action: 'role_permissions.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: next,
  });
  return next;
}

function getProfilePermissionsFromRoles(roles) {
  const legacy = {};
  for (const key of ROLE_KEYS) {
    const objs = roles[key].objects;
    const canModify = OBJECT_KEYS.every((o) => objs[o].modifyAll);
    legacy[key] = canModify ? 'read_write' : 'read_only';
  }
  return legacy;
}

/** @deprecated use setRolePermissions */
function setProfilePermissions(db, actor, input = {}) {
  // Accept legacy { role: 'read_only'|'read_write' } or new object shape.
  return setRolePermissions(db, actor, input);
}

function getRoleObjectAccess(db, role, objectKey) {
  const key = ROLE_KEYS.includes(role) ? role : null;
  if (!key || !OBJECT_KEYS.includes(objectKey)) {
    return defaultObjectPerms(false);
  }
  return getRolePermissions(db)[key].objects[objectKey];
}

function canViewAll(db, role, objectKey) {
  return !!getRoleObjectAccess(db, role, objectKey).viewAll;
}

function canModifyAll(db, role, objectKey) {
  return !!getRoleObjectAccess(db, role, objectKey).modifyAll;
}

function canDelete(db, role, objectKey) {
  return !!getRoleObjectAccess(db, role, objectKey).delete;
}

/** Legacy: read_write if modifyAll on all objects, else read_only. */
function getProfileAccess(db, role) {
  const key = ROLE_KEYS.includes(role) ? role : null;
  if (!key) return 'read_only';
  const objs = getRolePermissions(db)[key].objects;
  return OBJECT_KEYS.every((o) => objs[o].modifyAll) ? 'read_write' : 'read_only';
}

function assertCanViewRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canViewAll(db, actor?.role, objectKey)) {
    throw new Error(`${label} are not viewable for your role`);
  }
}

function assertCanModifyRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canModifyAll(db, actor?.role, objectKey)) {
    throw new Error(`${label} are read only for your role`);
  }
}

function assertCanDeleteRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canDelete(db, actor?.role, objectKey)) {
    throw new Error(`You do not have permission to delete ${label.toLowerCase()}`);
  }
}

/** @deprecated use assertCanModifyRecords with object key */
function assertCanWriteRecords(db, actor, areaLabel = 'records') {
  const map = {
    Matters: 'matter',
    Contacts: 'contact',
    'Time entries': 'time',
    records: 'matter',
  };
  const objectKey = map[areaLabel] || 'matter';
  assertCanModifyRecords(db, actor, objectKey);
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

function normalizeFieldMode(value, fallback = 'write') {
  if (value === true || value === 1 || value === '1') return 'write';
  if (value === false || value === 0 || value === '0') return 'hidden';
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'hidden' || mode === 'none' || mode === 'off') return 'hidden';
  if (mode === 'read' || mode === 'readonly' || mode === 'read_only' || mode === 'view') return 'read';
  if (mode === 'write' || mode === 'edit' || mode === 'read_write' || mode === 'readwrite') return 'write';
  return fallback;
}

function normalizeFieldAccessMap(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [fieldKey, roleMap] of Object.entries(input)) {
    const key = String(fieldKey || '').trim();
    if (!key) continue;
    const row = {};
    const src = roleMap && typeof roleMap === 'object' ? roleMap : {};
    for (const role of ROLE_KEYS) {
      if (src[role] === undefined) continue;
      row[role] = normalizeFieldMode(src[role], 'write');
    }
    if (Object.keys(row).length) out[key] = row;
  }
  return out;
}

/** @deprecated name kept; values are now hidden|read|write */
function normalizeVisibilityMap(input) {
  return normalizeFieldAccessMap(input);
}

function setRecordPageLayout(db, actor, input = {}) {
  const current = getRecordPageLayout(db);
  const next = {
    matter: input.matter !== undefined
      ? normalizeFieldAccessMap(input.matter)
      : current.matter,
    contact: input.contact !== undefined
      ? normalizeFieldAccessMap(input.contact)
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

function getFieldAccess(db, page, role, fieldKey) {
  const key = String(fieldKey || '');
  if (key === 'name' || key === 'std:name') return 'write';
  const layout = getRecordPageLayout(db);
  const pageMap = layout[page] || {};
  const row = pageMap[key];
  if (!row || typeof row !== 'object') return 'write';
  if (!ROLE_KEYS.includes(role)) return 'write';
  if (row[role] === undefined) return 'write';
  return normalizeFieldMode(row[role], 'write');
}

/** Missing entries default to visible. Core name is always shown. */
function isFieldVisibleForProfile(db, page, role, fieldKey) {
  return getFieldAccess(db, page, role, fieldKey) !== 'hidden';
}

function isFieldWritableForRole(db, page, role, fieldKey) {
  if (!canModifyAll(db, role, page === 'contact' ? 'contact' : 'matter')) return false;
  return getFieldAccess(db, page, role, fieldKey) === 'write';
}

const MATTER_PATCH_FIELD_KEYS = {
  name: 'std:name',
  clientId: 'std:client',
  jurisdiction: 'std:jurisdiction',
  court: 'std:court',
  status: 'std:status',
  responsibleAttorneyId: 'std:responsible_attorney',
  openedOn: 'std:opened_on',
};

const CONTACT_PATCH_FIELD_KEYS = {
  name: 'name',
  email: 'email',
  phone: 'phone',
  company: 'company',
  notes: 'notes',
};

function assertCanWriteMatterFields(db, actor, patch = {}) {
  const role = actor?.role;
  for (const [patchKey, fieldKey] of Object.entries(MATTER_PATCH_FIELD_KEYS)) {
    if (patch[patchKey] === undefined) continue;
    if (!isFieldWritableForRole(db, 'matter', role, fieldKey)) {
      throw new Error(`Field is read only for your role`);
    }
  }
  if (patch.customValues && typeof patch.customValues === 'object') {
    for (const fieldId of Object.keys(patch.customValues)) {
      if (!isFieldWritableForRole(db, 'matter', role, `cf:${fieldId}`)) {
        throw new Error(`Field is read only for your role`);
      }
    }
  }
}

function assertCanWriteContactFields(db, actor, patch = {}) {
  const role = actor?.role;
  for (const [patchKey, fieldKey] of Object.entries(CONTACT_PATCH_FIELD_KEYS)) {
    if (patch[patchKey] === undefined) continue;
    if (!isFieldWritableForRole(db, 'contact', role, fieldKey)) {
      throw new Error(`Field is read only for your role`);
    }
  }
  if (patch.customValues && typeof patch.customValues === 'object') {
    for (const fieldId of Object.keys(patch.customValues)) {
      if (!isFieldWritableForRole(db, 'contact', role, `cf:${fieldId}`)) {
        throw new Error(`Field is read only for your role`);
      }
    }
  }
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
  const rolePermissions = getRolePermissions(db);
  return {
    roles: ROLES,
    profiles: ROLES, // compat
    objects: OBJECT_KEYS.map((key) => ({ key, label: OBJECT_LABELS[key] })),
    rolePermissions,
    profilePermissions: getProfilePermissionsFromRoles(rolePermissions), // compat
    fieldPermissions: layout,
    recordPageLayout: layout, // compat
    matterFields: catalogMatterLayoutFields(db),
    contactFields: catalogContactLayoutFields(db),
  };
}

module.exports = {
  ROLES,
  PROFILES,
  ROLE_KEYS,
  PROFILE_KEYS,
  OBJECT_KEYS,
  OBJECT_LABELS,
  FIELD_MODES,
  ACCESS_MODES,
  getRolePermissions,
  setRolePermissions,
  getProfilePermissions,
  setProfilePermissions,
  getRoleObjectAccess,
  canViewAll,
  canModifyAll,
  canDelete,
  getProfileAccess,
  assertCanViewRecords,
  assertCanModifyRecords,
  assertCanDeleteRecords,
  assertCanWriteRecords,
  getRecordPageLayout,
  setRecordPageLayout,
  getFieldAccess,
  isFieldVisibleForProfile,
  isFieldWritableForRole,
  assertCanWriteMatterFields,
  assertCanWriteContactFields,
  catalogMatterLayoutFields,
  catalogContactLayoutFields,
  getPermissionsSettings,
};
