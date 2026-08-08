const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { openDb, migrate, DEFAULT_DB, getSetting, setSetting } = require('../db');
const { ROUNDING_INCREMENTS, assertAllowedIncrement } = require('../money');
const timeSvc = require('../services/time');
const matterSvc = require('../services/matters');
const invoiceSvc = require('../services/invoices');
const paymentSvc = require('../services/payments');
const reports = require('../services/reports');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, 'public');

const sessions = new Map(); // token -> userId

function json(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function text(res, status, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(status, { 'Content-Type': type, 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); }
      catch (e) { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function getToken(req) {
  const h = req.headers.authorization || '';
  if (h.startsWith('Bearer ')) return h.slice(7);
  const cookie = req.headers.cookie || '';
  const m = cookie.match(/(?:^|;\s*)session=([^;]+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

function currentUser(db, req) {
  const token = getToken(req);
  if (!token || !sessions.has(token)) return null;
  const id = sessions.get(token);
  return db.prepare('SELECT id, email, name, role FROM users WHERE id = ? AND active = 1').get(id) || null;
}

function requireUser(db, req, res) {
  const user = currentUser(db, req);
  if (!user) {
    json(res, 401, { error: 'sign in required' });
    return null;
  }
  return user;
}

function requireRoles(user, res, roles) {
  if (!roles.includes(user.role)) {
    json(res, 403, { error: 'forbidden' });
    return false;
  }
  return true;
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  if (urlPath === '/') urlPath = '/index.html';
  const file = path.normalize(path.join(PUBLIC, urlPath));
  if (!file.startsWith(PUBLIC)) return text(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return false;
  const ext = path.extname(file);
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.svg': 'image/svg+xml',
  };
  const body = fs.readFileSync(file);
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  res.end(body);
  return true;
}

function createServer(db = openDb()) {
  migrate(db);

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      const { pathname } = url;

      if (req.method === 'GET' && !pathname.startsWith('/api/')) {
        if (serveStatic(req, res) !== false) return;
        return text(res, 404, 'not found');
      }

      // Auth
      if (req.method === 'POST' && pathname === '/api/login') {
        const body = await parseBody(req);
        const user = db.prepare(
          'SELECT id, email, name, role FROM users WHERE lower(email) = lower(?) AND active = 1'
        ).get(body.email || '');
        if (!user) return json(res, 401, { error: 'unknown email' });
        const token = `s_${user.id}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        sessions.set(token, user.id);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': `session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax`,
        });
        res.end(JSON.stringify({ token, user }));
        return;
      }

      if (req.method === 'POST' && pathname === '/api/logout') {
        const token = getToken(req);
        if (token) sessions.delete(token);
        res.writeHead(200, {
          'Content-Type': 'application/json; charset=utf-8',
          'Set-Cookie': 'session=; Path=/; Max-Age=0',
        });
        res.end(JSON.stringify({ ok: true }));
        return;
      }

      if (req.method === 'GET' && pathname === '/api/me') {
        const user = currentUser(db, req);
        return json(res, 200, { user });
      }

      const user = requireUser(db, req, res);
      if (!user) return;

      // Reference data
      if (req.method === 'GET' && pathname === '/api/users') {
        return json(res, 200, db.prepare('SELECT id, email, name, role FROM users WHERE active = 1').all());
      }
      if (req.method === 'GET' && pathname === '/api/clients') {
        return json(res, 200, matterSvc.listClients(db));
      }
      if (req.method === 'GET' && pathname === '/api/matters') {
        return json(res, 200, matterSvc.listMatters(db));
      }
      if (req.method === 'POST' && pathname === '/api/matters') {
        if (!requireRoles(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        const body = await parseBody(req);
        return json(res, 201, matterSvc.createMatter(db, user, body));
      }

      // Time
      if (req.method === 'GET' && pathname === '/api/time-entries') {
        const matterId = url.searchParams.get('matterId');
        const status = url.searchParams.get('status');
        return json(res, 200, timeSvc.listEntries(db, {
          matterId: matterId ? Number(matterId) : null,
          status,
        }));
      }
      if (req.method === 'GET' && pathname === '/api/settings') {
        const minutes = Number(getSetting(db, 'round_increment_minutes', '15'));
        return json(res, 200, {
          roundIncrementMinutes: minutes,
          roundMode: getSetting(db, 'round_mode', 'up'),
          roundingIncrements: ROUNDING_INCREMENTS,
        });
      }
      if (req.method === 'PATCH' && pathname === '/api/settings') {
        if (!requireRoles(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        if (body.roundIncrementMinutes != null) {
          const minutes = assertAllowedIncrement(Number(body.roundIncrementMinutes));
          setSetting(db, 'round_increment_minutes', String(minutes));
        }
        if (body.roundMode != null) {
          if (!['up', 'nearest', 'down'].includes(body.roundMode)) {
            return json(res, 400, { error: 'roundMode must be up, nearest, or down' });
          }
          setSetting(db, 'round_mode', body.roundMode);
        }
        return json(res, 200, {
          roundIncrementMinutes: Number(getSetting(db, 'round_increment_minutes', '15')),
          roundMode: getSetting(db, 'round_mode', 'up'),
          roundingIncrements: ROUNDING_INCREMENTS,
        });
      }

      if (req.method === 'POST' && pathname === '/api/time-entries') {
        const body = await parseBody(req);
        const entry = timeSvc.createEntry(db, user, {
          matterId: Number(body.matterId),
          timekeeperId: Number(body.timekeeperId || user.id),
          serviceDate: body.serviceDate,
          rawMinutes: Number(body.rawMinutes),
          description: body.description,
          billable: body.billable == null ? null : (body.billable ? 1 : 0),
          category: body.category,
          subcategory: body.subcategory,
          utbmsTask: body.utbmsTask,
          utbmsActivity: body.utbmsActivity,
          roundIncrementMinutes: body.roundIncrementMinutes != null
            ? Number(body.roundIncrementMinutes) : undefined,
        });
        return json(res, 201, entry);
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/submit$/)) {
        const id = Number(pathname.split('/')[3]);
        return json(res, 200, timeSvc.submitEntry(db, user, id));
      }
      if (req.method === 'GET' && pathname === '/api/approval-queue') {
        if (!requireRoles(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        return json(res, 200, timeSvc.listQueue(db));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/approve$/)) {
        if (!requireRoles(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        const id = Number(pathname.split('/')[3]);
        return json(res, 200, timeSvc.approveEntry(db, user, id));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/time-entries\/\d+\/reject$/)) {
        if (!requireRoles(user, res, ['admin', 'billing_clerk', 'attorney'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, timeSvc.rejectEntry(db, user, id, body.reason));
      }

      // Invoices
      if (req.method === 'GET' && pathname === '/api/invoices') {
        return json(res, 200, invoiceSvc.listInvoices(db));
      }
      if (req.method === 'GET' && pathname.match(/^\/api\/invoices\/\d+$/)) {
        const id = Number(pathname.split('/')[3]);
        const inv = invoiceSvc.getInvoice(db, id);
        if (!inv) return json(res, 404, { error: 'not found' });
        return json(res, 200, inv);
      }
      if (req.method === 'POST' && pathname === '/api/invoices/prebill') {
        if (!requireRoles(user, res, ['admin', 'billing_clerk'])) return;
        const body = await parseBody(req);
        return json(res, 201, invoiceSvc.generatePrebill(db, user, Number(body.matterId), body.entryIds || null));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/invoice-lines\/\d+\/write-down$/)) {
        if (!requireRoles(user, res, ['admin', 'billing_clerk'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, invoiceSvc.writeDownLine(db, user, id, Number(body.deltaCents), body.reason));
      }
      if (req.method === 'POST' && pathname.match(/^\/api\/invoices\/\d+\/status$/)) {
        if (!requireRoles(user, res, ['admin', 'billing_clerk'])) return;
        const id = Number(pathname.split('/')[3]);
        const body = await parseBody(req);
        return json(res, 200, invoiceSvc.setStatus(db, user, id, body.status));
      }

      // Payments
      if (req.method === 'GET' && pathname === '/api/payments') {
        return json(res, 200, paymentSvc.listPayments(db));
      }
      if (req.method === 'POST' && pathname === '/api/payments') {
        if (!requireRoles(user, res, ['admin', 'billing_clerk'])) return;
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
        const matterId = url.searchParams.get('matterId');
        const fmt = url.searchParams.get('format') || 'json';
        let rows;
        let currencyKeys = ['amount_cents', 'rate_cents', 'balance_cents', 'wip_cents',
          'billed_cents', 'write_down_cents', 'net_billed_cents', 'collected_cents', 'delta_cents'];
        if (name === 'lodestar-summary') rows = reports.lodestarSummary(db, { matterId: matterId && Number(matterId) });
        else if (name === 'lodestar-detail') rows = reports.lodestarDetail(db, { matterId: matterId && Number(matterId) });
        else if (name === 'wip') rows = reports.wipReport(db);
        else if (name === 'ar-aging') rows = reports.arAging(db);
        else if (name === 'write-offs') rows = reports.writeOffs(db);
        else if (name === 'realization') rows = reports.realization(db);
        else if (name === 'unapplied-cash') rows = paymentSvc.unappliedCash(db);
        else return json(res, 404, { error: 'unknown report' });

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
        return json(res, 200, rows);
      }

      if (req.method === 'GET' && pathname === '/api/audit-log') {
        if (!requireRoles(user, res, ['admin'])) return;
        return json(res, 200, db.prepare(`
          SELECT a.*, u.email AS actor_email
          FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
          ORDER BY a.id DESC LIMIT 500
        `).all());
      }

      return json(res, 404, { error: 'not found' });
    } catch (err) {
      const status = err.code === 'FORBIDDEN' ? 403
        : err.code === 'BILLING_RULE' ? 400
          : 400;
      json(res, status, { error: err.message, errors: err.errors });
    }
  });

  return server;
}

if (require.main === module) {
  const db = openDb(DEFAULT_DB);
  migrate(db);
  const server = createServer(db);
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Firm billing prototype listening on http://localhost:${PORT}`);
    console.log(`DB: ${DEFAULT_DB}`);
  });
}

module.exports = { createServer, sessions };
