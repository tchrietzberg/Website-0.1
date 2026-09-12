(() => {
  const app = document.getElementById('app');
  const state = {
    user: null,
    csrf: null,
    cookieOnlyAuth: false,
    mode: 'login',
    placeId: null,
    flash: null,
    tab: 'map',
    installEvent: null,
    googleMapsKey: null,
  };
  let pollTimer = null;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.matchMedia('(display-mode: fullscreen)').matches
      || Boolean(window.navigator.standalone);
  }

  function isIos() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent)
      || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = {
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    };
    if (state.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      headers['X-CSRF-Token'] = state.csrf;
    }
    const res = await fetch(path, { ...opts, method, headers, credentials: 'include' });
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      if (!res.ok) throw new Error(await res.text());
      return res;
    }
    const data = await res.json();
    if (data && data.csrf) state.csrf = data.csrf;
    if (!res.ok) {
      const err = new Error(data.message || data.error || res.statusText);
      err.code = data.error;
      throw err;
    }
    return data;
  }

  function stopPoll() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      });
    } catch {
      return String(iso);
    }
  }

  function googleMapsSearchUrl(lat, lng, label = '') {
    const query = label
      ? `${Number(lat)},${Number(lng)} (${label})`
      : `${Number(lat)},${Number(lng)}`;
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  }

  function loadExternalScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-map-src="${src}"]`);
      if (existing) {
        if (existing.getAttribute('data-loaded') === '1') return resolve();
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Map failed to load')), { once: true });
        return;
      }
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.setAttribute('data-map-src', src);
      s.onload = () => {
        s.setAttribute('data-loaded', '1');
        resolve();
      };
      s.onerror = () => reject(new Error('Map failed to load'));
      document.head.appendChild(s);
    });
  }

  async function ensureGoogleMaps() {
    if (window.google && window.google.maps) return true;
    if (!state.googleMapsKey) return false;
    try {
      await loadExternalScript(`https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(state.googleMapsKey)}`);
      return Boolean(window.google && window.google.maps);
    } catch {
      return false;
    }
  }

  function usablePins(pins) {
    return (pins || []).filter((p) => Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng)));
  }

  function bindMapTools(getCenter, zoomIn, zoomOut, fit) {
    const zoomInBtn = document.getElementById('zoomIn');
    const zoomOutBtn = document.getElementById('zoomOut');
    const fitBtn = document.getElementById('fit');
    const openBtn = document.getElementById('openGmaps');
    if (zoomInBtn) zoomInBtn.onclick = zoomIn;
    if (zoomOutBtn) zoomOutBtn.onclick = zoomOut;
    if (fitBtn) fitBtn.onclick = fit;
    if (openBtn) {
      openBtn.onclick = (ev) => {
        ev.preventDefault();
        const center = getCenter();
        if (!center) return;
        window.open(googleMapsSearchUrl(center.lat, center.lng), '_blank', 'noopener,noreferrer');
      };
    }
  }

  function mountLeafletMap(el, pins, { onPin, onMapTap }) {
    const map = window.L.map(el, { zoomControl: false, attributionControl: true });
    window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    const markers = [];
    usablePins(pins).forEach((pin) => {
      const active = Number(pin.placeId) === Number(state.placeId);
      const marker = window.L.marker([pin.lat, pin.lng], {
        icon: window.L.divIcon({
          className: active ? 'gpin is-active' : 'gpin',
          iconSize: [22, 28],
          iconAnchor: [11, 28],
          html: '<span></span>',
        }),
        title: pin.placeLabel || 'Pin',
      });
      marker.on('click', (ev) => {
        window.L.DomEvent.stopPropagation(ev);
        onPin(pin.placeId);
      });
      marker.addTo(map);
      markers.push(marker);
    });
    const fit = () => {
      if (markers.length) map.fitBounds(window.L.featureGroup(markers).getBounds().pad(0.28));
      else map.setView([37.7749, -122.4194], 13);
    };
    fit();
    map.on('click', (ev) => onMapTap({ lat: ev.latlng.lat, lng: ev.latlng.lng }));
    bindMapTools(
      () => map.getCenter(),
      () => map.zoomIn(),
      () => map.zoomOut(),
      fit
    );
    requestAnimationFrame(() => map.invalidateSize());
  }

  function mountGoogleMap(el, pins, { onPin, onMapTap }) {
    const map = new window.google.maps.Map(el, {
      center: { lat: 37.7749, lng: -122.4194 },
      zoom: 13,
      disableDefaultUI: true,
      clickableIcons: false,
      gestureHandling: 'greedy',
      keyboardShortcuts: false,
    });
    const bounds = new window.google.maps.LatLngBounds();
    const markers = [];
    usablePins(pins).forEach((pin) => {
      const marker = new window.google.maps.Marker({
        position: { lat: Number(pin.lat), lng: Number(pin.lng) },
        map,
        title: pin.placeLabel || 'Pin',
      });
      marker.addListener('click', () => onPin(pin.placeId));
      bounds.extend(marker.getPosition());
      markers.push(marker);
    });
    const fit = () => {
      if (markers.length) map.fitBounds(bounds, 48);
      else map.setCenter({ lat: 37.7749, lng: -122.4194 });
    };
    fit();
    map.addListener('click', (ev) => {
      onMapTap({ lat: ev.latLng.lat(), lng: ev.latLng.lng() });
    });
    bindMapTools(
      () => {
        const c = map.getCenter();
        return c ? { lat: c.lat(), lng: c.lng() } : null;
      },
      () => map.setZoom((map.getZoom() || 13) + 1),
      () => map.setZoom((map.getZoom() || 13) - 1),
      fit
    );
  }

  async function mountStreetMap(el, pins, handlers) {
    if (await ensureGoogleMaps()) {
      mountGoogleMap(el, pins, handlers);
      return;
    }
    if (window.L) {
      mountLeafletMap(el, pins, handlers);
      return;
    }
    el.innerHTML = '<p class="error">Map failed to load.</p>';
  }

  const TAB_ICONS = {
    map: '<svg viewBox="0 0 24 24"><path d="M3 6.5 9 4l6 2.5L21 4v15.5L15 22l-6-2.5L3 22Z"/><path d="M9 4v15.5M15 6.5V22"/></svg>',
    places: '<svg viewBox="0 0 24 24"><path d="M12 21s7-5.4 7-11a7 7 0 1 0-14 0c0 5.6 7 11 7 11Z"/><circle cx="12" cy="10" r="2.4"/></svg>',
    chat: '<svg viewBox="0 0 24 24"><path d="M5 18.5 3 21V6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v9A2.5 2.5 0 0 1 18.5 18H8Z"/></svg>',
    you: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.2"/><path d="M5 19.2c.8-3.2 3.4-5 7-5s6.2 1.8 7 5"/></svg>',
  };

  function tabBar() {
    const tabs = [
      { id: 'map', label: 'Map' },
      { id: 'places', label: 'Places' },
      { id: 'chat', label: 'Chat' },
      { id: 'you', label: 'You' },
    ];
    return `
      <nav class="tabbar" aria-label="App">
        ${tabs.map((t) => `
          <button type="button" class="tab${state.tab === t.id ? ' is-active' : ''}" data-tab="${t.id}">
            ${TAB_ICONS[t.id]}
            ${escapeHtml(t.label)}
          </button>`).join('')}
      </nav>`;
  }

  function chatHtml(place, messages) {
    if (!place) {
      return `
        <div class="chat-empty">
          <h2>Same-place chat</h2>
          <p>Pin a spot you were at. Anyone else within about 100 meters joins this room.</p>
        </div>`;
    }
    const visitors = (place.visitors || []).map((v) => (
      `<span class="chip">${escapeHtml(v.name)}</span>`
    )).join('');
    const msgs = (messages || []).map((m) => `
      <article class="msg${m.mine ? ' is-mine' : ''}" data-msg-id="${Number(m.id)}">
        <strong>${escapeHtml(m.mine ? 'You' : m.authorName)}</strong>
        <p>${escapeHtml(m.body)}</p>
        <time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(formatTime(m.createdAt))}</time>
      </article>`).join('');
    const mapsHref = googleMapsSearchUrl(place.approxLat, place.approxLng, place.label);
    return `
      <div class="chat-head">
        <h2>${escapeHtml(place.label)}</h2>
        <p class="muted">${place.visitorCount} ${place.visitorCount === 1 ? 'person was' : 'people were'} here
          · ~${Number(place.approxLat).toFixed(3)}, ${Number(place.approxLng).toFixed(3)}</p>
        <p><a class="maps-out" href="${escapeHtml(mapsHref)}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>
        <div class="visitors">${visitors}</div>
      </div>
      <div class="thread" id="thread">${msgs || '<p class="muted">No messages yet. Say hello.</p>'}</div>
      <form class="compose" id="compose">
        <input id="msg" maxlength="2000" autocomplete="off" inputmode="text" placeholder="Message this place…" />
        <button class="primary" type="submit">Send</button>
      </form>`;
  }

  function promptPin({ lat, lng, defaultLabel = '' }) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'overlay';
      overlay.innerHTML = `
        <div class="dialog" role="dialog" aria-modal="true">
          <h2>Drop a pin here?</h2>
          <p class="muted">Approximate location ${escapeHtml(Number(lat).toFixed(5))}, ${escapeHtml(Number(lng).toFixed(5))}. Other people will not see this exact pinpoint.</p>
          <label>Name this place
            <input id="pinLabel" maxlength="80" value="${escapeHtml(defaultLabel)}" placeholder="e.g. Ferry Building" />
          </label>
          <div class="dialog-actions">
            <button type="button" data-cancel>Cancel</button>
            <button type="button" class="primary" data-ok>Pin this spot</button>
          </div>
        </div>`;
      app.appendChild(overlay);
      const input = overlay.querySelector('#pinLabel');
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      overlay.querySelector('[data-cancel]').onclick = () => finish(null);
      overlay.querySelector('[data-ok]').onclick = () => finish(String(input.value || '').trim());
      overlay.addEventListener('click', (ev) => { if (ev.target === overlay) finish(null); });
      setTimeout(() => input?.focus(), 0);
    });
  }

  function renderAuth() {
    stopPoll();
    const signup = state.mode === 'signup';
    app.innerHTML = `
      <div class="auth">
        <div class="auth-card">
          <div class="auth-mark" role="img" aria-label="Pinpoint"></div>
          <h1>Pinpoint</h1>
          <p class="lead">${signup ? 'Create an account to drop pins and chat with people who were at the same spot.' : 'Pin where you were. Chat with people who were there too.'}</p>
          <form id="authForm">
          ${signup ? '<label>Name<input id="name" autocomplete="name" /></label>' : ''}
          <label>Email<input id="email" type="email" autocomplete="username" inputmode="email" /></label>
          <label>Password<input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" /></label>
          <button class="primary" type="submit" id="submit">${signup ? 'Create account' : 'Sign in'}</button>
          </form>
          <div id="err" class="error" hidden></div>
          <p class="auth-switch">
            ${signup
              ? 'Already have an account? <button type="button" id="toggle">Sign in</button>'
              : 'New here? <button type="button" id="toggle">Create an account</button>'}
          </p>
          ${signup ? '' : '<p class="hint">Demo · alex@pinpoint.test / pinpoint-demo-1</p>'}
        </div>
      </div>`;
    const err = app.querySelector('#err');
    app.querySelector('#toggle').onclick = () => {
      state.mode = signup ? 'login' : 'signup';
      renderAuth();
    };
    app.querySelector('#authForm').onsubmit = async (ev) => {
      ev.preventDefault();
      err.hidden = true;
      try {
        const body = {
          email: app.querySelector('#email').value,
          password: app.querySelector('#password').value,
        };
        if (signup) body.name = app.querySelector('#name').value;
        const data = await api(signup ? '/api/signup' : '/api/login', {
          method: 'POST',
          body: JSON.stringify(body),
        });
        state.user = data.user;
        state.csrf = data.csrf;
        state.tab = 'map';
        await renderApp();
      } catch (e) {
        err.hidden = false;
        err.textContent = e.message;
      }
    };
  }

  async function dropPin(payload) {
    const place = await api('/api/places/pins', { method: 'POST', body: JSON.stringify(payload) });
    state.placeId = place.id;
    state.tab = 'chat';
    state.flash = `Pinned ${place.label}. You can chat with ${place.visitorCount} ${place.visitorCount === 1 ? 'person who was' : 'people who were'} here.`;
    await renderApp();
  }

  async function openChat(placeId) {
    stopPoll();
    state.placeId = placeId;
    if (state.tab !== 'chat') {
      state.tab = 'chat';
      await renderApp();
      return;
    }
    const col = document.getElementById('chatCol');
    if (!col) return;
    let place;
    let messages;
    try {
      place = await api(`/api/places/${placeId}`);
      messages = (await api(`/api/places/${placeId}/messages`)).messages || [];
    } catch (e) {
      col.innerHTML = `<p class="error">${escapeHtml(e.message)}</p>`;
      return;
    }
    col.innerHTML = chatHtml(place, messages);
    const thread = document.getElementById('thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
    let lastId = messages.reduce((m, row) => Math.max(m, Number(row.id) || 0), 0);
    const bind = () => {
      const form = document.getElementById('compose');
      if (!form) return;
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const input = document.getElementById('msg');
        const body = String(input?.value || '').trim();
        if (!body) return;
        try {
          const sent = await api(`/api/places/${placeId}/messages`, {
            method: 'POST',
            body: JSON.stringify({ body }),
          });
          if (input) input.value = '';
          lastId = (sent.messages || []).reduce((m, row) => Math.max(m, Number(row.id) || 0), lastId);
          col.innerHTML = chatHtml(place, sent.messages);
          const next = document.getElementById('thread');
          if (next) next.scrollTop = next.scrollHeight;
          bind();
        } catch (e) {
          const p = document.createElement('p');
          p.className = 'error';
          p.textContent = e.message;
          form.prepend(p);
        }
      };
    };
    bind();
    pollTimer = setInterval(async () => {
      if (Number(state.placeId) !== Number(placeId) || !state.user || state.tab !== 'chat') {
        stopPoll();
        return;
      }
      try {
        const fresh = await api(`/api/places/${placeId}/messages?afterId=${lastId}`);
        const incoming = fresh.messages || [];
        if (!incoming.length) return;
        lastId = incoming.reduce((m, row) => Math.max(m, Number(row.id) || 0), lastId);
        const threadEl = document.getElementById('thread');
        if (!threadEl) return;
        if (threadEl.querySelector('.muted') && !threadEl.querySelector('.msg')) threadEl.innerHTML = '';
        incoming.forEach((m) => {
          if (threadEl.querySelector(`[data-msg-id="${Number(m.id)}"]`)) return;
          threadEl.insertAdjacentHTML('beforeend', `
            <article class="msg${m.mine ? ' is-mine' : ''}" data-msg-id="${Number(m.id)}">
              <strong>${escapeHtml(m.mine ? 'You' : m.authorName)}</strong>
              <p>${escapeHtml(m.body)}</p>
              <time datetime="${escapeHtml(m.createdAt)}">${escapeHtml(formatTime(m.createdAt))}</time>
            </article>`);
        });
        threadEl.scrollTop = threadEl.scrollHeight;
      } catch { /* retry */ }
    }, 2500);
  }

  function installCardHtml() {
    if (isStandalone()) {
      return `
        <section class="install-card">
          <h3>Installed</h3>
          <p>Pinpoint is running as a phone app on your home screen.</p>
        </section>`;
    }
    if (state.installEvent) {
      return `
        <section class="install-card">
          <h3>Install Pinpoint</h3>
          <p>Add this app to your phone. It opens full-screen, like a native app.</p>
          <button type="button" class="primary" id="installBtn">Add to home screen</button>
        </section>`;
    }
    if (isIos()) {
      return `
        <section class="install-card">
          <h3>Add to iPhone</h3>
          <ol>
            <li>Tap the Share button</li>
            <li>Tap Add to Home Screen</li>
            <li>Tap Add</li>
          </ol>
        </section>`;
    }
    return `
      <section class="install-card">
        <h3>Add to your phone</h3>
        <p>Open this page in Chrome or Safari on your phone, then use the browser menu to install or Add to Home Screen.</p>
      </section>`;
  }

  function youHtml() {
    const initial = String(state.user.name || '?').trim().charAt(0).toUpperCase();
    return `
      <div class="you-screen">
        <div class="you-card">
          <div class="avatar" aria-hidden="true">${escapeHtml(initial)}</div>
          <h2>${escapeHtml(state.user.name)}</h2>
          <p class="muted">${escapeHtml(state.user.email)}</p>
        </div>
        ${installCardHtml()}
        <div class="you-actions">
          <button type="button" class="ghost" id="logout">Sign out</button>
        </div>
      </div>`;
  }

  async function renderApp() {
    stopPoll();
    const [bundle, landmarkPayload] = await Promise.all([
      api('/api/places'),
      api('/api/places/landmarks'),
    ]);
    const pins = bundle.myPins || [];
    const places = bundle.places || [];
    const landmarks = landmarkPayload.landmarks || [];
    const flash = state.flash
      ? `<p class="flash" role="status">${escapeHtml(state.flash)}</p>`
      : '';
    state.flash = null;

    const titles = {
      map: { h: 'Pinpoint', s: 'Drop a pin, then chat' },
      places: { h: 'Places', s: 'Spots you have been' },
      chat: { h: 'Chat', s: 'People who were here' },
      you: { h: 'You', s: 'Account and install' },
    };
    const title = titles[state.tab] || titles.map;

    const pinRows = places.length
      ? places.map((p) => `
          <button type="button" class="pin-row${Number(p.id) === Number(state.placeId) ? ' is-active' : ''}"
            data-open-place="${p.id}">
            <strong>${escapeHtml(p.label)}</strong>
            <small>${p.visitorCount} here · last visit ${escapeHtml(formatTime(p.lastVisitedAt))}</small>
          </button>`).join('')
      : '<p class="empty">No pins yet. Use GPS, tap the map, or check in at a landmark.</p>';
    const landmarkBtns = landmarks.map((s) => (
      `<button type="button" data-landmark="${escapeHtml(s.key)}">${escapeHtml(s.label)}</button>`
    )).join('');

    let body = '';
    if (state.tab === 'map') {
      body = `
        <div class="map-screen">
          ${flash}
          <div class="map-wrap" id="mapWrap">
            <div class="map-canvas" id="mapCanvas" role="application" aria-label="Street map of places you have pinned"></div>
            <div class="map-tools">
              <button type="button" id="zoomIn" aria-label="Zoom in">+</button>
              <button type="button" id="zoomOut" aria-label="Zoom out">−</button>
              <button type="button" id="fit">Fit</button>
              <a class="maps-out-btn" id="openGmaps" href="https://www.google.com/maps" target="_blank" rel="noopener noreferrer">Google Maps</a>
            </div>
            <p class="map-hint">Tap the map to pin · gold is the open chat</p>
            <div class="landmark-rail">${landmarkBtns}</div>
            <button type="button" class="fab" id="gps">Pin my location</button>
          </div>
        </div>`;
    } else if (state.tab === 'places') {
      body = `<div class="list-screen">${flash}${pinRows}</div>`;
    } else if (state.tab === 'chat') {
      body = `<section class="chat-col" id="chatCol">${flash}${chatHtml(null, [])}</section>`;
    } else {
      body = `${flash}${youHtml()}`;
    }

    app.innerHTML = `
      <div class="phone-app">
        <header class="app-header">
          <div>
            <h1>${escapeHtml(title.h)}</h1>
            <div class="sub">${escapeHtml(title.s)}</div>
          </div>
        </header>
        <main class="app-body" id="appBody">${body}</main>
        ${tabBar()}
      </div>`;

    app.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = async () => {
        state.tab = btn.getAttribute('data-tab');
        await renderApp();
      };
    });

    const logout = document.getElementById('logout');
    if (logout) {
      logout.onclick = async () => {
        try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
        state.user = null;
        state.csrf = null;
        state.placeId = null;
        renderAuth();
      };
    }
    const installBtn = document.getElementById('installBtn');
    if (installBtn && state.installEvent) {
      installBtn.onclick = async () => {
        try {
          state.installEvent.prompt();
          await state.installEvent.userChoice;
        } catch { /* dismissed */ }
        state.installEvent = null;
        await renderApp();
      };
    }

    app.querySelectorAll('[data-open-place]').forEach((btn) => {
      btn.onclick = () => void openChat(Number(btn.getAttribute('data-open-place')));
    });
    app.querySelectorAll('[data-landmark]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await dropPin({ landmarkKey: btn.getAttribute('data-landmark') });
        } catch (e) {
          state.flash = e.message;
          await renderApp();
        }
      };
    });

    const mapWrap = document.getElementById('mapWrap');
    const mapCanvas = document.getElementById('mapCanvas');
    if (mapWrap && mapCanvas) {
      document.getElementById('gps').onclick = async () => {
        try {
          const geo = await new Promise((resolve, reject) => {
            if (!navigator.geolocation) return reject(new Error('This phone cannot share a location'));
            navigator.geolocation.getCurrentPosition(
              (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
              (err) => reject(new Error(err.message || 'Location permission denied')),
              { enableHighAccuracy: true, timeout: 9000, maximumAge: 20000 }
            );
          });
          const label = await promptPin({ ...geo, defaultLabel: 'My location' });
          if (label == null) return;
          await dropPin({ lat: geo.lat, lng: geo.lng, label });
        } catch (e) {
          state.flash = `${e.message}. Tap the map or check in at a landmark instead.`;
          await renderApp();
        }
      };
      await mountStreetMap(mapCanvas, pins, {
        onPin: (placeId) => void openChat(placeId),
        onMapTap: async (geo) => {
          if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return;
          const label = await promptPin(geo);
          if (label == null) return;
          try { await dropPin({ lat: geo.lat, lng: geo.lng, label }); }
          catch (e) { state.flash = e.message; await renderApp(); }
        },
      });
    }

    if (state.tab === 'chat') {
      if (state.placeId) await openChat(state.placeId);
      else if (places[0]) await openChat(places[0].id);
    }
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    state.installEvent = ev;
  });

  async function boot() {
    if ('serviceWorker' in navigator) {
      try { await navigator.serviceWorker.register('/sw.js', { scope: '/' }); }
      catch { /* optional */ }
    }
    try {
      const cfg = await api('/api/security-config');
      state.cookieOnlyAuth = !!cfg.cookieOnlyAuth;
      state.googleMapsKey = cfg.googleMapsApiKey || null;
    } catch { /* defaults */ }
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.csrf = me.csrf;
    } catch {
      state.user = null;
    }
    if (!state.user) return renderAuth();
    await renderApp();
  }

  boot();
})();
