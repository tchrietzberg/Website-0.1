/**
 * Matter record-type billing modes for time entry defaults and invoicing.
 *
 * - billable: charge on invoice at timekeeper/matter rates
 * - non_billable: appear on invoice with hours and $0 amounts (no charge)
 * - do_not_charge: never appear on invoices; time is always non-billable
 */

function normalizeMatterTypeKey(matterType) {
  return String(matterType || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
}

function matterBillingMode(matterType) {
  const key = normalizeMatterTypeKey(matterType);
  if (!key || key === 'billable' || key.startsWith('billable')) return 'billable';
  if (key === 'do_not_charge' || key.startsWith('do_not_charge')) return 'do_not_charge';
  if (key === 'non_billable' || key.startsWith('non_billable')) return 'non_billable';
  // Custom firm types default to billable charging unless named like the above.
  return 'billable';
}

function defaultBillableForMatterType(matterType) {
  const mode = matterBillingMode(matterType);
  return mode === 'billable' ? 1 : 0;
}

/** Do not charge matters cannot be marked billable. */
function forcesNonBillable(matterType) {
  return matterBillingMode(matterType) === 'do_not_charge';
}

function canInvoiceMatterType(matterType) {
  return matterBillingMode(matterType) !== 'do_not_charge';
}

function invoiceLinesAreZeroCharge(matterType) {
  return matterBillingMode(matterType) === 'non_billable';
}

module.exports = {
  normalizeMatterTypeKey,
  matterBillingMode,
  defaultBillableForMatterType,
  forcesNonBillable,
  canInvoiceMatterType,
  invoiceLinesAreZeroCharge,
};
