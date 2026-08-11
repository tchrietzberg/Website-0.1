/**
 * TOTP (RFC 6238) MFA helpers — zero npm dependencies (Node crypto only).
 */
const crypto = require('node:crypto');

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const MFA_CHALLENGE_TTL_MS = Math.max(60_000, Number(process.env.MFA_CHALLENGE_TTL_MS || 5 * 60 * 1000));
const MFA_CHALLENGE_MAX_ATTEMPTS = Math.max(3, Number(process.env.MFA_CHALLENGE_MAX_ATTEMPTS || 5));

function ensureMfaSchema(db) {
  const cols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
  if (!cols.includes('mfa_enabled')) {
    db.exec('ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0');
  }
  if (!cols.includes('mfa_secret')) {
    db.exec('ALTER TABLE users ADD COLUMN mfa_secret TEXT');
  }
  if (!cols.includes('mfa_backup_hashes')) {
    db.exec('ALTER TABLE users ADD COLUMN mfa_backup_hashes TEXT');
  }
  if (!cols.includes('mfa_enabled_at')) {
    db.exec('ALTER TABLE users ADD COLUMN mfa_enabled_at TEXT');
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS mfa_challenges (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      ip TEXT,
      user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
    );
    CREATE INDEX IF NOT EXISTS idx_mfa_challenges_expires ON mfa_challenges(expires_at);
  `);
}

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  const clean = String(str || '').toUpperCase().replace(/=+$/g, '').replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function generateSecret(bytes = 20) {
  return base32Encode(crypto.randomBytes(bytes));
}

function hotp(secretBuf, counter) {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac('sha1', secretBuf).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const code = (
    ((hmac[offset] & 0x7f) << 24)
    | (hmac[offset + 1] << 16)
    | (hmac[offset + 2] << 8)
    | hmac[offset + 3]
  ) % 1_000_000;
  return String(code).padStart(6, '0');
}

function totp(secretBase32, { now = Date.now(), stepSec = 30, skew = 1 } = {}) {
  const secret = base32Decode(secretBase32);
  if (!secret.length) return [];
  const counter = Math.floor(now / 1000 / stepSec);
  const codes = [];
  const win = Number(skew);
  for (let w = -win; w <= win; w += 1) {
    codes.push(hotp(secret, counter + w));
  }
  return codes;
}

function verifyTotp(secretBase32, code, opts = {}) {
  const expected = String(code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(expected)) return false;
  const valid = totp(secretBase32, opts);
  const a = Buffer.from(expected);
  for (const c of valid) {
    const b = Buffer.from(c);
    if (a.length === b.length && crypto.timingSafeEqual(a, b)) return true;
  }
  return false;
}

function otpauthUrl({ secret, email, issuer = 'Chrono' }) {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret: String(secret || '').replace(/=+$/g, ''),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params}`;
}

function generateBackupCodes(count = 8) {
  const codes = [];
  for (let i = 0; i < count; i += 1) {
    codes.push(crypto.randomBytes(4).toString('hex'));
  }
  return codes;
}

function hashBackupCode(code) {
  return crypto.createHash('sha256').update(String(code || '').trim().toLowerCase()).digest('hex');
}

/** Encrypt MFA secret at rest when a session secret is available. */
function sealSecret(plain, keyMaterial) {
  const key = crypto.scryptSync(String(keyMaterial || 'dev'), 'firm-billing-mfa-v1', 32);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString('base64url')}.${tag.toString('base64url')}.${enc.toString('base64url')}`;
}

function openSecret(sealed, keyMaterial) {
  const raw = String(sealed || '');
  if (!raw.startsWith('v1.')) return raw; // legacy/plaintext fallback
  const parts = raw.split('.');
  if (parts.length !== 4) throw new Error('invalid mfa secret envelope');
  const key = crypto.scryptSync(String(keyMaterial || 'dev'), 'firm-billing-mfa-v1', 32);
  const iv = Buffer.from(parts[1], 'base64url');
  const tag = Buffer.from(parts[2], 'base64url');
  const enc = Buffer.from(parts[3], 'base64url');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

function userHasMfa(row) {
  return Boolean(row && Number(row.mfa_enabled) === 1 && row.mfa_secret);
}

function purgeExpiredChallenges(db) {
  ensureMfaSchema(db);
  db.prepare('DELETE FROM mfa_challenges WHERE expires_at < ?').run(Date.now());
}

function createChallenge(db, userId, req) {
  ensureMfaSchema(db);
  purgeExpiredChallenges(db);
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  const { clientIp } = require('./security');
  db.prepare(`
    INSERT INTO mfa_challenges(token, user_id, expires_at, attempts, ip, user_agent)
    VALUES (?, ?, ?, 0, ?, ?)
  `).run(
    token,
    userId,
    now + MFA_CHALLENGE_TTL_MS,
    clientIp(req),
    String((req && req.headers && req.headers['user-agent']) || '').slice(0, 240)
  );
  return { mfaToken: token, expiresInSec: Math.floor(MFA_CHALLENGE_TTL_MS / 1000) };
}

function consumeChallenge(db, mfaToken) {
  ensureMfaSchema(db);
  const token = String(mfaToken || '');
  if (!token) return null;
  const row = db.prepare(`
    SELECT c.token, c.user_id, c.expires_at, c.attempts,
           u.id, u.email, u.name, u.role, u.active, u.mfa_enabled, u.mfa_secret, u.mfa_backup_hashes
    FROM mfa_challenges c
    JOIN users u ON u.id = c.user_id
    WHERE c.token = ?
  `).get(token);
  if (!row) return null;
  if (!row.active || Number(row.mfa_enabled) !== 1) {
    db.prepare('DELETE FROM mfa_challenges WHERE token = ?').run(token);
    return null;
  }
  if (Number(row.expires_at) < Date.now()) {
    db.prepare('DELETE FROM mfa_challenges WHERE token = ?').run(token);
    return null;
  }
  if (Number(row.attempts) >= MFA_CHALLENGE_MAX_ATTEMPTS) {
    db.prepare('DELETE FROM mfa_challenges WHERE token = ?').run(token);
    return null;
  }
  return row;
}

function bumpChallengeAttempt(db, mfaToken) {
  db.prepare('UPDATE mfa_challenges SET attempts = attempts + 1 WHERE token = ?').run(mfaToken);
}

function deleteChallenge(db, mfaToken) {
  db.prepare('DELETE FROM mfa_challenges WHERE token = ?').run(mfaToken);
}

function verifyUserMfaCode(row, code, keyMaterial) {
  const expected = String(code || '').replace(/\s+/g, '');
  if (!row || !row.mfa_secret) return { ok: false, usedBackup: false };
  let secret;
  try {
    secret = openSecret(row.mfa_secret, keyMaterial);
  } catch {
    return { ok: false, usedBackup: false };
  }
  if (verifyTotp(secret, expected)) return { ok: true, usedBackup: false };

  // Backup codes (8 hex chars)
  if (!/^[a-f0-9]{8}$/i.test(expected)) return { ok: false, usedBackup: false };
  let hashes = [];
  try {
    hashes = JSON.parse(row.mfa_backup_hashes || '[]');
  } catch {
    hashes = [];
  }
  if (!Array.isArray(hashes) || !hashes.length) return { ok: false, usedBackup: false };
  const hashed = hashBackupCode(expected);
  const idx = hashes.findIndex((h) => {
    try {
      const a = Buffer.from(String(h));
      const b = Buffer.from(hashed);
      return a.length === b.length && crypto.timingSafeEqual(a, b);
    } catch {
      return false;
    }
  });
  if (idx < 0) return { ok: false, usedBackup: false };
  hashes.splice(idx, 1);
  return { ok: true, usedBackup: true, remainingBackupHashes: hashes };
}

function beginSetup(db, userId, email, keyMaterial) {
  ensureMfaSchema(db);
  const secret = generateSecret(20);
  const backupCodes = generateBackupCodes(8);
  const sealed = sealSecret(secret, keyMaterial);
  const backupHashes = backupCodes.map(hashBackupCode);
  db.prepare(`
    UPDATE users
    SET mfa_secret = ?, mfa_backup_hashes = ?, mfa_enabled = 0, mfa_enabled_at = NULL
    WHERE id = ?
  `).run(sealed, JSON.stringify(backupHashes), userId);
  return {
    secret,
    otpauthUrl: otpauthUrl({ secret, email, issuer: 'Chrono' }),
    backupCodes,
  };
}

function enableMfa(db, userId, code, keyMaterial) {
  ensureMfaSchema(db);
  const row = db.prepare(
    'SELECT id, email, mfa_secret, mfa_enabled FROM users WHERE id = ? AND active = 1'
  ).get(userId);
  if (!row || !row.mfa_secret) {
    throw Object.assign(new Error('MFA setup not started'), { status: 400, code: 'mfa_not_started' });
  }
  if (Number(row.mfa_enabled) === 1) {
    throw Object.assign(new Error('MFA already enabled'), { status: 400, code: 'mfa_already_enabled' });
  }
  let secret;
  try {
    secret = openSecret(row.mfa_secret, keyMaterial);
  } catch {
    throw Object.assign(new Error('MFA secret unavailable'), { status: 400, code: 'mfa_secret_error' });
  }
  if (!verifyTotp(secret, code)) {
    throw Object.assign(new Error('Invalid authenticator code'), { status: 401, code: 'invalid_mfa' });
  }
  db.prepare(`
    UPDATE users SET mfa_enabled = 1, mfa_enabled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(userId);
  return { ok: true };
}

function disableMfa(db, userId) {
  ensureMfaSchema(db);
  db.prepare(`
    UPDATE users
    SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_hashes = NULL, mfa_enabled_at = NULL
    WHERE id = ?
  `).run(userId);
  db.prepare('DELETE FROM mfa_challenges WHERE user_id = ?').run(userId);
  return { ok: true };
}

function mfaStatus(db, userId) {
  ensureMfaSchema(db);
  const row = db.prepare(
    'SELECT mfa_enabled, mfa_enabled_at, mfa_backup_hashes FROM users WHERE id = ?'
  ).get(userId);
  let backupRemaining = 0;
  try {
    const hashes = JSON.parse(row?.mfa_backup_hashes || '[]');
    backupRemaining = Array.isArray(hashes) ? hashes.length : 0;
  } catch {
    backupRemaining = 0;
  }
  return {
    enabled: Number(row?.mfa_enabled) === 1,
    enabledAt: row?.mfa_enabled_at || null,
    backupCodesRemaining: backupRemaining,
  };
}

module.exports = {
  ensureMfaSchema,
  generateSecret,
  verifyTotp,
  otpauthUrl,
  generateBackupCodes,
  hashBackupCode,
  sealSecret,
  openSecret,
  userHasMfa,
  createChallenge,
  consumeChallenge,
  bumpChallengeAttempt,
  deleteChallenge,
  verifyUserMfaCode,
  beginSetup,
  enableMfa,
  disableMfa,
  mfaStatus,
  base32Encode,
  base32Decode,
  MFA_CHALLENGE_TTL_MS,
  MFA_CHALLENGE_MAX_ATTEMPTS,
};
