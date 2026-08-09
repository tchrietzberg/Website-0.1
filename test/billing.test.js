const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const timeSvc = require('../src/services/time');
const invoiceSvc = require('../src/services/invoices');
const paymentSvc = require('../src/services/payments');

function setup() {
  const db = resetDb(path.join(os.tmpdir(), `billing-${process.pid}-${Date.now()}-${Math.random()}.db`));
  setSetting(db, 'round_increment_minutes', '15');
  setSetting(db, 'round_mode', 'up');
  db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('atty@x.com','Atty','attorney')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('clerk@x.com','Clerk','billing_clerk')").run();
  db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0001', 'NDCal Case', 'billable', 'N.D. Cal.', 2, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0002', 'Other Case', 'billable', 'S.D.N.Y.', 2, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO billing_rules(name, condition_json, message, active)
    VALUES ('ndcal', '{"require_category_for_court":"N.D. Cal"}', 'N.D. Cal matters require category and subcategory', 1)
  `).run();
  db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',3,17500,'2020-01-01')").run();
  db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('matter',1,45000,'2020-01-01')").run();
  return {
    db,
    admin: db.prepare('SELECT * FROM users WHERE id=1').get(),
    atty: db.prepare('SELECT * FROM users WHERE id=2').get(),
    para: db.prepare('SELECT * FROM users WHERE id=3').get(),
    clerk: db.prepare('SELECT * FROM users WHERE id=4').get(),
  };
}

describe('time entry rules', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('blocks zero-duration at DB and service', () => {
    assert.throws(() => timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 0, description: 'x',
    }));
  });

  it('enforces N.D. Cal category/subcategory rule', () => {
    assert.throws(() => timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'x',
    }), /N\.D\. Cal/);
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15,
      description: 'ok', category: 'Discovery', subcategory: 'Review',
    });
    assert.equal(e.roundedMinutes, 15);
  });

  it('rounds up and defaults new entries to billable', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 7, description: 'call',
    });
    assert.equal(e.roundedMinutes, 15);
    assert.equal(e.billable, 1);
  });

  it('defaults billable from matter record type and allows override', () => {
    ctx.db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, responsible_attorney_id, opened_on)
      VALUES (1, '2026-0003', 'Pro Bono', 'non_billable', 2, '2026-01-01')
    `).run();
    const nb = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 3, timekeeperId: 3, serviceDate: '2026-03-02', rawMinutes: 15, description: 'clinic',
    });
    assert.equal(nb.billable, 0);

    const forced = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 3, timekeeperId: 3, serviceDate: '2026-03-03', rawMinutes: 15,
      description: 'exception', billable: 1,
    });
    assert.equal(forced.billable, 1);

    const onBillableMatter = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-04', rawMinutes: 15,
      description: 'nonbill override', billable: 0,
    });
    assert.equal(onBillableMatter.billable, 0);
  });

  it('accepts quarter-hour decimal hours without re-rounding', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1.25, description: 'review',
    });
    assert.equal(e.rawMinutes, 75);
    assert.equal(e.roundedMinutes, 75);
    assert.throws(() => timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1.1, description: 'bad',
    }), /0\.25 increments/);
  });

  it('surfaces duplicate warnings without blocking', () => {
    const a = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'one',
    });
    const b = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'two',
    });
    assert.deepEqual(b.duplicateWarnings, [a.id]);
  });

  it('saved time is immediately ready to bill (no approval step)', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'x',
    });
    assert.equal(e.status, 'approved');
    assert.equal(ctx.db.prepare('SELECT status FROM time_entries WHERE id=?').get(e.id).status, 'approved');
    const ready = invoiceSvc.listMattersReadyForBilling(ctx.db);
    assert.ok(ready.some((m) => m.id === 2));
  });

  it('updates unbilled time entry fields inline', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1, description: 'draft note',
    });
    const updated = timeSvc.updateEntry(ctx.db, ctx.para, e.id, {
      matterId: 2,
      serviceDate: '2026-03-02',
      hours: 1.5,
      description: 'Revised research note',
    });
    assert.equal(updated.serviceDate, '2026-03-02');
    assert.equal(updated.description, 'Revised research note');
    assert.equal(updated.roundedMinutes, 90);
    const listed = timeSvc.listEntries(ctx.db, {}, ctx.para);
    const row = listed.find((r) => r.id === e.id);
    assert.ok(row);
    assert.equal(row.matter_name, 'Other Case');
    assert.equal(row.description, 'Revised research note');
  });

  it('blocks editing billed time entries', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1,
      description: 'billed work', category: 'Discovery', subcategory: 'Review',
    });
    invoiceSvc.createBill(ctx.db, ctx.clerk, 1, [e.id]);
    assert.throws(
      () => timeSvc.updateEntry(ctx.db, ctx.para, e.id, { description: 'nope' }),
      /already been billed/
    );
  });

  it('deletes recent unbilled time entries', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1,
      description: 'to delete', category: 'Discovery', subcategory: 'Review',
    });
    const removed = timeSvc.deleteEntry(ctx.db, ctx.para, e.id);
    assert.equal(removed.ok, true);
    assert.equal(ctx.db.prepare('SELECT id FROM time_entries WHERE id = ?').get(e.id), undefined);
  });

  it('deletes billed time entries and removes them from the bill', () => {
    const a = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', hours: 1,
      description: 'keep on bill', category: 'Discovery', subcategory: 'Review',
    });
    const b = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-02', hours: 1,
      description: 'delete-check', category: 'Discovery', subcategory: 'Review',
    });
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1, [a.id, b.id]);
    assert.equal(inv.lines.length, 2);

    const removed = timeSvc.deleteEntry(ctx.db, ctx.para, b.id);
    assert.equal(removed.ok, true);
    assert.equal(removed.wasBilled, true);
    assert.equal(removed.removedBillLines, 1);
    assert.equal(ctx.db.prepare('SELECT id FROM time_entries WHERE id = ?').get(b.id), undefined);

    const again = invoiceSvc.getInvoice(ctx.db, inv.id);
    assert.ok(again);
    assert.equal(again.status, 'sent');
    assert.equal(again.lines.length, 1);
    assert.equal(again.lines[0].time_entry_id, a.id);
    assert.equal(again.total_cents, again.lines[0].amount_cents);

    // Sole remaining billed entry: delete removes entry and empty bill.
    const removedLast = timeSvc.deleteEntry(ctx.db, ctx.para, a.id);
    assert.equal(removedLast.ok, true);
    assert.ok(removedLast.deletedInvoiceIds.includes(inv.id));
    assert.equal(invoiceSvc.getInvoice(ctx.db, inv.id), null);
  });
});

describe('invoice lifecycle', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  function approvedEntry(minutes = 60) {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: minutes,
      description: 'work', category: 'Discovery', subcategory: 'Review',
    });
    return e.id;
  }

  it('snapshots rates on bill; later rate changes do not alter invoice', () => {
    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    assert.equal(inv.status, 'sent');
    assert.equal(inv.lines[0].rate_cents, 45000);
    assert.equal(inv.lines[0].amount_cents, 45000);
    // change matter rate
    ctx.db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('matter',1,99999,'2026-03-01')").run();
    const again = invoiceSvc.getInvoice(ctx.db, inv.id);
    assert.equal(again.lines[0].rate_cents, 45000);
  });

  it('blocks write-downs on issued bills', () => {
    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    assert.throws(
      () => invoiceSvc.writeDownLine(ctx.db, ctx.clerk, inv.lines[0].id, 5000, 'courtesy'),
      /cannot be edited/
    );
  });

  it('exports bills as PDF and Excel with matter name', () => {
    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    assert.equal(inv.matter_name, 'NDCal Case');
    const fields = invoiceSvc.getBillFields(ctx.db);
    const pdf = invoiceSvc.toInvoicePdf(inv, fields);
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.slice(0, 5).toString() === '%PDF-');
    assert.match(pdf.toString('latin1'), /Bill INV-/);
    assert.match(pdf.toString('latin1'), /NDCal Case/);
    assert.match(pdf.toString('latin1'), /Matter name/);

    const xlsx = invoiceSvc.toInvoiceXlsx(inv, fields);
    assert.ok(Buffer.isBuffer(xlsx));
    assert.ok(xlsx.length > 100);
    // ZIP local file header signature
    assert.equal(xlsx[0], 0x50);
    assert.equal(xlsx[1], 0x4b);
  });

  it('lets firms add and remove fields included on bills', () => {
    const defaults = invoiceSvc.getBillFieldConfig(ctx.db);
    assert.ok(defaults.headerKeys.includes('matter_name'));
    assert.ok(defaults.lineKeys.includes('timekeeper'));

    invoiceSvc.removeBillField(ctx.db, ctx.clerk, { group: 'header', key: 'matter_name' });
    invoiceSvc.removeBillField(ctx.db, ctx.clerk, { group: 'lines', key: 'timekeeper' });
    invoiceSvc.addBillField(ctx.db, ctx.clerk, { group: 'header', key: 'due_date' });
    invoiceSvc.addBillField(ctx.db, ctx.clerk, { group: 'lines', key: 'minutes' });

    const cfg = invoiceSvc.getBillFieldConfig(ctx.db);
    assert.ok(!cfg.headerKeys.includes('matter_name'));
    assert.ok(cfg.headerKeys.includes('due_date'));
    assert.ok(!cfg.lineKeys.includes('timekeeper'));
    assert.ok(cfg.lineKeys.includes('minutes'));

    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    const pdf = invoiceSvc.toInvoicePdf(inv, invoiceSvc.getBillFields(ctx.db)).toString('latin1');
    assert.doesNotMatch(pdf, /Matter name/);
    assert.match(pdf, /Due date/);
    assert.doesNotMatch(pdf, /Timekeeper/);
  });

  it('create bill issues immediately, marks entries invoiced, and is immutable', () => {
    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    assert.equal(inv.status, 'sent');
    assert.ok(inv.issue_date);
    const linked = ctx.db.prepare('SELECT status, invoice_id FROM time_entries LIMIT 1').get();
    assert.equal(linked.status, 'invoiced');
    assert.equal(linked.invoice_id, inv.id);

    assert.throws(() => {
      ctx.db.prepare('UPDATE invoices SET total_cents = 1 WHERE id = ?').run(inv.id);
    }, /immutable/);

    assert.throws(() => invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'void'));
    assert.throws(() => invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'in_review'));

    const cn = invoiceSvc.createCreditNote(ctx.db, ctx.clerk, inv.id, 1000, 'billing error');
    assert.equal(cn.amount_cents, 1000);
  });

  it('create bill can filter by service-date range', () => {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 60,
      description: 'march', category: 'Discovery', subcategory: 'Review',
    });
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-04-15', rawMinutes: 60,
      description: 'april', category: 'Discovery', subcategory: 'Review',
    });
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1, {
      dateFrom: '2026-04-01',
      dateTo: '2026-04-30',
    });
    assert.equal(inv.lines.length, 1);
    assert.equal(inv.lines[0].service_date, '2026-04-15');
    const left = ctx.db.prepare(`
      SELECT COUNT(*) AS n FROM time_entries
      WHERE matter_id = 1 AND invoice_id IS NULL AND status = 'approved'
    `).get().n;
    assert.equal(left, 1);
  });

  it('create bill explains missing rates with timekeeper and date', () => {
    // Entry for attorney #2 who has no rate in this fixture.
    timeSvc.createEntry(ctx.db, ctx.atty, {
      matterId: 2, timekeeperId: 2, serviceDate: '2026-03-01', rawMinutes: 60,
      description: 'no rate work',
    });
    assert.throws(
      () => invoiceSvc.createBill(ctx.db, ctx.clerk, 2),
      /No rate for Atty on 2026-03-01/
    );
  });

  it('deletes a bill from the ledger and returns time to unbilled', () => {
    approvedEntry(60);
    const inv = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    invoiceSvc.createCreditNote(ctx.db, ctx.clerk, inv.id, 1000, 'adjust');
    paymentSvc.recordPayment(ctx.db, ctx.clerk, {
      clientId: 1,
      amountCents: 5000,
      receivedOn: '2026-04-01',
      applications: [{ invoiceId: inv.id, amountCents: 5000 }],
    });

    const result = invoiceSvc.deleteInvoice(ctx.db, ctx.clerk, inv.id);
    assert.equal(result.ok, true);
    assert.equal(invoiceSvc.getInvoice(ctx.db, inv.id), null);

    const entry = ctx.db.prepare('SELECT status, invoice_id FROM time_entries LIMIT 1').get();
    assert.equal(entry.status, 'approved');
    assert.equal(entry.invoice_id, null);

    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS n FROM payment_applications WHERE invoice_id = ?').get(inv.id).n,
      0
    );
    assert.equal(
      ctx.db.prepare('SELECT COUNT(*) AS n FROM credit_notes WHERE invoice_id = ?').get(inv.id).n,
      0
    );
    // Payment itself remains (only applications were cleared).
    assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM payments').get().n, 1);

    // Time can be billed again.
    const again = invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
    assert.equal(again.lines.length, 1);
  });
});

describe('payments', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  function sentInvoice(amountMinutes = 60) {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: amountMinutes,
      description: 'work', category: 'Discovery', subcategory: 'Review',
    });
    return invoiceSvc.createBill(ctx.db, ctx.clerk, 1);
  }

  it('applies oldest-first and keeps overpayment unapplied', () => {
    const inv = sentInvoice(60); // $450
    const pay = paymentSvc.recordPayment(ctx.db, ctx.clerk, {
      clientId: 1,
      amountCents: 50000, // $500
      receivedOn: '2026-04-01',
    });
    assert.equal(pay.applications[0].invoiceId, inv.id);
    assert.equal(pay.applications[0].amountCents, 45000);
    assert.equal(pay.unappliedCents, 5000);
    assert.equal(paymentSvc.invoiceBalance(ctx.db, inv.id), 0);
  });

  it('supports user-directed application', () => {
    const inv = sentInvoice(60);
    const pay = paymentSvc.recordPayment(ctx.db, ctx.clerk, {
      clientId: 1,
      amountCents: 10000,
      receivedOn: '2026-04-01',
      applications: [{ invoiceId: inv.id, amountCents: 10000 }],
    });
    assert.equal(pay.applications[0].amountCents, 10000);
    assert.equal(paymentSvc.invoiceBalance(ctx.db, inv.id), 35000);
  });
});
