const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const matterSvc = require('../src/services/matters');
const customFields = require('../src/services/customFields');

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

  it('searches matters by number, name, and client', () => {
    matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Widget Litigation', matterType: 'litigation',
      openedOn: '2026-01-01', responsibleAttorneyId: 2,
    });
    matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Admin File', matterType: 'sw_admin',
      openedOn: '2026-01-02', responsibleAttorneyId: 2,
    });
    const byName = matterSvc.listMatters(db, { q: 'widget' });
    assert.equal(byName.length, 1);
    assert.match(byName[0].name, /Widget/);
    const byType = matterSvc.listMatters(db, { matterType: 'sw_admin' });
    assert.equal(byType.length, 1);
    const byClient = matterSvc.listMatters(db, { q: 'acme' });
    assert.equal(byClient.length, 2);
  });

  it('supports type-based and record-based custom fields with layouts', () => {
    const page0 = matterSvc.createMatter(db, admin, {
      clientId: 1, name: 'Class Action', matterType: 'litigation',
      openedOn: '2026-01-01', responsibleAttorneyId: 2,
    });
    const matterId = page0.matter.id;

    const typeField = customFields.createCustomField(db, admin, {
      label: 'Case stage',
      fieldType: 'select',
      recordTypeKey: 'litigation',
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
    assert.ok(page);
    const allFields = Object.values(page.sections).flat();
    const stage = allFields.find((f) => f.fieldId === typeField.id);
    const note = allFields.find((f) => f.fieldId === recordField.id);
    assert.equal(stage.value, 'Discovery');
    assert.equal(stage.scope, 'record_type');
    assert.equal(note.value, 'Fee petition matter');
    assert.equal(note.scope, 'record');
    assert.equal(page.layout.source, 'record'); // record field forces matter layout
  });
});
