'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { parseCoords, parseRadiusMeters, coarseCoord, DEFAULT_RADIUS_M } = require('./geo');
const places = require('./places');
const security = require('./security');

const PORT = Number(process.env.PORT || 4173);
const PUBLIC = path.join(__dirname, '..', 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function json(res, status, body, req, extra = {}) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...security.securityHeaders(req),
    ...extra,
  });
  res.end(data);
}

function parseQuery(url) {
  const q = {};
  for (const [k, v] of url.searchParams.entries()) q[k] = v;
  return q;
}

function safePublicPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relative = decoded === '/' ? '/index.html' : decoded;
  const resolved = path.normalize(path.join(PUBLIC, relative));
  if (!resolved.startsWith(PUBLIC + path.sep) && resolved !== PUBLIC) return null;
  return resolved;
}

function serveStatic(req, res, urlPath) {
  const filePath = safePublicPath(urlPath);
  if (!filePath) {
    json(res, 400, { error: 'bad_path', message: 'Invalid path' }, req);
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext];
  if (!type) {
    json(res, 404, { error: 'not_found', message: 'Not found' }, req);
    return;
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      json(res, 404, { error: 'not_found', message: 'Not found' }, req);
      return;
    }
    const isHtml = ext === '.html';
    const cache = isHtml || ext === '.webmanifest' || ext === '.json'
      ? 'no-store'
      : 'public, max-age=86400';
    const headers = {
      'Content-Type': type,
      'Content-Length': buf.length,
      'Cache-Control': cache,
      ...security.securityHeaders(req, { isHtml }),
    };
    if (path.basename(filePath) === 'sw.js') {
      headers['Service-Worker-Allowed'] = '/';
      headers['Cache-Control'] = 'no-store';
    }
    res.writeHead(200, headers);
    res.end(buf);
  });
}

async function handleHere(req, res, url, lookup) {
  security.rateLimit(req);
  const demo = url.searchParams.get('demo');
  let lat;
  let lon;
  let radiusMeters;
  if (demo) {
    const place = places.getDemoLocation(demo);
    if (!place) {
      const err = new Error('Unknown demo location.');
      err.status = 404;
      err.code = 'unknown_demo';
      throw err;
    }
    lat = place.lat;
    lon = place.lon;
    radiusMeters = parseRadiusMeters(url.searchParams.get('radius')) ?? DEFAULT_RADIUS_M;
  } else {
    const coords = parseCoords(parseQuery(url));
    lat = coords.lat;
    lon = coords.lon;
    radiusMeters = coords.radiusMeters;
  }
  const result = await lookup({ lat, lon, radiusMeters });
  json(res, 200, {
    lat: Math.round(lat * 1e5) / 1e5,
    lon: Math.round(lon * 1e5) / 1e5,
    ...result,
  }, req);
}

function logSafe(req, url) {
  if (process.env.WANDER_LOG_LOOKUPS !== '1') return;
  const lat = url.searchParams.get('lat');
  const lon = url.searchParams.get('lon');
  if (!lat || !lon) return;
  const latN = Number(lat);
  const lonN = Number(lon);
  if (!Number.isFinite(latN) || !Number.isFinite(lonN)) return;
  process.stdout.write(
    JSON.stringify({
      t: new Date().toISOString(),
      path: url.pathname,
      lat: coarseCoord(latN),
      lon: coarseCoord(lonN),
    }) + '\n'
  );
}

function createServer(options = {}) {
  const lookup = options.lookup || places.lookupHere;
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        json(res, 405, { error: 'method_not_allowed', message: 'Use GET' }, req);
        return;
      }
      const host = req.headers.host || `127.0.0.1:${PORT}`;
      const url = new URL(req.url, `http://${host}`);

      if (url.pathname === '/api/health') {
        json(res, 200, { ok: true, service: 'wander-guide' }, req);
        return;
      }
      if (url.pathname === '/api/demo-locations') {
        json(res, 200, { locations: places.listDemoLocations() }, req);
        return;
      }
      if (url.pathname === '/api/here') {
        logSafe(req, url);
        await handleHere(req, res, url, lookup);
        return;
      }
      serveStatic(req, res, url.pathname);
    } catch (err) {
      const status = Number(err && err.status) || 500;
      if (status >= 500) {
        console.error('wander-guide error', err && err.code ? err.code : 'server_error');
      }
      json(res, status, security.clientErrorPayload(err, 'Unable to look up this area'), req);
    }
  });
}

if (require.main === module) {
  const server = createServer();
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Wander Guide listening on http://127.0.0.1:${PORT}`);
  });
}

module.exports = { createServer, PORT, PUBLIC };
