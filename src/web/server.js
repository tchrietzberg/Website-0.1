import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMessage,
  createRoom,
  findAdmin,
  getRoom,
  hideMessage,
  listAllRooms,
  listApprovedRooms,
  listMessages,
  publicRoom,
  setRoomStatus,
} from "../chat.js";
import { isEmpty, needsChatSeed, openDb } from "../db.js";
import { ensureResources, seed, seedRooms } from "../../seed/seed.js";
import { createSecurity, publicBusiness, publicListing, verifyPassword } from "../security.js";
import { validateBusiness, validateListing, validateMessage, validateNews, validateRoom } from "../validate.js";
import {
  createBusiness,
  createListing,
  createNews,
  getBusiness,
  getListing,
  listBusinesses,
  listListings,
  listNews,
  listResources,
  searchAll,
  stats,
} from "../store.js";

const publicDir = join(fileURLToPath(new URL("./public", import.meta.url)));
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".json": "application/json; charset=utf-8",
};

function requireAdmin(req, res, send, security) {
  const admin = security.adminFromReq(req);
  if (!admin) {
    send(res, 401, { error: "Admin sign-in required." });
    return null;
  }
  return admin;
}

export function createApp(db = openDb(), security = createSecurity()) {
  if (isEmpty(db)) seed(db);
  else {
    if (needsChatSeed(db)) seedRooms(db);
    ensureResources(db);
  }

  function send(res, status, body, extra = {}) {
    const isJson = typeof body === "object" && !Buffer.isBuffer(body);
    const payload = isJson ? JSON.stringify(body) : body;
    res.writeHead(status, {
      ...security.headers(),
      "Content-Type": extra["Content-Type"] || (isJson ? "application/json; charset=utf-8" : "text/plain; charset=utf-8"),
      ...extra,
    });
    res.end(payload);
  }

  function serveStatic(req, res, url) {
    let path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = join(publicDir, path);
    if (!file.startsWith(publicDir)) {
      send(res, 403, { error: "Forbidden" });
      return true;
    }
    try {
      const stat = statSync(file);
      if (!stat.isFile()) return false;
      send(res, 200, readFileSync(file), { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
      return true;
    } catch {
      if (path !== "/index.html") {
        send(res, 200, readFileSync(join(publicDir, "index.html")), { "Content-Type": MIME[".html"] });
        return true;
      }
      return false;
    }
  }

  return async function handle(req, res) {
    const url = new URL(req.url, `http://${req.headers.host || "127.0.0.1"}`);
    const { pathname, searchParams } = url;

    try {
      if (pathname === "/api/session" && req.method === "GET") {
        const { token, setCookie } = security.issueToken(req);
        const admin = security.adminFromReq(req);
        return send(
          res,
          200,
          { csrf: token, admin: Boolean(admin) },
          setCookie ? { "Set-Cookie": setCookie } : {},
        );
      }
      if (pathname === "/api/stats" && req.method === "GET") {
        return send(res, 200, stats(db));
      }
      if (pathname === "/api/search" && req.method === "GET") {
        return send(res, 200, searchAll(db, searchParams.get("q") || ""));
      }
      if (pathname === "/api/listings" && req.method === "GET") {
        return send(res, 200, listListings(db, searchParams.get("category") || "").map(publicListing));
      }
      if (pathname === "/api/listings" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardPost(req, body);
        if (!gate.ok) return send(res, gate.status, gate);
        const parsed = validateListing(body);
        if (!parsed.ok) return send(res, 400, parsed);
        return send(res, 201, publicListing(createListing(db, parsed.value)));
      }
      if (pathname.startsWith("/api/listings/") && req.method === "GET") {
        const row = getListing(db, Number(pathname.slice("/api/listings/".length)));
        return row ? send(res, 200, row) : send(res, 404, { error: "Not found" });
      }
      if (pathname === "/api/businesses" && req.method === "GET") {
        return send(res, 200, listBusinesses(db, searchParams.get("category") || "").map(publicBusiness));
      }
      if (pathname === "/api/businesses" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardPost(req, body);
        if (!gate.ok) return send(res, gate.status, gate);
        const parsed = validateBusiness(body);
        if (!parsed.ok) return send(res, 400, parsed);
        return send(res, 201, publicBusiness(createBusiness(db, parsed.value)));
      }
      if (pathname.startsWith("/api/businesses/") && req.method === "GET") {
        const row = getBusiness(db, Number(pathname.slice("/api/businesses/".length)));
        return row ? send(res, 200, row) : send(res, 404, { error: "Not found" });
      }
      if (pathname === "/api/news" && req.method === "GET") {
        return send(res, 200, listNews(db));
      }
      if (pathname === "/api/news" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardPost(req, body);
        if (!gate.ok) return send(res, gate.status, gate);
        const parsed = validateNews(body);
        if (!parsed.ok) return send(res, 400, parsed);
        return send(res, 201, createNews(db, parsed.value));
      }
      if (pathname === "/api/resources" && req.method === "GET") {
        return send(res, 200, listResources(db, searchParams.get("category") || ""));
      }

      if (pathname === "/api/rooms" && req.method === "GET") {
        return send(res, 200, listApprovedRooms(db, searchParams.get("topic") || ""));
      }
      if (pathname === "/api/rooms" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardPost(req, body);
        if (!gate.ok) return send(res, gate.status, gate);
        const parsed = validateRoom(body);
        if (!parsed.ok) return send(res, 400, parsed);
        const row = createRoom(db, parsed.value);
        return send(res, 201, { id: row.id, status: row.status, title: row.title });
      }
      if (pathname.match(/^\/api\/rooms\/\d+\/messages$/) && req.method === "GET") {
        const id = Number(pathname.split("/")[3]);
        const room = getRoom(db, id);
        const admin = security.adminFromReq(req);
        if (!room || (room.status !== "approved" && !admin)) return send(res, 404, { error: "Not found" });
        return send(res, 200, listMessages(db, id, { includeHidden: Boolean(admin) }));
      }
      if (pathname.match(/^\/api\/rooms\/\d+\/messages$/) && req.method === "POST") {
        const id = Number(pathname.split("/")[3]);
        const room = getRoom(db, id);
        if (!room || room.status !== "approved") return send(res, 404, { error: "Room is not open." });
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false, maxHits: 40 });
        if (!gate.ok) return send(res, gate.status, gate);
        const parsed = validateMessage(body);
        if (!parsed.ok) return send(res, 400, parsed);
        return send(res, 201, createMessage(db, id, parsed.value));
      }
      if (pathname.match(/^\/api\/rooms\/\d+$/) && req.method === "GET") {
        const room = getRoom(db, Number(pathname.split("/")[3]));
        const admin = security.adminFromReq(req);
        if (!room || (room.status !== "approved" && !admin)) return send(res, 404, { error: "Not found" });
        return send(res, 200, admin ? room : publicRoom(room));
      }

      if (pathname === "/api/admin/login" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false });
        if (!gate.ok) return send(res, gate.status, gate);
        const row = findAdmin(db, body.email);
        if (!row || !verifyPassword(body.password, row.password_hash)) {
          return send(res, 401, { error: "Wrong email or password." });
        }
        const token = security.createAdminSession(row.email);
        return send(res, 200, { admin: true, email: row.email }, { "Set-Cookie": security.adminCookie(token) });
      }
      if (pathname === "/api/admin/logout" && req.method === "POST") {
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false });
        if (!gate.ok) return send(res, gate.status, gate);
        security.clearAdminSession(req);
        return send(res, 200, { admin: false }, { "Set-Cookie": security.clearAdminCookie() });
      }
      if (pathname === "/api/admin/rooms" && req.method === "GET") {
        if (!requireAdmin(req, res, send, security)) return;
        return send(res, 200, listAllRooms(db));
      }
      if (pathname.match(/^\/api\/admin\/rooms\/\d+\/approve$/) && req.method === "POST") {
        if (!requireAdmin(req, res, send, security)) return;
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false });
        if (!gate.ok) return send(res, gate.status, gate);
        const room = setRoomStatus(db, Number(pathname.split("/")[4]), "approved");
        return room ? send(res, 200, room) : send(res, 404, { error: "Not found" });
      }
      if (pathname.match(/^\/api\/admin\/rooms\/\d+\/close$/) && req.method === "POST") {
        if (!requireAdmin(req, res, send, security)) return;
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false });
        if (!gate.ok) return send(res, gate.status, gate);
        const room = setRoomStatus(db, Number(pathname.split("/")[4]), "closed");
        return room ? send(res, 200, room) : send(res, 404, { error: "Not found" });
      }
      if (pathname.match(/^\/api\/admin\/messages\/\d+\/hide$/) && req.method === "POST") {
        if (!requireAdmin(req, res, send, security)) return;
        const body = await security.readJson(req);
        const gate = security.guardWrite(req, body, { requireAgree: false });
        if (!gate.ok) return send(res, gate.status, gate);
        const row = hideMessage(db, Number(pathname.split("/")[4]));
        return row ? send(res, 200, row) : send(res, 404, { error: "Not found" });
      }

      if (pathname.startsWith("/api/")) {
        return send(res, 404, { error: "Not found" });
      }
      if (serveStatic(req, res, url)) return;
      send(res, 404, { error: "Not found" });
    } catch (error) {
      send(res, error.status || 500, { error: error.status ? error.message : "Server error" });
    }
  };
}

export function listen(port = Number(process.env.PORT) || 3000, db, security) {
  const server = createServer(createApp(db, security));
  return new Promise((resolve) => {
    server.listen(port, "0.0.0.0", () => resolve(server));
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const port = Number(process.env.PORT) || 3000;
  const server = await listen(port);
  console.log(`Indiantown Board http://localhost:${port}`);
  server.on("error", (error) => {
    console.error(error);
    process.exit(1);
  });
}
