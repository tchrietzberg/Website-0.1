const { audit } = require('../db');

function invoiceBalance(db, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv || inv.status !== 'sent') return 0;
  const applied = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payment_applications WHERE invoice_id = ?
  `).get(invoiceId).s;
  const credits = db.prepare(`
    SELECT COALESCE(SUM(amount_cents), 0) AS s FROM credit_notes WHERE invoice_id = ?
  `).get(invoiceId).s;
  return inv.total_cents - applied - credits;
}

function recordPayment(db, actor, input) {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new Error('amountCents must be positive integer');
  }
  const info = db.prepare(`
    INSERT INTO payments(client_id, amount_cents, received_on, method, reference, notes, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    input.clientId,
    input.amountCents,
    input.receivedOn,
    input.method || null,
    input.reference || null,
    input.notes || null,
    actor.id
  );
  const paymentId = Number(info.lastInsertRowid);

  let remaining = input.amountCents;
  const applications = [];

  if (input.applications && input.applications.length) {
    // user-directed
    for (const a of input.applications) {
      if (remaining <= 0) break;
      const bal = invoiceBalance(db, a.invoiceId);
      const amt = Math.min(a.amountCents, bal, remaining);
      if (amt <= 0) continue;
      db.prepare(`
        INSERT INTO payment_applications(payment_id, invoice_id, amount_cents, created_by)
        VALUES (?, ?, ?, ?)
      `).run(paymentId, a.invoiceId, amt, actor.id);
      applications.push({ invoiceId: a.invoiceId, amountCents: amt });
      remaining -= amt;
    }
  } else {
    // oldest-first across client's sent invoices
    const invoices = db.prepare(`
      SELECT i.id FROM invoices i
      JOIN matters m ON m.id = i.matter_id
      WHERE m.client_id = ? AND i.status = 'sent'
      ORDER BY i.issue_date ASC, i.id ASC
    `).all(input.clientId);
    for (const inv of invoices) {
      if (remaining <= 0) break;
      const bal = invoiceBalance(db, inv.id);
      if (bal <= 0) continue;
      const amt = Math.min(bal, remaining);
      db.prepare(`
        INSERT INTO payment_applications(payment_id, invoice_id, amount_cents, created_by)
        VALUES (?, ?, ?, ?)
      `).run(paymentId, inv.id, amt, actor.id);
      applications.push({ invoiceId: inv.id, amountCents: amt });
      remaining -= amt;
    }
  }

  audit(db, {
    actorId: actor.id,
    action: 'payment.record',
    entityType: 'payment',
    entityId: paymentId,
    detail: { amountCents: input.amountCents, applied: applications, unapplied: remaining },
  });

  return {
    id: paymentId,
    amountCents: input.amountCents,
    applications,
    unappliedCents: remaining,
  };
}

function listPayments(db) {
  return db.prepare(`
    SELECT p.*, c.name AS client_name,
      (SELECT COALESCE(SUM(amount_cents),0) FROM payment_applications pa WHERE pa.payment_id = p.id) AS applied_cents
    FROM payments p
    JOIN clients c ON c.id = p.client_id
    ORDER BY p.received_on DESC, p.id DESC
  `).all().map((p) => ({
    ...p,
    unapplied_cents: p.amount_cents - p.applied_cents,
  }));
}

function unappliedCash(db) {
  return listPayments(db).filter((p) => p.unapplied_cents > 0);
}

module.exports = { recordPayment, listPayments, invoiceBalance, unappliedCash };
