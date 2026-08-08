/**
 * All currency/time math lives here. Integer cents + integer minutes only.
 * Division rounds half-up on the residual.
 */

function assertInt(n, label = 'value') {
  if (!Number.isInteger(n)) throw new Error(`${label} must be an integer, got ${n}`);
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
  assertInt(increment, 'increment');
  if (rawMinutes <= 0) throw new Error('rawMinutes must be > 0');
  if (increment <= 0) throw new Error('increment must be > 0');

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
  divideHalfUp,
  roundMinutes,
  amountFromMinutes,
  formatCents,
  centsFromDollarsString,
};
