import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

const COOKIE = "it_csrf";
const ADMIN_COOKIE = "it_admin";
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]", "::1", "0.0.0.0"]);

function parseHostPort(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  try {
    if (raw.includes("://")) {
      const url = new URL(raw);
      return {
        hostname: url.hostname.toLowerCase(),
        port: url.port || (url.protocol === "https:" ? "443" : "80"),
      };
    }
  } catch {
    return null;
  }
  const host = raw.split(",")[0].trim().toLowerCase();
  const ipv6 = host.match(/^\[([^\]]+)\](?::(\d+))?$/);
  if (ipv6) return { hostname: ipv6[1], port: ipv6[2] || "" };
  const cut = host.lastIndexOf(":");
  if (cut > 0 && /^\d+$/.test(host.slice(cut + 1))) {
    return { hostname: host.slice(0, cut), port: host.slice(cut + 1) };
  }
  return { hostname: host, port: "" };
}

function hostsMatch(a, b) {
  if (!a || !b) return false;
  const sameName = a.hostname === b.hostname || (LOOPBACK.has(a.hostname) && LOOPBACK.has(b.hostname));
  if (!sameName) return false;
  return !a.port || !b.port || a.port === b.port;
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || "").split(":");
  if (!salt || !hash) return false;
  const next = scryptSync(String(password), salt, 32);
  const prev = Buffer.from(hash, "hex");
  if (next.length !== prev.length) return false;
  return timingSafeEqual(prev, next);
}

export function createSecurity(options = {}) {
  const rateMax = Number(options.rateMax ?? process.env.RATE_LIMIT_MAX ?? 8);
  const rateWindowMs = Number(options.rateWindowMs ?? 10 * 60 * 1000);
  const maxBody = Number(options.maxBody ?? 32 * 1024);
  const hits = new Map();
  const adminSessions = new Map();

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
    const site = String(req.headers["sec-fetch-site"] || "");
    if (site === "same-origin") return true;

    const origin = String(req.headers.origin || "");
    const referer = String(req.headers.referer || "");
    const from = origin && origin !== "null" ? origin : referer;
    if (!from) return true;

    let incoming;
    try {
      incoming = parseHostPort(from);
    } catch {
      return false;
    }
    if (!incoming) return false;

    for (const raw of [req.headers.host, req.headers["x-forwarded-host"]]) {
      for (const part of String(raw || "").split(",")) {
        if (hostsMatch(incoming, parseHostPort(part.trim()))) return true;
      }
    }
    return false;
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

  function rateOk(req, max = rateMax) {
    const key = clientKey(req);
    const now = Date.now();
    const recent = (hits.get(key) || []).filter((t) => now - t < rateWindowMs);
    if (recent.length >= max) {
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

  function guardWrite(req, body, { requireAgree = true, maxHits } = {}) {
    if (!sameOrigin(req)) return { ok: false, status: 403, error: "Bad origin." };
    if (!csrfOk(req)) return { ok: false, status: 403, error: "Missing or bad security token. Refresh and try again." };
    if (body && String(body.fax || body.website_extra || "").trim()) {
      return { ok: false, status: 400, error: "Rejected." };
    }
    if (requireAgree && body && body.agree !== true && body.agree !== "on") {
      return { ok: false, status: 400, field: "agree", error: "Please confirm this is a local Indiantown post." };
    }
    if (!rateOk(req, maxHits)) return { ok: false, status: 429, error: "Too many posts. Wait a few minutes." };
    return { ok: true };
  }

  function guardPost(req, body) {
    return guardWrite(req, body, { requireAgree: true });
  }

  function createAdminSession(email) {
    const token = randomBytes(24).toString("hex");
    adminSessions.set(token, { email, exp: Date.now() + 8 * 60 * 60 * 1000 });
    return token;
  }

  function adminFromReq(req) {
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE] || "";
    const row = adminSessions.get(token);
    if (!row || row.exp < Date.now()) return null;
    return row;
  }

  function adminCookie(token) {
    return `${ADMIN_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800`;
  }

  function clearAdminSession(req) {
    const token = parseCookies(req.headers.cookie)[ADMIN_COOKIE] || "";
    adminSessions.delete(token);
  }

  function clearAdminCookie() {
    return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  return {
    headers,
    issueToken,
    guardPost,
    guardWrite,
    readJson,
    parseCookies,
    createAdminSession,
    adminFromReq,
    clearAdminSession,
    adminCookie,
    clearAdminCookie,
  };
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
