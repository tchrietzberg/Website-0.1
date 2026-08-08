/**
 * All currency/time math lives here. Integer cents + integer minutes only.
 * Division rounds half-up on the residual.
 */

/** Primary legal-billing increments (minutes → hour fraction). */
const ROUNDING_INCREMENTS = [
  { minutes: 6, hours: 0.1, label: '6-minute (0.1 hour)' },
  { minutes: 10, hours: 0.167, label: '10-minute (0.167 hour)' },
  { minutes: 12, hours: 0.2, label: '12-minute (0.2 hour)' },
  { minutes: 15, hours: 0.25, label: '15-minute (0.25 hour)' },
  { minutes: 30, hours: 0.5, label: '30-minute (0.5 hour)' },
];

const ALLOWED_INCREMENTS = new Set(ROUNDING_INCREMENTS.map((r) => r.minutes));

function assertInt(n, label = 'value') {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer, got ${n}`);
}

function assertAllowedIncrement(increment) {
  assertInt(increment, 'increment');
  if (!ALLOWED_INCREMENTS.has(increment)) {
    throw new Error(
      `increment must be one of ${[...ALLOWED_INCREMENTS].join(', ')} minutes`
    );
  }
  return increment;
}

/** Half-up division for non-negative integers: round(n / d). */
function divideHalfUp(n, d) {
  assertInt(n, 'numerator');
  assertInt(d, 'denominator');
  if (d <= 0) throw new Error('denominator must be positive');
  if (n < 0) throw new Error('numerator must be non-negative');
  return Math.trunc((n + Math.trunc(d / 2)) / d);
}

/**
 * Round minutes to increment. Modes: 'up' | 'nearest' | 'down'.
 * Positive entries never round to zero.
 */
function roundMinutes(rawMinutes, increment = 15, mode = 'up') {
  assertInt(rawMinutes, 'rawMinutes');
  assertAllowedIncrement(increment);
  if (rawMinutes <= 0) throw new Error('rawMinutes must be > 0');

  let rounded;
  if (mode === 'up') {
    rounded = Math.ceil(rawMinutes / increment) * increment;
  } else if (mode === 'down') {
    rounded = Math.floor(rawMinutes / increment) * increment;
  } else if (mode === 'nearest') {
    rounded = Math.round(rawMinutes / increment) * increment;
  } else {
    throw new Error(`unknown rounding mode: ${mode}`);
  }

  if (rounded === 0) rounded = increment;
  return rounded;
}

/** amount = minutes * rateCents / 60, half-up. */
function amountFromMinutes(minutes, rateCents) {
  assertInt(minutes, 'minutes');
  assertInt(rateCents, 'rateCents');
  if (minutes < 0 || rateCents < 0) throw new Error('minutes and rate must be non-negative');
  return divideHalfUp(minutes * rateCents, 60);
}

function formatCents(cents) {
  assertInt(cents, 'cents');
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const rem = abs % 100;
  return `${sign}$${dollars}.${String(rem).padStart(2, '0')}`;
}

function centsFromDollarsString(s) {
  const m = String(s).trim().match(/^(-?)\$?(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) throw new Error(`invalid money string: ${s}`);
  const neg = m[1] === '-';
  const dollars = Number(m[2]);
  const frac = (m[3] || '0').padEnd(2, '0');
  const cents = dollars * 100 + Number(frac);
  return neg ? -cents : cents;
}

module.exports = {
  ROUNDING_INCREMENTS,
  ALLOWED_INCREMENTS,
  assertAllowedIncrement,
  divideHalfUp,
  roundMinutes,
  amountFromMinutes,
  formatCents,
  centsFromDollarsString,
};
