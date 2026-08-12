const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const timeSvc = require('../src/services/time');
const matterSvc = require('../src/services/matters');

function setup() {
  const db = resetDb(path.join(os.tmpdir(), `placeholder-${process.pid}-${Date.now()}-${Math.random()}.db`));
  setSetting(db, 'round_increment_minutes', '15');
  setSetting(db, 'round_mode', 'up');
  db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('atty@x.com','Atty','attorney')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('para@x.com','Para','paralegal')").run();
  db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0001', 'RT Client Test 978b - Open - 2026', 'billable', 'N.D. Cal.', 2, '2026-01-01')
  `).run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, court, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0002', 'Keep Me', 'billable', 'S.D.N.Y.', 2, '2026-01-01')
  `).run();
  db.prepare("INSERT INTO rates(scope,scope_id,amount_cents,effective_date) VALUES ('timekeeper',3,17500,'2020-01-01')").run();
  return {
    db,
    admin: db.prepare('SELECT * FROM users WHERE id=1').get(),
    atty: db.prepare('SELECT * FROM users WHERE id=2').get(),
    para: db.prepare('SELECT * FROM users WHERE id=3').get(),
  };
}

describe('placeholder time park and transfer', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('explains that time entries must be transferred when delete is blocked', () => {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'research',
    });
    assert.throws(
      () => matterSvc.deleteMatter(ctx.db, ctx.admin, 1),
      /Time entries must be transferred to another matter/
    );
  });

  it('parks unbilled time so the matter can be deleted, then transfers from Placeholder', () => {
    const entry = timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 30, description: 'draft',
    });
    const parked = timeSvc.parkMatterTime(ctx.db, ctx.admin, 1);
    assert.equal(parked.parked, 1);
    assert.equal(parked.remainingOnMatter, 0);

    matterSvc.deleteMatter(ctx.db, ctx.admin, 1);
    assert.equal(ctx.db.prepare('SELECT id FROM matters WHERE id = 1').get(), undefined);

    const listed = timeSvc.listPlaceholderEntries(ctx.db, ctx.admin);
    assert.equal(listed.entries.length, 1);
    assert.equal(listed.entries[0].id, entry.id);

    const matters = matterSvc.listMatters(ctx.db);
    assert.ok(!matters.some((m) => m.id === listed.matterId), 'placeholder hidden from matter list');

    const transferred = timeSvc.transferEntriesToMatter(ctx.db, ctx.admin, {
      entryIds: [entry.id],
      matterId: 2,
    });
    assert.equal(transferred.transferred, 1);
    assert.equal(
      ctx.db.prepare('SELECT matter_id FROM time_entries WHERE id = ?').get(entry.id).matter_id,
      2
    );
  });

  it('rejects parking and transfer for non-admins', () => {
    timeSvc.createEntry(ctx.db, ctx.para, {
      matterId: 1, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'x',
    });
    assert.throws(() => timeSvc.parkMatterTime(ctx.db, ctx.para, 1), /Only admins/);
    const placeholderId = timeSvc.ensurePlaceholderMatter(ctx.db, ctx.admin);
    ctx.db.prepare('UPDATE time_entries SET matter_id = ? WHERE matter_id = 1').run(placeholderId);
    assert.throws(
      () => timeSvc.transferEntriesToMatter(ctx.db, ctx.atty, { entryIds: [1], matterId: 2 }),
      /Only admins/
    );
  });

  it('blocks logging new time directly on Placeholder', () => {
    const placeholderId = timeSvc.ensurePlaceholderMatter(ctx.db, ctx.admin);
    assert.throws(
      () => timeSvc.createEntry(ctx.db, ctx.para, {
        matterId: placeholderId, timekeeperId: 3, serviceDate: '2026-03-01', rawMinutes: 15, description: 'nope',
      }),
      /Placeholder/
    );
  });

  it('does not treat other Placeholder-prefixed matter names as the holding matter', () => {
    ctx.db.prepare(`
      INSERT INTO matters(client_id, number, name, matter_type, responsible_attorney_id, opened_on)
      VALUES (1, '2026-0099', 'Placeholder Park Smoke', 'billable', 2, '2026-01-01')
    `).run();
    const id = timeSvc.ensurePlaceholderMatter(ctx.db, ctx.admin);
    const row = ctx.db.prepare('SELECT name FROM matters WHERE id = ?').get(id);
    assert.equal(row.name, 'Placeholder — Unassigned time');
    assert.notEqual(id, ctx.db.prepare("SELECT id FROM matters WHERE name = 'Placeholder Park Smoke'").get().id);
  });
});
