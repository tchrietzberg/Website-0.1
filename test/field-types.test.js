const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const customFields = require('../src/services/customFields');
const fieldTypes = require('../src/services/fieldTypes');
const matters = require('../src/services/matters');
const clients = require('../src/services/clients');

describe('expanded custom field types', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-field-types-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO clients(name, record_type) VALUES ('Acme', 'company')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    customFields.ensureRecordTypes(db);
  });

  it('accepts all supported field types except relationship types', () => {
    for (const type of fieldTypes.ALLOWED_FIELD_TYPES) {
      const input = {
        label: `Field ${type}`,
        fieldType: type,
        recordTypeKey: 'billable',
      };
      if (type === 'select' || type === 'multiselect') input.options = ['A', 'B'];
      if (type === 'formula') input.expression = '{Amount} + 1';
      if (type === 'auto_number') {
        input.prefix = 'MAT-';
        input.pad = 3;
      }
      const created = customFields.createCustomField(db, admin, input);
      assert.ok(created.id, type);
      assert.equal(
        fieldTypes.normalizeFieldType(created.field_type),
        fieldTypes.normalizeFieldType(type === 'select' ? 'dropdown' : type)
      );
    }
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Bad',
      fieldType: 'lookup',
      recordTypeKey: 'billable',
    }), /invalid fieldType/);
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Bad',
      fieldType: 'master_detail',
      recordTypeKey: 'billable',
    }), /invalid fieldType/);
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Bad',
      fieldType: 'rollup',
      recordTypeKey: 'billable',
    }), /invalid fieldType/);
  });

  it('auto-numbers matters and validates email/url/currency', () => {
    const auto = customFields.createCustomField(db, admin, {
      label: 'Matter code',
      fieldType: 'auto_number',
      recordTypeKey: 'billable',
      prefix: 'AN-',
      pad: 4,
    });
    const email = customFields.createCustomField(db, admin, {
      label: 'Notice email',
      fieldType: 'email',
      recordTypeKey: 'billable',
      required: true,
    });
    const amount = customFields.createCustomField(db, admin, {
      label: 'Retainer',
      fieldType: 'currency',
      recordTypeKey: 'billable',
    });
    const multi = customFields.createCustomField(db, admin, {
      label: 'Tags',
      fieldType: 'multiselect',
      recordTypeKey: 'billable',
      options: ['A', 'B', 'C'],
    });

    const page = matters.createMatter(db, admin, {
      name: 'Field Types Matter',
      recordTypeKey: 'billable',
      clientId: 1,
      customValues: {
        [email.id]: 'ops@firm.example',
        [amount.id]: '$1,250.50',
        [multi.id]: JSON.stringify(['A', 'C']),
      },
    });
    const fields = Object.values(page.sections || {}).flat();
    assert.equal(fields.find((f) => f.fieldId === auto.id)?.value, 'AN-0001');
    assert.equal(fields.find((f) => f.fieldId === email.id)?.value, 'ops@firm.example');
    assert.equal(fields.find((f) => f.fieldId === amount.id)?.value, '1250.5');
    assert.equal(fields.find((f) => f.fieldId === multi.id)?.value, JSON.stringify(['A', 'C']));

    assert.throws(() => matters.updateMatter(db, admin, page.matter.id, {
      customValues: { [email.id]: 'not-an-email' },
    }), /valid email/);
  });

  it('evaluates formula fields from sibling values', () => {
    const qty = customFields.createCustomField(db, admin, {
      label: 'Quantity',
      fieldType: 'number',
      recordTypeKey: 'billable',
    });
    const rate = customFields.createCustomField(db, admin, {
      label: 'Rate',
      fieldType: 'currency',
      recordTypeKey: 'billable',
    });
    const total = customFields.createCustomField(db, admin, {
      label: 'Line total',
      fieldType: 'formula',
      recordTypeKey: 'billable',
      expression: '{Quantity} * {Rate}',
    });
    const page = matters.createMatter(db, admin, {
      name: 'Formula Matter',
      recordTypeKey: 'billable',
      clientId: 1,
      customValues: {
        [qty.id]: '3',
        [rate.id]: '100',
      },
    });
    const fields = Object.values(page.sections || {}).flat();
    assert.equal(fields.find((f) => f.fieldId === total.id)?.value, '300');
    assert.equal(fields.find((f) => f.fieldId === total.id)?.readonly, true);
  });

  it('limits time-entry custom fields to practical types', () => {
    const ok = customFields.createCustomField(db, admin, {
      label: 'Activity code',
      fieldType: 'text',
      appliesTo: 'time_entry',
    });
    assert.equal(ok.appliesTo, 'time_entry');
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Bad formula',
      fieldType: 'formula',
      appliesTo: 'time_entry',
      expression: '{x} + 1',
    }), /not available for time entry/i);
    assert.throws(() => customFields.createCustomField(db, admin, {
      label: 'Bad geo',
      fieldType: 'geolocation',
      appliesTo: 'time_entry',
    }), /not available for time entry/i);
    assert.ok(fieldTypes.TIME_ENTRY_FIELD_TYPES.includes('select'));
    assert.ok(!fieldTypes.TIME_ENTRY_FIELD_TYPES.includes('formula'));
  });

  it('stores geolocation and phone on contacts', () => {
    const geo = customFields.createCustomField(db, admin, {
      label: 'Office coords',
      fieldType: 'geolocation',
      recordTypeKey: 'company',
      appliesTo: 'client',
    });
    const phone = customFields.createCustomField(db, admin, {
      label: 'Desk phone',
      fieldType: 'phone',
      recordTypeKey: 'company',
      appliesTo: 'client',
    });
    const page = clients.createClient(db, admin, {
      name: 'Geo Co',
      recordTypeKey: 'company',
      customValues: {
        [geo.id]: '37.77,-122.42',
        [phone.id]: '(415) 555-0100 ext 9',
      },
    });
    const values = Object.fromEntries(
      customFields.getClientCustomValues(db, page.client.id)
        .map((v) => [v.field_id, v.value_text])
    );
    assert.equal(values[geo.id], '37.77,-122.42');
    assert.match(values[phone.id], /415/);
  });
});
