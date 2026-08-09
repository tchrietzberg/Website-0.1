const {
  roundMinutes,
  hoursToMinutes,
  assertAllowedIncrement,
  assertRoundMode,
} = require('../money');
const { getSetting, setSetting, audit } = require('../db');
const customFields = require('./customFields');

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
  const canProxy = actor.role === 'admin' || actor.role === 'billing_clerk';
  if (!canProxy && timekeeperId !== actor.id) {
    const err = new Error('You can only create time entries for yourself');
    err.code = 'FORBIDDEN';
    throw err;
  }
  if (!Number.isFinite(timekeeperId) || timekeeperId <= 0) timekeeperId = actor.id;

  let billable = input.billable;
  if (billable == null) {
    billable = 1;
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
  if (input.customValues && typeof input.customValues === 'object') {
    customFields.setTimeCustomValues(db, actor, entryId, input.customValues);
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
  const canProxy = actor.role === 'admin' || actor.role === 'billing_clerk';
  if (!canProxy && entry.timekeeper_id !== actor.id) {
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

function listEntries(db, { matterId = null, timekeeperId = null, status = null } = {}) {
  return db.prepare(`
    SELECT te.*, u.name AS timekeeper_name, m.number AS matter_number
    FROM time_entries te
    JOIN users u ON u.id = te.timekeeper_id
    JOIN matters m ON m.id = te.matter_id
    WHERE (? IS NULL OR te.matter_id = ?)
      AND (? IS NULL OR te.timekeeper_id = ?)
      AND (? IS NULL OR te.status = ?)
    ORDER BY te.service_date DESC, te.id DESC
  `).all(matterId, matterId, timekeeperId, timekeeperId, status, status);
}

module.exports = {
  createEntry,
  submitEntry,
  approveEntry,
  rejectEntry,
  listQueue,
  listEntries,
  evaluateRules,
  detectDuplicates,
  canApprove,
};
