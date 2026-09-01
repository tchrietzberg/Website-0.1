'use strict';

const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { lookupHere, searchPlace, clearCache, listDemoLocations, getDemoLocation } = require('../src/places');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

describe('places', () => {
  beforeEach(() => clearCache());

  it('lists curated demo neighborhoods', () => {
    const list = listDemoLocations();
    assert.ok(list.length >= 5);
    assert.ok(getDemoLocation('eiffel'));
    assert.equal(getDemoLocation('not-real'), null);
  });

  it('composes reverse geocode and wikipedia extracts via injected fetch', async () => {
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes('nominatim')) {
        return jsonResponse({
          display_name: 'Golden Gate Bridge, San Francisco',
          address: {
            attraction: 'Golden Gate Bridge',
            city: 'San Francisco',
            state: 'California',
            country: 'United States',
          },
        });
      }
      if (href.includes('list=geosearch')) {
        return jsonResponse({
          query: {
            geosearch: [
              { pageid: 1, title: 'Golden Gate Bridge', lat: 37.8199, lon: -122.4783, dist: 12 },
            ],
          },
        });
      }
      if (href.includes('pageids=')) {
        return jsonResponse({
          query: {
            pages: {
              1: {
                title: 'Golden Gate Bridge',
                extract: 'The Golden Gate Bridge is a suspension bridge. It spans the Golden Gate strait.',
                fullurl: 'https://en.wikipedia.org/wiki/Golden_Gate_Bridge',
                thumbnail: { source: 'https://upload.wikimedia.org/wikipedia/bridge.jpg' },
              },
            },
          },
        });
      }
      throw new Error(`unexpected url ${href}`);
    };

    const result = await lookupHere({ lat: 37.8199, lon: -122.4783, radiusMeters: 1200 }, { fetchImpl });
    assert.match(result.here.label, /San Francisco/);
    assert.equal(result.places.length, 1);
    assert.equal(result.places[0].title, 'Golden Gate Bridge');
    assert.match(result.script, /local guide/);
    assert.match(result.places[0].script, /Golden Gate Bridge/);
    assert.equal(result.places[0].thumbnail.startsWith('https://upload.wikimedia.org/'), true);
  });

  it('still returns an area script if wikipedia fails', async () => {
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes('nominatim')) {
        return jsonResponse({
          display_name: 'Somewhere',
          address: { city: 'Lisbon', country: 'Portugal' },
        });
      }
      return jsonResponse({ error: 'upstream' }, 503);
    };
    const result = await lookupHere({ lat: 38.72, lon: -9.14, radiusMeters: 1000 }, { fetchImpl });
    assert.equal(result.here.city, 'Lisbon');
    assert.equal(result.places.length, 0);
    assert.match(result.script, /Lisbon/);
  });

  it('resolves a typed place name then narrates the area', async () => {
    const fetchImpl = async (url) => {
      const href = String(url);
      if (href.includes('/search')) {
        return jsonResponse([{ lat: '48.8584', lon: '2.2945', display_name: 'Eiffel Tower' }]);
      }
      if (href.includes('nominatim')) {
        return jsonResponse({
          display_name: 'Eiffel Tower, Paris',
          address: { attraction: 'Eiffel Tower', city: 'Paris', country: 'France' },
        });
      }
      if (href.includes('list=geosearch')) {
        return jsonResponse({ query: { geosearch: [] } });
      }
      throw new Error(`unexpected url ${href}`);
    };
    const result = await searchPlace('Eiffel Tower', { fetchImpl });
    assert.equal(result.lat, 48.8584);
    assert.match(result.here.label, /Paris/);
    assert.match(result.script, /local guide/);
  });

  it('rejects a one-character query', async () => {
    await assert.rejects(() => searchPlace('x'), (err) => err.code === 'invalid_query');
  });
});
