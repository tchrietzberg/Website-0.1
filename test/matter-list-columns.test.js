const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb } = require('../src/db');
const matterSvc = require('../src/services/matters');
const customFields = require('../src/services/customFields');

function setup() {
  const db = resetDb(path.join(os.tmpdir(), `mlc-${process.pid}-${Date.now()}-${Math.random()}.db`));
  db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
  db.prepare("INSERT INTO users(email,name,role) VALUES ('atty@x.com','Atty','attorney')").run();
  db.prepare("INSERT INTO clients(name) VALUES ('Client A')").run();
  db.prepare(`
    INSERT INTO matters(client_id, number, name, matter_type, status, responsible_attorney_id, opened_on)
    VALUES (1, '2026-0001', 'Alpha Matter', 'billable', 'open', 2, '2026-01-15')
  `).run();
  return {
    db,
    admin: db.prepare('SELECT * FROM users WHERE id=1').get(),
  };
}

describe('matter list columns', () => {
  let ctx;
  beforeEach(() => { ctx = setup(); });

  it('defaults to name, client, status, attorney', () => {
    const cfg = matterSvc.getMatterListColumnConfig(ctx.db);
    assert.deepEqual(cfg.keys, ['name', 'client', 'status', 'attorney']);
    assert.equal(cfg.columns[0].removable, false);
  });

  it('adds, reorders, and removes optional columns including custom fields', () => {
    const field = customFields.createCustomField(ctx.db, ctx.admin, {
      label: 'Case Type',
      fieldType: 'text',
      appliesTo: 'matter',
      recordTypeKey: 'billable',
    });
    customFields.setCustomValues(ctx.db, ctx.admin, 1, { [field.id]: 'Litigation' });

    let cfg = matterSvc.addMatterListColumn(ctx.db, ctx.admin, 'number');
    assert.ok(cfg.keys.includes('number'));
    cfg = matterSvc.addMatterListColumn(ctx.db, ctx.admin, `cf:${field.id}`);
    assert.ok(cfg.keys.includes(`cf:${field.id}`));

    const reordered = ['name', `cf:${field.id}`, 'client', 'status', 'attorney', 'number'];
    cfg = matterSvc.setMatterListColumnKeys(ctx.db, ctx.admin, reordered);
    assert.deepEqual(cfg.keys, reordered);

    cfg = matterSvc.removeMatterListColumn(ctx.db, ctx.admin, 'attorney');
    assert.ok(!cfg.keys.includes('attorney'));
    assert.throws(() => matterSvc.removeMatterListColumn(ctx.db, ctx.admin, 'name'), /cannot be removed/i);

    const packed = matterSvc.listMattersWithListColumns(ctx.db, {});
    assert.equal(packed.matters.length, 1);
    assert.equal(packed.matters[0].customValues[field.id], 'Litigation');

    const xlsx = matterSvc.exportMattersListXlsx(ctx.db, {});
    assert.ok(Buffer.isBuffer(xlsx));
    assert.ok(xlsx.length > 100);
  });
});
