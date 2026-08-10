const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
require('../loadEnv').loadEnvFile();
const { openDb, migrate, DEFAULT_DB, getSetting, setSetting, audit } = require('../db');
const security = require('../security');
const {
  ROUNDING_INCREMENTS,
  DURATION_FORMATS,
  ROUNDING_MODES,
  assertAllowedIncrement,
  assertRoundMode,
  assertDurationFormat,
} = require('../money');
const timeSvc = require('../services/time');
const matterSvc = require('../services/matters');
const invoiceSvc = require('../services/invoices');
const paymentSvc = require('../services/payments');
const reports = require('../services/reports');
const usersSvc = require('../services/users');
const ratesAdmin = require('../services/ratesAdmin');
const customFields = require('../services/customFields');
const customReports = require('../services/customReports');
const authEmail = require('../services/authEmail');
const permissions = require('../services/permissions');
const timezones = require('../services/timezones');
const mail = require('../mail');
const mfa = require('../mfa');
const invoiceTemplates = require('../services/invoiceTemplates');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');

function withSecHeaders(req, extra = {}) {
  return { ...security.securityHeaders(req), ...extra };
}

function json(res, status, body, req = null, extraHeaders = {}) {
  const data = JSON.stringify(body);
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...(req ? security.securityHeaders(req) : {}),
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(data);
}

function text(res, status, body, type = 'text/plain; charset=utf-8', req = null) {
  const headers = {
    'Content-Type': type,
    'Content-Length': Buffer.byteLength(body),
    ...(req ? security.securityHeaders(req) : {}),
  };
  res.writeHead(status, headers);
  res.end(body);
}

function parseBody(req) {
  return security.parseBodyLimited(req);
}

function currentSession(db, req) {
  const token = security.getSessionToken(req);
  return security.readSession(db, token);
}

function requireUser(db, req, res) {
  const session = currentSession(db, req);
  if (!session) {
    json(res, 401, { error: 'sign in required' }, req);
    return null;
  }
  req.session = session;
  return session.user;
}

function requireRoles(user, res, roles, req = null, dbRef = null) {
  if (!user?.role) {
    json(res, 403, { error: 'forbidden' }, req);
    return false;
  }
  if (roles.includes(user.role)) return true;
  // Custom firm roles share the general staff gate; object-level permissions still apply.
  if (
    dbRef
    && roles.includes('attorney')
    && roles.includes('paralegal')
    && permissions.isKnownRole(dbRef, user.role)
  ) {
    return true;
  }
  json(res, 403, { error: 'forbidden' }, req);
  return false;
}

function requireCsrf(req, res, session) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
  // CSRF token is the primary check (unguessable per session).
  if (!security.assertCsrf(req, session)) {
    json(res, 403, { error: 'invalid_csrf', message: 'Missing or invalid CSRF token' }, req);
    return false;
  }
  // On live domain / production / ALLOWED_ORIGINS, reject cross-origin mutating requests.
  if (security.strictOriginEnforcement()) {
    if (!security.assertSameOrigin(req)) {
      json(res, 403, { error: 'invalid_origin', message: 'Cross-origin request blocked' }, req);
      return false;
    }
  } else if (req.headers.origin && !security.assertSameOrigin(req)) {
    const allow = String(process.env.ALLOWED_ORIGINS || '').trim();
    if (allow) {
      json(res, 403, { error: 'invalid_origin', message: 'Cross-origin request blocked' }, req);
      return false;
    }
  }
  return true;
}

function authSessionPayload(session, user) {
  const body = {
    user,
    csrf: session.csrf,
  };
  // Omit opaque session token from JSON when cookie-only mode is active (live/prod).
  if (!security.cookieOnlyAuth()) body.token = session.token;
  return body;
}

function issueSessionResponse(res, req, db, userRow) {
  const session = security.createSession(db, userRow.id, req);
  security.auditLogin(db, userRow.id, true, { email: userRow.email, ip: security.clientIp(req) }, req);
  const user = { id: userRow.id, email: userRow.email, name: userRow.name, role: userRow.role };
  return json(res, 200, authSessionPayload(session, user), req, {
    'Set-Cookie': security.sessionSetCookie(session.token, req),
  });
}

function beginMfaLogin(res, req, db, userRow) {
  const challenge = mfa.createChallenge(db, userRow.id, req);
  audit(db, {
    actorId: userRow.id,
    action: 'auth.mfa_challenge',
    entityType: 'session',
    detail: { email: userRow.email },
    req,
  });
  return json(res, 200, {
    mfaRequired: true,
    mfaToken: challenge.mfaToken,
    expiresInSec: challenge.expiresInSec,
  }, req);
}

function serveStatic(req, res) {
  const urlPath = new URL(req.url, 'http://localhost').pathname;
  const file = security.safeStaticPath(PUBLIC, urlPath);
  if (!file) return text(res, 403, 'forbidden', 'text/plain; charset=utf-8', req);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  const body = fs.readFileSync(file);
  const headers = withSecHeaders(req, {
    'Content-Type': types[ext] || 'application/octet-stream',
  });
  if (ext === '.html') {
    headers['Cache-Control'] = 'no-store';
  } else if (ext === '.js' || ext === '.css') {
    headers['Cache-Control'] = 'no-cache, must-revalidate';
  }
  res.writeHead(200, headers);
  res.end(body);
  return true;
}

function readSettings(db) {
  const onedrive = require('../services/onedrive');
  const msAuth = require('../services/msAuth');
  const clientsSvc = require('../services/clients');
  const permissions = require('../services/permissions');
  const firmTimezone = timezones.normalizeTimeZone(
    getSetting(db, 'firm_timezone', timezones.DEFAULT_TIMEZONE)
  );
  return {
    roundIncrementMinutes: Number(getSetting(db, 'round_increment_minutes', '15')),
    roundMode: getSetting(db, 'round_mode', 'up'),
    durationFormat: getSetting(db, 'duration_format', 'decimal'),
    firmTimezone,
    firmTimezoneLabel: timezones.formatTimeZoneLabel(firmTimezone),
    roundingIncrements: ROUNDING_INCREMENTS,
    durationFormats: DURATION_FORMATS,
    roundingModes: ROUNDING_MODES,
    msGraphConfigured: onedrive.graphConfigured(db),
    microsoft: msAuth.connectionStatus(db),
    email: mail.mailStatus(db),
    contactFieldConfig: clientsSvc.getContactFieldConfig(db),
    billFieldConfig: invoiceSvc.getBillFieldConfig(db),
    permissions: permissions.getPermissionsSettings(db),
    matterNameFormula: matterSvc.getMatterNameFormulaConfig(db),
  };
}

function createServer(db = openDb()) {
  migrate(db);
  const secret = security.sessionSecret(db);
  security.ensureSessionTables(db);
  authEmail.ensureAuthTokenTables(db);
  mfa.ensureMfaSchema(db);
  const roleGate = (user, res, roles, req = null) => requireRoles(user, res, roles, req, db);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const { pathname } = url;

      if (req.method === 'OPTIONS') {
        return json(res, 204, {}, req);
      }

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        // SPA routes used by email links (invite / reset / magic login)
        if (pathname === '/auth' || pathname === '/auth/') {
          const index = path.join(PUBLIC, 'index.html');
          const body = fs.readFileSync(index);
          res.writeHead(200, withSecHeaders(req, {
            'Content-Type': 'text/html; charset=utf-8',
            'Cache-Control': 'no-store',
          }));
          res.end(body);
          return;
        }
        if (serveStatic(req, res) !== false) return;
        return text(res, 404, 'not found', 'text/plain; charset=utf-8', req);
      }

      // Public security posture for the SPA (cookie-only / MFA availability)
      if (req.method === 'GET' && pathname === '/api/security-config') {
        return json(res, 200, security.publicSecurityConfig(), req);
      }

      // Auth
      if (req.method === 'POST' && pathname === '/api/login') {
        const limit = security.checkLoginRateLimit(req);
        if (!limit.ok) {
          return json(res, 429, {
            error: 'rate_limited',
            message: 'Too many sign-in attempts. Try again later.',
            retryAfterSec: limit.retryAfterSec,
          }, req, { 'Retry-After': String(limit.retryAfterSec) });
        }
        const body = await parseBody(req);
        const email = String(body.email || '').trim().toLowerCase();
        const password = String(body.password || '');
        const row = db.prepare(
          `SELECT id, email, name, role, password_hash, mfa_enabled, mfa_secret
           FROM users WHERE lower(email) = ? AND active = 1`
        ).get(email);
        const ok = row && row.password_hash && security.verifyPassword(password, row.password_hash);
        if (!ok) {
          security.recordLoginFailure(req);
          security.auditLogin(db, row?.id || null, false, { email, ip: security.clientIp(req) }, req);
          return json(res, 401, { error: 'invalid_credentials', message: 'Invalid email or password' }, req);
        }
        security.clearLoginFailures(req);
        if (mfa.userHasMfa(row)) return beginMfaLogin(res, req, db, row);
        return issueSessionResponse(res, req, db, row);
      }

      if (req.method === 'POST' && pathname === '/api/login/mfa') {
        const limit = security.checkLoginRateLimit(req);
        if (!limit.ok) {
          return json(res, 429, {
            error: 'rate_limited',
            message: 'Too many sign-in attempts. Try again later.',
            retryAfterSec: limit.retryAfterSec,
          }, req, { 'Retry-After': String(limit.retryAfterSec) });
        }
        const body = await parseBody(req);
        const challenge = mfa.consumeChallenge(db, body.mfaToken);
        if (!challenge) {
          security.recordLoginFailure(req);
          return json(res, 401, { error: 'invalid_mfa', message: 'MFA challenge expired. Sign in again.' }, req);
        }
        const verified = mfa.verifyUserMfaCode(challenge, body.code, secret);
        if (!verified.ok) {
          mfa.bumpChallengeAttempt(db, challenge.token);
          security.recordLoginFailure(req);
          audit(db, {
            actorId: challenge.user_id,
            action: 'auth.mfa_failed',
            entityType: 'session',
            detail: { email: challenge.email },
            req,
          });
          return json(res, 401, { error: 'invalid_mfa', message: 'Invalid authenticator code' }, req);
        }
        if (verified.usedBackup) {
          db.prepare('UPDATE users SET mfa_backup_hashes = ? WHERE id = ?')
            .run(JSON.stringify(verified.remainingBackupHashes || []), challenge.user_id);
        }
        mfa.deleteChallenge(db, challenge.token);
        security.clearLoginFailures(req);
        return issueSessionResponse(res, req, db, challenge);
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        const token = security.getSessionToken(req);
        const session = security.readSession(db, token);
        if (session && !security.assertCsrf(req, session)) {
          // Still allow logout with same-origin to clear stolen cookies without CSRF
          if (!security.assertSameOrigin(req) && req.headers.origin) {
            return json(res, 403, { error: 'invalid_origin' }, req);
          }
        }
        security.destroySession(db, token);
        const secure = security.sessionCookieOptions(req).secure;
        return json(res, 200, { ok: true }, req, {
          'Set-Cookie': security.clearCookie('session', { secure }),
        });
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        const session = currentSession(db, req);
        if (!session) return json(res, 200, { user: null, csrf: null }, req);
        return json(res, 200, { user: session.user, csrf: session.csrf }, req);
      }

      // Public auth-email flows (invite set-password, reset, magic login)
      const rateLimitedAuthEmail = () => {
        const limit = security.checkAuthEmailRateLimit(req);
        if (!limit.ok) {
          json(res, 429, {
            error: 'rate_limited',
            message: 'Too many requests. Try again later.',
            retryAfterSec: limit.retryAfterSec,
          }, req, { 'Retry-After': String(limit.retryAfterSec) });
          return true;
        }
        security.recordAuthEmailAttempt(req);
        return false;
      };

      if (req.method === 'GET' && pathname === '/api/auth/token-info') {
        if (rateLimitedAuthEmail()) return;
        const token = url.searchParams.get('token') || '';
        return json(res, 200, authEmail.tokenInfoPublic(db, token), req);
      }

      if (req.method === 'POST' && pathname === '/api/password-reset/request') {
        if (!mail.outboundEmailEnabled()) {
          return json(res, 503, {
            error: 'mail_deferred',
            message: 'Password reset by email is unavailable until a live domain is ready. Ask an admin for a reset link.',
          }, req);
        }
        if (rateLimitedAuthEmail()) return;
        const body = await parseBody(req);
        const result = await authEmail.requestPasswordReset(db, req, body.email);
        return json(res, 200, result, req);
      }

      if (req.method === 'POST' && pathname === '/api/login/magic/request') {
        if (!mail.outboundEmailEnabled()) {
          return json(res, 503, {
            error: 'mail_deferred',
            message: 'Email sign-in links are unavailable until a live domain is ready. Sign in with your password.',
          }, req);
        }
        if (rateLimitedAuthEmail()) return;
        const body = await parseBody(req);
        const result = await authEmail.requestMagicLogin(db, req, body.email);
        return json(res, 200, result, req);
      }

      if (req.method === 'POST' && pathname === '/api/auth/set-password') {
        if (rateLimitedAuthEmail()) return;
        const body = await parseBody(req);
        try {
          const { user: u, session } = authEmail.setPasswordWithToken(db, req, {
            token: body.token,
            password: body.password,
          });
          security.clearLoginFailures(req);
          // Fresh password set: session already created by authEmail; re-issue cookie options.
          const payload = authSessionPayload(session, u);
          return json(res, 200, payload, req, {
            'Set-Cookie': security.sessionSetCookie(session.token, req),
          });
        } catch (e) {
          const status = e.code === 'INVALID_TOKEN' || e.code === 'WRONG_PURPOSE' ? 400 : 400;
          return json(res, status, { error: e.code || 'error', message: e.message }, req);
        }
      }

      if (req.method === 'POST' && pathname === '/api/login/magic/confirm') {
        if (rateLimitedAuthEmail()) return;
        const body = await parseBody(req);
        try {
          const { user: u, session } = authEmail.completeMagicLogin(db, req, {
            token: body.token,
          });
          const full = db.prepare(
            'SELECT id, email, name, role, mfa_enabled, mfa_secret FROM users WHERE id = ?'
          ).get(u.id);
          if (mfa.userHasMfa(full)) {
            // Drop the premature session; require TOTP before a lasting session.
            security.destroySession(db, session.token);
            security.clearLoginFailures(req);
            return beginMfaLogin(res, req, db, full);
          }
          security.clearLoginFailures(req);
          return json(res, 200, authSessionPayload(session, u), req, {
            'Set-Cookie': security.sessionSetCookie(session.token, req),
          });
        } catch (e) {
          return json(res, 400, { error: e.code || 'error', message: e.message }, req);
        }
      }

      // Microsoft OAuth redirect must work even if session cookie is delayed
      if (req.method === 'GET' && pathname === '/api/onedrive/oauth/callback') {
        const msAuth = require('../services/msAuth');
        try {
          const code = url.searchParams.get('code');
          const state = url.searchParams.get('state');
          const err = url.searchParams.get('error_description') || url.searchParams.get('error');
          if (err) throw new Error(err);
          await msAuth.finishAuthCode(db, { code, state });
          res.writeHead(302, withSecHeaders(req, { Location: '/?onedrive=connected#settings' }));
          res.end();
          return;
        } catch (e) {
          res.writeHead(302, withSecHeaders(req, {
            Location: `/?onedrive=error&msg=${encodeURIComponent(e.message)}#settings`,
          }));
          res.end();
          return;
        }
      }

      const user = requireUser(db, req, res);
      if (!user) return;
      if (!requireCsrf(req, res, req.session)) return;

      // MFA enrollment (any signed-in user for their own account)
      if (req.method === 'GET' && pathname === '/api/mfa/status') {
        return json(res, 200, mfa.mfaStatus(db, user.id), req);
      }
      if (req.method === 'POST' && pathname === '/api/mfa/setup') {
        const setup = mfa.beginSetup(db, user.id, user.email, secret);
        audit(db, {
          actorId: user.id,
          action: 'auth.mfa_setup',
          entityType: 'user',
          entityId: user.id,
          req,
        });
        return json(res, 200, {
          secret: setup.secret,
          otpauthUrl: setup.otpauthUrl,
          backupCodes: setup.backupCodes,
        }, req);
      }
      if (req.method === 'POST' && pathname === '/api/mfa/enable') {
        const body = await parseBody(req);
        try {
          mfa.enableMfa(db, user.id, body.code, secret);
          audit(db, {
            actorId: user.id,
            action: 'auth.mfa_enabled',
            entityType: 'user',
            entityId: user.id,
            req,
          });
          return json(res, 200, { ok: true, ...mfa.mfaStatus(db, user.id) }, req);
        } catch (e) {
          const status = e.status || 400;
          return json(res, status, {
            error: e.code || 'error',
            message: e.message || 'MFA enable failed',
          }, req);
        }
      }
      if (req.method === 'POST' && pathname === '/api/mfa/disable') {
        const body = await parseBody(req);
        const row = db.prepare(
          'SELECT id, email, password_hash, mfa_enabled, mfa_secret, mfa_backup_hashes FROM users WHERE id = ?'
        ).get(user.id);
        const password = String(body.password || '');
        if (!row?.password_hash || !security.verifyPassword(password, row.password_hash)) {
          return json(res, 401, { error: 'invalid_credentials', message: 'Password required to disable MFA' }, req);
        }
        if (mfa.userHasMfa(row)) {
          const verified = mfa.verifyUserMfaCode(row, body.code, secret);
          if (!verified.ok) {
            return json(res, 401, { error: 'invalid_mfa', message: 'Invalid authenticator code' }, req);
          }
        }
        mfa.disableMfa(db, user.id);
        audit(db, {
          actorId: user.id,
          action: 'auth.mfa_disabled',
          entityType: 'user',
          entityId: user.id,
          req,
        });
        return json(res, 200, { ok: true, enabled: false }, req);
      }

      // Reference data
      if (req.method === 'GET' && pathname === '/api/users') {
        const includeInactive = url.searchParams.get('all') === '1';
        if (includeInactive && !['admin', 'billing_clerk'].includes(user.role)) {
          return json(res, 403, { error: 'forbidden' });
        }
        return json(res, 200, usersSvc.listUsers(db, { includeInactive }));
      }
      if (
        (req.method === 'POST' && pathname === '/api/users')
        || (req.method === 'POST' && pathname === '/api/users/invite')
      ) {
        try {
          permissions.assertCanAddUsers(db, user);
        } catch (e) {
          return json(res, 403, { error: 'forbidden', message: e.message }, req);
        }
        const body = await parseBody(req);
        const wantsInvite = pathname === '/api/users/invite'
          || body.invite === true
          || body.invite === '1'
          || !body.password;
        if (wantsInvite) {
          const invited = await authEmail.inviteUserAndEmail(db, user, req, body);
          if (body.defaultRateCents != null) {
            ratesAdmin.addRate(db, user, {
              scope: 'timekeeper',
              scopeId: invited.user.id,
              amountCents: Number(body.defaultRateCents),
              effectiveDate: body.rateEffectiveDate || new Date().toISOString().slice(0, 10),
            });
          }
          return json(res, 201, invited);
        }
        const created = usersSvc.createUser(db, user, body);
        if (body.defaultRateCents != null) {
          ratesAdmin.addRate(db, user, {
            scope: 'timekeeper',
            scopeId: created.id,
            amountCents: Number(body.defaultRateCents),
            effectiveDate: body.rateEffectiveDate || new Date().toISOString().slice(0, 10),
          });
        }
        return json(res, 201, created);
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/users\/\d+\/send-reset$/)) {
        if (!roleGate(user, res, ['admin'])) return;
        const id = Number(pathname.split('/')[3]);
        const result = await authEmail.adminSendPasswordReset(db, user, req, id);
        return json(res, 200, result);
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/users\/\d+\/active$/)) {
        if (!roleGate(user, res, ['admin'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, usersSvc.setUserActive(db, user, id, !!body.active));
      }
      if (req.method === 'GET' && pathname === '/api/rates') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const scope = url.searchParams.get('scope');
        const scopeId = url.searchParams.get('scopeId');
        return json(res, 200, ratesAdmin.listRates(db, {
          scope: scope || null,
          scopeId: scopeId ? Number(scopeId) : null,
        }));
      }
      if (req.method === 'POST' && pathname === '/api/rates') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        return json(res, 201, ratesAdmin.addRate(db, user, body));
      }
      if (req.method === 'GET' && pathname === '/api/timekeepers') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const asOf = url.searchParams.get('asOf') || undefined;
        return json(res, 200, ratesAdmin.timekeeperRatesSummary(db, asOf));
      }
      if (req.method === 'GET' && pathname === '/api/clients/field-config') {
        const clientsSvc = require('../services/clients');
        return json(res, 200, clientsSvc.getContactFieldConfig(db));
      }
      if (req.method === 'GET' && pathname === '/api/lookup') {
        try {
          const globalSearch = require('../services/globalSearch');
          const q = url.searchParams.get('q') || '';
          const limitPerType = Number(url.searchParams.get('limit') || 5);
          return json(res, 200, globalSearch.lookup(db, user, { q, limitPerType }), req);
        } catch (e) {
          const status = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, status, { error: e.message, message: e.message }, req);
        }
      }
      if (req.method === 'GET' && pathname === '/api/clients') {
        try {
          const permissions = require('../services/permissions');
          permissions.assertCanViewRecords(db, user, 'contact');
          const clientsSvc = require('../services/clients');
          return json(res, 200, clientsSvc.listClients(db, {
            q: url.searchParams.get('q') || '',
          }));
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/clients') {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const clientsSvc = require('../services/clients');
          const body = await parseBody(req);
          return json(res, 201, clientsSvc.createClient(db, user, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/clients\/\d+$/)) {
        try {
          const clientsSvc = require('../services/clients');
          const id = Number(pathname.split('/')[3]);
          const page = clientsSvc.getClient(db, id, user);
          if (!page) return json(res, 404, { error: 'not found' });
          return json(res, 200, page);
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/clients\/\d+$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const clientsSvc = require('../services/clients');
          const id = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          return json(res, 200, clientsSvc.updateClient(db, user, id, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/clients\/\d+$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const clientsSvc = require('../services/clients');
          const id = Number(pathname.split('/')[3]);
          return json(res, 200, clientsSvc.deleteClient(db, user, id));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/clients\/\d+\/custom-fields$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const clientsSvc = require('../services/clients');
          const clientId = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          const field = customFields.createCustomField(db, user, {
            ...body,
            clientId,
            appliesTo: 'client',
          });
          return json(res, 201, { field, page: clientsSvc.getClient(db, clientId, user) });
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/record-types') {
        const appliesTo = url.searchParams.get('appliesTo') || 'matter';
        return json(res, 200, customFields.listRecordTypes(db, { appliesTo }));
      }
      if (req.method === 'POST' && pathname === '/api/record-types') {
        if (!roleGate(user, res, ['admin'])) return;
        try {
          const body = await parseBody(req);
          return json(res, 201, customFields.createRecordType(db, user, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/matters/filter-fields') {
        try {
          const permissions = require('../services/permissions');
          permissions.assertCanViewRecords(db, user, 'matter');
          return json(res, 200, matterSvc.listMatterBrowseFilters(db));
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/matters') {
        try {
          const permissions = require('../services/permissions');
          permissions.assertCanViewRecords(db, user, 'matter');
          const q = url.searchParams.get('q');
          const filters = {
            q,
            status: url.searchParams.get('status'),
            matterType: url.searchParams.get('type'),
            clientId: url.searchParams.get('clientId'),
            fieldId: url.searchParams.get('fieldId'),
            fieldValue: url.searchParams.get('fieldValue'),
          };
          // Matter Search (indexed) when q is present; otherwise full/filtered list
          if (q != null && String(q).trim() !== '') {
            return json(res, 200, matterSvc.searchMatters(db, filters));
          }
          if (url.searchParams.get('search') === '1') {
            // Indexed search mode with empty query: still allow status/custom-field browse filters.
            const hasBrowseFilter = !!(filters.status
              || (filters.fieldId && String(filters.fieldId).trim()
                && filters.fieldValue && String(filters.fieldValue).trim()));
            if (!hasBrowseFilter) return json(res, 200, []);
          }
          return json(res, 200, matterSvc.listMatters(db, filters));
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/matters/reindex') {
        if (!roleGate(user, res, ['admin'])) return;
        const matterIndex = require('../services/matterIndex');
        matterIndex.reindexAllMatters(db);
        const count = db.prepare('SELECT COUNT(*) AS n FROM matter_search_index').get().n;
        return json(res, 200, { ok: true, indexed: count });
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/matters\/\d+$/)) {
        try {
          const id = Number(pathname.split('/')[3]);
          const page = matterSvc.getMatter(db, id, user);
          if (!page) return json(res, 404, { error: 'not found' });
          return json(res, 200, page);
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/matters') {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const body = await parseBody(req);
          return json(res, 201, matterSvc.createMatter(db, user, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/matters\/\d+$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const id = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          return json(res, 200, matterSvc.updateMatter(db, user, id, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/matters\/\d+$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const id = Number(pathname.split('/')[3]);
          return json(res, 200, matterSvc.deleteMatter(db, user, id));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/matters\/\d+\/custom-fields$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const matterId = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          const field = customFields.createCustomField(db, user, { ...body, matterId });
          return json(res, 201, { field, page: matterSvc.getMatter(db, matterId) });
        } catch (e) {
          const status = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, status, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/matters\/\d+\/use-record-layout$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const matterId = Number(pathname.split('/')[3]);
        const layout = customFields.ensureMatterLayout(db, matterId);
        return json(res, 200, { layout, page: matterSvc.getMatter(db, matterId) });
      }
      if (req.method === 'PUT' && pathname.match(/^\/api\/matters\/\d+\/layout-items$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        try {
          const matterId = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          return json(res, 200, customFields.saveMatterLayoutItems(
            db,
            user,
            matterId,
            body.items || []
          ));
        } catch (e) {
          const status = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, status, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/matters\/\d+\/standard-fields$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        const matterId = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, customFields.addStandardFieldToMatter(db, user, matterId, body.fieldKey));
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/matters\/\d+\/layout-fields$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        const matterId = Number(pathname.split('/')[3]);
        const fieldKey = url.searchParams.get('fieldKey');
        if (!fieldKey) return json(res, 400, { error: 'fieldKey required' });
        return json(res, 200, customFields.removeFieldFromMatter(db, user, matterId, fieldKey));
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/matters\/\d+\/onedrive$/)) {
        const onedrive = require('../services/onedrive');
        const matterId = Number(pathname.split('/')[3]);
        const matter = db.prepare('SELECT id FROM matters WHERE id = ?').get(matterId);
        if (!matter) return json(res, 404, { error: 'not found' });
        return json(res, 200, onedrive.getMatterOneDrive(db, matterId));
      }
      if (req.method === 'PUT' && pathname.match(/^\/api\/matters\/\d+\/onedrive$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        const onedrive = require('../services/onedrive');
        const matterIndex = require('../services/matterIndex');
        const matterId = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        try {
          const link = onedrive.linkMatterOneDrive(db, user, matterId, body);
          matterIndex.indexMatter(db, matterId);
          return json(res, 200, { onedrive: link, page: matterSvc.getMatter(db, matterId) });
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/matters\/\d+\/onedrive$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        const onedrive = require('../services/onedrive');
        const matterIndex = require('../services/matterIndex');
        const matterId = Number(pathname.split('/')[3]);
        const link = onedrive.disconnectMatterOneDrive(db, user, matterId);
        matterIndex.indexMatter(db, matterId);
        return json(res, 200, { onedrive: link, page: matterSvc.getMatter(db, matterId) });
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/matters\/\d+\/onedrive\/browser$/)) {
        const onedrive = require('../services/onedrive');
        const matterId = Number(pathname.split('/')[3]);
        const parentItemId = url.searchParams.get('parent') || null;
        try {
          return json(res, 200, onedrive.browseFolder(db, matterId, { parentItemId }));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/matters\/\d+\/onedrive\/sync$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney', 'paralegal'])) return;
        const onedrive = require('../services/onedrive');
        const matterId = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        try {
          const browser = await onedrive.syncMatterOneDriveFromShare(db, user, matterId, {
            parentItemId: body.parentItemId || null,
          });
          return json(res, 200, browser);
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/matters\/\d+\/onedrive\/demo-seed$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const onedrive = require('../services/onedrive');
        const matterId = Number(pathname.split('/')[3]);
        try {
          return json(res, 200, onedrive.seedDemoBrowser(db, matterId));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/record-types\/[^/]+\/layout$/)) {
        const key = decodeURIComponent(pathname.split('/')[3]);
        return json(res, 200, customFields.getTypeLayout(db, key));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/record-types\/[^/]+\/standard-fields$/)) {
        // Matter record-type layout edits are admin-only; contact types keep clerk access.
        const key = decodeURIComponent(pathname.split('/')[3]);
        let appliesTo = 'matter';
        try {
          appliesTo = customFields.getTypeLayout(db, key).appliesTo || 'matter';
        } catch (_) { /* unknown type → admin gate below */ }
        const allowed = appliesTo === 'client' ? ['admin', 'billing_clerk'] : ['admin'];
        if (!roleGate(user, res, allowed)) return;
        const body = await parseBody(req);
        return json(res, 200, customFields.addStandardFieldToType(db, user, key, body.fieldKey));
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/record-types\/[^/]+\/layout-fields$/)) {
        if (!roleGate(user, res, ['admin'])) return;
        const key = decodeURIComponent(pathname.split('/')[3]);
        const fieldKey = url.searchParams.get('fieldKey');
        if (!fieldKey) return json(res, 400, { error: 'fieldKey required' });
        return json(res, 200, customFields.removeFieldFromType(db, user, key, fieldKey));
      }
      if (req.method === 'GET' && pathname === '/api/custom-fields') {
        return json(res, 200, customFields.listCustomFields(db, {
          recordTypeKey: url.searchParams.get('type'),
          matterId: url.searchParams.get('matterId')
            ? Number(url.searchParams.get('matterId')) : null,
          clientId: url.searchParams.get('clientId')
            ? Number(url.searchParams.get('clientId')) : null,
          appliesTo: url.searchParams.get('appliesTo') || 'matter',
        }));
      }
      if (req.method === 'POST' && pathname === '/api/custom-fields') {
        try {
          const body = await parseBody(req);
          // Matter record-type / default fields: admin only. Contact type fields: matter-edit roles.
          // Time-entry firm fields: admin / billing clerk.
          const appliesTo = String(body.appliesTo || 'matter');
          const allowed = appliesTo === 'client'
            ? ['admin', 'billing_clerk', 'attorney', 'paralegal']
            : appliesTo === 'time_entry'
              ? ['admin', 'billing_clerk']
              : ['admin'];
          if (!roleGate(user, res, allowed)) return;
          return json(res, 201, customFields.createCustomField(db, user, body));
        } catch (e) {
          const status = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, status, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/custom-fields\/\d+$/)) {
        try {
          const fieldId = Number(pathname.split('/')[3]);
          const existing = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(fieldId);
          if (!existing) return json(res, 404, { error: 'not found', message: 'Field not found' });
          // Matter/contact record-only fields: editors. Firm/type defaults: admin (or clerk for non-matter).
          const isRecordOnly = !!(existing.matter_id || existing.client_id);
          const appliesTo = String(existing.applies_to || 'matter');
          const allowed = isRecordOnly
            ? ['admin', 'billing_clerk', 'attorney', 'paralegal']
            : appliesTo === 'matter'
              ? ['admin']
              : ['admin', 'billing_clerk'];
          if (!roleGate(user, res, allowed)) return;
          const body = await parseBody(req);
          return json(res, 200, customFields.updateCustomField(db, user, fieldId, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/custom-fields\/\d+$/)) {
        const fieldId = Number(pathname.split('/')[3]);
        const existing = db.prepare('SELECT * FROM custom_fields WHERE id = ?').get(fieldId);
        if (!existing) return json(res, 404, { error: 'not found', message: 'Field not found' });
        const isRecordOnly = !!(existing.matter_id || existing.client_id);
        const allowed = isRecordOnly
          ? ['admin', 'billing_clerk', 'attorney', 'paralegal']
          : ['admin'];
        if (!roleGate(user, res, allowed)) return;
        return json(res, 200, customFields.deactivateCustomField(db, user, fieldId));
      }

      // Firm report catalog (enable/disable for the firm)
      if (req.method === 'GET' && pathname === '/api/firm-reports') {
        try {
          permissions.assertCanViewRecords(db, user, 'report');
          const includeDisabled = url.searchParams.get('includeDisabled') === '1';
          return json(res, 200, customReports.listFirmReports(db, { includeDisabled }));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/firm-reports\/[^/]+$/)) {
        try {
          const id = decodeURIComponent(pathname.split('/')[3]);
          return json(res, 200, customReports.disableFirmReport(db, user, id));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/firm-reports\/[^/]+\/restore$/)) {
        try {
          const id = decodeURIComponent(pathname.split('/')[3]);
          return json(res, 200, customReports.enableFirmReport(db, user, id));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }

      // Custom reports & dashboard
      if (req.method === 'GET' && pathname === '/api/custom-reports') {
        try {
          return json(res, 200, customReports.listReports(db, { actor: user }));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/custom-reports') {
        try {
          const body = await parseBody(req);
          return json(res, 201, customReports.createReport(db, user, body));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/custom-reports\/\d+\/run$/)) {
        try {
          const id = Number(pathname.split('/')[3]);
          return json(res, 200, customReports.runReport(db, id, user));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 404;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/custom-reports\/\d+\/export$/)) {
        try {
          const id = Number(pathname.split('/')[3]);
          const fmt = url.searchParams.get('format') || 'xlsx';
          const file = customReports.exportCustomReport(db, id, fmt, user);
          res.writeHead(200, {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': file.body.length,
          });
          res.end(file.body);
          return;
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 404;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/custom-reports\/\d+$/)) {
        try {
          const id = Number(pathname.split('/')[3]);
          const body = await parseBody(req);
          const editingDefinition = [
            'name', 'description', 'source', 'groupByFieldId', 'metric', 'chartType',
          ].some((key) => body[key] !== undefined);
          if (editingDefinition) {
            return json(res, 200, customReports.updateReport(db, user, id, body));
          }
          if (body.showOnDashboard === undefined) {
            return json(res, 400, { error: 'showOnDashboard is required', message: 'showOnDashboard is required' });
          }
          return json(res, 200, customReports.setShowOnDashboard(db, user, id, body.showOnDashboard));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 404;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/custom-reports\/\d+$/)) {
        try {
          const id = Number(pathname.split('/')[3]);
          return json(res, 200, customReports.deactivateReport(db, user, id));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 404;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/dashboard') {
        try {
          return json(res, 200, customReports.dashboard(db, user));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/dashboard/pin') {
        try {
          const body = await parseBody(req);
          return json(res, 200, customReports.pinDashboardReport(db, user, body));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/dashboard/unpin') {
        try {
          const body = await parseBody(req);
          return json(res, 200, customReports.unpinDashboardReport(db, user, body));
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/dashboard/export') {
        try {
          const fmt = url.searchParams.get('format') || 'pdf';
          const file = customReports.exportDashboard(db, fmt, user);
          res.writeHead(200, {
            'Content-Type': file.contentType,
            'Content-Disposition': `attachment; filename="${file.filename}"`,
            'Content-Length': file.body.length,
          });
          res.end(file.body);
          return;
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }

      if (req.method === 'PUT' && pathname.match(/^\/api\/layouts\/\d+\/items$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const layoutId = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, customFields.saveLayoutItems(db, user, layoutId, body.items || []));
      }

      // Time
      if (req.method === 'GET' && pathname === '/api/time-entries/earliest-date') {
        try {
          const matterId = url.searchParams.get('matterId');
          if (!matterId) {
            return json(res, 400, { error: 'matterId is required', message: 'matterId is required' });
          }
          const bounds = timeSvc.serviceDateBounds(db, Number(matterId), user);
          return json(res, 200, {
            matterId: Number(matterId),
            earliestDate: bounds.earliestDate,
            latestDate: bounds.latestDate,
          });
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/time-entries') {
        try {
          const matterId = url.searchParams.get('matterId');
          const status = url.searchParams.get('status');
          return json(res, 200, timeSvc.listEntries(db, {
            matterId: matterId ? Number(matterId) : null,
            status,
          }, user));
        } catch (e) {
          return json(res, 403, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/settings') {
        return json(res, 200, readSettings(db));
      }
      if (req.method === 'PATCH' && pathname === '/api/settings') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        if (body.roundIncrementMinutes != null) {
          const minutes = assertAllowedIncrement(Number(body.roundIncrementMinutes));
          setSetting(db, 'round_increment_minutes', String(minutes));
        }
        if (body.roundMode != null) {
          setSetting(db, 'round_mode', assertRoundMode(body.roundMode));
        }
        if (body.durationFormat != null) {
          setSetting(db, 'duration_format', assertDurationFormat(body.durationFormat));
        }
        if (body.firmTimezone != null || body.firm_timezone != null) {
          const tz = timezones.assertTimeZone(body.firmTimezone ?? body.firm_timezone);
          setSetting(db, 'firm_timezone', tz);
        }
        if (body.msGraphAccessToken !== undefined) {
          if (!roleGate(user, res, ['admin'])) return;
          const onedrive = require('../services/onedrive');
          onedrive.setGraphToken(db, user, body.msGraphAccessToken);
        }
        if (body.msClientId !== undefined || body.msTenantId !== undefined || body.msClientSecret !== undefined) {
          if (!roleGate(user, res, ['admin'])) return;
          const msAuth = require('../services/msAuth');
          msAuth.saveAppConfig(db, user, {
            clientId: body.msClientId,
            tenantId: body.msTenantId,
            clientSecret: body.msClientSecret,
          });
        }
        if (body.emailConfig) {
          if (!roleGate(user, res, ['admin'])) return;
          if (!mail.outboundEmailEnabled()) {
            return json(res, 503, {
              error: 'mail_deferred',
              message: 'Email settings are unavailable until a live domain is ready.',
            }, req);
          }
          mail.saveMailConfig(db, user, body.emailConfig);
        }
        if (body.contactStandardFields !== undefined) {
          const clientsSvc = require('../services/clients');
          clientsSvc.setEnabledContactStandardKeys(db, user, body.contactStandardFields);
        }
        if (body.billFields !== undefined) {
          if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
          invoiceSvc.setBillFields(db, user, body.billFields);
        }
        if (body.matterNameFormula !== undefined) {
          if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
          matterSvc.setMatterNameFormula(db, user, body.matterNameFormula);
        }
        if (
          body.rolePermissions !== undefined
          || body.profilePermissions !== undefined
          || body.recordPageLayout !== undefined
          || body.fieldPermissions !== undefined
          || body.addRole !== undefined
        ) {
          if (!roleGate(user, res, ['admin'])) return;
          const permissions = require('../services/permissions');
          if (body.addRole !== undefined) {
            try {
              permissions.addCustomRole(db, user, body.addRole || {});
            } catch (e) {
              return json(res, 400, { error: e.message, message: e.message }, req);
            }
          }
          if (body.rolePermissions !== undefined) {
            permissions.setRolePermissions(db, user, body.rolePermissions);
          } else if (body.profilePermissions !== undefined) {
            permissions.setRolePermissions(db, user, body.profilePermissions);
          }
          if (body.fieldPermissions !== undefined) {
            permissions.setRecordPageLayout(db, user, body.fieldPermissions);
          } else if (body.recordPageLayout !== undefined) {
            permissions.setRecordPageLayout(db, user, body.recordPageLayout);
          }
        }
        return json(res, 200, readSettings(db));
      }

      if (req.method === 'POST' && pathname === '/api/settings/email/test') {
        if (!roleGate(user, res, ['admin'])) return;
        if (!mail.outboundEmailEnabled()) {
          return json(res, 503, {
            error: 'mail_deferred',
            message: 'Outbound email is deferred until a live domain is ready.',
          }, req);
        }
        const body = await parseBody(req);
        const to = String(body.to || user.email || '').trim().toLowerCase();
        try {
          const delivery = await mail.sendMail({
            db,
            to,
            subject: 'Firm Billing test email',
            text: 'This is a test email from Firm Billing. Email delivery is working — you should see this in Gmail or any other inbox.',
            html: '<p>This is a test email from <strong>Firm Billing</strong>. Email delivery is working — you should see this in Gmail or any other inbox.</p>',
            allowLog: false,
          });
          return json(res, 200, { ok: true, delivery });
        } catch (e) {
          return json(res, 400, { error: e.code || 'mail_error', message: e.message });
        }
      }

      if (req.method === 'POST' && pathname === '/api/onedrive/connect/start') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const msAuth = require('../services/msAuth');
        try {
          return json(res, 200, await msAuth.startDeviceCode(db, user));
        } catch (e) {
          return json(res, 400, {
            error: e.code || e.message,
            message: e.message,
          });
        }
      }
      // One-click: optional first-time clientId save, then return browser login URL
      if (req.method === 'POST' && pathname === '/api/onedrive/connect/quick') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const msAuth = require('../services/msAuth');
        const body = await parseBody(req);
        try {
          if (body.clientId && String(body.clientId).trim()) {
            if (user.role !== 'admin') {
              return json(res, 403, {
                error: 'admin_required',
                message: 'An admin must save the Application (client) ID once for the firm.',
              });
            }
            msAuth.saveAppConfig(db, user, {
              clientId: body.clientId,
              tenantId: body.tenantId || 'common',
            });
          }
          if (!msAuth.connectionStatus(db).clientConfigured) {
            return json(res, 400, {
              error: 'missing_client_id',
              message: 'Microsoft sign-in is not configured on this server. Set MS_CLIENT_ID in the environment (one Azure app for the product), then restart.',
            });
          }
          const redirectUri = security.oauthRedirectUri(req);
          const started = msAuth.startAuthCode(db, user, { redirectUri });
          return json(res, 200, { authUrl: started.authUrl, microsoft: msAuth.connectionStatus(db) });
        } catch (e) {
          return json(res, 400, {
            error: e.code || e.message,
            message: e.message,
          });
        }
      }
      if (req.method === 'POST' && pathname === '/api/onedrive/connect/poll') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const msAuth = require('../services/msAuth');
        const body = await parseBody(req);
        try {
          return json(res, 200, await msAuth.pollDeviceCode(db, user, body.deviceCode));
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'GET' && pathname === '/api/onedrive/connect/login') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const msAuth = require('../services/msAuth');
        try {
          const redirectUri = security.oauthRedirectUri(req);
          const started = msAuth.startAuthCode(db, user, { redirectUri });
          res.writeHead(302, withSecHeaders(req, { Location: started.authUrl }));
          res.end();
          return;
        } catch (e) {
          return json(res, 400, { error: e.message });
        }
      }
      if (req.method === 'POST' && pathname === '/api/onedrive/disconnect') {
        if (!roleGate(user, res, ['admin'])) return;
        const msAuth = require('../services/msAuth');
        return json(res, 200, { microsoft: msAuth.disconnect(db, user), ...readSettings(db) });
      }

      if (req.method === 'POST' && pathname === '/api/time-entries') {
        try {
          const body = await parseBody(req);
          const customValues = {};
          if (body.customValues && typeof body.customValues === 'object') {
            Object.assign(customValues, body.customValues);
          }
          for (const [key, value] of Object.entries(body)) {
            if (key.startsWith('cf_')) {
              customValues[key.slice(3)] = value;
            }
          }
          const hoursNum = body.hours != null && body.hours !== '' ? Number(body.hours) : NaN;
          const minutesNum = body.rawMinutes != null && body.rawMinutes !== ''
            ? Number(body.rawMinutes)
            : NaN;
          const entry = timeSvc.createEntry(db, user, {
            matterId: Number(body.matterId),
            timekeeperId: Number(body.timekeeperId || user.id),
            serviceDate: body.serviceDate,
            hours: Number.isFinite(hoursNum) ? hoursNum : undefined,
            rawMinutes: Number.isFinite(minutesNum) ? minutesNum : undefined,
            description: body.description,
            billable: body.billable == null ? null : (body.billable ? 1 : 0),
            category: body.category,
            subcategory: body.subcategory,
            utbmsTask: body.utbmsTask,
            utbmsActivity: body.utbmsActivity,
            roundIncrementMinutes: body.roundIncrementMinutes != null
              ? Number(body.roundIncrementMinutes) : undefined,
            customValues,
          });
          return json(res, 201, entry);
        } catch (e) {
          const code = e.code === 'FORBIDDEN' ? 403 : 400;
          return json(res, code, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/time-entries\/\d+\/?$/)) {
        try {
          const id = Number(pathname.split('/').filter(Boolean)[2]);
          if (!Number.isFinite(id) || id <= 0) {
            return json(res, 400, { error: 'invalid_id', message: 'Invalid time entry id' }, req);
          }
          const body = await parseBody(req);
          const customValues = {};
          if (body.customValues && typeof body.customValues === 'object') {
            Object.assign(customValues, body.customValues);
          }
          for (const [key, value] of Object.entries(body)) {
            if (key.startsWith('cf_')) {
              customValues[key.slice(3)] = value;
            }
          }
          const hoursNum = body.hours != null && body.hours !== '' ? Number(body.hours) : NaN;
          const minutesNum = body.rawMinutes != null && body.rawMinutes !== ''
            ? Number(body.rawMinutes)
            : NaN;
          const updated = timeSvc.updateEntry(db, user, id, {
            matterId: body.matterId != null ? Number(body.matterId) : undefined,
            timekeeperId: body.timekeeperId != null ? Number(body.timekeeperId) : undefined,
            serviceDate: body.serviceDate,
            hours: Number.isFinite(hoursNum) ? hoursNum : undefined,
            rawMinutes: Number.isFinite(minutesNum) ? minutesNum : undefined,
            description: body.description,
            billable: body.billable == null ? undefined : (body.billable ? 1 : 0),
            category: body.category,
            subcategory: body.subcategory,
            utbmsTask: body.utbmsTask,
            utbmsActivity: body.utbmsActivity,
            roundIncrementMinutes: body.roundIncrementMinutes != null
              ? Number(body.roundIncrementMinutes) : undefined,
            customValues: Object.keys(customValues).length ? customValues : undefined,
          });
          return json(res, 200, updated, req);
        } catch (e) {
          const notFound = /not found$/i.test(String(e.message || ''));
          const code = e.code === 'FORBIDDEN' ? 403 : notFound ? 404 : 400;
          return json(res, code, { error: e.message, message: e.message }, req);
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/time-entries\/\d+\/?$/)) {
        try {
          const id = Number(pathname.split('/').filter(Boolean)[2]);
          if (!Number.isFinite(id) || id <= 0) {
            return json(res, 400, { error: 'invalid_id', message: 'Invalid time entry id' }, req);
          }
          return json(res, 200, timeSvc.deleteEntry(db, user, id), req);
        } catch (e) {
          const notFound = /not found$/i.test(String(e.message || ''));
          const code = e.code === 'FORBIDDEN' ? 403 : notFound ? 404 : 400;
          return json(res, code, { error: e.message, message: e.message }, req);
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/submit$/)) {
        const id = Number(pathname.split('/')[3]);
        return json(res, 200, timeSvc.submitEntry(db, user, id));
      }
      if (req.method === 'GET' && pathname === '/api/approval-queue') {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        return json(res, 200, timeSvc.listQueue(db));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/approve$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        const id = Number(pathname.split('/')[3]);
        return json(res, 200, timeSvc.approveEntry(db, user, id));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/reject$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, timeSvc.rejectEntry(db, user, id, body.reason));
      }

      // Invoices
      if (req.method === 'GET' && pathname === '/api/invoices') {
        return json(res, 200, invoiceSvc.listInvoices(db));
      }
      if (req.method === 'GET' && pathname === '/api/billing/ready') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        return json(res, 200, invoiceSvc.listMattersReadyForBilling(db));
      }
      if (req.method === 'GET' && pathname === '/api/billing/fields') {
        return json(res, 200, invoiceSvc.getBillFieldConfig(db));
      }
      if (req.method === 'POST' && pathname === '/api/billing/fields') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        try {
          const body = await parseBody(req);
          return json(res, 200, invoiceSvc.addBillField(db, user, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'DELETE' && pathname === '/api/billing/fields') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        try {
          const group = url.searchParams.get('group');
          const key = url.searchParams.get('key');
          return json(res, 200, invoiceSvc.removeBillField(db, user, { group, key }));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'PUT' && pathname === '/api/billing/fields') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        try {
          const body = await parseBody(req);
          return json(res, 200, invoiceSvc.setBillFields(db, user, body));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/invoices\/\d+\/?$/)) {
        const id = Number(pathname.split('/').filter(Boolean)[2]);
        const inv = invoiceSvc.getInvoice(db, id);
        if (!inv) return json(res, 404, { error: 'not found', message: 'Invoice not found' });
        return json(res, 200, inv);
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/invoices\/\d+\/export$/)) {
        const id = Number(pathname.split('/')[3]);
        const inv = invoiceSvc.getInvoice(db, id);
        if (!inv) return json(res, 404, { error: 'not found' });
        const fields = invoiceSvc.getBillFields(db);
        const fmt = String(url.searchParams.get('format') || 'pdf').toLowerCase();
        const safeName = String(inv.number || `invoice-${id}`).replace(/[^\w.-]+/g, '_');
        const templateIdRaw = url.searchParams.get('templateId');
        const useTemplate = fmt === 'docx' || fmt === 'template'
          || url.searchParams.get('useTemplate') === '1'
          || templateIdRaw;
        if (useTemplate) {
          let template = null;
          if (templateIdRaw) template = invoiceTemplates.getTemplate(db, Number(templateIdRaw));
          else template = invoiceTemplates.getDefaultTemplate(db);
          if (!template || !template.active) {
            return json(res, 404, {
              error: 'template_not_found',
              message: 'No invoice template selected. Upload one under Settings → Invoice templates.',
            }, req);
          }
          try {
            const rendered = invoiceTemplates.renderInvoiceWithTemplate(db, inv, template);
            res.writeHead(200, {
              'Content-Type': rendered.contentType,
              'Content-Disposition': `attachment; filename="${rendered.fileName}"`,
              'Content-Length': rendered.buffer.length,
            });
            res.end(rendered.buffer);
            return;
          } catch (e) {
            return json(res, 400, { error: e.message, message: e.message }, req);
          }
        }
        if (fmt === 'xlsx' || fmt === 'excel') {
          const buf = invoiceSvc.toInvoiceXlsx(inv, fields);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${safeName}.xlsx"`,
            'Content-Length': buf.length,
          });
          res.end(buf);
          return;
        }
        if (fmt === 'pdf') {
          const buf = invoiceSvc.toInvoicePdf(inv, fields);
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${safeName}.pdf"`,
            'Content-Length': buf.length,
          });
          res.end(buf);
          return;
        }
        return json(res, 400, {
          error: 'unsupported_format',
          message: 'Use format=pdf, xlsx, or docx (with a Word/Adobe template)',
        });
      }

      // Invoice templates (Word / Adobe merge fields)
      if (req.method === 'GET' && pathname === '/api/invoice-templates/merge-fields') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        return json(res, 200, { fields: invoiceTemplates.listMergeFields() }, req);
      }
      if (req.method === 'GET' && pathname === '/api/invoice-templates/sample') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        const kind = String(url.searchParams.get('format') || 'docx').toLowerCase();
        let buf;
        let type;
        let filename;
        if (kind === 'pdf') {
          buf = invoiceTemplates.samplePdfBuffer();
          type = 'application/pdf';
          filename = 'invoice-template-sample.pdf';
        } else if (kind === 'txt') {
          buf = invoiceTemplates.sampleTxtBuffer();
          type = 'text/plain; charset=utf-8';
          filename = 'invoice-template-sample.txt';
        } else {
          buf = invoiceTemplates.sampleDocxBuffer();
          type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
          filename = 'invoice-template-sample.docx';
        }
        res.writeHead(200, {
          'Content-Type': type,
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Content-Length': buf.length,
        });
        res.end(buf);
        return;
      }
      if (req.method === 'GET' && pathname === '/api/invoice-templates') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        return json(res, 200, { templates: invoiceTemplates.listTemplates(db) }, req);
      }
      if (req.method === 'POST' && pathname === '/api/invoice-templates') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        let body;
        try {
          body = await security.parseBodyLimited(req, {
            limit: Math.max(security.MAX_BODY_BYTES, invoiceTemplates.MAX_TEMPLATE_BYTES + 64_000),
          });
        } catch (e) {
          if (e.code === 'PAYLOAD_TOO_LARGE') {
            return json(res, 413, { error: 'payload_too_large', message: 'Template file too large' }, req);
          }
          throw e;
        }
        try {
          const created = invoiceTemplates.createTemplate(db, user, body);
          return json(res, 201, created, req);
        } catch (e) {
          return json(res, e.status || 400, { error: e.code || 'error', message: e.message }, req);
        }
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/invoice-templates\/\d+\/download$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        const id = Number(pathname.split('/')[3]);
        const row = invoiceTemplates.getTemplate(db, id);
        if (!row || !row.active) return json(res, 404, { error: 'not found' }, req);
        const buf = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
        const types = {
          docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          pdf: 'application/pdf',
          txt: 'text/plain; charset=utf-8',
        };
        res.writeHead(200, {
          'Content-Type': types[row.format] || 'application/octet-stream',
          'Content-Disposition': `attachment; filename="${String(row.file_name || 'template').replace(/[^\w.\-]+/g, '_')}"`,
          'Content-Length': buf.length,
        });
        res.end(buf);
        return;
      }
      if (req.method === 'PATCH' && pathname.match(/^\/api\/invoice-templates\/\d+\/?$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        const id = Number(pathname.split('/').filter(Boolean)[2]);
        const body = await parseBody(req);
        try {
          return json(res, 200, invoiceTemplates.updateTemplate(db, user, id, body), req);
        } catch (e) {
          return json(res, e.status || 400, { error: e.message, message: e.message }, req);
        }
      }
      if (req.method === 'DELETE' && pathname.match(/^\/api\/invoice-templates\/\d+\/?$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'], req)) return;
        const id = Number(pathname.split('/').filter(Boolean)[2]);
        try {
          return json(res, 200, invoiceTemplates.deleteTemplate(db, user, id), req);
        } catch (e) {
          return json(res, e.status || 400, { error: e.message, message: e.message }, req);
        }
      }
      if (
        req.method === 'POST'
        && (pathname === '/api/invoices/bill' || pathname === '/api/invoices/prebill')
      ) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        try {
          return json(res, 201, invoiceSvc.createBill(db, user, Number(body.matterId), {
            entryIds: body.entryIds || null,
            dateFrom: body.dateFrom || null,
            dateTo: body.dateTo || null,
          }));
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/invoice-lines\/\d+\/write-down$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, invoiceSvc.writeDownLine(db, user, id, Number(body.deltaCents), body.reason));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/invoices\/\d+\/status$/)) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, invoiceSvc.setStatus(db, user, id, body.status));
      }
      if (
        (req.method === 'DELETE' && pathname.match(/^\/api\/invoices\/\d+\/?$/))
        || (req.method === 'POST' && pathname.match(/^\/api\/invoices\/\d+\/delete\/?$/))
      ) {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const id = Number(pathname.split('/').filter(Boolean)[2]);
        if (!Number.isFinite(id) || id <= 0) {
          return json(res, 400, { error: 'invalid_id', message: 'Invalid invoice id' }, req);
        }
        try {
          return json(res, 200, invoiceSvc.deleteInvoice(db, user, id), req);
        } catch (e) {
          const status = /not found/i.test(e.message) ? 404 : 400;
          return json(res, status, { error: e.message, message: e.message }, req);
        }
      }

      // Payments
      if (req.method === 'GET' && pathname === '/api/payments') {
        return json(res, 200, paymentSvc.listPayments(db));
      }
      if (req.method === 'POST' && pathname === '/api/payments') {
        if (!roleGate(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        return json(res, 201, paymentSvc.recordPayment(db, user, {
          clientId: Number(body.clientId),
          amountCents: Number(body.amountCents),
          receivedOn: body.receivedOn,
          method: body.method,
          reference: body.reference,
          notes: body.notes,
          applications: body.applications,
        }));
      }

      // Reports
      if (req.method === 'GET' && pathname.startsWith('/api/reports/')) {
        const name = pathname.slice('/api/reports/'.length);
        const matterIdRaw = url.searchParams.get('matterId');
        const matterId = matterIdRaw ? Number(matterIdRaw) : null;
        const fmt = url.searchParams.get('format') || 'json';
        let currencyKeys = ['amount_cents', 'rate_cents', 'balance_cents', 'wip_cents',
          'billed_cents', 'write_down_cents', 'net_billed_cents', 'collected_cents', 'delta_cents'];

        // Matter-scoped lodestar PDFs / Excels (demo-style)
        if (name === 'lodestar-matter-detail' || name === 'lodestar-matter-summary') {
          try {
            permissions.assertCanViewRecords(db, user, 'report');
          } catch (e) {
            return json(res, e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message, message: e.message });
          }
          if (!matterId) {
            return json(res, 400, { error: 'matterId required', message: 'Select a matter for this report.' });
          }
          const dateOpts = {
            dateFrom: url.searchParams.get('dateFrom') || null,
            dateTo: url.searchParams.get('dateTo') || null,
          };
          try {
            if (fmt === 'pdf') {
              const buf = name === 'lodestar-matter-detail'
                ? reports.lodestarMatterDetailPdf(db, matterId, dateOpts)
                : reports.lodestarMatterSummaryPdf(db, matterId, dateOpts);
              res.writeHead(200, {
                'Content-Type': 'application/pdf',
                'Content-Disposition': `attachment; filename="${name}-${matterId}.pdf"`,
                'Content-Length': buf.length,
              });
              res.end(buf);
              return;
            }
            if (fmt === 'xlsx' || fmt === 'excel') {
              const buf = name === 'lodestar-matter-detail'
                ? reports.lodestarMatterDetailXlsx(db, matterId, dateOpts)
                : reports.lodestarMatterSummaryXlsx(db, matterId, dateOpts);
              res.writeHead(200, {
                'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'Content-Disposition': `attachment; filename="${name}-${matterId}.xlsx"`,
                'Content-Length': buf.length,
              });
              res.end(buf);
              return;
            }
            const payload = name === 'lodestar-matter-detail'
              ? reports.lodestarMatterDetail(db, matterId, dateOpts)
              : reports.lodestarMatterSummary(db, matterId, dateOpts);
            return json(res, 200, payload);
          } catch (e) {
            return json(res, 400, { error: e.message, message: e.message });
          }
        }

        try {
          permissions.assertCanViewRecords(db, user, 'report');
        } catch (e) {
          return json(res, e.code === 'FORBIDDEN' ? 403 : 400, { error: e.message, message: e.message });
        }

        if (['matters', 'lodestar-summary', 'lodestar-detail'].includes(name)
          && customReports.getDisabledFirmReportIds(db).includes(name)) {
          return json(res, 404, {
            error: 'This firm report has been removed',
            message: 'This firm report has been removed',
          });
        }

        const dateFrom = url.searchParams.get('dateFrom') || null;
        const dateTo = url.searchParams.get('dateTo') || null;
        let rows;
        try {
          if (name === 'lodestar-summary') {
            rows = reports.lodestarSummary(db, { matterId, dateFrom, dateTo });
          } else if (name === 'lodestar-detail') {
            rows = reports.lodestarDetail(db, { matterId, dateFrom, dateTo });
          } else if (name === 'matters') rows = reports.mattersReport(db);
          else if (name === 'ar-aging') rows = reports.arAging(db);
          else if (name === 'write-offs') rows = reports.writeOffs(db);
          else if (name === 'realization') rows = reports.realization(db);
          else if (name === 'unapplied-cash') rows = paymentSvc.unappliedCash(db);
          else return json(res, 404, { error: 'unknown report' });
        } catch (e) {
          return json(res, 400, { error: e.message, message: e.message });
        }

        if (fmt === 'csv') {
          return text(res, 200, reports.toCsv(rows), 'text/csv; charset=utf-8');
        }
        if (fmt === 'xlsx') {
          const buf = reports.toXlsx(rows, currencyKeys);
          res.writeHead(200, {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="${name}.xlsx"`,
            'Content-Length': buf.length,
          });
          res.end(buf);
          return;
        }
        if (fmt === 'pdf') {
          let buf;
          if (name === 'lodestar-summary') {
            buf = reports.lodestarFirmSummaryPdf(db, { matterId, dateFrom, dateTo });
          } else if (name === 'lodestar-detail') {
            buf = reports.lodestarFirmDetailPdf(db, { matterId, dateFrom, dateTo });
          } else {
            const titles = {
              matters: 'Matters Report',
              'ar-aging': 'AR Aging',
              'write-offs': 'Write-offs',
              realization: 'Realization',
              'unapplied-cash': 'Unapplied Cash',
            };
            buf = reports.toPdf(rows, {
              title: titles[name] || name,
              currencyKeys,
            });
          }
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': `attachment; filename="${name}.pdf"`,
            'Content-Length': buf.length,
          });
          res.end(buf);
          return;
        }
        return json(res, 200, rows);
      }

      if (req.method === 'GET' && pathname === '/api/audit-log') {
        if (!roleGate(user, res, ['admin'])) return;
        return json(res, 200, db.prepare(`
          SELECT a.*, u.email AS actor_email
          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          ORDER BY a.id DESC LIMIT 500
        `).all());
      }

      return json(res, 404, { error: 'not found' }, req);
    } catch (err) {
      if (err.code === 'PAYLOAD_TOO_LARGE') {
        return json(res, 413, { error: 'payload_too_large', message: 'Request body too large' }, req);
      }
      const status = err.status || (
        err.code === 'FORBIDDEN' ? 403
          : err.code === 'BILLING_RULE' ? 400
            : 400
      );
      if (status >= 500 || security.isProduction() || security.liveDomainConfigured()) {
        if (status >= 500) {
          console.error('[server]', err && err.stack ? err.stack : err);
        }
      }
      const payload = security.clientErrorPayload(
        { ...err, status, message: err.message, code: err.code, errors: err.errors },
        'Request failed'
      );
      // Preserve legacy shape for 4xx billing/validation in non-live envs
      if (status < 500 && !(security.isProduction() || security.liveDomainConfigured())) {
        return json(res, status, { error: err.message, message: err.message, errors: err.errors }, req);
      }
      if (status < 500) {
        return json(res, status, {
          error: payload.error,
          message: payload.message || err.message,
          errors: err.errors,
        }, req);
      }
      json(res, status >= 400 ? status : 500, payload, req);
    }
  });

  return server;
}

if (require.main === module) {
  const db = openDb(DEFAULT_DB);
  migrate(db);
  const server = createServer(db);
  const bindHost = process.env.BIND_HOST || '0.0.0.0';
  // Help detect stale processes after code deploys (delete routes, etc.).
  console.info(`[boot] firm-billing server build=${process.env.GIT_COMMIT || 'dev'} deleteInvoice=on`);
  server.listen(PORT, bindHost, () => {
    console.log(`Firm billing listening on http://${bindHost}:${PORT}`);
    console.log(`DB: ${DEFAULT_DB}`);
    if (security.isProduction() || security.liveDomainConfigured()) {
      console.log(
        `Hardened mode — cookieOnly=${security.cookieOnlyAuth()} `
        + `strictOrigin=${security.strictOriginEnforcement()} `
        + `liveDomain=${security.liveDomainConfigured()}`
      );
    }
  });
}

module.exports = { createServer };
