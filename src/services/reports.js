const { amountFromMinutes, formatCents } = require('../money');
const { resolveRate } = require('../rates');
const { buildXlsx } = require('../xlsx');

function lodestarDetail(db, { matterId = null } = {}) {
  const entries = db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.name AS matter_name,
           m.client_id, m.id AS mid
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE te.billable = 1 AND te.status IN ('approved','invoiced')
      AND (? IS NULL OR te.matter_id = ?)
    ORDER BY m.number, u.name, te.service_date, te.id
  `).all(matterId, matterId);

  return entries.map((e) => {
    const rate = resolveRate(db, {
      matterId: e.mid,
      clientId: e.client_id,
      timekeeperId: e.timekeeper_id,
      serviceDate: e.service_date,
    });
    const rateCents = rate?.amountCents ?? 0;
    const amount = amountFromMinutes(e.rounded_minutes, rateCents);
    return {
      matter_number: e.matter_number,
      matter_name: e.matter_name,
      timekeeper: e.timekeeper_name,
      service_date: e.service_date,
      description: e.description,
      hours: e.rounded_minutes / 60,
      minutes: e.rounded_minutes,
      rate_cents: rateCents,
      amount_cents: amount,
      category: e.category,
      subcategory: e.subcategory,
    };
  });
}

function lodestarSummary(db, { matterId = null } = {}) {
  const detail = lodestarDetail(db, { matterId });
  const map = new Map();
  for (const row of detail) {
    const key = `${row.matter_number}|${row.timekeeper}|${row.rate_cents}`;
    const cur = map.get(key) || {
      matter_number: row.matter_number,
      timekeeper: row.timekeeper,
      rate_cents: row.rate_cents,
      minutes: 0,
      amount_cents: 0,
    };
    cur.minutes += row.minutes;
    cur.amount_cents += row.amount_cents;
    map.set(key, cur);
  }
  return [...map.values()].map((r) => ({ ...r, hours: r.minutes / 60 }));
}

function wipReport(db) {
  const rows = db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.client_id, m.id AS mid
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE te.status = 'approved' AND te.invoice_id IS NULL AND te.billable = 1
    ORDER BY m.number, te.service_date
  `).all();
  return rows.map((e) => {
    const rate = resolveRate(db, {
      matterId: e.mid,
      clientId: e.client_id,
      timekeeperId: e.timekeeper_id,
      serviceDate: e.service_date,
    });
    const rateCents = rate?.amountCents ?? 0;
    return {
      matter_number: e.matter_number,
      timekeeper: e.timekeeper_name,
      service_date: e.service_date,
      minutes: e.rounded_minutes,
      hours: e.rounded_minutes / 60,
      rate_cents: rateCents,
      amount_cents: amountFromMinutes(e.rounded_minutes, rateCents),
      description: e.description,
    };
  });
}

function arAging(db, asOf = new Date().toISOString().slice(0, 10)) {
  const invoices = db.prepare(`
    SELECT i.*, c.name AS client_name, m.number AS matter_number
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    JOIN clients c ON c.id = m.client_id
    WHERE i.status = 'sent'
  `).all();
  const { invoiceBalance } = require('./payments');
  return invoices.map((inv) => {
    const balance = invoiceBalance(db, inv.id);
    if (balance <= 0) return null;
    const days = Math.max(0, Math.floor(
      (Date.parse(asOf) - Date.parse(inv.issue_date)) / 86400000
    ));
    let bucket = 'current';
    if (days > 90) bucket = '90+';
    else if (days > 60) bucket = '61-90';
    else if (days > 30) bucket = '31-60';
    else if (days > 0) bucket = '1-30';
    return {
      invoice_number: inv.number,
      client_name: inv.client_name,
      matter_number: inv.matter_number,
      issue_date: inv.issue_date,
      days,
      bucket,
      balance_cents: balance,
    };
  }).filter(Boolean);
}

function writeOffs(db) {
  return db.prepare(`
    SELECT w.*, i.number AS invoice_number, u.name AS created_by_name
    FROM write_downs w
    JOIN invoices i ON i.id = w.invoice_id
    JOIN users u ON u.id = w.created_by
    ORDER BY w.created_at DESC
  `).all();
}

function realization(db) {
  const matters = db.prepare('SELECT id, number, name, client_id FROM matters').all();
  return matters.map((m) => {
    const wip = wipReport(db).filter((r) => r.matter_number === m.number);
    const wipCents = wip.reduce((s, r) => s + r.amount_cents, 0);
    const inv = db.prepare(`
      SELECT COALESCE(SUM(subtotal_cents),0) AS billed,
             COALESCE(SUM(write_down_cents),0) AS wd,
             COALESCE(SUM(total_cents),0) AS net
      FROM invoices WHERE matter_id = ? AND status IN ('approved','sent')
    `).get(m.id);
    const collected = db.prepare(`
      SELECT COALESCE(SUM(pa.amount_cents),0) AS s
      FROM payment_applications pa
      JOIN invoices i ON i.id = pa.invoice_id
      WHERE i.matter_id = ?
    `).get(m.id).s;
    return {
      matter_number: m.number,
      matter_name: m.name,
      wip_cents: wipCents,
      billed_cents: inv.billed,
      write_down_cents: inv.wd,
      net_billed_cents: inv.net,
      collected_cents: collected,
      realization_pct: inv.billed ? Math.round((inv.net * 10000) / inv.billed) / 100 : null,
    };
  });
}

function toCsv(rows) {
  if (!rows.length) return '';
  const keys = Object.keys(rows[0]);
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [keys.join(','), ...rows.map((r) => keys.map((k) => esc(r[k])).join(','))].join('\n');
}

function toXlsx(rows, currencyKeys = []) {
  if (!rows.length) return buildXlsx([[]]);
  const keys = Object.keys(rows[0]);
  const header = keys.map((k) => ({ v: k, t: 's' }));
  const body = rows.map((r) => keys.map((k) => {
    if (currencyKeys.includes(k) && Number.isInteger(r[k])) {
      return { v: r[k] / 100, t: 'currency' };
    }
    if (typeof r[k] === 'number') return { v: r[k], t: 'n' };
    return { v: r[k] ?? '', t: 's' };
  }));
  return buildXlsx([header, ...body]);
}

module.exports = {
  lodestarDetail,
  lodestarSummary,
  wipReport,
  arAging,
  writeOffs,
  realization,
  toCsv,
  toXlsx,
  formatCents,
};
