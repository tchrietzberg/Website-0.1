const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const matterSvc = require('../src/services/matters');
const customFields = require('../src/services/customFields');
const matterIndex = require('../src/services/matterIndex');

describe('matter search and record-based fields', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-matters-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('atty@x.com','Atty','attorney')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    customFields.ensureRecordTypes(db);
  });

  it('indexes matters and searches via FTS (empty query returns no hits)', () => {
    matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Widget Litigation',
      openedOn: '2026-01-01', responsibleAttorneyId: 2, court: 'N.D. Cal.',
    });
    matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Admin File',
      openedOn: '2026-01-02', responsibleAttorneyId: 2,
    });

    assert.equal(matterSvc.searchMatters(db, { q: '' }).length, 0);
    assert.equal(matterSvc.searchMatters(db, {}).length, 0);

    const byName = matterSvc.searchMatters(db, { q: 'widget' });
    assert.equal(byName.length, 1);
    assert.match(byName[0].name, /Widget/);

    const byCourt = matterSvc.searchMatters(db, { q: 'Cal' });
    assert.equal(byCourt.length, 1);

    const byClient = matterSvc.searchMatters(db, { q: 'acme' });
    assert.equal(byClient.length, 2);

    // Matter numbers remain searchable even when UI hides them
    const byNumber = matterSvc.searchMatters(db, { q: byName[0].number });
    assert.equal(byNumber.length, 1);
    assert.equal(byNumber[0].id, byName[0].id);

    // Full list still available for dropdowns
    assert.equal(matterSvc.listMatters(db).length, 2);
  });

  it('seeds Billable and Non-Billable record types; Billable is default', () => {
    const types = customFields.listRecordTypes(db);
    assert.ok(types.length >= 2);
    assert.equal(types[0].key, 'billable');
    assert.equal(types[0].label, 'Billable');
    assert.equal(types[1].key, 'non_billable');
    assert.equal(types[1].label, 'Non-Billable');
    assert.equal(customFields.DEFAULT_RECORD_TYPE_KEY, 'billable');

    const page = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Default Type Matter', openedOn: '2026-01-01',
    });
    assert.equal(page.matter.matter_type, 'billable');
  });

  it('lets admins add more record pages that survive remigrate', () => {
    const created = customFields.createRecordType(db, admin, { label: 'Contested' });
    assert.equal(created.key, 'contested');
    assert.equal(created.label, 'Contested');

    customFields.addStandardFieldToType(db, admin, 'contested', 'std:court');
    const layout = customFields.getTypeLayout(db, 'contested');
    assert.ok(layout.fields.some((f) => f.fieldKey === 'std:court'));

    customFields.ensureRecordTypes(db);
    const types = customFields.listRecordTypes(db);
    assert.ok(types.some((t) => t.key === 'contested'));

    const page = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Dispute',
      openedOn: '2026-06-01',
      recordTypeKey: 'contested',
    });
    assert.equal(page.matter.matter_type, 'contested');
    const keys = Object.values(page.sections).flat().map((f) => f.key);
    assert.ok(keys.includes('std:court'));
    assert.equal(page.layout.source, 'record_type');
  });

  it('custom fields depend on the chosen matter record type', () => {
    const billableField = customFields.createCustomField(db, admin, {
      label: 'Fee arrangement',
      fieldType: 'text',
      recordTypeKey: 'billable',
      required: true,
    });
    const nonBillableField = customFields.createCustomField(db, admin, {
      label: 'Pro bono reason',
      fieldType: 'textarea',
      recordTypeKey: 'non_billable',
      required: true,
    });

    assert.throws(() => matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Needs fee', openedOn: '2026-02-01',
      recordTypeKey: 'billable',
    }), /Fee arrangement/);

    const billable = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Needs fee', openedOn: '2026-02-01',
      recordTypeKey: 'billable',
      customValues: { [billableField.id]: 'Hourly' },
    });
    assert.equal(billable.matter.matter_type, 'billable');
    const billableKeys = Object.values(billable.sections).flat().map((f) => f.fieldId);
    assert.ok(billableKeys.includes(billableField.id));
    assert.ok(!billableKeys.includes(nonBillableField.id));

    assert.throws(() => matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Needs reason', openedOn: '2026-02-02',
      recordTypeKey: 'non_billable',
    }), /Pro bono reason/);

    const nonBillable = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Needs reason', openedOn: '2026-02-02',
      recordTypeKey: 'non_billable',
      customValues: { [nonBillableField.id]: 'Clinic' },
    });
    assert.equal(nonBillable.matter.matter_type, 'non_billable');
    const nbKeys = Object.values(nonBillable.sections).flat().map((f) => f.fieldId);
    assert.ok(nbKeys.includes(nonBillableField.id));
    assert.ok(!nbKeys.includes(billableField.id));

    const billableLayout = customFields.getTypeLayout(db, 'billable');
    const nbLayout = customFields.getTypeLayout(db, 'non_billable');
    assert.ok(billableLayout.customFields.some((f) => f.id === billableField.id));
    assert.ok(!billableLayout.customFields.some((f) => f.id === nonBillableField.id));
    assert.ok(nbLayout.customFields.some((f) => f.id === nonBillableField.id));
  });

  it('supports type-based and record-based custom fields; values are searchable', () => {
    const page0 = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Class Action',
      openedOn: '2026-01-01', responsibleAttorneyId: 2,
    });
    const matterId = page0.matter.id;
    assert.equal(page0.matter.matter_type, customFields.DEFAULT_RECORD_TYPE_KEY);

    const typeField = customFields.createCustomField(db, admin, {
      label: 'Case stage',
      fieldType: 'dropdown',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      options: ['Discovery', 'Trial'],
    });
    assert.equal(typeField.field_type, 'dropdown');
    assert.deepEqual(typeField.options, ['Discovery', 'Trial']);
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Empty dropdown',
      fieldType: 'dropdown',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
    }), /at least one option/);
    const recordField = customFields.createCustomField(db, admin, {
      label: 'Special note',
      fieldType: 'textarea',
      matterId,
    });

    matterSvc.updateMatter(db, admin, matterId, {
      customValues: {
        [typeField.id]: 'Discovery',
        [recordField.id]: 'Fee petition matter',
      },
    });

    const page = matterSvc.getMatter(db, matterId);
    const allFields = Object.values(page.sections).flat();
    assert.equal(allFields.find((f) => f.fieldId === typeField.id).value, 'Discovery');
    assert.equal(allFields.find((f) => f.fieldId === recordField.id).value, 'Fee petition matter');
    assert.equal(page.layout.source, 'record_type');
    const typeLayoutField = page.layoutFields.find((f) => Number(f.fieldId) === Number(typeField.id));
    const matterLayoutField = page.layoutFields.find((f) => Number(f.fieldId) === Number(recordField.id));
    assert.equal(typeLayoutField.scope, 'record_type');
    assert.equal(matterLayoutField.scope, 'record');

    const byCustom = matterSvc.searchMatters(db, { q: 'petition' });
    assert.equal(byCustom.length, 1);
    assert.equal(byCustom[0].id, matterId);

    matterIndex.reindexAllMatters(db);
    assert.equal(matterSvc.searchMatters(db, { q: 'Discovery' }).length, 1);
  });

  it('new matters show only core fields; optional standards follow the type layout', () => {
    const page0 = matterSvc.createMatter(db, admin, { name: 'Lean Matter' });
    assert.equal(page0.matter.client_id, null);
    assert.equal(page0.matter.client_name, null);
    const keys = Object.values(page0.sections).flat().map((f) => f.key);
    assert.deepEqual(keys.sort(), ['std:name', 'std:number']);
    assert.ok(page0.availableStandardFields.some((f) => f.key === 'std:client'));
    assert.ok(page0.availableStandardFields.some((f) => f.key === 'std:court'));
    assert.ok(!page0.availableStandardFields.some((f) => f.key === 'std:matter_type'));

    const page1 = customFields.addStandardFieldToMatter(db, admin, page0.matter.id, 'std:client');
    const keys1 = Object.values(page1.sections).flat().map((f) => f.key);
    assert.ok(keys1.includes('std:client'));
    assert.equal(page1.layout.source, 'record_type');
    assert.ok(!page1.availableStandardFields.some((f) => f.key === 'std:client'));

    // Type-layout change applies to other matters of the same record page
    const page2 = matterSvc.createMatter(db, admin, { name: 'Sibling Matter' });
    const keys2 = Object.values(page2.sections).flat().map((f) => f.key);
    assert.ok(keys2.includes('std:client'));
  });

  it('can add and delete fields on default type and matter layouts', () => {
    const type0 = customFields.getTypeLayout(db, customFields.DEFAULT_RECORD_TYPE_KEY);
    assert.deepEqual(type0.fields.map((f) => f.fieldKey).sort(), ['std:name', 'std:number']);

    const type1 = customFields.addStandardFieldToType(
      db, admin, customFields.DEFAULT_RECORD_TYPE_KEY, 'std:court'
    );
    assert.ok(type1.fields.some((f) => f.fieldKey === 'std:court'));
    const type2 = customFields.removeFieldFromType(
      db, admin, customFields.DEFAULT_RECORD_TYPE_KEY, 'std:court'
    );
    assert.ok(!type2.fields.some((f) => f.fieldKey === 'std:court'));

    const page = matterSvc.createMatter(db, admin, { name: 'Field Mgmt' });
    customFields.addStandardFieldToMatter(db, admin, page.matter.id, 'std:status');
    const page2 = customFields.removeFieldFromMatter(db, admin, page.matter.id, 'std:status');
    assert.ok(!page2.layoutFields.some((f) => f.fieldKey === 'std:status'));
    assert.throws(
      () => customFields.removeFieldFromMatter(db, admin, page.matter.id, 'std:name'),
      /core fields/
    );
  });

  it('names matters as Name - Status - Year on create and status changes', () => {
    const page = matterSvc.createMatter(db, admin, {
      name: 'Alpha Matter',
      openedOn: '2026-03-15',
    });
    const id = page.matter.id;
    assert.equal(page.matter.name, 'Alpha Matter - Open - 2026');

    const closed = matterSvc.updateMatter(db, admin, id, { status: 'closed' });
    assert.equal(closed.matter.name, 'Alpha Matter - Closed - 2026');

    const reopened = matterSvc.updateMatter(db, admin, id, { status: 'open' });
    assert.equal(reopened.matter.name, 'Alpha Matter - Open - 2026');

    const stage = customFields.createCustomField(db, admin, {
      label: 'Status',
      fieldType: 'dropdown',
      options: ['Discovery', 'Trial'],
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
    });
    const withCustom = matterSvc.updateMatter(db, admin, id, {
      customValues: { [stage.id]: 'Discovery' },
    });
    assert.equal(withCustom.matter.name, 'Alpha Matter - Discovery - 2026');

    const next = matterSvc.updateMatter(db, admin, id, {
      customValues: { [stage.id]: 'Trial' },
      openedOn: '2025-01-01',
    });
    assert.equal(next.matter.name, 'Alpha Matter - Trial - 2025');
  });

  it('builds create matter names from a Settings field formula', () => {
    const ticker = customFields.createCustomField(db, admin, {
      label: 'Ticker',
      fieldType: 'text',
      recordTypeKey: 'billable',
      required: true,
      isDefault: true,
    });
    const company = customFields.createCustomField(db, admin, {
      label: 'Company Name',
      fieldType: 'text',
      recordTypeKey: 'billable',
      required: true,
      isDefault: true,
    });
    const caseType = customFields.createCustomField(db, admin, {
      label: 'Case Type',
      fieldType: 'select',
      options: ['Securities', 'Antitrust'],
      recordTypeKey: 'billable',
      required: true,
      isDefault: true,
    });

    const cfg = matterSvc.setMatterNameFormula(db, admin, {
      enabled: true,
      separator: '-',
      appendStatusYear: false,
      parts: [
        { kind: 'custom_field', fieldId: ticker.id },
        { kind: 'token', token: 'opened_year' },
        { kind: 'custom_field', fieldId: company.id },
        { kind: 'custom_field', fieldId: caseType.id },
      ],
    });
    assert.equal(cfg.enabled, true);
    assert.equal(cfg.previewExample, 'Ticker-Year-Company Name-Case Type');
    assert.ok(cfg.availableFields.some((f) => f.id === ticker.id));

    assert.throws(() => matterSvc.createMatter(db, admin, {
      openedOn: '2026-04-01',
      recordTypeKey: 'billable',
      customValues: {
        [ticker.id]: 'AAPL',
        [company.id]: 'Acme',
      },
    }), /Case Type/);

    const page = matterSvc.createMatter(db, admin, {
      openedOn: '2026-04-01',
      recordTypeKey: 'billable',
      customValues: {
        [ticker.id]: 'AAPL',
        [company.id]: 'Acme',
        [caseType.id]: 'Securities',
      },
    });
    assert.equal(page.matter.name, 'AAPL-2026-Acme-Securities');

    // Manual name is ignored when the formula is active.
    const page2 = matterSvc.createMatter(db, admin, {
      name: 'Should Not Win',
      openedOn: '2025-12-15',
      recordTypeKey: 'billable',
      customValues: {
        [ticker.id]: 'MSFT',
        [company.id]: 'Contoso',
        [caseType.id]: 'Antitrust',
      },
    });
    assert.equal(page2.matter.name, 'MSFT-2025-Contoso-Antitrust');
  });

  it('shows type dropdown fields on matter pages from the record page layout', () => {
    const page0 = matterSvc.createMatter(db, admin, { name: 'Status Matter' });
    customFields.addStandardFieldToMatter(db, admin, page0.matter.id, 'std:status');
    assert.equal(matterSvc.getMatter(db, page0.matter.id).layout.source, 'record_type');

    const stage = customFields.createCustomField(db, admin, {
      label: 'Case status',
      fieldType: 'dropdown',
      options: ['Open', 'On hold', 'Closed'],
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
    });
    const page = matterSvc.getMatter(db, page0.matter.id);
    const fields = Object.values(page.sections).flat();
    const found = fields.find((f) => f.fieldId === stage.id);
    assert.ok(found, 'dropdown custom field should appear on matter page sections');
    assert.equal(found.type, 'dropdown');
    assert.deepEqual(found.options, ['Open', 'On hold', 'Closed']);
    assert.ok(fields.some((f) => f.key === 'std:status'));
  });

  it('updates custom field label, type, options, and required', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Priority',
      fieldType: 'text',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
      required: false,
    });
    assert.equal(field.required, 0);
    assert.equal(field.field_type, 'text');

    const updated = customFields.updateCustomField(db, admin, field.id, {
      label: 'Case priority',
      fieldType: 'dropdown',
      options: ['Low', 'High'],
      required: true,
    });
    assert.equal(updated.label, 'Case priority');
    assert.equal(updated.field_type, 'dropdown');
    assert.deepEqual(updated.options, ['Low', 'High']);
    assert.equal(updated.required, 1);

    const again = customFields.updateCustomField(db, admin, field.id, {
      required: false,
      fieldType: 'text',
    });
    assert.equal(again.required, 0);
    assert.equal(again.field_type, 'text');
    assert.equal(again.options, null);
  });

  it('requires custom fields on matter and time entry creation', () => {
    const timeSvc = require('../src/services/time');
    const matterReq = customFields.createCustomField(db, admin, {
      label: 'Lead counsel',
      fieldType: 'text',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
      required: true,
    });
    assert.equal(matterReq.required, 1);

    assert.throws(() => matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Needs lead',
      openedOn: '2026-03-01',
    }), /Lead counsel/);

    const page = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Has lead',
      openedOn: '2026-03-01',
      customValues: { [matterReq.id]: 'Jordan Lee' },
    });
    assert.match(page.matter.name, /Has lead/);
    const stored = db.prepare(
      'SELECT value_text FROM custom_field_values WHERE matter_id = ? AND field_id = ?'
    ).get(page.matter.id, matterReq.id);
    assert.equal(stored.value_text, 'Jordan Lee');

    const timeReq = customFields.createCustomField(db, admin, {
      label: 'Activity code',
      fieldType: 'text',
      appliesTo: 'time_entry',
      required: true,
    });
    assert.throws(() => timeSvc.createEntry(db, admin, {
      matterId: page.matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-03-02',
      hours: 0.25,
      description: 'Call',
    }), /Activity code/);

    const entry = timeSvc.createEntry(db, admin, {
      matterId: page.matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-03-02',
      hours: 0.25,
      description: 'Call',
      customValues: { [timeReq.id]: 'A101' },
    });
    assert.equal(entry.customValues[timeReq.id], 'A101');
    const defs = customFields.listTimeEntryFieldDefs(db);
    assert.ok(defs.some((d) => d.fieldId === timeReq.id && d.required === true));
  });

  it('supports time-entry custom fields separate from matter fields', () => {
    const timeSvc = require('../src/services/time');
    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Billable work',
      openedOn: '2026-01-01', responsibleAttorneyId: 2,
    }).matter;

    const matterField = customFields.createCustomField(db, admin, {
      label: 'Case stage',
      fieldType: 'text',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
    });
    const timeField = customFields.createCustomField(db, admin, {
      label: 'Activity code',
      fieldType: 'text',
      appliesTo: 'time_entry',
    });

    assert.equal(matterField.appliesTo, 'matter');
    assert.equal(timeField.appliesTo, 'time_entry');

    const matterOnly = customFields.listCustomFields(db, {
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      appliesTo: 'matter',
    });
    assert.ok(matterOnly.some((f) => f.id === matterField.id));
    assert.ok(!matterOnly.some((f) => f.id === timeField.id));

    const timeOnly = customFields.listCustomFields(db, { appliesTo: 'time_entry' });
    assert.equal(timeOnly.length, 1);
    assert.equal(timeOnly[0].id, timeField.id);

    const entry = timeSvc.createEntry(db, admin, {
      matterId: matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-02-01',
      rawMinutes: 15,
      description: 'Research',
      customValues: { [timeField.id]: 'A101' },
    });
    assert.equal(entry.customValues[timeField.id], 'A101');
    const stored = customFields.getTimeCustomValues(db, entry.id);
    assert.equal(stored.length, 1);
    assert.equal(stored[0].value_text, 'A101');
  });
});
