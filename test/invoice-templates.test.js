const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const timeSvc = require('../src/services/time');
const invoiceSvc = require('../src/services/invoices');
const templates = require('../src/services/invoiceTemplates');
const { unzip } = require('../src/zip');

describe('invoice templates (Word / Adobe merge fields)', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-tpl-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    setSetting(db, 'firm_name', 'Demo Firm LLP');
    db.prepare(
      "INSERT INTO users(email,name,role,password_hash) VALUES ('avery@firm.example','Avery','admin',?)"
    ).run(hashPassword('demo-change-me'));
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, responsible_attorney_id, opened_on)
      VALUES (1, '2026-0099', 'Acme Case', 'billable', 1, '2026-01-01')
    `).run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',1,25000,'2020-01-01')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  it('lists merge fields and builds sample Word/Adobe templates', () => {
    const fields = templates.listMergeFields();
    assert.ok(fields.some((f) => f.key === 'client_name' && f.token === '{{client_name}}'));
    const docx = templates.sampleDocxBuffer();
    assert.equal(docx[0], 0x50);
    assert.equal(docx[1], 0x4b);
    const files = unzip(docx);
    assert.match(files.get('word/document.xml').toString('utf8'), /\{\{bill_number\}\}/);
    const pdf = templates.samplePdfBuffer();
    assert.equal(pdf.slice(0, 5).toString(), '%PDF-');
    assert.match(pdf.toString('latin1'), /\{\{client_name\}\}/);
  });

  it('uploads a Word template and merges invoice fields', () => {
    const created = templates.createTemplate(db, admin, {
      name: 'Letterhead',
      fileName: 'letterhead.docx',
      contentBase64: templates.sampleDocxBuffer().toString('base64'),
      isDefault: true,
    });
    assert.equal(created.format, 'docx');
    assert.equal(created.is_default, 1);

    timeSvc.createEntry(db, admin, {
      matterId: 1,
      timekeeperId: 1,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Research memo',
    });
    const inv = invoiceSvc.createBill(db, admin, 1);
    const full = invoiceSvc.getInvoice(db, inv.id);
    const tpl = templates.getDefaultTemplate(db);
    const rendered = templates.renderInvoiceWithTemplate(db, full, tpl);
    assert.equal(rendered.extension, 'docx');
    const xml = unzip(rendered.buffer).get('word/document.xml').toString('utf8');
    assert.match(xml, /Acme/);
    assert.match(xml, /Acme Case/);
    assert.match(xml, /Research memo/);
    assert.doesNotMatch(xml, /\{\{client_name\}\}/);
    assert.match(xml, new RegExp(String(full.number).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  it('merges Adobe PDF placeholders', () => {
    templates.createTemplate(db, admin, {
      name: 'Adobe bill',
      fileName: 'bill.pdf',
      contentBase64: templates.samplePdfBuffer().toString('base64'),
      isDefault: true,
    });
    timeSvc.createEntry(db, admin, {
      matterId: 1,
      timekeeperId: 1,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Hearing prep',
    });
    const inv = invoiceSvc.createBill(db, admin, 1);
    const full = invoiceSvc.getInvoice(db, inv.id);
    const rendered = templates.renderInvoiceWithTemplate(db, full, templates.getDefaultTemplate(db));
    assert.equal(rendered.extension, 'pdf');
    const text = rendered.buffer.toString('latin1');
    assert.match(text, /Acme/);
    assert.match(text, /Hearing prep/);
  });
});
