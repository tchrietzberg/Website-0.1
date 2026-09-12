#!/usr/bin/env node
/**
 * Seeds users, clients, rates, billing rules, and record-type field defs.
 * No sample matters — create matters in the UI; Matter Search indexes them.
 */
const { resetDb, setSetting, DEFAULT_DB } = require('../src/db');
const { hashPassword } = require('../src/security');
const customFields = require('../src/services/customFields');
const placesSvc = require('../src/services/places');

const dbFile = process.env.DB_FILE || DEFAULT_DB;
const db = resetDb(dbFile);

setSetting(db, 'round_increment_minutes', '15');
setSetting(db, 'round_mode', 'up');
setSetting(db, 'duration_format', 'decimal');
setSetting(db, 'firm_timezone', 'America/New_York');
setSetting(db, 'firm_name', 'Demo Securities Litigation LLP');

// Demo password is intentionally simple for local demos — change before any public deploy.
const demoPassword = process.env.DEMO_PASSWORD || 'demo-change-me';
const passwordHash = hashPassword(demoPassword);

const users = [
  ['avery@firm.example', 'Avery Admin', 'admin'],
  ['jordan@firm.example', 'Jordan Lead', 'attorney'],
  ['riley@firm.example', 'Riley Associate', 'attorney'],
  ['sam@firm.example', 'Sam Paralegal', 'paralegal'],
  ['billie@firm.example', 'Billie Clerk', 'billing_clerk'],
];
for (const [email, name, role] of users) {
  db.prepare(
    'INSERT INTO users(email, name, role, password_hash) VALUES (?, ?, ?, ?)'
  ).run(email, name, role, passwordHash);
}

const avery = db.prepare("SELECT * FROM users WHERE email='avery@firm.example'").get();
const jordan = db.prepare("SELECT * FROM users WHERE email='jordan@firm.example'").get();
const riley = db.prepare("SELECT * FROM users WHERE email='riley@firm.example'").get();
const sam = db.prepare("SELECT * FROM users WHERE email='sam@firm.example'").get();

db.prepare('INSERT INTO clients(name) VALUES (?)').run('Northwind Holdings LLC');
db.prepare('INSERT INTO clients(name) VALUES (?)').run('Acme Pension Fund');
const northwind = db.prepare("SELECT * FROM clients WHERE name LIKE 'Northwind%'").get();

db.prepare(`
  INSERT INTO rates(scope, scope_id, amount_cents, effective_date, created_by) VALUES
  ('timekeeper', ?, 45000, '2020-01-01', ?),
  ('timekeeper', ?, 35000, '2020-01-01', ?),
  ('timekeeper', ?, 27500, '2020-01-01', ?),
  ('timekeeper', ?, 17500, '2020-01-01', ?),
  ('client', ?, 40000, '2025-01-01', ?)
`).run(
  avery.id, avery.id,
  jordan.id, avery.id,
  riley.id, avery.id,
  sam.id, avery.id,
  northwind.id, avery.id
);

db.prepare(`
  INSERT INTO billing_rules(name, condition_json, message, active)
  VALUES (
    'N.D. Cal category required',
    '{"require_category_for_court":"N.D. Cal"}',
    'N.D. Cal matters require category and subcategory',
    1
  )
`).run();

customFields.ensureRecordTypes(db);
customFields.ensureTypeLayout(db, customFields.DEFAULT_RECORD_TYPE_KEY);

customFields.createCustomField(db, avery, {
  label: 'Case stage',
  apiName: 'case_stage',
  fieldType: 'select',
  recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
  options: ['Investigation', 'Discovery', 'Motion practice', 'Trial', 'Appeal'],
});
customFields.createCustomField(db, avery, {
  label: 'Lead plaintiff',
  apiName: 'lead_plaintiff',
  fieldType: 'text',
  recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
});

placesSvc.seedDemo(db);

console.log(`Seeded ${dbFile}`);
console.log(`Demo logins: *@firm.example  password: ${demoPassword}`);
console.log('Change DEMO_PASSWORD / user passwords before any public deploy.');
console.log('No sample matters — create matters under Matters; Matter Search uses the search index.');
console.log('Places: seeded Ferry Building / Civic Center / Golden Gate Park pins + chat.');
