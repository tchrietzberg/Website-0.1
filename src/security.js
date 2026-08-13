import { randomBytes, timingSafeEqual } from "node:crypto";

const COOKIE = "it_csrf";

export function createSecurity(options = {}) {
  const rateMax = Number(options.rateMax ?? process.env.RATE_LIMIT_MAX ?? 8);
  const rateWindowMs = Number(options.rateWindowMs ?? 10 * 60 * 1000);
  const maxBody = Number(options.maxBody ?? 32 * 1024);
  const hits = new Map();

  function headers() {
    return {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy": [
        "default-src 'self'",
        "img-src 'self' data:",
        "style-src 'self' https://fonts.googleapis.com",
        "font-src https://fonts.gstatic.com",
        "script-src 'self'",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join("; "),
    };
  }

  function parseCookies(header) {
    const out = {};
    for (const part of String(header || "").split(";")) {
      const i = part.indexOf("=");
      if (i === -1) continue;
      out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function cookieHeader(token) {
    return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
  }

  function issueToken(req) {
    const existing = parseCookies(req.headers.cookie)[COOKIE];
    if (existing && existing.length >= 24) return { token: existing, setCookie: null };
    const token = randomBytes(24).toString("hex");
    return { token, setCookie: cookieHeader(token) };
  }

  function sameOrigin(req) {
    const host = req.headers.host;
    const origin = req.headers.origin;
    if (origin) {
      try {
        return new URL(origin).host === host;
      } catch {
        return false;
      }
    }
    const referer = req.headers.referer;
    if (!referer) return true;
    try {
      return new URL(referer).host === host;
    } catch {
      return false;
    }
  }

  function csrfOk(req) {
    const cookie = parseCookies(req.headers.cookie)[COOKIE] || "";
    const header = String(req.headers["x-csrf-token"] || "");
    if (cookie.length < 24 || header.length < 24 || cookie.length !== header.length) return false;
    return timingSafeEqual(Buffer.from(cookie), Buffer.from(header));
  }

  function clientKey(req) {
    return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "local")
      .split(",")[0]
      .trim();
  }

  function rateOk(req) {
    const key = clientKey(req);
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < rateWindowMs);
    if (recent.length >= rateMax) {
      hits.set(key, recent);
      return false;
    }
    recent.push(now);
    hits.set(key, recent);
    return true;
  }

  async function readJson(req) {
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > maxBody) {
        const error = new Error("Payload too large");
        error.status = 413;
        throw error;
      }
      chunks.push(chunk);
    }
    if (!chunks.length) return {};
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      const error = new Error("Invalid JSON");
      error.status = 400;
      throw error;
    }
  }

  function guardPost(req, body) {
    if (!sameOrigin(req)) return { ok: false, status: 403, error: "Bad origin." };
    if (!csrfOk(req)) return { ok: false, status: 403, error: "Missing or bad security token. Refresh and try again." };
    if (body && String(body.fax || body.website_extra || "").trim()) {
      return { ok: false, status: 400, error: "Rejected." };
    }
    if (body && body.agree !== true && body.agree !== "on") {
      return { ok: false, status: 400, field: "agree", error: "Please confirm this is a local Indiantown post." };
    }
    if (!rateOk(req)) return { ok: false, status: 429, error: "Too many posts. Wait a few minutes." };
    return { ok: true };
  }

  return { headers, issueToken, guardPost, readJson };
}

export function publicListing(row) {
  if (!row) return null;
  const { phone, email, ...rest } = row;
  return rest;
}

export function publicBusiness(row) {
  if (!row) return null;
  const { phone, email, ...rest } = row;
  return rest;
}
