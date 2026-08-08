const { audit, getSetting, setSetting } = require('../db');

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

/** Encode a sharing URL for Microsoft Graph /shares/{shareId}. */
function encodeSharingUrl(sharingUrl) {
  const base64 = Buffer.from(String(sharingUrl), 'utf8').toString('base64');
  return `u!${base64.replace(/=+$/g, '').replace(/\//g, '_').replace(/\+/g, '-')}`;
}

/**
 * Best-effort embed URL so the folder can render inside the legal system.
 * SharePoint/OneDrive may still require the user to be signed into Microsoft.
 */
function toEmbedUrl(folderUrl) {
  const href = normalizeUrl(folderUrl);
  const u = new URL(href);
  const host = u.hostname.toLowerCase();

  if (host.endsWith('onedrive.live.com')) {
    // Personal OneDrive often supports /embed with the same query params.
    if (!u.pathname.includes('/embed')) {
      u.pathname = u.pathname.replace(/\/redir\/?$/i, '/embed') || '/embed';
      if (!u.pathname.includes('embed')) u.pathname = '/embed';
    }
    if (!u.searchParams.has('em')) u.searchParams.set('em', '2');
    return u.href;
  }

  if (host.endsWith('sharepoint.com')) {
    // Prefer AllItems / folder view with embed-friendly flags when possible.
    if (!u.searchParams.has('web')) u.searchParams.set('web', '1');
    return u.href;
  }

  // Short links: open via resolved URL; embed may redirect after Microsoft auth.
  return href;
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

function getGraphToken(db) {
  return process.env.MS_GRAPH_ACCESS_TOKEN
    || getSetting(db, 'ms_graph_access_token', '')
    || '';
}

function graphConfigured(db) {
  return !!String(getGraphToken(db) || '').trim();
}

function setGraphToken(db, actor, token) {
  const value = token == null ? '' : String(token).trim();
  setSetting(db, 'ms_graph_access_token', value);
  audit(db, {
    actorId: actor?.id,
    action: 'settings.ms_graph_token',
    entityType: 'firm_settings',
    entityId: null,
    detail: { configured: !!value },
  });
  return { configured: !!value };
}

function mapRow(row) {
  if (!row) {
    return {
      linked: false,
      folderUrl: null,
      folderName: null,
      driveItemId: null,
      status: null,
      notes: null,
      embedUrl: null,
      linkedBy: null,
      linkedByName: null,
      linkedAt: null,
      updatedAt: null,
      lastSyncedAt: null,
      lastSyncError: null,
      graphConfigured: false,
    };
  }
  return {
    linked: true,
    folderUrl: row.folder_url,
    folderName: row.folder_name,
    driveItemId: row.drive_item_id,
    status: row.status,
    notes: row.notes,
    embedUrl: toEmbedUrl(row.folder_url),
    linkedBy: row.linked_by,
    linkedByName: row.linked_by_name,
    linkedAt: row.linked_at,
    updatedAt: row.updated_at,
    lastSyncedAt: row.last_synced_at,
    lastSyncError: row.last_sync_error,
  };
}

function getMatterOneDrive(db, matterId) {
  const row = db.prepare(`
    SELECT o.*, u.name AS linked_by_name
    FROM matter_onedrive o
    LEFT JOIN users u ON u.id = o.linked_by
    WHERE o.matter_id = ?
  `).get(matterId);
  const base = mapRow(row);
  base.graphConfigured = graphConfigured(db);
  return base;
}

function clearCachedItems(db, matterId) {
  db.prepare('DELETE FROM matter_onedrive_items WHERE matter_id = ?').run(matterId);
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

  const existing = db.prepare('SELECT folder_url FROM matter_onedrive WHERE matter_id = ?').get(matterId);
  if (existing && existing.folder_url !== folderUrl) {
    clearCachedItems(db, matterId);
  }

  db.prepare(`
    INSERT INTO matter_onedrive(
      matter_id, folder_url, folder_name, drive_item_id, status, notes, linked_by, linked_at, updated_at,
      last_synced_at, last_sync_error
    ) VALUES (?, ?, ?, ?, 'linked', ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'), NULL, NULL)
    ON CONFLICT(matter_id) DO UPDATE SET
      folder_url = excluded.folder_url,
      folder_name = excluded.folder_name,
      drive_item_id = COALESCE(excluded.drive_item_id, matter_onedrive.drive_item_id),
      status = 'linked',
      notes = excluded.notes,
      linked_by = excluded.linked_by,
      linked_at = excluded.linked_at,
      updated_at = excluded.updated_at,
      last_sync_error = CASE
        WHEN matter_onedrive.folder_url = excluded.folder_url THEN matter_onedrive.last_sync_error
        ELSE NULL
      END
  `).run(matterId, folderUrl, folderName, driveItemId, notes, actor?.id ?? null);

  audit(db, {
    actorId: actor?.id,
    action: 'matter.onedrive.link',
    entityType: 'matter',
    entityId: matterId,
    detail: { folderUrl, folderName },
  });

  // Without Graph, seed a browsable matter folder tree so Files works immediately.
  if (!graphConfigured(db) && input.seedDemo !== false) {
    const count = db.prepare(
      'SELECT COUNT(*) AS n FROM matter_onedrive_items WHERE matter_id = ?'
    ).get(matterId).n;
    if (!count) seedDemoBrowser(db, matterId);
  }

  return getMatterOneDrive(db, matterId);
}

function disconnectMatterOneDrive(db, actor, matterId) {
  const matter = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');
  const existing = db.prepare('SELECT matter_id FROM matter_onedrive WHERE matter_id = ?').get(matterId);
  if (!existing) return getMatterOneDrive(db, matterId);

  clearCachedItems(db, matterId);
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

async function graphFetch(db, pathOrUrl, { method = 'GET' } = {}) {
  const token = String(getGraphToken(db) || '').trim();
  if (!token) throw new Error('Microsoft Graph token not configured');
  const url = pathOrUrl.startsWith('http')
    ? pathOrUrl
    : `https://graph.microsoft.com/v1.0${pathOrUrl}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error_description || `Graph error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function upsertGraphItem(db, matterId, parentItemId, item) {
  const itemType = item.folder ? 'folder' : 'file';
  db.prepare(`
    INSERT INTO matter_onedrive_items(
      matter_id, item_id, parent_item_id, name, item_type, web_url, size_bytes, mime_type,
      child_count, last_modified, synced_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    ON CONFLICT(matter_id, item_id) DO UPDATE SET
      parent_item_id = excluded.parent_item_id,
      name = excluded.name,
      item_type = excluded.item_type,
      web_url = excluded.web_url,
      size_bytes = excluded.size_bytes,
      mime_type = excluded.mime_type,
      child_count = excluded.child_count,
      last_modified = excluded.last_modified,
      synced_at = excluded.synced_at
  `).run(
    matterId,
    item.id,
    parentItemId,
    item.name || 'Untitled',
    itemType,
    item.webUrl || null,
    item.size != null ? Number(item.size) : null,
    item.file?.mimeType || null,
    item.folder?.childCount != null ? Number(item.folder.childCount) : null,
    item.lastModifiedDateTime || null
  );
}

/**
 * Sync folder children via Microsoft Graph /shares API (shared OneDrive/SharePoint links).
 * Optional parentItemId drills into a cached folder using /me/drive/items/{id}/children.
 */
async function syncMatterOneDriveFromShare(db, actor, matterId, { parentItemId = null } = {}) {
  const link = db.prepare('SELECT * FROM matter_onedrive WHERE matter_id = ?').get(matterId);
  if (!link) throw new Error('OneDrive folder not linked');
  if (!graphConfigured(db)) throw new Error('Microsoft Graph token not configured (Settings → OneDrive)');

  try {
    const shareId = encodeSharingUrl(link.folder_url);
    let rootId = link.drive_item_id;
    let driveId = null;

    if (!rootId) {
      const root = await graphFetch(db, `/shares/${shareId}/driveItem`);
      rootId = root.id;
      driveId = root.parentReference?.driveId || null;
      db.prepare(`
        UPDATE matter_onedrive
        SET drive_item_id = ?, folder_name = COALESCE(?, folder_name),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
        WHERE matter_id = ?
      `).run(rootId, root.name || null, matterId);
    }

    const browseParent = parentItemId || rootId;
    let children;
    if (!parentItemId) {
      children = await graphFetch(db, `/shares/${shareId}/driveItem/children?$top=200`);
    } else if (driveId) {
      children = await graphFetch(
        db,
        `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(browseParent)}/children?$top=200`
      );
    } else {
      children = await graphFetch(
        db,
        `/me/drive/items/${encodeURIComponent(browseParent)}/children?$top=200`
      );
    }

    db.prepare(`
      DELETE FROM matter_onedrive_items
      WHERE matter_id = ? AND IFNULL(parent_item_id, '') = ?
    `).run(matterId, browseParent);

    for (const item of children.value || []) {
      upsertGraphItem(db, matterId, browseParent, item);
    }

    db.prepare(`
      UPDATE matter_onedrive
      SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
          last_sync_error = NULL,
          status = 'linked',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE matter_id = ?
    `).run(matterId);

    audit(db, {
      actorId: actor?.id,
      action: 'matter.onedrive.sync',
      entityType: 'matter',
      entityId: matterId,
      detail: { parentItemId: browseParent, count: (children.value || []).length },
    });

    return browseFolder(db, matterId, { parentItemId: parentItemId || null });
  } catch (e) {
    db.prepare(`
      UPDATE matter_onedrive
      SET last_sync_error = ?, status = 'error',
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE matter_id = ?
    `).run(String(e.message || e), matterId);
    throw e;
  }
}

function formatSize(bytes) {
  if (bytes == null || !Number.isFinite(Number(bytes))) return null;
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function browseFolder(db, matterId, { parentItemId = null } = {}) {
  const link = getMatterOneDrive(db, matterId);
  if (!link.linked) throw new Error('OneDrive folder not linked');

  const rootId = link.driveItemId || '__root__';
  const currentParent = parentItemId || rootId;

  // Breadcrumb trail by walking parents in cache
  const crumbs = [{ itemId: null, name: link.folderName || 'Matter folder' }];
  if (parentItemId) {
    const chain = [];
    let cursor = parentItemId;
    const guard = new Set();
    while (cursor && cursor !== rootId && !guard.has(cursor)) {
      guard.add(cursor);
      const row = db.prepare(`
        SELECT item_id, parent_item_id, name FROM matter_onedrive_items
        WHERE matter_id = ? AND item_id = ?
      `).get(matterId, cursor);
      if (!row) break;
      chain.unshift({ itemId: row.item_id, name: row.name });
      cursor = row.parent_item_id;
    }
    crumbs.push(...chain);
  }

  const items = db.prepare(`
    SELECT * FROM matter_onedrive_items
    WHERE matter_id = ? AND IFNULL(parent_item_id, '') = ?
    ORDER BY CASE item_type WHEN 'folder' THEN 0 ELSE 1 END, lower(name)
  `).all(matterId, currentParent).map((r) => ({
    itemId: r.item_id,
    parentItemId: r.parent_item_id,
    name: r.name,
    itemType: r.item_type,
    webUrl: r.web_url,
    sizeBytes: r.size_bytes,
    sizeLabel: formatSize(r.size_bytes),
    mimeType: r.mime_type,
    childCount: r.child_count,
    lastModified: r.last_modified,
  }));

  return {
    onedrive: link,
    parentItemId: parentItemId || null,
    breadcrumbs: crumbs,
    items,
    embedUrl: link.embedUrl,
    openUrl: link.folderUrl,
  };
}

/** Test/demo helper: populate a sample tree without Graph. */
function seedDemoBrowser(db, matterId, tree = null) {
  const link = db.prepare('SELECT * FROM matter_onedrive WHERE matter_id = ?').get(matterId);
  if (!link) throw new Error('OneDrive folder not linked');
  const rootId = link.drive_item_id || `demo-root-${matterId}`;
  db.prepare('UPDATE matter_onedrive SET drive_item_id = ? WHERE matter_id = ?')
    .run(rootId, matterId);
  clearCachedItems(db, matterId);

  const sample = tree || [
    { id: 'f-pleadings', name: 'Pleadings', type: 'folder', parent: rootId },
    { id: 'f-discovery', name: 'Discovery', type: 'folder', parent: rootId },
    { id: 'f-corr', name: 'Correspondence', type: 'folder', parent: rootId },
    { id: 'file-retainer', name: 'Engagement letter.pdf', type: 'file', parent: rootId, size: 240000 },
    { id: 'file-comp', name: 'Complaint.pdf', type: 'file', parent: 'f-pleadings', size: 520000 },
    { id: 'file-ans', name: 'Answer.pdf', type: 'file', parent: 'f-pleadings', size: 310000 },
    { id: 'file-rfp', name: 'RFP Set 1.docx', type: 'file', parent: 'f-discovery', size: 88000 },
  ];

  for (const node of sample) {
    upsertGraphItem(db, matterId, node.parent, {
      id: node.id,
      name: node.name,
      folder: node.type === 'folder' ? { childCount: sample.filter((x) => x.parent === node.id).length } : undefined,
      file: node.type === 'file' ? { mimeType: 'application/octet-stream' } : undefined,
      webUrl: `${link.folder_url}${link.folder_url.includes('?') ? '&' : '?'}item=${encodeURIComponent(node.id)}`,
      size: node.size,
      lastModifiedDateTime: new Date().toISOString(),
    });
  }

  db.prepare(`
    UPDATE matter_onedrive
    SET last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        last_sync_error = NULL,
        status = 'linked'
    WHERE matter_id = ?
  `).run(matterId);

  return browseFolder(db, matterId, {});
}

module.exports = {
  normalizeUrl,
  encodeSharingUrl,
  toEmbedUrl,
  suggestFolderName,
  getGraphToken,
  graphConfigured,
  setGraphToken,
  getMatterOneDrive,
  linkMatterOneDrive,
  disconnectMatterOneDrive,
  syncMatterOneDriveFromShare,
  browseFolder,
  seedDemoBrowser,
  formatSize,
};
