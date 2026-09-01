'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { createServer } = require('../src/server');
const { resetRateLimits } = require('../src/security');

let server;
let base;

function listen(app) {
  return new Promise((resolve) => {
    app.listen(0, '127.0.0.1', () => {
      const { port } = app.address();
      resolve(`http://127.0.0.1:${port}`);
    });
  });
}

async function get(path, { method = 'GET' } = {}) {
  const res = await fetch(`${base}${path}`, { method, redirect: 'manual' });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not json */ }
  return { res, text, json };
}

describe('wander-guide server', () => {
  before(async () => {
    server = createServer({
      lookup: async ({ lat, lon, radiusMeters }) => ({
        here: { label: 'Test neighborhood', city: 'Testville', neighborhood: 'Midtown', state: null, country: 'Testland' },
        script: `You are in Test neighborhood. I'm your local guide.`,
        places: [
          {
            id: '42',
            title: 'Test Museum',
            lat,
            lon,
            distanceMeters: 40,
            extract: 'A museum used in tests.',
            thumbnail: null,
            url: 'https://en.wikipedia.org/?curid=42',
            script: 'Test Museum is right beside you. A museum used in tests.',
          },
        ],
        radiusMeters,
      }),
    });
    base = await listen(server);
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => resetRateLimits());

  it('serves health and the app shell with security headers', async () => {
    const health = await get('/api/health');
    assert.equal(health.res.status, 200);
    assert.equal(health.json.service, 'wander-guide');

    const home = await get('/');
    assert.equal(home.res.status, 200);
    assert.match(home.text, /Wander Guide/);
    assert.equal(home.res.headers.get('x-frame-options'), 'DENY');
    assert.equal(home.res.headers.get('x-content-type-options'), 'nosniff');
    assert.match(home.res.headers.get('content-security-policy'), /connect-src 'self'/);
    assert.match(home.res.headers.get('content-security-policy'), /frame-ancestors 'none'/);
    assert.match(home.res.headers.get('permissions-policy'), /geolocation=\(self\)/);
    assert.equal(home.res.headers.get('cache-control'), 'no-store');
  });

  it('validates coordinates and unknown demos', async () => {
    const missing = await get('/api/here');
    assert.equal(missing.res.status, 400);
    const bad = await get('/api/here?lat=999&lon=0');
    assert.equal(bad.res.status, 400);
    const demo = await get('/api/here?demo=not-a-place');
    assert.equal(demo.res.status, 404);
  });

  it('returns a narration payload for live coords and demos', async () => {
    const live = await get('/api/here?lat=37.8199&lon=-122.4783');
    assert.equal(live.res.status, 200);
    assert.equal(live.json.here.label, 'Test neighborhood');
    assert.match(live.json.script, /local guide/);
    assert.equal(live.json.places[0].title, 'Test Museum');

    const demo = await get('/api/here?demo=golden-gate');
    assert.equal(demo.res.status, 200);
    assert.equal(demo.json.lat, 37.8199);
    assert.equal(demo.json.lon, -122.4783);
  });

  it('lists demo cities and blocks unsafe methods and paths', async () => {
    const demos = await get('/api/demo-locations');
    assert.ok(demos.json.locations.some((d) => d.id === 'colosseum'));
    const post = await get('/api/health', { method: 'POST' });
    assert.equal(post.res.status, 405);
    const traversal = await get('/%2e%2e/src/server.js');
    assert.ok([400, 404].includes(traversal.res.status));
    assert.doesNotMatch(traversal.text || '', /createServer/);
  });

  it('rate limits bursty location lookups', async () => {
    let last;
    for (let i = 0; i < 32; i += 1) {
      last = await get('/api/here?lat=1&lon=1');
    }
    assert.equal(last.res.status, 429);
  });
});
