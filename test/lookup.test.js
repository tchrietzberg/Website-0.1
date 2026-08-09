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
const globalSearch = require('../src/services/globalSearch');

describe('global lookup and search permissions', () => {
  let db;
  let admin;
  let paralegal;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-lookup-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name, email) VALUES ('Acme Corp', 'ops@acme.example')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    paralegal = db.prepare('SELECT * FROM users WHERE id=2').get();
    customFields.ensureRecordTypes(db);
  });

  it('defaults search to on with viewAll and can disable per object', () => {
    const defaults = permissions.getRolePermissions(db);
    assert.equal(defaults.paralegal.objects.matter.search, true);
    assert.equal(permissions.canSearch(db, 'paralegal', 'matter'), true);

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, search: false, modifyAll: true, delete: true },
          contact: { viewAll: true, search: true, modifyAll: true, delete: true },
          time: { viewAll: true, search: true, modifyAll: true, delete: true },
          report: { viewAll: true, search: false, modifyAll: false, delete: false },
        },
      },
    });
    assert.equal(permissions.canSearch(db, 'paralegal', 'matter'), false);
    assert.equal(permissions.canViewAll(db, 'paralegal', 'matter'), true);
    assert.equal(permissions.canSearch(db, 'paralegal', 'contact'), true);
    assert.equal(permissions.canSearch(db, 'paralegal', 'report'), false);
  });

  it('lookup returns matters/contacts/time and respects search scopes', () => {
    const matter = matterSvc.createMatter(db, admin, {
      clientId: 1,
      name: 'Widget Litigation',
      openedOn: '2026-01-01',
      responsibleAttorneyId: 1,
    });
    clientsSvc.createClient(db, admin, {
      name: 'Widget Holdings',
      email: 'legal@widget.example',
      recordTypeKey: 'company',
    });
    timeSvc.createEntry(db, admin, {
      matterId: matter.matter.id,
      serviceDate: '2026-01-05',
      hours: 1.5,
      description: 'Reviewed widget production set',
      timekeeperId: admin.id,
    });

    const all = globalSearch.lookup(db, admin, { q: 'widget', limitPerType: 5 });
    assert.ok(all.scopes.matter);
    assert.ok(all.scopes.contact);
    assert.ok(all.results.some((r) => r.type === 'matter' && /Widget/i.test(r.title)));
    assert.ok(all.results.some((r) => r.type === 'contact' && /Widget/i.test(r.title)));
    assert.ok(all.results.some((r) => r.type === 'time' && /widget/i.test(r.title)));

    permissions.setRolePermissions(db, admin, {
      paralegal: {
        objects: {
          matter: { viewAll: true, search: true, modifyAll: true, delete: true },
          contact: { viewAll: true, search: false, modifyAll: true, delete: true },
          time: { viewAll: true, search: false, modifyAll: true, delete: true },
          report: { viewAll: true, search: false, modifyAll: false, delete: false },
        },
      },
    });
    const limited = globalSearch.lookup(db, paralegal, { q: 'widget', limitPerType: 5 });
    assert.equal(limited.scopes.matter, true);
    assert.equal(limited.scopes.contact, false);
    assert.equal(limited.scopes.time, false);
    assert.ok(limited.results.every((r) => r.type === 'matter'));
    assert.ok(limited.results.some((r) => r.type === 'matter'));
  });
});
