const { audit } = require('../db');
const { amountFromMinutes, minutesToDecimalHours } = require('../money');
const { resolveRate } = require('../rates');

const SOURCES = new Set(['time_entry', 'matter']);
const METRICS = new Set(['count', 'hours', 'amount']);
const CHART_TYPES = new Set(['bar', 'pie', 'table']);

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

function listReports(db, { dashboardOnly = false } = {}) {
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

function deactivateReport(db, actor, id) {
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

function runReport(db, id) {
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

function dashboard(db) {
  const reports = listReports(db, { dashboardOnly: true });
  return {
    widgets: reports.map((r) => {
      try {
        return runReport(db, r.id);
      } catch (e) {
        return {
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
        };
      }
    }),
  };
}

module.exports = {
  listReports,
  getReport,
  createReport,
  deactivateReport,
  runReport,
  dashboard,
  SOURCES,
  METRICS,
  CHART_TYPES,
};
