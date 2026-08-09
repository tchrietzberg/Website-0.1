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
});
