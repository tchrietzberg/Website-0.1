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

    // Matter numbers are not indexed / searchable
    assert.equal(matterSvc.searchMatters(db, { q: byName[0].number }).length, 0);

    // Full list still available for dropdowns
    assert.equal(matterSvc.listMatters(db).length, 2);
  });

  it('only seeds the Default record type', () => {
    const types = customFields.listRecordTypes(db);
    assert.equal(types.length, 1);
    assert.equal(types[0].key, customFields.DEFAULT_RECORD_TYPE_KEY);
    assert.equal(types[0].label, customFields.DEFAULT_RECORD_TYPE_LABEL);
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
      fieldType: 'select',
      recordTypeKey: customFields.DEFAULT_RECORD_TYPE_KEY,
      options: ['Discovery', 'Trial'],
    });
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
    assert.equal(page.layout.source, 'record');

    const byCustom = matterSvc.searchMatters(db, { q: 'petition' });
    assert.equal(byCustom.length, 1);
    assert.equal(byCustom[0].id, matterId);

    matterIndex.reindexAllMatters(db);
    assert.equal(matterSvc.searchMatters(db, { q: 'Discovery' }).length, 1);
  });

  it('new matters show only core fields; optional standards can be added later', () => {
    const page0 = matterSvc.createMatter(db, admin, { name: 'Lean Matter' });
    const keys = Object.values(page0.sections).flat().map((f) => f.key);
    assert.deepEqual(keys.sort(), ['std:name', 'std:number']);
    assert.ok(page0.availableStandardFields.some((f) => f.key === 'std:client'));
    assert.ok(page0.availableStandardFields.some((f) => f.key === 'std:court'));
    assert.ok(!page0.availableStandardFields.some((f) => f.key === 'std:matter_type'));

    const page1 = customFields.addStandardFieldToMatter(db, admin, page0.matter.id, 'std:client');
    const keys1 = Object.values(page1.sections).flat().map((f) => f.key);
    assert.ok(keys1.includes('std:client'));
    assert.equal(page1.layout.source, 'record');
    assert.ok(!page1.availableStandardFields.some((f) => f.key === 'std:client'));
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
