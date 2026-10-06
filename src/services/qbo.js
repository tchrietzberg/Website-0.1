const crypto = require('node:crypto');
const { getSetting, setSetting, audit } = require('../db');
const { formatCents } = require('../money');

const SANDBOX_COMPANY = 'Chrono Legal (QuickBooks sandbox)';
const SANDBOX_REALM = 'sandbox-chrono';
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const SANDBOX_API = 'https://sandbox-quickbooks.api.intuit.com';
const PROD_API = 'https://quickbooks.api.intuit.com';
const SCOPES = 'com.intuit.quickbooks.accounting';
const pendingOauth = new Map();

function clientId(db) {
  return process.env.QBO_CLIENT_ID
    || getSetting(db, 'qbo_client_id', '')
    || '';
}

function clientSecret(db) {
  return process.env.QBO_CLIENT_SECRET
    || getSetting(db, 'qbo_client_secret', '')
    || '';
}

function mode(db) {
  const raw = String(getSetting(db, 'qbo_mode', '') || '').trim();
  if (raw === 'sandbox' || raw === 'live' || raw === 'disconnected') return raw;
  return '';
}

function connectionStatus(db) {
  const connectedMode = mode(db);
  const connected = connectedMode === 'sandbox' || connectedMode === 'live';
  const cid = String(clientId(db) || '').trim();
  const fromEnv = !!(process.env.QBO_CLIENT_ID && String(process.env.QBO_CLIENT_ID).trim());
  const companyName = getSetting(db, 'qbo_company_name', '') || null;
  const realmId = getSetting(db, 'qbo_realm_id', '') || null;
  const customers = db.prepare('SELECT COUNT(*) AS n FROM qbo_customers').get()?.n || 0;
  const invoices = db.prepare('SELECT COUNT(*) AS n FROM qbo_invoices').get()?.n || 0;
  return {
    connected,
    mode: connectedMode || 'disconnected',
    neverConnected: !connectedMode,
    loadable: true,
    companyName: connected ? (companyName || SANDBOX_COMPANY) : null,
    realmId: connected ? (realmId || SANDBOX_REALM) : null,
    clientConfigured: !!cid,
    clientIdSource: fromEnv ? 'env' : (cid ? 'settings' : null),
    clientIdMasked: cid ? `${cid.slice(0, 8)}…` : null,
    customerCount: Number(customers),
    invoiceCount: Number(invoices),
    environment: getSetting(db, 'qbo_environment', 'sandbox') || 'sandbox',
  };
}

function saveAppConfig(db, actor, { clientId: cid, clientSecret: secret, environment } = {}) {
  if (cid !== undefined) setSetting(db, 'qbo_client_id', String(cid || '').trim());
  if (secret !== undefined) setSetting(db, 'qbo_client_secret', String(secret || '').trim());
  if (environment !== undefined) {
    const env = String(environment || 'sandbox').trim() === 'production' ? 'production' : 'sandbox';
    setSetting(db, 'qbo_environment', env);
  }
  audit(db, {
    actorId: actor?.id || null,
    action: 'qbo.app_config',
    entityType: 'firm_settings',
    entityId: null,
    detail: { clientConfigured: !!clientId(db), environment: getSetting(db, 'qbo_environment', 'sandbox') },
  });
  return connectionStatus(db);
}

function nextSandboxId(db, kind) {
  const key = kind === 'customer' ? 'qbo_next_customer' : 'qbo_next_invoice';
  const n = Number(getSetting(db, key, '1000') || 1000);
  setSetting(db, key, String(n + 1));
  return String(n);
}

function tickerForClient(db, client) {
  if (!client) return '';
  const field = db.prepare(`
    SELECT id FROM custom_fields
    WHERE active = 1 AND IFNULL(applies_to, 'matter') = 'client' AND lower(label) = 'ticker'
    ORDER BY id LIMIT 1
  `).get();
  if (!field) return '';
  const row = db.prepare(`
    SELECT value_text FROM client_custom_field_values
    WHERE client_id = ? AND field_id = ?
  `).get(client.id, field.id);
  return row?.value_text ? String(row.value_text).trim() : '';
}

function upsertCustomer(db, { clientId: cid, displayName, ticker, syncMode }) {
  const existing = cid
    ? db.prepare('SELECT * FROM qbo_customers WHERE client_id = ?').get(cid)
    : db.prepare('SELECT * FROM qbo_customers WHERE display_name = ? COLLATE NOCASE').get(displayName);
  if (existing) {
    db.prepare(`
      UPDATE qbo_customers
      SET display_name = ?, ticker = ?, sync_mode = ?, last_synced_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
      WHERE id = ?
    `).run(displayName, ticker || existing.ticker || null, syncMode, existing.id);
    return db.prepare('SELECT * FROM qbo_customers WHERE id = ?').get(existing.id);
  }
  const qboId = nextSandboxId(db, 'customer');
  const info = db.prepare(`
    INSERT INTO qbo_customers(client_id, qbo_id, display_name, ticker, sync_mode)
    VALUES (?, ?, ?, ?, ?)
  `).run(cid || null, qboId, displayName, ticker || null, syncMode);
  return db.prepare('SELECT * FROM qbo_customers WHERE id = ?').get(Number(info.lastInsertRowid));
}

function mapClientsToCustomers(db, syncMode) {
  const clients = db.prepare(`
    SELECT id, name, record_type FROM clients ORDER BY name COLLATE NOCASE, id
  `).all();
  const mapped = [];
  for (const client of clients) {
    mapped.push(upsertCustomer(db, {
      clientId: client.id,
      displayName: client.name,
      ticker: tickerForClient(db, client),
      syncMode,
    }));
  }
  if (!mapped.length) {
    mapped.push(upsertCustomer(db, {
      clientId: null,
      displayName: 'Demo Customer',
      ticker: 'DEMO',
      syncMode,
    }));
  }
  return mapped;
}

function connectSandbox(db, actor) {
  setSetting(db, 'qbo_mode', 'sandbox');
  setSetting(db, 'qbo_company_name', SANDBOX_COMPANY);
  setSetting(db, 'qbo_realm_id', SANDBOX_REALM);
  setSetting(db, 'qbo_environment', 'sandbox');
  const customers = mapClientsToCustomers(db, 'sandbox');
  audit(db, {
    actorId: actor?.id || null,
    action: 'qbo.connect_sandbox',
    entityType: 'firm_settings',
    entityId: null,
    detail: { companyName: SANDBOX_COMPANY, customers: customers.length },
  });
  return listLedger(db);
}

function disconnect(db, actor) {
  setSetting(db, 'qbo_mode', 'disconnected');
  for (const key of [
    'qbo_access_token',
    'qbo_refresh_token',
    'qbo_access_token_expires_at',
    'qbo_company_name',
    'qbo_realm_id',
  ]) {
    setSetting(db, key, '');
  }
  audit(db, {
    actorId: actor?.id || null,
    action: 'qbo.disconnect',
    entityType: 'firm_settings',
    entityId: null,
    detail: {},
  });
  return connectionStatus(db);
}

function startOAuth(db, actor, { redirectUri } = {}) {
  const cid = clientId(db);
  if (!cid) {
    throw new Error('Add a QuickBooks Client ID in Settings, or load the sandbox company to try Chrono without Intuit credentials.');
  }
  const state = crypto.randomBytes(16).toString('hex');
  const verifier = crypto.randomBytes(32).toString('base64url');
  pendingOauth.set(state, {
    verifier,
    actorId: actor?.id || null,
    redirectUri: String(redirectUri || '').trim(),
    createdAt: Date.now(),
  });
  const env = getSetting(db, 'qbo_environment', 'sandbox') || 'sandbox';
  const url = new URL(AUTH_URL);
  url.searchParams.set('client_id', cid);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SCOPES);
  url.searchParams.set('redirect_uri', String(redirectUri || '').trim());
  url.searchParams.set('state', state);
  if (env !== 'production') url.searchParams.set('t', 'true');
  return { authUrl: url.toString(), state };
}

function invoiceRow(db, invoiceId) {
  return db.prepare(`
    SELECT i.*, m.number AS matter_number, m.name AS matter_name, m.client_id,
      c.name AS client_name
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    LEFT JOIN clients c ON c.id = m.client_id
    WHERE i.id = ?
  `).get(invoiceId);
}

function invoiceLines(db, invoiceId) {
  return db.prepare(`
    SELECT l.*, u.name AS timekeeper_name
    FROM invoice_lines l
    JOIN users u ON u.id = l.timekeeper_id
    WHERE l.invoice_id = ?
    ORDER BY l.sort_order, l.id
  `).all(invoiceId);
}

function customerForInvoice(db, invoice, syncMode) {
  const clientIdVal = invoice.client_id != null ? Number(invoice.client_id) : null;
  const name = invoice.client_name || invoice.matter_name || 'Unnamed customer';
  let ticker = '';
  if (clientIdVal) {
    const client = db.prepare('SELECT id, name FROM clients WHERE id = ?').get(clientIdVal);
    ticker = tickerForClient(db, client);
  }
  return upsertCustomer(db, {
    clientId: clientIdVal,
    displayName: name,
    ticker,
    syncMode,
  });
}

function buildQboInvoicePayload(invoice, lines, customer) {
  const txnDate = String(invoice.issue_date || invoice.sent_at || invoice.created_at || '').slice(0, 10);
  const qboLines = (lines || []).map((line, i) => {
    const hours = Number(line.minutes || 0) / 60;
    const amount = Number(line.amount_cents || 0) / 100;
    const rate = Number(line.rate_cents || 0) / 100;
    return {
      Id: String(i + 1),
      LineNum: i + 1,
      Amount: Number(amount.toFixed(2)),
      DetailType: 'SalesItemLineDetail',
      Description: [
        line.service_date,
        line.timekeeper_name,
        line.description,
      ].filter(Boolean).join(' · '),
      SalesItemLineDetail: {
        Qty: Number(hours.toFixed(2)),
        UnitPrice: Number(rate.toFixed(2)),
        ItemRef: { value: '1', name: 'Legal Services' },
      },
    };
  });
  const total = Number(invoice.total_cents || 0) / 100;
  return {
    DocNumber: invoice.number,
    TxnDate: txnDate,
    PrivateNote: invoice.matter_name || '',
    CustomerRef: { value: customer.qbo_id, name: customer.display_name },
    Line: qboLines,
    TotalAmt: Number(total.toFixed(2)),
    Balance: Number(total.toFixed(2)),
  };
}

async function postLiveInvoice(db, payload) {
  const token = getSetting(db, 'qbo_access_token', '');
  const realm = getSetting(db, 'qbo_realm_id', '');
  if (!token || !realm) throw new Error('QuickBooks is not connected with a live company');
  const env = getSetting(db, 'qbo_environment', 'sandbox') || 'sandbox';
  const base = env === 'production' ? PROD_API : SANDBOX_API;
  const res = await fetch(`${base}/v3/company/${encodeURIComponent(realm)}/invoice?minorversion=65`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.Fault?.Error?.[0]?.Message || data?.error || res.statusText || 'QuickBooks rejected the invoice';
    throw new Error(msg);
  }
  return data.Invoice || data;
}

function sendInvoice(db, actor, invoiceId) {
  const connected = mode(db);
  if (connected !== 'sandbox' && connected !== 'live') {
    throw new Error('Connect QuickBooks first — load the sandbox company from Settings or QuickBooks.');
  }
  const invoice = invoiceRow(db, invoiceId);
  if (!invoice) throw new Error('invoice not found');
  if (invoice.status === 'void') throw new Error('Voided bills cannot be sent to QuickBooks');
  const existing = db.prepare('SELECT * FROM qbo_invoices WHERE invoice_id = ?').get(invoiceId);
  if (existing) {
    return {
      alreadySent: true,
      invoice: decorateLedgerRow(existing),
      status: connectionStatus(db),
    };
  }
  const customer = customerForInvoice(db, invoice, connected);
  const payload = buildQboInvoicePayload(invoice, invoiceLines(db, invoiceId), customer);
  const qboId = nextSandboxId(db, 'invoice');
  payload.Id = qboId;
  const info = db.prepare(`
    INSERT INTO qbo_invoices(
      invoice_id, qbo_id, qbo_doc_number, qbo_customer_id, qbo_customer_name,
      total_cents, balance_cents, status, sync_mode, payload_json, sent_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'sent', ?, ?, ?)
  `).run(
    invoice.id,
    qboId,
    invoice.number,
    customer.qbo_id,
    customer.display_name,
    invoice.total_cents,
    invoice.total_cents,
    connected,
    JSON.stringify(payload),
    actor?.id || null
  );
  audit(db, {
    actorId: actor?.id || null,
    action: 'qbo.invoice.send',
    entityType: 'invoice',
    entityId: invoice.id,
    detail: { qboId, mode: connected, customer: customer.display_name },
  });
  const row = db.prepare('SELECT * FROM qbo_invoices WHERE id = ?').get(Number(info.lastInsertRowid));
  return {
    alreadySent: false,
    invoice: decorateLedgerRow(row),
    customer,
    status: connectionStatus(db),
  };
}

function decorateLedgerRow(row) {
  if (!row) return null;
  let payload = null;
  try { payload = row.payload_json ? JSON.parse(row.payload_json) : null; } catch { payload = null; }
  return {
    ...row,
    total_label: formatCents(row.total_cents || 0),
    payload,
  };
}

function listLedger(db) {
  const customers = db.prepare(`
    SELECT * FROM qbo_customers ORDER BY display_name COLLATE NOCASE, id
  `).all();
  const invoices = db.prepare(`
    SELECT q.*, i.number AS chrono_number, i.status AS chrono_status, m.name AS matter_name
    FROM qbo_invoices q
    JOIN invoices i ON i.id = q.invoice_id
    JOIN matters m ON m.id = i.matter_id
    ORDER BY q.sent_at DESC, q.id DESC
  `).all().map(decorateLedgerRow);
  return {
    ...connectionStatus(db),
    customers,
    invoices,
  };
}

function syncForInvoice(db, invoiceId) {
  const row = db.prepare('SELECT * FROM qbo_invoices WHERE invoice_id = ?').get(invoiceId);
  return decorateLedgerRow(row);
}

function getDashboard(db) {
  const ledger = listLedger(db);
  return ledger;
}

module.exports = {
  connectionStatus,
  saveAppConfig,
  connectSandbox,
  disconnect,
  startOAuth,
  sendInvoice,
  listLedger,
  syncForInvoice,
  getDashboard,
  TOKEN_URL,
  AUTH_URL,
};
