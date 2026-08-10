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

  it('title-cases role labels and supports adding custom roles', () => {
    const listed = permissions.listRoles(db);
    assert.equal(listed.find((r) => r.key === 'billing_clerk').label, 'Billing Clerk');
    const created = permissions.addCustomRole(db, admin, { label: 'intake specialist' });
    assert.equal(created.key, 'intake_specialist');
    assert.equal(created.label, 'Intake Specialist');
    assert.equal(permissions.isKnownRole(db, 'intake_specialist'), true);
    assert.equal(permissions.canViewAll(db, 'intake_specialist', 'matter'), true);
    assert.equal(permissions.canModifyAll(db, 'intake_specialist', 'matter'), false);
    assert.throws(
      () => permissions.addCustomRole(db, admin, { label: 'Intake Specialist' }),
      /already exists/
    );
  });

  it('defaults roles to full access and keeps admin locked on', () => {
    const defaults = permissions.getRolePermissions(db);
    assert.equal(defaults.paralegal.objects.matter.modifyAll, true);
    assert.equal(defaults.paralegal.objects.contact.delete, true);
    assert.equal(defaults.admin.objects.time.viewAll, true);
    assert.equal(defaults.paralegal.objects.time.selectTimekeeper, false);
    assert.equal(defaults.paralegal.objects.time.viewOthers, true);
    assert.equal(defaults.paralegal.objects.time.modifyOthers, false);
    assert.equal(defaults.billing_clerk.objects.time.selectTimekeeper, true);
    assert.equal(defaults.admin.objects.time.selectTimekeeper, true);
    assert.equal(defaults.admin.objects.time.modifyOthers, true);
    assert.equal(defaults.admin.addUsers, true);
    assert.equal(defaults.paralegal.addUsers, false);
    assert.equal(defaults.attorney.addUsers, false);
    assert.equal(defaults.billing_clerk.addUsers, false);
    assert.equal(permissions.canAddUsers(db, 'admin'), true);
    assert.equal(permissions.canAddUsers(db, 'paralegal'), false);

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

  it('allows granting Add users to non-admin roles; admin stays on', () => {
    assert.equal(permissions.canAddUsers(db, 'billing_clerk'), false);
    permissions.setRolePermissions(db, admin, {
      billing_clerk: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: true, delete: true },
        },
        addUsers: true,
      },
      admin: { addUsers: false },
    });
    assert.equal(permissions.canAddUsers(db, 'billing_clerk'), true);
    assert.equal(permissions.canAddUsers(db, 'admin'), true);
    assert.doesNotThrow(() => permissions.assertCanAddUsers(db, {
      id: 99, role: 'billing_clerk',
    }));
    assert.throws(
      () => permissions.assertCanAddUsers(db, paralegal),
      (err) => err && err.code === 'FORBIDDEN'
    );
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

  it('includes type-scoped contact custom fields in field permissions catalog', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Email',
      fieldType: 'email',
      appliesTo: 'client',
      recordTypeKey: 'client',
    });
    const catalog = permissions.catalogContactLayoutFields(db);
    assert.ok(
      catalog.some((f) => f.key === `cf:${field.id}` && f.label === 'Email'),
      'Settings → Contact page fields must appear under Field permissions → Contact fields'
    );
    const settings = permissions.getPermissionsSettings(db);
    assert.ok(settings.contactFields.some((f) => f.key === `cf:${field.id}`));
  });

  it('scopes field permission catalogs to the selected record page', () => {
    const billableOnly = customFields.createCustomField(db, admin, {
      label: 'Fee arrangement',
      fieldType: 'text',
      recordTypeKey: 'billable',
    });
    const nonBillableOnly = customFields.createCustomField(db, admin, {
      label: 'Pro bono reason',
      fieldType: 'textarea',
      recordTypeKey: 'non_billable',
    });
    const clientEmail = customFields.createCustomField(db, admin, {
      label: 'Work email',
      fieldType: 'email',
      appliesTo: 'client',
      recordTypeKey: 'client',
    });
    const companyIndustry = customFields.createCustomField(db, admin, {
      label: 'Industry',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'company',
    });

    const billableFields = permissions.catalogMatterLayoutFields(db, { recordTypeKey: 'billable' });
    assert.ok(billableFields.some((f) => f.key === `cf:${billableOnly.id}`));
    assert.ok(!billableFields.some((f) => f.key === `cf:${nonBillableOnly.id}`));
    assert.ok(billableFields.some((f) => f.key === 'std:name'));

    const nbFields = permissions.catalogMatterLayoutFields(db, { recordTypeKey: 'non_billable' });
    assert.ok(nbFields.some((f) => f.key === `cf:${nonBillableOnly.id}`));
    assert.ok(!nbFields.some((f) => f.key === `cf:${billableOnly.id}`));

    const clientFields = permissions.catalogContactLayoutFields(db, { recordTypeKey: 'client' });
    assert.ok(clientFields.some((f) => f.key === 'name'));
    assert.ok(clientFields.some((f) => f.key === `cf:${clientEmail.id}`));
    assert.ok(!clientFields.some((f) => f.key === `cf:${companyIndustry.id}`));

    const companyFields = permissions.catalogContactLayoutFields(db, { recordTypeKey: 'company' });
    assert.ok(companyFields.some((f) => f.key === `cf:${companyIndustry.id}`));
    assert.ok(!companyFields.some((f) => f.key === `cf:${clientEmail.id}`));

    const settings = permissions.getPermissionsSettings(db);
    const billablePage = settings.matterRecordTypes.find((t) => t.key === 'billable');
    assert.ok(billablePage?.fields.some((f) => f.key === `cf:${billableOnly.id}`));
    const clientPage = settings.contactRecordTypes.find((t) => t.key === 'client');
    assert.ok(clientPage?.fields.some((f) => f.key === `cf:${clientEmail.id}`));
  });

  it('includes time entry fields in field permissions catalog and enforces writes', () => {
    const settings = permissions.getPermissionsSettings(db);
    assert.ok(settings.timeFields.some((f) => f.key === 'std:billable'));
    assert.ok(settings.timeFields.some((f) => f.key === 'std:hours'));
    assert.ok(Object.prototype.hasOwnProperty.call(settings.fieldPermissions, 'time'));

    const field = customFields.createCustomField(db, admin, {
      label: 'Phase code',
      fieldType: 'text',
      appliesTo: 'time_entry',
    });
    assert.ok(permissions.catalogTimeLayoutFields(db).some((f) => f.key === `cf:${field.id}`));

    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Time perms',
      openedOn: '2026-07-01',
    });
    permissions.setRecordPageLayout(db, admin, {
      time: {
        'std:billable': {
          admin: 'write', paralegal: 'read', attorney: 'write', billing_clerk: 'write',
        },
        [`cf:${field.id}`]: {
          admin: 'write', paralegal: 'hidden', attorney: 'write', billing_clerk: 'write',
        },
      },
    });

    const entry = timeSvc.createEntry(db, paralegal, {
      matterId: matter.matter.id,
      timekeeperId: paralegal.id,
      serviceDate: '2026-07-02',
      hours: 1,
      description: 'Draft',
    });

    assert.throws(() => timeSvc.updateEntry(db, paralegal, entry.id, {
      billable: 0,
    }), /read only/i);
    assert.throws(() => timeSvc.createEntry(db, paralegal, {
      matterId: matter.matter.id,
      timekeeperId: paralegal.id,
      serviceDate: '2026-07-03',
      hours: 1,
      description: 'With hidden field',
      customValues: { [field.id]: 'B' },
    }), /read only/i);
    assert.doesNotThrow(() => timeSvc.updateEntry(db, paralegal, entry.id, {
      description: 'Updated draft',
    }));
    assert.equal(permissions.getFieldAccess(db, 'time', 'paralegal', 'std:hours'), 'write');
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
          report: { viewAll: true, modifyAll: false, delete: false },
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

  it('includes Reports in role object permissions', () => {
    const settings = permissions.getPermissionsSettings(db);
    assert.ok(settings.objects.some((o) => o.key === 'report' && o.label === 'Reports'));
    assert.equal(settings.rolePermissions.paralegal.objects.report.viewAll, true);
    assert.equal(settings.rolePermissions.paralegal.objects.report.modifyAll, true);
    assert.equal(settings.rolePermissions.paralegal.objects.report.delete, true);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: { viewAll: true, modifyAll: true, delete: true },
          report: { viewAll: true, modifyAll: false, delete: false },
        },
      },
    });
    assert.equal(permissions.canViewAll(db, 'paralegal', 'report'), true);
    assert.equal(permissions.canModifyAll(db, 'paralegal', 'report'), false);
    assert.equal(permissions.canDelete(db, 'paralegal', 'report'), false);
    assert.equal(permissions.canModifyAll(db, 'admin', 'report'), true);
    assert.equal(permissions.canDelete(db, 'admin', 'report'), true);
  });

  it('enforces timekeeper select / view / edit / delete others permissions', () => {
    db.prepare("INSERT INTO users(email,name,role) VALUES ('clerk@x.com','Clerk','billing_clerk')").run();
    const clerk = db.prepare('SELECT * FROM users WHERE id=3').get();
    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'TK Matter',
      openedOn: '2026-06-01',
    });

    const adminEntry = timeSvc.createEntry(db, admin, {
      matterId: matter.matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-06-02',
      hours: 1,
      description: 'Admin work',
    });

    assert.throws(() => timeSvc.createEntry(db, paralegal, {
      matterId: matter.matter.id,
      timekeeperId: admin.id,
      serviceDate: '2026-06-03',
      hours: 1,
      description: 'Proxy denied',
    }), /yourself/i);

    const paraEntry = timeSvc.createEntry(db, paralegal, {
      matterId: matter.matter.id,
      timekeeperId: paralegal.id,
      serviceDate: '2026-06-03',
      hours: 0.5,
      description: 'Own work',
    });

    let listed = timeSvc.listEntries(db, { matterId: matter.matter.id }, paralegal);
    assert.equal(listed.length, 2);
    const other = listed.find((r) => r.id === adminEntry.id);
    assert.equal(other.timekeeper_name, null);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: {
            viewAll: true,
            modifyAll: true,
            delete: true,
            selectTimekeeper: false,
            viewOthers: false,
            modifyOthers: false,
            deleteOthers: false,
          },
          report: { viewAll: true, modifyAll: true, delete: true },
        },
      },
    });
    listed = timeSvc.listEntries(db, { matterId: matter.matter.id }, paralegal);
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, paraEntry.id);

    assert.throws(
      () => timeSvc.updateEntry(db, paralegal, adminEntry.id, { description: 'nope' }),
      /own time entries/i
    );
    assert.throws(
      () => timeSvc.deleteEntry(db, paralegal, adminEntry.id),
      /own time entries/i
    );

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, modifyAll: true, delete: true },
          contact: { viewAll: true, modifyAll: true, delete: true },
          time: {
            viewAll: true,
            modifyAll: true,
            delete: true,
            selectTimekeeper: true,
            viewOthers: true,
            modifyOthers: true,
            deleteOthers: true,
          },
          report: { viewAll: true, modifyAll: true, delete: true },
        },
      },
    });
    const proxied = timeSvc.createEntry(db, paralegal, {
      matterId: matter.matter.id,
      timekeeperId: clerk.id,
      serviceDate: '2026-06-04',
      hours: 0.25,
      description: 'For clerk',
    });
    assert.equal(proxied.timekeeperId, clerk.id);
    const updated = timeSvc.updateEntry(db, paralegal, adminEntry.id, {
      description: 'Edited by para',
    });
    assert.equal(updated.description, 'Edited by para');
    const removed = timeSvc.deleteEntry(db, paralegal, adminEntry.id);
    assert.equal(removed.ok, true);
  });
});
