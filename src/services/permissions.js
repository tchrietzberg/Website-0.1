const { getSetting, setSetting, audit } = require('../db');

const BUILTIN_ROLES = [
  { key: 'admin', label: 'Admin' },
  { key: 'attorney', label: 'Attorney' },
  { key: 'paralegal', label: 'Paralegal' },
  { key: 'billing_clerk', label: 'Billing Clerk' },
];

/** @deprecated use listRoles(db) — built-in roles only (no firm custom roles). */
const ROLES = BUILTIN_ROLES;
/** @deprecated use ROLES */
const PROFILES = ROLES;

const BUILTIN_ROLE_KEYS = BUILTIN_ROLES.map((r) => r.key);
/** @deprecated use getRoleKeys(db) */
const ROLE_KEYS = BUILTIN_ROLE_KEYS;
/** @deprecated use ROLE_KEYS */
const PROFILE_KEYS = ROLE_KEYS;

const CUSTOM_ROLES_KEY = 'custom_roles';

function titleCaseRoleLabel(value) {
  return String(value || '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(' ');
}

function slugifyRoleKey(label) {
  const slug = String(label || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
  return slug;
}

function readCustomRoles(db) {
  const raw = getSetting(db, CUSTOM_ROLES_KEY, null);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const out = [];
    const seen = new Set(BUILTIN_ROLE_KEYS);
    for (const row of parsed) {
      if (!row || typeof row !== 'object') continue;
      const key = slugifyRoleKey(row.key || row.label);
      if (!key || seen.has(key) || key === 'admin') continue;
      seen.add(key);
      out.push({
        key,
        label: titleCaseRoleLabel(row.label || key),
        custom: true,
      });
    }
    return out;
  } catch {
    return [];
  }
}

function writeCustomRoles(db, actor, roles) {
  const cleaned = [];
  const seen = new Set(BUILTIN_ROLE_KEYS);
  for (const row of roles || []) {
    if (!row || typeof row !== 'object') continue;
    const key = slugifyRoleKey(row.key || row.label);
    if (!key || seen.has(key) || key === 'admin') continue;
    seen.add(key);
    cleaned.push({
      key,
      label: titleCaseRoleLabel(row.label || key),
    });
  }
  setSetting(db, CUSTOM_ROLES_KEY, JSON.stringify(cleaned));
  audit(db, {
    actorId: actor?.id || null,
    action: 'custom_roles.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: { roles: cleaned },
  });
  return cleaned.map((r) => ({ ...r, custom: true }));
}

/** Built-in + firm custom roles (labels title-cased). */
function listRoles(db) {
  const builtin = BUILTIN_ROLES.map((r) => ({
    key: r.key,
    label: titleCaseRoleLabel(r.label),
    custom: false,
  }));
  return [...builtin, ...readCustomRoles(db)];
}

function getRoleKeys(db) {
  return listRoles(db).map((r) => r.key);
}

function isKnownRole(db, role) {
  return getRoleKeys(db).includes(role);
}

function addCustomRole(db, actor, input = {}) {
  const label = titleCaseRoleLabel(input.label || input.name || '');
  if (!label) throw new Error('Role name is required');
  let key = slugifyRoleKey(input.key || label);
  if (!key) throw new Error('Role name is required');
  if (key === 'admin' || BUILTIN_ROLE_KEYS.includes(key)) {
    throw new Error(`Role “${titleCaseRoleLabel(key)}” already exists`);
  }
  const existing = readCustomRoles(db);
  if (existing.some((r) => r.key === key)) {
    throw new Error(`Role “${label}” already exists`);
  }
  // Avoid colliding with a near-duplicate slug by appending a counter.
  let candidate = key;
  let n = 2;
  const used = new Set([...BUILTIN_ROLE_KEYS, ...existing.map((r) => r.key)]);
  while (used.has(candidate)) {
    candidate = `${key}_${n}`;
    n += 1;
  }
  key = candidate;
  const nextRoles = [...existing, { key, label }];
  writeCustomRoles(db, actor, nextRoles);

  // Seed default permissions for the new role (view/find on, edit/delete off).
  const perms = getRolePermissions(db);
  perms[key] = normalizeRoleEntry({
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, {
        viewAll: true,
        search: true,
        modifyAll: false,
        delete: false,
        ...(o === 'time' ? {
          selectTimekeeper: false,
          viewOthers: true,
          modifyOthers: false,
          deleteOthers: false,
        } : {}),
      }])
    ),
    addUsers: false,
  }, null, key);
  setRolePermissions(db, actor, perms);
  return listRoles(db).find((r) => r.key === key);
}

const OBJECT_KEYS = ['matter', 'contact', 'time', 'report'];
const OBJECT_LABELS = {
  matter: 'Matters',
  contact: 'Contacts',
  time: 'Time entries',
  report: 'Reports',
};

const FIELD_MODES = ['hidden', 'read', 'write'];
const ACCESS_MODES = ['read_only', 'read_write']; // legacy compat

const ROLE_PERMISSIONS_KEY = 'role_permissions';
const PROFILE_PERMISSIONS_KEY = 'profile_permissions'; // legacy
const RECORD_PAGE_LAYOUT_KEY = 'record_page_layout';

/**
 * @param {boolean} full
 * @param {string|null} objectKey
 * @param {string|null} roleKey — when set for `time`, select/modify-others
 *   default to admin + billing_clerk only (historical proxy roles).
 */
function defaultObjectPerms(full = true, objectKey = null, roleKey = null) {
  const out = {
    viewAll: full,
    modifyAll: full,
    delete: full,
    // Global lookup bar: default follows View All (search ⊆ view).
    search: full,
  };
  if (objectKey === 'time') {
    const proxyRole = roleKey === 'admin' || roleKey === 'billing_clerk';
    out.selectTimekeeper = full && (roleKey == null ? full : proxyRole);
    out.viewOthers = full;
    out.modifyOthers = full && (roleKey == null ? full : proxyRole);
    out.deleteOthers = full;
  }
  return out;
}

function defaultAddUsers(roleKey) {
  // Admin only by default; other roles can be granted Add users in Settings.
  return roleKey === 'admin';
}

function defaultRolePermissions(full = true, roleKeys = BUILTIN_ROLE_KEYS) {
  return Object.fromEntries(
    roleKeys.map((key) => [
      key,
      {
        objects: Object.fromEntries(
          OBJECT_KEYS.map((obj) => [obj, defaultObjectPerms(full, obj, key)])
        ),
        addUsers: defaultAddUsers(key),
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

function normalizeObjectPerms(input = {}, fallback = defaultObjectPerms(true), objectKey = null) {
  const out = {
    viewAll: normalizeBool(input.viewAll ?? input.view_all, fallback.viewAll),
    modifyAll: normalizeBool(input.modifyAll ?? input.modify_all, fallback.modifyAll),
    delete: normalizeBool(input.delete, fallback.delete),
  };
  // Search defaults to viewAll when omitted (backward compatible).
  const searchFallback = fallback.search != null ? fallback.search : out.viewAll;
  out.search = normalizeBool(input.search, searchFallback);
  // Search requires View All.
  if (!out.viewAll) out.search = false;
  if (objectKey === 'time') {
    out.selectTimekeeper = normalizeBool(
      input.selectTimekeeper ?? input.select_timekeeper,
      fallback.selectTimekeeper != null ? fallback.selectTimekeeper : false
    );
    out.viewOthers = normalizeBool(
      input.viewOthers ?? input.view_others,
      fallback.viewOthers != null ? fallback.viewOthers : true
    );
    out.modifyOthers = normalizeBool(
      input.modifyOthers ?? input.modify_others,
      fallback.modifyOthers != null ? fallback.modifyOthers : false
    );
    out.deleteOthers = normalizeBool(
      input.deleteOthers ?? input.delete_others,
      fallback.deleteOthers != null ? fallback.deleteOthers : out.delete
    );
  }
  return out;
}

function normalizeRoleEntry(input, fallback = null, roleKey = null) {
  const base = fallback || {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true, o, roleKey)])
    ),
    addUsers: defaultAddUsers(roleKey),
  };
  const addUsersFallback = roleKey === 'admin'
    ? true
    : (base.addUsers != null ? !!base.addUsers : defaultAddUsers(roleKey));
  // Legacy string mode: 'read_only' | 'read_write'
  if (typeof input === 'string') {
    const mode = String(input).trim().toLowerCase().replace(/[-\s]+/g, '_');
    const full = !(mode === 'readonly' || mode === 'read_only');
    return {
      objects: Object.fromEntries(
        OBJECT_KEYS.map((o) => {
          const perms = defaultObjectPerms(full, o, roleKey);
          // Legacy read_only still allowed viewing all objects.
          perms.viewAll = true;
          if (o === 'time') perms.viewOthers = true;
          return [o, perms];
        })
      ),
      // Legacy profiles never implied invite rights for non-admins.
      addUsers: roleKey === 'admin',
    };
  }
  const src = input && typeof input === 'object' ? input : {};
  const objectsSrc = src.objects && typeof src.objects === 'object' ? src.objects : src;
  const objects = {};
  for (const obj of OBJECT_KEYS) {
    objects[obj] = normalizeObjectPerms(
      objectsSrc[obj] || {},
      base.objects?.[obj] || defaultObjectPerms(true, obj, roleKey),
      obj
    );
  }
  return {
    objects,
    addUsers: roleKey === 'admin'
      ? true
      : normalizeBool(src.addUsers ?? src.add_users, addUsersFallback),
  };
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
  const roleKeys = getRoleKeys(db);
  const defaults = defaultRolePermissions(true, roleKeys);
  const out = {};
  for (const key of roleKeys) {
    out[key] = normalizeRoleEntry(parsed[key], defaults[key], key);
  }
  // Admin always keeps full access so settings cannot lock the firm out.
  out.admin = {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true, o, 'admin')])
    ),
    addUsers: true,
  };
  return out;
}

/** @deprecated use getRolePermissions */
function getProfilePermissions(db) {
  return getProfilePermissionsFromRoles(getRolePermissions(db), getRoleKeys(db));
}

function setRolePermissions(db, actor, input = {}) {
  const current = getRolePermissions(db);
  const roleKeys = getRoleKeys(db);
  const next = {};
  for (const key of roleKeys) {
    if (input[key] !== undefined) {
      next[key] = normalizeRoleEntry(input[key], current[key], key);
    } else {
      next[key] = current[key];
    }
  }
  // Also accept brand-new custom role keys present in the save payload.
  for (const key of Object.keys(input || {})) {
    if (next[key] || key === 'admin') continue;
    if (!/^[a-z][a-z0-9_]*$/.test(key)) continue;
    next[key] = normalizeRoleEntry(input[key], null, key);
  }
  next.admin = {
    objects: Object.fromEntries(
      OBJECT_KEYS.map((o) => [o, defaultObjectPerms(true, o, 'admin')])
    ),
    addUsers: true,
  };
  setSetting(db, ROLE_PERMISSIONS_KEY, JSON.stringify(next));
  // Keep legacy key in sync for older readers.
  setSetting(db, PROFILE_PERMISSIONS_KEY, JSON.stringify(
    getProfilePermissionsFromRoles(next, Object.keys(next))
  ));
  audit(db, {
    actorId: actor?.id || null,
    action: 'role_permissions.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: next,
  });
  return next;
}

function getProfilePermissionsFromRoles(roles, roleKeys = BUILTIN_ROLE_KEYS) {
  const legacy = {};
  for (const key of roleKeys) {
    const objs = roles[key]?.objects;
    if (!objs) continue;
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
  if (!isKnownRole(db, role) || !OBJECT_KEYS.includes(objectKey)) {
    return defaultObjectPerms(false);
  }
  return getRolePermissions(db)[role].objects[objectKey];
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

/** Global lookup: requires View All and the Search flag. */
function canSearch(db, role, objectKey) {
  const access = getRoleObjectAccess(db, role, objectKey);
  return !!access.viewAll && !!access.search;
}

function canSelectTimekeeper(db, role) {
  return !!getRoleObjectAccess(db, role, 'time').selectTimekeeper;
}

function canViewOthersTime(db, role) {
  return !!getRoleObjectAccess(db, role, 'time').viewOthers;
}

function canModifyOthersTime(db, role) {
  return !!getRoleObjectAccess(db, role, 'time').modifyOthers;
}

function canDeleteOthersTime(db, role) {
  return !!getRoleObjectAccess(db, role, 'time').deleteOthers;
}

/** Invite / Add a user — admin always; other roles only when granted. */
function canAddUsers(db, role) {
  if (role === 'admin') return true;
  if (!isKnownRole(db, role)) return false;
  return !!getRolePermissions(db)[role].addUsers;
}

function assertCanAddUsers(db, actor) {
  if (!canAddUsers(db, actor?.role)) {
    throw forbidden('You do not have permission to add users');
  }
}

/** Legacy: read_write if modifyAll on all objects, else read_only. */
function getProfileAccess(db, role) {
  if (!isKnownRole(db, role)) return 'read_only';
  const objs = getRolePermissions(db)[role].objects;
  return OBJECT_KEYS.every((o) => objs[o].modifyAll) ? 'read_write' : 'read_only';
}

function forbidden(message) {
  const err = new Error(message);
  err.code = 'FORBIDDEN';
  return err;
}

function assertCanViewRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canViewAll(db, actor?.role, objectKey)) {
    throw forbidden(`${label} are not viewable for your role`);
  }
}

function assertCanModifyRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canModifyAll(db, actor?.role, objectKey)) {
    throw forbidden(`${label} are read only for your role`);
  }
}

function assertCanDeleteRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canDelete(db, actor?.role, objectKey)) {
    throw forbidden(`You do not have permission to delete ${label.toLowerCase()}`);
  }
}

function assertCanSearchRecords(db, actor, objectKey) {
  const label = OBJECT_LABELS[objectKey] || objectKey;
  if (!canSearch(db, actor?.role, objectKey)) {
    throw forbidden(`${label} are not searchable for your role`);
  }
}

/** @deprecated use assertCanModifyRecords with object key */
function assertCanWriteRecords(db, actor, areaLabel = 'records') {
  const map = {
    Matters: 'matter',
    Contacts: 'contact',
    'Time entries': 'time',
    Reports: 'report',
    records: 'matter',
  };
  const objectKey = map[areaLabel] || 'matter';
  assertCanModifyRecords(db, actor, objectKey);
}

function emptyRecordPageLayout() {
  return { matter: {}, contact: {}, time: {} };
}

function getRecordPageLayout(db) {
  const raw = getSetting(db, RECORD_PAGE_LAYOUT_KEY, null);
  if (!raw) return emptyRecordPageLayout();
  try {
    const parsed = JSON.parse(raw) || {};
    return {
      matter: parsed.matter && typeof parsed.matter === 'object' ? parsed.matter : {},
      contact: parsed.contact && typeof parsed.contact === 'object' ? parsed.contact : {},
      time: parsed.time && typeof parsed.time === 'object' ? parsed.time : {},
    };
  } catch {
    return emptyRecordPageLayout();
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
    for (const role of Object.keys(src)) {
      if (!/^[a-z][a-z0-9_]*$/.test(role)) continue;
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
    time: input.time !== undefined
      ? normalizeFieldAccessMap(input.time)
      : current.time,
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
      timeFields: Object.keys(next.time).length,
    },
  });
  return next;
}

function isAlwaysWritableFieldKey(fieldKey) {
  const key = String(fieldKey || '');
  return key === 'name'
    || key === 'std:name'
    || key === 'std:service_date'
    || key === 'std:hours'
    || key === 'std:description';
}

function objectKeyForFieldPage(page) {
  if (page === 'contact') return 'contact';
  if (page === 'time' || page === 'time_entry') return 'time';
  return 'matter';
}

function getFieldAccess(db, page, role, fieldKey) {
  const key = String(fieldKey || '');
  if (isAlwaysWritableFieldKey(key)) return 'write';
  const layout = getRecordPageLayout(db);
  const pageKey = page === 'time_entry' ? 'time' : page;
  const pageMap = layout[pageKey] || {};
  const row = pageMap[key];
  if (!row || typeof row !== 'object') return 'write';
  if (!isKnownRole(db, role)) return 'write';
  if (row[role] === undefined) return 'write';
  return normalizeFieldMode(row[role], 'write');
}

/** Missing entries default to visible. Core name / time date-hours-description stay shown. */
function isFieldVisibleForProfile(db, page, role, fieldKey) {
  return getFieldAccess(db, page, role, fieldKey) !== 'hidden';
}

function isFieldWritableForRole(db, page, role, fieldKey) {
  if (!canModifyAll(db, role, objectKeyForFieldPage(page))) return false;
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

const TIME_PATCH_FIELD_KEYS = {
  serviceDate: 'std:service_date',
  hours: 'std:hours',
  rawMinutes: 'std:hours',
  timekeeperId: 'std:timekeeper',
  billable: 'std:billable',
  description: 'std:description',
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

function assertCanWriteTimeFields(db, actor, patch = {}) {
  const role = actor?.role;
  for (const [patchKey, fieldKey] of Object.entries(TIME_PATCH_FIELD_KEYS)) {
    if (patch[patchKey] === undefined) continue;
    // Logging time for yourself does not require Timekeeper field write access.
    if (
      patchKey === 'timekeeperId'
      && Number(patch.timekeeperId) === Number(actor?.id)
    ) {
      continue;
    }
    if (!isFieldWritableForRole(db, 'time', role, fieldKey)) {
      throw new Error(`Field is read only for your role`);
    }
  }
  if (patch.customValues && typeof patch.customValues === 'object') {
    for (const fieldId of Object.keys(patch.customValues)) {
      if (!isFieldWritableForRole(db, 'time', role, `cf:${fieldId}`)) {
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
        label: f.label,
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

function catalogTimeLayoutFields(db) {
  const customFields = require('./customFields');
  const standards = [
    { key: 'std:service_date', label: 'Date', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:hours', label: 'Hours', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:timekeeper', label: 'Timekeeper', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:billable', label: 'Billable', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:description', label: 'Description', kind: 'standard', group: 'Time entry fields' },
  ];
  const customs = customFields.listCustomFields(db, { appliesTo: 'time_entry' }).map((f) => ({
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
  const roles = listRoles(db);
  const rolePermissions = getRolePermissions(db);
  let matterFields = [];
  let contactFields = [];
  let timeFields = [];
  try { matterFields = catalogMatterLayoutFields(db); } catch { /* keep empty */ }
  try { contactFields = catalogContactLayoutFields(db); } catch { /* keep empty */ }
  try { timeFields = catalogTimeLayoutFields(db); } catch {
    timeFields = [
      { key: 'std:service_date', label: 'Date', kind: 'standard', group: 'Time entry fields' },
      { key: 'std:hours', label: 'Hours', kind: 'standard', group: 'Time entry fields' },
      { key: 'std:timekeeper', label: 'Timekeeper', kind: 'standard', group: 'Time entry fields' },
      { key: 'std:billable', label: 'Billable', kind: 'standard', group: 'Time entry fields' },
      { key: 'std:description', label: 'Description', kind: 'standard', group: 'Time entry fields' },
    ];
  }
  return {
    roles,
    profiles: roles, // compat
    objects: OBJECT_KEYS.map((key) => ({ key, label: OBJECT_LABELS[key] })),
    rolePermissions,
    profilePermissions: getProfilePermissionsFromRoles(rolePermissions, getRoleKeys(db)), // compat
    fieldPermissions: layout,
    recordPageLayout: layout, // compat
    matterFields,
    contactFields,
    timeFields,
  };
}

module.exports = {
  ROLES,
  BUILTIN_ROLES,
  PROFILES,
  ROLE_KEYS,
  BUILTIN_ROLE_KEYS,
  PROFILE_KEYS,
  OBJECT_KEYS,
  OBJECT_LABELS,
  FIELD_MODES,
  ACCESS_MODES,
  titleCaseRoleLabel,
  listRoles,
  getRoleKeys,
  isKnownRole,
  addCustomRole,
  getRolePermissions,
  setRolePermissions,
  getProfilePermissions,
  setProfilePermissions,
  getRoleObjectAccess,
  canViewAll,
  canModifyAll,
  canDelete,
  canSearch,
  canSelectTimekeeper,
  canViewOthersTime,
  canModifyOthersTime,
  canDeleteOthersTime,
  canAddUsers,
  getProfileAccess,
  assertCanViewRecords,
  assertCanModifyRecords,
  assertCanDeleteRecords,
  assertCanSearchRecords,
  assertCanAddUsers,
  assertCanWriteRecords,
  getRecordPageLayout,
  setRecordPageLayout,
  getFieldAccess,
  isFieldVisibleForProfile,
  isFieldWritableForRole,
  assertCanWriteMatterFields,
  assertCanWriteContactFields,
  assertCanWriteTimeFields,
  catalogMatterLayoutFields,
  catalogContactLayoutFields,
  catalogTimeLayoutFields,
  getPermissionsSettings,
};
