const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const timeSvc = require('../src/services/time');
const reports = require('../src/services/reports');

describe('matters report', () => {
  let db;
  let admin;
  let para;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-reports-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on, status)
      VALUES (1, '2026-0001', 'Alpha Matter', 'billable', 'S.D.N.Y.', 1, '2026-01-15', 'open')
    `).run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (1, '2026-0002', 'Beta Matter', 'billable', '2026-02-01', 'closed')
    `).run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',2,20000,'2020-01-01')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    para = db.prepare('SELECT * FROM users WHERE id=2').get();
  });

  it('lists matter names only', () => {
    const rows = reports.mattersReport(db);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.Matter).sort(), ['Alpha Matter', 'Beta Matter']);
    assert.deepEqual(Object.keys(rows[0]), ['Matter']);
  });

  it('swaps inverted date ranges so the full window is kept', () => {
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-08-09',
      rawMinutes: 30,
      description: 'Earlier day',
    });
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-08-10',
      rawMinutes: 60,
      description: 'TZ skew entry',
    });
    const detail = reports.lodestarMatterDetail(db, 1, {
      dateFrom: '2026-08-10',
      dateTo: '2026-08-09',
    });
    assert.equal(detail.totals.minutes, 90);
    assert.equal(detail.header.date_from, '2026-08-09');
    assert.equal(detail.header.date_to, '2026-08-10');
    assert.equal(detail.timekeepers[0].entries.length, 2);
  });

  it('keeps separate summary rows when a timekeeper rate changes', () => {
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',2,30000,'2026-04-01')").run();
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-15',
      rawMinutes: 60,
      description: 'Old rate',
    });
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-04-15',
      rawMinutes: 60,
      description: 'New rate',
    });
    const summary = reports.lodestarMatterSummary(db, 1);
    assert.equal(summary.summary.length, 2);
    const rates = summary.summary.map((r) => r.rate_cents).sort((a, b) => a - b);
    assert.deepEqual(rates, [20000, 30000]);
    assert.equal(summary.totals.amount_cents, 50000);
  });

  it('includes non-billable time in lodestar at $0', () => {
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Billable research',
      billable: 1,
    });
    timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Non-billable admin',
      billable: 0,
    });
    const detail = reports.lodestarMatterDetail(db, 1);
    assert.equal(detail.timekeepers[0].entries.length, 2);
    assert.equal(detail.totals.minutes, 120);
    const nonBillable = detail.timekeepers[0].entries.find((e) => !e.billable);
    assert.ok(nonBillable);
    assert.equal(nonBillable.amount_cents, 0);
    assert.equal(nonBillable.rate_cents, 0);
    assert.equal(detail.totals.amount_cents, 20000);
  });

  it('builds friendly lodestar matter detail and summary PDF/Excel', () => {
    const entry = timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Research',
    });
    const detail = reports.lodestarMatterDetail(db, 1);
    assert.equal(detail.header.matter_name, 'Alpha Matter');
    assert.equal(detail.summary.length, 1);
    assert.equal(detail.summary[0].timekeeper, 'Para');
    assert.equal(detail.totals.minutes, 60);

    const pdf = reports.lodestarMatterDetailPdf(db, 1);
    assert.ok(Buffer.isBuffer(pdf));
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
    const pdfText = pdf.toString('latin1');
    assert.match(pdfText, /Lodestar Detail/);
    assert.match(pdfText, /Timekeeper/);
    assert.match(pdfText, /Research/);
    assert.match(pdfText, /Alpha Matter/);
    assert.match(pdfText, /Period:/);

    const summaryPdf = reports.lodestarMatterSummaryPdf(db, 1);
    assert.match(summaryPdf.toString('latin1'), /Alpha Matter/);
    assert.match(summaryPdf.toString('latin1'), /Timekeeper Summary/);
    assert.match(summaryPdf.toString('latin1'), /Period:/);

    const xlsx = reports.lodestarMatterDetailXlsx(db, 1);
    assert.ok(xlsx[0] === 0x50 && xlsx[1] === 0x4b);
    const summaryXlsx = reports.lodestarMatterSummaryXlsx(db, 1);
    assert.ok(summaryXlsx.length > 100);
  });

  it('exports firm reports as PDF', () => {
    const entry = timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Research',
    });
    const mattersPdf = reports.toPdf(reports.mattersReport(db), {
      title: 'Matters Report',
      currencyKeys: [],
    });
    assert.ok(Buffer.isBuffer(mattersPdf));
    assert.equal(mattersPdf.slice(0, 5).toString(), '%PDF-');
    assert.match(mattersPdf.toString('latin1'), /Matters Report/);
    assert.match(mattersPdf.toString('latin1'), /Matter/);
    assert.match(mattersPdf.toString('latin1'), /Alpha Matter/);
    assert.doesNotMatch(mattersPdf.toString('latin1'), /Matter Name/);

    const lodestarPdf = reports.toPdf(reports.lodestarSummary(db), {
      title: 'Lodestar Summary (all matters)',
      currencyKeys: ['amount_cents', 'rate_cents'],
    });
    assert.equal(lodestarPdf.slice(0, 5).toString(), '%PDF-');
    assert.match(lodestarPdf.toString('latin1'), /Lodestar Summary/);
  });
});
