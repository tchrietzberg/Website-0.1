const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const permissions = require('../src/services/permissions');
const customFields = require('../src/services/customFields');
const matterSvc = require('../src/services/matters');
const clientsSvc = require('../src/services/clients');
const timeSvc = require('../src/services/time');

describe('role permissions and field permissions', () => {
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

  it('defaults roles to full access and keeps admin locked on', () => {
    const defaults = permissions.getRolePermissions(db);
    assert.equal(defaults.paralegal.objects.matter.modifyAll, true);
    assert.equal(defaults.paralegal.objects.contact.delete, true);
    assert.equal(defaults.admin.objects.time.viewAll, true);

    const next = permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: false, delete: false },
          contact: { viewAll: true, modifyAll: false, delete: true },
          time: { viewAll: true, modifyAll: true, delete: false },
        },
      },
      admin: {
        objects: {
          matter: { viewAll: false, modifyAll: false, delete: false },
        },
      },
    });
    assert.equal(next.paralegal.objects.matter.modifyAll, false);
    assert.equal(next.paralegal.objects.contact.delete, true);
    assert.equal(next.admin.objects.matter.modifyAll, true);
    assert.equal(permissions.canModifyAll(db, 'paralegal', 'matter'), false);
    assert.equal(permissions.canDelete(db, 'paralegal', 'contact'), true);
  });

  it('migrates legacy read_only profile permissions', () => {
    permissions.setProfilePermissions(db, admin, { paralegal: 'read_only' });
    assert.equal(permissions.canViewAll(db, 'paralegal', 'matter'), true);
    assert.equal(permissions.canModifyAll(db, 'paralegal', 'matter'), false);
    assert.equal(permissions.canDelete(db, 'paralegal', 'time'), false);
  });

  it('blocks matter updates when Modify All is off', () => {
    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: false, delete: false },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
        },
      },
    });
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

  it('blocks delete without Delete permission and allows with it', () => {
    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: false },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
        },
      },
    });
    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Keep',
      openedOn: '2026-02-01',
    });
    assert.throws(
      () => matterSvc.deleteMatter(db, paralegal, matter.matter.id),
      /permission to delete/
    );
    const contact = clientsSvc.createClient(db, admin, { name: 'Temp Contact' });
    const deleted = clientsSvc.deleteClient(db, paralegal, contact.client.id);
    assert.equal(deleted.ok, true);
  });

  it('supports Hidden / Read / Read-Write field permissions', () => {
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
        'std:court': {
          admin: 'write', paralegal: 'hidden', attorney: 'read', billing_clerk: 'write',
        },
        [`cf:${field.id}`]: {
          admin: 'write', paralegal: 'read', attorney: 'write', billing_clerk: 'write',
        },
      },
    });

    const asAdmin = matterSvc.getMatter(db, created.matter.id, admin);
    const adminKeys = Object.values(asAdmin.sections).flat().map((f) => f.key);
    assert.ok(adminKeys.includes('std:court'));
    assert.ok(adminKeys.includes(`cf:${field.id}`));

    const asPara = matterSvc.getMatter(db, created.matter.id, paralegal);
    const paraFields = Object.values(asPara.sections).flat();
    const paraKeys = paraFields.map((f) => f.key);
    assert.ok(!paraKeys.includes('std:court'));
    assert.ok(paraKeys.includes(`cf:${field.id}`));
    assert.ok(paraFields.find((f) => f.key === `cf:${field.id}`).readonly);
    assert.ok(paraKeys.includes('std:name'));
    assert.equal(asPara.canEdit, true);

    assert.throws(() => matterSvc.updateMatter(db, paralegal, created.matter.id, {
      court: 'N.D. Cal.',
    }), /read only/i);
    assert.throws(() => matterSvc.updateMatter(db, paralegal, created.matter.id, {
      customValues: { [field.id]: 'Y' },
    }), /read only/i);
  });

  it('marks pages read-only when Modify All is off', () => {
    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: false, delete: false },
          contact: { viewAll: true, modifyAll: false, delete: false },
          time: { viewAll: true, modifyAll: false, delete: false },
        },
      },
    });
    const created = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'RO Matter',
      openedOn: '2026-04-01',
    });
    const page = matterSvc.getMatter(db, created.matter.id, paralegal);
    assert.equal(page.pageAccess, 'read_only');
    assert.equal(page.canEdit, false);
    assert.equal(page.canDelete, false);
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

  it('hides contact custom fields per role field permissions', () => {
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
        [`cf:${field.id}`]: {
          admin: 'write', paralegal: 'hidden', attorney: 'read', billing_clerk: 'write',
        },
      },
    });
    const asPara = clientsSvc.getClient(db, page.client.id, paralegal);
    assert.ok(!asPara.fields.some((f) => f.fieldId === field.id));
    const asAdmin = clientsSvc.getClient(db, page.client.id, admin);
    assert.ok(asAdmin.fields.some((f) => f.fieldId === field.id));
  });

  it('enforces View All and time delete permission', () => {
    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Billable work',
      openedOn: '2026-05-01',
    });
    const entry = timeSvc.createEntry(db, admin, {
      matterId: matter.matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-05-02',
      hours: 1,
      description: 'Research',
    });

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: false, modifyAll: false, delete: false },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: false },
        },
      },
    });
    assert.throws(
      () => matterSvc.getMatter(db, matter.matter.id, paralegal),
      /not viewable/i
    );
    assert.throws(
      () => timeSvc.deleteEntry(db, paralegal, entry.id),
      /permission to delete/
    );
    const removed = timeSvc.deleteEntry(db, admin, entry.id);
    assert.equal(removed.ok, true);
  });
});
