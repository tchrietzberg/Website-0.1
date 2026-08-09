const crypto = require('node:crypto');
const { getSetting, setSetting, audit } = require('../db');

const SCOPES = [
  'offline_access',
  'openid',
  'profile',
  'User.Read',
  'Mail.Send',
  'Files.Read.All',
  'Sites.Read.All',
].join(' ');

/** In-memory device-code polls and OAuth PKCE states (prototype). */
const pendingDevice = new Map(); // deviceCode -> { dbKey, startedAt, interval, expiresAt }
const pendingOauth = new Map(); // state -> { verifier, createdAt, redirectUri }

function tenantId(db) {
  return process.env.MS_TENANT_ID
    || getSetting(db, 'ms_tenant_id', '')
    || 'common';
}

function clientId(db) {
  return process.env.MS_CLIENT_ID
    || getSetting(db, 'ms_client_id', '')
    || '';
}

function clientSecret(db) {
  return process.env.MS_CLIENT_SECRET
    || getSetting(db, 'ms_client_secret', '')
    || '';
}

function authority(db) {
  return `https://login.microsoftonline.com/${encodeURIComponent(tenantId(db))}`;
}

function connectionStatus(db) {
  const refresh = getSetting(db, 'ms_refresh_token', '');
  const access = getSetting(db, 'ms_access_token', '');
  const manual = getSetting(db, 'ms_graph_access_token', '');
  const expiresAt = Number(getSetting(db, 'ms_access_token_expires_at', '0') || 0);
  const account = getSetting(db, 'ms_account_label', '') || null;
  const cid = clientId(db);
  const fullClientId = String(cid).trim();
  const fromEnv = !!(process.env.MS_CLIENT_ID && String(process.env.MS_CLIENT_ID).trim());
  return {
    clientConfigured: !!fullClientId,
    clientIdSource: fromEnv ? 'env' : (fullClientId ? 'settings' : null),
    // Public client IDs are not secrets; still prefer masked display in UI.
    clientId: fromEnv ? null : (fullClientId || null),
    clientIdMasked: fullClientId ? `${fullClientId.slice(0, 8)}…` : null,
    tenantId: tenantId(db),
    connected: !!(refresh || access || manual || process.env.MS_GRAPH_ACCESS_TOKEN),
    connectionMethod: refresh ? 'microsoft_login'
      : (manual || process.env.MS_GRAPH_ACCESS_TOKEN) ? 'manual_token'
        : null,
    accountLabel: account,
    accessExpiresAt: expiresAt || null,
  };
}

function saveAppConfig(db, actor, { clientId: cid, tenantId: tid, clientSecret: secret } = {}) {
  if (cid !== undefined) setSetting(db, 'ms_client_id', String(cid || '').trim());
  if (tid !== undefined) setSetting(db, 'ms_tenant_id', String(tid || '').trim() || 'common');
  if (secret !== undefined) setSetting(db, 'ms_client_secret', String(secret || '').trim());
  audit(db, {
    actorId: actor?.id,
    action: 'settings.ms_app_config',
    entityType: 'firm_settings',
    entityId: null,
    detail: {
      clientConfigured: !!clientId(db),
      tenantId: tenantId(db),
      hasSecret: !!clientSecret(db),
    },
  });
  return connectionStatus(db);
}

function storeTokenResponse(db, data, actor) {
  const expiresAt = Date.now() + (Math.max(30, Number(data.expires_in || 3600) - 60) * 1000);
  if (data.access_token) setSetting(db, 'ms_access_token', data.access_token);
  if (data.refresh_token) setSetting(db, 'ms_refresh_token', data.refresh_token);
  setSetting(db, 'ms_access_token_expires_at', String(expiresAt));
  // Clear short-lived manual override when OAuth connects
  setSetting(db, 'ms_graph_access_token', '');
  audit(db, {
    actorId: actor?.id,
    action: 'onedrive.microsoft.connect',
    entityType: 'firm_settings',
    entityId: null,
    detail: { expiresAt },
  });
}

async function fetchAccountLabel(accessToken) {
  try {
    const res = await fetch('https://graph.microsoft.com/v1.0/me?$select=displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!res.ok) return null;
    const me = await res.json();
    return me.mail || me.userPrincipalName || me.displayName || null;
  } catch {
    return null;
  }
}

async function startDeviceCode(db, actor) {
  const cid = clientId(db);
  if (!cid) {
    const err = new Error('Set Microsoft Application (client) ID once, or MS_CLIENT_ID on the server.');
    err.code = 'missing_client_id';
    throw err;
  }
  const res = await fetch(`${authority(db)}/oauth2/v2.0/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cid,
      scope: SCOPES,
    }),
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Could not start Microsoft sign-in');
  }

  pendingDevice.set(data.device_code, {
    actorId: actor?.id,
    intervalSec: Number(data.interval || 5),
    expiresAt: Date.now() + Number(data.expires_in || 900) * 1000,
    startedAt: Date.now(),
  });

  return {
    userCode: data.user_code,
    deviceCode: data.device_code,
    verificationUri: data.verification_uri || 'https://microsoft.com/devicelogin',
    verificationUriComplete: data.verification_uri_complete || null,
    message: data.message,
    expiresIn: Number(data.expires_in || 900),
    interval: Number(data.interval || 5),
  };
}

async function pollDeviceCode(db, actor, deviceCode) {
  const cid = clientId(db);
  if (!cid) throw new Error('Microsoft Application (client) ID not configured');
  if (!deviceCode) throw new Error('device code required');

  const meta = pendingDevice.get(deviceCode);
  if (meta && Date.now() > meta.expiresAt) {
    pendingDevice.delete(deviceCode);
    throw new Error('Microsoft sign-in expired. Start Connect again.');
  }

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    client_id: cid,
    device_code: deviceCode,
  });
  const secret = clientSecret(db);
  if (secret) body.set('client_secret', secret);

  const res = await fetch(`${authority(db)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();

  if (!res.ok) {
    const err = data.error;
    if (err === 'authorization_pending') {
      return { status: 'pending' };
    }
    if (err === 'slow_down') {
      return { status: 'pending', slowDown: true };
    }
    if (err === 'expired_token') {
      pendingDevice.delete(deviceCode);
      throw new Error('Microsoft sign-in expired. Start Connect again.');
    }
    if (err === 'authorization_declined') {
      pendingDevice.delete(deviceCode);
      throw new Error('Microsoft sign-in was declined.');
    }
    throw new Error(data.error_description || err || 'Microsoft sign-in failed');
  }

  pendingDevice.delete(deviceCode);
  storeTokenResponse(db, data, actor);
  const label = await fetchAccountLabel(data.access_token);
  if (label) setSetting(db, 'ms_account_label', label);

  return {
    status: 'connected',
    ...connectionStatus(db),
  };
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function startAuthCode(db, actor, { redirectUri } = {}) {
  const cid = clientId(db);
  if (!cid) {
    const err = new Error('Set Microsoft Application (client) ID once, or MS_CLIENT_ID on the server.');
    err.code = 'missing_client_id';
    throw err;
  }
  if (!redirectUri) throw new Error('redirectUri required');

  const verifier = base64url(crypto.randomBytes(32));
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest());
  const state = base64url(crypto.randomBytes(16));
  pendingOauth.set(state, {
    verifier,
    redirectUri,
    actorId: actor?.id,
    createdAt: Date.now(),
  });

  const url = new URL(`${authority(db)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', cid);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'select_account');

  return { authUrl: url.href, state };
}

async function finishAuthCode(db, { code, state } = {}) {
  const pending = pendingOauth.get(state);
  if (!pending) throw new Error('Microsoft sign-in session expired. Try Connect again.');
  pendingOauth.delete(state);

  const cid = clientId(db);
  const body = new URLSearchParams({
    client_id: cid,
    grant_type: 'authorization_code',
    code,
    redirect_uri: pending.redirectUri,
    code_verifier: pending.verifier,
    scope: SCOPES,
  });
  const secret = clientSecret(db);
  if (secret) body.set('client_secret', secret);

  const res = await fetch(`${authority(db)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Microsoft token exchange failed');
  }

  storeTokenResponse(db, data, { id: pending.actorId });
  const label = await fetchAccountLabel(data.access_token);
  if (label) setSetting(db, 'ms_account_label', label);
  return connectionStatus(db);
}

async function refreshAccessToken(db) {
  const refresh = getSetting(db, 'ms_refresh_token', '');
  if (!refresh) return null;
  const cid = clientId(db);
  if (!cid) return null;

  const body = new URLSearchParams({
    client_id: cid,
    grant_type: 'refresh_token',
    refresh_token: refresh,
    scope: SCOPES,
  });
  const secret = clientSecret(db);
  if (secret) body.set('client_secret', secret);

  const res = await fetch(`${authority(db)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) {
    throw new Error(data.error_description || data.error || 'Could not refresh Microsoft session');
  }
  storeTokenResponse(db, data, null);
  return data.access_token;
}

/**
 * Returns a usable Graph access token, refreshing the Microsoft login when needed.
 */
async function ensureAccessToken(db) {
  const envToken = process.env.MS_GRAPH_ACCESS_TOKEN;
  if (envToken) return envToken;

  const manual = getSetting(db, 'ms_graph_access_token', '');
  if (manual) return manual;

  const expiresAt = Number(getSetting(db, 'ms_access_token_expires_at', '0') || 0);
  const access = getSetting(db, 'ms_access_token', '');
  if (access && Date.now() < expiresAt) return access;

  if (getSetting(db, 'ms_refresh_token', '')) {
    return refreshAccessToken(db);
  }
  return '';
}

function disconnect(db, actor) {
  for (const key of [
    'ms_access_token',
    'ms_refresh_token',
    'ms_access_token_expires_at',
    'ms_account_label',
    'ms_graph_access_token',
  ]) {
    setSetting(db, key, '');
  }
  audit(db, {
    actorId: actor?.id,
    action: 'onedrive.microsoft.disconnect',
    entityType: 'firm_settings',
    entityId: null,
    detail: {},
  });
  return connectionStatus(db);
}

function isConnected(db) {
  return connectionStatus(db).connected;
}

/**
 * Send email via the connected Microsoft account (Graph /me/sendMail).
 * Requires Mail.Send consent — reconnect Microsoft after this scope was added.
 */
async function sendMailGraph(db, { to, subject, text, html = null, fromName = 'Firm Billing' } = {}) {
  const token = await ensureAccessToken(db);
  if (!token) {
    const err = new Error('Connect Microsoft under Settings to send email automatically.');
    err.code = 'MS_NOT_CONNECTED';
    throw err;
  }
  const useHtml = Boolean(html);
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message: {
        subject: String(subject || '').replace(/[\r\n]+/g, ' '),
        body: {
          contentType: useHtml ? 'HTML' : 'Text',
          content: useHtml ? String(html) : String(text || ''),
        },
        toRecipients: [{
          emailAddress: { address: String(to || '').trim().toLowerCase() },
        }],
      },
      saveToSentItems: false,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const msg = body.error?.message || body.error?.code || res.statusText || 'Microsoft mail send failed';
    // Common when older login lacks Mail.Send
    if (/Mail\.Send|not granted|Insufficient privileges|ErrorAccessDenied/i.test(msg) || res.status === 403) {
      const err = new Error('Microsoft needs permission to send email. Disconnect and Sign in with Microsoft again, then retry.');
      err.code = 'MS_MAIL_SCOPE';
      throw err;
    }
    const err = new Error(msg);
    err.code = 'MS_MAIL_FAILED';
    throw err;
  }
  return { ok: true, mode: 'microsoft', fromName };
}

module.exports = {
  SCOPES,
  connectionStatus,
  saveAppConfig,
  startDeviceCode,
  pollDeviceCode,
  startAuthCode,
  finishAuthCode,
  ensureAccessToken,
  disconnect,
  isConnected,
  clientId,
  tenantId,
  sendMailGraph,
  fetchAccountLabel,
};
