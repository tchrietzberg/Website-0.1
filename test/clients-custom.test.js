const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const customFields = require('../src/services/customFields');
const clientsSvc = require('../src/services/clients');

describe('contacts and contact custom fields', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-clients-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  it('creates contacts with core fields and lists/search', () => {
    const page = clientsSvc.createClient(db, admin, {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
      phone: '555-0100',
      company: 'Lee LLP',
      notes: 'Referral',
    });
    assert.equal(page.client.name, 'Jordan Lee');
    assert.equal(page.client.email, 'jordan@example.com');
    assert.equal(page.client.company, 'Lee LLP');

    clientsSvc.createClient(db, admin, { name: 'Acme Corp', company: 'Acme' });
    assert.equal(clientsSvc.listClients(db).length, 2);
    assert.equal(clientsSvc.listClients(db, { q: 'jordan' }).length, 1);
    assert.equal(clientsSvc.listClients(db, { q: 'acme' }).length, 1);
  });

  it('rejects duplicate contact names and emails', () => {
    clientsSvc.createClient(db, admin, {
      name: 'Jordan Lee',
      email: 'jordan@example.com',
    });
    assert.throws(
      () => clientsSvc.createClient(db, admin, { name: 'jordan lee' }),
      /already exists/i
    );
    assert.throws(
      () => clientsSvc.createClient(db, admin, {
        name: 'Someone Else',
        email: 'Jordan@Example.com',
      }),
      /email/i
    );
    const other = clientsSvc.createClient(db, admin, { name: 'Pat Kim' });
    assert.throws(
      () => clientsSvc.updateClient(db, admin, other.client.id, { name: 'JORDAN LEE' }),
      /already exists/i
    );
  });

  it('has name as the only built-in contact field', () => {
    let config = clientsSvc.getContactFieldConfig(db);
    assert.deepEqual(config.enabledKeys, []);
    assert.deepEqual(config.availableStandard, []);
    assert.deepEqual(config.enabledStandard, []);
    assert.equal(config.core.length, 1);
    assert.equal(config.core[0].key, 'name');

    // Legacy keys are ignored now that company/email/phone/notes are not default fields.
    config = clientsSvc.setEnabledContactStandardKeys(db, admin, ['email', 'company', 'phone', 'notes']);
    assert.deepEqual(config.enabledKeys, []);
    assert.deepEqual(config.availableStandard, []);
  });

  it('supports default-field flag on contact custom fields', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Referral source',
      fieldType: 'text',
      appliesTo: 'client',
      isDefault: true,
    });
    assert.equal(field.isDefault, true);
    const updated = customFields.updateCustomField(db, admin, field.id, { isDefault: false });
    assert.equal(updated.isDefault, false);
  });

  it('supports required contact custom fields and updates', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Preferred contact method',
      fieldType: 'dropdown',
      options: ['Email', 'Phone', 'Mail'],
      appliesTo: 'client',
      required: true,
    });
    assert.equal(field.appliesTo, 'client');
    assert.equal(field.required, 1);

    assert.throws(() => clientsSvc.createClient(db, admin, {
      name: 'No Method',
    }), /Preferred contact method/);

    const page = clientsSvc.createClient(db, admin, {
      name: 'Has Method',
      customValues: { [field.id]: 'Email' },
    });
    assert.equal(page.customValues[field.id], 'Email');
    assert.ok(page.fields.some((f) => f.fieldId === field.id && f.required));
    assert.equal(page.client.record_type, 'client');

    const updated = clientsSvc.updateClient(db, admin, page.client.id, {
      phone: '555-9999',
      customValues: { [field.id]: 'Phone' },
    });
    assert.equal(updated.client.phone, '555-9999');
    assert.equal(updated.customValues[field.id], 'Phone');

    const defs = customFields.listClientFieldDefs(db, { recordTypeKey: 'client' });
    assert.equal(defs.length, 1);
    assert.equal(defs[0].required, true);

    // Isolated from matter / time-entry fields
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'matter' }).length, 0);
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'time_entry' }).length, 0);
  });

  it('seeds Client and Company contact record types; fields depend on type', () => {
    const types = customFields.listRecordTypes(db, { appliesTo: 'client' });
    assert.ok(types.length >= 2);
    assert.equal(types[0].key, 'client');
    assert.equal(types[0].label, 'Client');
    assert.equal(types[1].key, 'company');
    assert.ok(!customFields.listRecordTypes(db, { appliesTo: 'matter' })
      .some((t) => t.key === 'client'));

    const clientField = customFields.createCustomField(db, admin, {
      label: 'Preferred name',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'client',
      required: true,
    });
    const companyField = customFields.createCustomField(db, admin, {
      label: 'Industry',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'company',
      required: true,
    });
    assert.equal(clientField.record_type_key, 'client');
    assert.equal(companyField.record_type_key, 'company');

    assert.throws(() => clientsSvc.createClient(db, admin, {
      name: 'Needs preferred',
      recordTypeKey: 'client',
    }), /Preferred name/);

    const clientContact = clientsSvc.createClient(db, admin, {
      name: 'Alex Client',
      recordTypeKey: 'client',
      customValues: { [clientField.id]: 'Alex' },
    });
    assert.equal(clientContact.client.record_type, 'client');
    assert.ok(clientContact.fields.some((f) => f.fieldId === clientField.id));
    assert.ok(!clientContact.fields.some((f) => f.fieldId === companyField.id));

    assert.throws(() => clientsSvc.createClient(db, admin, {
      name: 'Needs industry',
      recordTypeKey: 'company',
    }), /Industry/);

    const company = clientsSvc.createClient(db, admin, {
      name: 'Acme Inc',
      recordTypeKey: 'company',
      customValues: { [companyField.id]: 'Software' },
    });
    assert.equal(company.client.record_type, 'company');
    assert.ok(company.fields.some((f) => f.fieldId === companyField.id));
    assert.ok(!company.fields.some((f) => f.fieldId === clientField.id));

    const createdType = customFields.createRecordType(db, admin, {
      label: 'Vendor',
      appliesTo: 'client',
    });
    assert.equal(createdType.key, 'vendor');
    assert.equal(createdType.applies_to, 'client');
    const layout = customFields.getTypeLayout(db, 'vendor');
    assert.equal(layout.appliesTo, 'client');
    assert.ok(layout.fields.some((f) => f.fieldKey === 'std:name' && f.label === 'Name'));
  });

  it('deletes contacts that have no matters or payments', () => {
    const field = customFields.createCustomField(db, admin, {
      label: 'Source',
      fieldType: 'text',
      appliesTo: 'client',
    });
    const page = clientsSvc.createClient(db, admin, {
      name: 'Temp Contact',
      email: 'temp@example.com',
      customValues: { [field.id]: 'Web' },
    });
    const result = clientsSvc.deleteClient(db, admin, page.client.id);
    assert.equal(result.ok, true);
    assert.equal(result.name, 'Temp Contact');
    assert.equal(clientsSvc.listClients(db).length, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS n FROM client_custom_field_values').get().n,
      0
    );
  });

  it('unlinks matters when deleting a referenced contact', () => {
    const page = clientsSvc.createClient(db, admin, { name: 'Linked Contact' });
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (?, 'M-1', 'Matter One', 'billable', date('now'), 'open')
    `).run(page.client.id);

    const result = clientsSvc.deleteClient(db, admin, page.client.id);
    assert.equal(result.ok, true);
    assert.equal(result.unlinkedMatters, 1);
    assert.equal(clientsSvc.listClients(db).length, 0);
    const matter = db.prepare("SELECT client_id, name FROM matters WHERE number = 'M-1'").get();
    assert.equal(matter.client_id, null);
    assert.equal(matter.name, 'Matter One');
  });

  it('blocks contact delete without Delete permission', () => {
    const permissions = require('../src/services/permissions');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    const paralegal = db.prepare("SELECT * FROM users WHERE email = 'para@x.com'").get();
    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          contact: { viewAll: true, modifyAll: true, delete: false },
        },
      },
    });
    const page = clientsSvc.createClient(db, admin, { name: 'Keep Me' });
    assert.throws(
      () => clientsSvc.deleteClient(db, paralegal, page.client.id),
      /permission to delete/i
    );
    assert.equal(clientsSvc.listClients(db).length, 1);
  });

  it('supports type-based and contact-only custom fields', () => {
    const typeField = customFields.createCustomField(db, admin, {
      label: 'Preferred name',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'client',
      isDefault: true,
    });
    assert.equal(typeField.scope, 'record_type');
    assert.equal(typeField.isDefault, true);

    const clientContact = clientsSvc.createClient(db, admin, {
      name: 'Sam Contact',
      recordTypeKey: 'client',
      customValues: { [typeField.id]: 'Sammy' },
    });
    const other = clientsSvc.createClient(db, admin, {
      name: 'Other Person',
      recordTypeKey: 'client',
      customValues: { [typeField.id]: 'O' },
    });

    const contactField = customFields.createCustomField(db, admin, {
      label: 'Private note',
      fieldType: 'textarea',
      appliesTo: 'client',
      clientId: clientContact.client.id,
    });
    assert.equal(contactField.scope, 'record');
    assert.equal(contactField.clientId, clientContact.client.id);
    assert.equal(contactField.isDefault, false);
    assert.equal(contactField.record_type_key, null);

    clientsSvc.updateClient(db, admin, clientContact.client.id, {
      customValues: { [contactField.id]: 'Only on Sam' },
    });

    const samPage = clientsSvc.getClient(db, clientContact.client.id, admin);
    assert.ok(samPage.fields.some((f) => f.fieldId === typeField.id && f.scope === 'record_type'));
    assert.ok(samPage.fields.some((f) => f.fieldId === contactField.id && f.scope === 'record'));
    assert.equal(samPage.customValues[contactField.id], 'Only on Sam');

    const otherPage = clientsSvc.getClient(db, other.client.id, admin);
    assert.ok(otherPage.fields.some((f) => f.fieldId === typeField.id));
    assert.ok(!otherPage.fields.some((f) => f.fieldId === contactField.id));

    // Values for another contact's field are ignored
    clientsSvc.updateClient(db, admin, other.client.id, {
      customValues: { [contactField.id]: 'Should not stick' },
    });
    assert.equal(
      clientsSvc.getClient(db, other.client.id, admin).customValues[contactField.id],
      undefined
    );

    // Type list (Settings) does not include contact-only fields
    const typeOnly = customFields.listCustomFields(db, {
      appliesTo: 'client',
      recordTypeKey: 'client',
    });
    assert.ok(typeOnly.some((f) => f.id === typeField.id));
    assert.ok(!typeOnly.some((f) => f.id === contactField.id));
  });
});
