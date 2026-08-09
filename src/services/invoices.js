const { amountFromMinutes, formatCents, formatDuration } = require('../money');
const { resolveRate } = require('../rates');
const { allocateNumber, audit, getSetting, setSetting } = require('../db');
const { buildXlsx } = require('../xlsx');
const { buildTextPdf } = require('../pdf');

const BILL_FIELDS_SETTING = 'bill_fields';

/** Always shown on bills (cannot be removed). */
const BILL_CORE_HEADER_FIELDS = [
  { key: 'number', label: 'Bill number', group: 'header' },
];

/** Optional header fields firms can include on bills. */
const BILL_HEADER_FIELDS = [
  { key: 'matter_name', label: 'Matter name', group: 'header' },
  { key: 'matter_number', label: 'Matter number', group: 'header' },
  { key: 'client', label: 'Client', group: 'header' },
  { key: 'status', label: 'Status', group: 'header' },
  { key: 'issue_date', label: 'Issue date', group: 'header' },
  { key: 'due_date', label: 'Due date', group: 'header' },
  { key: 'subtotal', label: 'Subtotal', group: 'header' },
  { key: 'total', label: 'Total', group: 'header' },
];

/** Line columns firms can include on bills. */
const BILL_LINE_FIELDS = [
  { key: 'service_date', label: 'Date', group: 'lines' },
  { key: 'timekeeper', label: 'Timekeeper', group: 'lines' },
  { key: 'description', label: 'Description', group: 'lines' },
  { key: 'hours', label: 'Hours', group: 'lines' },
  { key: 'minutes', label: 'Minutes', group: 'lines' },
  { key: 'rate', label: 'Rate', group: 'lines' },
  { key: 'amount', label: 'Amount', group: 'lines' },
];

const BILL_HEADER_KEYS = BILL_HEADER_FIELDS.map((f) => f.key);
const BILL_LINE_KEYS = BILL_LINE_FIELDS.map((f) => f.key);

const DEFAULT_BILL_FIELDS = {
  header: ['matter_name', 'client', 'status', 'issue_date', 'subtotal', 'total'],
  lines: ['service_date', 'timekeeper', 'description', 'hours', 'rate', 'amount'],
};

function normalizeBillFieldKeys(keys, allowed) {
  const wanted = new Set(
    (Array.isArray(keys) ? keys : [])
      .map((k) => String(k || '').trim())
      .filter((k) => allowed.includes(k))
  );
  return allowed.filter((k) => wanted.has(k));
}

function getBillFields(db) {
  const raw = getSetting(db, BILL_FIELDS_SETTING, null);
  if (raw == null || raw === '') {
    return {
      header: [...DEFAULT_BILL_FIELDS.header],
      lines: [...DEFAULT_BILL_FIELDS.lines],
    };
  }
  try {
    const parsed = JSON.parse(raw) || {};
    return {
      header: normalizeBillFieldKeys(parsed.header, BILL_HEADER_KEYS),
      lines: normalizeBillFieldKeys(parsed.lines, BILL_LINE_KEYS),
    };
  } catch {
    return {
      header: [...DEFAULT_BILL_FIELDS.header],
      lines: [...DEFAULT_BILL_FIELDS.lines],
    };
  }
}

function setBillFields(db, actor, input = {}) {
  const current = getBillFields(db);
  const next = {
    header: input.header !== undefined
      ? normalizeBillFieldKeys(input.header, BILL_HEADER_KEYS)
      : current.header,
    lines: input.lines !== undefined
      ? normalizeBillFieldKeys(input.lines, BILL_LINE_KEYS)
      : current.lines,
  };
  setSetting(db, BILL_FIELDS_SETTING, JSON.stringify(next));
  audit(db, {
    actorId: actor?.id || null,
    action: 'bill_fields.update',
    entityType: 'firm_settings',
    entityId: null,
    detail: next,
  });
  return getBillFieldConfig(db);
}

function getBillFieldConfig(db) {
  const enabled = getBillFields(db);
  const headerSet = new Set(enabled.header);
  const lineSet = new Set(enabled.lines);
  return {
    coreHeader: BILL_CORE_HEADER_FIELDS.map((f) => ({ ...f, removable: false })),
    enabledHeader: BILL_HEADER_FIELDS
      .filter((f) => headerSet.has(f.key))
      .map((f) => ({ ...f, removable: true })),
    availableHeader: BILL_HEADER_FIELDS
      .filter((f) => !headerSet.has(f.key))
      .map((f) => ({ ...f, removable: true })),
    enabledLines: BILL_LINE_FIELDS
      .filter((f) => lineSet.has(f.key))
      .map((f) => ({ ...f, removable: true })),
    availableLines: BILL_LINE_FIELDS
      .filter((f) => !lineSet.has(f.key))
      .map((f) => ({ ...f, removable: true })),
    headerKeys: enabled.header,
    lineKeys: enabled.lines,
  };
}

function addBillField(db, actor, { group, key } = {}) {
  const g = String(group || '').trim();
  const k = String(key || '').trim();
  const current = getBillFields(db);
  if (g === 'header') {
    if (!BILL_HEADER_KEYS.includes(k)) throw new Error('unknown bill header field');
    if (!current.header.includes(k)) current.header.push(k);
  } else if (g === 'lines') {
    if (!BILL_LINE_KEYS.includes(k)) throw new Error('unknown bill line field');
    if (!current.lines.includes(k)) current.lines.push(k);
  } else {
    throw new Error('group must be header or lines');
  }
  return setBillFields(db, actor, current);
}

function removeBillField(db, actor, { group, key } = {}) {
  const g = String(group || '').trim();
  const k = String(key || '').trim();
  if (g === 'header' && k === 'number') {
    throw new Error('Bill number cannot be removed');
  }
  const current = getBillFields(db);
  if (g === 'header') {
    current.header = current.header.filter((x) => x !== k);
  } else if (g === 'lines') {
    current.lines = current.lines.filter((x) => x !== k);
  } else {
    throw new Error('group must be header or lines');
  }
  return setBillFields(db, actor, current);
}

/**
 * Create and issue a bill in one step from unbilled time (no approval step).
 * Fourth arg may be an entry-id array (legacy) or
 * `{ entryIds, dateFrom, dateTo }` to limit by service date.
 */
function createBill(db, actor, matterId, opts = null) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  let entryIds = null;
  let dateFrom = null;
  let dateTo = null;
  if (Array.isArray(opts)) {
    entryIds = opts;
  } else if (opts && typeof opts === 'object') {
    entryIds = Array.isArray(opts.entryIds) ? opts.entryIds : null;
    dateFrom = opts.dateFrom ? String(opts.dateFrom).slice(0, 10) : null;
    dateTo = opts.dateTo ? String(opts.dateTo).slice(0, 10) : null;
  }
  if (dateFrom && dateTo && dateFrom > dateTo) {
    throw new Error('From date must be on or before To date');
  }

  let entries;
  if (entryIds && entryIds.length) {
    const placeholders = entryIds.map(() => '?').join(',');
    entries = db.prepare(`
      SELECT * FROM time_entries
      WHERE matter_id = ? AND status IN ('draft','submitted','approved') AND id IN (${placeholders})
        AND (? IS NULL OR service_date >= ?)
        AND (? IS NULL OR service_date <= ?)
      ORDER BY service_date, id
    `).all(matterId, ...entryIds, dateFrom, dateFrom, dateTo, dateTo);
  } else {
    entries = db.prepare(`
      SELECT * FROM time_entries
      WHERE matter_id = ? AND status IN ('draft','submitted','approved') AND invoice_id IS NULL
        AND rounded_minutes > 0
        AND (? IS NULL OR service_date >= ?)
        AND (? IS NULL OR service_date <= ?)
      ORDER BY service_date, id
    `).all(matterId, dateFrom, dateFrom, dateTo, dateTo);
  }
  if (!entries.length) {
    throw new Error(dateFrom || dateTo
      ? 'No unbilled time on this matter in the selected date range'
      : 'No unbilled time on this matter');
  }

  const year = new Date().getUTCFullYear();
  const number = allocateNumber(db, 'invoice', year, 'INV-');
  const today = new Date().toISOString().slice(0, 10);

  const lineRows = [];
  let subtotal = 0;
  let order = 0;
  const missingRates = [];
  for (const e of entries) {
    const rate = resolveRate(db, {
      matterId: matter.id,
      clientId: matter.client_id,
      timekeeperId: e.timekeeper_id,
      serviceDate: e.service_date,
    });
    if (!rate) {
      const tk = db.prepare('SELECT name FROM users WHERE id = ?').get(e.timekeeper_id);
      missingRates.push({
        entryId: e.id,
        serviceDate: e.service_date,
        timekeeper: tk?.name || `timekeeper #${e.timekeeper_id}`,
      });
      continue;
    }
    const amount = amountFromMinutes(e.rounded_minutes, rate.amountCents);
    subtotal += amount;
    lineRows.push({
      entry: e,
      rateCents: rate.amountCents,
      amount,
      sortOrder: order++,
    });
  }
  if (missingRates.length) {
    const sample = missingRates.slice(0, 3).map((m) =>
      `${m.timekeeper} on ${m.serviceDate}`).join('; ');
    const more = missingRates.length > 3 ? ` (+${missingRates.length - 3} more)` : '';
    throw new Error(
      `No rate for ${sample}${more}. Add a timekeeper, client, or matter rate effective on or before those dates (Navigate → Add a user, or a matter/client rate).`
    );
  }

  const inv = db.prepare(`
    INSERT INTO invoices(
      matter_id, number, status, created_by,
      issue_date, due_date, sent_at,
      subtotal_cents, write_down_cents, total_cents,
      approved_by, approved_at
    )
    VALUES (
      ?, ?, 'sent', ?,
      ?, date(?, '+30 days'), strftime('%Y-%m-%dT%H:%M:%fZ','now'),
      ?, 0, ?,
      ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
  `).run(matterId, number, actor.id, today, today, subtotal, subtotal, actor.id);
  const invoiceId = Number(inv.lastInsertRowid);

  const markEntry = db.prepare(`
    UPDATE time_entries SET status = 'invoiced', invoice_id = ? WHERE id = ?
  `);
  for (const row of lineRows) {
    const e = row.entry;
    db.prepare(`
      INSERT INTO invoice_lines(
        invoice_id, time_entry_id, service_date, description, timekeeper_id,
        minutes, rate_cents, amount_cents, write_down_cents, sort_order
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      invoiceId, e.id, e.service_date, e.description, e.timekeeper_id,
      e.rounded_minutes, row.rateCents, row.amount, row.sortOrder
    );
    markEntry.run(invoiceId, e.id);
  }

  audit(db, {
    actorId: actor.id,
    action: 'invoice.bill',
    entityType: 'invoice',
    entityId: invoiceId,
    detail: { number, entryCount: entries.length, subtotal },
  });
  return getInvoice(db, invoiceId);
}

/** @deprecated Use createBill — kept for callers that still name it pre-bill. */
function generatePrebill(db, actor, matterId, entryIds = null) {
  return createBill(db, actor, matterId, entryIds);
}

/** Matters with unbilled time ready to bill (saved time; no approval step). */
function listMattersReadyForBilling(db) {
  return db.prepare(`
    SELECT m.id, m.number, m.name, c.name AS client_name,
      COUNT(te.id) AS entry_count,
      COALESCE(SUM(te.rounded_minutes), 0) AS minutes
    FROM matters m
    JOIN clients c ON c.id = m.client_id
    JOIN time_entries te ON te.matter_id = m.id
    WHERE te.status IN ('draft','submitted','approved')
      AND te.invoice_id IS NULL AND te.rounded_minutes > 0
    GROUP BY m.id
    ORDER BY m.name
  `).all();
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
  throw new Error(`invoice in status ${inv.status} cannot be edited`);
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
  // Simple billing: new bills are created already sent. Legacy drafts may still be voided or issued.
  const transitions = {
    prebill: ['sent', 'void'],
    in_review: ['sent', 'void'],
    approved: ['sent', 'void'],
    sent: [],
    void: [],
  };
  if (!(transitions[inv.status] || []).includes(status)) {
    throw new Error(`cannot transition ${inv.status} → ${status}`);
  }

  if (status === 'void') {
    if (inv.status === 'sent') throw new Error('cannot void a sent invoice');
    db.prepare(`
      UPDATE time_entries SET status = 'approved', invoice_id = NULL
      WHERE invoice_id = ?
    `).run(invoiceId);
    db.prepare(`
      UPDATE invoices SET status = 'void', voided_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?
    `).run(invoiceId);
  } else if (status === 'sent') {
    const today = new Date().toISOString().slice(0, 10);
    db.prepare(`
      UPDATE invoices SET status = 'sent', issue_date = ?, due_date = date(?, '+30 days'),
        sent_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        approved_by = COALESCE(approved_by, ?),
        approved_at = COALESCE(approved_at, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      WHERE id = ?
    `).run(today, today, actor.id, invoiceId);
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

/**
 * Permanently remove a bill from the ledger.
 * Unlinks time entries (back to approved), removes payment applications /
 * write-downs / credit notes / lines, then deletes the invoice.
 */
function deleteInvoice(db, actor, invoiceId) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(invoiceId);
  if (!inv) throw new Error('invoice not found');

  const detail = {
    number: inv.number,
    status: inv.status,
    matterId: inv.matter_id,
    totalCents: inv.total_cents,
  };

  db.exec('BEGIN');
  try {
    db.prepare(`
      UPDATE time_entries SET status = 'approved', invoice_id = NULL
      WHERE invoice_id = ?
    `).run(invoiceId);
    db.prepare('DELETE FROM payment_applications WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM write_downs WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM credit_notes WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }

  audit(db, {
    actorId: actor.id,
    action: 'invoice.delete',
    entityType: 'invoice',
    entityId: invoiceId,
    detail,
  });
  return { ok: true, id: invoiceId, number: inv.number };
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
  return {
    ...invoice,
    lines,
    writeDowns,
    credits,
    fieldConfig: getBillFieldConfig(db),
  };
}

function listInvoices(db) {
  return db.prepare(`
    SELECT i.*, m.number AS matter_number, m.name AS matter_name, c.name AS client_name
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    JOIN clients c ON c.id = m.client_id
    ORDER BY i.created_at DESC
  `).all();
}

function invoiceStageLabel(status) {
  const map = {
    prebill: 'Draft',
    in_review: 'Draft',
    approved: 'Draft',
    sent: 'Billed',
    void: 'Void',
  };
  return map[status] || status;
}

function invoiceMatterLabel(inv) {
  return inv.matter_name || inv.matter_number || 'Matter';
}

function resolveBillFields(fields) {
  if (fields && typeof fields === 'object' && (fields.header || fields.lines || fields.headerKeys)) {
    return {
      header: normalizeBillFieldKeys(fields.header || fields.headerKeys, BILL_HEADER_KEYS),
      lines: normalizeBillFieldKeys(fields.lines || fields.lineKeys, BILL_LINE_KEYS),
    };
  }
  return {
    header: [...DEFAULT_BILL_FIELDS.header],
    lines: [...DEFAULT_BILL_FIELDS.lines],
  };
}

function headerFieldValue(inv, key) {
  const matterName = invoiceMatterLabel(inv);
  switch (key) {
    case 'matter_name': return matterName;
    case 'matter_number': return inv.matter_number || '';
    case 'client': return inv.client_name || '';
    case 'status': return invoiceStageLabel(inv.status);
    case 'issue_date': return inv.issue_date || '';
    case 'due_date': return inv.due_date || '';
    case 'subtotal': return Number(inv.subtotal_cents || 0) / 100;
    case 'total': return Number(inv.total_cents || 0) / 100;
    default: return '';
  }
}

function headerFieldLabel(key) {
  return BILL_HEADER_FIELDS.find((f) => f.key === key)?.label
    || BILL_CORE_HEADER_FIELDS.find((f) => f.key === key)?.label
    || key;
}

function lineFieldLabel(key) {
  return BILL_LINE_FIELDS.find((f) => f.key === key)?.label || key;
}

function lineCell(line, key) {
  switch (key) {
    case 'service_date': return { v: line.service_date || '', t: 's' };
    case 'timekeeper': return { v: line.timekeeper_name || '', t: 's' };
    case 'description': return { v: line.description || '', t: 's' };
    case 'hours': return { v: formatDuration(line.minutes || 0, 'decimal'), t: 's' };
    case 'minutes': return { v: Number(line.minutes || 0), t: 'n' };
    case 'rate': return { v: Number(line.rate_cents || 0) / 100, t: 'currency' };
    case 'amount': return { v: Number(line.amount_cents || 0) / 100, t: 'currency' };
    default: return { v: '', t: 's' };
  }
}

function lineCellText(line, key) {
  switch (key) {
    case 'service_date': return String(line.service_date || '');
    case 'timekeeper': return String(line.timekeeper_name || '');
    case 'description': return String(line.description || '');
    case 'hours': return formatDuration(line.minutes || 0, 'decimal');
    case 'minutes': return String(line.minutes || 0);
    case 'rate': return formatCents(line.rate_cents || 0);
    case 'amount': return formatCents(line.amount_cents || 0);
    default: return '';
  }
}

function invoiceExportRows(inv, fields = null) {
  const cfg = resolveBillFields(fields || inv.fieldConfig);
  const headerMeta = [
    [{ v: 'Bill', t: 's' }, { v: inv.number || '', t: 's' }],
  ];
  for (const key of cfg.header) {
    if (key === 'subtotal' || key === 'total') continue;
    const value = headerFieldValue(inv, key);
    headerMeta.push([
      { v: headerFieldLabel(key), t: 's' },
      key === 'subtotal' || key === 'total'
        ? { v: value, t: 'currency' }
        : { v: String(value || ''), t: 's' },
    ]);
  }
  headerMeta.push([]);

  const lineKeys = cfg.lines.length ? cfg.lines : [...DEFAULT_BILL_FIELDS.lines];
  const header = lineKeys.map((key) => ({ v: lineFieldLabel(key), t: 's' }));
  const body = (inv.lines || []).map((l) => lineKeys.map((key) => lineCell(l, key)));

  const summary = [[]];
  if (cfg.header.includes('subtotal')) {
    summary.push([
      { v: 'Subtotal', t: 's' },
      { v: Number(inv.subtotal_cents || 0) / 100, t: 'currency' },
    ]);
  }
  if (cfg.header.includes('total')) {
    summary.push([
      { v: 'Total', t: 's' },
      { v: Number(inv.total_cents || 0) / 100, t: 'currency' },
    ]);
  }
  return [...headerMeta, header, ...body, ...summary];
}

function toInvoiceXlsx(inv, fields = null) {
  return buildXlsx(invoiceExportRows(inv, fields));
}

function toInvoicePdf(inv, fields = null) {
  const cfg = resolveBillFields(fields || inv.fieldConfig);
  const matterName = invoiceMatterLabel(inv);
  const lines = [];
  for (const key of cfg.header) {
    if (key === 'subtotal' || key === 'total') continue;
    const value = headerFieldValue(inv, key);
    if (value === '' || value == null) continue;
    lines.push(`${headerFieldLabel(key)}: ${value}`);
  }
  lines.push('');

  const lineKeys = cfg.lines.length ? cfg.lines : [...DEFAULT_BILL_FIELDS.lines];
  // Keep description under the row when other columns are present.
  const tableKeys = lineKeys.filter((k) => k !== 'description');
  const showDescription = lineKeys.includes('description');
  if (tableKeys.length) {
    const colHeader = tableKeys.map((k) => {
      const label = lineFieldLabel(k);
      if (k === 'timekeeper') return label.padEnd(24);
      if (k === 'service_date') return label.padEnd(10);
      if (k === 'hours' || k === 'minutes') return label.padStart(6);
      if (k === 'rate' || k === 'amount') return label.padStart(9);
      return label;
    }).join(' ');
    lines.push(colHeader.trimEnd());
    lines.push('-'.repeat(Math.max(74, colHeader.length)));
  }
  for (const l of inv.lines || []) {
    if (tableKeys.length) {
      const cols = tableKeys.map((k) => {
        const text = lineCellText(l, k);
        if (k === 'timekeeper') return text.slice(0, 24).padEnd(24);
        if (k === 'service_date') return text.padEnd(10);
        if (k === 'hours' || k === 'minutes') return text.padStart(6);
        if (k === 'rate' || k === 'amount') return text.padStart(9);
        return text;
      });
      lines.push(cols.join(' '));
    }
    if (showDescription && l.description) lines.push(`  ${l.description}`);
  }
  if (tableKeys.length) lines.push('-'.repeat(74));
  if (cfg.header.includes('subtotal')) {
    lines.push(`Subtotal:   ${formatCents(inv.subtotal_cents || 0)}`);
  }
  if (cfg.header.includes('total')) {
    lines.push(`Total:      ${formatCents(inv.total_cents || 0)}`);
  }
  if ((inv.credits || []).length) {
    lines.push('');
    lines.push('Credit notes:');
    for (const c of inv.credits) {
      lines.push(`  ${c.number}: ${formatCents(c.amount_cents)} — ${c.reason || ''}`);
    }
  }
  return buildTextPdf({
    title: `Bill ${inv.number || ''} — ${matterName}`.trim(),
    lines: lines.filter((l) => l != null),
  });
}

module.exports = {
  BILL_HEADER_FIELDS,
  BILL_LINE_FIELDS,
  BILL_CORE_HEADER_FIELDS,
  DEFAULT_BILL_FIELDS,
  createBill,
  generatePrebill,
  writeDownLine,
  setStatus,
  deleteInvoice,
  createCreditNote,
  getInvoice,
  listInvoices,
  listMattersReadyForBilling,
  invoiceStageLabel,
  getBillFields,
  getBillFieldConfig,
  setBillFields,
  addBillField,
  removeBillField,
  toInvoiceXlsx,
  toInvoicePdf,
};
