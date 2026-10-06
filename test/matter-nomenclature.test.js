const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const matterSvc = require('../src/services/matters');
const clientsSvc = require('../src/services/clients');
const matterName = require('../src/services/matterName');

describe('required matter name nomenclature', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `nomenclature-${process.pid}-${Date.now()}-${Math.random()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  function fordSetup() {
    const spec = matterName.ensureStandardMatterNomenclature(db);
    const company = clientsSvc.createClient(db, admin, {
      name: 'FORD',
      recordTypeKey: 'company',
      ticker: 'FRD',
    });
    const caseTypeField = spec.caseTypeFields.find((f) => f.record_type_key === 'billable')
      || spec.caseTypeFields[0];
    const statusField = spec.statusFields.find((f) => f.record_type_key === 'billable')
      || spec.statusFields[0];
    return {
      spec,
      company,
      clientId: company.client.id,
      caseTypeId: caseTypeField.id,
      statusId: statusField.id,
    };
  }

  it('builds FRD - 2026 - FORD - Securities Class Action - Possible', () => {
    const { clientId, caseTypeId, statusId } = fordSetup();
    const page = matterSvc.createMatter(db, admin, {
      clientId,
      ticker: 'FRD',
      openedOn: '2026-10-06',
      recordTypeKey: 'billable',
      customValues: {
        [caseTypeId]: 'Securities Class Action',
        [statusId]: 'Possible',
      },
    });
    assert.equal(page.matter.name, 'FRD - 2026 - FORD - Securities Class Action - Possible');
  });

  it('defaults Status to Possible when omitted', () => {
    const { clientId, caseTypeId } = fordSetup();
    const page = matterSvc.createMatter(db, admin, {
      clientId,
      ticker: 'FRD',
      openedOn: '2026-04-01',
      recordTypeKey: 'billable',
      customValues: {
        [caseTypeId]: 'Securities Class Action',
      },
    });
    assert.equal(page.matter.name, 'FRD - 2026 - FORD - Securities Class Action - Possible');
  });

  it('requires Ticker, Company, and Case Type when no typed name is given', () => {
    const spec = matterName.ensureStandardMatterNomenclature(db);
    const caseTypeId = spec.caseTypeFields[0].id;
    assert.throws(() => matterSvc.createMatter(db, admin, {
      openedOn: '2026-10-06',
      customValues: { [caseTypeId]: 'Securities Class Action' },
    }), /Company|Ticker/);

    const company = clientsSvc.createClient(db, admin, {
      name: 'FORD',
      recordTypeKey: 'company',
    });
    assert.throws(() => matterSvc.createMatter(db, admin, {
      clientId: company.client.id,
      openedOn: '2026-10-06',
      customValues: { [caseTypeId]: 'Securities Class Action' },
    }), /Ticker/);

    assert.throws(() => matterSvc.createMatter(db, admin, {
      clientId: company.client.id,
      ticker: 'FRD',
      openedOn: '2026-10-06',
    }), /Case Type/);
  });

  it('still allows a typed legacy name when nomenclature is incomplete', () => {
    const page = matterSvc.createMatter(db, admin, {
      name: 'Widget Litigation',
      openedOn: '2026-01-01',
    });
    assert.match(page.matter.name, /Widget Litigation/);
  });

  it('rebuilds the display name when status, ticker, or company changes', () => {
    const { clientId, caseTypeId, statusId } = fordSetup();
    const page = matterSvc.createMatter(db, admin, {
      clientId,
      ticker: 'FRD',
      openedOn: '2026-10-06',
      customValues: {
        [caseTypeId]: 'Securities Class Action',
        [statusId]: 'Possible',
      },
    });
    assert.equal(page.matter.name, 'FRD - 2026 - FORD - Securities Class Action - Possible');

    const opened = matterSvc.updateMatter(db, admin, page.matter.id, {
      customValues: { [statusId]: 'Open' },
    });
    assert.equal(opened.matter.name, 'FRD - 2026 - FORD - Securities Class Action - Open');

    clientsSvc.updateClient(db, admin, clientId, { ticker: 'FRDX' });
    const retickered = matterSvc.getMatter(db, page.matter.id, admin);
    assert.equal(retickered.matter.name, 'FRDX - 2026 - FORD - Securities Class Action - Open');

    clientsSvc.updateClient(db, admin, clientId, { name: 'Ford Motor' });
    const renamed = matterSvc.getMatter(db, page.matter.id, admin);
    assert.equal(renamed.matter.name, 'FRDX - 2026 - Ford Motor - Securities Class Action - Open');
  });

  it('rejects a duplicate required name', () => {
    const { clientId, caseTypeId, statusId } = fordSetup();
    const input = {
      clientId,
      ticker: 'FRD',
      openedOn: '2026-10-06',
      customValues: {
        [caseTypeId]: 'Securities Class Action',
        [statusId]: 'Possible',
      },
    };
    matterSvc.createMatter(db, admin, input);
    assert.throws(() => matterSvc.createMatter(db, admin, input), /already exists/);
  });

  it('exposes the locked pattern on settings', () => {
    const cfg = matterName.getNomenclatureConfig(db);
    assert.equal(cfg.required, true);
    assert.equal(cfg.pattern, 'Ticker - Year - Company - Case Type - Status');
    assert.equal(cfg.previewExample, 'FRD - 2026 - FORD - Securities Class Action - Possible');
    assert.equal(cfg.defaultStatus, 'Possible');
    assert.ok(cfg.caseTypeOptions.includes('Securities Class Action'));
    assert.deepEqual(cfg.statusOptions, [
      'Possible', 'Open', 'Closed', 'Outreach', 'Archived', 'Post Settlement',
    ]);
  });
});
