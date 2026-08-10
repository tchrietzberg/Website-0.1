const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const timezones = require('../src/services/timezones');
const { resetDb, setSetting, getSetting } = require('../src/db');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');

describe('timezones', () => {
  it('lists IANA time zones including common firm zones', () => {
    const zones = timezones.listTimeZones();
    assert.ok(zones.length > 100, `expected many zones, got ${zones.length}`);
    assert.ok(zones.includes('UTC'));
    assert.ok(zones.includes('America/New_York'));
    assert.ok(zones.includes('Asia/Tokyo'));
    assert.ok(zones.includes('Pacific/Auckland'));
  });

  it('validates and normalizes timezone ids', () => {
    assert.equal(timezones.assertTimeZone('Europe/London'), 'Europe/London');
    assert.equal(timezones.normalizeTimeZone('not/a/zone'), timezones.DEFAULT_TIMEZONE);
    assert.throws(() => timezones.assertTimeZone('Mars/Olympus'), /Invalid timezone/);
  });

  it('returns YYYY-MM-DD for today in a zone', () => {
    const day = timezones.todayInTimeZone('UTC');
    assert.match(day, /^\d{4}-\d{2}-\d{2}$/);
  });

  it('groups zones by region for settings UI', () => {
    const groups = timezones.listTimeZonesGrouped();
    assert.ok(groups.some((g) => g.region === 'America'));
    assert.ok(groups.some((g) => g.region === 'Europe'));
    const america = groups.find((g) => g.region === 'America');
    assert.ok(america.zones.some((z) => z.id === 'America/Chicago'));
    assert.ok(america.zones[0].label.includes('America'));
  });

  it('persists firm_timezone in firm_settings', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tz-settings-'));
    const db = resetDb(path.join(dir, 'test.db'));
    setSetting(db, 'firm_timezone', 'Asia/Tokyo');
    assert.equal(getSetting(db, 'firm_timezone'), 'Asia/Tokyo');
    assert.equal(
      timezones.normalizeTimeZone(getSetting(db, 'firm_timezone')),
      'Asia/Tokyo'
    );
  });
});
