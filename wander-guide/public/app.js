'use strict';

const MOVE_THRESHOLD_M = 90;
const state = {
  mode: 'idle',
  coords: null,
  payload: null,
  spoken: new Set(),
  watchId: null,
  speaking: false,
  paused: false,
  map: null,
  youMarker: null,
  placeLayer: null,
};

const els = {
  start: document.getElementById('start-btn'),
  demo: document.getElementById('demo-btn'),
  pause: document.getElementById('pause-btn'),
  stop: document.getElementById('stop-btn'),
  transcript: document.getElementById('transcript'),
  status: document.getElementById('status'),
  chip: document.getElementById('place-chip'),
  places: document.getElementById('places'),
  demos: document.getElementById('demos'),
  demoPanel: document.getElementById('demo-panel'),
  avatar: document.getElementById('avatar'),
  privacyBtn: document.getElementById('privacy-btn'),
  privacyDialog: document.getElementById('privacy-dialog'),
};

function setStatus(message, isError = false) {
  els.status.textContent = message || '';
  els.status.classList.toggle('error', Boolean(isError));
}

function setTranscript(text) {
  els.transcript.textContent = text;
}

function setSpeaking(on) {
  state.speaking = on;
  els.avatar.dataset.state = on ? 'speaking' : 'idle';
  els.pause.disabled = !on && !state.paused;
  els.stop.disabled = !on && !state.paused && !window.speechSynthesis?.speaking;
}

function preferredVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const ranked = [
    (v) => /en-US/i.test(v.lang) && /natural|premium|google|samantha|aria/i.test(v.name),
    (v) => /en-GB/i.test(v.lang) && /google|daniel|serena/i.test(v.name),
    (v) => /^en/i.test(v.lang),
  ];
  for (const test of ranked) {
    const hit = voices.find(test);
    if (hit) return hit;
  }
  return voices[0] || null;
}

function stopSpeech() {
  if (!window.speechSynthesis) return;
  speechSynthesis.cancel();
  state.paused = false;
  setSpeaking(false);
  els.pause.textContent = '⏸';
}

function speak(text) {
  if (!text) return;
  if (!window.speechSynthesis) {
    setStatus('This browser has no spoken narrator. The transcript still works.', true);
    return;
  }
  stopSpeech();
  const utter = new SpeechSynthesisUtterance(text);
  const voice = preferredVoice();
  if (voice) utter.voice = voice;
  utter.rate = 0.96;
  utter.pitch = 1;
  utter.onstart = () => setSpeaking(true);
  utter.onend = () => setSpeaking(false);
  utter.onerror = () => setSpeaking(false);
  speechSynthesis.speak(utter);
}

function haversine(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return Math.round(R * 2 * Math.asin(Math.min(1, Math.sqrt(h))));
}

function initMap() {
  if (state.map) return;
  L.Icon.Default.imagePath = '/vendor/leaflet/images/';
  state.map = L.map('map', {
    zoomControl: false,
    attributionControl: true,
  }).setView([20, 0], 2);
  L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap &copy; CARTO',
  }).addTo(state.map);
  L.control.zoom({ position: 'topright' }).addTo(state.map);
  state.placeLayer = L.layerGroup().addTo(state.map);
  requestAnimationFrame(() => state.map.invalidateSize());
}

function youIcon() {
  return L.divIcon({ className: '', html: '<div class="you-marker"></div>', iconSize: [18, 18], iconAnchor: [9, 9] });
}

function updateMap(lat, lon, places) {
  initMap();
  const here = [lat, lon];
  if (!state.youMarker) {
    state.youMarker = L.marker(here, { icon: youIcon(), zIndexOffset: 600 }).addTo(state.map);
  } else {
    state.youMarker.setLatLng(here);
  }
  state.map.setView(here, Math.max(state.map.getZoom(), 15), { animate: true });
  state.placeLayer.clearLayers();
  for (const place of places || []) {
    const marker = L.marker([place.lat, place.lon]).addTo(state.placeLayer);
    marker.bindPopup(`<strong>${escapeHtml(place.title)}</strong><br>${place.distanceMeters} m`);
    marker.on('click', () => narratePlace(place));
  }
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function readJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || 'Unable to look up this area');
  }
  return data;
}

function fetchHere(lat, lon) {
  return readJson(`/api/here?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}&radius=1200`);
}

function fetchHereDemo(id) {
  return readJson(`/api/here?demo=${encodeURIComponent(id)}`);
}

function renderPlaces(places) {
  els.places.replaceChildren();
  if (!places || places.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'status';
    empty.textContent = 'No encyclopedia landmarks in this radius yet.';
    els.places.append(empty);
    return;
  }
  for (const place of places) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'place-card';
    btn.addEventListener('click', () => narratePlace(place));
    if (place.thumbnail) {
      const img = document.createElement('img');
      img.src = place.thumbnail;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      btn.append(img);
    } else {
      const fallback = document.createElement('div');
      fallback.className = 'thumb-fallback';
      fallback.textContent = place.title.slice(0, 1);
      btn.append(fallback);
    }
    const meta = document.createElement('div');
    meta.className = 'meta';
    const h3 = document.createElement('h3');
    h3.textContent = place.title;
    const p = document.createElement('p');
    p.textContent = `${place.distanceMeters} m · tap to hear`;
    meta.append(h3, p);
    btn.append(meta);
    els.places.append(btn);
  }
}

function applyPayload(data, { announce } = { announce: true }) {
  state.payload = data;
  state.coords = { lat: data.lat, lon: data.lon };
  els.chip.textContent = data.here?.label || 'Unknown area';
  renderPlaces(data.places);
  updateMap(data.lat, data.lon, data.places);
  if (announce) {
    setTranscript(data.script);
    speak(data.script);
    for (const place of data.places || []) state.spoken.add(place.id);
  }
}

function narratePlace(place) {
  setTranscript(place.script || place.extract || place.title);
  speak(place.script || place.extract || place.title);
  state.spoken.add(place.id);
}

async function onPosition(lat, lon) {
  if (state.coords) {
    const moved = haversine(state.coords, { lat, lon });
    if (moved < MOVE_THRESHOLD_M && state.payload) {
      updateMap(lat, lon, state.payload.places);
      return;
    }
  }
  setStatus('Looking up this area…');
  const data = await fetchHere(lat, lon);
  const fresh = (data.places || []).filter((p) => !state.spoken.has(p.id));
  if (!state.payload) {
    applyPayload(data, { announce: true });
  } else if (fresh.length) {
    applyPayload(data, { announce: false });
    const next = fresh[0];
    const line = `You have moved. ${next.script}`;
    setTranscript(line);
    speak(line);
    state.spoken.add(next.id);
  } else {
    applyPayload(data, { announce: false });
  }
  setStatus('Live tour is following your location.');
}

function startWatch() {
  if (!navigator.geolocation) {
    throw new Error('This device does not expose location.');
  }
  if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
  state.watchId = navigator.geolocation.watchPosition(
    (pos) => {
      onPosition(pos.coords.latitude, pos.coords.longitude).catch((err) => {
        setStatus(err.message, true);
      });
    },
    (err) => {
      if (err.code === 1) {
        setStatus('Location permission was denied. You can still try a demo city.', true);
      } else {
        setStatus('Could not read GPS. Try a demo city, or check location settings.', true);
      }
      els.demoPanel.hidden = false;
      els.demoPanel.classList.remove('hidden');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

async function startLiveTour() {
  stopSpeech();
  state.spoken.clear();
  state.mode = 'live';
  els.start.textContent = 'Following you…';
  setStatus('Asking for location…');
  initMap();
  startWatch();
}

async function startDemo(id) {
  stopSpeech();
  state.spoken.clear();
  state.mode = 'demo';
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  setStatus('Loading a guided neighborhood…');
  const data = await fetchHereDemo(id);
  applyPayload(data, { announce: true });
  setStatus('Demo tour. On a phone, Start live tour uses your real GPS.');
}

async function loadDemos() {
  const res = await fetch('/api/demo-locations', { headers: { Accept: 'application/json' } });
  const data = await res.json();
  els.demos.replaceChildren();
  for (const loc of data.locations || []) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'demo-card';
    const h3 = document.createElement('h3');
    h3.textContent = loc.name;
    const p = document.createElement('p');
    p.textContent = `${loc.city} · ${loc.blurb}`;
    btn.append(h3, p);
    btn.addEventListener('click', () => {
      startDemo(loc.id).catch((err) => setStatus(err.message, true));
    });
    els.demos.append(btn);
  }
}

els.start.addEventListener('click', () => {
  startLiveTour().catch((err) => setStatus(err.message, true));
});
els.demo.addEventListener('click', () => {
  const open = els.demoPanel.hidden;
  els.demoPanel.hidden = !open;
  els.demoPanel.classList.toggle('hidden', !open);
});
els.pause.addEventListener('click', () => {
  if (!window.speechSynthesis) return;
  if (speechSynthesis.speaking && !speechSynthesis.paused) {
    speechSynthesis.pause();
    state.paused = true;
    els.pause.textContent = '▶';
    setSpeaking(false);
  } else if (speechSynthesis.paused) {
    speechSynthesis.resume();
    state.paused = false;
    els.pause.textContent = '⏸';
    setSpeaking(true);
  }
});
els.stop.addEventListener('click', () => {
  stopSpeech();
  setTranscript('Narration stopped. Tap a place or start the tour again.');
});
els.privacyBtn.addEventListener('click', () => els.privacyDialog.showModal());

initMap();
loadDemos().catch(() => setStatus('Could not load demo cities.', true));
if ('speechSynthesis' in window) {
  speechSynthesis.getVoices();
  speechSynthesis.addEventListener('voiceschanged', () => speechSynthesis.getVoices());
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
