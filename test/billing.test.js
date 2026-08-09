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
    VALUES (1, '2026-0001', 'NDCal Case', 'default', 'N.D. Cal.', 2, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0002', 'Other Case', 'default', 'S.D.N.Y.', 2, '2026-01-01')
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

  it('surfaces duplicate warnings without blocking', () => {
    const a = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'one',
    });
    const b = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'two',
    });
    assert.deepEqual(b.duplicateWarnings, [a.id]);
  });

  it('approval permissions: paralegal cannot; lead attorney can; clerk can', () => {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 2, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'x',
    });
    timeSvc.submitEntry(ctx.db, ctx.para, e.id);
    assert.throws(() => timeSvc.approveEntry(ctx.db, ctx.para, e.id), /not permitted/);
    // re-submit path: still submitted
    timeSvc.approveEntry(ctx.db, ctx.atty, e.id);
    assert.equal(ctx.db.prepare('SELECT status FROM time_entries WHERE id=?').get(e.id).status, 'approved');
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
    timeSvc.submitEntry(ctx.db, ctx.para, e.id);
    timeSvc.approveEntry(ctx.db, ctx.clerk, e.id);
    return e.id;
  }

  it('snapshots rates on pre-bill; later rate changes do not alter invoice', () => {
    approvedEntry(60);
    const inv = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    assert.equal(inv.lines[0].rate_cents, 45000);
    assert.equal(inv.lines[0].amount_cents, 45000);
    // change matter rate
    ctx.db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('matter',1,99999,'2026-03-01')").run();
    const again = invoiceSvc.getInvoice(ctx.db, inv.id);
    assert.equal(again.lines[0].rate_cents, 45000);
  });

  it('write-down records who/why/delta and reduces total', () => {
    approvedEntry(60);
    const inv = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    const updated = invoiceSvc.writeDownLine(ctx.db, ctx.clerk, inv.lines[0].id, 5000, 'courtesy');
    assert.equal(updated.write_down_cents, 5000);
    assert.equal(updated.total_cents, 40000);
    assert.equal(updated.writeDowns[0].reason, 'courtesy');
    assert.equal(updated.writeDowns[0].created_by, ctx.clerk.id);
  });

  it('exports bills as PDF and Excel', () => {
    approvedEntry(60);
    const inv = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    const pdf = invoiceSvc.toInvoicePdf(inv);
    assert.ok(Buffer.isBuffer(pdf));
    assert.ok(pdf.slice(0, 5).toString() === '%PDF-');
    assert.match(pdf.toString('latin1'), /Bill INV-/);

    const xlsx = invoiceSvc.toInvoiceXlsx(inv);
    assert.ok(Buffer.isBuffer(xlsx));
    assert.ok(xlsx.length > 100);
    // ZIP local file header signature
    assert.equal(xlsx[0], 0x50);
    assert.equal(xlsx[1], 0x4b);
  });

  it('pre-bill marks entries invoiced; void before bill releases them; sent bills are immutable', () => {
    approvedEntry(60);
    const inv = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    const linked = ctx.db.prepare('SELECT status, invoice_id FROM time_entries LIMIT 1').get();
    assert.equal(linked.status, 'invoiced');
    assert.equal(linked.invoice_id, inv.id);

    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'in_review');
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'approved');
    // void before bill releases entries back to approved
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'void');
    const entry = ctx.db.prepare('SELECT status, invoice_id FROM time_entries LIMIT 1').get();
    assert.equal(entry.status, 'approved');
    assert.equal(entry.invoice_id, null);

    // new invoice, send it
    const inv2 = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv2.id, 'in_review');
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv2.id, 'approved');
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv2.id, 'sent');

    assert.throws(() => {
      ctx.db.prepare('UPDATE invoices SET total_cents = 1 WHERE id = ?').run(inv2.id);
    }, /immutable/);

    const cn = invoiceSvc.createCreditNote(ctx.db, ctx.clerk, inv2.id, 1000, 'billing error');
    assert.equal(cn.amount_cents, 1000);
    assert.throws(() => invoiceSvc.setStatus(ctx.db, ctx.clerk, inv2.id, 'void'));
  });
});

describe('payments', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  function sentInvoice(amountMinutes = 60) {
    const e = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: amountMinutes,
      description: 'work', category: 'Discovery', subcategory: 'Review',
    });
    timeSvc.submitEntry(ctx.db, ctx.para, e.id);
    timeSvc.approveEntry(ctx.db, ctx.clerk, e.id);
    const inv = invoiceSvc.generatePrebill(ctx.db, ctx.clerk, 1);
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'in_review');
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'approved');
    invoiceSvc.setStatus(ctx.db, ctx.clerk, inv.id, 'sent');
    return inv;
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
