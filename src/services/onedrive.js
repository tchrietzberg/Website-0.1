const { audit } = require('../db');

function isOneDriveHost(hostname) {
  const host = String(hostname || '').toLowerCase();
  return host.endsWith('sharepoint.com')
    || host.endsWith('onedrive.live.com')
    || host === '1drv.ms'
    || host.endsWith('.1drv.ms');
}

function normalizeUrl(raw) {
  const url = String(raw || '').trim();
  if (!url) throw new Error('folder URL required');
  const withScheme = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  let parsed;
  try {
    parsed = new URL(withScheme);
  } catch {
    throw new Error('invalid folder URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('folder URL must be http(s)');
  }
  if (!isOneDriveHost(parsed.hostname)) {
    throw new Error('URL must be a OneDrive or SharePoint folder link');
  }
  return parsed.href;
}

function suggestFolderName(matter) {
  const number = matter?.number || 'matter';
  const name = String(matter?.name || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .slice(0, 80);
  return name ? `${number} — ${name}` : String(number);
}

function getMatterOneDrive(db, matterId) {
  const row = db.prepare(`
    SELECT o.*, u.name AS linked_by_name
    FROM matter_onedrive o
    LEFT JOIN users u ON u.id = o.linked_by
    WHERE o.matter_id = ?
  `).get(matterId);
  if (!row) {
    return {
      linked: false,
      folderUrl: null,
      folderName: null,
      driveItemId: null,
      status: null,
      notes: null,
      linkedBy: null,
      linkedByName: null,
      linkedAt: null,
      updatedAt: null,
    };
  }
  return {
    linked: true,
    folderUrl: row.folder_url,
    folderName: row.folder_name,
    driveItemId: row.drive_item_id,
    status: row.status,
    notes: row.notes,
    linkedBy: row.linked_by,
    linkedByName: row.linked_by_name,
    linkedAt: row.linked_at,
    updatedAt: row.updated_at,
  };
}

function linkMatterOneDrive(db, actor, matterId, input = {}) {
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  const folderUrl = normalizeUrl(input.folderUrl || input.url);
  const folderName = String(input.folderName || input.name || suggestFolderName(matter)).trim()
    || suggestFolderName(matter);
  const notes = input.notes != null && String(input.notes).trim() !== ''
    ? String(input.notes).trim()
    : null;
  const driveItemId = input.driveItemId != null && String(input.driveItemId).trim() !== ''
    ? String(input.driveItemId).trim()
    : null;

  db.prepare(`
    INSERT INTO matter_onedrive(
      matter_id, folder_url, folder_name, drive_item_id, status, notes, linked_by, linked_at, updated_at
    ) VALUES (?, ?, ?, ?, 'linked', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(matter_id) DO UPDATE SET
      folder_url = excluded.folder_url,
      folder_name = excluded.folder_name,
      drive_item_id = excluded.drive_item_id,
      status = 'linked',
      notes = excluded.notes,
      linked_by = excluded.linked_by,
      linked_at = excluded.linked_at,
      updated_at = excluded.updated_at
  `).run(matterId, folderUrl, folderName, driveItemId, notes, actor?.id ?? null);

  audit(db, {
    actorId: actor?.id,
    action: 'matter.onedrive.link',
    entityType: 'matter',
    entityId: matterId,
    detail: { folderUrl, folderName },
  });

  return getMatterOneDrive(db, matterId);
}

function disconnectMatterOneDrive(db, actor, matterId) {
  const matter = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');
  const existing = db.prepare('SELECT matter_id FROM matter_onedrive WHERE matter_id = ?').get(matterId);
  if (!existing) return getMatterOneDrive(db, matterId);

  db.prepare('DELETE FROM matter_onedrive WHERE matter_id = ?').run(matterId);
  audit(db, {
    actorId: actor?.id,
    action: 'matter.onedrive.disconnect',
    entityType: 'matter',
    entityId: matterId,
    detail: {},
  });
  return getMatterOneDrive(db, matterId);
}

module.exports = {
  normalizeUrl,
  suggestFolderName,
  getMatterOneDrive,
  linkMatterOneDrive,
  disconnectMatterOneDrive,
};
