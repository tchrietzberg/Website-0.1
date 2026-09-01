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

function spokenWhere(here) {
  const h = here && typeof here === 'object' ? here : {};
  const neighborhood = h.neighborhood;
  const city = h.city;
  if (neighborhood && city && neighborhood.toLowerCase() !== city.toLowerCase()) {
    return `${neighborhood}, in ${city}`;
  }
  return h.label || 'an interesting place';
}

function spokenTitle(title) {
  const t = String(title || '').trim();
  if (!t) return 'this place';
  if (/^(the|a|an)\s/i.test(t)) return t;
  if (/^\d/.test(t)) return t;
  if (/'s\b/i.test(t)) return t;
  if (/\b(bridge|tower|museum|cathedral|palace|castle|memorial|monument|abbey|temple|library|colosseum|forum|basilica)\b/i.test(t)) {
    return `the ${t}`;
  }
  return t;
}

function looksLikePronunciation(body) {
  return /pronounced|listen|IPA|ˈ|ˌ|[əɪæɑɔɛʌθðʃʒŋʁ]|[A-Z]{2,}[-·]|UK:|US:|French:|German:|Spanish:|Italian:|\//i.test(body)
    && String(body).length < 200;
}

function looksLikeUnitConversion(body) {
  return String(body).length < 48 && /^\d/.test(String(body).trim()) && /\b(km|mi|ft|m|kg|lb|acres?)\b/i.test(body);
}

function stripWikiSpeak(text) {
  let s = String(text || '');
  s = s.replace(/\[\d+\]/g, '');
  s = s.replace(/\{\{[^}]+\}\}/g, '');
  s = s.replace(/\[\[([^|\]]+\|)?([^\]]+)\]\]/g, '$2');
  s = s.replace(/\s*\[[^\]]*\]/g, ' ');
  s = s.replace(/\s*\/[^/]{1,40}\//g, ' ');
  s = s.replace(/\s*\(([^()]*)\)/g, (full, body) => {
    const inner = String(body || '').trim();
    if (looksLikePronunciation(inner) || looksLikeUnitConversion(inner)) return '';
    return full;
  });
  s = s.replace(/\s*\(listen\)/gi, '');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/\s+([,.;:!?])/g, '$1');
  return s.trim();
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

function humanizeExtract(text, maxSentences = 2) {
  const cleaned = stripWikiSpeak(text);
  let out = firstSentences(cleaned, maxSentences);
  out = out.replace(/\bIt is /g, "It's ");
  out = out.replace(/\bIt was /g, 'It was ');
  out = out.replace(/\bcirca\b/gi, 'around');
  out = out.replace(/\bca\.\s/gi, 'around ');
  out = out.replace(/\bc\.\s(?=\d)/gi, 'around ');
  return out.trim();
}

function formatDistance(meters) {
  const m = Math.max(0, Math.round(Number(meters) || 0));
  if (m < 40) return 'right here';
  if (m < 90) return 'just beside you';
  if (m < 200) return 'a few steps away';
  if (m < 450) return 'a short stroll away';
  if (m < 900) return "a couple of minutes' walk from here";
  if (m < 2000) return 'a short walk from here';
  const tenths = Math.round(m / 100);
  const km = tenths / 10;
  if (km < 10) return `a bit farther out, about ${km.toFixed(1)} kilometers`;
  return `quite a way off, about ${Math.round(km)} kilometers`;
}

function buildAreaScript(here, places) {
  const where = spokenWhere(here);
  const lead = `Okay, we're in ${where}.`;
  if (!places || places.length === 0) {
    return `${lead} I don't see a famous landmark right at this spot. Walk a little farther, or try a well-known neighborhood, and I'll try again.`;
  }
  const first = places[0];
  const title = spokenTitle(first.title);
  const extract = humanizeExtract(first.extract, 2);
  let script = `${lead} ${capitalize(formatDistance(first.distanceMeters))}, you'll find ${title}.`;
  if (extract) script += ` ${extract}`;
  const also = places.slice(1, 3).map((p) => spokenTitle(p.title)).filter(Boolean);
  if (also.length === 1) {
    script += ` Nearby, you can also wander over to ${also[0]}.`;
  } else if (also.length > 1) {
    script += ` If you keep looking around, you'll also see ${also[0]}, and ${also[1]}.`;
  }
  return script.replace(/\s+/g, ' ').trim();
}

function buildPlaceScript(place) {
  const title = spokenTitle(place && place.title);
  const dist = formatDistance(place && place.distanceMeters);
  const body = humanizeExtract(place && place.extract, 2);
  if (!body) return `This is ${title}. It's ${dist}. I don't have a good story for it yet.`;
  return `This is ${title}. It's ${dist}. ${body}`.replace(/\s+/g, ' ').trim();
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

/** Short spoken chunks so the voice can breathe between thoughts. */
function chunkForSpeech(text, maxChars = 160) {
  const cleaned = String(text || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return [];
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter(Boolean);
  const chunks = [];
  let buf = '';
  for (const sentence of sentences) {
    if (buf && buf.length + 1 + sentence.length > maxChars) {
      chunks.push(buf);
      buf = sentence;
    } else {
      buf = buf ? `${buf} ${sentence}` : sentence;
    }
  }
  if (buf) chunks.push(buf);
  return chunks.flatMap((chunk) => {
    if (chunk.length <= maxChars * 2) return [chunk];
    const parts = [];
    for (let i = 0; i < chunk.length; i += maxChars) parts.push(chunk.slice(i, i + maxChars));
    return parts;
  });
}

module.exports = {
  formatHere,
  firstSentences,
  stripWikiSpeak,
  humanizeExtract,
  spokenTitle,
  spokenWhere,
  formatDistance,
  buildAreaScript,
  buildPlaceScript,
  rankPlaces,
  scorePlace,
  chunkForSpeech,
};
