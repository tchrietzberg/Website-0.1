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
  currentScript: '',
  speechQueue: [],
  keepAlive: null,
  startWatchdog: null,
};

const els = {
  start: document.getElementById('start-btn'),
  demo: document.getElementById('demo-btn'),
  listen: document.getElementById('listen-btn'),
  listenBanner: document.getElementById('listen-banner'),
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
  searchForm: document.getElementById('search-form'),
  placeQuery: document.getElementById('place-query'),
};

function setStatus(message, isError = false) {
  els.status.textContent = message || '';
  els.status.classList.toggle('error', Boolean(isError));
}

function setTranscript(text) {
  els.transcript.textContent = text;
}

function setCurrentScript(text) {
  state.currentScript = String(text || '').trim();
  const has = Boolean(state.currentScript);
  els.listen.disabled = !has;
  if (!has) hideListenBanner();
}

function showListenBanner() {
  if (!state.currentScript) return;
  els.listenBanner.hidden = false;
  els.listenBanner.classList.remove('hidden');
  setStatus('Tap Hear this tour — the browser blocked autoplay until you press it.', true);
}

function hideListenBanner() {
  els.listenBanner.hidden = true;
  els.listenBanner.classList.add('hidden');
}

function setSpeaking(on) {
  state.speaking = on;
  els.avatar.dataset.state = on ? 'speaking' : 'idle';
  els.pause.disabled = !on && !state.paused;
  els.stop.disabled = !on && !state.paused && !(window.speechSynthesis && speechSynthesis.speaking);
  if (on) hideListenBanner();
}

function preferredVoice() {
  const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
  const localEn = voices.filter((v) => v.localService && /^en(-|_|$)/i.test(v.lang));
  const anyEn = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
  const pool = localEn.length ? localEn : anyEn;
  const ranked = pool.find((v) => /google|samantha|daniel|microsoft|natural|premium/i.test(v.name));
  return ranked || pool[0] || null;
}

function chunkForSpeech(text, maxChars = 220) {
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
  return chunks;
}

function stopKeepAlive() {
  if (state.keepAlive) {
    clearInterval(state.keepAlive);
    state.keepAlive = null;
  }
}

function startKeepAlive() {
  stopKeepAlive();
  if (!window.speechSynthesis) return;
  state.keepAlive = setInterval(() => {
    if (!speechSynthesis.speaking) return;
    speechSynthesis.pause();
    speechSynthesis.resume();
  }, 11000);
}

function stopSpeech() {
  state.speechQueue = [];
  if (state.startWatchdog) {
    clearTimeout(state.startWatchdog);
    state.startWatchdog = null;
  }
  stopKeepAlive();
  if (window.speechSynthesis) speechSynthesis.cancel();
  state.paused = false;
  setSpeaking(false);
  els.pause.textContent = '⏸';
}

function playNextChunk() {
  if (!window.speechSynthesis) return;
  if (state.paused) return;
  const text = state.speechQueue.shift();
  if (!text) {
    stopKeepAlive();
    setSpeaking(false);
    return;
  }
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'en-US';
  utter.rate = 0.96;
  utter.pitch = 1;
  const voice = preferredVoice();
  if (voice) utter.voice = voice;
  utter.onstart = () => {
    if (state.startWatchdog) {
      clearTimeout(state.startWatchdog);
      state.startWatchdog = null;
    }
    setSpeaking(true);
    startKeepAlive();
  };
  utter.onend = () => {
    if (state.speechQueue.length) playNextChunk();
    else {
      stopKeepAlive();
      setSpeaking(false);
    }
  };
  utter.onerror = (event) => {
    const err = event && event.error;
    if (err === 'interrupted' || err === 'canceled') return;
    if (state.speechQueue.length) playNextChunk();
    else {
      setSpeaking(false);
      showListenBanner();
    }
  };
  speechSynthesis.speak(utter);
  if (speechSynthesis.paused) speechSynthesis.resume();
}

function queueSpeech(text, { replace } = { replace: false }) {
  const chunks = chunkForSpeech(text);
  if (!chunks.length) return;
  if (replace) state.speechQueue = chunks;
  else state.speechQueue.push(...chunks);
}

function kickSpeech() {
  if (!window.speechSynthesis) {
    setStatus('This browser has no spoken narrator. The transcript still works.', true);
    showListenBanner();
    return;
  }
  if (state.paused) return;
  if (speechSynthesis.speaking || speechSynthesis.pending) return;
  playNextChunk();
  if (state.startWatchdog) clearTimeout(state.startWatchdog);
  state.startWatchdog = setTimeout(() => {
    state.startWatchdog = null;
    if (!speechSynthesis.speaking && state.currentScript) showListenBanner();
  }, 900);
}

/**
 * Must run in the same user-gesture turn as a tap. iOS blocks speak() after await fetch / GPS.
 * A short intro keeps the speech session alive so the tour script can be queued onto it.
 */
function beginSpokenTour(intro) {
  if (!window.speechSynthesis) {
    setStatus('This browser has no spoken narrator. Read the transcript, then try another browser.', true);
    return;
  }
  stopSpeech();
  queueSpeech(intro, { replace: true });
  playNextChunk();
}

function continueSpokenTour(script) {
  setCurrentScript(script);
  if (!script) return;
  queueSpeech(script, { replace: false });
  kickSpeech();
}

function hearCurrentTour() {
  hideListenBanner();
  if (!state.currentScript) return;
  beginSpokenTour(state.currentScript);
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

function fetchSearch(query) {
  return readJson(`/api/search?q=${encodeURIComponent(query)}`);
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
    continueSpokenTour(data.script);
    for (const place of data.places || []) state.spoken.add(place.id);
  }
}

function narratePlace(place) {
  const script = place.script || place.extract || place.title;
  setTranscript(script);
  setCurrentScript(script);
  beginSpokenTour(script);
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
    continueSpokenTour(line);
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
        setStatus('Location permission was denied. Enter a place or try a demo city.', true);
      } else {
        setStatus('Could not read GPS. Enter a place, or check location settings.', true);
      }
      els.demoPanel.hidden = false;
      els.demoPanel.classList.remove('hidden');
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}

async function startLiveTour() {
  state.spoken.clear();
  state.mode = 'live';
  els.start.textContent = 'Following you…';
  setStatus('Asking for location…');
  beginSpokenTour("I'm your local guide. Finding where you are now. I'll start the tour as soon as I have your location.");
  initMap();
  startWatch();
}

async function startDemo(id, label) {
  state.spoken.clear();
  state.mode = 'demo';
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  setStatus('Loading a guided neighborhood…');
  beginSpokenTour(`I'm your local guide. Opening the tour for ${label || 'this neighborhood'}.`);
  const data = await fetchHereDemo(id);
  applyPayload(data, { announce: true });
  setStatus('Demo tour. On a phone, Start live tour uses your real GPS.');
}

async function startSearch(query) {
  state.spoken.clear();
  state.mode = 'search';
  if (state.watchId !== null) {
    navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
  }
  setStatus('Looking up that place…');
  beginSpokenTour(`I'm your local guide. Looking up ${query}.`);
  const data = await fetchSearch(query);
  applyPayload(data, { announce: true });
  setStatus('Tour loaded for the place you entered.');
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
      startDemo(loc.id, loc.name).catch((err) => setStatus(err.message, true));
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
els.listen.addEventListener('click', () => hearCurrentTour());
els.listenBanner.addEventListener('click', () => hearCurrentTour());
els.searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = String(els.placeQuery.value || '').trim();
  if (query.length < 2) {
    setStatus('Type a city, landmark, or address first.', true);
    return;
  }
  startSearch(query).catch((err) => setStatus(err.message, true));
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
  setTranscript('Narration stopped. Tap Hear this tour or a place to start again.');
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
