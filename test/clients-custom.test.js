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

  it('lets firms select optional default contact fields', () => {
    let config = clientsSvc.getContactFieldConfig(db);
    assert.deepEqual(config.enabledKeys, []);
    assert.equal(config.availableStandard.length, 4);
    assert.ok(config.core.some((f) => f.key === 'name'));

    config = clientsSvc.setEnabledContactStandardKeys(db, admin, ['email', 'company', 'bogus']);
    assert.deepEqual(config.enabledKeys, ['company', 'email']);
    assert.equal(config.enabledStandard.length, 2);
    assert.equal(config.availableStandard.length, 2);
    assert.ok(config.availableStandard.some((f) => f.key === 'phone'));

    config = clientsSvc.setEnabledContactStandardKeys(db, admin, []);
    assert.deepEqual(config.enabledKeys, []);
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

    const updated = clientsSvc.updateClient(db, admin, page.client.id, {
      phone: '555-9999',
      customValues: { [field.id]: 'Phone' },
    });
    assert.equal(updated.client.phone, '555-9999');
    assert.equal(updated.customValues[field.id], 'Phone');

    const defs = customFields.listClientFieldDefs(db);
    assert.equal(defs.length, 1);
    assert.equal(defs[0].required, true);

    // Isolated from matter / time-entry fields
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'matter' }).length, 0);
    assert.equal(customFields.listCustomFields(db, { appliesTo: 'time_entry' }).length, 0);
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
