const { audit, getSetting, setSetting } = require('../db');
const { amountFromMinutes, minutesToDecimalHours } = require('../money');
const { resolveRate } = require('../rates');
const reports = require('./reports');
const { buildTextPdf } = require('../pdf');
const permissions = require('./permissions');

const SOURCES = new Set(['time_entry', 'matter']);
const METRICS = new Set(['count', 'hours', 'amount']);
const CHART_TYPES = new Set(['bar', 'pie', 'table']);

/** Firm reports that can be pinned to the dashboard. */
const FIRM_REPORT_CATALOG = [
  {
    id: 'matters',
    name: 'Matters',
    description: 'Firm matter listing',
  },
  {
    id: 'lodestar-summary',
    name: 'Lodestar Summary',
    description: 'Lodestar summary across all matters',
  },
  {
    id: 'lodestar-detail',
    name: 'Lodestar Detail',
    description: 'Lodestar detail across all matters',
  },
];

const FIRM_REPORT_IDS = new Set(FIRM_REPORT_CATALOG.map((r) => r.id));
const DASHBOARD_FIRM_SETTING = 'dashboard_firm_reports';
const DISABLED_FIRM_SETTING = 'disabled_firm_reports';
const FIRM_CURRENCY_KEYS = [
  'amount_cents', 'rate_cents', 'balance_cents', 'wip_cents',
  'billed_cents', 'write_down_cents', 'net_billed_cents', 'collected_cents', 'delta_cents',
];

function assertSource(source) {
  if (!SOURCES.has(source)) throw new Error('source must be time_entry or matter');
  return source;
}

function assertMetric(metric) {
  if (!METRICS.has(metric)) throw new Error('metric must be count, hours, or amount');
  return metric;
}

function assertChartType(chartType) {
  if (!CHART_TYPES.has(chartType)) throw new Error('chartType must be bar, pie, or table');
  return chartType;
}

function getField(db, fieldId) {
  const field = db.prepare(`
    SELECT * FROM custom_fields WHERE id = ? AND active = 1
  `).get(fieldId);
  if (!field) throw new Error('custom field not found');
  return field;
}

function listReports(db, { dashboardOnly = false, actor = null } = {}) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'report');
  return db.prepare(`
    SELECT r.*, f.label AS group_by_label, f.applies_to AS field_applies_to,
           f.field_type AS field_type, u.name AS created_by_name
    FROM custom_reports r
    JOIN custom_fields f ON f.id = r.group_by_field_id
    LEFT JOIN users u ON u.id = r.created_by
    WHERE r.active = 1
      AND (? = 0 OR r.show_on_dashboard = 1)
    ORDER BY r.name COLLATE NOCASE, r.id
  `).all(dashboardOnly ? 1 : 0);
}

function getReport(db, id) {
  const row = db.prepare(`
    SELECT r.*, f.label AS group_by_label, f.applies_to AS field_applies_to,
           f.field_type AS field_type
    FROM custom_reports r
    JOIN custom_fields f ON f.id = r.group_by_field_id
    WHERE r.id = ? AND r.active = 1
  `).get(id);
  if (!row) throw new Error('custom report not found');
  return row;
}

function createReport(db, actor, input) {
  permissions.assertCanModifyRecords(db, actor, 'report');
  const name = String(input.name || '').trim();
  if (!name) throw new Error('name is required');
  const source = assertSource(String(input.source || ''));
  const metric = assertMetric(String(input.metric || 'count'));
  const chartType = assertChartType(String(input.chartType || 'bar'));
  const fieldId = Number(input.groupByFieldId);
  if (!Number.isInteger(fieldId) || fieldId <= 0) {
    throw new Error('groupByFieldId is required');
  }
  const field = getField(db, fieldId);
  if (field.applies_to !== source) {
    throw new Error(`field applies to ${field.applies_to}, not ${source}`);
  }
  if (source === 'matter' && metric !== 'count') {
    throw new Error('matter reports only support the count metric');
  }

  const showOnDashboard = input.showOnDashboard === 0 || input.showOnDashboard === false ? 0 : 1;
  const description = input.description != null ? String(input.description).trim() : null;

  const info = db.prepare(`
    INSERT INTO custom_reports(
      name, description, source, group_by_field_id, metric, chart_type,
      show_on_dashboard, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    name,
    description || null,
    source,
    fieldId,
    metric,
    chartType,
    showOnDashboard,
    actor.id
  );

  const id = Number(info.lastInsertRowid);
  audit(db, {
    actorId: actor.id,
    action: 'custom_report.create',
    entityType: 'custom_report',
    entityId: id,
    detail: { name, source, metric, groupByFieldId: fieldId },
  });
  return getReport(db, id);
}

function updateReport(db, actor, id, input = {}) {
  permissions.assertCanModifyRecords(db, actor, 'report');
  const existing = db.prepare('SELECT * FROM custom_reports WHERE id = ? AND active = 1').get(id);
  if (!existing) throw new Error('custom report not found');

  const name = input.name !== undefined ? String(input.name || '').trim() : existing.name;
  if (!name) throw new Error('name is required');
  const source = input.source !== undefined
    ? assertSource(String(input.source || ''))
    : existing.source;
  const metric = input.metric !== undefined
    ? assertMetric(String(input.metric || 'count'))
    : existing.metric;
  const chartType = input.chartType !== undefined
    ? assertChartType(String(input.chartType || 'bar'))
    : existing.chart_type;
  const fieldId = input.groupByFieldId !== undefined
    ? Number(input.groupByFieldId)
    : existing.group_by_field_id;
  if (!Number.isInteger(fieldId) || fieldId <= 0) {
    throw new Error('groupByFieldId is required');
  }
  const field = getField(db, fieldId);
  if (field.applies_to !== source) {
    throw new Error(`field applies to ${field.applies_to}, not ${source}`);
  }
  if (source === 'matter' && metric !== 'count') {
    throw new Error('matter reports only support the count metric');
  }

  let showOnDashboard = existing.show_on_dashboard;
  if (input.showOnDashboard !== undefined) {
    showOnDashboard = input.showOnDashboard === 0 || input.showOnDashboard === false ? 0 : 1;
  }
  const description = input.description !== undefined
    ? (String(input.description || '').trim() || null)
    : existing.description;

  db.prepare(`
    UPDATE custom_reports SET
      name = ?, description = ?, source = ?, group_by_field_id = ?,
      metric = ?, chart_type = ?, show_on_dashboard = ?
    WHERE id = ?
  `).run(name, description, source, fieldId, metric, chartType, showOnDashboard, id);

  audit(db, {
    actorId: actor.id,
    action: 'custom_report.update',
    entityType: 'custom_report',
    entityId: id,
    detail: { name, source, metric, groupByFieldId: fieldId, showOnDashboard: !!showOnDashboard },
  });
  return getReport(db, id);
}

function deactivateReport(db, actor, id) {
  permissions.assertCanDeleteRecords(db, actor, 'report');
  const existing = db.prepare('SELECT * FROM custom_reports WHERE id = ? AND active = 1').get(id);
  if (!existing) throw new Error('custom report not found');
  db.prepare('UPDATE custom_reports SET active = 0 WHERE id = ?').run(id);
  audit(db, {
    actorId: actor.id,
    action: 'custom_report.deactivate',
    entityType: 'custom_report',
    entityId: id,
  });
  return { ok: true };
}

function setShowOnDashboard(db, actor, id, showOnDashboard) {
  permissions.assertCanModifyRecords(db, actor, 'report');
  const existing = db.prepare('SELECT * FROM custom_reports WHERE id = ? AND active = 1').get(id);
  if (!existing) throw new Error('custom report not found');
  const flag = showOnDashboard === 0 || showOnDashboard === false ? 0 : 1;
  db.prepare('UPDATE custom_reports SET show_on_dashboard = ? WHERE id = ?').run(flag, id);
  audit(db, {
    actorId: actor.id,
    action: 'custom_report.dashboard',
    entityType: 'custom_report',
    entityId: id,
    detail: { showOnDashboard: !!flag },
  });
  return getReport(db, id);
}

function getDisabledFirmReportIds(db) {
  const raw = getSetting(db, DISABLED_FIRM_SETTING, '[]');
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((id) => FIRM_REPORT_IDS.has(String(id))).map(String);
}

function saveDisabledFirmReportIds(db, actor, ids) {
  const unique = [];
  for (const id of ids) {
    const key = String(id);
    if (!FIRM_REPORT_IDS.has(key)) throw new Error(`unknown firm report: ${key}`);
    if (!unique.includes(key)) unique.push(key);
  }
  setSetting(db, DISABLED_FIRM_SETTING, JSON.stringify(unique));
  if (actor) {
    audit(db, {
      actorId: actor.id,
      action: 'firm_reports.disabled',
      entityType: 'firm_settings',
      entityId: 0,
      detail: { ids: unique },
    });
  }
  return unique;
}

function listFirmReports(db, { includeDisabled = false } = {}) {
  const disabled = new Set(getDisabledFirmReportIds(db));
  return FIRM_REPORT_CATALOG
    .filter((r) => includeDisabled || !disabled.has(r.id))
    .map((r) => ({ ...r, disabled: disabled.has(r.id) }));
}

function disableFirmReport(db, actor, reportId) {
  permissions.assertCanDeleteRecords(db, actor, 'report');
  const id = String(reportId || '');
  if (!FIRM_REPORT_IDS.has(id)) throw new Error('unknown firm report');
  // Unpin while still considered enabled, then mark disabled.
  removeFirmReportFromDashboard(db, actor, id);
  const disabled = getDisabledFirmReportIds(db);
  if (!disabled.includes(id)) disabled.push(id);
  saveDisabledFirmReportIds(db, actor, disabled);
  return { ok: true, id, disabled: true };
}

function enableFirmReport(db, actor, reportId) {
  // Restore is allowed with Modify or Delete so the same people who remove can undo.
  if (!permissions.canModifyAll(db, actor?.role, 'report')
    && !permissions.canDelete(db, actor?.role, 'report')) {
    permissions.assertCanModifyRecords(db, actor, 'report');
  }
  const id = String(reportId || '');
  if (!FIRM_REPORT_IDS.has(id)) throw new Error('unknown firm report');
  const disabled = getDisabledFirmReportIds(db).filter((x) => x !== id);
  saveDisabledFirmReportIds(db, actor, disabled);
  return { ok: true, id, disabled: false };
}

function getDashboardFirmReportIds(db) {
  const raw = getSetting(db, DASHBOARD_FIRM_SETTING, '[]');
  let parsed;
  try {
    parsed = JSON.parse(raw || '[]');
  } catch {
    parsed = [];
  }
  if (!Array.isArray(parsed)) return [];
  const disabled = new Set(getDisabledFirmReportIds(db));
  return parsed
    .filter((id) => FIRM_REPORT_IDS.has(String(id)) && !disabled.has(String(id)))
    .map(String);
}

function saveDashboardFirmReportIds(db, actor, ids) {
  const unique = [];
  for (const id of ids) {
    const key = String(id);
    if (!FIRM_REPORT_IDS.has(key)) throw new Error(`unknown firm report: ${key}`);
    if (!unique.includes(key)) unique.push(key);
  }
  setSetting(db, DASHBOARD_FIRM_SETTING, JSON.stringify(unique));
  if (actor) {
    audit(db, {
      actorId: actor.id,
      action: 'dashboard.firm_reports',
      entityType: 'firm_settings',
      entityId: 0,
      detail: { ids: unique },
    });
  }
  return unique;
}

function addFirmReportToDashboard(db, actor, reportId) {
  const id = String(reportId || '');
  if (!FIRM_REPORT_IDS.has(id)) throw new Error('unknown firm report');
  if (getDisabledFirmReportIds(db).includes(id)) {
    throw new Error('This firm report has been removed. Restore it on Reports first.');
  }
  const ids = getDashboardFirmReportIds(db);
  if (!ids.includes(id)) ids.push(id);
  saveDashboardFirmReportIds(db, actor, ids);
  return { ok: true, ids };
}

function removeFirmReportFromDashboard(db, actor, reportId) {
  const id = String(reportId || '');
  if (!FIRM_REPORT_IDS.has(id)) throw new Error('unknown firm report');
  const ids = getDashboardFirmReportIds(db).filter((x) => x !== id);
  saveDashboardFirmReportIds(db, actor, ids);
  return { ok: true, ids };
}

function firmReportMeta(id) {
  return FIRM_REPORT_CATALOG.find((r) => r.id === id) || null;
}

function firmReportRows(db, reportId) {
  if (reportId === 'matters') return reports.mattersReport(db);
  if (reportId === 'lodestar-summary') return reports.lodestarSummary(db, {});
  if (reportId === 'lodestar-detail') return reports.lodestarDetail(db, {});
  throw new Error('unknown firm report');
}

function runFirmReport(db, reportId, actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'report');
  const meta = firmReportMeta(reportId);
  if (!meta) throw new Error('unknown firm report');
  if (getDisabledFirmReportIds(db).includes(String(reportId))) {
    throw new Error('This firm report has been removed');
  }
  const rows = firmReportRows(db, reportId);
  const columns = rows.length ? Object.keys(rows[0]) : [];
  return {
    kind: 'firm',
    report: {
      id: meta.id,
      name: meta.name,
      description: meta.description,
      chartType: 'table',
      kind: 'firm',
      showOnDashboard: true,
    },
    rows,
    columns,
    totals: { count: rows.length, minutes: 0, hours: 0, amount_cents: 0, value: rows.length },
    valueLabel: 'Rows',
  };
}

function listAvailableDashboardAdds(db) {
  const pinnedFirm = new Set(getDashboardFirmReportIds(db));
  const custom = listReports(db).filter((r) => !r.show_on_dashboard);
  return {
    firm: listFirmReports(db).filter((r) => !pinnedFirm.has(r.id)),
    custom: custom.map((r) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      groupByLabel: r.group_by_label,
      source: r.source,
      metric: r.metric,
    })),
  };
}

function pinDashboardReport(db, actor, { kind, id } = {}) {
  permissions.assertCanModifyRecords(db, actor, 'report');
  const type = String(kind || '');
  if (type === 'firm') {
    return addFirmReportToDashboard(db, actor, id);
  }
  if (type === 'custom') {
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('id is required');
    setShowOnDashboard(db, actor, reportId, true);
    return { ok: true };
  }
  throw new Error('kind must be firm or custom');
}

function unpinDashboardReport(db, actor, { kind, id } = {}) {
  permissions.assertCanModifyRecords(db, actor, 'report');
  const type = String(kind || '');
  if (type === 'firm') {
    return removeFirmReportFromDashboard(db, actor, id);
  }
  if (type === 'custom') {
    const reportId = Number(id);
    if (!Number.isInteger(reportId) || reportId <= 0) throw new Error('id is required');
    setShowOnDashboard(db, actor, reportId, false);
    return { ok: true };
  }
  throw new Error('kind must be firm or custom');
}

function blankLabel(value) {
  const s = value == null ? '' : String(value).trim();
  return s || '(blank)';
}

function runTimeEntryReport(db, report) {
  const entries = db.prepare(`
    SELECT te.id, te.matter_id, te.timekeeper_id, te.service_date, te.rounded_minutes,
           te.billable, te.status, m.client_id, v.value_text
    FROM time_entries te
    JOIN matters m ON m.id = te.matter_id
    LEFT JOIN time_entry_custom_field_values v
      ON v.time_entry_id = te.id AND v.field_id = ?
    WHERE te.billable = 1
      AND te.status IN ('draft','submitted','approved','invoiced')
  `).all(report.group_by_field_id);

  const buckets = new Map();
  for (const e of entries) {
    const label = blankLabel(e.value_text);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { label, count: 0, minutes: 0, amount_cents: 0 };
      buckets.set(label, bucket);
    }
    bucket.count += 1;
    bucket.minutes += e.rounded_minutes || 0;
    if (report.metric === 'amount') {
      const rate = resolveRate(db, {
        matterId: e.matter_id,
        clientId: e.client_id,
        timekeeperId: e.timekeeper_id,
        serviceDate: e.service_date,
      });
      bucket.amount_cents += amountFromMinutes(e.rounded_minutes || 0, rate?.amountCents || 0);
    }
  }

  return [...buckets.values()].map((b) => ({
    label: b.label,
    count: b.count,
    minutes: b.minutes,
    hours: minutesToDecimalHours(b.minutes),
    amount_cents: b.amount_cents,
    value: report.metric === 'hours'
      ? minutesToDecimalHours(b.minutes)
      : report.metric === 'amount'
        ? b.amount_cents / 100
        : b.count,
  })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function runMatterReport(db, report) {
  const rows = db.prepare(`
    SELECT m.id, v.value_text
    FROM matters m
    LEFT JOIN custom_field_values v
      ON v.matter_id = m.id AND v.field_id = ?
  `).all(report.group_by_field_id);

  const buckets = new Map();
  for (const row of rows) {
    const label = blankLabel(row.value_text);
    let bucket = buckets.get(label);
    if (!bucket) {
      bucket = { label, count: 0 };
      buckets.set(label, bucket);
    }
    bucket.count += 1;
  }

  return [...buckets.values()].map((b) => ({
    label: b.label,
    count: b.count,
    minutes: 0,
    hours: 0,
    amount_cents: 0,
    value: b.count,
  })).sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function runReport(db, id, actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'report');
  const report = getReport(db, id);
  const rows = report.source === 'time_entry'
    ? runTimeEntryReport(db, report)
    : runMatterReport(db, report);

  const totals = rows.reduce((acc, r) => {
    acc.count += r.count;
    acc.minutes += r.minutes;
    acc.amount_cents += r.amount_cents;
    acc.value += r.value;
    return acc;
  }, { count: 0, minutes: 0, amount_cents: 0, value: 0 });
  totals.hours = minutesToDecimalHours(totals.minutes);

  return {
    report: {
      id: report.id,
      name: report.name,
      description: report.description,
      source: report.source,
      metric: report.metric,
      chartType: report.chart_type,
      groupByFieldId: report.group_by_field_id,
      groupByLabel: report.group_by_label,
      showOnDashboard: !!report.show_on_dashboard,
    },
    rows,
    totals,
    valueLabel: report.metric === 'hours'
      ? 'Hours'
      : report.metric === 'amount'
        ? 'Amount'
        : 'Count',
  };
}

function dashboard(db, actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'report');
  const widgets = [];

  for (const firmId of getDashboardFirmReportIds(db)) {
    try {
      widgets.push(runFirmReport(db, firmId));
    } catch (e) {
      const meta = firmReportMeta(firmId);
      widgets.push({
        kind: 'firm',
        report: {
          id: firmId,
          name: meta?.name || firmId,
          description: meta?.description || '',
          chartType: 'table',
          kind: 'firm',
          showOnDashboard: true,
        },
        rows: [],
        columns: [],
        totals: { count: 0, minutes: 0, hours: 0, amount_cents: 0, value: 0 },
        valueLabel: 'Rows',
        error: e.message,
      });
    }
  }

  for (const r of listReports(db, { dashboardOnly: true })) {
    try {
      const payload = runReport(db, r.id);
      widgets.push({ ...payload, kind: 'custom' });
    } catch (e) {
      widgets.push({
        kind: 'custom',
        report: {
          id: r.id,
          name: r.name,
          description: r.description,
          source: r.source,
          metric: r.metric,
          chartType: r.chart_type,
          groupByFieldId: r.group_by_field_id,
          groupByLabel: r.group_by_label,
          showOnDashboard: true,
        },
        rows: [],
        totals: { count: 0, minutes: 0, hours: 0, amount_cents: 0, value: 0 },
        valueLabel: r.metric === 'hours' ? 'Hours' : r.metric === 'amount' ? 'Amount' : 'Count',
        error: e.message,
      });
    }
  }

  return {
    widgets,
    available: listAvailableDashboardAdds(db),
    firmCatalog: FIRM_REPORT_CATALOG,
  };
}

function customWidgetExportRows(widget) {
  return (widget.rows || []).map((r) => ({
    group: r.label,
    value: r.value,
    count: r.count,
    hours: r.hours,
    amount_cents: r.amount_cents,
  }));
}

function exportDashboard(db, format = 'pdf', actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'report');
  const fmt = String(format || 'pdf').toLowerCase();
  const { widgets } = dashboard(db);
  const filenameBase = 'dashboard-reports';

  if (fmt === 'csv') {
    const chunks = [];
    for (const w of widgets) {
      chunks.push(`# ${w.report.name}`);
      const rows = w.kind === 'firm' ? (w.rows || []) : customWidgetExportRows(w);
      chunks.push(rows.length ? reports.toCsv(rows) : 'No rows');
      chunks.push('');
    }
    if (!chunks.length) chunks.push('# Dashboard', 'No reports pinned');
    return {
      contentType: 'text/csv; charset=utf-8',
      filename: `${filenameBase}.csv`,
      body: Buffer.from(chunks.join('\n'), 'utf8'),
    };
  }

  if (fmt === 'xlsx' || fmt === 'excel') {
    const sheetRows = [];
    for (const w of widgets) {
      const rows = w.kind === 'firm' ? (w.rows || []) : customWidgetExportRows(w);
      sheetRows.push([{ v: w.report.name, t: 's' }]);
      if (!rows.length) {
        sheetRows.push([{ v: 'No rows', t: 's' }]);
      } else {
        const keys = Object.keys(rows[0]);
        sheetRows.push(keys.map((k) => ({ v: k, t: 's' })));
        for (const row of rows) {
          sheetRows.push(keys.map((k) => {
            if (FIRM_CURRENCY_KEYS.includes(k) && Number.isInteger(row[k])) {
              return { v: row[k] / 100, t: 'currency' };
            }
            if (typeof row[k] === 'number') return { v: row[k], t: 'n' };
            return { v: row[k] ?? '', t: 's' };
          }));
        }
      }
      sheetRows.push([]);
    }
    if (!sheetRows.length) {
      sheetRows.push([{ v: 'No reports pinned', t: 's' }]);
    }
    const { buildXlsx } = require('../xlsx');
    const buf = buildXlsx(sheetRows);
    return {
      contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: `${filenameBase}.xlsx`,
      body: buf,
    };
  }

  if (fmt === 'pdf') {
    const lines = [];
    if (!widgets.length) {
      lines.push('No reports pinned to the dashboard.');
    }
    for (const w of widgets) {
      lines.push(`=== ${w.report.name} ===`);
      if (w.error) {
        lines.push(`Error: ${w.error}`);
        lines.push('');
        continue;
      }
      const rows = w.kind === 'firm' ? (w.rows || []) : customWidgetExportRows(w);
      if (!rows.length) {
        lines.push('No rows');
        lines.push('');
        continue;
      }
      const keys = Object.keys(rows[0]);
      for (const row of rows) {
        lines.push('--------------------------------------------------------------------------');
        for (const key of keys) {
          const label = String(key).replace(/_cents$/i, '').replace(/_/g, ' ')
            .replace(/\b\w/g, (c) => c.toUpperCase()).padEnd(22);
          let cell = row[key];
          if (FIRM_CURRENCY_KEYS.includes(key) && Number.isInteger(cell)) {
            cell = (cell / 100).toFixed(2);
          }
          lines.push(`${label} ${cell == null ? '' : cell}`);
        }
      }
      lines.push('--------------------------------------------------------------------------');
      lines.push(`Rows: ${rows.length}`);
      lines.push('');
    }
    return {
      contentType: 'application/pdf',
      filename: `${filenameBase}.pdf`,
      body: buildTextPdf({ title: 'Dashboard Reports', lines }),
    };
  }

  throw new Error('unsupported format');
}

module.exports = {
  listReports,
  getReport,
  createReport,
  updateReport,
  deactivateReport,
  setShowOnDashboard,
  runReport,
  runFirmReport,
  dashboard,
  exportDashboard,
  pinDashboardReport,
  unpinDashboardReport,
  addFirmReportToDashboard,
  removeFirmReportFromDashboard,
  getDashboardFirmReportIds,
  listAvailableDashboardAdds,
  listFirmReports,
  disableFirmReport,
  enableFirmReport,
  getDisabledFirmReportIds,
  FIRM_REPORT_CATALOG,
  SOURCES,
  METRICS,
  CHART_TYPES,
};
