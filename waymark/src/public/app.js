(() => {
  const app = document.getElementById('app');
  const state = {
    user: null,
    csrf: null,
    cookieOnlyAuth: false,
    mode: 'login',
    stampId: null,
    flash: null,
    tab: 'map',
    installEvent: null,
    googleMapsKey: null,
    pendingStamp: null,
    shareUrl: null,
    book: null,
  };
  let mapHandle = null;

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

  function formatTime(iso) {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
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
    window.L.tileLayer('/tiles/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap',
    }).addTo(map);
    const markers = [];
    usablePins(pins).forEach((pin) => {
      const active = Number(pin.id) === Number(state.stampId);
      const marker = window.L.marker([pin.lat, pin.lng], {
        icon: window.L.divIcon({
          className: `gpin${active ? ' is-active' : ''}`,
          html: '<span></span>',
          iconSize: [28, 28],
          iconAnchor: [14, 26],
        }),
      }).addTo(map);
      marker.on('click', () => onPin(pin));
      markers.push(marker);
    });
    const usable = usablePins(pins);
    if (usable.length === 1) map.setView([usable[0].lat, usable[0].lng], 15);
    else if (usable.length > 1) {
      map.fitBounds(usable.map((p) => [p.lat, p.lng]), { padding: [36, 36], maxZoom: 15 });
    } else {
      map.setView([37.7749, -122.4194], 12);
    }
    map.on('click', (ev) => onMapTap({ lat: ev.latlng.lat, lng: ev.latlng.lng }));
    bindMapTools(
      () => map.getCenter(),
      () => map.zoomIn(),
      () => map.zoomOut(),
      () => {
        const pts = usablePins(pins);
        if (pts.length) map.fitBounds(pts.map((p) => [p.lat, p.lng]), { padding: [36, 36], maxZoom: 15 });
      }
    );
    setTimeout(() => map.invalidateSize(), 80);
    return () => map.remove();
  }

  async function mountGoogleMap(el, pins, { onPin, onMapTap }) {
    const ok = await ensureGoogleMaps();
    if (!ok) return mountLeafletMap(el, pins, { onPin, onMapTap });
    const usable = usablePins(pins);
    const center = usable[0]
      ? { lat: usable[0].lat, lng: usable[0].lng }
      : { lat: 37.7749, lng: -122.4194 };
    const map = new window.google.maps.Map(el, {
      center,
      zoom: usable.length ? 14 : 12,
      disableDefaultUI: true,
      zoomControl: false,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
    });
    usable.forEach((pin) => {
      const marker = new window.google.maps.Marker({
        position: { lat: pin.lat, lng: pin.lng },
        map,
        title: pin.label,
      });
      marker.addListener('click', () => onPin(pin));
    });
    if (usable.length > 1) {
      const bounds = new window.google.maps.LatLngBounds();
      usable.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
      map.fitBounds(bounds, 40);
    }
    map.addListener('click', (ev) => {
      onMapTap({ lat: ev.latLng.lat(), lng: ev.latLng.lng() });
    });
    bindMapTools(
      () => {
        const c = map.getCenter();
        return c ? { lat: c.lat(), lng: c.lng() } : null;
      },
      () => map.setZoom(map.getZoom() + 1),
      () => map.setZoom(map.getZoom() - 1),
      () => {
        if (!usable.length) return;
        const bounds = new window.google.maps.LatLngBounds();
        usable.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lng }));
        map.fitBounds(bounds, 40);
      }
    );
    return () => {
      window.google.maps.event.clearInstanceListeners(map);
    };
  }

  async function mountMap(el, pins, handlers) {
    if (mapHandle) {
      try { mapHandle(); } catch { /* ignore */ }
      mapHandle = null;
    }
    mapHandle = await mountGoogleMap(el, pins, handlers);
  }

  function tabIcon(name) {
    const paths = {
      map: '<circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18"/><path d="M5 8h14M5 16h14"/>',
      stamps: '<rect x="5" y="4" width="14" height="16" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
      stats: '<path d="M5 19V9M12 19V5M19 19v-7"/>',
      you: '<circle cx="12" cy="8" r="3"/><path d="M5 19c1.5-3 4-4.5 7-4.5S17.5 16 19 19"/>',
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  }

  function renderAuth() {
    const signup = state.mode === 'signup';
    app.innerHTML = `
      <div class="auth">
        <div class="auth-mark" aria-hidden="true"></div>
        <div class="auth-card">
          <h1>Waymark</h1>
          <p class="lead">Your private map of places you have been.</p>
          <form id="authForm">
            ${signup ? '<label>Name</label><input name="name" autocomplete="name" required minlength="2" maxlength="80" />' : ''}
            <label>Email</label>
            <input name="email" type="email" autocomplete="username" required />
            <label>Password</label>
            <input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" required minlength="10" />
            <p class="error" id="authError" hidden></p>
            <button class="primary" type="submit">${signup ? 'Create account' : 'Sign in'}</button>
          </form>
          <p class="auth-switch">
            ${signup ? 'Already have an account?' : 'New here?'}
            <button type="button" id="authSwitch">${signup ? 'Sign in' : 'Create an account'}</button>
          </p>
          <p class="hint">Demo: maya@waymark.test / waymark-demo-1</p>
        </div>
      </div>
    `;
    document.getElementById('authSwitch').onclick = () => {
      state.mode = signup ? 'login' : 'signup';
      render();
    };
    document.getElementById('authForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const errEl = document.getElementById('authError');
      errEl.hidden = true;
      try {
        const path = signup ? '/api/signup' : '/api/login';
        const data = await api(path, {
          method: 'POST',
          body: JSON.stringify({
            email: fd.get('email'),
            password: fd.get('password'),
            name: fd.get('name'),
          }),
        });
        state.user = data.user;
        state.csrf = data.csrf;
        state.tab = 'map';
        render();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message || 'Could not sign in';
      }
    };
  }

  function shell(body, { overflow = true } = {}) {
    return `
      <div class="phone-app">
        <header class="app-header">
          <div>
            <h1>Waymark</h1>
            <div class="sub">${escapeHtml(state.user?.name || '')}</div>
          </div>
        </header>
        ${state.flash ? `<p class="flash">${escapeHtml(state.flash)}</p>` : ''}
        <div class="app-body" ${overflow ? '' : 'style="overflow:hidden"'}>${body}</div>
        <nav class="tabbar">
          ${['map', 'stamps', 'stats', 'you'].map((tab) => `
            <button class="tab${state.tab === tab ? ' is-active' : ''}" data-tab="${tab}">
              ${tabIcon(tab)}
              ${tab[0].toUpperCase() + tab.slice(1)}
            </button>
          `).join('')}
        </nav>
      </div>
    `;
  }

  function bindTabs() {
    app.querySelectorAll('[data-tab]').forEach((btn) => {
      btn.onclick = () => {
        state.tab = btn.getAttribute('data-tab');
        state.pendingStamp = null;
        state.flash = null;
        render();
      };
    });
  }

  function stampDialog() {
    if (!state.pendingStamp) return '';
    return `
      <div class="overlay" id="stampOverlay">
        <form class="dialog" id="stampForm">
          <h2>Drop a stamp</h2>
          <p class="muted">Saves this spot to your private map.</p>
          <label>Place name</label>
          <input name="label" maxlength="80" placeholder="Optional — we can name it" />
          <label>Note</label>
          <textarea name="note" maxlength="280" placeholder="What happened here?"></textarea>
          <p class="error" id="stampError" hidden></p>
          <div class="dialog-actions">
            <button type="button" id="cancelStamp">Cancel</button>
            <button class="primary" type="submit">Save stamp</button>
          </div>
        </form>
      </div>
    `;
  }

  async function renderMap() {
    const list = await api('/api/stamps');
    app.innerHTML = shell(`
      <div class="map-screen">
        <div class="map-wrap">
          <div class="map-canvas" id="mapCanvas"></div>
          <div class="map-tools">
            <button type="button" id="zoomIn" aria-label="Zoom in">+</button>
            <button type="button" id="zoomOut" aria-label="Zoom out">−</button>
            <button type="button" id="fit" aria-label="Fit stamps">⊡</button>
            <a class="maps-out-btn" id="openGmaps" href="#">Google<br>Maps</a>
          </div>
          <p class="map-hint">Tap the map or Stamp here</p>
          <button class="fab" type="button" id="stampHere">Stamp here</button>
        </div>
        ${stampDialog()}
      </div>
    `, { overflow: false });
    bindTabs();
    const canvas = document.getElementById('mapCanvas');
    await mountMap(canvas, list.stamps, {
      onPin: (pin) => {
        state.stampId = pin.id;
        state.tab = 'stamps';
        render();
      },
      onMapTap: (pt) => {
        state.pendingStamp = pt;
        render();
      },
    });
    const here = document.getElementById('stampHere');
    if (here) {
      here.onclick = () => {
        if (!navigator.geolocation) {
          state.flash = 'Location is not available on this device.';
          render();
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (pos) => {
            state.pendingStamp = { lat: pos.coords.latitude, lng: pos.coords.longitude };
            render();
          },
          () => {
            state.flash = 'Could not read your location. Tap the map instead.';
            render();
          },
          { enableHighAccuracy: true, timeout: 8000, maximumAge: 15000 }
        );
      };
    }
    bindStampForm();
  }

  function bindStampForm() {
    const cancel = document.getElementById('cancelStamp');
    if (cancel) {
      cancel.onclick = () => {
        state.pendingStamp = null;
        render();
      };
    }
    const form = document.getElementById('stampForm');
    if (!form) return;
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(form);
      const errEl = document.getElementById('stampError');
      errEl.hidden = true;
      try {
        const saved = await api('/api/stamps', {
          method: 'POST',
          body: JSON.stringify({
            lat: state.pendingStamp.lat,
            lng: state.pendingStamp.lng,
            label: fd.get('label'),
            note: fd.get('note'),
          }),
        });
        state.pendingStamp = null;
        state.stampId = saved.id;
        state.flash = `Saved ${saved.label}`;
        state.tab = 'stamps';
        render();
      } catch (err) {
        errEl.hidden = false;
        errEl.textContent = err.message || 'Could not save stamp';
      }
    };
  }

  async function renderStamps() {
    const list = await api('/api/stamps');
    const rows = list.stamps.length
      ? list.stamps.map((s) => `
          <button class="pin-row${Number(s.id) === Number(state.stampId) ? ' is-active' : ''}" data-stamp="${s.id}" type="button">
            <strong>${escapeHtml(s.label)}</strong>
            <small>${escapeHtml(s.locality || 'Dropped pin')} · ${escapeHtml(formatTime(s.createdAt))}</small>
            ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ''}
          </button>
        `).join('')
      : '<p class="empty">No stamps yet. Open Map and drop your first one.</p>';
    const selected = list.stamps.find((s) => Number(s.id) === Number(state.stampId));
    app.innerHTML = shell(`
      <div class="list-screen">
        ${rows}
        ${selected ? `
          <div class="you-actions">
            <a class="maps-out" href="${escapeHtml(googleMapsSearchUrl(selected.lat, selected.lng, selected.label))}" target="_blank" rel="noopener noreferrer">Open in Google Maps</a>
            <button class="danger ghost" type="button" id="deleteStamp">Remove this stamp</button>
          </div>
        ` : ''}
      </div>
    `);
    bindTabs();
    app.querySelectorAll('[data-stamp]').forEach((btn) => {
      btn.onclick = () => {
        state.stampId = Number(btn.getAttribute('data-stamp'));
        render();
      };
    });
    const del = document.getElementById('deleteStamp');
    if (del) {
      del.onclick = async () => {
        if (!window.confirm('Remove this stamp from your map?')) return;
        await api(`/api/stamps/${state.stampId}`, { method: 'DELETE' });
        state.stampId = null;
        state.flash = 'Stamp removed.';
        render();
      };
    }
  }

  async function renderStats() {
    const data = await api('/api/stats');
    const places = data.topLocalities.length
      ? data.topLocalities.map((r) => `
          <div class="locality-row">
            <span>${escapeHtml(r.locality)}</span>
            <strong>${r.count}</strong>
          </div>
        `).join('')
      : '<p class="muted">Cities show up after you stamp a few places.</p>';
    app.innerHTML = shell(`
      <div class="stats-screen">
        <div class="stat-grid">
          <div class="stat-card"><div class="n">${data.stampCount}</div><div class="l">Stamps</div></div>
          <div class="stat-card"><div class="n">${data.localityCount}</div><div class="l">Places</div></div>
        </div>
        <div class="you-actions">
          <h3>Where you have been</h3>
          ${places}
          <p class="muted">${data.firstAt ? `First stamp ${escapeHtml(formatTime(data.firstAt))}` : 'Your book is empty.'}</p>
        </div>
      </div>
    `);
    bindTabs();
  }

  async function renderYou() {
    const ios = isIos();
    app.innerHTML = shell(`
      <div class="you-screen">
        <div class="you-card">
          <div class="avatar">${escapeHtml((state.user.name || '?').slice(0, 1).toUpperCase())}</div>
          <h2>${escapeHtml(state.user.name)}</h2>
          <p class="muted">${escapeHtml(state.user.email)}</p>
        </div>
        ${isStandalone() ? '' : `
          <div class="install-card">
            <h3>Add to Home Screen</h3>
            ${state.installEvent ? '<p>Install Waymark like a phone app.</p><button class="primary" type="button" id="installBtn">Install app</button>' : `
              <p>${ios ? 'Safari on iPhone:' : 'Chrome on Android:'}</p>
              <ol>
                ${ios
                  ? '<li>Tap Share</li><li>Add to Home Screen</li><li>Add</li>'
                  : '<li>Open the browser menu</li><li>Install app / Add to Home Screen</li>'}
              </ol>
            `}
          </div>
        `}
        <div class="you-actions">
          <h3>Share a read-only book</h3>
          <p>Friends see approximate locations, never your exact GPS.</p>
          ${state.shareUrl ? `<div class="share-url">${escapeHtml(state.shareUrl)}</div>` : ''}
          <button class="primary" type="button" id="shareBtn">Create share link</button>
          <button class="ghost" type="button" id="revokeShare">Stop sharing</button>
        </div>
        <div class="you-actions">
          <button type="button" id="signOut">Sign out</button>
        </div>
      </div>
    `);
    bindTabs();
    const installBtn = document.getElementById('installBtn');
    if (installBtn && state.installEvent) {
      installBtn.onclick = async () => {
        state.installEvent.prompt();
        await state.installEvent.userChoice;
        state.installEvent = null;
        render();
      };
    }
    document.getElementById('shareBtn').onclick = async () => {
      const created = await api('/api/share', { method: 'POST' });
      state.shareUrl = `${window.location.origin}/#book=${created.token}`;
      state.flash = 'Share link created.';
      render();
    };
    document.getElementById('revokeShare').onclick = async () => {
      await api('/api/share/revoke', { method: 'POST' });
      state.shareUrl = null;
      state.flash = 'Sharing stopped.';
      render();
    };
    document.getElementById('signOut').onclick = async () => {
      try { await api('/api/logout', { method: 'POST' }); } catch { /* ignore */ }
      state.user = null;
      state.csrf = null;
      state.mode = 'login';
      render();
    };
  }

  async function renderBook() {
    const data = state.book;
    const rows = data.stamps.map((s) => `
      <div class="pin-row">
        <strong>${escapeHtml(s.label)}</strong>
        <small>${escapeHtml(s.locality || 'Approximate location')} · ${escapeHtml(formatTime(s.createdAt))}</small>
        ${s.note ? `<p>${escapeHtml(s.note)}</p>` : ''}
      </div>
    `).join('') || '<p class="empty">This book has no stamps yet.</p>';
    app.innerHTML = `
      <div class="phone-app">
        <header class="app-header">
          <div>
            <h1>Waymark</h1>
            <div class="sub">${escapeHtml(data.ownerName)} · ${data.stampCount} stamps</div>
          </div>
        </header>
        <div class="app-body">
          <div class="map-screen" style="height: 42%">
            <div class="map-wrap">
              <div class="map-canvas" id="mapCanvas"></div>
            </div>
          </div>
          <div class="list-screen">${rows}</div>
        </div>
      </div>
    `;
    const canvas = document.getElementById('mapCanvas');
    await mountMap(canvas, data.stamps, { onPin() {}, onMapTap() {} });
  }

  async function render() {
    if (state.book) {
      await renderBook();
      return;
    }
    if (!state.user) {
      renderAuth();
      return;
    }
    try {
      if (state.tab === 'map') await renderMap();
      else if (state.tab === 'stamps') await renderStamps();
      else if (state.tab === 'stats') await renderStats();
      else await renderYou();
    } catch (err) {
      if (err.code === 'sign in required' || /sign in/i.test(err.message || '')) {
        state.user = null;
        renderAuth();
        return;
      }
      app.innerHTML = shell(`<p class="empty">${escapeHtml(err.message || 'Something went wrong')}</p>`);
      bindTabs();
    }
  }

  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    state.installEvent = ev;
  });

  async function boot() {
    try {
      const cfg = await api('/api/security-config');
      state.cookieOnlyAuth = Boolean(cfg.cookieOnlyAuth);
      state.googleMapsKey = cfg.googleMapsApiKey || null;
    } catch { /* ignore */ }
    const hash = String(window.location.hash || '');
    const bookMatch = hash.match(/book=([A-Za-z0-9_-]+)/);
    if (bookMatch) {
      try {
        state.book = await api(`/api/books/${bookMatch[1]}`);
      } catch {
        state.flash = 'That shared book is not available.';
      }
    }
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.csrf = me.csrf;
    } catch {
      state.user = null;
    }
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
    render();
  }

  boot();
})();
