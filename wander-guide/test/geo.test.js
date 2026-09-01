'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const geo = require('../src/geo');

describe('geo', () => {
  it('rejects out-of-range coordinates', () => {
    assert.equal(geo.parseLatitude('91'), null);
    assert.equal(geo.parseLatitude('-90.1'), null);
    assert.equal(geo.parseLongitude('181'), null);
    assert.equal(geo.parseLongitude('not-a-number'), null);
  });

  it('accepts valid coordinates and radius', () => {
    const coords = geo.parseCoords({ lat: '37.8199', lon: '-122.4783', radius: '1500' });
    assert.equal(coords.lat, 37.8199);
    assert.equal(coords.lon, -122.4783);
    assert.equal(coords.radiusMeters, 1500);
  });

  it('defaults radius and rejects illegal radius', () => {
    const coords = geo.parseCoords({ lat: 0, lon: 0 });
    assert.equal(coords.radiusMeters, geo.DEFAULT_RADIUS_M);
    assert.equal(geo.parseRadiusMeters('50'), null);
    assert.equal(geo.parseRadiusMeters('8000'), null);
  });

  it('computes integer meter distance', () => {
    const meters = geo.distanceMeters(37.8199, -122.4783, 37.827, -122.422);
    assert.equal(typeof meters, 'number');
    assert.equal(meters, Math.round(meters));
    assert.ok(meters > 4000 && meters < 6000);
  });

  it('coarsens coordinates for logs', () => {
    assert.equal(geo.coarseCoord(37.81994), 37.82);
    assert.notEqual(geo.coarseCoord(40.7580123), 40.7580123);
  });

  it('accepts a trimmed place query and rejects junk', () => {
    assert.equal(geo.parsePlaceQuery('  Eiffel Tower  '), 'Eiffel Tower');
    assert.equal(geo.parsePlaceQuery('x'), null);
    assert.equal(geo.parsePlaceQuery('a'.repeat(121)), null);
    assert.equal(geo.parsePlaceQuery('\n\t'), null);
  });
});
