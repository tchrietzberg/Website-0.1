#!/usr/bin/env node
/**
 * Seeds a realistic demo database for the firm billing prototype.
 */
const path = require('node:path');
const { resetDb, setSetting, allocateNumber, DEFAULT_DB } = require('../src/db');
const timeSvc = require('../src/services/time');
const invoiceSvc = require('../src/services/invoices');
const paymentSvc = require('../src/services/payments');
const customFields = require('../src/services/customFields');

const dbFile = process.env.DB_FILE || DEFAULT_DB;
const db = resetDb(dbFile);

setSetting(db, 'round_increment_minutes', '15');
setSetting(db, 'round_mode', 'up');
setSetting(db, 'duration_format', 'decimal');
setSetting(db, 'firm_timezone', 'America/New_York');
setSetting(db, 'firm_name', 'Demo Securities Litigation LLP');

const users = [
  ['avery@firm.example', 'Avery Admin', 'admin'],
  ['jordan@firm.example', 'Jordan Lead', 'attorney'],
  ['riley@firm.example', 'Riley Associate', 'attorney'],
  ['sam@firm.example', 'Sam Paralegal', 'paralegal'],
  ['billie@firm.example', 'Billie Clerk', 'billing_clerk'],
];
for (const [email, name, role] of users) {
  db.prepare('INSERT INTO users(email, name, role) VALUES (?, ?, ?)').run(email, name, role);
}

const avery = db.prepare("SELECT * FROM users WHERE email='avery@firm.example'").get();
const jordan = db.prepare("SELECT * FROM users WHERE email='jordan@firm.example'").get();
const riley = db.prepare("SELECT * FROM users WHERE email='riley@firm.example'").get();
const sam = db.prepare("SELECT * FROM users WHERE email='sam@firm.example'").get();
const billie = db.prepare("SELECT * FROM users WHERE email='billie@firm.example'").get();

db.prepare('INSERT INTO clients(name) VALUES (?)').run('Northwind Holdings LLC');
db.prepare('INSERT INTO clients(name) VALUES (?)').run('Acme Pension Fund');
const northwind = db.prepare("SELECT * FROM clients WHERE name LIKE 'Northwind%'").get();
const acme = db.prepare("SELECT * FROM clients WHERE name LIKE 'Acme%'").get();

const year = new Date().getUTCFullYear();
const m1num = allocateNumber(db, 'matter', year, '');
const m2num = allocateNumber(db, 'matter', year, '');
const m3num = allocateNumber(db, 'matter', year, '');

db.prepare(`
  INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, responsible_attorney_id, opened_on)
  VALUES (?, ?, ?, 'litigation', 'N.D. Cal.', 'N.D. Cal.', ?, ?)
`).run(northwind.id, m1num, 'Securities Class Action — WidgetCo', jordan.id, `${year}-01-15`);

db.prepare(`
  INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, responsible_attorney_id, opened_on)
  VALUES (?, ?, ?, 'litigation', 'S.D.N.Y.', 'S.D.N.Y.', ?, ?)
`).run(acme.id, m2num, 'Derivative Suit — FinServe Inc.', jordan.id, `${year}-02-01`);

db.prepare(`
  INSERT INTO matters(client_id, number, name, matter_type, jurisdiction, court, responsible_attorney_id, opened_on)
  VALUES (?, ?, ?, 'sw_admin', NULL, NULL, ?, ?)
`).run(northwind.id, m3num, 'SW Admin — Northwind', riley.id, `${year}-01-01`);

const m1 = db.prepare('SELECT * FROM matters WHERE number = ?').get(m1num);
const m2 = db.prepare('SELECT * FROM matters WHERE number = ?').get(m2num);
const m3 = db.prepare('SELECT * FROM matters WHERE number = ?').get(m3num);

// Rates: matter > client > timekeeper
db.prepare(`
  INSERT INTO rates(scope, scope_id, amount_cents, effective_date, created_by) VALUES
  ('timekeeper', ?, 35000, '2020-01-01', ?),
  ('timekeeper', ?, 27500, '2020-01-01', ?),
  ('timekeeper', ?, 17500, '2020-01-01', ?),
  ('client', ?, 40000, '2025-01-01', ?),
  ('matter', ?, 45000, '2025-06-01', ?)
`).run(
  jordan.id, avery.id,
  riley.id, avery.id,
  sam.id, avery.id,
  northwind.id, avery.id,
  m1.id, avery.id
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

// Sample time entries through the workflow
function logAndApprove(actor, input) {
  const e = timeSvc.createEntry(db, actor, input);
  timeSvc.submitEntry(db, actor, e.id);
  timeSvc.approveEntry(db, billie, e.id);
  return e.id;
}

logAndApprove(sam, {
  matterId: m1.id,
  timekeeperId: sam.id,
  serviceDate: `${year}-03-01`,
  rawMinutes: 7,
  description: 'Reviewed document production set for privilege',
  category: 'Discovery',
  subcategory: 'Document review',
  utbmsTask: 'L320',
  utbmsActivity: 'A104',
});

logAndApprove(riley, {
  matterId: m1.id,
  timekeeperId: riley.id,
  serviceDate: `${year}-03-02`,
  rawMinutes: 62,
  description: 'Drafted meet-and-confer letter re ESI protocol',
  category: 'Discovery',
  subcategory: 'Correspondence',
  utbmsTask: 'L310',
  utbmsActivity: 'A103',
});

logAndApprove(jordan, {
  matterId: m1.id,
  timekeeperId: jordan.id,
  serviceDate: `${year}-03-03`,
  rawMinutes: 90,
  description: 'Strategy conference with client re motion to dismiss',
  category: 'Case Assessment',
  subcategory: 'Strategy',
  utbmsTask: 'L110',
  utbmsActivity: 'A109',
});

logAndApprove(sam, {
  matterId: m2.id,
  timekeeperId: sam.id,
  serviceDate: `${year}-03-04`,
  rawMinutes: 45,
  description: 'Compiled timeline of board meetings',
  category: 'Investigation',
  subcategory: 'Factual research',
  utbmsTask: 'L120',
  utbmsActivity: 'A104',
});

// Non-billable SW admin (default from matter type)
const adminEntry = timeSvc.createEntry(db, riley, {
  matterId: m3.id,
  timekeeperId: riley.id,
  serviceDate: `${year}-03-05`,
  rawMinutes: 30,
  description: 'Internal file organization',
});
timeSvc.submitEntry(db, riley, adminEntry.id);
timeSvc.approveEntry(db, billie, adminEntry.id);

// One submitted entry waiting in queue
const pending = timeSvc.createEntry(db, sam, {
  matterId: m1.id,
  timekeeperId: sam.id,
  serviceDate: `${year}-03-06`,
  rawMinutes: 20,
  description: 'Prepared exhibit index',
  category: 'Discovery',
  subcategory: 'Document review',
});
timeSvc.submitEntry(db, sam, pending.id);

// Pre-bill for matter 1 and advance one invoice to sent with a partial payment
const prebill = invoiceSvc.generatePrebill(db, billie, m1.id);
invoiceSvc.writeDownLine(db, billie, prebill.lines[0].id, 2500, 'Client courtesy adjustment');
invoiceSvc.setStatus(db, billie, prebill.id, 'in_review');
invoiceSvc.setStatus(db, billie, prebill.id, 'approved');
invoiceSvc.setStatus(db, billie, prebill.id, 'sent');

paymentSvc.recordPayment(db, billie, {
  clientId: northwind.id,
  amountCents: 50000,
  receivedOn: `${year}-03-15`,
  method: 'check',
  reference: '1001',
});

// Record-type and record-based custom fields / layouts
customFields.ensureRecordTypes(db);
customFields.ensureTypeLayout(db, 'litigation');
customFields.ensureTypeLayout(db, 'sw_admin');
customFields.ensureTypeLayout(db, 'other');

const caseStage = customFields.createCustomField(db, avery, {
  label: 'Case stage',
  apiName: 'case_stage',
  fieldType: 'select',
  recordTypeKey: 'litigation',
  options: ['Investigation', 'Discovery', 'Motion practice', 'Trial', 'Appeal'],
});
const leadPlaintiff = customFields.createCustomField(db, avery, {
  label: 'Lead plaintiff',
  apiName: 'lead_plaintiff',
  fieldType: 'text',
  recordTypeKey: 'litigation',
});
customFields.setCustomValues(db, avery, m1.id, {
  [caseStage.id]: 'Discovery',
  [leadPlaintiff.id]: 'Northwind Holdings LLC',
});

// Record-based field only on matter 1
const special = customFields.createCustomField(db, avery, {
  label: 'Special billing note',
  apiName: 'special_billing_note',
  fieldType: 'textarea',
  matterId: m1.id,
});
customFields.setCustomValues(db, avery, m1.id, {
  [special.id]: 'Lodestar detail required for fee petition.',
});

console.log(`Seeded ${dbFile}`);
console.log('Demo logins: avery / jordan / riley / sam / billie @firm.example');
console.log(`Matters: ${m1num}, ${m2num}, ${m3num}`);
console.log(`Sample invoice: ${prebill.number} (sent, partial payment applied)`);
