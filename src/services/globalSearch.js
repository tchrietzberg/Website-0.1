const permissions = require('./permissions');
const matterSvc = require('./matters');
const clientsSvc = require('./clients');
const customReports = require('./customReports');

const TYPE_LABELS = {
  matter: 'Matter',
  contact: 'Contact',
  time: 'Time entry',
  report: 'Report',
  invoice: 'Invoice',
};

function tokenize(q) {
  return String(q || '')
    .toLowerCase()
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
}

function matchesTokens(haystack, tokens) {
  const text = String(haystack || '').toLowerCase();
  if (!text) return false;
  return tokens.every((t) => text.includes(t));
}

function searchMatters(db, actor, tokens, limit) {
  if (!permissions.canSearch(db, actor.role, 'matter')) return [];
  const q = tokens.join(' ');
  const hits = matterSvc.searchMatters(db, { q }).slice(0, limit);
  return hits.map((m) => ({
    type: 'matter',
    typeLabel: TYPE_LABELS.matter,
    id: Number(m.id),
    title: m.name || m.number || `Matter ${m.id}`,
    subtitle: [m.number, m.client_name, m.status].filter(Boolean).join(' · '),
    target: { view: 'matter', matterId: Number(m.id) },
  }));
}

function searchContacts(db, actor, tokens, limit) {
  if (!permissions.canSearch(db, actor.role, 'contact')) return [];
  const q = tokens.join(' ');
  const rows = clientsSvc.listClients(db, { q }).slice(0, limit);
  return rows.map((c) => ({
    type: 'contact',
    typeLabel: TYPE_LABELS.contact,
    id: Number(c.id),
    title: c.name || `Contact ${c.id}`,
    subtitle: [c.record_type, c.email, c.phone, c.company].filter(Boolean).join(' · '),
    target: { view: 'contact', contactId: Number(c.id) },
  }));
}

function searchTimeEntries(db, actor, tokens, limit) {
  if (!permissions.canSearch(db, actor.role, 'time')) return [];
  permissions.assertCanViewRecords(db, actor, 'time');
  const access = permissions.getRoleObjectAccess(db, actor.role, 'time');
  let sql = `
    SELECT te.id, te.service_date, te.description, te.status, te.rounded_minutes,
           te.timekeeper_id, u.name AS timekeeper_name,
           m.id AS matter_id, m.number AS matter_number, m.name AS matter_name
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
  `;
  const params = [];
  if (!access.viewOthers) {
    sql += ' WHERE te.timekeeper_id = ?';
    params.push(actor.id);
  }
  sql += ' ORDER BY te.service_date DESC, te.id DESC LIMIT 200';
  const rows = db.prepare(sql).all(...params);
  const hits = [];
  for (const row of rows) {
    const blob = [
      row.description,
      row.status,
      row.service_date,
      row.matter_name,
      row.matter_number,
      access.selectTimekeeper || Number(row.timekeeper_id) === Number(actor.id)
        ? row.timekeeper_name
        : '',
      String(row.id),
    ].join(' ');
    if (!matchesTokens(blob, tokens)) continue;
    const hours = row.rounded_minutes != null
      ? (Number(row.rounded_minutes) / 60).toFixed(2)
      : '';
    hits.push({
      type: 'time',
      typeLabel: TYPE_LABELS.time,
      id: Number(row.id),
      title: row.description || `Time #${row.id}`,
      subtitle: [
        row.service_date,
        row.matter_name || row.matter_number,
        hours ? `${hours}h` : null,
        row.status,
      ].filter(Boolean).join(' · '),
      target: { view: 'time', timeEntryId: Number(row.id), matterId: Number(row.matter_id) },
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

function searchReports(db, actor, tokens, limit) {
  if (!permissions.canSearch(db, actor.role, 'report')) return [];
  permissions.assertCanViewRecords(db, actor, 'report');
  const firm = customReports.listFirmReports(db, {
    includeDisabled: permissions.canModifyAll(db, actor.role, 'report'),
  }) || [];
  const custom = customReports.listReports(db, { actor }) || [];
  const hits = [];
  for (const r of firm) {
    const blob = [r.id, r.name, r.description, 'firm report'].join(' ');
    if (!matchesTokens(blob, tokens)) continue;
    hits.push({
      type: 'report',
      typeLabel: TYPE_LABELS.report,
      id: r.id,
      title: r.name || String(r.id),
      subtitle: 'Firm report',
      target: { view: 'reports', reportKey: String(r.id), reportKind: 'firm' },
    });
    if (hits.length >= limit) break;
  }
  if (hits.length < limit) {
    for (const r of custom) {
      const blob = [r.id, r.name, r.description, 'custom report', r.source].join(' ');
      if (!matchesTokens(blob, tokens)) continue;
      hits.push({
        type: 'report',
        typeLabel: TYPE_LABELS.report,
        id: Number(r.id),
        title: r.name || `Custom report ${r.id}`,
        subtitle: ['Custom report', r.source].filter(Boolean).join(' · '),
        target: { view: 'reports', reportId: Number(r.id), reportKind: 'custom' },
      });
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

function searchInvoices(db, actor, tokens, limit) {
  // Billing stays role-gated (admin / billing clerk), not a separate Search object.
  if (!['admin', 'billing_clerk'].includes(actor?.role)) return [];
  const rows = db.prepare(`
    SELECT i.id, i.number, i.status, i.issue_date, m.name AS matter_name, m.number AS matter_number
    FROM invoices i
    JOIN matters m ON m.id = i.matter_id
    ORDER BY i.id DESC
    LIMIT 200
  `).all();
  const hits = [];
  for (const row of rows) {
    const blob = [row.number, row.status, row.issue_date, row.matter_name, row.matter_number, String(row.id)].join(' ');
    if (!matchesTokens(blob, tokens)) continue;
    hits.push({
      type: 'invoice',
      typeLabel: TYPE_LABELS.invoice,
      id: Number(row.id),
      title: row.number || `Invoice ${row.id}`,
      subtitle: [row.matter_name || row.matter_number, row.status, row.issue_date]
        .filter(Boolean).join(' · '),
      target: { view: 'billing', invoiceId: Number(row.id) },
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/**
 * Global lookup across permissioned objects.
 * @returns {{ q, scopes, results }}
 */
function lookup(db, actor, { q = '', limitPerType = 5 } = {}) {
  const query = String(q || '').trim();
  const scopes = {
    matter: permissions.canSearch(db, actor?.role, 'matter'),
    contact: permissions.canSearch(db, actor?.role, 'contact'),
    time: permissions.canSearch(db, actor?.role, 'time'),
    report: permissions.canSearch(db, actor?.role, 'report'),
    invoice: ['admin', 'billing_clerk'].includes(actor?.role),
  };
  if (!query) {
    return { q: query, scopes, results: [] };
  }
  const tokens = tokenize(query);
  if (!tokens.length) return { q: query, scopes, results: [] };

  const per = Math.min(20, Math.max(1, Number(limitPerType) || 5));
  const results = [
    ...searchMatters(db, actor, tokens, per),
    ...searchContacts(db, actor, tokens, per),
    ...searchTimeEntries(db, actor, tokens, per),
    ...searchReports(db, actor, tokens, per),
    ...searchInvoices(db, actor, tokens, per),
  ];
  return { q: query, scopes, results };
}

module.exports = {
  TYPE_LABELS,
  lookup,
  tokenize,
  matchesTokens,
};
