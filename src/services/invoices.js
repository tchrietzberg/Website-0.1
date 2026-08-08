const { amountFromMinutes } = require('../money');
const { resolveRate } = require('../rates');
const { allocateNumber, audit } = require('../db');

function generatePrebill(db, actor, matterId, entryIds = null) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  let entries;
  if (entryIds && entryIds.length) {
    const placeholders = entryIds.map(() => '?').join(',');
    entries = db.prepare(`
      SELECT * FROM time_entries
      WHERE matter_id = ? AND status = 'approved' AND id IN (${placeholders})
      ORDER BY service_date, id
    `).all(matterId, ...entryIds);
  } else {
    entries = db.prepare(`
      SELECT * FROM time_entries
      WHERE matter_id = ? AND status = 'approved' AND invoice_id IS NULL
        AND rounded_minutes > 0
      ORDER BY service_date, id
    `).all(matterId);
  }
  if (!entries.length) throw new Error('no approved WIP entries for pre-bill');

  const year = new Date().getUTCFullYear();
  const number = allocateNumber(db, 'invoice', year, 'INV-');

  const inv = db.prepare(`
    INSERT INTO invoices(matter_id, number, status, created_by, subtotal_cents, write_down_cents, total_cents)
    VALUES (?, ?, 'prebill', ?, 0, 0, 0)
  `).run(matterId, number, actor.id);
  const invoiceId = Number(inv.lastInsertRowid);

  let subtotal = 0;
  let order = 0;
  for (const e of entries) {
    const rate = resolveRate(db, {
      matterId: matter.id,
      clientId: matter.client_id,
      timekeeperId: e.timekeeper_id,
      serviceDate: e.service_date,
    });
    if (!rate) throw new Error(`no rate for entry ${e.id} on ${e.service_date}`);
    const amount = amountFromMinutes(e.rounded_minutes, rate.amountCents);
    subtotal += amount;
    db.prepare(`
      INSERT INTO invoice_lines(
        invoice_id, time_entry_id, service_date, description, timekeeper_id,
        minutes, rate_cents, amount_cents, write_down_cents, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      invoiceId, e.id, e.service_date, e.description, e.timekeeper_id,
      e.rounded_minutes, rate.amountCents, amount, order++
    );
  }

  db.prepare(`
    UPDATE invoices SET subtotal_cents = ?, write_down_cents = 0, total_cents = ? WHERE id = ?
  `).run(subtotal, subtotal, invoiceId);

  audit(db, {
    actorId: actor.id,
    action: 'invoice.prebill',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: { number, entryCount: entries.length, subtotal },
  });
  return getInvoice(db, invoiceId);
}

function recomputeTotals(db, invoiceId) {
  const lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ?').all(invoiceId);
  const subtotal = lines.reduce((s, l) => s + l.amount_cents, 0);
  const writeDown = lines.reduce((s, l) => s + l.write_down_cents, 0);
  const total = subtotal - writeDown;
  db.prepare(`
    UPDATE invoices SET subtotal_cents = ?, write_down_cents = ?, total_cents = ? WHERE id = ?
  `).run(subtotal, writeDown, total, invoiceId);
}

function assertEditable(inv) {
  if (!['prebill', 'in_review'].includes(inv.status)) {
    throw new Error(`invoice in status ${inv.status} cannot be edited`);
  }
}

function writeDownLine(db, actor, lineId, deltaCents, reason) {
  if (!Number.isInteger(deltaCents) || deltaCents <= 0) throw new Error('deltaCents must be positive integer');
  if (!reason || !String(reason).trim()) throw new Error('reason required');
  const line = db.prepare('SELECT * FROM invoice_lines WHERE id = ?').get(lineId);
  if (!line) throw new Error('line not found');
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(line.invoice_id);
  assertEditable(inv);
  const newWd = line.write_down_cents + deltaCents;
  if (newWd > line.amount_cents) throw new Error('write-down exceeds line amount');
  db.prepare('UPDATE invoice_lines SET write_down_cents = ? WHERE id = ?').run(newWd, lineId);
  db.prepare(`
    INSERT INTO write_downs(invoice_id, invoice_line_id, delta_cents, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(inv.id, lineId, deltaCents, reason, actor.id);
  recomputeTotals(db, inv.id);
  audit(db, {
    actorId: actor.id,
    action: 'invoice.write_down',
    entityType: 'invoice',
    entityId: inv.id,
    detail: { lineId, deltaCents, reason },
  });
  return getInvoice(db, inv.id);
}

function setStatus(db, actor, invoiceId, status) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new Error('invoice not found');
  const transitions = {
    prebill: ['in_review', 'void'],
    in_review: ['approved', 'prebill', 'void'],
    approved: ['sent', 'void'],
    sent: [],
    void: [],
  };
  if (!(transitions[inv.status] || []).includes(status)) {
    throw new Error(`cannot transition ${inv.status} → ${status}`);
  }

  if (status === 'void') {
    if (inv.status === 'sent') throw new Error('cannot void a sent invoice');
    // release WIP
    db.prepare(`
      UPDATE time_entries SET status = 'approved', invoice_id = NULL
      WHERE invoice_id = ?
    `).run(invoiceId);
    db.prepare(`
      UPDATE invoices SET status = 'void', voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
    `).run(invoiceId);
  } else if (status === 'approved') {
    db.prepare(`
      UPDATE invoices SET status = 'approved', approved_by = ?,
        approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
    `).run(actor.id, invoiceId);
  } else if (status === 'sent') {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      UPDATE invoices SET status = 'sent', issue_date = ?, due_date = date(?, '+30 days'),
        sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
    `).run(today, today, invoiceId);
  } else {
    db.prepare('UPDATE invoices SET status = ? WHERE id = ?').run(status, invoiceId);
  }

  audit(db, {
    actorId: actor.id,
    action: `invoice.${status}`,
    entityType: 'invoice',
    entityId: invoiceId,
  });
  return getInvoice(db, invoiceId);
}

function createCreditNote(db, actor, invoiceId, amountCents, reason) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new Error('invoice not found');
  if (inv.status !== 'sent') throw new Error('credit notes only for sent invoices');
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error('amount must be positive integer cents');
  const year = new Date().getUTCFullYear();
  const number = allocateNumber(db, 'credit_note', year, 'CN-');
  const info = db.prepare(`
    INSERT INTO credit_notes(invoice_id, number, amount_cents, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(invoiceId, number, amountCents, reason, actor.id);
  audit(db, {
    actorId: actor.id,
    action: 'invoice.credit_note',
    entityType: 'credit_note',
    entityId: Number(info.lastInsertRowid),
    detail: { invoiceId, amountCents, reason },
  });
  return db.prepare('SELECT * FROM credit_notes WHERE id = ?').get(info.lastInsertRowid);
}

function getInvoice(db, id) {
  const invoice = db.prepare(`
    SELECT i.*, m.number AS matter_number, m.name AS matter_name, c.name AS client_name
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    JOIN clients c ON c.id = m.client_id
    WHERE i.id = ?
  `).get(id);
  if (!invoice) return null;
  const lines = db.prepare(`
    SELECT l.*, u.name AS timekeeper_name
    FROM invoice_lines l
    JOIN users u ON u.id = l.timekeeper_id
    WHERE l.invoice_id = ?
    ORDER BY l.sort_order, l.id
  `).all(id);
  const writeDowns = db.prepare('SELECT * FROM write_downs WHERE invoice_id = ? ORDER BY id').all(id);
  const credits = db.prepare('SELECT * FROM credit_notes WHERE invoice_id = ? ORDER BY id').all(id);
  return { ...invoice, lines, writeDowns, credits };
}

function listInvoices(db) {
  return db.prepare(`
    SELECT i.*, m.number AS matter_number, c.name AS client_name
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    JOIN clients c ON c.id = m.client_id
    ORDER BY i.created_at DESC
  `).all();
}

module.exports = {
  generatePrebill,
  writeDownLine,
  setStatus,
  createCreditNote,
  getInvoice,
  listInvoices,
};
