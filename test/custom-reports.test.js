const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const customFields = require('../src/services/customFields');
const customReports = require('../src/services/customReports');
const permissions = require('../src/services/permissions');
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
      VALUES (1, '2026-0001', 'Alpha', 'billable', '2026-01-15', 'open')
    `).run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (1, '2026-0002', 'Beta', 'billable', '2026-02-01', 'open')
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
      recordTypeKey: 'billable',
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
      recordTypeKey: 'billable',
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

  it('pins and unpins firm reports on the dashboard', () => {
    assert.equal(customReports.dashboard(db).widgets.length, 0);
    customReports.pinDashboardReport(db, admin, { kind: 'firm', id: 'matters' });
    customReports.pinDashboardReport(db, admin, { kind: 'firm', id: 'lodestar-summary' });
    let dash = customReports.dashboard(db);
    assert.equal(dash.widgets.length, 2);
    assert.equal(dash.widgets[0].kind, 'firm');
    assert.equal(dash.widgets[0].report.id, 'matters');
    assert.equal(dash.widgets[0].rows.length, 2);
    assert.ok(dash.available.firm.every((r) => r.id !== 'matters'));

    customReports.unpinDashboardReport(db, admin, { kind: 'firm', id: 'matters' });
    dash = customReports.dashboard(db);
    assert.equal(dash.widgets.length, 1);
    assert.equal(dash.widgets[0].report.id, 'lodestar-summary');
    assert.ok(dash.available.firm.some((r) => r.id === 'matters'));
  });

  it('unpins custom reports without deleting them and exports dashboard', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Region',
      fieldType: 'text',
      appliesTo: 'matter',
      recordTypeKey: 'billable',
    });
    const report = customReports.createReport(db, admin, {
      name: 'By region',
      source: 'matter',
      groupByFieldId: field.id,
      metric: 'count',
      showOnDashboard: true,
    });
    customReports.pinDashboardReport(db, admin, { kind: 'firm', id: 'matters' });

    let dash = customReports.dashboard(db);
    assert.equal(dash.widgets.length, 2);

    customReports.unpinDashboardReport(db, admin, { kind: 'custom', id: report.id });
    dash = customReports.dashboard(db);
    assert.equal(dash.widgets.length, 1);
    assert.equal(customReports.listReports(db).length, 1);
    assert.equal(customReports.getReport(db, report.id).show_on_dashboard, 0);

    const pdf = customReports.exportDashboard(db, 'pdf');
    assert.equal(pdf.contentType, 'application/pdf');
    assert.ok(pdf.body.length > 40);
    assert.match(pdf.filename, /\.pdf$/);

    const csv = customReports.exportDashboard(db, 'csv');
    assert.match(csv.contentType, /csv/);
    assert.match(csv.body.toString('utf8'), /Matters/);

    const xlsx = customReports.exportDashboard(db, 'xlsx');
    assert.match(xlsx.contentType, /spreadsheetml/);
    assert.ok(xlsx.body.length > 40);
  });

  it('deletes and restores firm reports from the firm catalog', () => {
    customReports.pinDashboardReport(db, admin, { kind: 'firm', id: 'matters' });
    assert.ok(customReports.dashboard(db).widgets.some((w) => w.report.id === 'matters'));

    const removed = customReports.disableFirmReport(db, admin, 'matters');
    assert.equal(removed.ok, true);
    assert.ok(customReports.getDisabledFirmReportIds(db).includes('matters'));
    assert.ok(!customReports.listFirmReports(db).some((r) => r.id === 'matters'));
    assert.ok(customReports.listFirmReports(db, { includeDisabled: true })
      .some((r) => r.id === 'matters' && r.disabled));
    assert.ok(!customReports.dashboard(db).widgets.some((w) => w.report.id === 'matters'));
    assert.throws(() => customReports.runFirmReport(db, 'matters'), /removed/i);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: false, delete: false },
        },
      },
    });
    assert.throws(() => customReports.disableFirmReport(db, para, 'lodestar-summary'), /permission to delete/);
    assert.throws(() => customReports.enableFirmReport(db, para, 'matters'), /read only/i);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: false, delete: true },
        },
      },
    });
    customReports.enableFirmReport(db, para, 'matters');
    assert.ok(!customReports.getDisabledFirmReportIds(db).includes('matters'));
    customReports.disableFirmReport(db, para, 'matters');

    customReports.enableFirmReport(db, admin, 'matters');
    assert.ok(!customReports.getDisabledFirmReportIds(db).includes('matters'));
    assert.ok(customReports.listFirmReports(db).some((r) => r.id === 'matters'));
  });

  it('updates and deletes custom reports with report permissions', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Desk',
      fieldType: 'text',
      appliesTo: 'matter',
      recordTypeKey: 'billable',
    });
    const report = customReports.createReport(db, admin, {
      name: 'By desk',
      source: 'matter',
      groupByFieldId: field.id,
      metric: 'count',
      chartType: 'bar',
      showOnDashboard: true,
    });
    const updated = customReports.updateReport(db, admin, report.id, {
      name: 'Desks revised',
      description: 'Updated firm report',
      chartType: 'pie',
      showOnDashboard: false,
    });
    assert.equal(updated.name, 'Desks revised');
    assert.equal(updated.description, 'Updated firm report');
    assert.equal(updated.chart_type, 'pie');
    assert.equal(updated.show_on_dashboard, 0);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: false, delete: false },
        },
      },
    });
    assert.throws(
      () => customReports.updateReport(db, para, report.id, { name: 'Nope' }),
      /read only/i
    );
    assert.throws(
      () => customReports.deactivateReport(db, para, report.id),
      /permission to delete/
    );

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: true, delete: true },
        },
      },
    });
    const removed = customReports.deactivateReport(db, para, report.id);
    assert.equal(removed.ok, true);
    assert.equal(customReports.listReports(db).length, 0);
  });
});
