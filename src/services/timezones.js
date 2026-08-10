/**
 * Firm timezone helpers (IANA). Used for calendar "today" on time entries.
 */

const DEFAULT_TIMEZONE = 'America/New_York';

let cachedZones = null;

function listTimeZones() {
  if (cachedZones) return cachedZones.slice();
  let zones = [];
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      zones = Intl.supportedValuesOf('timeZone');
    }
  } catch {
    zones = [];
  }
  if (!Array.isArray(zones) || !zones.length) {
    zones = [
      'UTC',
      'America/New_York',
      'America/Chicago',
      'America/Denver',
      'America/Los_Angeles',
      'America/Anchorage',
      'Pacific/Honolulu',
      'Europe/London',
      'Europe/Paris',
      'Asia/Tokyo',
      'Australia/Sydney',
    ];
  }
  if (!zones.includes(DEFAULT_TIMEZONE)) zones.push(DEFAULT_TIMEZONE);
  if (!zones.includes('UTC')) zones.unshift('UTC');
  cachedZones = [...new Set(zones)].sort((a, b) => a.localeCompare(b));
  return cachedZones.slice();
}

function isValidTimeZone(tz) {
  const value = String(tz || '').trim();
  if (!value) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
    return true;
  } catch {
    return false;
  }
}

function assertTimeZone(tz) {
  const value = String(tz || '').trim();
  if (!isValidTimeZone(value)) {
    throw new Error('Invalid timezone');
  }
  return value;
}

function normalizeTimeZone(tz, fallback = DEFAULT_TIMEZONE) {
  const value = String(tz || '').trim();
  if (isValidTimeZone(value)) return value;
  return isValidTimeZone(fallback) ? fallback : 'UTC';
}

/** YYYY-MM-DD for "now" in the given IANA timezone. */
function todayInTimeZone(tz = DEFAULT_TIMEZONE) {
  const zone = normalizeTimeZone(tz);
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

function currentOffsetLabel(tz, at = new Date()) {
  const zone = normalizeTimeZone(tz);
  try {
    const part = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      timeZoneName: 'shortOffset',
    }).formatToParts(at).find((p) => p.type === 'timeZoneName');
    return part?.value || '';
  } catch {
    return '';
  }
}

function formatTimeZoneLabel(tz, at = new Date()) {
  const zone = normalizeTimeZone(tz);
  const offset = currentOffsetLabel(zone, at);
  const pretty = zone.replace(/_/g, ' ');
  return offset ? `${pretty} (${offset})` : pretty;
}

function listTimeZoneOptions(at = new Date()) {
  return listTimeZones().map((id) => ({
    id,
    label: formatTimeZoneLabel(id, at),
    region: id.includes('/') ? id.split('/')[0] : 'Other',
  }));
}

function listTimeZonesGrouped(at = new Date()) {
  const groups = new Map();
  for (const opt of listTimeZoneOptions(at)) {
    if (!groups.has(opt.region)) groups.set(opt.region, []);
    groups.get(opt.region).push(opt);
  }
  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([region, zones]) => ({ region, zones }));
}

function getFirmTimeZone(db, getSetting) {
  const raw = typeof getSetting === 'function'
    ? getSetting(db, 'firm_timezone', DEFAULT_TIMEZONE)
    : DEFAULT_TIMEZONE;
  return normalizeTimeZone(raw, DEFAULT_TIMEZONE);
}

module.exports = {
  DEFAULT_TIMEZONE,
  listTimeZones,
  listTimeZoneOptions,
  listTimeZonesGrouped,
  isValidTimeZone,
  assertTimeZone,
  normalizeTimeZone,
  todayInTimeZone,
  currentOffsetLabel,
  formatTimeZoneLabel,
  getFirmTimeZone,
};
