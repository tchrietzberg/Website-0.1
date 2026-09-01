'use strict';

const { distanceMeters, cacheKey, parsePlaceQuery, DEFAULT_RADIUS_M } = require('./geo');
const { formatHere, buildAreaScript, buildPlaceScript, rankPlaces, firstSentences } = require('./narrate');

const USER_AGENT = 'WanderGuide/1.0 (location-based audio tour guide; educational; +https://github.com/tchrietzberg/Website-0.1)';
const NOMINATIM_REVERSE = 'https://nominatim.openstreetmap.org/reverse';
const NOMINATIM_SEARCH = 'https://nominatim.openstreetmap.org/search';
const WIKI_API = 'https://en.wikipedia.org/w/api.php';
const FETCH_TIMEOUT_MS = 8000;
const CACHE_TTL_MS = 10 * 60 * 1000;
const CACHE_MAX = 200;

const DEMO_LOCATIONS = [
  {
    id: 'golden-gate',
    name: 'Golden Gate Bridge',
    city: 'San Francisco',
    lat: 37.8199,
    lon: -122.4783,
    blurb: 'Walk the span and hear about the bridge, battery, and bay.',
  },
  {
    id: 'times-square',
    name: 'Times Square',
    city: 'New York',
    lat: 40.758,
    lon: -73.9855,
    blurb: 'Neon, Broadway, and the Crossroads of the World.',
  },
  {
    id: 'liberty',
    name: 'Statue of Liberty',
    city: 'New York',
    lat: 40.6892,
    lon: -74.0445,
    blurb: 'Harbor landmark and neighboring Ellis Island.',
  },
  {
    id: 'national-mall',
    name: 'National Mall',
    city: 'Washington, D.C.',
    lat: 38.8893,
    lon: -77.0502,
    blurb: 'Monuments, museums, and the Lincoln Memorial.',
  },
  {
    id: 'eiffel',
    name: 'Eiffel Tower',
    city: 'Paris',
    lat: 48.8584,
    lon: 2.2945,
    blurb: 'Champ de Mars and the iron tower.',
  },
  {
    id: 'colosseum',
    name: 'Colosseum',
    city: 'Rome',
    lat: 41.8902,
    lon: 12.4922,
    blurb: 'Ancient amphitheatre beside the Roman Forum.',
  },
  {
    id: 'big-ben',
    name: 'Palace of Westminster',
    city: 'London',
    lat: 51.5007,
    lon: -0.1246,
    blurb: 'Big Ben, the Houses of Parliament, and the Thames.',
  },
  {
    id: 'shibuya',
    name: 'Shibuya Crossing',
    city: 'Tokyo',
    lat: 35.6595,
    lon: 139.7004,
    blurb: 'The scramble, Hachiko, and surrounding Shibuya.',
  },
];

const cache = new Map();
let nominatimChain = Promise.resolve();

function listDemoLocations() {
  return DEMO_LOCATIONS.map((d) => ({ ...d }));
}

function getDemoLocation(id) {
  return DEMO_LOCATIONS.find((d) => d.id === id) || null;
}

function pruneCache() {
  const now = Date.now();
  for (const [key, entry] of cache) {
    if (entry.expiresAt <= now) cache.delete(key);
  }
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function headers() {
  return {
    'User-Agent': USER_AGENT,
    Accept: 'application/json',
    'Accept-Language': 'en',
  };
}

async function fetchJson(url, { fetchImpl, signal } = {}) {
  const fn = fetchImpl || fetch;
  const res = await fn(url, { headers: headers(), signal, redirect: 'error' });
  if (!res.ok) {
    const err = new Error('Upstream lookup failed');
    err.status = 502;
    err.code = 'upstream_error';
    throw err;
  }
  return res.json();
}

function withTimeout(fn) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  return Promise.resolve()
    .then(() => fn(controller.signal))
    .finally(() => clearTimeout(timer));
}

function enqueueNominatim(work) {
  const run = nominatimChain.then(work, work);
  nominatimChain = run.then(() => undefined, () => undefined);
  return run;
}

async function reverseGeocode(lat, lon, fetchImpl) {
  const url = new URL(NOMINATIM_REVERSE);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lon));
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');
  return enqueueNominatim(() =>
    withTimeout((signal) => fetchJson(url, { fetchImpl, signal })).then((data) =>
      formatHere(data.address, data.display_name)
    )
  );
}

async function wikipediaNearby(lat, lon, radiusMeters, fetchImpl) {
  const search = new URL(WIKI_API);
  search.searchParams.set('action', 'query');
  search.searchParams.set('list', 'geosearch');
  search.searchParams.set('gscoord', `${lat}|${lon}`);
  search.searchParams.set('gsradius', String(Math.min(10000, Math.max(10, radiusMeters))));
  search.searchParams.set('gslimit', '12');
  search.searchParams.set('format', 'json');
  search.searchParams.set('origin', '*');

  const searchJson = await withTimeout((signal) => fetchJson(search, { fetchImpl, signal }));
  const hits = (searchJson.query && searchJson.query.geosearch) || [];
  if (hits.length === 0) return [];

  const ids = hits.map((h) => h.pageid).filter(Boolean);
  const details = new URL(WIKI_API);
  details.searchParams.set('action', 'query');
  details.searchParams.set('pageids', ids.join('|'));
  details.searchParams.set('prop', 'extracts|pageimages|info');
  details.searchParams.set('exintro', '1');
  details.searchParams.set('explaintext', '1');
  details.searchParams.set('exlimit', '12');
  details.searchParams.set('inprop', 'url');
  details.searchParams.set('pithumbsize', '400');
  details.searchParams.set('format', 'json');
  details.searchParams.set('origin', '*');

  const detailJson = await withTimeout((signal) => fetchJson(details, { fetchImpl, signal }));
  const pages = (detailJson.query && detailJson.query.pages) || {};

  const places = hits.map((hit) => {
    const page = pages[String(hit.pageid)] || {};
    const extract = firstSentences(page.extract || '', 6);
    const thumbnail = page.thumbnail && page.thumbnail.source ? String(page.thumbnail.source) : null;
    const safeThumb =
      thumbnail && thumbnail.startsWith('https://upload.wikimedia.org/') ? thumbnail : null;
    const dist =
      typeof hit.dist === 'number'
        ? Math.round(hit.dist)
        : distanceMeters(lat, lon, hit.lat, hit.lon);
    return {
      id: String(hit.pageid),
      title: String(page.title || hit.title || 'Untitled'),
      lat: Number(hit.lat),
      lon: Number(hit.lon),
      distanceMeters: dist,
      extract,
      thumbnail: safeThumb,
      url: typeof page.fullurl === 'string' && page.fullurl.startsWith('https://en.wikipedia.org/')
        ? page.fullurl
        : `https://en.wikipedia.org/?curid=${hit.pageid}`,
    };
  }).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));

  return rankPlaces(places).slice(0, 8).map((place) => ({
    ...place,
    script: buildPlaceScript(place),
  }));
}

async function lookupHere({ lat, lon, radiusMeters }, { fetchImpl } = {}) {
  const key = cacheKey(lat, lon, radiusMeters);
  pruneCache();
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const [hereResult, placesResult] = await Promise.allSettled([
    reverseGeocode(lat, lon, fetchImpl),
    wikipediaNearby(lat, lon, radiusMeters, fetchImpl),
  ]);

  const here =
    hereResult.status === 'fulfilled'
      ? hereResult.value
      : { label: 'your current area', neighborhood: null, city: null, state: null, country: null };
  const places = placesResult.status === 'fulfilled' ? placesResult.value : [];

  const value = {
    here,
    script: buildAreaScript(here, places),
    places,
    radiusMeters,
  };
  cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

async function searchPlace(rawQuery, { fetchImpl } = {}) {
  const q = parsePlaceQuery(rawQuery);
  if (!q) {
    const err = new Error('Enter a place name between 2 and 120 characters.');
    err.status = 400;
    err.code = 'invalid_query';
    throw err;
  }
  const url = new URL(NOMINATIM_SEARCH);
  url.searchParams.set('q', q);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('addressdetails', '1');
  const rows = await enqueueNominatim(() =>
    withTimeout((signal) => fetchJson(url, { fetchImpl, signal }))
  );
  if (!Array.isArray(rows) || !rows[0]) {
    const err = new Error('I could not find that place.');
    err.status = 404;
    err.code = 'place_not_found';
    throw err;
  }
  const lat = Number(rows[0].lat);
  const lon = Number(rows[0].lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    const err = new Error('I could not find that place.');
    err.status = 404;
    err.code = 'place_not_found';
    throw err;
  }
  const value = await lookupHere({ lat, lon, radiusMeters: DEFAULT_RADIUS_M }, { fetchImpl });
  return { lat, lon, ...value };
}

function clearCache() {
  cache.clear();
}

module.exports = {
  DEMO_LOCATIONS,
  listDemoLocations,
  getDemoLocation,
  lookupHere,
  reverseGeocode,
  wikipediaNearby,
  searchPlace,
  clearCache,
  USER_AGENT,
};
