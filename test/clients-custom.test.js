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
    assert.equal(page.client.record_type, 'person');

    const updated = clientsSvc.updateClient(db, admin, page.client.id, {
      phone: '555-9999',
      customValues: { [field.id]: 'Phone' },
    });
    assert.equal(updated.client.phone, '555-9999');
    assert.equal(updated.customValues[field.id], 'Phone');

    const defs = customFields.listClientFieldDefs(db, { recordTypeKey: 'person' });
    assert.equal(defs.length, 1);
    assert.equal(defs[0].required, true);

    // Isolated from matter / time-entry fields
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'matter' }).length, 0);
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'time_entry' }).length, 0);
  });

  it('seeds Person and Company contact record types; fields depend on type', () => {
    const types = customFields.listRecordTypes(db, { appliesTo: 'client' });
    assert.ok(types.length >= 2);
    assert.equal(types[0].key, 'person');
    assert.equal(types[1].key, 'company');
    assert.ok(!customFields.listRecordTypes(db, { appliesTo: 'matter' })
      .some((t) => t.key === 'person'));

    const personField = customFields.createCustomField(db, admin, {
      label: 'Preferred name',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'person',
      required: true,
    });
    const companyField = customFields.createCustomField(db, admin, {
      label: 'Industry',
      fieldType: 'text',
      appliesTo: 'client',
      recordTypeKey: 'company',
      required: true,
    });
    assert.equal(personField.record_type_key, 'person');
    assert.equal(companyField.record_type_key, 'company');

    assert.throws(() => clientsSvc.createClient(db, admin, {
      name: 'Needs preferred',
      recordTypeKey: 'person',
    }), /Preferred name/);

    const person = clientsSvc.createClient(db, admin, {
      name: 'Alex Person',
      recordTypeKey: 'person',
      customValues: { [personField.id]: 'Alex' },
    });
    assert.equal(person.client.record_type, 'person');
    assert.ok(person.fields.some((f) => f.fieldId === personField.id));
    assert.ok(!person.fields.some((f) => f.fieldId === companyField.id));

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
    assert.ok(!company.fields.some((f) => f.fieldId === personField.id));

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

  it('blocks deleting contacts referenced by matters', () => {
    const page = clientsSvc.createClient(db, admin, { name: 'Linked Contact' });
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (?, 'M-1', 'Matter One', 'billable', date('now'), 'open')
    `).run(page.client.id);

    assert.throws(
      () => clientsSvc.deleteClient(db, admin, page.client.id),
      /matter/
    );
    assert.equal(clientsSvc.listClients(db).length, 1);
  });
});
