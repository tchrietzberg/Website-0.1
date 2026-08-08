const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const usersSvc = require('../src/services/users');
const ratesAdmin = require('../src/services/ratesAdmin');
const { resolveRate } = require('../src/rates');

describe('timekeepers and effective-dated rates', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-users-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  it('admin can add a timekeeper with a default rate', () => {
    const user = usersSvc.createUser(db, admin, {
      email: 'alex@firm.example',
      name: 'Alex Associate',
      role: 'attorney',
    });
    ratesAdmin.addRate(db, admin, {
      scope: 'timekeeper',
      scopeId: user.id,
      amountCents: 35000,
      effectiveDate: '2026-01-01',
    });
    const rate = resolveRate(db, {
      matterId: null,
      clientId: null,
      timekeeperId: user.id,
      serviceDate: '2026-03-01',
    });
    assert.equal(rate.amountCents, 35000);
  });

  it('later effective-dated rate wins for later service dates only', () => {
    const user = usersSvc.createUser(db, admin, {
      email: 'alex@firm.example',
      name: 'Alex',
      role: 'attorney',
    });
    ratesAdmin.addRate(db, admin, {
      scope: 'timekeeper', scopeId: user.id, amountCents: 30000, effectiveDate: '2026-01-01',
    });
    ratesAdmin.addRate(db, admin, {
      scope: 'timekeeper', scopeId: user.id, amountCents: 40000, effectiveDate: '2026-06-01',
    });
    assert.equal(resolveRate(db, {
      matterId: null, clientId: null, timekeeperId: user.id, serviceDate: '2026-05-01',
    }).amountCents, 30000);
    assert.equal(resolveRate(db, {
      matterId: null, clientId: null, timekeeperId: user.id, serviceDate: '2026-06-15',
    }).amountCents, 40000);
  });
});
