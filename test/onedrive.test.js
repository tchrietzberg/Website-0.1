const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const os = require('node:os');
const { resetDb, setSetting } = require('../src/db');
const matterSvc = require('../src/services/matters');
const onedrive = require('../src/services/onedrive');

describe('matter OneDrive integration', () => {
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-onedrive-${process.pid}-${Date.now()}.db`));
    setSetting(db, 'round_increment_minutes', '15');
    setSetting(db, 'round_mode', 'up');
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    db.prepare("INSERT INTO clients(name) VALUES ('Acme')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  it('links and disconnects a SharePoint folder on a matter', () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Widget Case' });
    const matterId = page.matter.id;
    assert.equal(page.onedrive.linked, false);
    assert.match(page.onedriveSuggestedName, /Widget Case/);

    const linked = onedrive.linkMatterOneDrive(db, admin, matterId, {
      folderUrl: 'https://contoso.sharepoint.com/sites/Litigation/Shared%20Documents/Widget',
      folderName: 'Widget Case Docs',
      notes: 'Discovery set',
    });
    assert.equal(linked.linked, true);
    assert.equal(linked.folderName, 'Widget Case Docs');
    assert.match(linked.folderUrl, /sharepoint\.com/);
    assert.match(linked.embedUrl, /sharepoint\.com/);
    assert.ok(linked.embedUrl.includes('web=1'));

    const again = matterSvc.getMatter(db, matterId);
    assert.equal(again.onedrive.linked, true);
    assert.equal(again.onedrive.notes, 'Discovery set');

    const cleared = onedrive.disconnectMatterOneDrive(db, admin, matterId);
    assert.equal(cleared.linked, false);
    assert.equal(matterSvc.getMatter(db, matterId).onedrive.linked, false);
  });

  it('rejects non-OneDrive URLs', () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Bad Link' });
    assert.throws(
      () => onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
        folderUrl: 'https://example.com/docs',
      }),
      /OneDrive or SharePoint/
    );
  });

  it('accepts onedrive.live.com and 1drv.ms links', () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Cloud File' });
    const a = onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
      folderUrl: 'onedrive.live.com/?id=ABC',
    });
    assert.match(a.folderUrl, /^https:\/\/onedrive\.live\.com/);
    assert.match(a.embedUrl, /embed|onedrive\.live\.com/);

    const b = onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
      folderUrl: 'https://1drv.ms/f/s!abc',
    });
    assert.match(b.folderUrl, /1drv\.ms/);
  });

  it('auto-seeds browsable demo files when Graph is not configured', () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Docs Matter' });
    onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
      folderUrl: 'https://contoso.sharepoint.com/sites/Lit/Shared%20Documents/Docs',
      folderName: 'Docs Matter',
    });

    const root = onedrive.browseFolder(db, page.matter.id, {});
    assert.ok(root.items.some((i) => i.itemType === 'folder' && i.name === 'Pleadings'));
    assert.ok(root.items.some((i) => i.itemType === 'file' && /Engagement/.test(i.name)));

    const pleadings = root.items.find((i) => i.name === 'Pleadings');
    const nested = onedrive.browseFolder(db, page.matter.id, { parentItemId: pleadings.itemId });
    assert.equal(nested.breadcrumbs.at(-1).name, 'Pleadings');
    assert.ok(nested.items.some((i) => i.name === 'Complaint.pdf'));
  });

  it('requires Graph token for live sync', async () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Live Sync' });
    onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
      folderUrl: 'https://contoso.sharepoint.com/sites/Lit/Shared%20Documents/X',
    });
    await assert.rejects(
      () => onedrive.syncMatterOneDriveFromShare(db, admin, page.matter.id),
      /Graph token not configured/
    );
  });
});
