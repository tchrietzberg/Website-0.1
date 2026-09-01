'use strict';

function uniqueStrings(values) {
  const seen = new Set();
  const out = [];
  for (const raw of values) {
    const value = String(raw || '').trim();
    if (!value) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}

function formatHere(address, displayName) {
  const a = address && typeof address === 'object' ? address : {};
  const neighborhood =
    a.neighbourhood || a.suburb || a.quarter || a.city_district || a.hamlet || a.road || null;
  const city = a.city || a.town || a.village || a.municipality || null;
  const state = a.state || a.region || null;
  const country = a.country || null;
  const labelParts = uniqueStrings([neighborhood, city, state, country]).slice(0, 3);
  return {
    label: labelParts.join(', ') || String(displayName || 'an unnamed place').trim(),
    neighborhood: neighborhood || null,
    city: city || null,
    state: state || null,
    country: country || null,
  };
}

function firstSentences(text, max = 3) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';
  const parts = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const picked = parts.slice(0, max);
  let out = picked.join(' ').trim();
  if (out.length > 520) out = `${out.slice(0, 500).replace(/\s+\S*$/, '')}.`;
  return out;
}

function formatDistance(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  if (m < 80) return 'right beside you';
  if (m < 250) return `about ${Math.round(m / 10) * 10} meters away`;
  if (m < 1000) return `about ${Math.round(m / 50) * 50} meters away`;
  const tenths = Math.round(m / 100);
  const km = tenths / 10;
  if (km < 10) return `about ${km.toFixed(1)} kilometers away`;
  return `about ${Math.round(km)} kilometers away`;
}

function buildAreaScript(here, places) {
  const where = (here && here.label) || 'an interesting place';
  const lead = `You are in ${where}. I'm your local guide.`;
  if (!places || places.length === 0) {
    return `${lead} I don't have a notable landmark in this immediate radius yet. Walk a little, or pick a well-known neighborhood from the demo list.`;
  }
  const first = places[0];
  const also = places.slice(1, 3).map((p) => p.title).filter(Boolean);
  let script = `${lead} ${capitalize(formatDistance(first.distanceMeters))} is ${first.title}. ${firstSentences(first.extract, 2)}`;
  if (also.length === 1) {
    script += ` Also nearby is ${also[0]}. Tap a place when you want me to tell you more.`;
  } else if (also.length > 1) {
    script += ` Also nearby: ${also.slice(0, -1).join(', ')}, and ${also[also.length - 1]}. Tap a place when you want me to tell you more.`;
  }
  return script.replace(/\s+/g, ' ').trim();
}

function buildPlaceScript(place) {
  const title = (place && place.title) || 'This place';
  const dist = formatDistance(place && place.distanceMeters);
  const body = firstSentences(place && place.extract, 3);
  if (!body) return `${title} is ${dist}. I don't have a written summary for it yet.`;
  return `${title} is ${dist}. ${body}`.replace(/\s+/g, ' ').trim();
}

function capitalize(text) {
  const s = String(text || '');
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function rankPlaces(places) {
  return [...places].sort((a, b) => scorePlace(b) - scorePlace(a));
}

function scorePlace(place) {
  const dist = Number(place.distanceMeters) || 0;
  const distScore = Math.max(0, 4000 - dist);
  const textScore = Math.min(800, String(place.extract || '').length);
  const photo = place.thumbnail ? 220 : 0;
  return distScore + textScore + photo;
}

module.exports = {
  formatHere,
  firstSentences,
  formatDistance,
  buildAreaScript,
  buildPlaceScript,
  rankPlaces,
  scorePlace,
};
