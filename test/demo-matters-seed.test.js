const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const { hashPassword } = require('../src/security');
const matterSvc = require('../src/services/matters');
const { seedDemoMatters, counts, TARGET_PER_STATUS } = require('../seed/demoMatters');

describe('demo matters seed', () => {
  let db;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-demo-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare(
      'INSERT INTO users(email,name,role,password_hash) VALUES (?,?,?,?)'
    ).run('avery@firm.example', 'Avery Admin', 'admin', hashPassword('demo-change-me'));
  });

  it('creates possible matters and lists them by status', () => {
    const page = matterSvc.createMatter(db, db.prepare('SELECT * FROM users').get(), {
      name: 'Standalone Possible File',
      status: 'possible',
      openedOn: '2026-03-01',
    });
    assert.equal(page.matter.status, 'possible');
    assert.match(page.matter.name, /Possible/);
    const listed = matterSvc.listMatters(db, { status: 'possible' });
    assert.equal(listed.length, 1);
    const filters = matterSvc.listMatterBrowseFilters(db);
    assert.deepEqual(filters.builtIn[0].options.map((o) => o.value), ['open', 'closed', 'possible']);
  });

  it('seeds at least 30 open, closed, and possible matters with time', () => {
    const created = seedDemoMatters(db);
    assert.equal(created.open, TARGET_PER_STATUS);
    assert.equal(created.closed, TARGET_PER_STATUS);
    assert.equal(created.possible, TARGET_PER_STATUS);
    assert.equal(created.timeEntries, TARGET_PER_STATUS * 3 * 3);

    const after = counts(db);
    assert.ok(after.open >= TARGET_PER_STATUS);
    assert.ok(after.closed >= TARGET_PER_STATUS);
    assert.ok(after.possible >= TARGET_PER_STATUS);
    assert.equal(after.mattersWithTime, TARGET_PER_STATUS * 3);

    const again = seedDemoMatters(db);
    assert.equal(again.open + again.closed + again.possible, 0);
    assert.equal(matterSvc.listMatters(db, { status: 'possible' }).length, TARGET_PER_STATUS);
  });
});
