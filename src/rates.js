/**
 * Effective-dated rate resolution: matter → client → timekeeper.
 * Latest effective_date ≤ service_date wins; same-date tie → most recently entered.
 */

function resolveRate(db, { matterId, clientId, timekeeperId, serviceDate }) {
  const scopes = [
    ['matter', matterId],
    ['client', clientId],
    ['timekeeper', timekeeperId],
  ];

  for (const [scope, scopeId] of scopes) {
    if (scopeId == null) continue;
    const row = db.prepare(`
      SELECT amount_cents, effective_date, created_at
      FROM rates
      WHERE scope = ? AND scope_id = ? AND effective_date <= ?
      ORDER BY effective_date DESC, created_at DESC, id DESC
      LIMIT 1
    `).get(scope, scopeId, serviceDate);
    if (row) {
      return {
        amountCents: row.amount_cents,
        scope,
        effectiveDate: row.effective_date,
      };
    }
  }
  return null;
}

module.exports = { resolveRate };
