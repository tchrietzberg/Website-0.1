(() => {
  const app = document.getElementById('app');
  const state = {
    user: null,
    csrf: null,
    cookieOnlyAuth: false,
    mode: 'login',
    placeId: null,
    flash: null,
  };
  let pollTimer = null;
  const mapView = { cx: -122.4194, cy: 37.7749, scale: 220000, fitted: false };

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
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

  function mercatorX(lng) { return (Number(lng) + 180) / 360; }
  function mercatorY(lat) {
    const clamped = Math.max(-85, Math.min(85, Number(lat)));
    const s = Math.sin(clamped * Math.PI / 180);
    return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  function mercatorLat(y) {
    const n = Math.PI * (1 - 2 * y);
    return (180 / Math.PI) * Math.atan(Math.sinh(n));
  }
  function project(lat, lng, width, height) {
    return {
      x: (mercatorX(lng) - mercatorX(mapView.cx)) * mapView.scale + width / 2,
      y: (mercatorY(lat) - mercatorY(mapView.cy)) * mapView.scale + height / 2,
    };
  }
  function unproject(px, py, width, height) {
    const mx = mercatorX(mapView.cx) + (px - width / 2) / mapView.scale;
    const my = mercatorY(mapView.cy) + (py - height / 2) / mapView.scale;
    return { lat: mercatorLat(my), lng: mx * 360 - 180 };
  }
  function fitMap(pins, width, height) {
    if (!pins.length) {
      mapView.cx = -122.4194;
      mapView.cy = 37.7749;
      mapView.scale = Math.max(width, 480) * 420;
      return;
    }
    const xs = pins.map((p) => mercatorX(p.lng));
    const ys = pins.map((p) => mercatorY(p.lat));
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    mapView.cx = ((minX + maxX) / 2) * 360 - 180;
    mapView.cy = mercatorLat((minY + maxY) / 2);
    const dx = Math.max(maxX - minX, 0.00012);
    const dy = Math.max(maxY - minY, 0.00012);
    mapView.scale = Math.min(width / (dx * 1.6), height / (dy * 1.6));
    mapView.scale = Math.max(18000, Math.min(mapView.scale, 900000));
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

  function mapSvg(pins, width, height) {
    const w = Math.max(320, width);
    const h = Math.max(280, height);
    const grid = [];
    for (let i = 0; i <= 8; i += 1) {
      grid.push(`<line class="map-grid" x1="${(w / 8) * i}" y1="0" x2="${(w / 8) * i}" y2="${h}" />`);
      grid.push(`<line class="map-grid" x1="0" y1="${(h / 8) * i}" x2="${w}" y2="${(h / 8) * i}" />`);
    }
    const markers = pins.map((pin) => {
      const { x, y } = project(pin.lat, pin.lng, w, h);
      if (x < -40 || y < -40 || x > w + 40 || y > h + 40) return '';
      const active = Number(pin.placeId) === Number(state.placeId) ? ' is-active' : '';
      return `
        <g class="pin is-mine${active}" data-place-id="${escapeHtml(String(pin.placeId))}"
          transform="translate(${x.toFixed(1)} ${y.toFixed(1)})">
          <circle class="pin-dot" cx="0" cy="-10" r="7"/>
          ${active ? `<text class="pin-label" x="10" y="-6">${escapeHtml(pin.placeLabel || 'Pin')}</text>` : ''}
        </g>`;
    }).join('');
    return `
      <svg class="map-svg" id="mapSvg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice"
        role="img" aria-label="Map of places you have pinned">
        <ellipse class="map-water" cx="${w * 0.18}" cy="${h * 0.42}" rx="${w * 0.22}" ry="${h * 0.38}" />
        <ellipse class="map-water" cx="${w * 0.86}" cy="${h * 0.7}" rx="${w * 0.2}" ry="${h * 0.28}" />
        ${grid.join('')}
        ${markers}
      </svg>`;
  }

  function chatHtml(place, messages) {
    if (!place) {
      return `
        <div class="chat-empty">
          <h2>Same-place chat</h2>
          <p>Pin a location you were at. Anyone else who pinned within about 100 meters joins this room.</p>
          <p class="muted">Exact GPS stays private — other people only see the shared place.</p>
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
    return `
      <div class="chat-head">
        <h2>${escapeHtml(place.label)}</h2>
        <p class="muted">${place.visitorCount} ${place.visitorCount === 1 ? 'person was' : 'people were'} here
          · ~${Number(place.approxLat).toFixed(3)}, ${Number(place.approxLng).toFixed(3)}</p>
        <div class="visitors">${visitors}</div>
      </div>
      <div class="thread" id="thread">${msgs || '<p class="muted">No messages yet. Say hello.</p>'}</div>
      <form class="compose" id="compose">
        <input id="msg" maxlength="2000" autocomplete="off" placeholder="Message people who were here…" />
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
      document.body.appendChild(overlay);
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
          <h1>Pinpoint</h1>
          <p class="lead">${signup ? 'Create an account to drop pins and chat with people who were at the same spot.' : 'Pin where you were. Chat with people who were there too.'}</p>
          ${signup ? '<label>Name<input id="name" autocomplete="name" /></label>' : ''}
          <label>Email<input id="email" type="email" autocomplete="username" /></label>
          <label>Password<input id="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" /></label>
          <button class="primary" type="button" id="submit">${signup ? 'Create account' : 'Sign in'}</button>
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
    app.querySelector('#submit').onclick = async () => {
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
    state.flash = `Pinned ${place.label}. You can chat with ${place.visitorCount} ${place.visitorCount === 1 ? 'person who was' : 'people who were'} here.`;
    await renderApp();
  }

  async function openChat(placeId) {
    stopPoll();
    state.placeId = placeId;
    app.querySelectorAll('[data-open-place]').forEach((btn) => {
      btn.classList.toggle('is-active', Number(btn.getAttribute('data-open-place')) === Number(placeId));
    });
    app.querySelectorAll('[data-place-id]').forEach((g) => {
      g.classList.toggle('is-active', Number(g.getAttribute('data-place-id')) === Number(placeId));
    });
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
      if (Number(state.placeId) !== Number(placeId) || !state.user) {
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
    const pinRows = places.length
      ? places.map((p) => `
          <button type="button" class="pin-row${Number(p.id) === Number(state.placeId) ? ' is-active' : ''}"
            data-open-place="${p.id}">
            <strong>${escapeHtml(p.label)}</strong>
            <small>${p.visitorCount} here · last visit ${escapeHtml(formatTime(p.lastVisitedAt))}</small>
          </button>`).join('')
      : '<p class="muted">No pins yet. Use GPS, click the map, or check in at a landmark.</p>';
    const landmarkBtns = landmarks.map((s) => (
      `<button type="button" data-landmark="${escapeHtml(s.key)}">${escapeHtml(s.label)}</button>`
    )).join('');

    app.innerHTML = `
      <div class="shell">
        <header class="topbar">
          <div class="brand">Pinpoint</div>
          <div class="topbar-actions">
            <span class="who">${escapeHtml(state.user.name)}</span>
            <button type="button" class="primary" id="gps">Pin my location</button>
            <button type="button" class="ghost" id="logout">Sign out</button>
          </div>
        </header>
        ${flash}
        <div class="landmarks"><span class="muted">Check in:</span>${landmarkBtns}</div>
        <div class="layout">
          <section class="map-col">
            <div class="map-wrap" id="mapWrap">
              ${mapSvg(pins, 640, 360)}
              <div class="map-tools">
                <button type="button" id="zoomIn" aria-label="Zoom in">+</button>
                <button type="button" id="zoomOut" aria-label="Zoom out">−</button>
                <button type="button" id="fit">Fit</button>
              </div>
              <p class="map-hint">Click the map to drop a pin · gold marker is the open chat</p>
            </div>
            <div class="pin-list">
              <h3>Places you were</h3>
              ${pinRows}
            </div>
          </section>
          <section class="chat-col" id="chatCol">${chatHtml(null, [])}</section>
        </div>
      </div>`;

    const mapWrap = document.getElementById('mapWrap');
    const redraw = () => {
      const w = mapWrap?.clientWidth || 640;
      const h = mapWrap?.clientHeight || 360;
      const svg = mapSvg(pins, w, h);
      const old = mapWrap.querySelector('#mapSvg');
      const tools = mapWrap.querySelector('.map-tools');
      const hint = mapWrap.querySelector('.map-hint');
      if (old) old.outerHTML = svg;
      if (tools) mapWrap.appendChild(tools);
      if (hint) mapWrap.appendChild(hint);
      wirePins();
    };
    const wirePins = () => {
      app.querySelectorAll('[data-place-id]').forEach((g) => {
        g.onclick = (ev) => {
          ev.stopPropagation();
          void openChat(Number(g.getAttribute('data-place-id')));
        };
      });
    };
    document.getElementById('zoomIn').onclick = () => {
      mapView.scale = Math.min(mapView.scale * 1.28, 1_200_000);
      redraw();
    };
    document.getElementById('zoomOut').onclick = () => {
      mapView.scale = Math.max(mapView.scale / 1.28, 8000);
      redraw();
    };
    document.getElementById('fit').onclick = () => {
      fitMap(pins, mapWrap.clientWidth, mapWrap.clientHeight);
      redraw();
    };
    document.getElementById('logout').onclick = async () => {
      try { await api('/api/logout', { method: 'POST', body: '{}' }); } catch { /* ignore */ }
      state.user = null;
      state.csrf = null;
      state.placeId = null;
      renderAuth();
    };
    document.getElementById('gps').onclick = async () => {
      try {
        const geo = await new Promise((resolve, reject) => {
          if (!navigator.geolocation) return reject(new Error('This browser cannot share a location'));
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
        state.flash = `${e.message}. Click the map or check in at a landmark instead.`;
        await renderApp();
      }
    };
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

    let dragging = null;
    mapWrap.addEventListener('pointerdown', (ev) => {
      if (ev.target.closest('[data-place-id]')) return;
      dragging = { x: ev.clientX, y: ev.clientY, moved: false };
      mapWrap.setPointerCapture(ev.pointerId);
    });
    mapWrap.addEventListener('pointermove', (ev) => {
      if (!dragging) return;
      const dx = ev.clientX - dragging.x;
      const dy = ev.clientY - dragging.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragging.moved = true;
      if (!dragging.moved) return;
      const origin = unproject(mapWrap.clientWidth / 2 - dx, mapWrap.clientHeight / 2 - dy, mapWrap.clientWidth, mapWrap.clientHeight);
      mapView.cx = origin.lng;
      mapView.cy = origin.lat;
      dragging.x = ev.clientX;
      dragging.y = ev.clientY;
      redraw();
    });
    mapWrap.addEventListener('pointerup', async (ev) => {
      const wasDrag = dragging?.moved;
      dragging = null;
      if (wasDrag) return;
      if (ev.target.closest('[data-place-id], .map-tools, button')) return;
      const rect = mapWrap.getBoundingClientRect();
      const geo = unproject(ev.clientX - rect.left, ev.clientY - rect.top, rect.width, rect.height);
      if (!Number.isFinite(geo.lat) || !Number.isFinite(geo.lng)) return;
      const label = await promptPin(geo);
      if (label == null) return;
      try { await dropPin({ lat: geo.lat, lng: geo.lng, label }); }
      catch (e) { state.flash = e.message; await renderApp(); }
    });
    mapWrap.addEventListener('wheel', (ev) => {
      ev.preventDefault();
      mapView.scale = Math.max(8000, Math.min(mapView.scale * (ev.deltaY > 0 ? 1 / 1.12 : 1.12), 1_200_000));
      redraw();
    }, { passive: false });

    wirePins();
    if (state.placeId) await openChat(state.placeId);
    else if (places[0]) await openChat(places[0].id);
    requestAnimationFrame(() => {
      if (!mapWrap) return;
      fitMap(pins, mapWrap.clientWidth, mapWrap.clientHeight);
      redraw();
    });
  }

  async function boot() {
    try {
      const cfg = await api('/api/security-config');
      state.cookieOnlyAuth = !!cfg.cookieOnlyAuth;
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
