const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  roundMinutes,
  amountFromMinutes,
  divideHalfUp,
  formatCents,
  centsFromDollarsString,
  formatDuration,
  minutesToDecimalHours,
} = require('../src/money');

describe('money rounding', () => {
  it('rounds up to 15-minute increments', () => {
    assert.equal(roundMinutes(1, 15, 'up'), 15);
    assert.equal(roundMinutes(7, 15, 'up'), 15);
    assert.equal(roundMinutes(15, 15, 'up'), 15);
    assert.equal(roundMinutes(16, 15, 'up'), 30);
    assert.equal(roundMinutes(62, 15, 'up'), 75);
  });

  it('supports primary increments: 6, 10, 12, 15, 30 minutes', () => {
    assert.equal(roundMinutes(1, 6, 'up'), 6);
    assert.equal(roundMinutes(7, 6, 'up'), 12);
    assert.equal(roundMinutes(1, 10, 'up'), 10);
    assert.equal(roundMinutes(11, 10, 'up'), 20);
    assert.equal(roundMinutes(1, 12, 'up'), 12);
    assert.equal(roundMinutes(13, 12, 'up'), 24);
    assert.equal(roundMinutes(1, 30, 'up'), 30);
    assert.equal(roundMinutes(31, 30, 'up'), 60);
    assert.throws(() => roundMinutes(5, 5, 'up'), /one of/);
  });

  it('round up / nearest / down / none with 30-minute examples', () => {
    // 14 minutes @ 30-minute interval
    assert.equal(roundMinutes(14, 30, 'up'), 30);      // 0.50 hr
    assert.equal(roundMinutes(14, 30, 'nearest'), 0);  // 0.0 hr
    assert.equal(roundMinutes(14, 30, 'down'), 0);     // 0.0 hr
    assert.equal(roundMinutes(14, 30, 'none'), 14);    // 0.23 hr
    assert.equal(minutesToDecimalHours(14), 0.23);
    assert.equal(minutesToDecimalHours(30), 0.5);
  });

  it('nearest rounds up at the midpoint of the interval', () => {
    assert.equal(roundMinutes(15, 30, 'nearest'), 30); // exact midpoint → up
    assert.equal(roundMinutes(7, 15, 'nearest'), 0);   // 7/15 < 0.5 → 0
    assert.equal(roundMinutes(8, 15, 'nearest'), 15);  // 8/15 > 0.5 → up
    assert.equal(roundMinutes(22, 15, 'nearest'), 15);
    assert.equal(roundMinutes(23, 15, 'nearest'), 30);
    assert.equal(roundMinutes(20, 15, 'down'), 15);
  });

  it('rejects zero/negative duration', () => {
    assert.throws(() => roundMinutes(0, 15, 'up'));
    assert.throws(() => roundMinutes(-5, 15, 'up'));
  });
});

describe('duration format', () => {
  it('formats hh:mm:ss, hh:mm, and hour decimal', () => {
    assert.equal(formatDuration(90, 'hms'), '01:30:00');
    assert.equal(formatDuration(90, 'hm'), '01:30');
    assert.equal(formatDuration(90, 'decimal'), '1.50');
    assert.equal(formatDuration(14, 'decimal'), '0.23');
    assert.equal(formatDuration(0, 'decimal'), '0.00');
    assert.equal(formatDuration(0, 'hms'), '00:00:00');
  });
});

describe('amountFromMinutes', () => {
  it('computes half-up hourly amounts in cents', () => {
    assert.equal(amountFromMinutes(60, 45000), 45000);
    assert.equal(amountFromMinutes(15, 45000), 11250);
    assert.equal(amountFromMinutes(1, 17500), 292);
    assert.equal(amountFromMinutes(15, 17500), 4375);
    assert.equal(amountFromMinutes(0, 45000), 0);
  });

  it('divideHalfUp is exact on integers', () => {
    assert.equal(divideHalfUp(5, 2), 3);
    assert.equal(divideHalfUp(4, 2), 2);
    assert.equal(divideHalfUp(1, 3), 0);
    assert.equal(divideHalfUp(2, 3), 1);
  });
});

describe('formatting', () => {
  it('formats and parses money strings', () => {
    assert.equal(formatCents(12345), '$123.45');
    assert.equal(formatCents(-50), '-$0.50');
    assert.equal(centsFromDollarsString('$12.34'), 1234);
    assert.equal(centsFromDollarsString('12'), 1200);
  });
});
