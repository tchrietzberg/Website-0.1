const { audit } = require('../db');
const { resolveRate } = require('../rates');

function listRates(db, { scope = null, scopeId = null } = {}) {
  return db.prepare(`
    SELECT r.*,
      CASE r.scope
        WHEN 'timekeeper' THEN (SELECT name FROM users WHERE id = r.scope_id)
        WHEN 'client' THEN (SELECT name FROM clients WHERE id = r.scope_id)
        WHEN 'matter' THEN (SELECT number || ' — ' || name FROM matters WHERE id = r.scope_id)
      END AS scope_name,
      u.name AS created_by_name
    FROM rates r
    LEFT JOIN users u ON u.id = r.created_by
    WHERE (? IS NULL OR r.scope = ?)
      AND (? IS NULL OR r.scope_id = ?)
    ORDER BY r.scope, r.scope_id, r.effective_date DESC, r.created_at DESC, r.id DESC
  `).all(scope, scope, scopeId, scopeId);
}

function addRate(db, actor, input) {
  const scope = input.scope;
  const scopeId = Number(input.scopeId);
  const amountCents = Number(input.amountCents);
  const effectiveDate = String(input.effectiveDate || '').slice(0, 10);

  if (!['matter', 'client', 'timekeeper'].includes(scope)) {
    throw new Error('scope must be matter, client, or timekeeper');
  }
  if (!Number.isInteger(scopeId) || scopeId <= 0) throw new Error('scopeId required');
  if (!Number.isInteger(amountCents) || amountCents < 0) {
    throw new Error('amountCents must be a non-negative integer');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveDate)) {
    throw new Error('effectiveDate must be YYYY-MM-DD');
  }

  if (scope === 'timekeeper') {
    const u = db.prepare('SELECT id FROM users WHERE id = ?').get(scopeId);
    if (!u) throw new Error('timekeeper not found');
  } else if (scope === 'client') {
    const c = db.prepare('SELECT id FROM clients WHERE id = ?').get(scopeId);
    if (!c) throw new Error('client not found');
  } else {
    const m = db.prepare('SELECT id FROM matters WHERE id = ?').get(scopeId);
    if (!m) throw new Error('matter not found');
  }

  const info = db.prepare(`
    INSERT INTO rates(scope, scope_id, amount_cents, effective_date, created_by)
    VALUES (?, ?, ?, ?, ?)
  `).run(scope, scopeId, amountCents, effectiveDate, actor.id);

  const id = Number(info.lastInsertRowid);
  audit(db, {
    actorId: actor.id,
    action: 'rate.create',
    entityType: 'rate',
    entityId: id,
    detail: { scope, scopeId, amountCents, effectiveDate },
  });

  return db.prepare('SELECT * FROM rates WHERE id = ?').get(id);
}

function timekeeperRatesSummary(db, asOf = new Date().toISOString().slice(0, 10)) {
  const users = db.prepare(
    "SELECT id, email, name, role FROM users WHERE active = 1 AND role IN ('attorney','paralegal','admin','billing_clerk') ORDER BY name"
  ).all();
  return users.map((u) => {
    const current = resolveRate(db, {
      matterId: null,
      clientId: null,
      timekeeperId: u.id,
      serviceDate: asOf,
    });
    const history = listRates(db, { scope: 'timekeeper', scopeId: u.id });
    return {
      ...u,
      current_rate_cents: current?.amountCents ?? null,
      current_effective_date: current?.effectiveDate ?? null,
      rates: history,
    };
  });
}

module.exports = { listRates, addRate, timekeeperRatesSummary };
