const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const customFields = require('../src/services/customFields');
const customReports = require('../src/services/customReports');
const timeSvc = require('../src/services/time');

describe('custom reports and dashboard', () => {
  let db;
  let admin;
  let para;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-cr-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (1, '2026-0001', 'Alpha', 'default', '2026-01-15', 'open')
    `).run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (1, '2026-0002', 'Beta', 'default', '2026-02-01', 'open')
    `).run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',2,20000,'2020-01-01')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    para = db.prepare('SELECT * FROM users WHERE id=2').get();
  });

  it('creates a matter custom report grouped by field and shows on dashboard', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Case stage',
      fieldType: 'select',
      options: ['Discovery', 'Trial'],
      appliesTo: 'matter',
      recordTypeKey: 'default',
    });
    customFields.setCustomValues(db, admin, 1, { [field.id]: 'Discovery' });
    customFields.setCustomValues(db, admin, 2, { [field.id]: 'Trial' });

    const report = customReports.createReport(db, admin, {
      name: 'Matters by stage',
      source: 'matter',
      groupByFieldId: field.id,
      metric: 'count',
      chartType: 'pie',
      showOnDashboard: true,
    });
    assert.equal(report.name, 'Matters by stage');

    const run = customReports.runReport(db, report.id);
    assert.equal(run.rows.length, 2);
    assert.equal(run.totals.count, 2);
    assert.ok(run.rows.some((r) => r.label === 'Discovery' && r.value === 1));

    const dash = customReports.dashboard(db);
    assert.equal(dash.widgets.length, 1);
    assert.equal(dash.widgets[0].report.name, 'Matters by stage');
  });

  it('aggregates time hours by time-entry custom field', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Work type',
      fieldType: 'select',
      options: ['Research', 'Call'],
      appliesTo: 'time_entry',
    });
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      hours: 1,
      description: 'Research memo',
      customValues: { [field.id]: 'Research' },
    });
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-02',
      hours: 0.5,
      description: 'Client call',
      customValues: { [field.id]: 'Call' },
    });
    timeSvc.createEntry(db, para, {
      matterId: 2,
      timekeeperId: 2,
      serviceDate: '2026-03-03',
      hours: 0.25,
      description: 'More research',
      customValues: { [field.id]: 'Research' },
    });

    const report = customReports.createReport(db, admin, {
      name: 'Hours by work type',
      source: 'time_entry',
      groupByFieldId: field.id,
      metric: 'hours',
      chartType: 'bar',
    });
    const run = customReports.runReport(db, report.id);
    const research = run.rows.find((r) => r.label === 'Research');
    const call = run.rows.find((r) => r.label === 'Call');
    assert.equal(research.hours, 1.25);
    assert.equal(call.hours, 0.5);
    assert.equal(run.totals.hours, 1.75);
  });

  it('rejects mismatched field source and deactivates reports', () => {
    const matterField = customFields.createCustomField(db, admin, {
      label: 'Lead',
      fieldType: 'text',
      appliesTo: 'matter',
      recordTypeKey: 'default',
    });
    assert.throws(() => customReports.createReport(db, admin, {
      name: 'Bad',
      source: 'time_entry',
      groupByFieldId: matterField.id,
      metric: 'hours',
    }), /applies to matter/);

    const report = customReports.createReport(db, admin, {
      name: 'Lead count',
      source: 'matter',
      groupByFieldId: matterField.id,
      metric: 'count',
      showOnDashboard: false,
    });
    customReports.deactivateReport(db, admin, report.id);
    assert.equal(customReports.listReports(db).length, 0);
    assert.equal(customReports.dashboard(db).widgets.length, 0);
  });
});
