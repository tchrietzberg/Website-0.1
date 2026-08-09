(() => {
  const TOKEN_KEY = 'billing_session';
  const state = {
    token: null,
    csrf: null,
    user: null,
    view: 'matters',
    matters: [],
    users: [],
    clients: [],
    settings: null,
    matterId: null,
    matterSearch: { q: '' },
    showCreateMatter: false,
    focusTimeEntry: false,
  };

  function canCreateMatter(user) {
    return !!user && ['admin', 'billing_clerk', 'attorney', 'paralegal'].includes(user.role);
  }

  const $ = (sel, el = document) => el.querySelector(sel);
  const main = $('#main');
  const nav = $('#nav');
  const userbar = $('#userbar');
  const sidebar = $('#sidebar');
  const sidebarActions = $('#sidebarActions');
  const appEl = $('#app');

  try { localStorage.removeItem('billing_token'); } catch { /* ignore */ }
  try { state.token = sessionStorage.getItem(TOKEN_KEY) || null; } catch { state.token = null; }

  function persistSession(token, csrf) {
    if (token) {
      state.token = token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
    }
    if (csrf) state.csrf = csrf;
  }

  function clearSession() {
    state.token = null;
    state.csrf = null;
    state.user = null;
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  function isPublicAuthPath(path) {
    const p = String(path || '').split('?')[0];
    return [
      '/api/login',
      '/api/me',
      '/api/auth/token-info',
      '/api/auth/set-password',
      '/api/password-reset/request',
      '/api/login/magic/request',
      '/api/login/magic/confirm',
    ].includes(p);
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    if (state.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !isPublicAuthPath(path)) {
      headers['X-CSRF-Token'] = state.csrf;
    }
    const res = await fetch(path, { ...opts, method, headers, credentials: 'include' });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (data && data.csrf) state.csrf = data.csrf;
      if (data && data.token) persistSession(data.token, data.csrf || state.csrf);
      if (!res.ok) {
        if (res.status === 401 && !isPublicAuthPath(path)) {
          clearSession();
        }
        const err = new Error(data.message || data.error || res.statusText);
        err.code = data.error;
        err.payload = data;
        throw err;
      }
      return data;
    }
    if (!res.ok) throw new Error(await res.text());
    return res;
  }

  function money(cents) {
    const n = Number(cents || 0);
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return `${sign}$${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /** Core identity fields stay required in layout but are not listed in Manage fields. */
  function isCoreIdentityField(field) {
    const key = field?.fieldKey || field?.key || '';
    return key === 'std:number' || key === 'std:name';
  }

  function fieldMgmtRows(fields) {
    const rows = (fields || []).filter((f) => !isCoreIdentityField(f));
    if (!rows.length) return '<p class="muted">No managed fields</p>';
    return rows.map((f) => `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(f.kind)}${f.removable ? '' : ' · required'}</span>
        </div>
        ${f.removable
          ? `<button type="button" data-del-matter-field="${escapeHtml(f.fieldKey)}">Delete</button>`
          : ''}
      </div>`).join('');
  }

  function typeFieldMgmtRows(fields, delAttr = 'data-del-type-field') {
    const rows = (fields || []).filter((f) => !isCoreIdentityField(f));
    if (!rows.length) return '<p class="muted">No managed fields</p>';
    return rows.map((f) => `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(f.kind)}${f.removable ? '' : ' · required'}</span>
        </div>
        ${f.removable
          ? `<button type="button" ${delAttr}="${escapeHtml(f.fieldKey)}">Delete</button>`
          : ''}
      </div>`).join('');
  }

  /** Field formatters available when adding default / custom record fields. */
  const FIELD_FORMATTERS = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Text area' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'select', label: 'Select' },
    { value: 'checkbox', label: 'Checkbox' },
  ];

  function fieldFormatterOptions(selected = 'text') {
    return FIELD_FORMATTERS.map((f) =>
      `<option value="${f.value}" ${f.value === selected ? 'selected' : ''}>${f.label}</option>`
    ).join('');
  }

  /** Manage the single Default record-type layout (used on Settings). */
  async function bindDefaultFieldsEditor({ bodyEl, msgEl, recordTypeKey = 'default' } = {}) {
    if (!bodyEl) return;
    const key = recordTypeKey || 'default';
    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };

    const render = async () => {
      const typeLayout = await api(`/api/record-types/${encodeURIComponent(key)}/layout`);
      bodyEl.innerHTML = `
        <div class="field-mgmt-list">
          ${typeFieldMgmtRows(typeLayout.fields)}
        </div>
        ${(typeLayout.availableStandardFields || []).length ? `
        <form id="addTypeStandardForm" class="field-mgmt-add">
          <label>Add default field
            <select name="fieldKey" required>
              ${typeLayout.availableStandardFields.map((f) =>
                `<option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`).join('')}
            </select>
          </label>
          <button class="primary" type="submit">Add field</button>
        </form>` : '<p class="muted">All optional default fields are on this layout.</p>'}
        <form id="typeFieldForm" class="grid two">
          <label>Custom field label
            <input name="label" required placeholder="Case stage" />
          </label>
          <label>Formatter
            <select name="fieldType">
              ${fieldFormatterOptions('text')}
            </select>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add default field formatter</button>
          </div>
        </form>`;

      bodyEl.querySelectorAll('[data-del-type-field]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(
              `/api/record-types/${encodeURIComponent(key)}/layout-fields?fieldKey=${encodeURIComponent(btn.dataset.delTypeField)}`,
              { method: 'DELETE' }
            );
            setMsg('');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      });
      const addStdType = bodyEl.querySelector('#addTypeStandardForm');
      if (addStdType) {
        addStdType.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(addStdType);
          try {
            await api(`/api/record-types/${encodeURIComponent(key)}/standard-fields`, {
              method: 'POST',
              body: JSON.stringify({ fieldKey: fd.get('fieldKey') }),
            });
            setMsg('<div class="ok-banner">Default field added.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
      const typeFieldForm = bodyEl.querySelector('#typeFieldForm');
      if (typeFieldForm) {
        typeFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(typeFieldForm);
          try {
            await api('/api/custom-fields', {
              method: 'POST',
              body: JSON.stringify({
                label: fd.get('label'),
                fieldType: fd.get('fieldType'),
                recordTypeKey: key,
              }),
            });
            setMsg('<div class="ok-banner">Default field formatter added.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };

    await render();
  }

  function matterSearchText(m, { hideNumber = false } = {}) {
    return [
      hideNumber ? null : m.number,
      m.name,
      m.client_name,
      m.status,
      m.attorney_name,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function renderMatterPicker({
    name = 'matterId',
    selectedId = null,
    matters = [],
    hideNumber = false,
  } = {}) {
    const selected = matters.find((m) => Number(m.id) === Number(selectedId)) || null;
    const placeholder = hideNumber
      ? 'Search matters by name or client…'
      : 'Search matters by number, name, or client…';
    return `
      <div class="matter-picker" data-matter-picker data-hide-number="${hideNumber ? '1' : '0'}">
        <input type="hidden" name="${name}" value="${selected ? selected.id : ''}" data-matter-id />
        <button type="button" class="matter-picker-trigger" data-matter-trigger
          aria-haspopup="listbox" aria-expanded="false">
          <span class="matter-picker-value" data-matter-label>
            ${selected ? `
              ${hideNumber ? '' : `<strong>${escapeHtml(selected.number)}</strong>`}
              <span>${escapeHtml(selected.name)}</span>
              ${selected.client_name ? `<small>${escapeHtml(selected.client_name)}</small>` : ''}
            ` : `
              <span class="matter-picker-placeholder">${placeholder}</span>
            `}
          </span>
          <span class="matter-picker-chevron" aria-hidden="true">▾</span>
        </button>
        <div class="matter-picker-panel" data-matter-panel hidden>
          <input type="search" class="matter-picker-search" data-matter-search
            placeholder="Type to filter matters…" autocomplete="off" aria-label="Search matters" />
          <ul class="matter-picker-list" data-matter-list role="listbox"></ul>
          <p class="matter-picker-empty muted" data-matter-empty hidden>No matters match your search</p>
        </div>
      </div>`;
  }

  let matterPickerDocBound = false;
  function ensureMatterPickerDocClose() {
    if (matterPickerDocBound) return;
    matterPickerDocBound = true;
    document.addEventListener('click', (ev) => {
      document.querySelectorAll('[data-matter-picker].is-open').forEach((openPicker) => {
        if (!openPicker.contains(ev.target)) {
          const openPanel = openPicker.querySelector('[data-matter-panel]');
          const openTrigger = openPicker.querySelector('[data-matter-trigger]');
          if (openPanel) openPanel.hidden = true;
          if (openTrigger) openTrigger.setAttribute('aria-expanded', 'false');
          openPicker.classList.remove('is-open');
        }
      });
    });
  }

  function wireMatterPicker(scopeEl, { matters = [], hideNumber = false } = {}) {
    const picker = scopeEl.querySelector('[data-matter-picker]');
    if (!picker) return null;
    ensureMatterPickerDocClose();
    const hideNum = hideNumber || picker.dataset.hideNumber === '1';
    const placeholder = hideNum
      ? 'Search matters by name or client…'
      : 'Search matters by number, name, or client…';
    const trigger = picker.querySelector('[data-matter-trigger]');
    const panel = picker.querySelector('[data-matter-panel]');
    const search = picker.querySelector('[data-matter-search]');
    const list = picker.querySelector('[data-matter-list]');
    const empty = picker.querySelector('[data-matter-empty]');
    const hidden = picker.querySelector('[data-matter-id]');
    const label = picker.querySelector('[data-matter-label]');
    let activeIndex = -1;
    let filtered = matters.slice();

    function setSelected(m) {
      hidden.value = m ? String(m.id) : '';
      if (!m) {
        label.innerHTML = `<span class="matter-picker-placeholder">${placeholder}</span>`;
      } else {
        label.innerHTML = `
          ${hideNum ? '' : `<strong>${escapeHtml(m.number)}</strong>`}
          <span>${escapeHtml(m.name)}</span>
          ${m.client_name ? `<small>${escapeHtml(m.client_name)}</small>` : ''}`;
      }
      picker.classList.toggle('has-value', !!m);
      trigger.classList.remove('is-invalid');
    }

    function close() {
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      picker.classList.remove('is-open');
      activeIndex = -1;
    }

    function open() {
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      picker.classList.add('is-open');
      search.value = '';
      renderList('');
      setTimeout(() => search.focus(), 0);
    }

    function renderList(q) {
      const needle = String(q || '').trim().toLowerCase();
      filtered = !needle
        ? matters.slice(0, 80)
        : matters.filter((m) => matterSearchText(m, { hideNumber: hideNum }).includes(needle)).slice(0, 80);
      activeIndex = filtered.length ? 0 : -1;
      empty.hidden = filtered.length > 0;
      list.innerHTML = filtered.map((m, i) => `
        <li role="option" class="matter-picker-option ${i === activeIndex ? 'is-active' : ''}"
          data-id="${m.id}" aria-selected="${i === activeIndex ? 'true' : 'false'}">
          ${hideNum ? '' : `<strong>${escapeHtml(m.number)}</strong>`}
          <span>${escapeHtml(m.name)}</span>
          <small>${escapeHtml(m.client_name || '—')}${m.status ? ` · ${escapeHtml(m.status)}` : ''}</small>
        </li>`).join('');
      list.querySelectorAll('[data-id]').forEach((el) => {
        el.onmousedown = (ev) => {
          ev.preventDefault();
          const m = matters.find((x) => Number(x.id) === Number(el.dataset.id));
          if (m) {
            setSelected(m);
            close();
          }
        };
      });
    }

    function moveActive(delta) {
      if (!filtered.length) return;
      activeIndex = (activeIndex + delta + filtered.length) % filtered.length;
      list.querySelectorAll('.matter-picker-option').forEach((el, i) => {
        el.classList.toggle('is-active', i === activeIndex);
        el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        if (i === activeIndex) el.scrollIntoView({ block: 'nearest' });
      });
    }

    trigger.onclick = (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (panel.hidden) open();
      else close();
    };
    panel.addEventListener('click', (ev) => ev.stopPropagation());
    search.oninput = () => renderList(search.value);
    search.onkeydown = (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moveActive(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
        ev.stopPropagation();
        if (activeIndex >= 0 && filtered[activeIndex]) {
          setSelected(filtered[activeIndex]);
          close();
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        close();
        trigger.focus();
      }
    };
    // Prevent Enter in the filter box from submitting the parent time/billing form
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') ev.preventDefault();
    });

    return {
      getValue: () => (hidden.value ? Number(hidden.value) : null),
      setInvalid: (on) => trigger.classList.toggle('is-invalid', !!on),
      focus: () => open(),
    };
  }

  function formatDuration(mins, format) {
    const n = Number(mins) || 0;
    const fmt = format || state.settings?.durationFormat || 'decimal';
    const neg = n < 0;
    const abs = Math.abs(n);
    if (fmt === 'decimal') {
      const hundredths = Math.trunc((abs * 100 + 30) / 60); // half-up, matches server
      return `${neg ? '-' : ''}${(hundredths / 100).toFixed(2)}`;
    }
    const totalSec = abs * 60;
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (x) => String(x).padStart(2, '0');
    const core = fmt === 'hms' ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}`;
    return neg ? `-${core}` : core;
  }

  function roundModeLabel(id) {
    return ({
      up: 'Round up to',
      nearest: 'Round to the Nearest',
      down: 'Round Down',
      none: 'Do Not Round',
    })[id] || id;
  }

  function clearAuthTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    if (!params.has('auth_token')) return;
    params.delete('auth_token');
    const q = params.toString();
    window.history.replaceState({}, '', `${window.location.pathname}${q ? `?${q}` : ''}${window.location.hash || ''}`);
  }

  async function finishAuthSession(data) {
    persistSession(data.token, data.csrf);
    state.user = data.user;
    clearAuthTokenFromUrl();
    document.body.classList.remove('login-mode');
    if (appEl) appEl.classList.remove('login-mode');
    await refreshRefs();
    renderShell();
    renderView();
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    const authToken = params.get('auth_token');
    if (authToken) {
      return renderAuthToken(authToken);
    }
    try {
      const me = await api('/api/me');
      state.user = me.user;
      state.csrf = me.csrf || null;
      if (!me.user) clearSession();
    } catch {
      clearSession();
    }
    if (!state.user) return renderLogin();
    await refreshRefs();
    if (window.location.hash === '#settings' || params.get('onedrive')) {
      state.view = 'settings';
    }
    renderShell();
    renderView();
  }

  async function refreshRefs() {
    const [matters, users, clients, settings] = await Promise.all([
      api('/api/matters'),
      api('/api/users'),
      api('/api/clients'),
      api('/api/settings'),
    ]);
    state.matters = matters;
    state.users = users;
    state.clients = clients;
    state.settings = settings;
  }

  function enterLoginChrome() {
    if (sidebar) sidebar.hidden = true;
    if (appEl) {
      appEl.classList.remove('app-shell');
      appEl.classList.add('login-mode');
    }
    document.body.classList.add('login-mode');
    if (nav) nav.innerHTML = '';
    if (userbar) userbar.textContent = '';
    if (sidebarActions) sidebarActions.innerHTML = '';
  }

  function renderLogin(mode = 'email') {
    enterLoginChrome();
    const panel = mode === 'forgot'
      ? `
          <p class="login-brand">Firm Billing</p>
          <p class="login-lead">We’ll email you a link to reset your password</p>
          <label class="login-field">Work email
            <input id="email" type="email" autocomplete="username" placeholder="you@firm.example" />
          </label>
          <button class="primary login-submit" id="resetBtn" type="button">Email reset link</button>
          <p class="login-hint"><button type="button" class="linkish" id="backToLogin">Back to sign in</button></p>
          <div id="loginErr"></div>`
      : mode === 'password'
        ? `
          <p class="login-brand">Firm Billing</p>
          <p class="login-lead">Sign in with email and password</p>
          <label class="login-field">Work email
            <input id="email" type="email" autocomplete="username"
              placeholder="avery@firm.example" value="avery@firm.example" />
          </label>
          <label class="login-field">Password
            <input id="password" type="password" autocomplete="current-password"
              placeholder="Password" value="demo-change-me" />
          </label>
          <button class="primary login-submit" id="loginBtn" type="button">Sign in</button>
          <div class="login-alt-links">
            <button type="button" class="linkish" id="magicLink">Email me a sign-in link</button>
            <button type="button" class="linkish" id="forgotLink">Forgot password</button>
          </div>
          <div id="loginErr"></div>
          <p class="login-hint">Demo · avery@firm.example / demo-change-me</p>`
        : `
          <p class="login-brand">Firm Billing</p>
          <p class="login-lead">Enter your work email — we’ll send a sign-in link</p>
          <label class="login-field">Work email
            <input id="email" type="email" autocomplete="username"
              placeholder="you@firm.example" value="avery@firm.example" />
          </label>
          <button class="primary login-submit" id="magicBtn" type="button">Email me a sign-in link</button>
          <div class="login-alt-links">
            <button type="button" class="linkish" id="passwordLink">Use password instead</button>
            <button type="button" class="linkish" id="forgotLink">Forgot password</button>
          </div>
          <div id="loginErr"></div>
          <p class="login-hint">Check your inbox for a one-time link. No setup needed on your side.</p>`;

    main.innerHTML = `<div class="login-stage"><div class="login-panel">${panel}</div></div>`;

    const err = (msg) => {
      const el = $('#loginErr');
      if (el) el.innerHTML = msg ? `<div class="error">${escapeHtml(msg)}</div>` : '';
    };
    const ok = (msg) => {
      const el = $('#loginErr');
      if (el) el.innerHTML = msg ? `<div class="ok-banner">${escapeHtml(msg)}</div>` : '';
    };

    const back = $('#backToLogin');
    if (back) back.onclick = () => renderLogin('email');
    const forgot = $('#forgotLink');
    if (forgot) forgot.onclick = () => renderLogin('forgot');
    const magic = $('#magicLink');
    if (magic) magic.onclick = () => renderLogin('email');
    const passwordLink = $('#passwordLink');
    if (passwordLink) passwordLink.onclick = () => renderLogin('password');

    if (mode === 'forgot') {
      $('#resetBtn').onclick = async () => {
        try {
          $('#resetBtn').disabled = true;
          err('');
          const data = await api('/api/password-reset/request', {
            method: 'POST',
            body: JSON.stringify({ email: $('#email').value.trim() }),
          });
          ok(data.message || 'Check your email for a reset link.');
          $('#resetBtn').disabled = false;
        } catch (e) {
          $('#resetBtn').disabled = false;
          err(e.message);
        }
      };
      return;
    }

    if (mode === 'email') {
      const sendMagic = async () => {
        try {
          $('#magicBtn').disabled = true;
          err('');
          const data = await api('/api/login/magic/request', {
            method: 'POST',
            body: JSON.stringify({ email: $('#email').value.trim() }),
          });
          ok(data.message || 'Check your email for a sign-in link.');
          $('#magicBtn').disabled = false;
        } catch (e) {
          $('#magicBtn').disabled = false;
          err(e.message);
        }
      };
      $('#magicBtn').onclick = sendMagic;
      $('#email').addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') {
          ev.preventDefault();
          sendMagic();
        }
      });
      return;
    }

    const submit = async () => {
      try {
        $('#loginBtn').disabled = true;
        err('');
        const data = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({
            email: $('#email').value.trim(),
            password: $('#password').value,
          }),
        });
        await finishAuthSession(data);
      } catch (e) {
        $('#loginBtn').disabled = false;
        err(e.message);
      }
    };
    $('#loginBtn').onclick = submit;
    $('#password').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      }
    });
    $('#email').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        $('#password').focus();
      }
    });
  }

  async function renderAuthToken(rawToken) {
    enterLoginChrome();
    main.innerHTML = `
      <div class="login-stage">
        <div class="login-panel">
          <p class="login-brand">Firm Billing</p>
          <p class="login-lead">Checking secure link…</p>
          <div id="loginErr"></div>
        </div>
      </div>`;
    try {
      const info = await api(`/api/auth/token-info?token=${encodeURIComponent(rawToken)}`);
      if (!info.valid) {
        main.innerHTML = `
          <div class="login-stage">
            <div class="login-panel">
              <p class="login-brand">Firm Billing</p>
              <p class="login-lead">This link is invalid or has expired.</p>
              <button class="primary login-submit" id="backToLogin" type="button">Back to sign in</button>
              <div id="loginErr"></div>
            </div>
          </div>`;
        clearAuthTokenFromUrl();
        $('#backToLogin').onclick = () => renderLogin('password');
        return;
      }

      if (info.purpose === 'magic_login') {
        main.innerHTML = `
          <div class="login-stage">
            <div class="login-panel">
              <p class="login-brand">Firm Billing</p>
              <p class="login-lead">Signing you in…</p>
              <div id="loginErr"></div>
            </div>
          </div>`;
        const data = await api('/api/login/magic/confirm', {
          method: 'POST',
          body: JSON.stringify({ token: rawToken }),
        });
        await finishAuthSession(data);
        return;
      }

      const title = info.purpose === 'invite'
        ? 'Set your password to finish joining'
        : 'Choose a new password';
      main.innerHTML = `
        <div class="login-stage">
          <div class="login-panel">
            <p class="login-brand">Firm Billing</p>
            <p class="login-lead">${escapeHtml(title)}</p>
            <p class="login-hint">${escapeHtml(info.name || '')} · ${escapeHtml(info.emailHint || '')}</p>
            <label class="login-field">New password
              <input id="password" type="password" autocomplete="new-password"
                minlength="10" placeholder="At least 10 characters" />
            </label>
            <label class="login-field">Confirm password
              <input id="password2" type="password" autocomplete="new-password"
                minlength="10" placeholder="Repeat password" />
            </label>
            <button class="primary login-submit" id="setPwdBtn" type="button">Save and sign in</button>
            <div id="loginErr"></div>
          </div>
        </div>`;
      const err = (msg) => {
        $('#loginErr').innerHTML = msg ? `<div class="error">${escapeHtml(msg)}</div>` : '';
      };
      $('#setPwdBtn').onclick = async () => {
        const password = $('#password').value;
        const password2 = $('#password2').value;
        if (password.length < 10) return err('Password must be at least 10 characters');
        if (password !== password2) return err('Passwords do not match');
        try {
          $('#setPwdBtn').disabled = true;
          err('');
          const data = await api('/api/auth/set-password', {
            method: 'POST',
            body: JSON.stringify({ token: rawToken, password }),
          });
          await finishAuthSession(data);
        } catch (e) {
          $('#setPwdBtn').disabled = false;
          err(e.message);
        }
      };
    } catch (e) {
      main.innerHTML = `
        <div class="login-stage">
          <div class="login-panel">
            <p class="login-brand">Firm Billing</p>
            <p class="login-lead">Could not open this link.</p>
            <div class="error">${escapeHtml(e.message)}</div>
            <button class="primary login-submit" id="backToLogin" type="button">Back to sign in</button>
          </div>
        </div>`;
      clearAuthTokenFromUrl();
      $('#backToLogin').onclick = () => renderLogin('password');
    }
  }

  function goAddMatter() {
    if (!canCreateMatter(state.user)) {
      state.view = 'matters';
      state.matterId = null;
      renderShell();
      renderView();
      return;
    }
    state.showCreateMatter = true;
    state.view = 'matters';
    state.matterId = null;
    renderShell();
    renderView();
  }

  function goAddTimeEntry() {
    state.focusTimeEntry = true;
    state.view = 'time';
    state.matterId = null;
    state.showCreateMatter = false;
    renderShell();
    renderView();
  }

  function renderShell() {
    if (sidebar) sidebar.hidden = false;
    document.body.classList.remove('login-mode');
    if (appEl) {
      appEl.classList.remove('login-mode');
      appEl.classList.add('app-shell');
    }
    const items = [
      ['matters', 'Matters', 'M', 'Matters & search'],
      ['time', 'Time Entry', 'T', 'Log & review time'],
      ['reports', 'Reports', 'R', 'Matters & lodestar'],
      ['settings', 'Settings', 'S', 'Firm preferences'],
    ];
    // WIP / pre-bill / approvals / payments UI paused for now
    if (['approvals', 'payments', 'audit', 'billing'].includes(state.view)) {
      state.view = 'matters';
    }
    const activeView = state.view === 'matter' ? 'matters' : state.view;

    if (sidebarActions) {
      sidebarActions.innerHTML = `
        <p class="sidebar-label">Quick actions</p>
        ${canCreateMatter(state.user)
          ? `<button type="button" class="sidebar-action primary" id="sideAddMatter">
              <span class="sidebar-action-mark" aria-hidden="true">+</span>
              <span class="sidebar-action-text">
                <strong>Create Matter</strong>
                <small>Open create + search</small>
              </span>
            </button>`
          : ''}
        <button type="button" class="sidebar-action secondary" id="sideAddTime">
          <span class="sidebar-action-mark" aria-hidden="true">T</span>
          <span class="sidebar-action-text">
            <strong>Add Time Entry</strong>
            <small>Log time on a matter</small>
          </span>
        </button>`;
      const sideAddMatter = $('#sideAddMatter');
      if (sideAddMatter) sideAddMatter.onclick = () => goAddMatter();
      const sideAddTime = $('#sideAddTime');
      if (sideAddTime) sideAddTime.onclick = () => goAddTimeEntry();
    }

    nav.innerHTML = `
      <p class="sidebar-label">Navigate</p>
      ${items.map(([id, label, mark, hint]) =>
        `<button type="button" data-view="${id}"
          class="sidebar-action primary sidebar-nav-btn ${activeView === id ? 'active' : ''}">
          <span class="sidebar-action-mark" aria-hidden="true">${mark}</span>
          <span class="sidebar-action-text">
            <strong>${label}</strong>
            <small>${hint}</small>
          </span>
        </button>`
      ).join('')}`;
    nav.querySelectorAll('[data-view]').forEach((b) => {
      b.onclick = () => {
        state.view = b.dataset.view;
        if (state.view !== 'matter') state.matterId = null;
        if (state.view !== 'matters') state.showCreateMatter = false;
        renderShell();
        renderView();
      };
    });
    userbar.innerHTML = `
      <p class="sidebar-label">Signed in</p>
      <div class="who"><strong>${escapeHtml(state.user.name)}</strong><span>${escapeHtml(state.user.role.replace('_', ' '))}</span></div>
      <button type="button" id="logout" class="sidebar-logout">Sign out</button>`;
    $('#logout').onclick = async () => {
      try { await api('/api/logout', { method: 'POST', body: '{}' }); }
      catch { /* still clear local state */ }
      clearSession();
      renderLogin();
    };
  }

  async function renderView() {
    try {
      if (state.view === 'matters') await renderMatters();
      else if (state.view === 'matter') await renderMatterDetail();
      else if (state.view === 'time') await renderTime();
      else if (state.view === 'reports') await renderReports();
      else if (state.view === 'settings') await renderSettings();
      else if (state.view === 'audit') await renderAudit();
      else await renderMatters();
    } catch (e) {
      const msg = e.message === 'forbidden'
        ? 'You do not have access to this section with your current role.'
        : e.message;
      main.innerHTML = `<div class="card"><div class="error">${escapeHtml(msg)}</div></div>`;
    }
  }

  async function openMatter(id) {
    state.matterId = id;
    state.view = 'matter';
    renderShell();
    await renderView();
  }

  async function renderMatters() {
    const params = new URLSearchParams();
    params.set('search', '1'); // indexed Matter Search mode
    if (state.matterSearch.q) params.set('q', state.matterSearch.q);

    const hasQuery = !!state.matterSearch.q;
    const canEdit = canCreateMatter(state.user);

    const [hits, clients, allMatters] = await Promise.all([
      api(`/api/matters?${params}`),
      api('/api/clients'),
      api('/api/matters'), // full list for dropdowns elsewhere; not shown here
    ]);
    state.matters = allMatters;
    state.clients = clients;
    const showCreate = canEdit && state.showCreateMatter;

    main.innerHTML = `
      <div class="card stack page-card">
        <div class="page-head matters-toolbar">
          <h1>${showCreate ? 'Create Matter' : 'Matters'}</h1>
        </div>

        ${showCreate ? `
        <div id="createMatterSection" class="create-matter-panel page-section">
          <form id="newMatterForm" class="create-matter-form">
            <label class="create-matter-label" for="createMatterName">Create Matter</label>
            <div class="create-matter-row">
              <input id="createMatterName" name="name" required
                placeholder="Create Matter" aria-label="Create Matter" />
              <button class="primary" type="submit">Create</button>
              <button type="button" id="cancelCreateMatter">Cancel</button>
            </div>
          </form>
          <div id="newMatterMsg"></div>
        </div>` : ''}

        <div class="page-section">
          <h2>Search matters</h2>
          <form id="matterSearch" class="matter-search-bar">
            <input name="q" value="${state.matterSearch.q || ''}"
              placeholder="Search matters…" aria-label="Search matters" />
            <button class="primary" type="submit">Search</button>
            <button type="button" id="clearSearch">Clear</button>
          </form>
        </div>

        <div class="page-section">
          <h2>Results</h2>
          ${!hasQuery ? '<p class="muted">Enter a search term to query the matter index.</p>' : `
          <div class="table-wrap"><table>
            <thead>
              <tr><th>Number</th><th>Name</th><th>Client</th><th>Status</th><th>Attorney</th></tr>
            </thead>
            <tbody>
              ${hits.map((m) => `
                <tr class="click-row" data-matter="${m.id}">
                  <td><strong>${m.number}</strong></td>
                  <td>${m.name}</td>
                  <td>${m.client_name}</td>
                  <td><span class="pill" data-status="${m.status}">${m.status}</span></td>
                  <td>${m.attorney_name || '—'}</td>
                </tr>`).join('') || '<tr><td colspan="5" class="muted">No indexed matters match</td></tr>'}
            </tbody>
          </table></div>`}
        </div>
      </div>`;

    $('#matterSearch').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      state.matterSearch = { q: String(fd.get('q') || '').trim() };
      await renderMatters();
    };
    $('#clearSearch').onclick = async () => {
      state.matterSearch = { q: '' };
      await renderMatters();
    };
    const cancelCreate = $('#cancelCreateMatter');
    if (cancelCreate) {
      cancelCreate.onclick = async () => {
        state.showCreateMatter = false;
        await renderMatters();
      };
    }
    if (showCreate) {
      const nameInput = $('#createMatterName') || $('#createMatterSection input[name="name"]');
      if (nameInput) {
        setTimeout(() => {
          nameInput.focus();
          const section = $('#createMatterSection');
          if (section && section.scrollIntoView) {
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 0);
      }
    }

    main.querySelectorAll('[data-matter]').forEach((row) => {
      row.onclick = () => openMatter(Number(row.dataset.matter));
    });

    const newMatterForm = $('#newMatterForm');
    if (newMatterForm) {
      newMatterForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(newMatterForm);
        try {
          const page = await api('/api/matters', {
            method: 'POST',
            body: JSON.stringify({ name: fd.get('name') }),
          });
          $('#newMatterMsg').innerHTML = `<div class="ok-banner">Created and indexed ${page.matter.number}.</div>`;
          await refreshRefs();
          state.showCreateMatter = false;
          state.matterSearch = { q: page.matter.number };
          await openMatter(page.matter.id);
        } catch (e) {
          $('#newMatterMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
  }

  function renderFieldInput(field, ctx = {}) {
    const name = field.kind === 'custom' ? `cf_${field.fieldId}` : field.key;
    const val = field.value ?? '';
    const disabled = field.readonly || !ctx.canEdit ? 'disabled' : '';
    const req = field.required ? 'required' : '';

    if (field.key === 'std:client') {
      const opts = (ctx.clients || []).map((c) =>
        `<option value="${c.id}" ${String(val) === String(c.id) ? 'selected' : ''}>${c.name}</option>`
      ).join('');
      return `<select name="${name}" ${disabled} required>${opts}</select>`;
    }
    if (field.key === 'std:matter_type') {
      const label = (ctx.recordTypes || []).find((t) => t.key === val)?.label || val || 'Default';
      return `<input name="${name}" value="${label}" disabled />`;
    }
    if (field.key === 'std:responsible_attorney') {
      const attorneys = (ctx.users || []).filter((u) => u.role === 'attorney' || u.role === 'admin');
      const opts = attorneys.map((u) =>
        `<option value="${u.id}" ${String(val) === String(u.id) ? 'selected' : ''}>${u.name}</option>`
      ).join('');
      return `<select name="${name}" ${disabled}>
        <option value="">—</option>${opts}
      </select>`;
    }

    if (field.type === 'textarea') {
      return `<textarea name="${name}" ${disabled} ${req} rows="3">${val}</textarea>`;
    }
    if (field.type === 'select') {
      const opts = (field.options || []).map((o) =>
        `<option value="${o}" ${String(val) === String(o) ? 'selected' : ''}>${o}</option>`
      ).join('');
      return `<select name="${name}" ${disabled} ${req}>
        <option value=""></option>${opts}
        ${val && !(field.options || []).includes(String(val)) ? `<option value="${val}" selected>${val}</option>` : ''}
      </select>`;
    }
    if (field.type === 'checkbox') {
      return `<input type="checkbox" name="${name}" ${disabled} ${val === '1' || val === 'true' ? 'checked' : ''} />`;
    }
    const inputType = field.type === 'number' ? 'number' : (field.type === 'date' ? 'date' : 'text');
    return `<input type="${inputType}" name="${name}" value="${String(val).replace(/"/g, '&quot;')}" ${disabled} ${req} />`;
  }

  function wireOneDriveBrowser(matterId, onedriveMeta, canEdit) {
    const browserEl = $('#onedriveBrowser');
    const crumbsEl = $('#onedriveCrumbs');
    if (!browserEl) return;
    let parentItemId = null;

    main.querySelectorAll('[data-od-tab]').forEach((tab) => {
      tab.onclick = () => {
        const id = tab.dataset.odTab;
        main.querySelectorAll('[data-od-tab]').forEach((t) => t.classList.toggle('is-active', t === tab));
        main.querySelectorAll('[data-od-pane]').forEach((pane) => {
          const on = pane.dataset.odPane === id;
          pane.hidden = !on;
          pane.classList.toggle('is-active', on);
        });
      };
    });

    async function loadBrowser(parent = null) {
      parentItemId = parent;
      browserEl.innerHTML = '<p class="muted">Loading folder…</p>';
      try {
        const q = parent ? `?parent=${encodeURIComponent(parent)}` : '';
        const data = await api(`/api/matters/${matterId}/onedrive/browser${q}`);
        renderBrowser(data);
      } catch (e) {
        browserEl.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    }

    function renderBrowser(data) {
      if (crumbsEl) {
        crumbsEl.innerHTML = (data.breadcrumbs || []).map((c, i, arr) => {
          const last = i === arr.length - 1;
          if (last) return `<span class="onedrive-crumb is-current">${escapeHtml(c.name)}</span>`;
          return `<button type="button" class="onedrive-crumb" data-od-parent="${c.itemId == null ? '' : escapeHtml(c.itemId)}">${escapeHtml(c.name)}</button>`;
        }).join('<span class="onedrive-crumb-sep">/</span>');
        crumbsEl.querySelectorAll('[data-od-parent]').forEach((btn) => {
          btn.onclick = () => loadBrowser(btn.dataset.odParent || null);
        });
      }

      const items = data.items || [];
      if (!items.length) {
        browserEl.innerHTML = `
          <div class="onedrive-empty">
            <p class="muted">This folder is empty in the legal system cache.</p>
            <p class="hint">${onedriveMeta.graphConfigured
              ? 'Click <strong>Refresh from OneDrive</strong> to pull the latest files and folders.'
              : 'Use <strong>OneDrive view</strong>, configure Graph in Settings, or <strong>Load demo files</strong> to try the browser.'}</p>
          </div>`;
        return;
      }

      browserEl.innerHTML = `
        <div class="onedrive-file-list">
          ${items.map((item) => `
            <div class="onedrive-file-row" data-od-item="${escapeHtml(item.itemId)}" data-od-type="${item.itemType}">
              <span class="onedrive-file-icon onedrive-file-icon-${item.itemType}" aria-hidden="true">${item.itemType === 'folder' ? 'DIR' : 'FILE'}</span>
              <div class="onedrive-file-meta">
                <strong>${escapeHtml(item.name)}</strong>
                <small class="muted">
                  ${item.itemType === 'folder'
                    ? `Folder${item.childCount != null ? ` · ${item.childCount} items` : ''}`
                    : `${item.sizeLabel || 'File'}${item.lastModified ? ` · ${escapeHtml(String(item.lastModified).slice(0, 10))}` : ''}`}
                </small>
              </div>
              <div class="row-actions">
                ${item.itemType === 'folder'
                  ? `<button type="button" data-od-open-folder="${escapeHtml(item.itemId)}">Open</button>`
                  : (item.webUrl
                    ? `<a class="btn" href="${escapeHtml(item.webUrl)}" target="_blank" rel="noopener noreferrer">Open</a>`
                    : '')}
              </div>
            </div>`).join('')}
        </div>`;

      browserEl.querySelectorAll('[data-od-open-folder]').forEach((btn) => {
        btn.onclick = () => loadBrowser(btn.dataset.odOpenFolder);
      });
      browserEl.querySelectorAll('.onedrive-file-row[data-od-type="folder"]').forEach((row) => {
        row.ondblclick = () => loadBrowser(row.dataset.odItem);
      });
    }

    const syncBtn = $('#onedriveSync');
    if (syncBtn) {
      syncBtn.onclick = async () => {
        // Re-check live settings — stale page meta can say "not connected"
        let connected = !!onedriveMeta.graphConfigured;
        try {
          const live = await api('/api/settings');
          connected = !!(live.msGraphConfigured || live.microsoft?.connected);
          state.settings = live;
        } catch { /* keep page meta */ }

        if (!connected) {
          $('#onedriveMsg').innerHTML = `
            <div class="ok-banner">
              Next step: connect Microsoft in Settings (sign in — no tokens to copy).
              <div class="row-actions" style="margin-top:.65rem">
                <button type="button" class="primary" id="goOneDriveSettings">Open Settings → OneDrive</button>
                <button type="button" id="onedriveDemoSeedInline">Load demo files</button>
              </div>
            </div>`;
          const go = $('#goOneDriveSettings');
          if (go) {
            go.onclick = () => {
              state.view = 'settings';
              state.matterId = null;
              renderShell();
              renderView();
            };
          }
          const demoInline = $('#onedriveDemoSeedInline');
          if (demoInline) {
            demoInline.onclick = () => {
              const demoBtn = $('#onedriveDemoSeed');
              if (demoBtn) demoBtn.click();
            };
          }
          return;
        }
        try {
          syncBtn.disabled = true;
          const data = await api(`/api/matters/${matterId}/onedrive/sync`, {
            method: 'POST',
            body: JSON.stringify({ parentItemId }),
          });
          $('#onedriveMsg').innerHTML = '<div class="ok-banner">Folder refreshed from OneDrive.</div>';
          renderBrowser(data);
        } catch (e) {
          const msg = String(e.message || '');
          if (/Connect Microsoft|not configured|Graph token/i.test(msg)) {
            $('#onedriveMsg').innerHTML = `
              <div class="error">
                Microsoft is not connected yet.
                <div class="row-actions" style="margin-top:.65rem">
                  <button type="button" class="primary" id="goOneDriveSettings2">Open Settings → Connect Microsoft</button>
                </div>
              </div>`;
            const go2 = $('#goOneDriveSettings2');
            if (go2) {
              go2.onclick = () => {
                state.view = 'settings';
                state.matterId = null;
                renderShell();
                renderView();
              };
            }
          } else {
            $('#onedriveMsg').innerHTML = `<div class="error">${escapeHtml(msg)}</div>`;
          }
        } finally {
          syncBtn.disabled = false;
        }
      };
    }

    const demoBtn = $('#onedriveDemoSeed');
    if (demoBtn) {
      demoBtn.onclick = async () => {
        try {
          const data = await api(`/api/matters/${matterId}/onedrive/demo-seed`, {
            method: 'POST',
            body: '{}',
          });
          $('#onedriveMsg').innerHTML = '<div class="ok-banner">Demo matter files loaded for browsing.</div>';
          parentItemId = null;
          renderBrowser(data);
        } catch (e) {
          $('#onedriveMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    loadBrowser(null);
  }

  async function renderMatterDetail() {
    if (!state.matterId) {
      state.view = 'matters';
      return renderMatters();
    }
    const [page, recordTypes, clients] = await Promise.all([
      api(`/api/matters/${state.matterId}`),
      api('/api/record-types'),
      api('/api/clients'),
    ]);
    const m = page.matter;
    const canEdit = canCreateMatter(state.user);
    const sections = Object.entries(page.sections || {});
    const fieldCtx = { canEdit, clients, recordTypes, users: state.users };

    main.innerHTML = `
      <div class="card stack">
        <div class="row-actions">
          <button type="button" id="backMatters">← Matters</button>
          <span class="pill">${page.layout.source === 'record' ? 'Record layout' : 'Record-type layout'}</span>
        </div>
        <h1>${m.number}</h1>
        <p class="lead">${m.name}</p>
      </div>

      <form id="matterForm" class="card stack">
        ${sections.map(([section, fields]) => `
          <h2>${section.charAt(0).toUpperCase() + section.slice(1)}</h2>
          <div class="grid two">
            ${fields.map((f) => `
              <label class="${f.width === 'full' ? 'span-all' : ''}">
                ${f.label}${f.scope === 'record' ? ' <span class="muted">(record field)</span>' : ''}
                ${f.scope === 'record_type' ? ' <span class="muted">(type field)</span>' : ''}
                ${renderFieldInput(f, fieldCtx)}
              </label>`).join('')}
          </div>
        `).join('') || '<p class="muted">No layout fields</p>'}
        ${canEdit ? '<div class="row-actions"><button class="primary" type="submit">Save matter</button></div>' : ''}
        <div id="matterMsg"></div>
      </form>

      ${canEdit ? `
      <div class="card stack">
        <h2>Manage fields</h2>
        <p class="hint">Add or delete fields on this matter, or on the default layout for record type <strong>${escapeHtml((page.typeLayout && page.typeLayout.label) || m.matter_type)}</strong>. Matter number and name stay required and are shown in the header.</p>

        <h3>Matter fields</h3>
        <div class="field-mgmt-list">
          ${fieldMgmtRows(page.layoutFields)}
        </div>
        ${(page.availableStandardFields || []).length ? `
        <form id="addStandardFieldForm" class="field-mgmt-add">
          <label>Add field
            <select name="fieldKey" required>
              ${(page.availableStandardFields || []).map((f) =>
                `<option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`).join('')}
            </select>
          </label>
          <button class="primary" type="submit">Add to matter</button>
        </form>` : '<p class="muted">All optional standard fields are on this matter.</p>'}
        <form id="recordFieldForm" class="grid two">
          <label>Custom field label <input name="label" required placeholder="Special billing note" /></label>
          <label>Formatter
            <select name="fieldType">
              ${fieldFormatterOptions('text')}
            </select>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add custom field</button>
            ${page.layout.source !== 'record' ? '<button type="button" id="useRecordLayout">Use default layout</button>' : ''}
          </div>
        </form>
        <div id="matterFieldMsg"></div>
        <p class="hint">Firm-wide default fields are managed in <a href="#settings">Settings</a>.</p>
      </div>` : ''}

      <details class="onedrive-collapse" id="onedriveCard">
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">OneDrive</span>
          <span class="onedrive-collapse-meta muted">
            ${(page.onedrive && page.onedrive.linked)
              ? escapeHtml(page.onedrive.folderName || 'Folder linked')
              : 'Optional · link a matter folder'}
          </span>
        </summary>
        <div class="onedrive-collapse-body stack">
          <p class="hint">Browse or sync a SharePoint/OneDrive folder for this matter.</p>
          ${(page.onedrive && page.onedrive.linked) ? `
            <div class="onedrive-status">
              <span class="pill" data-status="${page.onedrive.status === 'error' ? 'rejected' : 'open'}">${page.onedrive.status === 'error' ? 'Sync error' : 'Linked'}</span>
              <strong>${escapeHtml(page.onedrive.folderName || 'Matter folder')}</strong>
            </div>
            ${page.onedrive.notes ? `<p class="muted">${escapeHtml(page.onedrive.notes)}</p>` : ''}
            <p class="muted">Linked${page.onedrive.linkedByName ? ` by ${escapeHtml(page.onedrive.linkedByName)}` : ''}${page.onedrive.linkedAt ? ` · ${String(page.onedrive.linkedAt).slice(0, 10)}` : ''}${page.onedrive.lastSyncedAt ? ` · Synced ${String(page.onedrive.lastSyncedAt).slice(0, 16).replace('T', ' ')}` : ''}</p>
            ${page.onedrive.lastSyncError ? `<div class="error">${escapeHtml(page.onedrive.lastSyncError)}</div>` : ''}

            <div class="onedrive-tabs" role="tablist">
              <button type="button" class="onedrive-tab is-active" data-od-tab="files">Files</button>
              <button type="button" class="onedrive-tab" data-od-tab="embed">OneDrive view</button>
            </div>

            <div class="onedrive-pane is-active" data-od-pane="files">
              <div class="onedrive-toolbar">
                <nav class="onedrive-crumbs" id="onedriveCrumbs" aria-label="Folder path"></nav>
                <div class="row-actions">
                  ${canEdit ? `<button type="button" class="primary" id="onedriveSync">${page.onedrive.graphConfigured ? 'Refresh from OneDrive' : 'Set up live sync'}</button>` : ''}
                  ${canEdit ? `<button type="button" id="onedriveDemoSeed">Load demo files</button>` : ''}
                  <a class="btn" id="onedriveOpenExternal"
                    href="${escapeHtml(page.onedrive.folderUrl)}" target="_blank" rel="noopener noreferrer">Open in Microsoft</a>
                </div>
              </div>
              <div id="onedriveBrowser" class="onedrive-browser">
                <p class="muted">Loading folder…</p>
              </div>
              ${!page.onedrive.graphConfigured ? `
                <p class="hint">Live sync needs <strong>Settings → Sign in with Microsoft</strong>. Demo files and OneDrive view still work.</p>
              ` : ''}
            </div>

            <div class="onedrive-pane" data-od-pane="embed" hidden>
              <div class="onedrive-embed-wrap">
                <iframe class="onedrive-embed"
                  title="OneDrive folder"
                  src="${escapeHtml(page.onedrive.embedUrl || page.onedrive.folderUrl)}"
                  loading="lazy"
                  referrerpolicy="no-referrer-when-downgrade"
                  allow="fullscreen"></iframe>
              </div>
              <p class="hint">If the embed asks you to sign in, use your Microsoft account. Some tenants block embedding — use <strong>Open in Microsoft</strong>.</p>
            </div>

            ${canEdit ? `
            <div class="row-actions">
              <button type="button" id="onedriveEdit">Update link</button>
              <button type="button" id="onedriveDisconnect">Disconnect</button>
            </div>
            <form id="onedriveForm" class="grid two" hidden>
              <label class="span-all">Folder URL
                <input name="folderUrl" required
                  value="${escapeHtml(page.onedrive.folderUrl || '')}"
                  placeholder="https://…sharepoint.com/… or onedrive.live.com/…" />
              </label>
              <label>Folder name
                <input name="folderName"
                  value="${escapeHtml(page.onedrive.folderName || '')}"
                  placeholder="${escapeHtml(page.onedriveSuggestedName || '')}" />
              </label>
              <label>Notes
                <input name="notes" value="${escapeHtml(page.onedrive.notes || '')}"
                  placeholder="Optional" />
              </label>
              <div class="row-actions span-all">
                <button class="primary" type="submit">Save OneDrive link</button>
                <button type="button" id="onedriveCancelEdit">Cancel</button>
              </div>
            </form>` : ''}
          ` : `
            <p class="muted">No folder linked yet.</p>
            ${canEdit ? `
            <form id="onedriveForm" class="grid two">
              <label class="span-all">Folder URL
                <input name="folderUrl" required
                  placeholder="https://contoso.sharepoint.com/… or https://onedrive.live.com/…" />
              </label>
              <label>Folder name
                <input name="folderName"
                  value="${escapeHtml(page.onedriveSuggestedName || '')}"
                  placeholder="${escapeHtml(page.onedriveSuggestedName || '')}" />
              </label>
              <label>Notes
                <input name="notes" placeholder="Optional" />
              </label>
              <div class="row-actions span-all">
                <button class="primary" type="submit">Link OneDrive folder</button>
              </div>
            </form>` : ''}
          `}
          <div id="onedriveMsg"></div>
        </div>
      </details>`;

    $('#backMatters').onclick = () => {
      state.view = 'matters';
      state.matterId = null;
      renderShell();
      renderView();
    };

    const form = $('#matterForm');
    if (canEdit) {
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const patch = {};
        const customValues = {};
        for (const [key, value] of fd.entries()) {
          if (key.startsWith('cf_')) {
            customValues[key.slice(3)] = value;
          } else if (key === 'std:name') patch.name = value;
          else if (key === 'std:client') patch.clientId = Number(value);
          else if (key === 'std:matter_type') { /* record type is fixed */ }
          else if (key === 'std:status') patch.status = value;
          else if (key === 'std:jurisdiction') patch.jurisdiction = value;
          else if (key === 'std:court') patch.court = value;
          else if (key === 'std:responsible_attorney') {
            patch.responsibleAttorneyId = value ? Number(value) : null;
          } else if (key === 'std:opened_on') patch.openedOn = value;
        }
        // checkboxes unchecked are omitted
        form.querySelectorAll('input[type="checkbox"][name^="cf_"]').forEach((cb) => {
          customValues[cb.name.slice(3)] = cb.checked ? '1' : '0';
        });
        patch.customValues = customValues;
        try {
          await api(`/api/matters/${m.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          $('#matterMsg').innerHTML = '<div class="ok-banner">Matter saved.</div>';
          await renderMatterDetail();
          await refreshRefs();
        } catch (e) {
          $('#matterMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }

    const onedriveForm = $('#onedriveForm');
    if (onedriveForm) {
      onedriveForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(onedriveForm);
        try {
          await api(`/api/matters/${m.id}/onedrive`, {
            method: 'PUT',
            body: JSON.stringify({
              folderUrl: fd.get('folderUrl'),
              folderName: fd.get('folderName'),
              notes: fd.get('notes'),
            }),
          });
          $('#onedriveMsg').innerHTML = '<div class="ok-banner">OneDrive folder linked.</div>';
          await renderMatterDetail();
        } catch (e) {
          $('#onedriveMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
    const onedriveEdit = $('#onedriveEdit');
    if (onedriveEdit && onedriveForm) {
      onedriveEdit.onclick = () => {
        onedriveForm.hidden = false;
        onedriveEdit.hidden = true;
      };
    }
    const onedriveCancelEdit = $('#onedriveCancelEdit');
    if (onedriveCancelEdit) {
      onedriveCancelEdit.onclick = async () => {
        await renderMatterDetail();
      };
    }
    const onedriveDisconnect = $('#onedriveDisconnect');
    if (onedriveDisconnect) {
      onedriveDisconnect.onclick = async () => {
        try {
          await api(`/api/matters/${m.id}/onedrive`, { method: 'DELETE' });
          await renderMatterDetail();
        } catch (e) {
          $('#onedriveMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }

    if (page.onedrive && page.onedrive.linked) {
      wireOneDriveBrowser(m.id, page.onedrive, canEdit);
    }

    main.querySelectorAll('[data-del-matter-field]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(
            `/api/matters/${m.id}/layout-fields?fieldKey=${encodeURIComponent(btn.dataset.delMatterField)}`,
            { method: 'DELETE' }
          );
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    });

    const addStd = $('#addStandardFieldForm');
    if (addStd) {
      addStd.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(addStd);
        try {
          await api(`/api/matters/${m.id}/standard-fields`, {
            method: 'POST',
            body: JSON.stringify({ fieldKey: fd.get('fieldKey') }),
          });
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }

    const rf = $('#recordFieldForm');
    if (rf) {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        try {
          await api(`/api/matters/${m.id}/custom-fields`, {
            method: 'POST',
            body: JSON.stringify({
              label: fd.get('label'),
              fieldType: fd.get('fieldType'),
            }),
          });
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
    const useRec = $('#useRecordLayout');
    if (useRec) {
      useRec.onclick = async () => {
        try {
          await api(`/api/matters/${m.id}/use-record-layout`, { method: 'POST', body: '{}' });
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
  }

  async function renderTime() {
    const [entries, settings, matters] = await Promise.all([
      api('/api/time-entries'),
      api('/api/settings'),
      api('/api/matters'),
    ]);
    state.settings = settings;
    state.matters = matters;
    const today = new Date().toISOString().slice(0, 10);
    const preferredMatterId = state.matterId
      || (matters.length === 1 ? matters[0].id : null);
    main.innerHTML = `
      <div class="card">
        <h1>Time Entry</h1>
        <form id="timeForm" class="grid two">
          <div class="field span-all">
            <span class="field-label">Matter</span>
            ${renderMatterPicker({
              name: 'matterId',
              selectedId: preferredMatterId,
              matters,
              hideNumber: true,
            })}
            <span class="hint">Type to filter by matter name or client.</span>
          </div>
          <label>Date
            <input name="serviceDate" type="date" value="${today}" required />
          </label>
          <label>Minutes
            <input name="rawMinutes" type="number" min="1" value="7" required />
          </label>
          <label>Timekeeper
            <select name="timekeeperId">
              ${state.users.map((u) =>
                `<option value="${u.id}" ${u.id === state.user.id ? 'selected' : ''}>${escapeHtml(u.name)}</option>`
              ).join('')}
            </select>
          </label>
          <label class="span-all">Description
            <textarea name="description" rows="2" required>Reviewed production set</textarea>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Save draft</button>
          </div>
        </form>
        <div id="timeMsg" style="margin-top:.75rem"></div>
      </div>
      <div class="card">
        <h2>Recent entries</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Matter</th><th>Minutes</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${entries.slice(0, 30).map((e) => {
              const matterName = (matters.find((m) => Number(m.id) === Number(e.matter_id)) || {}).name
                || e.matter_number
                || '—';
              return `
              <tr>
                <td>${escapeHtml(e.service_date)}</td>
                <td>${escapeHtml(matterName)}<div class="muted">${escapeHtml(e.description)}</div></td>
                <td><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">(${e.rounded_minutes} min)</span></td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(e.status)}</span></td>
                <td class="row-actions">
                  ${e.status === 'draft' || e.status === 'rejected'
                    ? `<button data-submit="${e.id}">Submit</button>` : ''}
                </td>
              </tr>`;
            }).join('') || '<tr><td colspan="5" class="muted">No entries yet</td></tr>'}
          </tbody>
        </table></div>
      </div>`;

    const matterPicker = wireMatterPicker($('#timeForm'), { matters, hideNumber: true });
    $('#timeForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd.entries());
      body.matterId = Number(body.matterId);
      body.timekeeperId = Number(body.timekeeperId);
      body.rawMinutes = Number(body.rawMinutes);
      delete body.category;
      delete body.subcategory;
      if (!body.matterId) {
        matterPicker?.setInvalid(true);
        $('#timeMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
        matterPicker?.focus();
        return;
      }
      try {
        const entry = await api('/api/time-entries', { method: 'POST', body: JSON.stringify(body) });
        let msg = `Saved #${entry.id}: ${formatDuration(entry.roundedMinutes)} (${entry.roundedMinutes} min).`;
        if (entry.duplicateWarnings?.length) {
          msg += ` Duplicate warning vs entries ${entry.duplicateWarnings.join(', ')}.`;
        }
        $('#timeMsg').innerHTML = `<div class="ok-banner">${escapeHtml(msg)}</div>`;
        await renderTime();
      } catch (e) {
        $('#timeMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };
    main.querySelectorAll('[data-submit]').forEach((b) => {
      b.onclick = async () => {
        await api(`/api/time-entries/${b.dataset.submit}/submit`, { method: 'POST', body: '{}' });
        await renderTime();
      };
    });

    if (state.focusTimeEntry) {
      state.focusTimeEntry = false;
      const form = $('#timeForm');
      setTimeout(() => {
        if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!preferredMatterId) matterPicker?.focus();
        else {
          const minutes = form && form.querySelector('input[name="rawMinutes"]');
          if (minutes) minutes.focus();
        }
      }, 0);
    }
  }

  async function renderReports() {
    const names = [
      ['matters', 'Matters'],
      ['lodestar-summary', 'Lodestar Summary'],
      ['lodestar-detail', 'Lodestar Detail'],
    ];
    main.innerHTML = `
      <div class="card">
        <h1>Reports</h1>
        <p class="lead">Matters list and lodestar exports (CSV / Excel).</p>
        <div>
          ${names.map(([id, label]) => `
            <div class="report-row">
              <strong>${label}</strong>
              <button data-view-report="${id}">View</button>
              <a class="btn" href="/api/reports/${id}?format=csv" target="_blank">CSV</a>
              <a class="btn" href="/api/reports/${id}?format=xlsx">Excel</a>
            </div>`).join('')}
        </div>
      </div>
      <div id="reportOut" class="card" hidden></div>`;

    // Auth header for download links via fetch+blob for xlsx/csv when needed
    main.querySelectorAll('a.btn').forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        const res = await fetch(a.getAttribute('href'), {
          headers: { Authorization: `Bearer ${state.token}` },
        });
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const tmp = document.createElement('a');
        tmp.href = url;
        tmp.download = a.getAttribute('href').includes('xlsx') ? 'report.xlsx' : 'report.csv';
        tmp.click();
        URL.revokeObjectURL(url);
      };
    });

    main.querySelectorAll('[data-view-report]').forEach((b) => {
      b.onclick = async () => {
        const rows = await api(`/api/reports/${b.dataset.viewReport}`);
        const out = $('#reportOut');
        out.hidden = false;
        if (!rows.length) {
          out.innerHTML = `<h2>${b.dataset.viewReport}</h2><p class="muted">No rows</p>`;
          return;
        }
        const keys = Object.keys(rows[0]);
        out.innerHTML = `
          <h2>${b.dataset.viewReport}</h2>
          <div class="table-wrap"><table>
            <thead><tr>${keys.map((k) => `<th>${k}</th>`).join('')}</tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>${keys.map((k) => {
                const v = r[k];
                if (String(k).endsWith('_cents') && Number.isInteger(v)) return `<td>${money(v)}</td>`;
                return `<td>${v ?? ''}</td>`;
              }).join('')}</tr>`).join('')}
            </tbody>
          </table></div>`;
      };
    });
  }

  function wireChoiceGroup(root, name) {
    const rows = [...root.querySelectorAll(`.choice[data-name="${name}"]`)];
    const sync = () => {
      rows.forEach((row) => {
        const input = row.querySelector('input');
        row.classList.toggle('is-selected', !!input.checked);
      });
    };
    rows.forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (row.dataset.disabled === '1') return;
        const input = row.querySelector('input');
        input.checked = true;
        sync();
        row.dispatchEvent(new CustomEvent('choice-change', { bubbles: true, detail: { name, value: input.value } }));
      });
    });
    sync();
  }

  function dollarsToCents(value) {
    const raw = String(value || '').trim().replace(/[$,]/g, '');
    if (!raw) throw new Error('rate required');
    const parts = raw.split('.');
    const dollars = Number(parts[0] || '0');
    const frac = (parts[1] || '0').padEnd(2, '0').slice(0, 2);
    if (!Number.isFinite(dollars)) throw new Error('invalid rate');
    return dollars * 100 + Number(frac);
  }

  async function renderSettings() {
    const isAdmin = state.user.role === 'admin';
    const canEditBilling = isAdmin || state.user.role === 'billing_clerk';
    const settings = await api('/api/settings');
    state.settings = settings;

    let timekeepers = [];
    if (canEditBilling) {
      try { timekeepers = await api('/api/timekeepers'); }
      catch { timekeepers = []; }
    }

    const today = new Date().toISOString().slice(0, 10);

    const canConfigureFields = isAdmin || state.user.role === 'billing_clerk';

    main.innerHTML = `
      <div class="card stack">
        <h1>Settings</h1>
        <p class="lead">Time and billing preferences${canConfigureFields ? ', default matter fields' : ''}${isAdmin ? ', timekeepers, and rates' : ''}.</p>
        ${canEditBilling ? '' : '<div class="error">Sign in as an admin (avery@firm.example) or billing clerk (billie@firm.example) to edit these settings.</div>'}
      </div>

      ${canConfigureFields ? `
      <div class="card stack" id="defaultFieldsCard">
        <h2>Default fields</h2>
        <p class="hint">One <strong>Default</strong> record layout for all matters. Add built-in fields or custom fields with a formatter.</p>
        <div id="defaultFieldsBody" class="stack"></div>
        <div id="typeFieldMsg"></div>
      </div>` : ''}

      <form id="settingsForm" class="card stack">
        <h2>Time and Billing</h2>

        <div class="settings-block" data-editable="${canEditBilling ? '1' : '0'}">
          <h3 style="margin:0 0 .35rem;font-family:var(--font)">Duration Format</h3>
          <p class="hint">How timers and time entries are shown.</p>
          ${settings.durationFormats.map((f) => `
            <div class="choice ${settings.durationFormat === f.id ? 'is-selected' : ''}"
                 data-name="durationFormat" data-disabled="${canEditBilling ? '0' : '1'}">
              <input type="radio" name="durationFormat" value="${f.id}"
                ${settings.durationFormat === f.id ? 'checked' : ''}
                ${canEditBilling ? '' : 'disabled'} />
              <span>
                <strong>${f.label}</strong>
                <span class="muted">${f.description}</span>
              </span>
            </div>`).join('')}
        </div>

        <div class="settings-block" data-editable="${canEditBilling ? '1' : '0'}">
          <h3 style="margin:0 0 .35rem;font-family:var(--font)">Time Rounding</h3>
          <p class="hint">Round time entries up, down, to the nearest X minutes, or not at all.
            Nearest rounds up if the duration is exactly in the middle of the interval.</p>
          ${settings.roundingModes.map((m) => `
            <div class="choice ${settings.roundMode === m.id ? 'is-selected' : ''}"
                 data-name="roundMode" data-disabled="${canEditBilling ? '0' : '1'}">
              <input type="radio" name="roundMode" value="${m.id}"
                ${settings.roundMode === m.id ? 'checked' : ''}
                ${canEditBilling ? '' : 'disabled'} />
              <span>
                <strong>${m.label}</strong>
                <span class="muted">${m.description}</span>
              </span>
            </div>`).join('')}

          <label class="interval-label">Interval (X minutes)
            <select name="roundIncrementMinutes" id="roundIncrementMinutes" ${canEditBilling ? '' : 'disabled'}>
              ${settings.roundingIncrements.map((r) => `
                <option value="${r.minutes}" ${r.minutes === settings.roundIncrementMinutes ? 'selected' : ''}>
                  ${r.label}
                </option>`).join('')}
            </select>
          </label>
          <input type="hidden" name="roundIncrementMinutesFallback" value="${settings.roundIncrementMinutes}" />
          <p class="hint">Interval applies to Round up / Nearest / Down. Ignored when Do Not Round is selected.</p>
        </div>

        ${canEditBilling ? '<div class="row-actions"><button class="primary" type="submit">Save time &amp; billing settings</button></div>' : ''}
        <div id="settingsMsg"></div>
      </form>

      ${isAdmin ? `
      <div class="card stack" id="emailSettingsCard">
        <h2>Email</h2>
        <p class="lead">Users receive invite and sign-in links by email — they don’t configure anything.</p>
        ${settings.email?.configured
          ? `<div class="ok-banner">${escapeHtml(settings.email.message || 'Email is ready.')}</div>
             <div class="row-actions">
               <button type="button" class="primary" id="emailTestBtn">Send me a test email</button>
             </div>`
          : `<div class="error">${escapeHtml(settings.email?.message || 'Email is not ready yet.')}</div>
             <p class="hint">Easiest path: connect Microsoft under <strong>OneDrive / SharePoint</strong> below (approve Mail.Send when prompted). Invites and login links then send from that mailbox automatically.</p>
             <p class="hint">Or set product secrets <code>RESEND_API_KEY</code> + <code>SMTP_FROM</code> once on the server.</p>`}
        <div id="emailSettingsMsg"></div>
      </div>` : ''}

      ${(isAdmin || state.user.role === 'billing_clerk') ? `
      <div class="card stack" id="onedriveSettingsCard">
        <h2>OneDrive / SharePoint</h2>
        <p class="lead">
          ${settings.microsoft?.connected
            ? `Connected${settings.microsoft.accountLabel ? ` as <strong>${escapeHtml(settings.microsoft.accountLabel)}</strong>` : ' to Microsoft'} — also used to send invite and sign-in emails`
            : 'Connect Microsoft once to sync OneDrive and send invite / sign-in emails automatically'}
        </p>

        <div class="onedrive-connect-box">
          ${settings.microsoft?.connected ? `
            <div class="ok-banner">You're connected. Matter pages can refresh live OneDrive / SharePoint files.</div>
            <div class="row-actions">
              <button type="button" class="primary" id="msConnectQuick">Switch Microsoft account</button>
              ${isAdmin ? '<button type="button" id="msDisconnect">Disconnect</button>' : ''}
            </div>
          ` : `
            <button type="button" class="primary ms-connect-main" id="msConnectQuick"
              ${settings.microsoft?.clientConfigured ? '' : 'disabled'}>
              Sign in with Microsoft
            </button>
            <p class="hint">Opens Microsoft login — approve access, then you're done.</p>
            ${settings.microsoft?.clientConfigured ? '' : `
              <div class="error" id="msNotConfigured">
                Microsoft sign-in isn’t configured on this server yet.
                ${isAdmin
                  ? 'An admin sets <code>MS_CLIENT_ID</code> once in the server environment (one Azure app for the product). Users never enter an app ID.'
                  : 'Ask a firm admin to finish server setup, then try again.'}
              </div>`}
            <div id="msDevicePanel" class="onedrive-device-panel" hidden></div>
            ${settings.microsoft?.clientConfigured
              ? '<p class="hint"><button type="button" class="linkish" id="msConnectDevice">Use a device code instead</button></p>'
              : ''}
          `}
        </div>

        ${isAdmin ? `
        <details class="onedrive-setup-help">
          <summary>Server setup (admins)</summary>
          <p class="hint" style="margin-top:.65rem">
            Prefer <code>MS_CLIENT_ID</code> in the environment / <code>.env</code> so everyone only clicks
            <strong>Sign in with Microsoft</strong>. Optional fallback fields below if you cannot set env vars.
            ${settings.microsoft?.clientIdSource === 'env'
              ? ` Currently using env (<code>${escapeHtml(settings.microsoft.clientIdMasked || '')}</code>).`
              : settings.microsoft?.clientConfigured
                ? ` Currently using saved settings (<code>${escapeHtml(settings.microsoft.clientIdMasked || '')}</code>).`
                : ''}
          </p>
          <ol>
            <li><a href="https://portal.azure.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener noreferrer">Azure App registrations</a> → New registration (once for the product).</li>
            <li>Supported accounts: multitenant (or single-tenant). Authentication → allow public client flows; redirect URI <code>${escapeHtml(window.location.origin)}/api/onedrive/oauth/callback</code>.</li>
            <li>API permissions (delegated): User.Read, Mail.Send, Files.Read.All, Sites.Read.All, offline_access → Grant admin consent.</li>
            <li>Set <code>MS_CLIENT_ID=&lt;Application (client) ID&gt;</code> and restart the server.</li>
          </ol>
          <form id="msAppConfigForm" class="grid two" style="margin-top:.75rem">
            <label class="span-all">Application (client) ID <span class="muted">(fallback if env not set)</span>
              <input name="msClientId" value="${escapeHtml(settings.microsoft?.clientId || '')}"
                placeholder="${settings.microsoft?.clientIdSource === 'env' ? 'Using MS_CLIENT_ID from environment' : 'xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx'}"
                ${settings.microsoft?.clientIdSource === 'env' ? 'disabled' : ''} />
            </label>
            <label>Tenant
              <input name="msTenantId" value="${escapeHtml(settings.microsoft?.tenantId || 'common')}" placeholder="common" />
            </label>
            <label>Client secret <span class="muted">(optional)</span>
              <input name="msClientSecret" type="password" autocomplete="off" placeholder="Optional" />
            </label>
            <div class="row-actions span-all">
              <button type="submit" ${settings.microsoft?.clientIdSource === 'env' ? 'disabled' : ''}>Save app settings</button>
            </div>
          </form>
        </details>` : ''}
        <div id="onedriveSettingsMsg"></div>
      </div>` : ''}

      ${canEditBilling ? `
      <div class="card stack">
        <h2>Timekeepers &amp; Rates</h2>
        <p class="lead">Default rates are timekeeper-scoped and effective-dated. Historical invoices keep snapshotted rates.</p>

        ${isAdmin ? `
        <form id="tkForm" class="grid two">
          <label>Name <input name="name" required placeholder="Alex Associate" /></label>
          <label>Email <input name="email" type="email" required placeholder="alex@firm.example" /></label>
          <label>Role
            <select name="role">
              <option value="attorney">Attorney</option>
              <option value="paralegal">Paralegal</option>
              <option value="billing_clerk">Billing clerk</option>
              <option value="admin">Admin</option>
            </select>
          </label>
          <label>Default rate ($/hr)
            <input class="rate-dollars" name="defaultRate" type="text" inputmode="decimal" placeholder="350.00" required />
          </label>
          <label>Rate effective date
            <input name="rateEffectiveDate" type="date" value="${today}" required />
          </label>
          <p class="hint span-all">They get an email with a one-time link to set a password and sign in. No temporary password to share.</p>
          <div class="row-actions span-all" style="align-items:end">
            <button class="primary" type="submit">Send invite email</button>
          </div>
        </form>
        <div id="tkMsg"></div>
        ` : '<p class="hint">Only admins can invite timekeepers. Billing clerks can add/change rates.</p>'}

        <div class="table-wrap"><table>
          <thead>
            <tr><th>Timekeeper</th><th>Role</th><th>Current rate</th><th>Effective</th><th>Add rate change</th>${isAdmin ? '<th></th>' : ''}</tr>
          </thead>
          <tbody>
            ${timekeepers.map((t) => `
              <tr data-tk="${t.id}">
                <td>${t.name}<div class="muted">${t.email}</div></td>
                <td>${t.role.replace('_', ' ')}</td>
                <td>${t.current_rate_cents == null ? '—' : money(t.current_rate_cents) + '/hr'}</td>
                <td>${t.current_effective_date || '—'}</td>
                <td>
                  <form class="rate-form row-actions" data-scope-id="${t.id}">
                    <input name="amount" class="rate-dollars" type="text" inputmode="decimal" placeholder="375.00" required style="width:6.5rem" />
                    <input name="effectiveDate" type="date" value="${today}" required />
                    <button type="submit">Add</button>
                  </form>
                  <details class="hint" style="margin-top:.4rem">
                    <summary>Rate history (${t.rates.length})</summary>
                    <ul>
                      ${t.rates.map((r) => `<li>${r.effective_date}: ${money(r.amount_cents)}/hr</li>`).join('') || '<li>None</li>'}
                    </ul>
                  </details>
                </td>
                ${isAdmin ? `
                <td>
                  <button type="button" data-send-reset="${t.id}">Email reset</button>
                </td>` : ''}
              </tr>`).join('') || `<tr><td colspan="${isAdmin ? 6 : 5}" class="muted">No timekeepers</td></tr>`}
          </tbody>
        </table></div>
        <div id="rateMsg"></div>
      </div>` : ''}`;

    wireChoiceGroup(main, 'durationFormat');
    wireChoiceGroup(main, 'roundMode');

    if (canConfigureFields) {
      await bindDefaultFieldsEditor({
        bodyEl: $('#defaultFieldsBody'),
        msgEl: $('#typeFieldMsg'),
        recordTypeKey: 'default',
      });
    }

    const form = $('#settingsForm');
    const interval = $('#roundIncrementMinutes');
    const syncInterval = () => {
      const mode = form.querySelector('input[name="roundMode"]:checked')?.value;
      if (interval) interval.disabled = !canEditBilling || mode === 'none';
    };
    main.querySelectorAll('.choice[data-name="roundMode"]').forEach((row) => {
      row.addEventListener('choice-change', syncInterval);
    });
    syncInterval();

    if (canEditBilling) {
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const durationFormat = form.querySelector('input[name="durationFormat"]:checked')?.value;
        const roundMode = form.querySelector('input[name="roundMode"]:checked')?.value;
        const roundIncrementMinutes = Number(
          interval?.disabled
            ? form.roundIncrementMinutesFallback.value
            : interval.value
        );
        try {
          state.settings = await api('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify({ durationFormat, roundMode, roundIncrementMinutes }),
          });
          $('#settingsMsg').innerHTML = '<div class="ok-banner">Time &amp; billing settings saved.</div>';
          await renderSettings();
        } catch (e) {
          $('#settingsMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }

    const msAppForm = $('#msAppConfigForm');
    if (msAppForm) {
      msAppForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(msAppForm);
        const payload = {
          msClientId: fd.get('msClientId'),
          msTenantId: fd.get('msTenantId') || 'common',
        };
        const secret = String(fd.get('msClientSecret') || '').trim();
        if (secret) payload.msClientSecret = secret;
        try {
          await api('/api/settings', { method: 'PATCH', body: JSON.stringify(payload) });
          $('#onedriveSettingsMsg').innerHTML = '<div class="ok-banner">Microsoft app saved. You can connect an account next.</div>';
          await renderSettings();
        } catch (e) {
          $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const quickBtn = $('#msConnectQuick');
    const connectBtn = $('#msConnectDevice');
    const devicePanel = $('#msDevicePanel');
    let pollTimer = null;
    const stopPoll = () => {
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    };

    const startMicrosoftLogin = async () => {
      const started = await api('/api/onedrive/connect/quick', {
        method: 'POST',
        body: '{}',
      });
      if (!started.authUrl) throw new Error('Microsoft did not return a sign-in URL');
      window.location.href = started.authUrl;
    };

    if (quickBtn) {
      quickBtn.onclick = async () => {
        stopPoll();
        try {
          quickBtn.disabled = true;
          $('#onedriveSettingsMsg').innerHTML = '';
          await startMicrosoftLogin();
        } catch (e) {
          quickBtn.disabled = false;
          $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    if (connectBtn && devicePanel) {
      connectBtn.onclick = async () => {
        stopPoll();
        try {
          connectBtn.disabled = true;
          const started = await api('/api/onedrive/connect/start', { method: 'POST', body: '{}' });
          devicePanel.hidden = false;
          devicePanel.innerHTML = `
            <div class="onedrive-device-card">
              <p><strong>Sign in to Microsoft</strong></p>
              <p class="hint">1. Open <a href="${escapeHtml(started.verificationUriComplete || started.verificationUri)}" target="_blank" rel="noopener noreferrer">${escapeHtml(started.verificationUri)}</a></p>
              <p class="hint">2. Enter this code:</p>
              <div class="onedrive-user-code">${escapeHtml(started.userCode)}</div>
              <p class="muted" id="msDeviceStatus">Waiting for approval…</p>
            </div>`;
          const deviceCode = started.deviceCode;
          let intervalMs = Math.max(3, Number(started.interval || 5)) * 1000;

          const tick = async () => {
            try {
              const result = await api('/api/onedrive/connect/poll', {
                method: 'POST',
                body: JSON.stringify({ deviceCode }),
              });
              if (result.status === 'connected') {
                stopPoll();
                $('#onedriveSettingsMsg').innerHTML = '<div class="ok-banner">Microsoft account connected.</div>';
                await renderSettings();
                return;
              }
              if (result.slowDown) intervalMs += 2000;
              const st = $('#msDeviceStatus');
              if (st) st.textContent = 'Waiting for approval…';
              pollTimer = setTimeout(tick, intervalMs);
            } catch (e) {
              stopPoll();
              const st = $('#msDeviceStatus');
              if (st) st.textContent = e.message;
              $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
              connectBtn.disabled = false;
            }
          };
          pollTimer = setTimeout(tick, intervalMs);
        } catch (e) {
          connectBtn.disabled = false;
          $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const disconnectBtn = $('#msDisconnect');
    if (disconnectBtn) {
      disconnectBtn.onclick = async () => {
        try {
          await api('/api/onedrive/disconnect', { method: 'POST', body: '{}' });
          await renderSettings();
        } catch (e) {
          $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const params = new URLSearchParams(window.location.search);
    if (params.get('onedrive') === 'connected') {
      $('#onedriveSettingsMsg').innerHTML = '<div class="ok-banner">Microsoft account connected.</div>';
      params.delete('onedrive');
      const next = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || '#settings'}`;
      window.history.replaceState({}, '', next);
    } else if (params.get('onedrive') === 'error') {
      $('#onedriveSettingsMsg').innerHTML = `<div class="error">${escapeHtml(params.get('msg') || 'Microsoft sign-in failed')}</div>`;
      params.delete('onedrive');
      params.delete('msg');
      window.history.replaceState({}, '', `${window.location.pathname}${params.toString() ? `?${params}` : ''}#settings`);
    }

    const emailTestBtn = $('#emailTestBtn');
    if (emailTestBtn) {
      emailTestBtn.onclick = async () => {
        try {
          emailTestBtn.disabled = true;
          const result = await api('/api/settings/email/test', {
            method: 'POST',
            body: JSON.stringify({ to: state.user.email }),
          });
          $('#emailSettingsMsg').innerHTML = `<div class="ok-banner">Test email sent (${escapeHtml(result.delivery?.mode || 'ok')}).</div>`;
        } catch (e) {
          $('#emailSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        } finally {
          emailTestBtn.disabled = false;
        }
      };
    }

    const tkForm = $('#tkForm');
    if (tkForm) {
      tkForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(tkForm);
        try {
          const defaultRateCents = dollarsToCents(fd.get('defaultRate'));
          const invited = await api('/api/users', {
            method: 'POST',
            body: JSON.stringify({
              invite: true,
              name: fd.get('name'),
              email: fd.get('email'),
              role: fd.get('role'),
              defaultRateCents,
              rateEffectiveDate: fd.get('rateEffectiveDate'),
            }),
          });
          const delivered = invited.delivery?.ok === true;
          const mode = delivered
            ? 'Invite email sent.'
            : (invited.warning || 'Invite created, but email was not delivered. Configure Email in Settings, or use the link below.');
          await refreshRefs();
          await renderSettings();
          const msg = $('#tkMsg');
          if (msg) {
            const link = invited.devLink
              || (invited.devToken ? `${window.location.origin}/?auth_token=${encodeURIComponent(invited.devToken)}` : '');
            msg.innerHTML = `<div class="${delivered ? 'ok-banner' : 'error'}">${escapeHtml(mode)}${
              link ? `<div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open invite link</a></div>` : ''
            }</div>`;
          }
        } catch (e) {
          $('#tkMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    main.querySelectorAll('[data-send-reset]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const result = await api(`/api/users/${btn.dataset.sendReset}/send-reset`, {
            method: 'POST',
            body: '{}',
          });
          const delivered = result.delivery?.ok === true;
          const mode = delivered
            ? 'Password reset email sent.'
            : (result.warning || 'Reset link created, but email was not delivered. Configure Email in Settings.');
          const link = result.devLink
            || (result.devToken ? `${window.location.origin}/?auth_token=${encodeURIComponent(result.devToken)}` : '');
          $('#rateMsg').innerHTML = `<div class="${delivered ? 'ok-banner' : 'error'}">${escapeHtml(mode)}${
            link ? `<div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open reset link</a></div>` : ''
          }</div>`;
        } catch (e) {
          btn.disabled = false;
          $('#rateMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        } finally {
          btn.disabled = false;
        }
      };
    });

    main.querySelectorAll('form.rate-form').forEach((rf) => {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        try {
          await api('/api/rates', {
            method: 'POST',
            body: JSON.stringify({
              scope: 'timekeeper',
              scopeId: Number(rf.dataset.scopeId),
              amountCents: dollarsToCents(fd.get('amount')),
              effectiveDate: fd.get('effectiveDate'),
            }),
          });
          $('#rateMsg').innerHTML = '<div class="ok-banner">Rate change saved.</div>';
          await renderSettings();
        } catch (e) {
          $('#rateMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    });
  }

  async function renderAudit() {
    const rows = await api('/api/audit-log');
    main.innerHTML = `
      <div class="card">
        <h1>Audit Log</h1>
        <div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Detail</th></tr></thead>
          <tbody>
            ${rows.map((r) => `
              <tr>
                <td>${r.created_at}</td>
                <td>${r.actor_email || '—'}</td>
                <td>${r.action}</td>
                <td>${r.entity_type} ${r.entity_id ?? ''}</td>
                <td class="muted">${r.detail_json || ''}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>`;
  }

  boot();
})();
