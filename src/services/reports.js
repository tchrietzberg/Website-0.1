const { amountFromMinutes, formatCents, formatDuration } = require('../money');
const { resolveRate } = require('../rates');
const { buildXlsx } = require('../xlsx');
const { buildTextPdf } = require('../pdf');

function roleLabel(role) {
  const map = {
    admin: 'Admin',
    attorney: 'Attorney',
    paralegal: 'Paralegal',
    billing_clerk: 'Billing Clerk',
  };
  return map[role] || role || '';
}

function normalizeReportDates(opts = {}) {
  let dateFrom = opts.dateFrom ? String(opts.dateFrom).slice(0, 10) : null;
  let dateTo = opts.dateTo ? String(opts.dateTo).slice(0, 10) : null;
  if (dateFrom && !/^\d{4}-\d{2}-\d{2}$/.test(dateFrom)) dateFrom = null;
  if (dateTo && !/^\d{4}-\d{2}-\d{2}$/.test(dateTo)) dateTo = null;
  // Timezone skew can briefly invert defaults; widen instead of failing empty.
  if (dateFrom && dateTo && dateFrom > dateTo) {
    dateTo = dateFrom;
  }
  return { dateFrom, dateTo };
}

function matterHeader(db, matterId) {
  const m = db.prepare(`
    SELECT m.*, c.name AS client_name, u.name AS attorney_name
    FROM matters m
    LEFT JOIN clients c ON c.id = m.client_id
    LEFT JOIN users u ON u.id = m.responsible_attorney_id
    WHERE m.id = ?
  `).get(matterId);
  if (!m) throw new Error('matter not found');
  return {
    matter_id: m.id,
    matter_number: m.number,
    matter_name: m.name,
    client_name: m.client_name || '',
    status: m.status,
    attorney_name: m.attorney_name || '',
    opened_on: m.opened_on,
    title_line: [m.client_name, m.name, m.status].filter(Boolean).join(' — '),
  };
}

function lodestarDetail(db, { matterId = null, dateFrom = null, dateTo = null } = {}) {
  const range = normalizeReportDates({ dateFrom, dateTo });
  const entries = db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, u.role AS timekeeper_role,
           m.number AS matter_number, m.name AS matter_name, m.status AS matter_status,
           c.name AS client_name, atty.name AS attorney_name,
           m.client_id, m.id AS mid
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    LEFT JOIN clients c ON c.id = m.client_id
    LEFT JOIN users atty ON atty.id = m.responsible_attorney_id
    WHERE te.billable = 1 AND te.status IN ('draft','submitted','approved','invoiced')
      AND (? IS NULL OR te.matter_id = ?)
      AND (? IS NULL OR te.service_date >= ?)
      AND (? IS NULL OR te.service_date <= ?)
    ORDER BY m.number, u.name, te.service_date, te.id
  `).all(
    matterId, matterId,
    range.dateFrom, range.dateFrom,
    range.dateTo, range.dateTo
  );

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
      matter_status: e.matter_status,
      client_name: e.client_name || '',
      attorney_name: e.attorney_name || '',
      timekeeper: e.timekeeper_name,
      role: roleLabel(e.timekeeper_role),
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

function lodestarSummary(db, { matterId = null, dateFrom = null, dateTo = null } = {}) {
  const detail = lodestarDetail(db, { matterId, dateFrom, dateTo });
  const map = new Map();
  for (const row of detail) {
    const key = `${row.matter_number}|${row.timekeeper}|${row.rate_cents}`;
    const cur = map.get(key) || {
      matter_number: row.matter_number,
      matter_name: row.matter_name,
      client_name: row.client_name,
      timekeeper: row.timekeeper,
      role: row.role,
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

/** Structured lodestar matter detail (demo-style grouping by timekeeper). */
function lodestarMatterDetail(db, matterId, opts = {}) {
  if (!matterId) throw new Error('matterId required');
  const header = matterHeader(db, matterId);
  const detail = lodestarDetail(db, { matterId, ...normalizeReportDates(opts) });
  const groups = new Map();
  for (const row of detail) {
    const cur = groups.get(row.timekeeper) || {
      timekeeper: row.timekeeper,
      role: row.role,
      rate_cents: row.rate_cents,
      entries: [],
      minutes: 0,
      amount_cents: 0,
    };
    cur.entries.push(row);
    cur.minutes += row.minutes;
    cur.amount_cents += row.amount_cents;
    // Prefer latest non-zero rate seen
    if (row.rate_cents) cur.rate_cents = row.rate_cents;
    groups.set(row.timekeeper, cur);
  }
  const timekeepers = [...groups.values()];
  const totals = timekeepers.reduce(
    (acc, g) => ({
      minutes: acc.minutes + g.minutes,
      amount_cents: acc.amount_cents + g.amount_cents,
    }),
    { minutes: 0, amount_cents: 0 }
  );
  return {
    header,
    timekeepers,
    totals: {
      ...totals,
      hours: totals.minutes / 60,
    },
    summary: timekeepers.map((g) => ({
      timekeeper: g.timekeeper,
      role: g.role,
      hours: g.minutes / 60,
      minutes: g.minutes,
      rate_cents: g.rate_cents,
      amount_cents: g.amount_cents,
    })),
  };
}

/** Lodestar matter export — timekeeper summary only (demo-style). */
function lodestarMatterSummary(db, matterId, opts = {}) {
  const report = lodestarMatterDetail(db, matterId, opts);
  return {
    header: report.header,
    summary: report.summary,
    totals: report.totals,
  };
}

function hoursLabel(minutes) {
  return formatDuration(minutes || 0, 'decimal');
}

function lodestarMatterDetailPdf(db, matterId, opts = {}) {
  const report = lodestarMatterDetail(db, matterId, opts);
  const lines = [
    'Date       Timekeeper                 Hours     Amount  Description',
    '--------------------------------------------------------------------------',
  ];
  const entries = report.timekeepers.flatMap((g) => g.entries || []);
  if (!entries.length) {
    lines.push('No billable time yet.');
  } else {
    for (const e of entries) {
      const date = String(e.service_date || '').padEnd(10);
      const who = String(e.timekeeper || '').slice(0, 24).padEnd(24);
      const hours = hoursLabel(e.minutes).padStart(7);
      const amount = formatCents(e.amount_cents).padStart(10);
      const desc = String(e.description || '').slice(0, 40);
      lines.push(`${date} ${who} ${hours} ${amount}  ${desc}`);
    }
    lines.push('--------------------------------------------------------------------------');
    lines.push(
      `Total${''.padEnd(35)}${hoursLabel(report.totals.minutes).padStart(7)} ${formatCents(report.totals.amount_cents).padStart(10)}`
    );
  }
  return buildTextPdf({
    title: 'Lodestar Detail',
    lines,
  });
}

function lodestarMatterSummaryPdf(db, matterId, opts = {}) {
  const report = lodestarMatterSummary(db, matterId, opts);
  const { header } = report;
  const lines = [
    `Matter: ${header.matter_number} — ${header.client_name} — ${header.matter_name} — ${header.status}`,
    header.attorney_name ? `Responsible Attorney: ${header.attorney_name}` : null,
    '',
    'Timekeeper Summary',
    'Name                      Role               Rate       Hours     Lodestar',
    '--------------------------------------------------------------------------',
  ];
  for (const s of report.summary) {
    const name = String(s.timekeeper || '').slice(0, 24).padEnd(24);
    const role = String(s.role || '').slice(0, 16).padEnd(16);
    const rate = formatCents(s.rate_cents).padStart(10);
    const hours = hoursLabel(s.minutes).padStart(8);
    const lodestar = formatCents(s.amount_cents).padStart(12);
    lines.push(`${name} ${role} ${rate} ${hours} ${lodestar}`);
  }
  lines.push('--------------------------------------------------------------------------');
  lines.push(
    `Total${''.padEnd(52)}${hoursLabel(report.totals.minutes).padStart(8)} ${formatCents(report.totals.amount_cents).padStart(12)}`
  );
  return buildTextPdf({
    title: `Lodestar Matter Summary — ${header.matter_name}`,
    lines: lines.filter((l) => l != null),
  });
}

function lodestarMatterDetailXlsx(db, matterId, opts = {}) {
  const report = lodestarMatterDetail(db, matterId, opts);
  const rows = [
    [{ v: 'Lodestar Detail', t: 's' }],
    [],
    [
      { v: 'Date', t: 's' },
      { v: 'Timekeeper', t: 's' },
      { v: 'Hours', t: 's' },
      { v: 'Amount', t: 's' },
      { v: 'Description', t: 's' },
    ],
  ];
  const entries = report.timekeepers.flatMap((g) => g.entries || []);
  for (const e of entries) {
    rows.push([
      { v: e.service_date || '', t: 's' },
      { v: e.timekeeper || '', t: 's' },
      { v: e.hours, t: 'n' },
      { v: e.amount_cents / 100, t: 'currency' },
      { v: e.description || '', t: 's' },
    ]);
  }
  rows.push([]);
  rows.push([
    { v: 'Total', t: 's' },
    { v: '', t: 's' },
    { v: report.totals.hours, t: 'n' },
    { v: report.totals.amount_cents / 100, t: 'currency' },
    { v: '', t: 's' },
  ]);
  return buildXlsx(rows);
}

function lodestarMatterSummaryXlsx(db, matterId, opts = {}) {
  const report = lodestarMatterSummary(db, matterId, opts);
  const { header } = report;
  const rows = [
    [{ v: 'Lodestar Matter Summary', t: 's' }],
    [{ v: 'Matter name', t: 's' }, { v: header.matter_name, t: 's' }],
    [{ v: 'Matter number', t: 's' }, { v: header.matter_number, t: 's' }],
    [{ v: 'Client', t: 's' }, { v: header.client_name, t: 's' }],
    [{ v: 'Status', t: 's' }, { v: header.status, t: 's' }],
    [{ v: 'Responsible attorney', t: 's' }, { v: header.attorney_name, t: 's' }],
    [],
    [
      { v: 'Name', t: 's' },
      { v: 'Role', t: 's' },
      { v: 'Rate', t: 's' },
      { v: 'Hours', t: 's' },
      { v: 'Lodestar', t: 's' },
    ],
  ];
  for (const s of report.summary) {
    rows.push([
      { v: s.timekeeper, t: 's' },
      { v: s.role, t: 's' },
      { v: s.rate_cents / 100, t: 'currency' },
      { v: s.hours, t: 'n' },
      { v: s.amount_cents / 100, t: 'currency' },
    ]);
  }
  rows.push([
    { v: 'Total', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: report.totals.hours, t: 'n' },
    { v: report.totals.amount_cents / 100, t: 'currency' },
  ]);
  return buildXlsx(rows);
}

function wipReport(db) {
  // Kept for backend/tests; WIP / pre-bill UI is paused.
  const rows = db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.client_id, m.id AS mid
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE te.status IN ('draft','submitted','approved') AND te.invoice_id IS NULL AND te.billable = 1
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

/** Firm matters listing — matter names only for now. */
function mattersReport(db) {
  return db.prepare(`
    SELECT m.name AS "Matter"
    FROM matters m
    ORDER BY m.name COLLATE NOCASE, m.id
  `).all();
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

function humanizeKey(key) {
  return String(key || '')
    .replace(/_cents$/i, '')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatReportCell(key, value, currencyKeys = []) {
  if (value == null || value === '') return '';
  if (currencyKeys.includes(key) && Number.isInteger(value)) return formatCents(value);
  if (typeof value === 'number' && !Number.isInteger(value)) {
    return String(Math.round(value * 100) / 100);
  }
  return String(value);
}

/** Tabular firm-report PDF (matters, lodestar firm listings, etc.). */
function toPdf(rows, { title = 'Report', currencyKeys = [] } = {}) {
  if (!rows.length) {
    return buildTextPdf({ title, lines: ['No rows'] });
  }
  const keys = Object.keys(rows[0]);
  const lines = [];
  for (const row of rows) {
    lines.push('--------------------------------------------------------------------------');
    for (const key of keys) {
      const label = humanizeKey(key).padEnd(22);
      lines.push(`${label} ${formatReportCell(key, row[key], currencyKeys)}`);
    }
  }
  lines.push('--------------------------------------------------------------------------');
  lines.push(`Rows: ${rows.length}`);
  return buildTextPdf({ title, lines });
}

module.exports = {
  lodestarDetail,
  lodestarSummary,
  lodestarMatterDetail,
  lodestarMatterSummary,
  lodestarMatterDetailPdf,
  lodestarMatterSummaryPdf,
  lodestarMatterDetailXlsx,
  lodestarMatterSummaryXlsx,
  mattersReport,
  wipReport,
  arAging,
  writeOffs,
  realization,
  toCsv,
  toXlsx,
  toPdf,
  formatCents,
};
