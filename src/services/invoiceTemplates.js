/**
 * Firm invoice templates (Microsoft Word .docx / Adobe PDF) with {{merge}} fields.
 * Zero npm dependencies — DOCX via ZIP+XML replace; PDF via literal placeholder replace.
 */
const { audit, getSetting, setSetting } = require('../db');
const { formatCents, formatDuration } = require('../money');
const { zipStore, unzip } = require('../zip');
const { buildTextPdf } = require('../pdf');
const invoiceSvc = require('./invoices');

const DEFAULT_TEMPLATE_SETTING = 'invoice_default_template_id';
const MAX_TEMPLATE_BYTES = Math.max(50_000, Number(process.env.MAX_TEMPLATE_BYTES || 2_500_000));

const MERGE_FIELDS = [
  { key: 'bill_number', label: 'Bill number', example: 'INV-2026-0001' },
  { key: 'client_name', label: 'Client name', example: 'Acme Corp' },
  { key: 'matter_name', label: 'Matter name', example: 'Acme v. Smith' },
  { key: 'matter_number', label: 'Matter number', example: '2026-0042' },
  { key: 'attorney_name', label: 'Responsible attorney', example: 'Avery Admin' },
  { key: 'issue_date', label: 'Issue date', example: '2026-08-01' },
  { key: 'due_date', label: 'Due date', example: '2026-08-31' },
  { key: 'status', label: 'Bill status', example: 'Billed' },
  { key: 'subtotal', label: 'Subtotal', example: '$1,250.00' },
  { key: 'total', label: 'Total', example: '$1,250.00' },
  { key: 'hours_total', label: 'Total hours', example: '6.50' },
  { key: 'line_count', label: 'Line count', example: '4' },
  { key: 'firm_name', label: 'Firm name', example: 'Firm Billing' },
  { key: 'today', label: 'Today (UTC date)', example: '2026-08-10' },
  { key: 'line_items', label: 'Line items (multi-line text)', example: '2026-03-01  Avery  1.00  $200.00  Research' },
  { key: 'line_items_table', label: 'Line items table (tab-separated)', example: 'Date\\tTimekeeper\\tHours\\tAmount\\tDescription' },
];

function ensureInvoiceTemplatesTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoice_templates (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      format TEXT NOT NULL CHECK (format IN ('docx','pdf','txt')),
      description TEXT,
      file_name TEXT NOT NULL,
      content BLOB NOT NULL,
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0,1)),
      active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_invoice_templates_active
      ON invoice_templates(active, is_default);
  `);
}

function listMergeFields() {
  return MERGE_FIELDS.map((f) => ({
    ...f,
    token: `{{${f.key}}}`,
  }));
}

function detectFormat(fileName, formatHint) {
  const hint = String(formatHint || '').toLowerCase().trim();
  if (hint === 'docx' || hint === 'pdf' || hint === 'txt') return hint;
  const lower = String(fileName || '').toLowerCase();
  if (lower.endsWith('.docx')) return 'docx';
  if (lower.endsWith('.pdf')) return 'pdf';
  if (lower.endsWith('.txt')) return 'txt';
  throw Object.assign(new Error('Template must be .docx (Word), .pdf (Adobe), or .txt'), {
    code: 'BAD_FORMAT',
    status: 400,
  });
}

function listTemplates(db) {
  ensureInvoiceTemplatesTable(db);
  return db.prepare(`
    SELECT id, name, format, description, file_name, is_default, active,
           length(content) AS size_bytes, created_at, updated_at, created_by
    FROM invoice_templates
    WHERE active = 1
    ORDER BY is_default DESC, name COLLATE NOCASE, id
  `).all();
}

function getTemplate(db, id) {
  ensureInvoiceTemplatesTable(db);
  return db.prepare(`
    SELECT id, name, format, description, file_name, content, is_default, active,
           created_at, updated_at, created_by
    FROM invoice_templates WHERE id = ?
  `).get(id);
}

function getDefaultTemplate(db) {
  ensureInvoiceTemplatesTable(db);
  const fromFlag = db.prepare(`
    SELECT id, name, format, description, file_name, content, is_default, active
    FROM invoice_templates WHERE active = 1 AND is_default = 1
    ORDER BY id DESC LIMIT 1
  `).get();
  if (fromFlag) return fromFlag;
  const settingId = Number(getSetting(db, DEFAULT_TEMPLATE_SETTING, '0'));
  if (settingId) {
    const row = getTemplate(db, settingId);
    if (row && row.active) return row;
  }
  return null;
}

function clearDefaultFlags(db) {
  db.prepare('UPDATE invoice_templates SET is_default = 0').run();
}

function createTemplate(db, actor, {
  name,
  format,
  fileName,
  contentBase64,
  description = '',
  isDefault = false,
} = {}) {
  ensureInvoiceTemplatesTable(db);
  const label = String(name || '').trim();
  if (!label) throw Object.assign(new Error('Template name is required'), { status: 400 });
  const fname = String(fileName || 'template.docx').trim() || 'template.docx';
  const fmt = detectFormat(fname, format);
  const raw = Buffer.from(String(contentBase64 || ''), 'base64');
  if (!raw.length) throw Object.assign(new Error('Template file is empty'), { status: 400 });
  if (raw.length > MAX_TEMPLATE_BYTES) {
    throw Object.assign(new Error(`Template exceeds ${MAX_TEMPLATE_BYTES} bytes`), { status: 413 });
  }
  if (fmt === 'docx') {
    // Validate ZIP/DOCX signature
    if (raw[0] !== 0x50 || raw[1] !== 0x4b) {
      throw Object.assign(new Error('Word template must be a .docx file'), { status: 400 });
    }
  }
  if (fmt === 'pdf' && !String(raw.slice(0, 5)).startsWith('%PDF')) {
    throw Object.assign(new Error('Adobe template must be a PDF file'), { status: 400 });
  }
  if (isDefault) clearDefaultFlags(db);
  const info = db.prepare(`
    INSERT INTO invoice_templates(name, format, description, file_name, content, is_default, created_by)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    label,
    fmt,
    String(description || '').slice(0, 500),
    fname,
    raw,
    isDefault ? 1 : 0,
    actor?.id || null
  );
  if (isDefault) setSetting(db, DEFAULT_TEMPLATE_SETTING, String(info.lastInsertRowid));
  audit(db, {
    actorId: actor?.id || null,
    action: 'invoice_template.create',
    entityType: 'invoice_template',
    entityId: Number(info.lastInsertRowid),
    detail: { name: label, format: fmt, fileName: fname, isDefault: !!isDefault },
  });
  return listTemplates(db).find((t) => t.id === Number(info.lastInsertRowid));
}

function updateTemplate(db, actor, id, patch = {}) {
  ensureInvoiceTemplatesTable(db);
  const row = getTemplate(db, id);
  if (!row || !row.active) throw Object.assign(new Error('Template not found'), { status: 404 });
  const name = patch.name != null ? String(patch.name).trim() : row.name;
  const description = patch.description != null
    ? String(patch.description).slice(0, 500)
    : (row.description || '');
  if (!name) throw Object.assign(new Error('Template name is required'), { status: 400 });
  if (patch.isDefault) clearDefaultFlags(db);
  const isDefault = patch.isDefault != null ? (patch.isDefault ? 1 : 0) : row.is_default;
  db.prepare(`
    UPDATE invoice_templates
    SET name = ?, description = ?, is_default = ?,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(name, description, isDefault, id);
  if (isDefault) setSetting(db, DEFAULT_TEMPLATE_SETTING, String(id));
  audit(db, {
    actorId: actor?.id || null,
    action: 'invoice_template.update',
    entityType: 'invoice_template',
    entityId: id,
    detail: { name, isDefault: !!isDefault },
  });
  return listTemplates(db).find((t) => t.id === Number(id));
}

function deleteTemplate(db, actor, id) {
  ensureInvoiceTemplatesTable(db);
  const row = getTemplate(db, id);
  if (!row) throw Object.assign(new Error('Template not found'), { status: 404 });
  db.prepare(`
    UPDATE invoice_templates
    SET active = 0, is_default = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(id);
  if (Number(getSetting(db, DEFAULT_TEMPLATE_SETTING, '0')) === Number(id)) {
    setSetting(db, DEFAULT_TEMPLATE_SETTING, '0');
  }
  audit(db, {
    actorId: actor?.id || null,
    action: 'invoice_template.delete',
    entityType: 'invoice_template',
    entityId: id,
    detail: { name: row.name },
  });
  return { ok: true };
}

function xmlEscape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildMergeMap(inv, db = null) {
  const firmName = db ? (getSetting(db, 'firm_name', 'Firm Billing') || 'Firm Billing') : 'Firm Billing';
  const lines = inv.lines || [];
  const minutes = lines.reduce((s, l) => s + Number(l.minutes || 0), 0);
  const lineItems = lines.map((l) => [
    l.service_date || '',
    l.timekeeper_name || '',
    formatDuration(l.minutes || 0, 'decimal'),
    formatCents(l.amount_cents || 0),
    String(l.description || '').replace(/\s+/g, ' ').trim(),
  ].join('  ')).join('\n');
  const lineTable = [
    ['Date', 'Timekeeper', 'Hours', 'Amount', 'Description'].join('\t'),
    ...lines.map((l) => [
      l.service_date || '',
      l.timekeeper_name || '',
      formatDuration(l.minutes || 0, 'decimal'),
      formatCents(l.amount_cents || 0),
      String(l.description || '').replace(/\t/g, ' ').replace(/\s+/g, ' ').trim(),
    ].join('\t')),
  ].join('\n');

  return {
    bill_number: inv.number || '',
    client_name: inv.client_name || '',
    matter_name: inv.matter_name || inv.matter_number || '',
    matter_number: inv.matter_number || '',
    attorney_name: inv.attorney_name || '',
    issue_date: inv.issue_date || '',
    due_date: inv.due_date || '',
    status: invoiceSvc.invoiceStageLabel(inv.status),
    subtotal: formatCents(inv.subtotal_cents || 0),
    total: formatCents(inv.total_cents || 0),
    hours_total: formatDuration(minutes, 'decimal'),
    line_count: String(lines.length),
    firm_name: firmName,
    today: new Date().toISOString().slice(0, 10),
    line_items: lineItems,
    line_items_table: lineTable,
  };
}

function applyMergeText(text, mergeMap, { escapeXml = false } = {}) {
  let out = String(text || '');
  // Longer keys first so line_items_table wins over line_items
  const keys = Object.keys(mergeMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const token = `{{${key}}}`;
    let value = mergeMap[key] == null ? '' : String(mergeMap[key]);
    if (escapeXml) {
      value = xmlEscape(value).replace(/\n/g, '</w:t><w:br/><w:t>');
    }
    out = out.split(token).join(value);
  }
  return out;
}

/** Collapse Word XML so {{merge}} tokens split across runs still match. */
function coalesceDocxMergeTokens(xml) {
  return String(xml).replace(
    /\{\{([a-z0-9_]+)\}\}/gi,
    (m) => m
  ).replace(
    /\{\{(?:<\/w:t><\/w:r>(?:<w:r[^>]*>)?(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>|\s)*([a-z0-9_]+)(?:<\/w:t><\/w:r>(?:<w:r[^>]*>)?(?:<w:rPr>[\s\S]*?<\/w:rPr>)?<w:t[^>]*>|\s)*\}\}/gi,
    '{{$1}}'
  );
}

function mergeDocx(templateBuf, mergeMap) {
  const files = unzip(templateBuf);
  const next = [];
  for (const [name, data] of files.entries()) {
    if (/^word\/(document|header\d*|footer\d*)\.xml$/i.test(name)) {
      let xml = data.toString('utf8');
      xml = coalesceDocxMergeTokens(xml);
      xml = applyMergeText(xml, mergeMap, { escapeXml: true });
      next.push([name, Buffer.from(xml, 'utf8')]);
    } else {
      next.push([name, data]);
    }
  }
  return zipStore(next);
}

function mergePdfPlaceholders(templateBuf, mergeMap) {
  // Replace ASCII {{tokens}} in content streams. Works for simple Adobe/text PDFs.
  let bin = templateBuf.toString('latin1');
  const keys = Object.keys(mergeMap).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    const token = `{{${key}}}`;
    let value = String(mergeMap[key] ?? '');
    // Keep PDF string literals stable: escape ( ) \
    value = value
      .replace(/\\/g, '\\\\')
      .replace(/\(/g, '\\(')
      .replace(/\)/g, '\\)')
      .replace(/\r?\n/g, ' ');
    // Pad/truncate to token length when possible to reduce xref drift for simple files
    if (value.length < token.length) value = value.padEnd(token.length, ' ');
    bin = bin.split(token).join(value);
  }
  return Buffer.from(bin, 'latin1');
}

function mergeTxt(templateBuf, mergeMap) {
  const text = applyMergeText(templateBuf.toString('utf8'), mergeMap, { escapeXml: false });
  return buildTextPdf({
    title: mergeMap.bill_number ? `Bill ${mergeMap.bill_number}` : 'Bill',
    lines: text.split(/\r?\n/),
    wrapWidth: 100,
  });
}

function renderInvoiceWithTemplate(db, inv, template) {
  const mergeMap = buildMergeMap(inv, db);
  const content = Buffer.isBuffer(template.content)
    ? template.content
    : Buffer.from(template.content);
  if (template.format === 'docx') {
    return {
      buffer: mergeDocx(content, mergeMap),
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      extension: 'docx',
      fileName: `${inv.number || 'bill'}-${template.name || 'template'}.docx`.replace(/[^\w.\-]+/g, '_'),
    };
  }
  if (template.format === 'pdf') {
    return {
      buffer: mergePdfPlaceholders(content, mergeMap),
      contentType: 'application/pdf',
      extension: 'pdf',
      fileName: `${inv.number || 'bill'}-${template.name || 'template'}.pdf`.replace(/[^\w.\-]+/g, '_'),
    };
  }
  return {
    buffer: mergeTxt(content, mergeMap),
    contentType: 'application/pdf',
    extension: 'pdf',
    fileName: `${inv.number || 'bill'}-${template.name || 'template'}.pdf`.replace(/[^\w.\-]+/g, '_'),
  };
}

function sampleDocxBuffer() {
  const body = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>{{firm_name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Bill {{bill_number}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Client: {{client_name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Matter: {{matter_number}} — {{matter_name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Attorney: {{attorney_name}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Issue date: {{issue_date}}    Due: {{due_date}}</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:t>Time entries</w:t></w:r></w:p>
    <w:p><w:r><w:t>{{line_items}}</w:t></w:r></w:p>
    <w:p><w:r><w:t></w:t></w:r></w:p>
    <w:p><w:r><w:t>Subtotal: {{subtotal}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Total: {{total}}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Hours: {{hours_total}}</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

  const docRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`;

  return zipStore([
    ['[Content_Types].xml', contentTypes],
    ['_rels/.rels', rels],
    ['word/document.xml', body],
    ['word/_rels/document.xml.rels', docRels],
  ]);
}

function samplePdfBuffer() {
  return buildTextPdf({
    title: '{{firm_name}}',
    lines: [
      'Bill {{bill_number}}',
      'Client: {{client_name}}',
      'Matter: {{matter_number}} — {{matter_name}}',
      'Attorney: {{attorney_name}}',
      'Issue: {{issue_date}}   Due: {{due_date}}',
      '',
      'Time entries',
      '{{line_items}}',
      '',
      'Subtotal: {{subtotal}}',
      'Total: {{total}}',
      'Hours: {{hours_total}}',
    ],
    wrapWidth: 100,
  });
}

function sampleTxtBuffer() {
  return Buffer.from([
    '{{firm_name}}',
    'Bill {{bill_number}}',
    'Client: {{client_name}}',
    'Matter: {{matter_number}} — {{matter_name}}',
    'Issue: {{issue_date}}   Due: {{due_date}}',
    '',
    '{{line_items}}',
    '',
    'Subtotal: {{subtotal}}',
    'Total: {{total}}',
  ].join('\n'), 'utf8');
}

module.exports = {
  MERGE_FIELDS,
  MAX_TEMPLATE_BYTES,
  ensureInvoiceTemplatesTable,
  listMergeFields,
  listTemplates,
  getTemplate,
  getDefaultTemplate,
  createTemplate,
  updateTemplate,
  deleteTemplate,
  buildMergeMap,
  renderInvoiceWithTemplate,
  sampleDocxBuffer,
  samplePdfBuffer,
  sampleTxtBuffer,
  applyMergeText,
  mergeDocx,
};
