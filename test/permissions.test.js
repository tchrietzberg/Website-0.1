const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const permissions = require('../src/services/permissions');
const customFields = require('../src/services/customFields');
const matterSvc = require('../src/services/matters');
const clientsSvc = require('../src/services/clients');

describe('profile permissions and record page layout', () => {
  let db;
  let admin;
  let paralegal;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-perms-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    paralegal = db.prepare('SELECT * FROM users WHERE id=2').get();
    customFields.ensureRecordTypes(db);
  });

  it('defaults profiles to read/write and lets admin set read only', () => {
    const defaults = permissions.getProfilePermissions(db);
    assert.equal(defaults.paralegal, 'read_write');
    assert.equal(defaults.admin, 'read_write');

    const next = permissions.setProfilePermissions(db, admin, {
      paralegal: 'read_only',
      admin: 'read_only', // ignored — admin stays writable
    });
    assert.equal(next.paralegal, 'read_only');
    assert.equal(next.admin, 'read_write');
    assert.equal(permissions.getProfileAccess(db, 'paralegal'), 'read_only');
  });

  it('blocks matter updates for read-only profiles', () => {
    permissions.setProfilePermissions(db, admin, { paralegal: 'read_only' });
    const page = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Locked Matter',
      openedOn: '2026-01-01',
    });
    assert.throws(() => matterSvc.updateMatter(db, paralegal, page.matter.id, {
      jurisdiction: 'N.D. Cal.',
    }), /read only/i);
    assert.throws(() => matterSvc.createMatter(db, paralegal, {
      clientId: 1,
      name: 'Should fail',
      openedOn: '2026-01-02',
    }), /read only/i);
  });

  it('hides matter fields based on record page layout per profile', () => {
    customFields.addStandardFieldToType(db, admin, 'billable', 'std:court');
    const field = customFields.createCustomField(db, admin, {
      label: 'Secret code',
      fieldType: 'text',
      recordTypeKey: 'billable',
    });
    const created = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Visibility Matter',
      openedOn: '2026-03-01',
      customValues: { [field.id]: 'X' },
    });
    customFields.addStandardFieldToMatter(db, admin, created.matter.id, 'std:court');

    permissions.setRecordPageLayout(db, admin, {
      matter: {
        'std:court': { admin: true, paralegal: false, attorney: true, billing_clerk: true },
        [`cf:${field.id}`]: { admin: true, paralegal: false, attorney: true, billing_clerk: true },
      },
    });

    const asAdmin = matterSvc.getMatter(db, created.matter.id, admin);
    const adminKeys = Object.values(asAdmin.sections).flat().map((f) => f.key);
    assert.ok(adminKeys.includes('std:court'));
    assert.ok(adminKeys.includes(`cf:${field.id}`));

    const asPara = matterSvc.getMatter(db, created.matter.id, paralegal);
    const paraKeys = Object.values(asPara.sections).flat().map((f) => f.key);
    assert.ok(!paraKeys.includes('std:court'));
    assert.ok(!paraKeys.includes(`cf:${field.id}`));
    assert.ok(paraKeys.includes('std:name'));
    assert.equal(asPara.canEdit, true); // still read_write until profile flipped
  });

  it('marks pages read-only when profile is read only', () => {
    permissions.setProfilePermissions(db, admin, { paralegal: 'read_only' });
    const created = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'RO Matter',
      openedOn: '2026-04-01',
    });
    const page = matterSvc.getMatter(db, created.matter.id, paralegal);
    assert.equal(page.pageAccess, 'read_only');
    assert.equal(page.canEdit, false);
    assert.ok(Object.values(page.sections).flat().every((f) => f.readonly || f.key === 'std:number'));
  });

  it('lets admins deactivate custom fields', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Temp field',
      fieldType: 'text',
      recordTypeKey: 'billable',
    });
    assert.equal(customFields.listCustomFields(db, { recordTypeKey: 'billable' }).length, 1);
    customFields.deactivateCustomField(db, admin, field.id);
    assert.equal(customFields.listCustomFields(db, { recordTypeKey: 'billable' }).length, 0);
  });

  it('hides contact custom fields per profile layout', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Internal note',
      fieldType: 'text',
      appliesTo: 'client',
    });
    const page = clientsSvc.createClient(db, admin, {
      name: 'Pat Client',
      customValues: { [field.id]: 'private' },
    });
    permissions.setRecordPageLayout(db, admin, {
      contact: {
        [`cf:${field.id}`]: { admin: true, paralegal: false, attorney: true, billing_clerk: true },
      },
    });
    const asPara = clientsSvc.getClient(db, page.client.id, paralegal);
    assert.ok(!asPara.fields.some((f) => f.fieldId === field.id));
    const asAdmin = clientsSvc.getClient(db, page.client.id, admin);
    assert.ok(asAdmin.fields.some((f) => f.fieldId === field.id));
  });
});
