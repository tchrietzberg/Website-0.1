'use strict';

const IS_PROD = process.env.NODE_ENV === 'production';
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 30;
const buckets = new Map();

function liveDomainConfigured() {
  const origin = String(process.env.PUBLIC_ORIGIN || '').trim();
  return /^https:\/\//i.test(origin);
}

function requestIsSecure(req) {
  if (!req || !req.headers) return false;
  if (req.socket && req.socket.encrypted) return true;
  const proto = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase();
  return proto === 'https';
}

function clientIp(req) {
  const forwarded = String((req.headers && req.headers['x-forwarded-for']) || '')
    .split(',')[0]
    .trim();
  if (forwarded && /^[0-9a-fA-F.:]+$/.test(forwarded)) return forwarded;
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

function rateLimit(req) {
  const ip = clientIp(req);
  const now = Date.now();
  let bucket = buckets.get(ip);
  if (!bucket || bucket.resetAt <= now) {
    bucket = { count: 0, resetAt: now + RATE_WINDOW_MS };
    buckets.set(ip, bucket);
  }
  bucket.count += 1;
  if (bucket.count > RATE_MAX) {
    const err = new Error('Too many location lookups. Pause and try again in a minute.');
    err.status = 429;
    err.code = 'rate_limited';
    throw err;
  }
}

function securityHeaders(req, { isHtml = false } = {}) {
  const scriptSrc = IS_PROD ? "script-src 'self'" : "script-src 'self' 'unsafe-eval'";
  const headers = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(self), payment=()',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      scriptSrc,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: https://*.basemaps.cartocdn.com https://tile.openstreetmap.org https://*.tile.openstreetmap.org https://upload.wikimedia.org",
      "connect-src 'self'",
      "worker-src 'self'",
      "object-src 'none'",
      "media-src 'none'",
    ].join('; '),
  };
  if (IS_PROD || process.env.FORCE_HSTS === '1' || liveDomainConfigured() || requestIsSecure(req)) {
    const preload =
      IS_PROD || liveDomainConfigured() || process.env.HSTS_PRELOAD === '1' ? '; preload' : '';
    headers['Strict-Transport-Security'] = `max-age=31536000; includeSubDomains${preload}`;
  }
  if (isHtml) headers['Cache-Control'] = 'no-store';
  return headers;
}

function clientErrorPayload(err, fallback = 'Request failed') {
  const status = Number(err && err.status) || 500;
  const code = err && err.code;
  if (status < 500 && err && err.message) {
    return { error: code || 'error', message: String(err.message).slice(0, 300) };
  }
  if (IS_PROD || liveDomainConfigured()) {
    return { error: 'server_error', message: fallback };
  }
  return {
    error: code || 'server_error',
    message: String((err && err.message) || fallback).slice(0, 300),
  };
}

function resetRateLimits() {
  buckets.clear();
}

module.exports = {
  securityHeaders,
  rateLimit,
  clientErrorPayload,
  clientIp,
  liveDomainConfigured,
  requestIsSecure,
  resetRateLimits,
};
