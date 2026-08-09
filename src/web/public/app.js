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
    tkSearch: { q: '' },
    showCreateMatter: false,
    focusTimeEntry: false,
    timeFlash: '',
    matterTimeFlash: '',
    matterFieldFlash: '',
    timeEntryRetain: null,
    matterTimeRetain: null,
    focusCustomReportId: null,
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
    const headers = {
      'Content-Type': 'application/json',
      // Helps the server build email links with the URL the user is actually on
      // (avoids ephemeral pod hostnames that break when opened from email).
      'X-App-Origin': window.location.origin,
      ...(opts.headers || {}),
    };
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

  /** Built-in fields (client, status, etc.) are not managed from Add field UI. */
  function isBuiltInField(field) {
    const key = field?.fieldKey || field?.key || '';
    return String(key).startsWith('std:');
  }

  function fieldMgmtRows(fields) {
    const rows = (fields || []).filter((f) => !isBuiltInField(f));
    if (!rows.length) return '<p class="muted">No custom fields yet</p>';
    return rows.map((f) => `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(f.kind)}${f.required ? ' · required' : ''}</span>
        </div>
        ${f.removable
          ? `<button type="button" data-del-matter-field="${escapeHtml(f.fieldKey)}">Delete</button>`
          : ''}
      </div>`).join('');
  }

  function typeFieldMgmtRows(fields, delAttr = 'data-del-type-field') {
    const rows = (fields || []).filter((f) => !isBuiltInField(f));
    if (!rows.length) return '<p class="muted">No custom fields yet</p>';
    return rows.map((f) => `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(f.kind)}${f.required ? ' · required' : ''}</span>
        </div>
        ${f.removable
          ? `<button type="button" ${delAttr}="${escapeHtml(f.fieldKey)}">Delete</button>`
          : ''}
      </div>`).join('');
  }

  function requiredFieldCheckboxHtml() {
    return `
      <label class="check-inline span-all">
        <input type="checkbox" name="required" />
        Required on create
      </label>`;
  }

  /** Field formatters available when adding default / custom record fields. */
  const FIELD_FORMATTERS = [
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Text area' },
    { value: 'number', label: 'Number' },
    { value: 'date', label: 'Date' },
    { value: 'dropdown', label: 'Dropdown' },
    { value: 'checkbox', label: 'Checkbox' },
  ];

  function fieldFormatterOptions(selected = 'text') {
    return FIELD_FORMATTERS.map((f) =>
      `<option value="${f.value}" ${f.value === selected ? 'selected' : ''}>${f.label}</option>`
    ).join('');
  }

  function fieldTypeLabel(type) {
    const t = String(type || '');
    if (t === 'select' || t === 'dropdown') return 'dropdown';
    return t;
  }

  function parseOptionsInput(raw) {
    return String(raw || '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** API stores dropdowns as select; accept either in the UI. */
  function apiFieldType(fieldType) {
    return fieldType === 'dropdown' ? 'select' : fieldType;
  }

  function customFieldPayload(fd) {
    const fieldType = String(fd.get('fieldType') || 'text');
    const options = parseOptionsInput(fd.get('optionsText'));
    const body = {
      label: fd.get('label'),
      fieldType: apiFieldType(fieldType),
      required: fd.get('required') === 'on',
    };
    if (fieldType === 'dropdown' || fieldType === 'select') {
      body.options = options;
      body.optionsText = String(fd.get('optionsText') || '');
    }
    return { fieldType, options, body };
  }

  function dropdownOptionsFieldHtml() {
    return `
      <label class="span-all" data-dropdown-options hidden>
        Dropdown options
        <input name="optionsText" placeholder="e.g. Discovery, Trial, Appeal" />
        <span class="hint">Comma-separated list of choices</span>
      </label>`;
  }

  function wireDropdownOptionsToggle(form) {
    if (!form) return;
    const typeSelect = form.querySelector('select[name="fieldType"]');
    const optionsRow = form.querySelector('[data-dropdown-options]');
    const optionsInput = form.querySelector('input[name="optionsText"]');
    if (!typeSelect || !optionsRow) return;
    const sync = () => {
      const isDropdown = typeSelect.value === 'dropdown' || typeSelect.value === 'select';
      optionsRow.hidden = !isDropdown;
      if (optionsInput) optionsInput.required = isDropdown;
      if (!isDropdown && optionsInput) optionsInput.value = '';
    };
    typeSelect.addEventListener('change', sync);
    sync();
  }

  /** Manage matter (default layout) or time-entry custom fields on Settings. */
  async function bindDefaultFieldsEditor({
    bodyEl,
    msgEl,
    recordTypeKey = 'default',
    appliesTo = 'matter',
  } = {}) {
    if (!bodyEl) return;
    const key = recordTypeKey || 'default';
    const isTime = appliesTo === 'time_entry';
    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };

    const render = async () => {
      if (isTime) {
        const fields = await api('/api/custom-fields?appliesTo=time_entry');
        const rows = (fields || []).map((f) => `
          <div class="field-mgmt-row">
            <div>
              <strong>${escapeHtml(f.label)}</strong>
              <div class="muted">${escapeHtml(fieldTypeLabel(f.field_type))} · time entry${f.required ? ' · required' : ''}</div>
            </div>
            <button type="button" data-del-time-field="${f.id}">Remove</button>
          </div>`).join('') || '<p class="muted">No time-entry fields yet.</p>';
        bodyEl.innerHTML = `
          <div class="field-mgmt-list">${rows}</div>
          <form id="timeFieldForm" class="grid two">
            <label>Custom field label
              <input name="label" required />
            </label>
            <label>Custom field type
              <select name="fieldType">
                ${fieldFormatterOptions('text')}
              </select>
            </label>
            ${dropdownOptionsFieldHtml()}
            ${requiredFieldCheckboxHtml()}
            <div class="row-actions span-all">
              <button class="primary" type="submit">Add time field</button>
            </div>
          </form>`;
        bodyEl.querySelectorAll('[data-del-time-field]').forEach((btn) => {
          btn.onclick = async () => {
            try {
              await api(`/api/custom-fields/${btn.dataset.delTimeField}`, { method: 'DELETE' });
              setMsg('<div class="ok-banner">Time field removed.</div>');
              await render();
            } catch (e) {
              setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
            }
          };
        });
        const timeFieldForm = bodyEl.querySelector('#timeFieldForm');
        wireDropdownOptionsToggle(timeFieldForm);
        if (timeFieldForm) {
          timeFieldForm.onsubmit = async (ev) => {
            ev.preventDefault();
            const fd = new FormData(timeFieldForm);
            const { fieldType, options, body } = customFieldPayload(fd);
            if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
              setMsg('<div class="error">Add at least one dropdown option.</div>');
              return;
            }
            try {
              await api('/api/custom-fields', {
                method: 'POST',
                body: JSON.stringify({
                  ...body,
                  appliesTo: 'time_entry',
                }),
              });
              setMsg('<div class="ok-banner">Time field added.</div>');
              await render();
            } catch (e) {
              setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
            }
          };
        }
        return;
      }

      const typeLayout = await api(`/api/record-types/${encodeURIComponent(key)}/layout`);
      bodyEl.innerHTML = `
        <div class="field-mgmt-list">
          ${typeFieldMgmtRows(typeLayout.fields)}
        </div>
        <form id="typeFieldForm" class="grid two">
          <label>Custom field label
            <input name="label" required placeholder="e.g. Case stage" />
          </label>
          <label>Custom field type
            <select name="fieldType">
              ${fieldFormatterOptions('text')}
            </select>
          </label>
          ${dropdownOptionsFieldHtml()}
          ${requiredFieldCheckboxHtml()}
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add field</button>
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
      const typeFieldForm = bodyEl.querySelector('#typeFieldForm');
      wireDropdownOptionsToggle(typeFieldForm);
      if (typeFieldForm) {
        typeFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(typeFieldForm);
          const { fieldType, options, body } = customFieldPayload(fd);
          if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
            setMsg('<div class="error">Add at least one dropdown option.</div>');
            return;
          }
          try {
            await api('/api/custom-fields', {
              method: 'POST',
              body: JSON.stringify({
                ...body,
                recordTypeKey: key,
                appliesTo: 'matter',
              }),
            });
            setMsg('<div class="ok-banner">Matter field added.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };

    await render();
  }

  function matterSearchText(m) {
    // Numbers stay searchable but are not shown in picker labels/results.
    return [
      m.number,
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
  } = {}) {
    const selected = matters.find((m) => Number(m.id) === Number(selectedId)) || null;
    const placeholder = 'Search matters by name or client…';
    return `
      <div class="matter-picker" data-matter-picker>
        <input type="hidden" name="${name}" value="${selected ? selected.id : ''}" data-matter-id />
        <button type="button" class="matter-picker-trigger" data-matter-trigger
          aria-haspopup="listbox" aria-expanded="false">
          <span class="matter-picker-value" data-matter-label>
            ${selected ? `
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

  function wireMatterPicker(scopeEl, { matters = [] } = {}) {
    const picker = scopeEl.querySelector('[data-matter-picker]');
    if (!picker) return null;
    ensureMatterPickerDocClose();
    const placeholder = 'Search matters by name or client…';
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
      const matches = !needle
        ? matters.slice()
        : matters.filter((m) => matterSearchText(m).includes(needle));
      const total = matches.length;
      filtered = matches.slice(0, 5);
      activeIndex = filtered.length ? 0 : -1;
      empty.hidden = filtered.length > 0;
      list.innerHTML = filtered.map((m, i) => `
        <li role="option" class="matter-picker-option ${i === activeIndex ? 'is-active' : ''}"
          data-id="${m.id}" aria-selected="${i === activeIndex ? 'true' : 'false'}">
          <span>${escapeHtml(m.name)}</span>
          <small>${escapeHtml(m.client_name || '—')}${m.status ? ` · ${escapeHtml(m.status)}` : ''}</small>
        </li>`).join('') + (total > 5
        ? `<li class="matter-picker-more muted" aria-hidden="true">Showing 5 of ${total} — type to narrow</li>`
        : '');
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
    if (!params.has('auth_token') && !params.has('token')) return;
    params.delete('auth_token');
    params.delete('token');
    const q = params.toString();
    const path = window.location.pathname === '/auth' ? '/' : window.location.pathname;
    window.history.replaceState({}, '', `${path}${q ? `?${q}` : ''}${window.location.hash || ''}`);
  }

  function readAuthTokenFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get('auth_token') || params.get('token') || '';
  }

  function localAuthLink(rawToken) {
    if (!rawToken) return '';
    return `${window.location.origin}/auth?token=${encodeURIComponent(rawToken)}`;
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
    const authToken = readAuthTokenFromUrl();
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

  function renderLogin(mode = 'password') {
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
      : mode === 'email'
        ? `
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
          <p class="login-hint">Check your inbox for a one-time link.</p>`
        : `
          <p class="login-brand">Firm Billing</p>
          <p class="login-lead">Sign in with your work email and password</p>
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
          <p class="login-hint">Demo · avery@firm.example / demo-change-me</p>`;

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
    if (back) back.onclick = () => renderLogin('password');
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

  /** Inline SVG marks for sidebar nav / quick actions (no icon font deps). */
  function navIcon(name) {
    const common = 'class="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const icons = {
      matters: `<svg ${common}><rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M3.5 12h17"/></svg>`,
      time: `<svg ${common}><circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/></svg>`,
      billing: `<svg ${common}><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><circle cx="16.5" cy="16" r="1.2" fill="currentColor" stroke="none"/></svg>`,
      reports: `<svg ${common}><path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V9h5.5M9 13h6M9 16.5h4"/></svg>`,
      dashboard: `<svg ${common}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="3.5" width="7.5" height="4.5" rx="1.4"/><rect x="13" y="10" width="7.5" height="10.5" rx="1.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4"/></svg>`,
      settings: `<svg ${common}><circle cx="12" cy="12" r="3.1"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"/></svg>`,
      plus: `<svg ${common}><path d="M12 5v14M5 12h14"/></svg>`,
    };
    return icons[name] || icons.matters;
  }

  function renderShell() {
    if (sidebar) sidebar.hidden = false;
    document.body.classList.remove('login-mode');
    if (appEl) {
      appEl.classList.remove('login-mode');
      appEl.classList.add('app-shell');
    }
    const items = [
      ['matters', 'Matters', 'matters', 'Matters & search'],
      ['time', 'Time Entry', 'time', 'Log & review time'],
      ['billing', 'Billing', 'billing', 'Create bills'],
      ['reports', 'Reports', 'reports', 'Lodestar & custom'],
      ['dashboard', 'Dashboard', 'dashboard', 'Report visuals'],
      ['settings', 'Settings', 'settings', 'Firm preferences'],
    ];
    // Approvals / payments / WIP views stay retired — billing covers pre-bill → bill
    if (['approvals', 'payments', 'audit', 'wip'].includes(state.view)) {
      state.view = 'matters';
    }
    const activeView = state.view === 'matter' ? 'matters' : state.view;

    if (sidebarActions) {
      sidebarActions.innerHTML = `
        <p class="sidebar-label">Quick actions</p>
        ${canCreateMatter(state.user)
          ? `<button type="button" class="sidebar-action primary" id="sideAddMatter">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('plus')}</span>
              <span class="sidebar-action-text">
                <strong>Create Matter</strong>
                <small>Open create + search</small>
              </span>
            </button>`
          : ''}
        <button type="button" class="sidebar-action secondary" id="sideAddTime">
          <span class="sidebar-action-mark" aria-hidden="true">${navIcon('time')}</span>
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
      ${items.map(([id, label, icon, hint]) =>
        `<button type="button" data-view="${id}"
          class="sidebar-action primary sidebar-nav-btn ${activeView === id ? 'active' : ''}">
          <span class="sidebar-action-mark" aria-hidden="true">${navIcon(icon)}</span>
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
      else if (state.view === 'billing') await renderBilling();
      else if (state.view === 'reports') await renderReports();
      else if (state.view === 'dashboard') await renderDashboard();
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

    const showCreate = canEdit && state.showCreateMatter;
    const [hits, clients, allMatters, createMatterFields] = await Promise.all([
      api(`/api/matters?${params}`),
      api('/api/clients'),
      api('/api/matters'), // full list for dropdowns elsewhere; not shown here
      showCreate
        ? api('/api/custom-fields?appliesTo=matter&type=default').catch(() => [])
        : Promise.resolve([]),
    ]);
    state.matters = allMatters;
    state.clients = clients;
    const createFieldDefs = (createMatterFields || []).map((f) => ({
      key: `cf:${f.id}`,
      label: f.label,
      type: f.field_type,
      options: f.options,
      required: !!f.required,
      fieldId: f.id,
      kind: 'custom',
      width: f.field_type === 'textarea' ? 'full' : 'half',
      value: null,
    }));

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
            ${createFieldDefs.length ? `
            <div class="grid two create-matter-custom">
              ${createFieldDefs.map((field) => `
                <label class="${field.width === 'full' ? 'span-all' : ''}">
                  ${escapeHtml(field.label)}${field.required ? ' *' : ''}
                  ${renderFieldInput(field, { canEdit: true })}
                </label>`).join('')}
            </div>` : ''}
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
          ${!hasQuery ? '<p class="muted">Enter a search term to query the matter index.</p>' : (() => {
            const shown = hits.slice(0, 5);
            return `
          ${hits.length > 5 ? `<p class="muted">Showing 5 of ${hits.length} — refine your search to narrow results.</p>` : ''}
          <div class="table-wrap"><table>
            <thead>
              <tr><th>Name</th><th>Client</th><th>Status</th><th>Attorney</th></tr>
            </thead>
            <tbody>
              ${shown.map((m) => `
                <tr class="click-row" data-matter="${m.id}">
                  <td><strong>${escapeHtml(m.name)}</strong></td>
                  <td>${escapeHtml(m.client_name || '—')}</td>
                  <td><span class="pill" data-status="${escapeHtml(m.status)}">${escapeHtml(m.status)}</span></td>
                  <td>${escapeHtml(m.attorney_name || '—')}</td>
                </tr>`).join('') || '<tr><td colspan="4" class="muted">No indexed matters match</td></tr>'}
            </tbody>
          </table></div>`;
          })()}
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
        const customValues = {};
        for (const [key, value] of fd.entries()) {
          if (String(key).startsWith('cf_')) customValues[key.slice(3)] = value;
        }
        createFieldDefs.forEach((f) => {
          if (f.type === 'checkbox' && customValues[f.fieldId] == null) {
            customValues[f.fieldId] = '0';
          }
        });
        try {
          const page = await api('/api/matters', {
            method: 'POST',
            body: JSON.stringify({
              name: fd.get('name'),
              customValues,
            }),
          });
          $('#newMatterMsg').innerHTML = `<div class="ok-banner">Created and indexed ${escapeHtml(page.matter.name)}.</div>`;
          await refreshRefs();
          state.showCreateMatter = false;
          state.matterSearch = { q: page.matter.name };
          await openMatter(page.matter.id);
        } catch (e) {
          $('#newMatterMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
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
    if (field.type === 'select' || field.type === 'dropdown') {
      const opts = (field.options || []).map((o) =>
        `<option value="${escapeHtml(o)}" ${String(val) === String(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`
      ).join('');
      return `<select name="${name}" ${disabled} ${req}>
        <option value=""></option>${opts}
        ${val && !(field.options || []).includes(String(val))
          ? `<option value="${escapeHtml(val)}" selected>${escapeHtml(val)}</option>`
          : ''}
      </select>`;
    }
    if (field.type === 'checkbox') {
      return `<input type="checkbox" name="${name}" value="1" ${disabled} ${req} ${val === '1' || val === 'true' ? 'checked' : ''} />`;
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

  function timeEntryFieldDefs(timeFields) {
    return (timeFields || []).map((f) => ({
      key: `cf:${f.id}`,
      label: f.label,
      type: f.field_type,
      options: f.options,
      required: !!f.required,
      fieldId: f.id,
      kind: 'custom',
      width: f.field_type === 'textarea' ? 'full' : 'half',
      value: null,
    }));
  }

  function timeEntryFormFieldsHtml({
    formDate,
    formHours,
    formDescription,
    formTimekeeperId,
    timeFieldDefs,
  }) {
    return `
      <label>Date
        <input name="serviceDate" type="date" value="${escapeHtml(formDate)}" required />
      </label>
      <label>Hours
        <input name="hours" type="number" min="0.25" step="0.25" inputmode="decimal"
          value="${escapeHtml(formHours)}" placeholder="0.25" required />
      </label>
      <label>Timekeeper
        <select name="timekeeperId">
          ${(state.users || []).map((u) =>
            `<option value="${u.id}" ${Number(u.id) === Number(formTimekeeperId) ? 'selected' : ''}>${escapeHtml(u.name)}</option>`
          ).join('')}
        </select>
      </label>
      <label class="span-all">Description
        <textarea name="description" rows="2" required
          placeholder="What did you work on?">${escapeHtml(formDescription)}</textarea>
      </label>
      ${timeFieldDefs.map((field) => `
        <label class="${field.width === 'full' ? 'span-all' : ''}">${escapeHtml(field.label)}${field.required ? ' *' : ''}
          ${renderFieldInput(field, { canEdit: true })}
        </label>`).join('')}
      <div class="row-actions span-all">
        <button class="primary" type="submit">Save</button>
      </div>`;
  }

  function wireTimeEntrySubmit(form, {
    msgEl,
    timeFieldDefs,
    fixedMatterId = null,
    matterPicker = null,
    onSaved,
  }) {
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd.entries());
      body.matterId = Number(fixedMatterId != null ? fixedMatterId : body.matterId);
      body.timekeeperId = Number(body.timekeeperId);
      const hoursRaw = String(body.hours ?? '').trim();
      body.hours = Number(hoursRaw);
      if (!Number.isFinite(body.hours) || body.hours <= 0) {
        msgEl.innerHTML = '<div class="error">Enter hours in 0.25 increments (e.g. 0.25, 0.50, 1.25).</div>';
        const hoursInput = ev.target.querySelector('input[name="hours"]');
        if (hoursInput) hoursInput.focus();
        return;
      }
      delete body.rawMinutes;
      delete body.category;
      delete body.subcategory;
      const customValues = {};
      for (const [key, value] of Object.entries(body)) {
        if (key.startsWith('cf_')) {
          customValues[key.slice(3)] = value;
          delete body[key];
        }
      }
      timeFieldDefs.forEach((f) => {
        if (f.type === 'checkbox' && customValues[f.fieldId] == null) {
          customValues[f.fieldId] = '0';
        }
      });
      body.customValues = customValues;
      if (!body.matterId) {
        matterPicker?.setInvalid(true);
        msgEl.innerHTML = '<div class="error">Select a matter to continue.</div>';
        matterPicker?.focus();
        return;
      }
      try {
        const entry = await api('/api/time-entries', { method: 'POST', body: JSON.stringify(body) });
        await onSaved(entry, body);
      } catch (e) {
        msgEl.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };
  }

  async function renderMatterDetail() {
    if (!state.matterId) {
      state.view = 'matters';
      return renderMatters();
    }
    const matterId = state.matterId;
    const [page, timeFields, matterEntries, clients] = await Promise.all([
      api(`/api/matters/${matterId}`),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
      api(`/api/time-entries?matterId=${matterId}`).catch(() => []),
      api('/api/clients').catch(() => state.clients || []),
    ]);
    state.clients = clients || state.clients || [];
    const m = page.matter;
    const canEdit = canCreateMatter(state.user);
    const matterReports = [
      ['lodestar-matter-detail', 'Lodestar Detail', 'Simple list of time worked on this matter'],
      ['lodestar-matter-summary', 'Lodestar Summary', 'Hours and amounts by timekeeper'],
    ];
    const today = new Date().toISOString().slice(0, 10);
    const retain = state.matterTimeRetain || {};
    const formDate = retain.serviceDate || today;
    const formTimekeeperId = retain.timekeeperId || state.user.id;
    const formHours = '';
    const formDescription = '';
    const flash = state.matterTimeFlash || '';
    const matterFlash = state.matterFieldFlash || '';
    state.matterTimeFlash = '';
    state.matterFieldFlash = '';
    state.matterTimeRetain = null;
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
    const fieldCtx = {
      canEdit,
      clients: state.clients,
      recordTypes: [{ key: 'default', label: 'Default' }],
      users: state.users,
    };
    const sections = Object.entries(page.sections || {})
      .map(([section, fields]) => [section, (fields || []).filter((f) => f.key !== 'std:number')])
      .filter(([, fields]) => fields.length > 0);

    main.innerHTML = `
      <div class="card">
        <div class="row-actions" style="margin-bottom:.75rem">
          <button type="button" id="backMatters">← Matters</button>
        </div>
        <h1>${escapeHtml(m.name || 'Matter')}</h1>
      </div>

      <form id="matterForm" class="card stack">
        ${sections.map(([section, fields]) => `
          <div class="grid two">
            ${fields.map((f) => `
              <label class="${f.width === 'full' ? 'span-all' : ''}">
                ${escapeHtml(f.label)}${f.required ? ' *' : ''}
                ${renderFieldInput(f, fieldCtx)}
              </label>`).join('')}
          </div>
        `).join('') || '<p class="muted">No fields on this matter yet. Add one under Manage fields.</p>'}
        ${canEdit ? `
          <div class="row-actions">
            <button class="primary" type="submit">Save matter fields</button>
          </div>` : ''}
        <div id="matterMsg">${matterFlash ? `<div class="ok-banner">${escapeHtml(matterFlash)}</div>` : ''}</div>
      </form>

      <div class="card">
        <h2>Add time</h2>
        <p class="hint">Log time on this matter. Time-entry custom fields appear here when added in Settings.</p>
        <form id="matterTimeForm" class="grid two">
          <input type="hidden" name="matterId" value="${Number(m.id)}" />
          ${timeEntryFormFieldsHtml({
            formDate,
            formHours,
            formDescription,
            formTimekeeperId,
            timeFieldDefs,
          })}
        </form>
        <div id="matterTimeMsg" style="margin-top:.75rem">${flash ? `<div class="ok-banner">${escapeHtml(flash)}</div>` : ''}</div>
        <h2 style="margin-top:1.25rem">Recent on this matter</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Timekeeper</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>
            ${(matterEntries || []).slice(0, 20).map((e) => {
              const statusLabel = e.status === 'approved' ? 'Ready to bill'
                : e.status === 'invoiced' ? 'Billed'
                  : e.status;
              return `
              <tr>
                <td>${escapeHtml(e.service_date)}</td>
                <td>${escapeHtml(e.timekeeper_name || '')}<div class="muted">${escapeHtml(e.description)}</div></td>
                <td><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">hrs</span></td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
              </tr>`;
            }).join('') || '<tr><td colspan="4" class="muted">No time on this matter yet</td></tr>'}
          </tbody>
        </table></div>
      </div>

      <div class="card stack">
        <h2>Time reports</h2>
        <p class="hint">Run Lodestar Detail or Summary for this matter.</p>
        <div id="matterReportMsg"></div>
        ${matterReports.map(([id, label, hint]) => `
          <div class="report-row">
            <div>
              <strong>${label}</strong>
              <div class="muted">${hint}</div>
            </div>
            <button type="button" data-matter-report="${id}" data-format="pdf">PDF</button>
            <button type="button" data-matter-report="${id}" data-format="xlsx">Excel</button>
            <button type="button" data-view-matter-report="${id}">View</button>
          </div>`).join('')}
        <div id="matterReportOut" hidden></div>
      </div>

      ${canEdit ? `
      <div class="card stack">
        <h2>Manage fields</h2>
        <p class="hint">Add custom fields with a label and type. Firm-wide defaults are managed in Settings.</p>

        <div class="field-mgmt-list">
          ${fieldMgmtRows(page.layoutFields)}
        </div>
        <form id="recordFieldForm" class="grid two">
          <label>Custom field label
            <input name="label" required placeholder="e.g. Case stage" />
          </label>
          <label>Custom field type
            <select name="fieldType">
              ${fieldFormatterOptions('text')}
            </select>
          </label>
          ${dropdownOptionsFieldHtml()}
          ${requiredFieldCheckboxHtml()}
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add field</button>
            ${page.layout.source !== 'record' ? '<button type="button" id="useRecordLayout">Use default layout</button>' : ''}
          </div>
        </form>
        <div id="matterFieldMsg"></div>
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

    const matterForm = $('#matterForm');
    if (matterForm && canEdit) {
      matterForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(matterForm);
        const patch = {};
        const customValues = {};
        for (const [key, value] of fd.entries()) {
          if (key.startsWith('cf_')) {
            customValues[key.slice(3)] = value;
          } else if (key === 'std:name') patch.name = value;
          else if (key === 'std:client') patch.clientId = Number(value);
          else if (key === 'std:matter_type') { /* fixed */ }
          else if (key === 'std:status') patch.status = value;
          else if (key === 'std:jurisdiction') patch.jurisdiction = value;
          else if (key === 'std:court') patch.court = value;
          else if (key === 'std:responsible_attorney') {
            patch.responsibleAttorneyId = value ? Number(value) : null;
          } else if (key === 'std:opened_on') patch.openedOn = value;
        }
        matterForm.querySelectorAll('input[type="checkbox"][name^="cf_"]').forEach((cb) => {
          customValues[cb.name.slice(3)] = cb.checked ? '1' : '0';
        });
        patch.customValues = customValues;
        try {
          await api(`/api/matters/${m.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          state.matterFieldFlash = 'Matter fields saved.';
          await renderMatterDetail();
          await refreshRefs();
        } catch (e) {
          $('#matterMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    wireTimeEntrySubmit($('#matterTimeForm'), {
      msgEl: $('#matterTimeMsg'),
      timeFieldDefs,
      fixedMatterId: m.id,
      onSaved: async (entry, body) => {
        let msg = `Saved #${entry.id}: ${formatDuration(entry.roundedMinutes)} hrs — ready for Billing.`;
        if (entry.duplicateWarnings?.length) {
          msg += ` Duplicate warning vs entries ${entry.duplicateWarnings.join(', ')}.`;
        }
        state.matterTimeFlash = msg;
        state.matterTimeRetain = {
          addAnother: true,
          serviceDate: body.serviceDate,
          timekeeperId: body.timekeeperId,
        };
        await renderMatterDetail();
        const desc = $('#matterTimeForm')?.querySelector('textarea[name="description"]');
        if (desc) setTimeout(() => desc.focus(), 0);
      },
    });

    const downloadMatterTimeReport = async (reportId, format) => {
      try {
        const res = await api(`/api/reports/${reportId}?matterId=${m.id}&format=${format}`);
        const blob = await res.blob();
        const slug = String(m.name || m.id).replace(/[^\w.-]+/g, '_').slice(0, 40);
        const kind = reportId.includes('summary') ? 'lodestar-summary' : 'lodestar-detail';
        const tmp = document.createElement('a');
        tmp.href = URL.createObjectURL(blob);
        tmp.download = `${kind}-${slug}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
        document.body.appendChild(tmp);
        tmp.click();
        tmp.remove();
        URL.revokeObjectURL(tmp.href);
        $('#matterReportMsg').innerHTML = '';
      } catch (e) {
        $('#matterReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };

    main.querySelectorAll('[data-matter-report]').forEach((b) => {
      b.onclick = () => downloadMatterTimeReport(b.dataset.matterReport, b.dataset.format);
    });

    main.querySelectorAll('[data-view-matter-report]').forEach((b) => {
      b.onclick = async () => {
        try {
          const reportId = b.dataset.viewMatterReport;
          const data = await api(`/api/reports/${reportId}?matterId=${m.id}`);
          const out = $('#matterReportOut');
          out.hidden = false;
          const summary = data.summary || [];
          const isDetail = reportId === 'lodestar-matter-detail';
          if (isDetail) {
            const entries = (data.timekeepers || []).flatMap((g) =>
              (g.entries || []).map((e) => ({ ...e, timekeeper: e.timekeeper || g.timekeeper }))
            );
            out.innerHTML = `
              <h2>Lodestar Detail</h2>
              <div class="table-wrap"><table>
                <thead><tr><th>Date</th><th>Timekeeper</th><th>Hours</th><th>Amount</th><th>Description</th></tr></thead>
                <tbody>
                  ${entries.map((e) => `
                    <tr>
                      <td>${escapeHtml(e.service_date || '')}</td>
                      <td>${escapeHtml(e.timekeeper || '')}</td>
                      <td>${escapeHtml(formatDuration(e.minutes))}</td>
                      <td>${money(e.amount_cents)}</td>
                      <td>${escapeHtml(e.description || '')}</td>
                    </tr>`).join('') || '<tr><td colspan="5" class="muted">No billable time yet</td></tr>'}
                </tbody>
              </table></div>
              <p><strong>Total</strong> ${escapeHtml(formatDuration(data.totals?.minutes || 0))}
                · ${money(data.totals?.amount_cents || 0)}</p>`;
          } else {
            out.innerHTML = `
              <h2>Lodestar Summary</h2>
              <div class="table-wrap"><table>
                <thead><tr><th>Timekeeper</th><th>Role</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
                <tbody>
                  ${summary.map((s) => `
                    <tr>
                      <td>${escapeHtml(s.timekeeper)}</td>
                      <td>${escapeHtml(s.role || '')}</td>
                      <td>${escapeHtml(formatDuration(s.minutes))}</td>
                      <td>${money(s.rate_cents)}</td>
                      <td>${money(s.amount_cents)}</td>
                    </tr>`).join('') || '<tr><td colspan="5" class="muted">No billable time yet</td></tr>'}
                </tbody>
              </table></div>
              <p><strong>Total</strong> ${escapeHtml(formatDuration(data.totals?.minutes || 0))}
                · ${money(data.totals?.amount_cents || 0)}</p>`;
          }
          $('#matterReportMsg').innerHTML = '';
        } catch (e) {
          $('#matterReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

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

    const rf = $('#recordFieldForm');
    wireDropdownOptionsToggle(rf);
    if (rf) {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        const { fieldType, options, body } = customFieldPayload(fd);
        if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
          $('#matterFieldMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
          return;
        }
        try {
          await api(`/api/matters/${m.id}/custom-fields`, {
            method: 'POST',
            body: JSON.stringify(body),
          });
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
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
    const [entries, settings, matters, timeFields] = await Promise.all([
      api('/api/time-entries'),
      api('/api/settings'),
      api('/api/matters'),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
    ]);
    state.settings = settings;
    state.matters = matters;
    const today = new Date().toISOString().slice(0, 10);
    const retain = state.timeEntryRetain || {};
    const addAnother = !!retain.addAnother;
    const preferredMatterId = retain.matterId
      || state.matterId
      || (matters.length === 1 ? matters[0].id : null);
    const formDate = retain.serviceDate || today;
    const formTimekeeperId = retain.timekeeperId || state.user.id;
    const formHours = addAnother ? '' : '1.00';
    const formDescription = addAnother ? '' : 'Reviewed production set';
    const flash = state.timeFlash || '';
    state.timeFlash = '';
    state.timeEntryRetain = null;
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
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
            })}
            <span class="hint">Type to filter by matter name or client.</span>
          </div>
          ${timeEntryFormFieldsHtml({
            formDate,
            formHours,
            formDescription,
            formTimekeeperId,
            timeFieldDefs,
          })}
        </form>
        <div id="timeMsg" style="margin-top:.75rem">${flash ? `<div class="ok-banner">${escapeHtml(flash)}</div>` : ''}</div>
      </div>
      <div class="card">
        <h2>Recent entries</h2>
        <p class="hint">Saved time is ready for Billing automatically — no approval step.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Matter</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>
            ${entries.slice(0, 30).map((e) => {
              const matterName = (matters.find((m) => Number(m.id) === Number(e.matter_id)) || {}).name
                || e.matter_number
                || '—';
              const statusLabel = e.status === 'approved' ? 'Ready to bill'
                : e.status === 'invoiced' ? 'Billed'
                  : e.status;
              return `
              <tr>
                <td>${escapeHtml(e.service_date)}</td>
                <td>${escapeHtml(matterName)}<div class="muted">${escapeHtml(e.description)}</div></td>
                <td><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">hrs</span></td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
              </tr>`;
            }).join('') || '<tr><td colspan="4" class="muted">No entries yet</td></tr>'}
          </tbody>
        </table></div>
      </div>`;

    const matterPicker = wireMatterPicker($('#timeForm'), { matters });
    wireTimeEntrySubmit($('#timeForm'), {
      msgEl: $('#timeMsg'),
      timeFieldDefs,
      matterPicker,
      onSaved: async (entry, body) => {
        let msg = `Saved #${entry.id}: ${formatDuration(entry.roundedMinutes)} hrs — ready for Billing. Add another entry below.`;
        if (entry.duplicateWarnings?.length) {
          msg += ` Duplicate warning vs entries ${entry.duplicateWarnings.join(', ')}.`;
        }
        state.matterId = body.matterId;
        state.timeEntryRetain = {
          addAnother: true,
          matterId: body.matterId,
          serviceDate: body.serviceDate,
          timekeeperId: body.timekeeperId,
        };
        state.focusTimeEntry = true;
        state.timeFlash = msg;
        await renderTime();
      },
    });

    if (state.focusTimeEntry) {
      state.focusTimeEntry = false;
      const form = $('#timeForm');
      const preferDescription = addAnother;
      setTimeout(() => {
        if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
        if (!preferredMatterId) matterPicker?.focus();
        else if (preferDescription) {
          const desc = form && form.querySelector('textarea[name="description"]');
          if (desc) desc.focus();
        } else {
          const hours = form && form.querySelector('input[name="hours"]');
          if (hours) hours.focus();
        }
      }, 0);
    }
  }

  function invoiceStageLabel(status) {
    const map = {
      prebill: 'Draft',
      in_review: 'Draft',
      approved: 'Draft',
      sent: 'Billed',
      void: 'Void',
    };
    return map[status] || status;
  }

  async function renderBilling() {
    const canBill = ['admin', 'billing_clerk'].includes(state.user.role);
    const [invoices, matters, ready] = await Promise.all([
      api('/api/invoices'),
      api('/api/matters'),
      canBill ? api('/api/billing/ready').catch(() => []) : Promise.resolve([]),
    ]);
    state.matters = matters;
    const readyIds = new Set((ready || []).map((r) => Number(r.id)));
    main.innerHTML = `
      <div class="card stack">
        <h1>Billing</h1>
        <p class="lead">Create a bill from saved time in one step.</p>
        ${canBill ? `
        <form id="billForm" class="grid two">
          <div class="field span-all">
            <span class="field-label">Matter</span>
            ${renderMatterPicker({
              name: 'matterId',
              selectedId: ready?.[0]?.id || null,
              matters: matters.filter((m) => readyIds.has(Number(m.id))).concat(
                matters.filter((m) => !readyIds.has(Number(m.id)))
              ),
            })}
            <span class="hint">${(ready || []).length
              ? `${ready.length} matter${ready.length === 1 ? '' : 's'} with time ready to bill.`
              : 'Save time on Time Entry first, then create a bill here.'}</span>
          </div>
          <div class="row-actions span-all">
            <button class="primary" type="submit" ${(ready || []).length ? '' : 'disabled'}>Create bill</button>
          </div>
        </form>` : '<div class="error">Only admins and billing clerks can create bills.</div>'}
        <div id="billMsg"></div>
      </div>
      ${(ready || []).length ? `
      <div class="card">
        <h2>Ready to bill</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Matter</th><th>Entries</th><th>Time</th></tr></thead>
          <tbody>
            ${ready.map((r) => `
              <tr>
                <td>${escapeHtml(r.name)}<div class="muted">${escapeHtml(r.client_name || '')}</div></td>
                <td>${r.entry_count}</td>
                <td>${escapeHtml(formatDuration(r.minutes))} <span class="muted">(${r.minutes} min)</span></td>
              </tr>`).join('')}
          </tbody>
        </table></div>
      </div>` : ''}
      <div class="card">
        <h2>Bills</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Number</th><th>Matter</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${invoices.map((i) => `
              <tr>
                <td>${escapeHtml(i.number)}</td>
                <td>${escapeHtml(i.matter_name || i.matter_number)}<div class="muted">${escapeHtml(i.client_name || '')}</div></td>
                <td><span class="pill" data-status="${escapeHtml(i.status)}">${escapeHtml(invoiceStageLabel(i.status))}</span></td>
                <td>${money(i.total_cents)}</td>
                <td><button data-open="${i.id}">Open</button></td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No bills yet</td></tr>'}
          </tbody>
        </table></div>
      </div>
      <div id="invoiceDetail"></div>`;

    if (canBill) {
      const billMatterPicker = wireMatterPicker($('#billForm'), { matters });
      $('#billForm').onsubmit = async (ev) => {
        ev.preventDefault();
        const matterId = Number(new FormData(ev.target).get('matterId'));
        if (!matterId) {
          billMatterPicker?.setInvalid(true);
          $('#billMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
          billMatterPicker?.focus();
          return;
        }
        try {
          const inv = await api('/api/invoices/bill', {
            method: 'POST',
            body: JSON.stringify({ matterId }),
          });
          $('#billMsg').innerHTML = `<div class="ok-banner">Bill ${escapeHtml(inv.number)} created.</div>`;
          await renderBilling();
          await showInvoice(inv.id);
        } catch (e) {
          $('#billMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
    main.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = () => showInvoice(Number(b.dataset.open));
    });
  }

  async function showInvoice(id) {
    const inv = await api(`/api/invoices/${id}`);
    const el = $('#invoiceDetail');
    if (!el) return;
    const canBill = ['admin', 'billing_clerk'].includes(state.user.role);
    el.innerHTML = `
      <div class="card stack">
        <h2>${escapeHtml(inv.number)}
          <span class="pill" data-status="${escapeHtml(inv.status)}">${escapeHtml(invoiceStageLabel(inv.status))}</span>
        </h2>
        <p class="muted">${escapeHtml(inv.client_name || '')} · ${escapeHtml(inv.matter_name || inv.matter_number || '')}
          · Subtotal ${money(inv.subtotal_cents)}
          · Total ${money(inv.total_cents)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Timekeeper</th><th>Hours</th><th>Rate</th><th>Amount</th></tr></thead>
          <tbody>
            ${(inv.lines || []).map((l) => `
              <tr>
                <td>${escapeHtml(l.service_date)}<div class="muted">${escapeHtml(l.description || '')}</div></td>
                <td>${escapeHtml(l.timekeeper_name || '')}</td>
                <td>${escapeHtml(formatDuration(l.minutes))}</td>
                <td>${money(l.rate_cents)}</td>
                <td>${money(l.amount_cents)}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No lines</td></tr>'}
          </tbody>
        </table></div>
        <div class="row-actions">
          <button type="button" class="primary" data-export-invoice="pdf">Download PDF</button>
          <button type="button" data-export-invoice="xlsx">Download Excel</button>
        </div>
        <div class="row-actions" id="invActions"></div>
        <div id="invMsg"></div>
      </div>`;

    el.querySelectorAll('[data-export-invoice]').forEach((b) => {
      b.onclick = async () => {
        try {
          const fmt = b.dataset.exportInvoice;
          const res = await api(`/api/invoices/${id}/export?format=${fmt}`);
          const blob = await res.blob();
          const tmp = document.createElement('a');
          tmp.href = URL.createObjectURL(blob);
          tmp.download = `${inv.number || `invoice-${id}`}.${fmt === 'xlsx' ? 'xlsx' : 'pdf'}`;
          document.body.appendChild(tmp);
          tmp.click();
          tmp.remove();
          URL.revokeObjectURL(tmp.href);
        } catch (e) {
          $('#invMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    const actions = $('#invActions');
    // Legacy draft invoices (pre-simple-billing) can still be issued or voided.
    if (canBill && actions && ['prebill', 'in_review', 'approved'].includes(inv.status)) {
      const issue = document.createElement('button');
      issue.textContent = 'Issue bill';
      issue.className = 'primary';
      issue.onclick = async () => {
        try {
          await api(`/api/invoices/${id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: 'sent' }),
          });
          await renderBilling();
          await showInvoice(id);
        } catch (e) {
          $('#invMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
      actions.appendChild(issue);
      const voidBtn = document.createElement('button');
      voidBtn.textContent = 'Void';
      voidBtn.onclick = async () => {
        try {
          await api(`/api/invoices/${id}/status`, {
            method: 'POST',
            body: JSON.stringify({ status: 'void' }),
          });
          await renderBilling();
          await showInvoice(id);
        } catch (e) {
          $('#invMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
      actions.appendChild(voidBtn);
    }
  }

  function chartPalette(i) {
    const colors = ['#184e4a', '#2f6f6a', '#c45c26', '#8a6d3b', '#3d5a80', '#6b4f4f', '#4a6741', '#5c4d7a'];
    return colors[i % colors.length];
  }

  function formatReportValue(metric, value, row) {
    if (metric === 'hours') return Number(value || 0).toFixed(2);
    if (metric === 'amount') return money(Math.round((row?.amount_cents != null ? row.amount_cents : value * 100) || 0));
    return String(Math.round(value || 0));
  }

  function renderBarChart(rows, { metric, valueLabel }) {
    const width = 420;
    const height = 220;
    const padL = 44;
    const padR = 12;
    const padT = 16;
    const padB = 56;
    const data = (rows || []).slice(0, 8);
    if (!data.length) {
      return '<p class="muted">No data yet for this report.</p>';
    }
    const max = Math.max(...data.map((r) => Number(r.value) || 0), 0.0001);
    const barW = (width - padL - padR) / data.length;
    const bars = data.map((r, i) => {
      const h = ((Number(r.value) || 0) / max) * (height - padT - padB);
      const x = padL + i * barW + barW * 0.15;
      const y = height - padB - h;
      const w = barW * 0.7;
      const label = String(r.label || '').slice(0, 12);
      return `
        <rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(h, 0).toFixed(1)}"
          fill="${chartPalette(i)}" rx="3"></rect>
        <text x="${(x + w / 2).toFixed(1)}" y="${height - 34}" text-anchor="middle" class="chart-axis">${escapeHtml(label)}</text>
        <text x="${(x + w / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" text-anchor="middle" class="chart-val">${escapeHtml(formatReportValue(metric, r.value, r))}</text>`;
    }).join('');
    return `
      <svg class="report-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(valueLabel || 'Chart')}">
        <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${height - padB}" class="chart-grid"></line>
        <line x1="${padL}" y1="${height - padB}" x2="${width - padR}" y2="${height - padB}" class="chart-grid"></line>
        ${bars}
      </svg>`;
  }

  function renderPieChart(rows, { metric, valueLabel }) {
    const data = (rows || []).filter((r) => Number(r.value) > 0).slice(0, 8);
    if (!data.length) {
      return '<p class="muted">No data yet for this report.</p>';
    }
    const total = data.reduce((s, r) => s + (Number(r.value) || 0), 0) || 1;
    const cx = 110;
    const cy = 110;
    const radius = 78;
    let angle = -Math.PI / 2;
    const slices = data.map((r, i) => {
      const portion = (Number(r.value) || 0) / total;
      const sweep = portion * Math.PI * 2;
      const x1 = cx + radius * Math.cos(angle);
      const y1 = cy + radius * Math.sin(angle);
      angle += sweep;
      const x2 = cx + radius * Math.cos(angle);
      const y2 = cy + radius * Math.sin(angle);
      const large = sweep > Math.PI ? 1 : 0;
      const d = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2} Z`;
      return `<path d="${d}" fill="${chartPalette(i)}"></path>`;
    }).join('');
    const legend = data.map((r, i) => `
      <div class="chart-legend-item">
        <span class="chart-swatch" style="background:${chartPalette(i)}"></span>
        <span>${escapeHtml(r.label)}</span>
        <strong>${escapeHtml(formatReportValue(metric, r.value, r))}</strong>
      </div>`).join('');
    return `
      <div class="pie-wrap">
        <svg class="report-chart pie" viewBox="0 0 220 220" role="img" aria-label="${escapeHtml(valueLabel || 'Chart')}">
          ${slices}
        </svg>
        <div class="chart-legend">${legend}</div>
      </div>`;
  }

  function renderFirmTable(payload) {
    const { rows, columns, error } = payload;
    if (error) return `<div class="error">${escapeHtml(error)}</div>`;
    const cols = columns && columns.length
      ? columns
      : (rows && rows[0] ? Object.keys(rows[0]) : []);
    if (!cols.length) return '<p class="muted">No rows</p>';
    const currencyKeys = new Set([
      'amount_cents', 'rate_cents', 'balance_cents', 'wip_cents',
      'billed_cents', 'write_down_cents', 'net_billed_cents', 'collected_cents', 'delta_cents',
    ]);
    const fmtCell = (key, value) => {
      if (value == null || value === '') return '';
      if (currencyKeys.has(key) && Number.isInteger(value)) return money(value);
      if (typeof value === 'number' && !Number.isInteger(value)) {
        return String(Math.round(value * 100) / 100);
      }
      return String(value);
    };
    const label = (key) => String(key || '')
      .replace(/_cents$/i, '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (c) => c.toUpperCase());
    return `
      <div class="custom-report-result">
        <div class="table-wrap"><table>
          <thead><tr>${cols.map((c) => `<th>${escapeHtml(label(c))}</th>`).join('')}</tr></thead>
          <tbody>
            ${(rows || []).map((r) => `
              <tr>${cols.map((c) => `<td>${escapeHtml(fmtCell(c, r[c]))}</td>`).join('')}</tr>
            `).join('') || `<tr><td colspan="${cols.length}" class="muted">No rows</td></tr>`}
          </tbody>
        </table></div>
        <p class="muted">${(rows || []).length} row${(rows || []).length === 1 ? '' : 's'}</p>
      </div>`;
  }

  function renderReportResult(payload) {
    if (payload.kind === 'firm' || payload.report?.kind === 'firm') {
      return renderFirmTable(payload);
    }
    const { report, rows, totals, valueLabel, error } = payload;
    if (error) return `<div class="error">${escapeHtml(error)}</div>`;
    const metric = report.metric;
    let visual = '';
    if (report.chartType === 'pie') visual = renderPieChart(rows, { metric, valueLabel });
    else if (report.chartType === 'bar') visual = renderBarChart(rows, { metric, valueLabel });
    else visual = '';
    const totalDisplay = metric === 'hours'
      ? Number(totals.hours || 0).toFixed(2)
      : metric === 'amount'
        ? money(totals.amount_cents || 0)
        : String(totals.count || 0);
    return `
      <div class="custom-report-result">
        ${visual}
        <div class="table-wrap"><table>
          <thead><tr><th>${escapeHtml(report.groupByLabel || 'Group')}</th><th>${escapeHtml(valueLabel || 'Value')}</th><th>Count</th></tr></thead>
          <tbody>
            ${(rows || []).map((r) => `
              <tr>
                <td>${escapeHtml(r.label)}</td>
                <td>${escapeHtml(formatReportValue(metric, r.value, r))}</td>
                <td>${r.count}</td>
              </tr>`).join('') || '<tr><td colspan="3" class="muted">No rows</td></tr>'}
          </tbody>
        </table></div>
        <p><strong>Total ${escapeHtml(valueLabel || '')}</strong> ${escapeHtml(totalDisplay)}</p>
      </div>`;
  }

  async function downloadDashboardExport(format) {
    const res = await fetch(`/api/dashboard/export?format=${encodeURIComponent(format)}`, {
      headers: { Authorization: `Bearer ${state.token}` },
      credentials: 'include',
    });
    if (!res.ok) {
      let message = res.statusText;
      try {
        const data = await res.json();
        message = data.message || data.error || message;
      } catch { /* ignore */ }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const tmp = document.createElement('a');
    tmp.href = url;
    tmp.download = `dashboard-reports.${format === 'xlsx' ? 'xlsx' : format}`;
    tmp.click();
    URL.revokeObjectURL(url);
  }

  async function renderDashboard() {
    const data = await api('/api/dashboard');
    const widgets = data.widgets || [];
    const available = data.available || { firm: [], custom: [] };
    const canEdit = ['admin', 'billing_clerk', 'attorney'].includes(state.user.role);
    const addOptions = [
      ...(available.firm || []).map((r) =>
        `<option value="firm:${escapeHtml(r.id)}">${escapeHtml(r.name)} (firm)</option>`),
      ...(available.custom || []).map((r) =>
        `<option value="custom:${r.id}">${escapeHtml(r.name)} (custom)</option>`),
    ].join('');

    const widgetMeta = (w) => {
      if (w.kind === 'firm') return 'Firm report';
      return `${w.report.groupByLabel || ''} · ${w.valueLabel || ''} · ${
        w.report.source === 'time_entry' ? 'Time' : 'Matters'
      }`;
    };

    main.innerHTML = `
      <div class="card stack">
        <h1>Dashboard</h1>
        <p class="lead">Pin firm or custom reports here, then export the full dashboard.</p>
        <div class="row-actions dashboard-toolbar">
          <button type="button" data-dash-export="pdf">Export PDF</button>
          <button type="button" data-dash-export="csv">Export CSV</button>
          <button type="button" data-dash-export="xlsx">Export Excel</button>
        </div>
        <div id="dashMsg"></div>
        ${canEdit ? `
        <form id="dashAddForm" class="dashboard-add-form">
          <label class="span-grow">Add report
            <select name="reportKey" required ${addOptions ? '' : 'disabled'}>
              ${addOptions || '<option value="">No reports available to add</option>'}
            </select>
          </label>
          <button class="primary" type="submit" ${addOptions ? '' : 'disabled'}>Add to dashboard</button>
        </form>
        <p class="hint">Create more custom reports on the Reports page. Firm reports can also be run from Reports.</p>` : ''}
      </div>
      ${widgets.length ? `
        <div class="dashboard-grid">
          ${widgets.map((w) => `
            <div class="card dashboard-widget" data-kind="${escapeHtml(w.kind || 'custom')}" data-report-id="${escapeHtml(String(w.report.id))}">
              <div class="dashboard-widget-head">
                <div>
                  <h2>${escapeHtml(w.report.name)}</h2>
                  <p class="muted">${escapeHtml(widgetMeta(w))}</p>
                </div>
                <div class="row-actions">
                  ${w.kind === 'custom' ? `<button type="button" data-open-report="${w.report.id}">Open</button>` : `
                    <button type="button" data-view-firm="${escapeHtml(String(w.report.id))}">Open</button>`}
                  ${canEdit ? `<button type="button" data-unpin-kind="${escapeHtml(w.kind || 'custom')}" data-unpin-id="${escapeHtml(String(w.report.id))}">Remove</button>` : ''}
                </div>
              </div>
              ${renderReportResult(w)}
            </div>`).join('')}
        </div>` : `
        <div class="card">
          <p class="muted">No dashboard reports yet.${canEdit ? ' Use Add report above, or create a custom report on Reports with “Show on dashboard” checked.' : ''}</p>
        </div>`}`;

    const dashMsg = $('#dashMsg');
    main.querySelectorAll('[data-dash-export]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await downloadDashboardExport(btn.dataset.dashExport);
          if (dashMsg) dashMsg.innerHTML = '<div class="ok-banner">Export downloaded.</div>';
        } catch (e) {
          if (dashMsg) dashMsg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    const addForm = $('#dashAddForm');
    if (addForm) {
      addForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const key = String(new FormData(addForm).get('reportKey') || '');
        const [kind, ...rest] = key.split(':');
        const id = rest.join(':');
        try {
          await api('/api/dashboard/pin', {
            method: 'POST',
            body: JSON.stringify({ kind, id: kind === 'custom' ? Number(id) : id }),
          });
          await renderDashboard();
        } catch (e) {
          if (dashMsg) dashMsg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    main.querySelectorAll('[data-unpin-kind]').forEach((btn) => {
      btn.onclick = async () => {
        const kind = btn.dataset.unpinKind;
        const id = kind === 'custom' ? Number(btn.dataset.unpinId) : btn.dataset.unpinId;
        try {
          await api('/api/dashboard/unpin', {
            method: 'POST',
            body: JSON.stringify({ kind, id }),
          });
          await renderDashboard();
        } catch (e) {
          if (dashMsg) dashMsg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    main.querySelectorAll('[data-open-report]').forEach((btn) => {
      btn.onclick = () => {
        state.view = 'reports';
        state.focusCustomReportId = Number(btn.dataset.openReport);
        renderShell();
        renderView();
      };
    });
    main.querySelectorAll('[data-view-firm]').forEach((btn) => {
      btn.onclick = () => {
        state.view = 'reports';
        state.focusFirmReportId = btn.dataset.viewFirm;
        renderShell();
        renderView();
      };
    });
  }

  async function renderReports() {
    const [customReportList, matterFields, timeFields] = await Promise.all([
      api('/api/custom-reports').catch(() => []),
      api('/api/custom-fields?appliesTo=matter&type=default').catch(() => []),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
    ]);
    const canEditReports = ['admin', 'billing_clerk', 'attorney'].includes(state.user.role);
    const firmReports = [
      ['matters', 'Matters'],
      ['lodestar-summary', 'Lodestar Summary (all matters)'],
      ['lodestar-detail', 'Lodestar Detail (all matters)'],
    ];
    const fieldOptions = (fields) => (fields || []).map((f) =>
      `<option value="${f.id}">${escapeHtml(f.label)}</option>`
    ).join('');
    main.innerHTML = `
      <div class="card stack">
        <h1>Reports</h1>
        <p class="lead">Run firm Lodestar reports, or build custom reports from custom fields for the Dashboard.</p>

        <h2>Custom reports</h2>
        <p class="hint">Group matters or time by a custom field, then pin the result to the Dashboard.</p>
        ${canEditReports ? `
        <form id="customReportForm" class="grid two">
          <label>Report name
            <input name="name" required placeholder="e.g. Hours by case stage" />
          </label>
          <label>Source
            <select name="source" id="crSource">
              <option value="time_entry">Time entries</option>
              <option value="matter">Matters</option>
            </select>
          </label>
          <label>Group by custom field
            <select name="groupByFieldId" id="crField" required>
              ${fieldOptions(timeFields) || '<option value="">No time-entry fields yet</option>'}
            </select>
          </label>
          <label>Metric
            <select name="metric" id="crMetric">
              <option value="hours">Hours</option>
              <option value="amount">Amount</option>
              <option value="count">Count</option>
            </select>
          </label>
          <label>Chart
            <select name="chartType">
              <option value="bar">Bar</option>
              <option value="pie">Pie</option>
              <option value="table">Table only</option>
            </select>
          </label>
          <label class="check-inline">
            <input type="checkbox" name="showOnDashboard" checked />
            Show on dashboard
          </label>
          <label class="span-all">Description
            <input name="description" placeholder="Optional" />
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Create report</button>
          </div>
        </form>
        <div id="customReportMsg"></div>` : '<p class="muted">Ask an admin or attorney to create custom reports.</p>'}
        <div class="stack" id="customReportList">
          ${(customReportList || []).map((r) => `
            <div class="report-row" data-custom-report="${r.id}">
              <div>
                <strong>${escapeHtml(r.name)}</strong>
                <div class="muted">${escapeHtml(r.group_by_label)} · ${escapeHtml(r.metric)}
                  · ${escapeHtml(r.source === 'time_entry' ? 'Time' : 'Matters')}
                  ${r.show_on_dashboard ? ' · Dashboard' : ''}</div>
              </div>
              <button type="button" data-run-custom="${r.id}">View</button>
              ${canEditReports ? `<button type="button" data-del-custom="${r.id}">Remove</button>` : ''}
            </div>`).join('') || '<p class="muted">No custom reports yet.</p>'}
        </div>
        <div id="customReportOut" hidden></div>
      </div>

      <div class="card">
        <h2>Firm reports</h2>
        <p class="hint">Pin these to the Dashboard from the Dashboard page to include them in dashboard exports.</p>
        <div>
          ${firmReports.map(([id, label]) => `
            <div class="report-row" data-firm-report-row="${id}">
              <strong>${label}</strong>
              <button data-view-report="${id}">View</button>
              <a class="btn" href="/api/reports/${id}?format=pdf">PDF</a>
              <a class="btn" href="/api/reports/${id}?format=csv" target="_blank">CSV</a>
              <a class="btn" href="/api/reports/${id}?format=xlsx">Excel</a>
            </div>`).join('')}
        </div>
      </div>
      <div id="reportOut" class="card" hidden></div>`;

    const crSource = $('#crSource');
    const crField = $('#crField');
    const crMetric = $('#crMetric');
    const syncCustomReportFields = () => {
      if (!crSource || !crField) return;
      const source = crSource.value;
      const fields = source === 'matter' ? matterFields : timeFields;
      crField.innerHTML = fields.length
        ? fields.map((f) => `<option value="${f.id}">${escapeHtml(f.label)}</option>`).join('')
        : '<option value="">No custom fields for this source</option>';
      if (crMetric) {
        [...crMetric.options].forEach((opt) => {
          opt.hidden = source === 'matter' && opt.value !== 'count';
        });
        if (source === 'matter') crMetric.value = 'count';
      }
    };
    if (crSource) {
      crSource.onchange = syncCustomReportFields;
      syncCustomReportFields();
    }

    const customForm = $('#customReportForm');
    if (customForm) {
      customForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(customForm);
        try {
          await api('/api/custom-reports', {
            method: 'POST',
            body: JSON.stringify({
              name: fd.get('name'),
              description: fd.get('description'),
              source: fd.get('source'),
              groupByFieldId: Number(fd.get('groupByFieldId')),
              metric: fd.get('metric'),
              chartType: fd.get('chartType'),
              showOnDashboard: fd.get('showOnDashboard') === 'on',
            }),
          });
          $('#customReportMsg').innerHTML = '<div class="ok-banner">Custom report created.</div>';
          await renderReports();
        } catch (e) {
          $('#customReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const showCustomRun = async (id) => {
      try {
        const payload = await api(`/api/custom-reports/${id}/run`);
        const out = $('#customReportOut');
        out.hidden = false;
        out.innerHTML = `
          <h2>${escapeHtml(payload.report.name)}</h2>
          <p class="muted">${escapeHtml(payload.report.description || '')}</p>
          ${renderReportResult(payload)}`;
        out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        $('#customReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };

    main.querySelectorAll('[data-run-custom]').forEach((b) => {
      b.onclick = () => showCustomRun(Number(b.dataset.runCustom));
    });
    main.querySelectorAll('[data-del-custom]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/custom-reports/${b.dataset.delCustom}`, { method: 'DELETE' });
          await renderReports();
        } catch (e) {
          $('#customReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    if (state.focusCustomReportId) {
      const focusId = state.focusCustomReportId;
      state.focusCustomReportId = null;
      showCustomRun(focusId);
    }

    // Auth header for download links via fetch+blob for pdf/xlsx/csv when needed
    main.querySelectorAll('a.btn').forEach((a) => {
      a.onclick = async (ev) => {
        ev.preventDefault();
        const href = a.getAttribute('href') || '';
        const res = await fetch(href, {
          headers: { Authorization: `Bearer ${state.token}` },
          credentials: 'include',
        });
        if (!res.ok) {
          let message = res.statusText;
          try {
            const data = await res.json();
            message = data.message || data.error || message;
          } catch { /* ignore */ }
          const out = $('#reportOut');
          if (out) {
            out.hidden = false;
            out.innerHTML = `<div class="error">${escapeHtml(message)}</div>`;
          }
          return;
        }
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const tmp = document.createElement('a');
        tmp.href = url;
        const ext = href.includes('format=pdf') ? 'pdf'
          : href.includes('xlsx') ? 'xlsx'
            : 'csv';
        const nameMatch = href.match(/\/api\/reports\/([^?]+)/);
        tmp.download = `${nameMatch?.[1] || 'report'}.${ext}`;
        tmp.click();
        URL.revokeObjectURL(url);
      };
    });

    const showFirmReport = async (reportId) => {
      const rows = await api(`/api/reports/${reportId}`);
      const out = $('#reportOut');
      out.hidden = false;
      const title = firmReports.find(([id]) => id === reportId)?.[1] || reportId;
      if (!rows.length) {
        out.innerHTML = `<h2>${escapeHtml(title)}</h2><p class="muted">No rows</p>`;
        return;
      }
      const keys = Object.keys(rows[0]);
      out.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        <div class="table-wrap"><table>
          <thead><tr>${keys.map((k) => `<th>${escapeHtml(k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${rows.map((r) => `<tr>${keys.map((k) => {
              const v = r[k];
              if (String(k).endsWith('_cents') && Number.isInteger(v)) return `<td>${money(v)}</td>`;
              return `<td>${escapeHtml(v == null ? '' : String(v))}</td>`;
            }).join('')}</tr>`).join('')}
          </tbody>
        </table></div>`;
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    main.querySelectorAll('[data-view-report]').forEach((b) => {
      b.onclick = () => showFirmReport(b.dataset.viewReport);
    });

    if (state.focusFirmReportId) {
      const firmId = state.focusFirmReportId;
      state.focusFirmReportId = null;
      showFirmReport(firmId);
    }
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
        <p class="lead">Matter and time fields, plus billing preferences${isAdmin ? ', email, and integrations' : ''}.</p>
        ${canEditBilling ? '' : '<div class="error">Sign in as an admin (avery@firm.example) or billing clerk (billie@firm.example) to edit these settings.</div>'}
      </div>

      ${canConfigureFields ? `
      <div class="card stack" id="defaultFieldsCard">
        <h2>Matter fields</h2>
        <p class="hint">Shown on every matter. Add a custom field with a label and type.</p>
        <div id="defaultFieldsBody" class="stack"></div>
        <div id="typeFieldMsg"></div>
      </div>
      <div class="card stack" id="timeFieldsCard">
        <h2>Time entry fields</h2>
        <p class="hint">Shown when logging time. Custom fields apply to all time entries.</p>
        <div id="timeFieldsBody" class="stack"></div>
        <div id="timeFieldMsg"></div>
      </div>` : ''}

      <form id="settingsForm" class="card stack">
        <h2>Time and Billing</h2>
        <p class="hint">Duration display and rounding for new time entries.</p>

        <details class="onedrive-collapse settings-collapse">
          <summary class="onedrive-collapse-summary">
            <span class="onedrive-collapse-title">Duration &amp; rounding</span>
            <span class="onedrive-collapse-meta muted">${escapeHtml(settings.durationFormat || '')} · ${escapeHtml(settings.roundMode || '')}${settings.roundMode !== 'none' ? ` / ${settings.roundIncrementMinutes}m` : ''}</span>
          </summary>
          <div class="onedrive-collapse-body">
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
          </div>
        </details>
        <div id="settingsMsg"></div>
      </form>

      ${isAdmin ? `
      <details class="onedrive-collapse settings-collapse" id="emailSettingsCard">
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">Email</span>
          <span class="onedrive-collapse-meta muted">${settings.email?.configured ? 'Ready' : 'Not configured'}</span>
        </summary>
        <div class="onedrive-collapse-body stack">
        <p class="lead">Deliver invite, reset, and sign-in messages to Gmail, Outlook, and other inboxes.</p>
        ${settings.email?.configured
          ? `<div class="ok-banner">${escapeHtml(settings.email.message || 'Email is ready.')}</div>`
          : `<div class="error">${escapeHtml(settings.email?.message || 'Email is not ready yet — messages only show on-screen links until you configure a provider.')}</div>`}
        <form id="emailResendForm" class="grid two">
          <label class="span-all">Resend API key
            <input name="apiKey" type="password" autocomplete="off"
              placeholder="${settings.email?.hasApiKey ? 'API key saved — paste a new key to replace' : 're_…'}" />
          </label>
          <label>From address
            <input name="from" type="email" autocomplete="off"
              value="${escapeHtml(settings.email?.fromAddress || '')}"
              placeholder="onboarding@resend.dev" />
          </label>
          <label>From name
            <input name="fromName" type="text" autocomplete="organization"
              value="${escapeHtml(settings.email?.fromName || 'Firm Billing')}"
              placeholder="Firm Billing" />
          </label>
          <p class="hint span-all">
            Get a free key at <a href="https://resend.com" target="_blank" rel="noopener noreferrer">resend.com</a>.
            Use <code>onboarding@resend.dev</code> for first tests; verify your domain in Resend for a firm from-address.
            Or connect Microsoft under OneDrive below (approve Mail.Send).
          </p>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Save email settings</button>
            <button type="button" id="emailTestBtn">Send me a test email</button>
          </div>
        </form>
        <div id="emailSettingsMsg"></div>
        </div>
      </details>` : ''}

      ${(isAdmin || state.user.role === 'billing_clerk') ? `
      <details class="onedrive-collapse settings-collapse" id="onedriveSettingsCard">
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">OneDrive / SharePoint</span>
          <span class="onedrive-collapse-meta muted">${settings.microsoft?.connected
            ? (settings.microsoft.accountLabel ? escapeHtml(settings.microsoft.accountLabel) : 'Connected')
            : 'Not connected'}</span>
        </summary>
        <div class="onedrive-collapse-body stack">
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
        </div>
      </details>` : ''}

      ${canEditBilling ? `
      <details class="onedrive-collapse settings-collapse" id="tkRatesSection" ${state.tkSearch.q ? 'open' : ''}>
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">Timekeepers &amp; Rates</span>
          <span class="onedrive-collapse-meta muted">${timekeepers.length} timekeeper${timekeepers.length === 1 ? '' : 's'}</span>
        </summary>
        <div class="onedrive-collapse-body stack">
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

        <form id="tkSearch" class="matter-search-bar" role="search">
          <input name="q" value="${escapeHtml(state.tkSearch.q || '')}"
            placeholder="Search by timekeeper…" aria-label="Search by timekeeper"
            autocomplete="off" />
          <button type="button" id="clearTkSearch">Clear</button>
        </form>

        <div class="table-wrap"><table>
          <thead>
            <tr><th>Timekeeper</th><th>Role</th><th>Current rate</th><th>Effective</th><th>Add rate change</th>${isAdmin ? '<th></th>' : ''}</tr>
          </thead>
          <tbody id="tkRatesBody">
            ${timekeepers.map((t) => {
              const roleLabel = String(t.role || '').replace(/_/g, ' ');
              const searchText = [t.name, t.email, roleLabel, t.role].filter(Boolean).join(' ').toLowerCase();
              return `
              <tr data-tk="${t.id}" data-tk-text="${escapeHtml(searchText)}">
                <td>${escapeHtml(t.name)}<div class="muted">${escapeHtml(t.email)}</div></td>
                <td>${escapeHtml(roleLabel)}</td>
                <td>${t.current_rate_cents == null ? '—' : `${money(t.current_rate_cents)}/hr`}</td>
                <td>${escapeHtml(t.current_effective_date || '—')}</td>
                <td>
                  <form class="rate-form row-actions" data-scope-id="${t.id}">
                    <input name="amount" class="rate-dollars" type="text" inputmode="decimal" placeholder="375.00" required style="width:6.5rem" />
                    <input name="effectiveDate" type="date" value="${today}" required />
                    <button type="submit">Add</button>
                  </form>
                  <details class="hint" style="margin-top:.4rem">
                    <summary>Rate history (${t.rates.length})</summary>
                    <ul>
                      ${t.rates.map((r) => `<li>${escapeHtml(r.effective_date)}: ${money(r.amount_cents)}/hr</li>`).join('') || '<li>None</li>'}
                    </ul>
                  </details>
                </td>
                ${isAdmin ? `
                <td>
                  <button type="button" data-send-reset="${t.id}">Email reset</button>
                </td>` : ''}
              </tr>`;
            }).join('') || `<tr data-tk-empty="1"><td colspan="${isAdmin ? 6 : 5}" class="muted">No timekeepers</td></tr>`}
            <tr data-tk-none hidden><td colspan="${isAdmin ? 6 : 5}" class="muted">No timekeepers match your search</td></tr>
          </tbody>
        </table></div>
        <div id="rateMsg"></div>
        </div>
      </details>` : ''}`;

    wireChoiceGroup(main, 'durationFormat');
    wireChoiceGroup(main, 'roundMode');

    if (canConfigureFields) {
      await bindDefaultFieldsEditor({
        bodyEl: $('#defaultFieldsBody'),
        msgEl: $('#typeFieldMsg'),
        recordTypeKey: 'default',
        appliesTo: 'matter',
      });
      await bindDefaultFieldsEditor({
        bodyEl: $('#timeFieldsBody'),
        msgEl: $('#timeFieldMsg'),
        appliesTo: 'time_entry',
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

    const emailResendForm = $('#emailResendForm');
    if (emailResendForm) {
      emailResendForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(emailResendForm);
        const apiKey = String(fd.get('apiKey') || '').trim();
        const from = String(fd.get('from') || '').trim();
        const fromName = String(fd.get('fromName') || '').trim();
        try {
          const emailConfig = { provider: 'resend', from, fromName, clearSmtp: true };
          if (apiKey) emailConfig.apiKey = apiKey;
          if (!apiKey && !settings.email?.hasApiKey) {
            throw new Error('Paste a Resend API key to enable inbox delivery.');
          }
          if (!from) throw new Error('From address is required (use onboarding@resend.dev for tests).');
          await api('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify({ emailConfig }),
          });
          await renderSettings();
          const msg = $('#emailSettingsMsg');
          if (msg) {
            msg.innerHTML = '<div class="ok-banner">Email settings saved. Send a test email to confirm Gmail delivery.</div>';
          }
        } catch (e) {
          $('#emailSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
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
          $('#emailSettingsMsg').innerHTML = `<div class="ok-banner">Test email sent via ${escapeHtml(result.delivery?.mode || 'ok')}. Check Gmail (and spam/promotions).</div>`;
        } catch (e) {
          $('#emailSettingsMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        } finally {
          emailTestBtn.disabled = false;
        }
      };
    }

    const tkSearchForm = $('#tkSearch');
    if (tkSearchForm) {
      const tkSearchInput = tkSearchForm.querySelector('input[name="q"]');
      const applyTkSearch = (raw) => {
        const needle = String(raw || '').trim().toLowerCase();
        state.tkSearch = { q: String(raw || '') };
        const rows = main.querySelectorAll('#tkRatesBody tr[data-tk]');
        let shown = 0;
        rows.forEach((row) => {
          const hay = (row.dataset.tkText || '').toLowerCase();
          const match = !needle || hay.includes(needle);
          row.hidden = !match;
          if (match) shown += 1;
        });
        const none = $('#tkRatesBody [data-tk-none]');
        if (none) none.hidden = !(needle && shown === 0 && rows.length > 0);
        const section = $('#tkRatesSection');
        if (section && needle) section.open = true;
        const meta = section?.querySelector('.onedrive-collapse-meta');
        if (meta) {
          meta.textContent = needle
            ? `${shown} of ${rows.length} timekeeper${rows.length === 1 ? '' : 's'}`
            : `${rows.length} timekeeper${rows.length === 1 ? '' : 's'}`;
        }
      };
      tkSearchForm.onsubmit = (ev) => {
        ev.preventDefault();
        applyTkSearch(tkSearchInput?.value || '');
      };
      if (tkSearchInput) {
        tkSearchInput.oninput = () => applyTkSearch(tkSearchInput.value);
      }
      const clearTk = $('#clearTkSearch');
      if (clearTk) {
        clearTk.onclick = () => {
          if (tkSearchInput) tkSearchInput.value = '';
          applyTkSearch('');
          tkSearchInput?.focus();
        };
      }
      applyTkSearch(state.tkSearch.q || '');
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
          state.tkSearch = { q: '' };
          await renderSettings();
          const section = $('#tkRatesSection');
          if (section) section.open = true;
          const msg = $('#tkMsg');
          if (msg) {
            // Always prefer the current browser origin — email/server links may use a dead pod host.
            const link = localAuthLink(invited.devToken) || invited.devLink || '';
            msg.innerHTML = `<div class="${delivered ? 'ok-banner' : 'error'}">${escapeHtml(mode)}${
              link ? `<div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open invite link</a> <span class="muted">(use this if email link fails)</span></div>` : ''
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
          const link = localAuthLink(result.devToken) || result.devLink || '';
          $('#rateMsg').innerHTML = `<div class="${delivered ? 'ok-banner' : 'error'}">${escapeHtml(mode)}${
            link ? `<div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open reset link</a> <span class="muted">(use this if email link fails)</span></div>` : ''
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
          await renderSettings();
          const section = $('#tkRatesSection');
          if (section) section.open = true;
          const rateMsg = $('#rateMsg');
          if (rateMsg) rateMsg.innerHTML = '<div class="ok-banner">Rate change saved.</div>';
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
