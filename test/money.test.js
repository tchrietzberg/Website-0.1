const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  roundMinutes,
  amountFromMinutes,
  divideHalfUp,
  formatCents,
  centsFromDollarsString,
} = require('../src/money');

describe('money rounding', () => {
  it('rounds up to 15-minute increments', () => {
    assert.equal(roundMinutes(1, 15, 'up'), 15);
    assert.equal(roundMinutes(7, 15, 'up'), 15);
    assert.equal(roundMinutes(15, 15, 'up'), 15);
    assert.equal(roundMinutes(16, 15, 'up'), 30);
    assert.equal(roundMinutes(62, 15, 'up'), 75);
  });

  it('nearest and down modes work; never rounds positive to zero', () => {
    assert.equal(roundMinutes(7, 15, 'nearest'), 15);
    assert.equal(roundMinutes(7, 15, 'down'), 15); // floor would be 0 → bumped to increment
    assert.equal(roundMinutes(20, 15, 'down'), 15);
    assert.equal(roundMinutes(22, 15, 'nearest'), 15);
    assert.equal(roundMinutes(23, 15, 'nearest'), 30);
  });

  it('rejects zero/negative duration', () => {
    assert.throws(() => roundMinutes(0, 15, 'up'));
    assert.throws(() => roundMinutes(-5, 15, 'up'));
  });
});

describe('amountFromMinutes', () => {
  it('computes half-up hourly amounts in cents', () => {
    // 60 min * $450/hr = $450.00
    assert.equal(amountFromMinutes(60, 45000), 45000);
    // 15 min * $450 = $112.50
    assert.equal(amountFromMinutes(15, 45000), 11250);
    // 1 min * $175 = 17500/60 = 291.666… → 292 half-up
    assert.equal(amountFromMinutes(1, 17500), 292);
    // 7 rounded minutes at $175: use 15 min → 4375
    assert.equal(amountFromMinutes(15, 17500), 4375);
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
