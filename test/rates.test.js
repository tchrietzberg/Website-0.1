const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const { resolveRate } = require('../src/rates');

describe('rate resolution', () => {
  let db;
  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-rates-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('t@x.com','T','attorney')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('C')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, responsible_attorney_id)
      VALUES (1, '2026-0001', 'M', 'billable', '2026-01-01', 1)
    `).run();
  });

  it('uses matter → client → timekeeper precedence', () => {
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',1,10000,'2020-01-01')").run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('client',1,20000,'2020-01-01')").run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('matter',1,30000,'2020-01-01')").run();
    const r = resolveRate(db, { matterId: 1, clientId: 1, timekeeperId: 1, serviceDate: '2026-03-01' });
    assert.equal(r.amountCents, 30000);
    assert.equal(r.scope, 'matter');
  });

  it('falls back when higher scopes missing', () => {
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',1,10000,'2020-01-01')").run();
    const r = resolveRate(db, { matterId: 1, clientId: 1, timekeeperId: 1, serviceDate: '2026-03-01' });
    assert.equal(r.amountCents, 10000);
    assert.equal(r.scope, 'timekeeper');
  });

  it('honors effective dating and same-date newest-wins', () => {
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date,created_at) VALUES ('matter',1,10000,'2026-01-01','2026-01-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date,created_at) VALUES ('matter',1,20000,'2026-06-01','2026-06-01T00:00:00.000Z')").run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date,created_at) VALUES ('matter',1,25000,'2026-06-01','2026-06-01T12:00:00.000Z')").run();

    assert.equal(
      resolveRate(db, { matterId: 1, clientId: 1, timekeeperId: 1, serviceDate: '2026-05-01' }).amountCents,
      10000
    );
    assert.equal(
      resolveRate(db, { matterId: 1, clientId: 1, timekeeperId: 1, serviceDate: '2026-06-01' }).amountCents,
      25000
    );
  });

  it('ignores future-dated rates', () => {
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('matter',1,99999,'2099-01-01')").run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',1,10000,'2020-01-01')").run();
    const r = resolveRate(db, { matterId: 1, clientId: 1, timekeeperId: 1, serviceDate: '2026-03-01' });
    assert.equal(r.amountCents, 10000);
  });
});
