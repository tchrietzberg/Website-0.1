'use strict';

const crypto = require('node:crypto');
const { audit, getSetting } = require('../db');
const customFields = require('./customFields');
const clientsSvc = require('./clients');
const matterSvc = require('./matters');
const fieldTypes = require('./fieldTypes');
const permissions = require('./permissions');

const STAFF_ROLES = ['admin', 'attorney', 'paralegal', 'billing_clerk'];
const STANDARD_KEYS = ['contactName', 'contactEmail', 'contactPhone', 'matterName'];
const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
const PHONE_RE = /(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/;
const portalHits = new Map();

function assertStaff(actor) {
  if (!actor?.id || !STAFF_ROLES.includes(actor.role)) {
    const err = new Error('forbidden');
    err.status = 403;
    throw err;
  }
}

function maskPhone(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (digits.length < 4) return '[phone]';
  return `***${digits.slice(-4)}`;
}

function maskEmail(value) {
  const s = String(value || '').trim();
  const at = s.indexOf('@');
  if (at < 1) return '[email]';
  return `${s[0]}***${s.slice(at)}`;
}

function parseJson(raw, fallback) {
  if (raw == null || raw === '') return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function normalizeFieldIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))];
}

function ensureIntakeTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS intake_forms (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      greeting TEXT,
      matter_record_type_key TEXT NOT NULL DEFAULT 'billable',
      contact_record_type_key TEXT NOT NULL DEFAULT 'client',
      field_ids_json TEXT NOT NULL DEFAULT '[]',
      portal_enabled INTEGER NOT NULL DEFAULT 1 CHECK (portal_enabled IN (0,1)),
      phone_enabled INTEGER NOT NULL DEFAULT 1 CHECK (phone_enabled IN (0,1)),
      auto_file INTEGER NOT NULL DEFAULT 0 CHECK (auto_file IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE TABLE IF NOT EXISTS intake_portal_tokens (
      token TEXT PRIMARY KEY,
      form_id INTEGER NOT NULL REFERENCES intake_forms(id) ON DELETE CASCADE,
      created_by INTEGER REFERENCES users(id),
      expires_at TEXT,
      revoked INTEGER NOT NULL DEFAULT 0 CHECK (revoked IN (0,1)),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intake_portal_tokens_form ON intake_portal_tokens(form_id);
    CREATE TABLE IF NOT EXISTS intake_sessions (
      id INTEGER PRIMARY KEY,
      form_id INTEGER REFERENCES intake_forms(id),
      channel TEXT NOT NULL CHECK (channel IN ('phone', 'portal', 'agent')),
      status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'filed', 'abandoned')),
      transcript TEXT,
      extracted_json TEXT,
      contact_name TEXT,
      contact_email TEXT,
      contact_phone TEXT,
      matter_name TEXT,
      client_id INTEGER REFERENCES clients(id),
      matter_id INTEGER REFERENCES matters(id),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      completed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_intake_sessions_status ON intake_sessions(status, created_at);
    CREATE TABLE IF NOT EXISTS intake_messages (
      id INTEGER PRIMARY KEY,
      session_id INTEGER NOT NULL REFERENCES intake_sessions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('user', 'agent', 'system')),
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_intake_messages_session ON intake_messages(session_id, id);
  `);
}

function publicField(field) {
  if (!field) return null;
  return {
    id: field.id,
    label: field.label,
    fieldType: field.fieldType || field.field_type,
    appliesTo: field.appliesTo || field.applies_to,
    required: !!field.required,
    options: Array.isArray(field.options) ? field.options : [],
  };
}

function formFields(db, form) {
  const ids = normalizeFieldIds(parseJson(form.field_ids_json, []));
  const matter = customFields.listCustomFields(db, {
    appliesTo: 'matter',
    recordTypeKey: form.matter_record_type_key || 'billable',
  });
  const contact = customFields.listCustomFields(db, {
    appliesTo: 'client',
    recordTypeKey: form.contact_record_type_key || 'client',
  });
  const byId = new Map([...matter, ...contact].map((f) => [Number(f.id), f]));
  const selected = ids.map((id) => byId.get(id)).filter(Boolean);
  return {
    selected,
    available: [...matter, ...contact],
    matter,
    contact,
  };
}

function serializeForm(db, form, { includeAvailable = false } = {}) {
  const fields = formFields(db, form);
  const out = {
    id: form.id,
    name: form.name,
    greeting: form.greeting || defaultGreeting(form),
    matterRecordTypeKey: form.matter_record_type_key,
    contactRecordTypeKey: form.contact_record_type_key,
    fieldIds: normalizeFieldIds(parseJson(form.field_ids_json, [])),
    fields: fields.selected.map(publicField),
    portalEnabled: !!form.portal_enabled,
    phoneEnabled: !!form.phone_enabled,
    autoFile: !!form.auto_file,
    active: !!form.active,
  };
  if (includeAvailable) out.availableFields = fields.available.map(publicField);
  return out;
}

function defaultGreeting(form) {
  return form?.greeting
    || 'Hello, this is the Chrono intake agent. I will collect the information we need for a new matter. You can speak or type.';
}

function defaultFieldIds(db) {
  const matter = customFields.listCustomFields(db, { appliesTo: 'matter', recordTypeKey: 'billable' });
  const contact = customFields.listCustomFields(db, { appliesTo: 'client', recordTypeKey: 'client' });
  return [...contact, ...matter].map((f) => Number(f.id)).filter((id) => Number.isInteger(id));
}

function ensureDefaultForm(db, actor = null) {
  ensureIntakeTables(db);
  const existing = db.prepare('SELECT * FROM intake_forms WHERE active = 1 ORDER BY id LIMIT 1').get();
  if (existing) return existing;
  const info = db.prepare(`
    INSERT INTO intake_forms(
      name, greeting, matter_record_type_key, contact_record_type_key, field_ids_json, created_by
    ) VALUES (?, ?, 'billable', 'client', ?, ?)
  `).run(
    'New matter intake',
    defaultGreeting(),
    JSON.stringify(defaultFieldIds(db)),
    actor?.id || null
  );
  return db.prepare('SELECT * FROM intake_forms WHERE id = ?').get(Number(info.lastInsertRowid));
}

function listForms(db, actor) {
  assertStaff(actor);
  ensureDefaultForm(db, actor);
  return db.prepare('SELECT * FROM intake_forms WHERE active = 1 ORDER BY id')
    .all()
    .map((form) => serializeForm(db, form, { includeAvailable: true }));
}

function getForm(db, formId) {
  ensureIntakeTables(db);
  const id = Number(formId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT * FROM intake_forms WHERE id = ? AND active = 1').get(id);
}

function saveForm(db, actor, input = {}, formId = null) {
  assertStaff(actor);
  ensureDefaultForm(db, actor);
  const name = String(input.name || 'New matter intake').trim() || 'New matter intake';
  const greeting = String(input.greeting || defaultGreeting()).trim();
  const matterKey = customFields.normalizeRecordTypeKey(db, input.matterRecordTypeKey || 'billable');
  const contactKey = customFields.normalizeRecordTypeKey(
    db,
    input.contactRecordTypeKey || 'client',
    { appliesTo: 'client' }
  );
  const fieldIds = normalizeFieldIds(input.fieldIds);
  const portalEnabled = input.portalEnabled === false ? 0 : 1;
  const phoneEnabled = input.phoneEnabled === false ? 0 : 1;
  const autoFile = input.autoFile === true ? 1 : 0;
  if (formId) {
    const existing = getForm(db, formId);
    if (!existing) throw Object.assign(new Error('intake form not found'), { status: 404 });
    db.prepare(`
      UPDATE intake_forms
      SET name = ?, greeting = ?, matter_record_type_key = ?, contact_record_type_key = ?,
          field_ids_json = ?, portal_enabled = ?, phone_enabled = ?, auto_file = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(name, greeting, matterKey, contactKey, JSON.stringify(fieldIds), portalEnabled, phoneEnabled, autoFile, existing.id);
    audit(db, {
      actorId: actor.id,
      action: 'intake.form_update',
      entityType: 'intake_form',
      entityId: existing.id,
      detail: { name, fieldCount: fieldIds.length },
    });
    return serializeForm(db, getForm(db, existing.id), { includeAvailable: true });
  }
  const info = db.prepare(`
    INSERT INTO intake_forms(
      name, greeting, matter_record_type_key, contact_record_type_key,
      field_ids_json, portal_enabled, phone_enabled, auto_file, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(name, greeting, matterKey, contactKey, JSON.stringify(fieldIds), portalEnabled, phoneEnabled, autoFile, actor.id);
  const id = Number(info.lastInsertRowid);
  audit(db, {
    actorId: actor.id,
    action: 'intake.form_create',
    entityType: 'intake_form',
    entityId: id,
    detail: { name, fieldCount: fieldIds.length },
  });
  return serializeForm(db, getForm(db, id), { includeAvailable: true });
}

function matchSelectOption(field, text) {
  const options = Array.isArray(field.options) ? field.options : [];
  const raw = String(text || '').trim().toLowerCase();
  if (!raw || !options.length) return null;
  const exact = options.find((opt) => String(opt).trim().toLowerCase() === raw);
  if (exact) return exact;
  const contains = options.find((opt) => raw.includes(String(opt).trim().toLowerCase()));
  return contains || null;
}

function extractFromTranscript(fields, transcript, prior = {}) {
  const text = String(transcript || '').replace(/\s+/g, ' ').trim();
  const extracted = { ...prior };
  if (!text) return extracted;

  const email = text.match(EMAIL_RE);
  if (email && !extracted.contactEmail) extracted.contactEmail = email[0];

  const phone = text.match(PHONE_RE);
  if (phone && !extracted.contactPhone) extracted.contactPhone = phone[0];

  const nameMatch = text.match(/(?:my name is|this is|i am|i'm)\s+([A-Z][A-Za-z'\-]+(?:\s+[A-Z][A-Za-z'\-]+){0,3})/i);
  if (nameMatch && !extracted.contactName) extracted.contactName = nameMatch[1].trim();

  const matterMatch = text.match(/(?:matter(?: name)?|case(?: name)?|regarding)\s+(?:is|called|:)\s+([^.,;]+)/i);
  if (matterMatch && !extracted.matterName) extracted.matterName = matterMatch[1].trim();

  for (const field of fields) {
    const key = String(field.id);
    if (extracted[key]) continue;
    const label = String(field.label || '').trim();
    if (!label) continue;
    const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const labeled = text.match(new RegExp(`${escaped}\\s*(?:is|:|-)?\\s+([^.,;]+)`, 'i'));
    let value = labeled ? labeled[1].trim() : null;
    if (!value && (field.fieldType === 'select' || field.field_type === 'select')) {
      value = matchSelectOption(field, text);
    }
    if (!value) continue;
    try {
      const normalized = fieldTypes.normalizeCustomValue(field, value);
      if (normalized != null && normalized !== '') extracted[key] = normalized;
    } catch {
      extracted[key] = value;
    }
  }
  return extracted;
}

function unansweredPrompt(form, extracted, fields) {
  if (!extracted.contactName) return { key: 'contactName', question: 'What is the client or caller’s full name?' };
  if (!extracted.contactEmail) return { key: 'contactEmail', question: 'What is the best email address?' };
  if (!extracted.contactPhone) return { key: 'contactPhone', question: 'What is the best phone number?' };
  if (!extracted.matterName) return { key: 'matterName', question: 'What should we name this matter or case?' };
  for (const field of fields) {
    const key = String(field.id);
    if (extracted[key]) continue;
    const options = Array.isArray(field.options) && field.options.length
      ? ` Choices: ${field.options.join(', ')}.`
      : '';
    return { key, question: `What is the ${field.label}?${options}` };
  }
  return { key: null, question: 'I have everything I need. Say “file intake” when you want me to create the contact and matter, or add any corrections.' };
}

function applyAnswer(extracted, key, answer, fields) {
  const next = { ...extracted };
  const text = String(answer || '').trim();
  if (!text || !key) return next;
  if (key === 'contactName') next.contactName = text;
  else if (key === 'contactEmail') {
    const m = text.match(EMAIL_RE);
    next.contactEmail = m ? m[0] : text;
  } else if (key === 'contactPhone') {
    const m = text.match(PHONE_RE);
    next.contactPhone = m ? m[0] : text;
  } else if (key === 'matterName') next.matterName = text;
  else {
    const field = fields.find((f) => String(f.id) === String(key));
    if (field) {
      const option = matchSelectOption(field, text);
      try {
        next[key] = fieldTypes.normalizeCustomValue(field, option || text);
      } catch {
        next[key] = option || text;
      }
    }
  }
  return next;
}

function sessionExtracted(row) {
  const parsed = parseJson(row.extracted_json, {});
  return {
    ...parsed,
    contactName: row.contact_name || parsed.contactName || '',
    contactEmail: row.contact_email || parsed.contactEmail || '',
    contactPhone: row.contact_phone || parsed.contactPhone || '',
    matterName: row.matter_name || parsed.matterName || '',
  };
}

function persistExtracted(db, sessionId, extracted) {
  const custom = { ...extracted };
  STANDARD_KEYS.forEach((k) => delete custom[k]);
  db.prepare(`
    UPDATE intake_sessions
    SET extracted_json = ?, contact_name = ?, contact_email = ?, contact_phone = ?, matter_name = ?,
        status = CASE WHEN status = 'open' THEN 'in_progress' ELSE status END
    WHERE id = ?
  `).run(
    JSON.stringify(custom),
    extracted.contactName || null,
    extracted.contactEmail || null,
    extracted.contactPhone || null,
    extracted.matterName || null,
    sessionId
  );
}

function addMessage(db, sessionId, role, content) {
  db.prepare('INSERT INTO intake_messages(session_id, role, content) VALUES (?, ?, ?)').run(
    sessionId,
    role,
    String(content || '').slice(0, 8000)
  );
}

function listMessages(db, sessionId) {
  return db.prepare(
    'SELECT id, role, content, created_at AS createdAt FROM intake_messages WHERE session_id = ? ORDER BY id'
  ).all(sessionId);
}

function serializeSession(db, row, { includeMessages = false } = {}) {
  if (!row) return null;
  const form = row.form_id ? getForm(db, row.form_id) : ensureDefaultForm(db);
  const fields = form ? formFields(db, form).selected : [];
  const extracted = sessionExtracted(row);
  const prompt = unansweredPrompt(form, extracted, fields);
  const out = {
    id: row.id,
    formId: row.form_id,
    channel: row.channel,
    status: row.status,
    extracted,
    nextQuestion: prompt.question,
    nextKey: prompt.key,
    fields: fields.map(publicField),
    greeting: form ? defaultGreeting(form) : defaultGreeting(),
    clientId: row.client_id,
    matterId: row.matter_id,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
  if (includeMessages) out.messages = listMessages(db, row.id);
  return out;
}

function getSession(db, sessionId) {
  const id = Number(sessionId);
  if (!Number.isInteger(id) || id <= 0) return null;
  return db.prepare('SELECT * FROM intake_sessions WHERE id = ?').get(id);
}

function startSession(db, actor, input = {}) {
  assertStaff(actor);
  const form = getForm(db, input.formId) || ensureDefaultForm(db, actor);
  const channel = ['phone', 'portal', 'agent'].includes(input.channel) ? input.channel : 'agent';
  if (channel === 'phone' && !form.phone_enabled) {
    throw Object.assign(new Error('phone intake is disabled for this form'), { status: 400 });
  }
  const info = db.prepare(`
    INSERT INTO intake_sessions(form_id, channel, status, created_by)
    VALUES (?, ?, 'open', ?)
  `).run(form.id, channel, actor.id);
  const id = Number(info.lastInsertRowid);
  const greeting = defaultGreeting(form);
  addMessage(db, id, 'agent', greeting);
  const first = unansweredPrompt(form, {}, formFields(db, form).selected);
  addMessage(db, id, 'agent', first.question);
  audit(db, {
    actorId: actor.id,
    action: 'intake.session_start',
    entityType: 'intake_session',
    entityId: id,
    detail: { channel, formId: form.id },
  });
  return serializeSession(db, getSession(db, id), { includeMessages: true });
}

function ingestText(db, session, text, { actor = null, source = 'typed' } = {}) {
  const form = getForm(db, session.form_id) || ensureDefaultForm(db, actor);
  const fields = formFields(db, form).selected;
  const prior = sessionExtracted(session);
  const prompt = unansweredPrompt(form, prior, fields);
  let extracted = extractFromTranscript(fields, text, { ...prior });
  if (prompt.key && !extracted[prompt.key]) {
    extracted = applyAnswer(extracted, prompt.key, text, fields);
  }
  const transcript = [session.transcript, text].filter(Boolean).join('\n').slice(0, 20000);
  db.prepare('UPDATE intake_sessions SET transcript = ? WHERE id = ?').run(transcript, session.id);
  persistExtracted(db, session.id, extracted);
  addMessage(db, session.id, 'user', text);
  const next = unansweredPrompt(form, extracted, fields);
  addMessage(db, session.id, 'agent', next.question);
  return serializeSession(db, getSession(db, session.id), { includeMessages: true });
}

function addTurn(db, actor, sessionId, input = {}) {
  assertStaff(actor);
  const session = getSession(db, sessionId);
  if (!session) throw Object.assign(new Error('intake session not found'), { status: 404 });
  if (session.status === 'filed') throw Object.assign(new Error('intake already filed'), { status: 400 });
  const text = String(input.text || input.transcript || '').trim();
  if (!text) throw Object.assign(new Error('message required'), { status: 400 });
  return ingestText(db, session, text, { actor, source: input.source || 'typed' });
}

function splitCustomValues(extracted, fields) {
  const matterValues = {};
  const contactValues = {};
  for (const field of fields) {
    const value = extracted[String(field.id)];
    if (value == null || value === '') continue;
    const applies = field.appliesTo || field.applies_to;
    if (applies === 'client') contactValues[field.id] = value;
    else matterValues[field.id] = value;
  }
  return { matterValues, contactValues };
}

function fileSession(db, actor, sessionId, patch = {}) {
  assertStaff(actor);
  permissions.assertCanModifyRecords(db, actor, 'contact');
  permissions.assertCanModifyRecords(db, actor, 'matter');
  const session = getSession(db, sessionId);
  if (!session) throw Object.assign(new Error('intake session not found'), { status: 404 });
  if (session.status === 'filed' && session.matter_id) {
    return serializeSession(db, session, { includeMessages: true });
  }
  const form = getForm(db, session.form_id) || ensureDefaultForm(db, actor);
  const fields = formFields(db, form).selected;
  const extracted = { ...sessionExtracted(session), ...(patch.values || {}) };
  if (patch.contactName) extracted.contactName = String(patch.contactName).trim();
  if (patch.contactEmail) extracted.contactEmail = String(patch.contactEmail).trim();
  if (patch.contactPhone) extracted.contactPhone = String(patch.contactPhone).trim();
  if (patch.matterName) extracted.matterName = String(patch.matterName).trim();
  persistExtracted(db, session.id, extracted);

  const contactName = extracted.contactName || extracted.matterName;
  if (!contactName) throw Object.assign(new Error('contact name required'), { status: 400 });
  const { matterValues, contactValues } = splitCustomValues(extracted, fields);

  const clientPage = clientsSvc.createClient(db, actor, {
    name: contactName,
    email: extracted.contactEmail || '',
    phone: extracted.contactPhone || '',
    recordTypeKey: form.contact_record_type_key,
    customValues: contactValues,
  });
  const matterName = extracted.matterName || `${contactName} intake`;
  const matterPage = matterSvc.createMatter(db, actor, {
    name: matterName,
    recordTypeKey: form.matter_record_type_key,
    clientId: clientPage.client.id,
    customValues: matterValues,
  });
  db.prepare(`
    UPDATE intake_sessions
    SET status = 'filed', client_id = ?, matter_id = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(clientPage.client.id, matterPage.matter.id, session.id);
  audit(db, {
    actorId: actor.id,
    action: 'intake.file',
    entityType: 'intake_session',
    entityId: session.id,
    detail: {
      clientId: clientPage.client.id,
      matterId: matterPage.matter.id,
      contactEmail: extracted.contactEmail ? maskEmail(extracted.contactEmail) : null,
      contactPhone: extracted.contactPhone ? maskPhone(extracted.contactPhone) : null,
    },
  });
  return serializeSession(db, getSession(db, session.id), { includeMessages: true });
}

function listSessions(db, actor) {
  assertStaff(actor);
  ensureIntakeTables(db);
  return db.prepare(`
    SELECT * FROM intake_sessions ORDER BY id DESC LIMIT 50
  `).all().map((row) => serializeSession(db, row));
}

function createPortalLink(db, actor, formId, { days = 30 } = {}) {
  assertStaff(actor);
  const form = getForm(db, formId) || ensureDefaultForm(db, actor);
  if (!form.portal_enabled) throw Object.assign(new Error('portal intake is disabled'), { status: 400 });
  const token = crypto.randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + Math.max(1, Number(days) || 30) * 86400000).toISOString();
  db.prepare(`
    INSERT INTO intake_portal_tokens(token, form_id, created_by, expires_at)
    VALUES (?, ?, ?, ?)
  `).run(token, form.id, actor.id, expires);
  audit(db, {
    actorId: actor.id,
    action: 'intake.portal_link',
    entityType: 'intake_form',
    entityId: form.id,
    detail: { expires },
  });
  return { token, expiresAt: expires, path: `/portal/intake/${token}` };
}

function readPortalToken(db, token) {
  ensureIntakeTables(db);
  const raw = String(token || '').trim();
  if (!/^[a-f0-9]{32,96}$/i.test(raw)) return null;
  const row = db.prepare('SELECT * FROM intake_portal_tokens WHERE token = ?').get(raw);
  if (!row || row.revoked) return null;
  if (row.expires_at && Date.parse(row.expires_at) < Date.now()) return null;
  const form = getForm(db, row.form_id);
  if (!form || !form.portal_enabled) return null;
  return { token: row, form };
}

function checkPortalRateLimit(ip) {
  const key = String(ip || 'unknown');
  const now = Date.now();
  const row = portalHits.get(key);
  if (!row || row.resetAt < now) {
    portalHits.set(key, { count: 1, resetAt: now + 10 * 60 * 1000 });
    return { ok: true };
  }
  if (row.count >= 30) {
    return { ok: false, retryAfterSec: Math.ceil((row.resetAt - now) / 1000) };
  }
  row.count += 1;
  return { ok: true };
}

function portalForm(db, token) {
  const hit = readPortalToken(db, token);
  if (!hit) throw Object.assign(new Error('intake link is invalid or expired'), { status: 404 });
  const firmName = getSetting(db, 'firm_name', 'the firm');
  return {
    firmName,
    form: serializeForm(db, hit.form),
    expiresAt: hit.token.expires_at,
  };
}

function portalActor(db, tokenRow) {
  if (tokenRow.created_by) {
    const user = db.prepare('SELECT * FROM users WHERE id = ? AND active = 1').get(tokenRow.created_by);
    if (user) return user;
  }
  return db.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
}

function submitPortal(db, token, input = {}, req = null) {
  const hit = readPortalToken(db, token);
  if (!hit) throw Object.assign(new Error('intake link is invalid or expired'), { status: 404 });
  const fields = formFields(db, hit.form).selected;
  const extracted = {
    contactName: String(input.contactName || '').trim(),
    contactEmail: String(input.contactEmail || '').trim(),
    contactPhone: String(input.contactPhone || '').trim(),
    matterName: String(input.matterName || '').trim(),
  };
  const values = input.values && typeof input.values === 'object' ? input.values : {};
  for (const field of fields) {
    if (values[field.id] == null && values[String(field.id)] == null) continue;
    const raw = values[field.id] ?? values[String(field.id)];
    try {
      extracted[String(field.id)] = fieldTypes.normalizeCustomValue(field, raw);
    } catch {
      extracted[String(field.id)] = raw;
    }
  }
  if (!extracted.contactName) throw Object.assign(new Error('name required'), { status: 400 });
  const actor = portalActor(db, hit.token);
  if (!actor) throw Object.assign(new Error('intake is not available'), { status: 503 });
  const info = db.prepare(`
    INSERT INTO intake_sessions(form_id, channel, status, created_by)
    VALUES (?, 'portal', 'completed', ?)
  `).run(hit.form.id, actor.id);
  const sessionId = Number(info.lastInsertRowid);
  persistExtracted(db, sessionId, extracted);
  db.prepare(`
    UPDATE intake_sessions SET status = 'completed', completed_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(sessionId);
  addMessage(db, sessionId, 'system', 'Submitted from the client portal.');
  audit(db, {
    actorId: actor.id,
    action: 'intake.portal_submit',
    entityType: 'intake_session',
    entityId: sessionId,
    detail: {
      formId: hit.form.id,
      contactEmail: extracted.contactEmail ? maskEmail(extracted.contactEmail) : null,
      contactPhone: extracted.contactPhone ? maskPhone(extracted.contactPhone) : null,
    },
    req,
  });
  if (hit.form.auto_file) {
    return fileSession(db, actor, sessionId);
  }
  return serializeSession(db, getSession(db, sessionId));
}

function verifyPhoneWebhookSecret(provided) {
  const expected = String(process.env.INTAKE_PHONE_WEBHOOK_SECRET || '').trim();
  if (!expected) return false;
  const a = Buffer.from(String(provided || ''));
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function ingestPhoneCall(db, input = {}, req = null) {
  const transcript = String(input.transcript || input.SpeechResult || input.speechResult || '').trim();
  if (!transcript) throw Object.assign(new Error('transcript required'), { status: 400 });
  const form = getForm(db, input.formId) || ensureDefaultForm(db);
  if (!form.phone_enabled) throw Object.assign(new Error('phone intake is disabled'), { status: 400 });
  const actor = db.prepare("SELECT * FROM users WHERE role = 'admin' AND active = 1 ORDER BY id LIMIT 1").get();
  if (!actor) throw Object.assign(new Error('intake is not available'), { status: 503 });
  const info = db.prepare(`
    INSERT INTO intake_sessions(form_id, channel, status, transcript, created_by)
    VALUES (?, 'phone', 'completed', ?, ?)
  `).run(form.id, transcript.slice(0, 20000), actor.id);
  const sessionId = Number(info.lastInsertRowid);
  const fields = formFields(db, form).selected;
  const extracted = extractFromTranscript(fields, transcript, {
    contactPhone: input.from || input.From || input.callerPhone || '',
  });
  persistExtracted(db, sessionId, extracted);
  addMessage(db, sessionId, 'system', 'Phone call transcript received.');
  addMessage(db, sessionId, 'user', transcript);
  audit(db, {
    actorId: actor.id,
    action: 'intake.phone',
    entityType: 'intake_session',
    entityId: sessionId,
    detail: { formId: form.id, caller: input.from ? maskPhone(input.from) : null },
    req,
  });
  if (form.auto_file && extracted.contactName) {
    return fileSession(db, actor, sessionId);
  }
  return serializeSession(db, getSession(db, sessionId), { includeMessages: true });
}

module.exports = {
  STAFF_ROLES,
  ensureIntakeTables,
  ensureDefaultForm,
  listForms,
  saveForm,
  getForm,
  startSession,
  addTurn,
  fileSession,
  listSessions,
  getSession,
  serializeSession,
  createPortalLink,
  portalForm,
  submitPortal,
  checkPortalRateLimit,
  verifyPhoneWebhookSecret,
  ingestPhoneCall,
  extractFromTranscript,
  maskPhone,
  maskEmail,
};
