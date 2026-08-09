const {
  roundMinutes,
  hoursToMinutes,
  assertAllowedIncrement,
  assertRoundMode,
} = require('../money');
const { getSetting, setSetting, audit } = require('../db');
const customFields = require('./customFields');
const permissions = require('./permissions');

function evaluateRules(db, entry) {
  const rules = db.prepare('SELECT * FROM billing_rules WHERE active = 1').all();
  const errors = [];
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(entry.matterId);
  for (const rule of rules) {
    const cond = JSON.parse(rule.condition_json);
    if (cond.require_category_for_court) {
      const court = (matter?.court || '').toLowerCase();
      if (court.includes(cond.require_category_for_court.toLowerCase())) {
        if (!entry.category || !entry.subcategory) {
          errors.push(rule.message);
        }
      }
    }
  }
  return errors;
}

function detectDuplicates(db, { timekeeperId, matterId, serviceDate, roundedMinutes, excludeId = null }) {
  const rows = db.prepare(`
    SELECT id FROM time_entries
    WHERE timekeeper_id = ? AND matter_id = ? AND service_date = ?
      AND rounded_minutes = ? AND status != 'rejected'
      AND (? IS NULL OR id != ?)
  `).all(timekeeperId, matterId, serviceDate, roundedMinutes, excludeId, excludeId);
  return rows.map((r) => r.id);
}

/** Billable matters default billable=1; Non-Billable record type defaults to 0. */
function defaultBillableFromMatter(matter) {
  const key = String(matter?.matter_type || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (key === 'non_billable' || key.startsWith('non_billable')) return 0;
  return 1;
}

function resolveMinutes(input) {
  const hoursValue = input.hours;
  const hasHours = hoursValue != null && hoursValue !== ''
    && !(typeof hoursValue === 'number' && Number.isNaN(hoursValue));
  if (hasHours) {
    // Quarter-hour entry already matches billed increments — do not re-round.
    const rawMinutes = hoursToMinutes(hoursValue);
    return { rawMinutes, rounded: rawMinutes, fromHours: true };
  }
  if (input.rawMinutes == null || input.rawMinutes === '') {
    throw new Error('hours is required (0.25 increments)');
  }
  const rawMinutes = Number(input.rawMinutes);
  if (!Number.isInteger(rawMinutes)) {
    throw new Error(`rawMinutes must be an integer, got ${input.rawMinutes}`);
  }
  return { rawMinutes, rounded: null, fromHours: false };
}

function createEntry(db, actor, input) {
  permissions.assertCanModifyRecords(db, actor, 'time');
  const mode = assertRoundMode(getSetting(db, 'round_mode', 'up'));
  const defaultInc = Number(getSetting(db, 'round_increment_minutes', '15'));
  const increment = mode === 'none'
    ? defaultInc
    : assertAllowedIncrement(
      input.roundIncrementMinutes != null ? Number(input.roundIncrementMinutes) : defaultInc
    );
  const resolved = resolveMinutes(input);
  const rounded = resolved.rounded != null
    ? resolved.rounded
    : roundMinutes(resolved.rawMinutes, increment, mode);
  input = { ...input, rawMinutes: resolved.rawMinutes };

  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(input.matterId);
  if (!matter) throw new Error('matter not found');

  let timekeeperId = Number(input.timekeeperId || actor.id);
  if (!Number.isFinite(timekeeperId) || timekeeperId <= 0) timekeeperId = actor.id;
  if (timekeeperId !== actor.id && !permissions.canSelectTimekeeper(db, actor.role)) {
    const err = new Error('You can only create time entries for yourself');
    err.code = 'FORBIDDEN';
    throw err;
  }

  let billable = input.billable;
  if (billable == null || billable === '') {
    billable = defaultBillableFromMatter(matter);
  } else {
    billable = (billable === true || billable === 1 || billable === '1' || billable === 'on') ? 1 : 0;
  }

  const candidate = {
    matterId: input.matterId,
    timekeeperId,
    serviceDate: input.serviceDate,
    rawMinutes: input.rawMinutes,
    roundedMinutes: rounded,
    description: input.description,
    billable,
    category: input.category || null,
    subcategory: input.subcategory || null,
    utbmsTask: input.utbmsTask || null,
    utbmsActivity: input.utbmsActivity || null,
  };

  const ruleErrors = evaluateRules(db, candidate);
  if (ruleErrors.length) {
    const err = new Error(ruleErrors.join('; '));
    err.code = 'BILLING_RULE';
    err.errors = ruleErrors;
    throw err;
  }

  const dupes = detectDuplicates(db, candidate);
  const customValues = input.customValues && typeof input.customValues === 'object'
    ? input.customValues
    : {};
  customFields.assertRequiredCustomValues(db, {
    appliesTo: 'time_entry',
    values: customValues,
  });

  // No approval workflow — saved time is immediately ready to bill.
  const info = db.prepare(`
    INSERT INTO time_entries(
      matter_id, timekeeper_id, service_date, raw_minutes, rounded_minutes,
      description, billable, category, subcategory, utbms_task, utbms_activity,
      status, approved_by, approved_at
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      'approved', ?, strftime('%Y-%m-%dT%H:%M:%fZ','now')
    )
  `).run(
    candidate.matterId, candidate.timekeeperId, candidate.serviceDate,
    candidate.rawMinutes, candidate.roundedMinutes, candidate.description,
    candidate.billable, candidate.category, candidate.subcategory,
    candidate.utbmsTask, candidate.utbmsActivity,
    actor.id
  );

  const entryId = Number(info.lastInsertRowid);
  if (Object.keys(customValues).length) {
    customFields.setTimeCustomValues(db, actor, entryId, customValues);
  }

  audit(db, {
    actorId: actor.id,
    action: 'time_entry.create',
    entityType: 'time_entry',
    entityId: entryId,
    detail: { rawMinutes: candidate.rawMinutes, roundedMinutes: candidate.roundedMinutes, status: 'approved' },
  });

  return {
    id: entryId,
    ...candidate,
    roundIncrementMinutes: increment,
    status: 'approved',
    duplicateWarnings: dupes,
    customValues: Object.fromEntries(
      customFields.getTimeCustomValues(db, entryId).map((v) => [v.field_id, v.value_text])
    ),
  };
}

function submitEntry(db, actor, id) {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) throw new Error('entry not found');
  if (entry.timekeeper_id !== actor.id && !permissions.canModifyOthersTime(db, actor.role)) {
    const err = new Error('You can only submit your own time entries');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (entry.status !== 'draft' && entry.status !== 'rejected') {
    throw new Error(`cannot submit from status ${entry.status}`);
  }
  db.prepare(`UPDATE time_entries SET status = 'submitted', rejection_reason = NULL WHERE id = ?`).run(id);
  audit(db, { actorId: actor.id, action: 'time_entry.submit', entityType: 'time_entry', entityId: id });
  return db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
}

function canApprove(actor, entry, matter) {
  if (actor.role === 'admin' || actor.role === 'billing_clerk') return true;
  if (actor.role === 'attorney' && matter.responsible_attorney_id === actor.id) return true;
  return false;
}

function approveEntry(db, actor, id) {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) throw new Error('entry not found');
  if (entry.status !== 'submitted') throw new Error('only submitted entries can be approved');
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(entry.matter_id);
  if (!canApprove(actor, entry, matter)) {
    const err = new Error('not permitted to approve this entry');
    err.code = 'FORBIDDEN';
    throw err;
  }
  db.prepare(`
    UPDATE time_entries SET status = 'approved', approved_by = ?, approved_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
    WHERE id = ?
  `).run(actor.id, id);
  audit(db, { actorId: actor.id, action: 'time_entry.approve', entityType: 'time_entry', entityId: id });
  return db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
}

function rejectEntry(db, actor, id, reason) {
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) throw new Error('entry not found');
  if (entry.status !== 'submitted') throw new Error('only submitted entries can be rejected');
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(entry.matter_id);
  if (!canApprove(actor, entry, matter)) {
    const err = new Error('not permitted to reject this entry');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (!reason || !String(reason).trim()) throw new Error('rejection reason required');
  db.prepare(`
    UPDATE time_entries SET status = 'rejected', rejection_reason = ?, approved_by = NULL, approved_at = NULL
    WHERE id = ?
  `).run(reason, id);
  audit(db, {
    actorId: actor.id,
    action: 'time_entry.reject',
    entityType: 'time_entry',
    entityId: id,
    detail: { reason },
  });
  return db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
}

function listQueue(db) {
  return db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.name AS matter_name
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE te.status = 'submitted'
    ORDER BY te.service_date, te.id
  `).all();
}

function redactTimekeeperName(row, actor, access) {
  if (!actor || !row) return row;
  if (Number(row.timekeeper_id) === Number(actor.id)) return row;
  if (access.selectTimekeeper) return row;
  return { ...row, timekeeper_name: null };
}

function listEntries(db, filters = {}, actor = null) {
  if (actor) permissions.assertCanViewRecords(db, actor, 'time');
  let { matterId = null, timekeeperId = null, status = null } = filters || {};
  const access = actor ? permissions.getRoleObjectAccess(db, actor.role, 'time') : null;
  if (actor && access && !access.viewOthers) {
    timekeeperId = actor.id;
  } else if (
    actor
    && access
    && !access.selectTimekeeper
    && timekeeperId != null
    && Number(timekeeperId) !== Number(actor.id)
  ) {
    // Without select-timekeeper, do not expose other timekeepers by filter.
    timekeeperId = actor.id;
  }
  const rows = db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.name AS matter_name
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE (? IS NULL OR te.matter_id = ?)
      AND (? IS NULL OR te.timekeeper_id = ?)
      AND (? IS NULL OR te.status = ?)
    ORDER BY te.service_date DESC, te.id DESC
  `).all(matterId, matterId, timekeeperId, timekeeperId, status, status);
  if (!actor || !access) return rows;
  return rows.map((row) => redactTimekeeperName(row, actor, access));
}

/** Earliest service_date for a matter (respects the actor's time visibility). */
function earliestServiceDate(db, matterId, actor = null) {
  if (!matterId) return null;
  if (actor) permissions.assertCanViewRecords(db, actor, 'time');
  let timekeeperId = null;
  const access = actor ? permissions.getRoleObjectAccess(db, actor.role, 'time') : null;
  if (actor && access && !access.viewOthers) {
    timekeeperId = actor.id;
  }
  const row = db.prepare(`
    SELECT MIN(te.service_date) AS earliest
    FROM time_entries te
    WHERE te.matter_id = ?
      AND (? IS NULL OR te.timekeeper_id = ?)
  `).get(Number(matterId), timekeeperId, timekeeperId);
  const earliest = row?.earliest ? String(row.earliest).slice(0, 10) : '';
  return /^\d{4}-\d{2}-\d{2}$/.test(earliest) ? earliest : null;
}

function getEntry(db, id) {
  return db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number, m.name AS matter_name
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE te.id = ?
  `).get(id);
}

function updateEntry(db, actor, id, input = {}) {
  permissions.assertCanModifyRecords(db, actor, 'time');
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) throw new Error('entry not found');
  if (entry.status === 'invoiced' || entry.invoice_id) {
    throw new Error('Cannot edit a time entry that has already been billed');
  }

  const isOwn = Number(entry.timekeeper_id) === Number(actor.id);
  if (!isOwn && !permissions.canModifyOthersTime(db, actor.role)) {
    const err = new Error('You can only edit your own time entries');
    err.code = 'FORBIDDEN';
    throw err;
  }

  let timekeeperId = input.timekeeperId != null ? Number(input.timekeeperId) : entry.timekeeper_id;
  if (!Number.isFinite(timekeeperId) || timekeeperId <= 0) timekeeperId = entry.timekeeper_id;
  if (
    Number(timekeeperId) !== Number(actor.id)
    && !permissions.canSelectTimekeeper(db, actor.role)
  ) {
    const err = new Error('You can only create time entries for yourself');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const matterId = input.matterId != null ? Number(input.matterId) : entry.matter_id;
  const matter = db.prepare('SELECT * FROM matters WHERE id = ?').get(matterId);
  if (!matter) throw new Error('matter not found');

  const serviceDate = input.serviceDate != null
    ? String(input.serviceDate).slice(0, 10)
    : entry.service_date;
  const description = input.description !== undefined
    ? String(input.description || '').trim()
    : entry.description;
  if (!description) throw new Error('description required');

  const mode = assertRoundMode(getSetting(db, 'round_mode', 'up'));
  const defaultInc = Number(getSetting(db, 'round_increment_minutes', '15'));
  const increment = mode === 'none'
    ? defaultInc
    : assertAllowedIncrement(
      input.roundIncrementMinutes != null ? Number(input.roundIncrementMinutes) : defaultInc
    );

  let rawMinutes = entry.raw_minutes;
  let roundedMinutes = entry.rounded_minutes;
  if (input.hours != null || input.rawMinutes != null) {
    const resolved = resolveMinutes(input);
    rawMinutes = resolved.rawMinutes;
    roundedMinutes = resolved.rounded != null
      ? resolved.rounded
      : roundMinutes(resolved.rawMinutes, increment, mode);
  }

  let billable = entry.billable;
  if (input.billable != null) billable = input.billable ? 1 : 0;

  const category = input.category !== undefined ? (input.category || null) : entry.category;
  const subcategory = input.subcategory !== undefined
    ? (input.subcategory || null)
    : entry.subcategory;
  const utbmsTask = input.utbmsTask !== undefined ? (input.utbmsTask || null) : entry.utbms_task;
  const utbmsActivity = input.utbmsActivity !== undefined
    ? (input.utbmsActivity || null)
    : entry.utbms_activity;

  const candidate = {
    matterId,
    timekeeperId,
    serviceDate,
    rawMinutes,
    roundedMinutes,
    description,
    billable,
    category,
    subcategory,
    utbmsTask,
    utbmsActivity,
  };

  const ruleErrors = evaluateRules(db, candidate);
  if (ruleErrors.length) {
    const err = new Error(ruleErrors.join('; '));
    err.code = 'BILLING_RULE';
    err.errors = ruleErrors;
    throw err;
  }

  const customValues = input.customValues && typeof input.customValues === 'object'
    ? input.customValues
    : null;
  if (customValues) {
    const existing = Object.fromEntries(
      customFields.getTimeCustomValues(db, id).map((v) => [v.field_id, v.value_text])
    );
    const merged = { ...existing, ...customValues };
    customFields.assertRequiredCustomValues(db, {
      appliesTo: 'time_entry',
      values: merged,
    });
    customFields.setTimeCustomValues(db, actor, id, customValues);
  }

  db.prepare(`
    UPDATE time_entries SET
      matter_id = ?,
      timekeeper_id = ?,
      service_date = ?,
      raw_minutes = ?,
      rounded_minutes = ?,
      description = ?,
      billable = ?,
      category = ?,
      subcategory = ?,
      utbms_task = ?,
      utbms_activity = ?
    WHERE id = ?
  `).run(
    matterId,
    timekeeperId,
    serviceDate,
    rawMinutes,
    roundedMinutes,
    description,
    billable,
    category,
    subcategory,
    utbmsTask,
    utbmsActivity,
    id
  );

  audit(db, {
    actorId: actor.id,
    action: 'time_entry.update',
    entityType: 'time_entry',
    entityId: id,
    detail: {
      matterId,
      serviceDate,
      roundedMinutes,
      description,
    },
  });

  const updated = getEntry(db, id);
  return {
    id: updated.id,
    matterId: updated.matter_id,
    timekeeperId: updated.timekeeper_id,
    serviceDate: updated.service_date,
    rawMinutes: updated.raw_minutes,
    roundedMinutes: updated.rounded_minutes,
    description: updated.description,
    billable: updated.billable,
    category: updated.category,
    subcategory: updated.subcategory,
    utbmsTask: updated.utbms_task,
    utbmsActivity: updated.utbms_activity,
    status: updated.status,
    matter_name: updated.matter_name,
    matter_number: updated.matter_number,
    timekeeper_name: updated.timekeeper_name,
    customValues: Object.fromEntries(
      customFields.getTimeCustomValues(db, id).map((v) => [v.field_id, v.value_text])
    ),
  };
}

/**
 * Remove a time entry from any bills it appears on so the entry row can be deleted.
 * Sent-invoice amount immutability is temporarily relaxed by flipping status while
 * totals are recomputed; empty bills are removed entirely.
 */
function detachTimeEntryFromBills(db, timeEntryId) {
  const lines = db.prepare(
    'SELECT id, invoice_id FROM invoice_lines WHERE time_entry_id = ?'
  ).all(timeEntryId);
  if (!lines.length) return { removedLines: 0, deletedInvoiceIds: [] };

  const invoiceIds = [...new Set(lines.map((l) => Number(l.invoice_id)))];
  const deletedInvoiceIds = [];

  for (const invoiceId of invoiceIds) {
    // Status-only update is allowed on sent invoices; amount changes are not.
    db.prepare(`
      UPDATE invoices SET status = 'approved'
      WHERE id = ? AND status = 'sent'
    `).run(invoiceId);
  }

  for (const line of lines) {
    db.prepare('DELETE FROM write_downs WHERE invoice_line_id = ?').run(line.id);
    db.prepare('DELETE FROM invoice_lines WHERE id = ?').run(line.id);
  }

  for (const invoiceId of invoiceIds) {
    const remaining = db.prepare(
      'SELECT COUNT(*) AS n FROM invoice_lines WHERE invoice_id = ?'
    ).get(invoiceId).n;
    if (remaining === 0) {
      db.prepare('DELETE FROM payment_applications WHERE invoice_id = ?').run(invoiceId);
      db.prepare('DELETE FROM write_downs WHERE invoice_id = ?').run(invoiceId);
      db.prepare('DELETE FROM credit_notes WHERE invoice_id = ?').run(invoiceId);
      db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
      deletedInvoiceIds.push(invoiceId);
      continue;
    }
    const totals = db.prepare(`
      SELECT
        COALESCE(SUM(amount_cents), 0) AS subtotal,
        COALESCE(SUM(write_down_cents), 0) AS write_down
      FROM invoice_lines WHERE invoice_id = ?
    `).get(invoiceId);
    const total = totals.subtotal - totals.write_down;
    db.prepare(`
      UPDATE invoices
      SET subtotal_cents = ?, write_down_cents = ?, total_cents = ?, status = 'sent'
      WHERE id = ?
    `).run(totals.subtotal, totals.write_down, total, invoiceId);
  }

  return { removedLines: lines.length, deletedInvoiceIds };
}

function deleteEntry(db, actor, id) {
  permissions.assertCanDeleteRecords(db, actor, 'time');
  const entry = db.prepare('SELECT * FROM time_entries WHERE id = ?').get(id);
  if (!entry) throw new Error('entry not found');
  const isOwn = Number(entry.timekeeper_id) === Number(actor.id);
  if (!isOwn && !permissions.canDeleteOthersTime(db, actor.role)) {
    const err = new Error('You can only delete your own time entries');
    err.code = 'FORBIDDEN';
    throw err;
  }

  const wasBilled = entry.status === 'invoiced' || entry.invoice_id != null;
  let billCleanup = { removedLines: 0, deletedInvoiceIds: [] };

  db.exec('BEGIN');
  try {
    if (wasBilled) {
      billCleanup = detachTimeEntryFromBills(db, id);
    }
    db.prepare('DELETE FROM time_entry_custom_field_values WHERE time_entry_id = ?').run(id);
    db.prepare('DELETE FROM time_entries WHERE id = ?').run(id);
    db.exec('COMMIT');
  } catch (e) {
    try { db.exec('ROLLBACK'); } catch { /* ignore */ }
    throw e;
  }

  audit(db, {
    actorId: actor?.id || null,
    action: 'time_entry.delete',
    entityType: 'time_entry',
    entityId: id,
    detail: {
      matterId: entry.matter_id,
      serviceDate: entry.service_date,
      roundedMinutes: entry.rounded_minutes,
      wasBilled,
      removedBillLines: billCleanup.removedLines,
      deletedInvoiceIds: billCleanup.deletedInvoiceIds,
    },
  });
  return {
    ok: true,
    id: Number(id),
    wasBilled,
    removedBillLines: billCleanup.removedLines,
    deletedInvoiceIds: billCleanup.deletedInvoiceIds,
  };
}

module.exports = {
  createEntry,
  updateEntry,
  getEntry,
  submitEntry,
  approveEntry,
  rejectEntry,
  deleteEntry,
  listQueue,
  listEntries,
  earliestServiceDate,
  evaluateRules,
  detectDuplicates,
  canApprove,
  defaultBillableFromMatter,
};
