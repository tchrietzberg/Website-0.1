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

  it('requires Microsoft connect for live sync', async () => {
    const page = matterSvc.createMatter(db, admin, { name: 'Live Sync' });
    onedrive.linkMatterOneDrive(db, admin, page.matter.id, {
      folderUrl: 'https://contoso.sharepoint.com/sites/Lit/Shared%20Documents/X',
    });
    await assert.rejects(
      () => onedrive.syncMatterOneDriveFromShare(db, admin, page.matter.id),
      /Connect Microsoft/
    );
  });
});

describe('Microsoft connect (app config)', () => {
  const msAuth = require('../src/services/msAuth');
  let db;
  let admin;

  beforeEach(() => {
    db = resetDb(path.join(os.tmpdir(), `billing-msauth-${process.pid}-${Date.now()}.db`));
    db.prepare("INSERT INTO users(email,name,role) VALUES ('admin@x.com','Admin','admin')").run();
    admin = db.prepare('SELECT * FROM users WHERE id=1').get();
  });

  it('saves client id and reports connection status', () => {
    const prev = process.env.MS_CLIENT_ID;
    delete process.env.MS_CLIENT_ID;
    try {
      assert.equal(msAuth.connectionStatus(db).clientConfigured, false);
      msAuth.saveAppConfig(db, admin, {
        clientId: '11111111-2222-3333-4444-555555555555',
        tenantId: 'common',
      });
      const st = msAuth.connectionStatus(db);
      assert.equal(st.clientConfigured, true);
      assert.equal(st.connected, false);
      assert.equal(st.clientIdSource, 'settings');
      assert.equal(st.clientId, '11111111-2222-3333-4444-555555555555');
    } finally {
      if (prev === undefined) delete process.env.MS_CLIENT_ID;
      else process.env.MS_CLIENT_ID = prev;
    }
  });

  it('treats MS_CLIENT_ID env as server-owned config', () => {
    const prev = process.env.MS_CLIENT_ID;
    process.env.MS_CLIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    try {
      const st = msAuth.connectionStatus(db);
      assert.equal(st.clientConfigured, true);
      assert.equal(st.clientIdSource, 'env');
      assert.equal(st.clientId, null);
      assert.match(st.clientIdMasked, /^aaaaaaaa/);
    } finally {
      if (prev === undefined) delete process.env.MS_CLIENT_ID;
      else process.env.MS_CLIENT_ID = prev;
    }
  });

  it('marks connected when refresh token is stored', () => {
    msAuth.saveAppConfig(db, admin, { clientId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' });
    setSetting(db, 'ms_refresh_token', 'refresh-demo');
    setSetting(db, 'ms_access_token', 'access-demo');
    setSetting(db, 'ms_access_token_expires_at', String(Date.now() + 60000));
    setSetting(db, 'ms_account_label', 'avery@contoso.com');
    const st = msAuth.connectionStatus(db);
    assert.equal(st.connected, true);
    assert.equal(st.connectionMethod, 'microsoft_login');
    assert.equal(st.accountLabel, 'avery@contoso.com');
    msAuth.disconnect(db, admin);
    assert.equal(msAuth.connectionStatus(db).connected, false);
  });

  it('starts browser sign-in URL after client id is configured', () => {
    const prev = process.env.MS_CLIENT_ID;
    delete process.env.MS_CLIENT_ID;
    try {
      assert.throws(
        () => msAuth.startAuthCode(db, admin, { redirectUri: 'http://localhost/api/onedrive/oauth/callback' }),
        (err) => err && err.code === 'missing_client_id'
      );
      msAuth.saveAppConfig(db, admin, { clientId: '11111111-2222-3333-4444-555555555555' });
      const started = msAuth.startAuthCode(db, admin, {
        redirectUri: 'http://localhost/api/onedrive/oauth/callback',
      });
      assert.match(started.authUrl, /login\.microsoftonline\.com/);
      assert.match(started.authUrl, /client_id=11111111-2222-3333-4444-555555555555/);
      assert.match(started.authUrl, /code_challenge/);
    } finally {
      if (prev === undefined) delete process.env.MS_CLIENT_ID;
      else process.env.MS_CLIENT_ID = prev;
    }
  });
});
