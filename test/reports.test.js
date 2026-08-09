const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const timeSvc = require('../src/services/time');
const reports = require('../src/services/reports');

describe('matters report', () => {
  let db;
  let admin;
  let para;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-reports-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on, status)
      VALUES (1, '2026-0001', 'Alpha Matter', 'default', 'S.D.N.Y.', 1, '2026-01-15', 'open')
    `).run();
    db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, opened_on, status)
      VALUES (1, '2026-0002', 'Beta Matter', 'default', '2026-02-01', 'closed')
    `).run();
    db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',2,20000,'2020-01-01')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
    para = db.prepare('SELECT * FROM users WHERE id=2').get();
  });

  it('lists matters with client, status, attorney, and time totals', () => {
    const entry = timeSvc.createEntry(db, para, {
      matterId: 1,
      timekeeperId: 2,
      serviceDate: '2026-03-01',
      rawMinutes: 60,
      description: 'Research',
    });
    timeSvc.submitEntry(db, para, entry.id);
    timeSvc.approveEntry(db, admin, entry.id);

    const rows = reports.mattersReport(db);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].matter_number, '2026-0002');
    assert.equal(rows[1].matter_number, '2026-0001');
    assert.equal(rows[1].matter_name, 'Alpha Matter');
    assert.equal(rows[1].client_name, 'Client A');
    assert.equal(rows[1].status, 'open');
    assert.equal(rows[1].attorney_name, 'Admin');
    assert.equal(rows[1].time_entry_count, 1);
    assert.equal(rows[1].billable_minutes, 60);
    assert.equal(rows[1].billable_hours, 1);
    assert.equal(rows[1].approved_minutes, 60);
    assert.equal(rows[0].time_entry_count, 0);
    assert.equal(rows[0].status, 'closed');
  });
});
