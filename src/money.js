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

/** Duration display formats for timers & time entries. */
const DURATION_FORMATS = [
  {
    id: 'hms',
    label: 'hh:mm:ss',
    description: 'Show seconds when running and viewing timers & time entries',
  },
  {
    id: 'hm',
    label: 'hh:mm',
    description: 'Hours and minutes only',
  },
  {
    id: 'decimal',
    label: 'Hour Decimal',
    description: 'Decimal hours (e.g. 0.25, 0.50)',
  },
];

/** Rounding modes with firm-facing copy. */
const ROUNDING_MODES = [
  {
    id: 'up',
    label: 'Round up to',
    description: 'If the interval is 30 minutes, a 14 minute entry will bill as 0.50 hr',
  },
  {
    id: 'nearest',
    label: 'Round to the Nearest',
    description:
      'If the interval is 30 minutes, a 14 minute entry will bill as 0.0 hr. '
      + 'Rounding to the nearest will round up if the duration is in the middle of the interval',
  },
  {
    id: 'down',
    label: 'Round Down',
    description: 'If the interval is 30 minutes, a 14 minute entry will bill as 0.0 hr',
  },
  {
    id: 'none',
    label: 'Do Not Round',
    description: 'If the interval is 30 minutes, a 14 minute entry will bill as 0.23 hr',
  },
];

const ALLOWED_ROUND_MODES = new Set(ROUNDING_MODES.map((m) => m.id));
const ALLOWED_DURATION_FORMATS = new Set(DURATION_FORMATS.map((f) => f.id));

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

function assertRoundMode(mode) {
  if (!ALLOWED_ROUND_MODES.has(mode)) {
    throw new Error(`roundMode must be one of ${[...ALLOWED_ROUND_MODES].join(', ')}`);
  }
  return mode;
}

function assertDurationFormat(fmt) {
  if (!ALLOWED_DURATION_FORMATS.has(fmt)) {
    throw new Error(`durationFormat must be one of ${[...ALLOWED_DURATION_FORMATS].join(', ')}`);
  }
  return fmt;
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
 * Round minutes to increment.
 * Modes: 'up' | 'nearest' | 'down' | 'none'.
 * nearest uses half-up at the midpoint (e.g. exactly half the interval rounds up).
 * nearest/down may yield 0; 'none' returns raw minutes unchanged.
 */
function roundMinutes(rawMinutes, increment = 15, mode = 'up') {
  assertInt(rawMinutes, 'rawMinutes');
  if (rawMinutes <= 0) throw new Error('rawMinutes must be > 0');
  mode = assertRoundMode(mode);

  if (mode === 'none') return rawMinutes;

  assertAllowedIncrement(increment);

  if (mode === 'up') {
    return Math.ceil(rawMinutes / increment) * increment;
  }
  if (mode === 'down') {
    return Math.floor(rawMinutes / increment) * increment;
  }
  // nearest — JS Math.round is half-up for positive values
  return Math.round(rawMinutes / increment) * increment;
}

/** Decimal hours to 2 places (14 min → 0.23). */
function minutesToDecimalHours(minutes) {
  assertInt(minutes, 'minutes');
  const sign = minutes < 0 ? -1 : 1;
  const abs = Math.abs(minutes);
  // half-up to 2 decimal places: minutes/60 * 100
  const hundredths = divideHalfUp(abs * 100, 60);
  return (sign * hundredths) / 100;
}

/**
 * Format a duration in minutes for display.
 * @param {number} minutes integer minutes (may be 0)
 * @param {'hms'|'hm'|'decimal'} format
 */
function formatDuration(minutes, format = 'decimal') {
  assertInt(minutes, 'minutes');
  format = assertDurationFormat(format);
  const neg = minutes < 0;
  const abs = Math.abs(minutes);

  if (format === 'decimal') {
    const d = minutesToDecimalHours(abs);
    return `${neg ? '-' : ''}${d.toFixed(2)}`;
  }

  const totalSec = abs * 60;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const hh = String(h).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  const core = format === 'hms' ? `${hh}:${mm}:${ss}` : `${hh}:${mm}`;
  return neg ? `-${core}` : core;
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
  DURATION_FORMATS,
  ROUNDING_MODES,
  ALLOWED_ROUND_MODES,
  ALLOWED_DURATION_FORMATS,
  assertAllowedIncrement,
  assertRoundMode,
  assertDurationFormat,
  divideHalfUp,
  roundMinutes,
  minutesToDecimalHours,
  formatDuration,
  amountFromMinutes,
  formatCents,
  centsFromDollarsString,
};
