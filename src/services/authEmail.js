const crypto = require('node:crypto');
const { audit } = require('../db');
const {
  hashPassword,
  createSession,
  destroyUserSessions,
  publicOrigin,
  isProduction,
} = require('../security');
const mail = require('../mail');

const PURPOSES = ['invite', 'reset', 'magic_login'];

const TTL_MS = {
  invite: Math.max(1, Number(process.env.AUTH_INVITE_TTL_HOURS || 48)) * 3600 * 1000,
  reset: Math.max(5, Number(process.env.AUTH_RESET_TTL_MINUTES || 60)) * 60 * 1000,
  magic_login: Math.max(2, Number(process.env.AUTH_MAGIC_TTL_MINUTES || 15)) * 60 * 1000,
};

function ensureAuthTokenTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS auth_tokens (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      purpose TEXT NOT NULL CHECK (purpose IN ('invite', 'reset', 'magic_login')),
      token_hash TEXT NOT NULL UNIQUE,
      expires_at INTEGER NOT NULL,
      used_at INTEGER,
      created_by INTEGER REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
      meta_json TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_purpose ON auth_tokens(user_id, purpose);
    CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires ON auth_tokens(expires_at);
  `);
}

function hashToken(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function newRawToken() {
  return crypto.randomBytes(32).toString('base64url');
}

function purgeExpiredAuthTokens(db) {
  ensureAuthTokenTables(db);
  db.prepare('DELETE FROM auth_tokens WHERE expires_at < ? OR used_at IS NOT NULL')
    .run(Date.now() - 7 * 24 * 3600 * 1000);
}

function invalidateUnused(db, userId, purpose) {
  db.prepare(`
    UPDATE auth_tokens SET used_at = ? WHERE user_id = ? AND purpose = ? AND used_at IS NULL
  `).run(Date.now(), userId, purpose);
}

function looksLikeLocalOrEphemeralHost(origin) {
  try {
    const u = new URL(origin);
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0') return true;
    // Ephemeral Cursor VM hostnames often break when opened from email clients.
    if (host.endsWith('.cursorvm.com') || host.includes('-pod-')) return true;
    return false;
  } catch {
    return true;
  }
}

/** Prefer stable public URL for links that leave the browser (email). */
function appBaseUrl(req) {
  const env = String(process.env.PUBLIC_ORIGIN || process.env.APP_BASE_URL || '')
    .trim()
    .replace(/\/$/, '');
  if (env) return env;

  // Browser Origin on API calls is the URL the admin is actually using.
  const hdrOrigin = String(req?.headers?.origin || '').trim().replace(/\/$/, '');
  if (hdrOrigin && /^https?:\/\//i.test(hdrOrigin) && !looksLikeLocalOrEphemeralHost(hdrOrigin)) {
    return hdrOrigin;
  }

  const appOrigin = String(req?.headers?.['x-app-origin'] || '').trim().replace(/\/$/, '');
  if (appOrigin && /^https?:\/\//i.test(appOrigin) && !looksLikeLocalOrEphemeralHost(appOrigin)) {
    return appOrigin;
  }

  const referer = req?.headers?.referer || req?.headers?.referrer;
  if (referer) {
    try {
      const refOrigin = new URL(referer).origin;
      if (!looksLikeLocalOrEphemeralHost(refOrigin)) return refOrigin;
    } catch { /* ignore */ }
  }

  if (hdrOrigin && /^https?:\/\//i.test(hdrOrigin)) return hdrOrigin;
  if (appOrigin && /^https?:\/\//i.test(appOrigin)) return appOrigin;

  return publicOrigin(req).replace(/\/$/, '');
}

function authLink(req, rawToken) {
  // /auth is a dedicated landing that then opens the set-password / sign-in UI.
  return `${appBaseUrl(req)}/auth?token=${encodeURIComponent(rawToken)}`;
}

function createAuthToken(db, {
  userId,
  purpose,
  createdBy = null,
  meta = null,
  ttlMs = null,
} = {}) {
  if (!PURPOSES.includes(purpose)) throw new Error('invalid token purpose');
  ensureAuthTokenTables(db);
  purgeExpiredAuthTokens(db);
  invalidateUnused(db, userId, purpose);
  const raw = newRawToken();
  const tokenHash = hashToken(raw);
  const expiresAt = Date.now() + (ttlMs || TTL_MS[purpose]);
  db.prepare(`
    INSERT INTO auth_tokens(user_id, purpose, token_hash, expires_at, created_by, meta_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    userId,
    purpose,
    tokenHash,
    expiresAt,
    createdBy,
    meta ? JSON.stringify(meta) : null
  );
  return { raw, expiresAt, purpose };
}

function lookupAuthToken(db, rawToken) {
  ensureAuthTokenTables(db);
  const token = String(rawToken || '').trim();
  if (!token || token.length < 20) return null;
  const row = db.prepare(`
    SELECT t.*, u.email, u.name, u.role, u.active, u.password_hash
    FROM auth_tokens t
    JOIN users u ON u.id = t.user_id
    WHERE t.token_hash = ?
  `).get(hashToken(token));
  if (!row) return null;
  if (row.used_at != null) return { ...row, status: 'used' };
  if (Number(row.expires_at) < Date.now()) return { ...row, status: 'expired' };
  if (!row.active) return { ...row, status: 'inactive' };
  return { ...row, status: 'ok' };
}

function consumeAuthToken(db, rawToken, expectedPurposes) {
  const row = lookupAuthToken(db, rawToken);
  if (!row || row.status !== 'ok') {
    const err = new Error(
      row?.status === 'used' ? 'link already used'
        : row?.status === 'expired' ? 'link expired'
          : row?.status === 'inactive' ? 'account inactive'
            : 'invalid or expired link'
    );
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  const allowed = Array.isArray(expectedPurposes) ? expectedPurposes : [expectedPurposes];
  if (!allowed.includes(row.purpose)) {
    const err = new Error('link is not valid for this action');
    err.code = 'WRONG_PURPOSE';
    throw err;
  }
  const updated = db.prepare(`
    UPDATE auth_tokens SET used_at = ? WHERE id = ? AND used_at IS NULL
  `).run(Date.now(), row.id);
  if (updated.changes !== 1) {
    const err = new Error('link already used');
    err.code = 'INVALID_TOKEN';
    throw err;
  }
  return row;
}

function tokenInfoPublic(db, rawToken) {
  const row = lookupAuthToken(db, rawToken);
  if (!row || row.status !== 'ok') {
    return { valid: false, purpose: null };
  }
  return {
    valid: true,
    purpose: row.purpose,
    emailHint: maskEmail(row.email),
    name: row.name,
  };
}

function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '***';
  const keep = local.slice(0, Math.min(2, local.length));
  return `${keep}***@${domain}`;
}

function authEmailHtml({ name, intro, ctaLabel, link, footer }) {
  const safeName = String(name || '').replace(/[<>&"]/g, '');
  const safeIntro = String(intro || '').replace(/[<>&"]/g, '');
  const safeCta = String(ctaLabel || 'Continue').replace(/[<>&"]/g, '');
  const safeFooter = String(footer || '').replace(/[<>&"]/g, '');
  const safeLink = String(link || '').replace(/"/g, '%22');
  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;background:#f4f6f8;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f6f8;padding:24px 12px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#ffffff;border:1px solid #e5e7eb;border-radius:8px;padding:28px 24px;">
        <tr><td style="font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#64748b;padding-bottom:8px;">Firm Billing</td></tr>
        <tr><td style="font-size:22px;font-weight:600;padding-bottom:12px;">Hi ${safeName},</td></tr>
        <tr><td style="font-size:15px;line-height:1.55;padding-bottom:20px;">${safeIntro}</td></tr>
        <tr><td style="padding-bottom:20px;">
          <a href="${safeLink}" style="display:inline-block;background:#0b5fff;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 18px;border-radius:6px;">${safeCta}</a>
        </td></tr>
        <tr><td style="font-size:13px;line-height:1.5;color:#64748b;padding-bottom:8px;">Or paste this link into your browser:</td></tr>
        <tr><td style="font-size:13px;line-height:1.5;word-break:break-all;"><a href="${safeLink}" style="color:#0b5fff;">${safeLink}</a></td></tr>
        <tr><td style="font-size:12px;line-height:1.5;color:#94a3b8;padding-top:20px;">${safeFooter}</td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

async function sendAuthEmail(db, req, {
  user,
  purpose,
  rawToken,
  actorId = null,
}) {
  const link = authLink(req, rawToken);
  let subject;
  let text;
  let html;
  const footer = 'If you were not expecting this, you can ignore this email.';
  if (purpose === 'invite') {
    subject = 'Welcome to Firm Billing — finish signing in';
    text = [
      `Hi ${user.name},`,
      '',
      'You have been invited to Firm Billing.',
      'Open this link to choose a password and sign in (one-time use):',
      '',
      link,
      '',
      footer,
    ].join('\n');
    html = authEmailHtml({
      name: user.name,
      intro: 'You have been invited to Firm Billing. Use the button below to choose a password and sign in (one-time use).',
      ctaLabel: 'Finish signing in',
      link,
      footer,
    });
  } else if (purpose === 'reset') {
    subject = 'Reset your Firm Billing password';
    text = [
      `Hi ${user.name},`,
      '',
      'Open this link to choose a new password and sign in (one-time use):',
      '',
      link,
      '',
      footer,
    ].join('\n');
    html = authEmailHtml({
      name: user.name,
      intro: 'Use the button below to choose a new password and sign in (one-time use).',
      ctaLabel: 'Reset password',
      link,
      footer,
    });
  } else {
    subject = 'Your Firm Billing sign-in link';
    text = [
      `Hi ${user.name},`,
      '',
      'Open this link to sign in (one-time use, expires soon):',
      '',
      link,
      '',
      footer,
    ].join('\n');
    html = authEmailHtml({
      name: user.name,
      intro: 'Use the button below to sign in (one-time use, expires soon).',
      ctaLabel: 'Sign in',
      link,
      footer,
    });
  }

  const delivery = await mail.sendMail({ to: user.email, subject, text, html, db });
  audit(db, {
    actorId,
    action: `auth.email_${purpose}`,
    entityType: 'user',
    entityId: user.id,
    detail: { email: user.email, mode: delivery.mode, ok: delivery.ok },
  });
  // Always return a usable link to the admin when mail did not deliver.
  const exposeLink = !delivery.ok || !isProduction();
  return {
    delivery,
    link: exposeLink ? link : undefined,
  };
}

function inviteUser(db, actor, input) {
  const email = String(input.email || '').trim().toLowerCase();
  const name = String(input.name || '').trim();
  const role = input.role || 'attorney';
  if (!email || !email.includes('@')) throw new Error('valid email required');
  if (!name) throw new Error('name required');
  if (!['admin', 'attorney', 'paralegal', 'billing_clerk'].includes(role)) {
    throw new Error('invalid role');
  }
  const existing = db.prepare('SELECT id FROM users WHERE lower(email) = ?').get(email);
  if (existing) throw new Error('email already exists');

  const info = db.prepare(
    'INSERT INTO users(email, name, role, password_hash, active) VALUES (?, ?, ?, NULL, 1)'
  ).run(email, name, role);
  const id = Number(info.lastInsertRowid);
  audit(db, {
    actorId: actor.id,
    action: 'user.invite',
    entityType: 'user',
    entityId: id,
    detail: { email, name, role },
  });
  return db.prepare(
    'SELECT id, email, name, role, active, created_at FROM users WHERE id = ?'
  ).get(id);
}

async function inviteUserAndEmail(db, actor, req, input) {
  const user = inviteUser(db, actor, input);
  const token = createAuthToken(db, {
    userId: user.id,
    purpose: 'invite',
    createdBy: actor.id,
  });
  const link = authLink(req, token.raw);

  // Until a live domain enables outbound email, return a shareable invite link only.
  if (!mail.outboundEmailEnabled()) {
    audit(db, {
      actorId: actor.id,
      action: 'auth.email_invite',
      entityType: 'user',
      entityId: user.id,
      detail: { email: user.email, mode: 'deferred', ok: false },
    });
    return {
      user,
      delivery: {
        ok: false,
        mode: 'deferred',
        message: 'Outbound email is deferred until a live domain is ready. Share the invite link directly.',
      },
      warning: 'Share the invite link — email delivery is deferred until go-live.',
      devToken: token.raw,
      devLink: link,
    };
  }

  let mailed;
  try {
    mailed = await sendAuthEmail(db, req, {
      user,
      purpose: 'invite',
      rawToken: token.raw,
      actorId: actor.id,
    });
  } catch (e) {
    // User + token exist; surface send failure with a recoverable link.
    return {
      user,
      delivery: { ok: false, mode: 'error', message: e.message },
      devToken: token.raw,
      devLink: link,
      warning: e.message,
    };
  }
  return {
    user,
    delivery: mailed.delivery,
    warning: mailed.delivery?.ok ? undefined : (mailed.delivery?.message || 'Email was not delivered'),
    devToken: mailed.delivery?.ok && isProduction() ? undefined : token.raw,
    devLink: mailed.link || link,
  };
}

async function requestPasswordReset(db, req, emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  // Always return generic ok — no account enumeration
  const generic = { ok: true, message: 'If that email is on file, a reset link was sent.' };
  if (!email || !email.includes('@')) return generic;

  const user = db.prepare(
    'SELECT id, email, name, role, active FROM users WHERE lower(email) = ? AND active = 1'
  ).get(email);
  if (!user) {
    audit(db, {
      actorId: null,
      action: 'auth.reset_request',
      entityType: 'user',
      entityId: null,
      detail: { email, found: false },
    });
    return generic;
  }

  const token = createAuthToken(db, { userId: user.id, purpose: 'reset' });
  let mailed;
  try {
    mailed = await sendAuthEmail(db, req, {
      user,
      purpose: 'reset',
      rawToken: token.raw,
      actorId: null,
    });
  } catch (e) {
    audit(db, {
      actorId: null,
      action: 'auth.reset_request',
      entityType: 'user',
      entityId: user.id,
      detail: { email, found: true, error: e.message },
    });
    return {
      ...generic,
      ...(isProduction() ? {} : { devToken: token.raw, devLink: authLink(req, token.raw) }),
    };
  }
  audit(db, {
    actorId: null,
    action: 'auth.reset_request',
    entityType: 'user',
    entityId: user.id,
    detail: { email, found: true, mode: mailed.delivery.mode },
  });
  return {
    ...generic,
    ...(isProduction() ? {} : { devToken: token.raw, devLink: mailed.link }),
  };
}

async function adminSendPasswordReset(db, actor, req, userId) {
  const user = db.prepare(
    'SELECT id, email, name, role, active FROM users WHERE id = ?'
  ).get(userId);
  if (!user) throw new Error('user not found');
  if (!user.active) throw new Error('user is inactive');
  const token = createAuthToken(db, {
    userId: user.id,
    purpose: 'reset',
    createdBy: actor.id,
  });
  const link = authLink(req, token.raw);

  if (!mail.outboundEmailEnabled()) {
    audit(db, {
      actorId: actor.id,
      action: 'auth.email_reset',
      entityType: 'user',
      entityId: user.id,
      detail: { email: user.email, mode: 'deferred', ok: false },
    });
    return {
      ok: true,
      delivery: {
        ok: false,
        mode: 'deferred',
        message: 'Outbound email is deferred until a live domain is ready. Share the reset link directly.',
      },
      warning: 'Share the reset link — email delivery is deferred until go-live.',
      devToken: token.raw,
      devLink: link,
    };
  }

  try {
    const mailed = await sendAuthEmail(db, req, {
      user,
      purpose: 'reset',
      rawToken: token.raw,
      actorId: actor.id,
    });
    return {
      ok: true,
      delivery: mailed.delivery,
      warning: mailed.delivery?.ok ? undefined : (mailed.delivery?.message || 'Email was not delivered'),
      devToken: mailed.delivery?.ok && isProduction() ? undefined : token.raw,
      devLink: mailed.link || link,
    };
  } catch (e) {
    return {
      ok: false,
      delivery: { ok: false, mode: 'error', message: e.message },
      warning: e.message,
      devToken: token.raw,
      devLink: link,
    };
  }
}

async function requestMagicLogin(db, req, emailInput) {
  const email = String(emailInput || '').trim().toLowerCase();
  const generic = { ok: true, message: 'If that email is on file, a sign-in link was sent.' };
  if (!email || !email.includes('@')) return generic;

  const user = db.prepare(
    'SELECT id, email, name, role, active, password_hash FROM users WHERE lower(email) = ? AND active = 1'
  ).get(email);
  if (!user) {
    audit(db, {
      actorId: null,
      action: 'auth.magic_request',
      entityType: 'user',
      entityId: null,
      detail: { email, found: false },
    });
    return generic;
  }

  // Invited users without a password yet get a set-password link (same friendly inbox flow).
  const purpose = user.password_hash ? 'magic_login' : 'invite';
  const token = createAuthToken(db, { userId: user.id, purpose });
  let mailed;
  try {
    mailed = await sendAuthEmail(db, req, {
      user,
      purpose,
      rawToken: token.raw,
      actorId: null,
    });
  } catch (e) {
    audit(db, {
      actorId: null,
      action: 'auth.magic_request',
      entityType: 'user',
      entityId: user.id,
      detail: { email, found: true, purpose, error: e.message },
    });
    return {
      ...generic,
      ...(isProduction() ? {} : { devToken: token.raw, devLink: authLink(req, token.raw) }),
    };
  }
  audit(db, {
    actorId: null,
    action: 'auth.magic_request',
    entityType: 'user',
    entityId: user.id,
    detail: { email, found: true, purpose, mode: mailed.delivery.mode },
  });
  return {
    ...generic,
    ...(isProduction() ? {} : { devToken: token.raw, devLink: mailed.link }),
  };
}

function setPasswordWithToken(db, req, { token, password }) {
  const row = consumeAuthToken(db, token, ['invite', 'reset']);
  const passwordHash = hashPassword(password);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(passwordHash, row.user_id);
  destroyUserSessions(db, row.user_id);
  // Invalidate other outstanding invite/reset tokens
  invalidateUnused(db, row.user_id, 'invite');
  invalidateUnused(db, row.user_id, 'reset');
  const session = createSession(db, row.user_id, req);
  audit(db, {
    actorId: row.user_id,
    action: row.purpose === 'invite' ? 'auth.invite_complete' : 'auth.reset_complete',
    entityType: 'user',
    entityId: row.user_id,
  });
  const user = {
    id: row.user_id,
    email: row.email,
    name: row.name,
    role: row.role,
  };
  return { user, session };
}

function completeMagicLogin(db, req, { token }) {
  const row = consumeAuthToken(db, token, ['magic_login']);
  if (!row.password_hash) {
    const err = new Error('account has no password yet — use your invite link');
    err.code = 'NO_PASSWORD';
    throw err;
  }
  const session = createSession(db, row.user_id, req);
  audit(db, {
    actorId: row.user_id,
    action: 'auth.magic_login',
    entityType: 'user',
    entityId: row.user_id,
  });
  return {
    user: { id: row.user_id, email: row.email, name: row.name, role: row.role },
    session,
  };
}

module.exports = {
  ensureAuthTokenTables,
  createAuthToken,
  lookupAuthToken,
  consumeAuthToken,
  tokenInfoPublic,
  inviteUser,
  inviteUserAndEmail,
  requestPasswordReset,
  adminSendPasswordReset,
  requestMagicLogin,
  setPasswordWithToken,
  completeMagicLogin,
  TTL_MS,
};
