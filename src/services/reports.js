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
  // Timezone / UI skew can invert From/To — swap so the full range is kept.
  if (dateFrom && dateTo && dateFrom > dateTo) {
    const tmp = dateFrom;
    dateFrom = dateTo;
    dateTo = tmp;
  }
  return { dateFrom, dateTo };
}

function periodLabel(dateFrom, dateTo) {
  if (dateFrom && dateTo) return `${dateFrom} → ${dateTo}`;
  if (dateFrom) return `From ${dateFrom}`;
  if (dateTo) return `Through ${dateTo}`;
  return 'All dates';
}

function pad(value, width, align = 'left') {
  const s = String(value ?? '');
  if (s.length >= width) return s.slice(0, width);
  return align === 'right' ? s.padStart(width) : s.padEnd(width);
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
  // Include billable and non-billable time so every saved entry appears.
  // Non-billable lines keep hours but charge $0. Rejected entries stay out.
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
    WHERE te.status IN ('draft','submitted','approved','invoiced')
      AND (? IS NULL OR te.matter_id = ?)
      AND (? IS NULL OR te.service_date >= ?)
      AND (? IS NULL OR te.service_date <= ?)
    ORDER BY m.number COLLATE NOCASE, u.name COLLATE NOCASE, te.service_date, te.id
  `).all(
    matterId, matterId,
    range.dateFrom, range.dateFrom,
    range.dateTo, range.dateTo
  );

  return entries.map((e) => {
    const isBillable = !!e.billable;
    let rateCents = 0;
    let amount = 0;
    if (isBillable) {
      const rate = resolveRate(db, {
        matterId: e.mid,
        clientId: e.client_id,
        timekeeperId: e.timekeeper_id,
        serviceDate: e.service_date,
      });
      rateCents = rate?.amountCents ?? 0;
      amount = amountFromMinutes(e.rounded_minutes, rateCents);
    }
    return {
      entry_id: e.id,
      matter_id: e.mid,
      matter_number: e.matter_number,
      matter_name: e.matter_name,
      matter_status: e.matter_status,
      client_name: e.client_name || '',
      attorney_name: e.attorney_name || '',
      timekeeper: e.timekeeper_name,
      timekeeper_id: e.timekeeper_id,
      role: roleLabel(e.timekeeper_role),
      service_date: e.service_date,
      description: e.description,
      status: e.status,
      hours: e.rounded_minutes / 60,
      minutes: e.rounded_minutes,
      rate_cents: rateCents,
      amount_cents: amount,
      billable: isBillable ? 1 : 0,
      category: e.category,
      subcategory: e.subcategory,
    };
  });
}

function summarizeLodestarRows(detail) {
  const map = new Map();
  for (const row of detail) {
    // Keep separate rows when the effective rate changes mid-period.
    const key = [
      row.matter_number,
      row.timekeeper_id || row.timekeeper,
      row.rate_cents,
      row.billable ? 1 : 0,
    ].join('|');
    const cur = map.get(key) || {
      matter_number: row.matter_number,
      matter_name: row.matter_name,
      client_name: row.client_name,
      attorney_name: row.attorney_name || '',
      timekeeper: row.timekeeper,
      role: row.role,
      rate_cents: row.rate_cents,
      billable: row.billable ? 1 : 0,
      entry_count: 0,
      minutes: 0,
      amount_cents: 0,
    };
    cur.entry_count += 1;
    cur.minutes += row.minutes;
    cur.amount_cents += row.amount_cents;
    map.set(key, cur);
  }
  return [...map.values()]
    .map((r) => ({ ...r, hours: r.minutes / 60 }))
    .sort((a, b) => {
      const m = String(a.matter_number || '').localeCompare(String(b.matter_number || ''));
      if (m) return m;
      const t = String(a.timekeeper || '').localeCompare(String(b.timekeeper || ''));
      if (t) return t;
      return (b.rate_cents || 0) - (a.rate_cents || 0);
    });
}

function lodestarTotals(detail) {
  return detail.reduce((acc, row) => {
    acc.entry_count += 1;
    acc.minutes += row.minutes || 0;
    acc.amount_cents += row.amount_cents || 0;
    if (row.billable) {
      acc.billable_minutes += row.minutes || 0;
      acc.billable_amount_cents += row.amount_cents || 0;
    } else {
      acc.nonbillable_minutes += row.minutes || 0;
    }
    return acc;
  }, {
    entry_count: 0,
    minutes: 0,
    hours: 0,
    amount_cents: 0,
    billable_minutes: 0,
    billable_hours: 0,
    billable_amount_cents: 0,
    nonbillable_minutes: 0,
    nonbillable_hours: 0,
  });
}

function finalizeTotals(totals) {
  return {
    ...totals,
    hours: (totals.minutes || 0) / 60,
    billable_hours: (totals.billable_minutes || 0) / 60,
    nonbillable_hours: (totals.nonbillable_minutes || 0) / 60,
  };
}

function lodestarSummary(db, { matterId = null, dateFrom = null, dateTo = null } = {}) {
  const range = normalizeReportDates({ dateFrom, dateTo });
  return summarizeLodestarRows(lodestarDetail(db, { matterId, ...range }));
}

/** Structured lodestar matter detail (grouped by timekeeper, rates kept distinct in summary). */
function lodestarMatterDetail(db, matterId, opts = {}) {
  if (!matterId) throw new Error('matterId required');
  const range = normalizeReportDates(opts);
  const header = {
    ...matterHeader(db, matterId),
    date_from: range.dateFrom,
    date_to: range.dateTo,
    period: periodLabel(range.dateFrom, range.dateTo),
  };
  const detail = lodestarDetail(db, { matterId, ...range });
  const groups = new Map();
  for (const row of detail) {
    const cur = groups.get(row.timekeeper) || {
      timekeeper: row.timekeeper,
      role: row.role,
      rate_cents: row.rate_cents,
      rates: new Set(),
      entries: [],
      minutes: 0,
      amount_cents: 0,
      billable_minutes: 0,
      nonbillable_minutes: 0,
    };
    cur.entries.push(row);
    cur.minutes += row.minutes;
    cur.amount_cents += row.amount_cents;
    if (row.billable) cur.billable_minutes += row.minutes;
    else cur.nonbillable_minutes += row.minutes;
    if (row.rate_cents) cur.rates.add(row.rate_cents);
    // Display rate: sole rate, else 0 to signal mixed rates (summary rows stay precise).
    cur.rate_cents = cur.rates.size === 1 ? [...cur.rates][0] : 0;
    groups.set(row.timekeeper, cur);
  }
  const timekeepers = [...groups.values()].map((g) => {
    const { rates, ...rest } = g;
    return {
      ...rest,
      mixed_rates: rates.size > 1,
      rate_count: rates.size,
    };
  });
  const totals = finalizeTotals(lodestarTotals(detail));
  const summary = summarizeLodestarRows(detail).map((r) => ({
    timekeeper: r.timekeeper,
    role: r.role,
    hours: r.hours,
    minutes: r.minutes,
    rate_cents: r.rate_cents,
    amount_cents: r.amount_cents,
    billable: r.billable,
    entry_count: r.entry_count,
  }));
  return {
    header,
    timekeepers,
    totals,
    summary,
    empty: detail.length === 0,
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
  const { header } = report;
  const lines = [
    `Matter: ${header.matter_number} — ${header.client_name} — ${header.matter_name}`,
    `Status: ${header.status}${header.attorney_name ? ` · Attorney: ${header.attorney_name}` : ''}`,
    `Period: ${header.period}`,
    '',
    `${pad('Date', 10)} ${pad('Timekeeper', 18)} ${pad('Hours', 7, 'right')} ${pad('Amount', 10, 'right')}  Description`,
    '-'.repeat(90),
  ];
  const entries = report.timekeepers.flatMap((g) => g.entries || []);
  if (!entries.length) {
    lines.push('No time entries in this period.');
  } else {
    for (const e of entries) {
      const nb = e.billable ? '' : ' [NB]';
      const desc = String(`${e.description || ''}${nb}`);
      lines.push(
        `${pad(e.service_date, 10)} ${pad(e.timekeeper, 18)} ${pad(hoursLabel(e.minutes), 7, 'right')} ${pad(formatCents(e.amount_cents), 10, 'right')}  ${desc}`
      );
    }
    lines.push('-'.repeat(90));
    lines.push(
      `${pad('Total', 29)} ${pad(hoursLabel(report.totals.minutes), 7, 'right')} ${pad(formatCents(report.totals.amount_cents), 10, 'right')}`
    );
    if (report.totals.nonbillable_minutes) {
      lines.push(
        `Billable ${hoursLabel(report.totals.billable_minutes)} · Non-billable ${hoursLabel(report.totals.nonbillable_minutes)} (at $0)`
      );
    }
  }
  return buildTextPdf({
    title: 'Lodestar Detail',
    lines,
    wrapWidth: 100,
  });
}

function lodestarMatterSummaryPdf(db, matterId, opts = {}) {
  const report = lodestarMatterSummary(db, matterId, opts);
  const { header } = report;
  const lines = [
    `Matter: ${header.matter_number} — ${header.client_name} — ${header.matter_name} — ${header.status}`,
    header.attorney_name ? `Responsible Attorney: ${header.attorney_name}` : null,
    `Period: ${header.period}`,
    '',
    'Timekeeper Summary (one row per rate)',
    `${pad('Name', 22)} ${pad('Role', 14)} ${pad('Billable', 8)} ${pad('Rate', 10, 'right')} ${pad('Hours', 8, 'right')} ${pad('Lodestar', 12, 'right')}`,
    '-'.repeat(90),
  ];
  if (!report.summary.length) {
    lines.push('No time entries in this period.');
  } else {
    for (const s of report.summary) {
      lines.push(
        `${pad(s.timekeeper, 22)} ${pad(s.role, 14)} ${pad(s.billable ? 'Yes' : 'No', 8)} ${pad(formatCents(s.rate_cents), 10, 'right')} ${pad(hoursLabel(s.minutes), 8, 'right')} ${pad(formatCents(s.amount_cents), 12, 'right')}`
      );
    }
    lines.push('-'.repeat(90));
    lines.push(
      `${pad('Total', 56)} ${pad(hoursLabel(report.totals.minutes), 8, 'right')} ${pad(formatCents(report.totals.amount_cents), 12, 'right')}`
    );
    lines.push(
      `Entries: ${report.totals.entry_count} · Billable hours: ${hoursLabel(report.totals.billable_minutes)} · Non-billable: ${hoursLabel(report.totals.nonbillable_minutes)}`
    );
  }
  return buildTextPdf({
    title: `Lodestar Matter Summary — ${header.matter_name}`,
    lines: lines.filter((l) => l != null),
    wrapWidth: 100,
  });
}

function lodestarMatterDetailXlsx(db, matterId, opts = {}) {
  const report = lodestarMatterDetail(db, matterId, opts);
  const { header } = report;
  const rows = [
    [{ v: 'Lodestar Detail', t: 's' }],
    [{ v: 'Matter', t: 's' }, { v: `${header.matter_number} — ${header.matter_name}`, t: 's' }],
    [{ v: 'Client', t: 's' }, { v: header.client_name, t: 's' }],
    [{ v: 'Period', t: 's' }, { v: header.period, t: 's' }],
    [],
    [
      { v: 'Date', t: 's' },
      { v: 'Timekeeper', t: 's' },
      { v: 'Role', t: 's' },
      { v: 'Hours', t: 's' },
      { v: 'Rate', t: 's' },
      { v: 'Amount', t: 's' },
      { v: 'Billable', t: 's' },
      { v: 'Status', t: 's' },
      { v: 'Description', t: 's' },
    ],
  ];
  const entries = report.timekeepers.flatMap((g) => g.entries || []);
  for (const e of entries) {
    rows.push([
      { v: e.service_date || '', t: 's' },
      { v: e.timekeeper || '', t: 's' },
      { v: e.role || '', t: 's' },
      { v: e.hours, t: 'n' },
      { v: e.rate_cents / 100, t: 'currency' },
      { v: e.amount_cents / 100, t: 'currency' },
      { v: e.billable ? 'Yes' : 'No', t: 's' },
      { v: e.status || '', t: 's' },
      { v: e.description || '', t: 's' },
    ]);
  }
  rows.push([]);
  rows.push([
    { v: 'Total', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: report.totals.hours, t: 'n' },
    { v: '', t: 's' },
    { v: report.totals.amount_cents / 100, t: 'currency' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: `${report.totals.entry_count} entries`, t: 's' },
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
    [{ v: 'Period', t: 's' }, { v: header.period, t: 's' }],
    [],
    [
      { v: 'Name', t: 's' },
      { v: 'Role', t: 's' },
      { v: 'Billable', t: 's' },
      { v: 'Rate', t: 's' },
      { v: 'Hours', t: 's' },
      { v: 'Lodestar', t: 's' },
      { v: 'Entries', t: 's' },
    ],
  ];
  for (const s of report.summary) {
    rows.push([
      { v: s.timekeeper, t: 's' },
      { v: s.role, t: 's' },
      { v: s.billable ? 'Yes' : 'No', t: 's' },
      { v: s.rate_cents / 100, t: 'currency' },
      { v: s.hours, t: 'n' },
      { v: s.amount_cents / 100, t: 'currency' },
      { v: s.entry_count || 0, t: 'n' },
    ]);
  }
  rows.push([
    { v: 'Total', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: '', t: 's' },
    { v: report.totals.hours, t: 'n' },
    { v: report.totals.amount_cents / 100, t: 'currency' },
    { v: report.totals.entry_count, t: 'n' },
  ]);
  return buildXlsx(rows);
}

/** Columnar firm Lodestar PDFs (stronger than key/value dumps). */
function lodestarFirmSummaryPdf(db, opts = {}) {
  const rows = lodestarSummary(db, opts);
  const range = normalizeReportDates(opts);
  const lines = [
    `Period: ${periodLabel(range.dateFrom, range.dateTo)}`,
    '',
    `${pad('Matter', 12)} ${pad('Timekeeper', 18)} ${pad('Rate', 10, 'right')} ${pad('Hours', 8, 'right')} ${pad('Amount', 12, 'right')} ${pad('NB', 3)}`,
    '-'.repeat(90),
  ];
  if (!rows.length) {
    lines.push('No time entries in this period.');
  } else {
    let minutes = 0;
    let amount = 0;
    for (const r of rows) {
      minutes += r.minutes || 0;
      amount += r.amount_cents || 0;
      lines.push(
        `${pad(r.matter_number, 12)} ${pad(r.timekeeper, 18)} ${pad(formatCents(r.rate_cents), 10, 'right')} ${pad(hoursLabel(r.minutes), 8, 'right')} ${pad(formatCents(r.amount_cents), 12, 'right')} ${r.billable ? '  ' : 'NB'}`
      );
    }
    lines.push('-'.repeat(90));
    lines.push(
      `${pad('Total', 42)} ${pad(hoursLabel(minutes), 8, 'right')} ${pad(formatCents(amount), 12, 'right')}`
    );
  }
  return buildTextPdf({ title: 'Lodestar Summary (all matters)', lines, wrapWidth: 100 });
}

function lodestarFirmDetailPdf(db, opts = {}) {
  const rows = lodestarDetail(db, { ...normalizeReportDates(opts), matterId: opts.matterId || null });
  const range = normalizeReportDates(opts);
  const lines = [
    `Period: ${periodLabel(range.dateFrom, range.dateTo)}`,
    '',
    `${pad('Date', 10)} ${pad('Matter', 12)} ${pad('Timekeeper', 16)} ${pad('Hours', 7, 'right')} ${pad('Amount', 10, 'right')} Description`,
    '-'.repeat(95),
  ];
  if (!rows.length) {
    lines.push('No time entries in this period.');
  } else {
    let minutes = 0;
    let amount = 0;
    for (const r of rows) {
      minutes += r.minutes || 0;
      amount += r.amount_cents || 0;
      const nb = r.billable ? '' : ' [NB]';
      lines.push(
        `${pad(r.service_date, 10)} ${pad(r.matter_number, 12)} ${pad(r.timekeeper, 16)} ${pad(hoursLabel(r.minutes), 7, 'right')} ${pad(formatCents(r.amount_cents), 10, 'right')} ${r.description || ''}${nb}`
      );
    }
    lines.push('-'.repeat(95));
    lines.push(
      `${pad('Total', 40)} ${pad(hoursLabel(minutes), 7, 'right')} ${pad(formatCents(amount), 10, 'right')}`
    );
  }
  return buildTextPdf({ title: 'Lodestar Detail (all matters)', lines, wrapWidth: 100 });
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
  normalizeReportDates,
  lodestarDetail,
  lodestarSummary,
  lodestarMatterDetail,
  lodestarMatterSummary,
  lodestarMatterDetailPdf,
  lodestarMatterSummaryPdf,
  lodestarMatterDetailXlsx,
  lodestarMatterSummaryXlsx,
  lodestarFirmSummaryPdf,
  lodestarFirmDetailPdf,
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
