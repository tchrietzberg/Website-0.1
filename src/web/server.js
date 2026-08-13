import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { isEmpty, openDb } from "../db.js";
import { seed } from "../../seed/seed.js";
import { validateBusiness, validateListing, validateNews } from "../validate.js";
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

function send(res, status, body, headers = {}) {
  const payload = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": typeof body === "object" && !Buffer.isBuffer(body) ? "application/json; charset=utf-8" : "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(payload);
}

function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function serveStatic(req, res, url) {
  let path = url.pathname === "/" ? "/index.html" : url.pathname;
  const file = join(publicDir, path);
  if (!file.startsWith(publicDir)) {
    send(res, 403, "Forbidden");
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

export function createApp(db = openDb()) {
  if (isEmpty(db)) seed(db);

  return async function handle(req, res) {
    const url = new URL(req.url, "http://127.0.0.1");
    const { pathname, searchParams } = url;

    try {
      if (pathname === "/api/stats" && req.method === "GET") {
        return sendJson(res, 200, stats(db));
      }
      if (pathname === "/api/listings" && req.method === "GET") {
        return sendJson(res, 200, listListings(db, searchParams.get("category") || ""));
      }
      if (pathname === "/api/listings" && req.method === "POST") {
        const parsed = validateListing(await readJson(req));
        if (!parsed.ok) return sendJson(res, 400, parsed);
        return sendJson(res, 201, createListing(db, parsed.value));
      }
      if (pathname.startsWith("/api/listings/") && req.method === "GET") {
        const row = getListing(db, Number(pathname.slice("/api/listings/".length)));
        return row ? sendJson(res, 200, row) : sendJson(res, 404, { error: "Not found" });
      }
      if (pathname === "/api/businesses" && req.method === "GET") {
        return sendJson(res, 200, listBusinesses(db, searchParams.get("category") || ""));
      }
      if (pathname === "/api/businesses" && req.method === "POST") {
        const parsed = validateBusiness(await readJson(req));
        if (!parsed.ok) return sendJson(res, 400, parsed);
        return sendJson(res, 201, createBusiness(db, parsed.value));
      }
      if (pathname.startsWith("/api/businesses/") && req.method === "GET") {
        const row = getBusiness(db, Number(pathname.slice("/api/businesses/".length)));
        return row ? sendJson(res, 200, row) : sendJson(res, 404, { error: "Not found" });
      }
      if (pathname === "/api/news" && req.method === "GET") {
        return sendJson(res, 200, listNews(db));
      }
      if (pathname === "/api/news" && req.method === "POST") {
        const parsed = validateNews(await readJson(req));
        if (!parsed.ok) return sendJson(res, 400, parsed);
        return sendJson(res, 201, createNews(db, parsed.value));
      }
      if (pathname === "/api/resources" && req.method === "GET") {
        return sendJson(res, 200, listResources(db));
      }
      if (pathname.startsWith("/api/")) {
        return sendJson(res, 404, { error: "Not found" });
      }
      if (serveStatic(req, res, url)) return;
      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      sendJson(res, 500, { error: error.message || "Server error" });
    }
  };
}

export function listen(port = Number(process.env.PORT) || 3000, db) {
  const server = createServer(createApp(db));
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
