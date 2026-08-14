(() => {
  const TOKEN_KEY = 'billing_session';
  const state = {
    token: null,
    csrf: null,
    user: null,
    cookieOnlyAuth: false,
    securityConfig: null,
    view: 'matters',
    matters: [],
    users: [],
    clients: [],
    settings: null,
    matterId: null,
    matterSearch: { q: '', filterKey: '', filterValue: '' },
    tkSearch: { q: '' },
    showCreateMatter: false,
    createMatterDraftName: '',
    createMatterRecordTypeKey: 'billable',
    createMatterClientId: '',
    createMatterNewClient: { name: '', recordTypeKey: 'client', email: '' },
    settingsMatterRecordTypeKey: 'billable',
    settingsContactRecordTypeKey: 'client',
    settingsRoleKey: 'attorney',
    usersFlash: null,
    focusAddUser: false,
    focusTimeEntry: false,
    timeFlash: null,
    matterTimeFlash: null,
    matterFieldFlash: null,
    matterCreateFlash: null,
    showPostCreateFields: false,
    showPostCreateContactFields: false,
    matterFieldPanelFlash: null,
    contactFieldPanelFlash: null,
    editingContactFieldId: null,
    createContactFieldMsg: null,
    createContactFieldsOpen: false,
    createContactRecordTypeKey: 'client',
    timeEntryRetain: null,
    matterTimeRetain: null,
    focusCustomReportId: null,
    editingMatterFieldId: null,
    contactId: null,
    showCreateContact: false,
    contactSearch: { q: '' },
    contactFlash: null,
    contactCreateFlash: null,
    contactListFlash: null,
    billingForm: { matterId: '', dateFrom: '', dateTo: null, defaultsForMatterId: '' },
    sidebarCollapsed: false,
    settingsBillingFlash: null,
    settingsTabOpen: {},
    matterDetailsOpen: true,
    matterListColumns: null,
    sidebarSectionOpen: { quickActions: true, navigate: true },
    _apiCache: null,
    _shellSig: null,
    _renderToken: 0,
  };

  const API_CACHE_TTL_MS = 12_000;

  function bustApiCache() {
    state._apiCache = Object.create(null);
  }

  function cacheGet(key) {
    const hit = state._apiCache && state._apiCache[key];
    if (!hit) return undefined;
    if (Date.now() - hit.at > API_CACHE_TTL_MS) {
      delete state._apiCache[key];
      return undefined;
    }
    return hit.data;
  }

  function cacheSet(key, data) {
    if (!state._apiCache) state._apiCache = Object.create(null);
    state._apiCache[key] = { at: Date.now(), data };
  }

  /** Invite users / Add a user — admin always; other roles when Settings grants Add users. */
  function canManageUsers(user = state.user, settings = state.settings) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    const entry = settings?.permissions?.rolePermissions?.[user.role]
      || settings?.permissions?.profilePermissions?.[user.role];
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      return !!(entry.addUsers ?? entry.add_users);
    }
    return false;
  }

  function canManageRates(user = state.user) {
    return !!user && ['admin', 'billing_clerk'].includes(user.role);
  }

  function shellSignature() {
    return [
      state.user?.id,
      state.user?.role,
      roleCanView('matter') ? 1 : 0,
      roleCanView('contact') ? 1 : 0,
      roleCanView('report') ? 1 : 0,
      roleCanView('time') ? 1 : 0,
      roleCanModify('matter') ? 1 : 0,
      roleCanModify('contact') ? 1 : 0,
      roleCanModify('time') ? 1 : 0,
      canManageUsers() ? 1 : 0,
    ].join('|');
  }

  function navActiveId(view = state.view) {
    if (view === 'matter') return 'matters';
    if (view === 'contact') return 'contacts';
    return view;
  }

  function setActiveNav(view = state.view) {
    const active = navActiveId(view);
    if (!nav) return;
    nav.querySelectorAll('[data-view]').forEach((b) => {
      b.classList.toggle('active', b.dataset.view === active);
    });
  }

  function stillOnView(expected) {
    if (Array.isArray(expected)) return expected.includes(state.view);
    return state.view === expected;
  }

  /** Clear the delayed “Loading…” arm for the current renderView pass. */
  function clearViewLoadingArm() {
    if (state._viewLoadingTimer) {
      clearTimeout(state._viewLoadingTimer);
      state._viewLoadingTimer = null;
    }
  }

  /**
   * Paint main content for the active render. Cancels the delayed loading
   * overlay so a fast (cached) first paint is not stomped ~140ms later —
   * which previously left Settings stuck on “Loading…”.
   */
  function setMainHtml(html) {
    if (!main) return;
    clearViewLoadingArm();
    state._viewPaintToken = state._renderToken;
    main.innerHTML = html;
  }

  function showViewLoading() {
    if (!main) return;
    // Real content for this render already committed — do not clobber it.
    if (state._viewPaintToken === state._renderToken) return;
    main.innerHTML = `
      <div class="card view-loading" aria-busy="true" aria-live="polite">
        <p class="muted">Loading…</p>
      </div>`;
  }

  /** Warm GET cache for a nav target so toggles often hit memory. */
  function prefetchView(view) {
    if (!state.user || !view) return;
    if (view === 'matters') {
      void api('/api/matters?search=1');
      void api('/api/matters');
      void api('/api/clients');
    } else if (view === 'contacts') {
      void api('/api/clients');
      void api('/api/clients/field-config');
    } else if (view === 'time') {
      void api('/api/time-entries');
      void api('/api/settings');
      void api('/api/matters');
      void api('/api/custom-fields?appliesTo=time_entry');
    } else if (view === 'billing') {
      void api('/api/invoices');
      void api('/api/matters');
    } else if (view === 'reports') {
      void api('/api/custom-reports');
      void api('/api/record-types');
      void api('/api/custom-fields?appliesTo=time_entry');
      void api('/api/firm-reports');
    } else if (view === 'dashboard') {
      void api('/api/dashboard');
    } else if (view === 'users') {
      if (canManageUsers()) void api('/api/timekeepers');
    } else if (view === 'settings') {
      void api('/api/settings');
      void api('/api/record-types');
      void api('/api/record-types?appliesTo=client');
      // Billing clerks manage rates in Settings; admins use Add a user.
      if (canManageRates() && !canManageUsers()) void api('/api/timekeepers');
    }
  }

  function canCreateMatter(user) {
    return !!user && ['admin', 'billing_clerk', 'attorney', 'paralegal'].includes(user.role);
  }

  function isAdminUser(user = state.user) {
    return !!user && user.role === 'admin';
  }

  function fieldLabelFromDeleteBtn(btn) {
    const row = btn?.closest?.('.field-mgmt-row');
    const label = row?.querySelector('strong')?.textContent?.trim();
    return label || 'this custom field';
  }

  async function confirmDeleteCustomField(label) {
    return confirmAction({
      title: 'Delete this custom field?',
      message: `Are you sure you want to delete “${label}”? This removes it from forms and layouts. Existing values are kept but hidden.`,
      confirmLabel: 'Yes, delete field',
      cancelLabel: 'Cancel',
    });
  }

  function roleObjectPerms(objectKey, settings = state.settings) {
    const role = state.user?.role;
    const empty = {
      viewAll: false,
      modifyAll: false,
      delete: false,
      search: false,
      selectTimekeeper: false,
      viewOthers: false,
      modifyOthers: false,
      deleteOthers: false,
    };
    if (!role) return empty;
    if (role === 'admin') {
      return {
        viewAll: true,
        modifyAll: true,
        delete: true,
        search: true,
        selectTimekeeper: true,
        viewOthers: true,
        modifyOthers: true,
        deleteOthers: true,
      };
    }
    const entry = settings?.permissions?.rolePermissions?.[role]
      || settings?.permissions?.profilePermissions?.[role];
    if (!entry || typeof entry !== 'object') {
      // Legacy string mode
      const mode = entry;
      const full = mode !== 'read_only';
      const proxy = role === 'billing_clerk' && full;
      return {
        viewAll: true,
        modifyAll: full,
        delete: full,
        search: true,
        selectTimekeeper: proxy,
        viewOthers: full,
        modifyOthers: proxy,
        deleteOthers: full,
      };
    }
    const obj = entry.objects?.[objectKey] || entry[objectKey] || {};
    const viewAll = obj.viewAll !== false;
    const base = {
      viewAll,
      modifyAll: obj.modifyAll !== false,
      // Match server defaults: delete is on unless explicitly turned off.
      delete: obj.delete !== false,
      search: viewAll && (obj.search != null ? !!obj.search : true),
    };
    if (objectKey !== 'time') return base;
    return {
      ...base,
      selectTimekeeper: !!obj.selectTimekeeper,
      viewOthers: obj.viewOthers !== false,
      modifyOthers: !!obj.modifyOthers,
      deleteOthers: obj.deleteOthers != null ? !!obj.deleteOthers : !!obj.delete,
    };
  }

  function roleCanView(objectKey, settings = state.settings) {
    return !!roleObjectPerms(objectKey, settings).viewAll;
  }

  function roleCanModify(objectKey, settings = state.settings) {
    return !!roleObjectPerms(objectKey, settings).modifyAll;
  }

  function roleCanDelete(objectKey, settings = state.settings) {
    return !!roleObjectPerms(objectKey, settings).delete;
  }

  function roleCanSearch(objectKey, settings = state.settings) {
    const p = roleObjectPerms(objectKey, settings);
    return !!p.viewAll && !!p.search;
  }

  function roleCanSelectTimekeeper(settings = state.settings) {
    return !!roleObjectPerms('time', settings).selectTimekeeper;
  }

  function roleCanViewOthersTime(settings = state.settings) {
    return !!roleObjectPerms('time', settings).viewOthers;
  }

  function roleCanModifyOthersTime(settings = state.settings) {
    return !!roleObjectPerms('time', settings).modifyOthers;
  }

  function roleCanDeleteOthersTime(settings = state.settings) {
    return !!roleObjectPerms('time', settings).deleteOthers;
  }

  function timekeeperDisplayName(entry) {
    if (!entry) return '—';
    if (Number(entry.timekeeper_id) === Number(state.user?.id)) {
      return entry.timekeeper_name || state.user?.name || 'You';
    }
    if (!roleCanSelectTimekeeper()) return 'Another timekeeper';
    return entry.timekeeper_name || '—';
  }

  /** @deprecated prefer roleCanModify(objectKey) */
  function profileCanWrite(settings = state.settings) {
    return roleCanModify('matter', settings)
      || roleCanModify('contact', settings)
      || roleCanModify('time', settings);
  }

  const $ = (sel, el = document) => (el ? el.querySelector(sel) : null);
  const main = $('#main');
  const nav = $('#nav');
  const userbar = $('#userbar');
  const sidebar = $('#sidebar');
  const sidebarActions = $('#sidebarActions');
  const lookupBar = $('#lookupBar');
  const appEl = $('#app');

  try { localStorage.removeItem('billing_token'); } catch { /* ignore */ }
  try { state.token = sessionStorage.getItem(TOKEN_KEY) || null; } catch { state.token = null; }

  const SIDEBAR_COLLAPSED_KEY = 'chrono_sidebar_collapsed';
  try { state.sidebarCollapsed = localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === '1'; } catch { /* ignore */ }

  function persistSidebarCollapsed() {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, state.sidebarCollapsed ? '1' : '0');
    } catch { /* ignore quota / private mode */ }
  }

  function applySidebarCollapsed() {
    if (!sidebar) return;
    const collapsed = !!state.sidebarCollapsed;
    sidebar.classList.toggle('is-collapsed', collapsed);
    if (appEl) appEl.classList.toggle('sidebar-collapsed', collapsed);
    const toggle = $('#sidebarToggle');
    if (!toggle) return;
    toggle.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    toggle.setAttribute(
      'aria-label',
      collapsed ? 'Expand Chrono sidebar' : 'Collapse Chrono sidebar',
    );
    toggle.title = collapsed ? 'Expand Chrono' : 'Collapse Chrono';
  }

  function analogClockSvgHtml() {
    const ticks = [];
    for (let i = 0; i < 60; i += 1) {
      const hour = i % 5 === 0;
      ticks.push(`
        <line class="login-clock-tick${hour ? ' is-hour' : ''}"
          x1="100" y1="${hour ? 12 : 14}" x2="100" y2="${hour ? 24 : 18}"
          transform="rotate(${i * 6} 100 100)" />`);
    }
    const numerals = [
      { n: '12', x: 100, y: 36 },
      { n: '3', x: 168, y: 104 },
      { n: '6', x: 100, y: 174 },
      { n: '9', x: 32, y: 104 },
    ].map(({ n, x, y }) => `
      <text class="login-clock-numeral" x="${x}" y="${y}" text-anchor="middle"
        dominant-baseline="middle">${n}</text>`).join('');
    return `
      <svg class="login-clock-svg" viewBox="0 0 200 200" focusable="false">
        <circle class="login-clock-halo" cx="100" cy="100" r="99" />
        <circle class="login-clock-bezel" cx="100" cy="100" r="94" />
        <circle class="login-clock-dial" cx="100" cy="100" r="88" />
        <circle class="login-clock-ring" cx="100" cy="100" r="80" />
        <circle class="login-clock-well" cx="100" cy="100" r="54" />
        ${ticks.join('')}
        ${numerals}
        <g class="login-clock-hand-hour">
          <line x1="100" y1="110" x2="100" y2="48" />
        </g>
        <g class="login-clock-hand-minute">
          <line x1="100" y1="114" x2="100" y2="30" />
        </g>
        <g class="login-clock-hand-second">
          <line x1="100" y1="122" x2="100" y2="22" />
          <circle cx="100" cy="100" r="2.2" />
        </g>
        <circle class="login-clock-pivot" cx="100" cy="100" r="3.4" />
      </svg>`;
  }

  function ensureBrandClock() {
    const host = $('#sidebarClock');
    if (!host) return;
    if (!host.querySelector('.login-clock-svg')) {
      host.innerHTML = analogClockSvgHtml();
    }
    startAnalogClocks();
  }

  function wireSidebarToggle() {
    const toggle = $('#sidebarToggle');
    if (!toggle || toggle.dataset.wired === '1') return;
    toggle.dataset.wired = '1';
    toggle.addEventListener('click', () => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
      persistSidebarCollapsed();
      applySidebarCollapsed();
    });
    ensureBrandClock();
  }

  function persistSession(token, csrf) {
    if (csrf) state.csrf = csrf;
    if (state.cookieOnlyAuth) {
      // Live/production: HttpOnly cookie only — never keep the opaque token in JS storage.
      state.token = null;
      try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      return;
    }
    if (token) {
      state.token = token;
      try { sessionStorage.setItem(TOKEN_KEY, token); } catch { /* ignore */ }
    }
  }

  function clearSession() {
    state.token = null;
    state.csrf = null;
    state.user = null;
    state._shellSig = null;
    bustApiCache();
    try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
  }

  function isPublicAuthPath(path) {
    const p = String(path || '').split('?')[0];
    return [
      '/api/login',
      '/api/login/mfa',
      '/api/me',
      '/api/security-config',
      '/api/auth/token-info',
      '/api/auth/set-password',
      '/api/password-reset/request',
      '/api/login/magic/request',
      '/api/login/magic/confirm',
    ].includes(p);
  }

  async function api(path, opts = {}) {
    const method = String(opts.method || 'GET').toUpperCase();
    const useCache = method === 'GET' && opts.cache !== false && !opts.headers?.['X-No-Cache'];
    if (useCache) {
      const cached = cacheGet(`${method} ${path}`);
      if (cached !== undefined) return cached;
    }
    const headers = {
      'Content-Type': 'application/json',
      // Helps the server build email links with the URL the user is actually on
      // (avoids ephemeral pod hostnames that break when opened from email).
      'X-App-Origin': window.location.origin,
      ...(opts.headers || {}),
    };
    if (state.token && !state.cookieOnlyAuth) headers.Authorization = `Bearer ${state.token}`;
    if (state.csrf && !['GET', 'HEAD', 'OPTIONS'].includes(method) && !isPublicAuthPath(path)) {
      headers['X-CSRF-Token'] = state.csrf;
    }
    // `cache` is our in-memory flag — strip it so fetch does not see a boolean.
    const { cache: _appCache, headers: _hdrs, ...fetchOpts } = opts;
    const res = await fetch(path, { ...fetchOpts, method, headers, credentials: 'include' });
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
      if (useCache) cacheSet(`${method} ${path}`, data);
      else if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) bustApiCache();
      return data;
    }
    if (!res.ok) throw new Error(await res.text());
    if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) bustApiCache();
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

  /** Report cells wrap when text exceeds 30 characters so full values stay readable. */
  function reportCellTag(tag, text) {
    const s = text == null ? '' : String(text);
    const wrap = s.length > 30 ? ' class="cell-wrap"' : '';
    return `<${tag}${wrap}>${escapeHtml(s)}</${tag}>`;
  }

  /** Modern success notice: title + optional detail line. */
  function successNoticeHtml(notice) {
    if (!notice) return '';
    if (typeof notice === 'string') {
      return `<div class="success-notice" role="status">
        <span class="success-notice-icon" aria-hidden="true">
          <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
            <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6"/>
            <path d="M6 10.2l2.4 2.4L14 7.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <div class="success-notice-body">
          <strong class="success-notice-title">${escapeHtml(notice)}</strong>
        </div>
      </div>`;
    }
    const title = notice.title || 'Saved';
    const detail = notice.detail || '';
    return `<div class="success-notice" role="status">
      <span class="success-notice-icon" aria-hidden="true">
        <svg viewBox="0 0 20 20" width="18" height="18" fill="none">
          <circle cx="10" cy="10" r="9" stroke="currentColor" stroke-width="1.6"/>
          <path d="M6 10.2l2.4 2.4L14 7.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </span>
      <div class="success-notice-body">
        <strong class="success-notice-title">${escapeHtml(title)}</strong>
        ${detail ? `<span class="success-notice-detail">${escapeHtml(detail)}</span>` : ''}
      </div>
    </div>`;
  }

  function formatHoursLabel(minutes) {
    const hrs = formatDuration(minutes);
    return `${hrs} ${Number(hrs) === 1 ? 'hour' : 'hours'}`;
  }

  /** Lightweight confirm dialog. Resolves true/false. */
  function confirmAction({
    title = 'Are you sure?',
    message = '',
    name = '',
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
  } = {}) {
    return new Promise((resolve) => {
      const existing = document.querySelector('.confirm-overlay');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      const nameBlock = name
        ? `<strong class="confirm-name">${escapeHtml(name)}</strong>`
        : '';
      overlay.innerHTML = `
        <div class="confirm-dialog" role="alertdialog" aria-modal="true"
          aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
          <h2 id="confirmTitle">${escapeHtml(title)}</h2>
          ${message || nameBlock
            ? `<div id="confirmMessage">
                ${message ? `<p>${escapeHtml(message)}</p>` : ''}
                ${nameBlock}
              </div>`
            : '<div id="confirmMessage" hidden></div>'}
          <div class="confirm-actions">
            <button type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
            <button type="button" class="primary" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const finish = (value) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') finish(false);
        if (ev.key === 'Enter') finish(true);
      };
      document.addEventListener('keydown', onKey);
      overlay.querySelector('[data-confirm-cancel]').onclick = () => finish(false);
      overlay.querySelector('[data-confirm-ok]').onclick = () => finish(true);
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) finish(false);
      });
      setTimeout(() => overlay.querySelector('[data-confirm-ok]')?.focus(), 0);
    });
  }

  /**
   * Create-matter confirmation: optionally associate a contact from the dialog
   * (Client is a contact record type). Resolves to null if cancelled, otherwise
   * { clientChoice, newClientName, clientId, newClientRecordTypeKey }.
   */
  async function confirmCreateMatter({
    matterName = '',
    clients = [],
    contactRecordTypes = null,
    confirmLabel = 'Yes, create matter',
    cancelLabel = 'Not yet',
  } = {}) {
    let contactTypes = Array.isArray(contactRecordTypes) ? [...contactRecordTypes] : null;
    if (!contactTypes) {
      contactTypes = await api('/api/record-types?appliesTo=client').catch(() => []);
    }
    if (!contactTypes.length) {
      contactTypes = [
        { key: 'client', label: 'Client' },
        { key: 'company', label: 'Company' },
      ];
    }
    const defaultContactTypeKey = contactTypes.some((t) => t.key === 'client')
      ? 'client'
      : (contactTypes[0]?.key || 'client');
    const contactTypeLabel = (key) => {
      const t = contactTypes.find((x) => x.key === key);
      return t?.label || key || 'Contact';
    };

    return new Promise((resolve) => {
      const existing = document.querySelector('.confirm-overlay');
      if (existing) existing.remove();
      state.createMatterClientId = '';
      state.createMatterNewClient = {
        name: '',
        recordTypeKey: defaultContactTypeKey,
        email: '',
      };
      const clientList = [...(clients || [])];
      const allowAddNew = roleCanModify('contact');
      const typeOptionsHtml = contactTypes.map((t) => `
        <option value="${escapeHtml(t.key)}" ${t.key === defaultContactTypeKey ? 'selected' : ''}>
          ${escapeHtml(t.label || t.key)}
        </option>`).join('');
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog confirm-dialog--create-matter" role="alertdialog" aria-modal="true"
          aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
          <h2 id="confirmTitle">Create this matter?</h2>
          <div id="confirmMessage">
            <p data-create-matter-msg></p>
          </div>
          <div class="confirm-client-panel" data-confirm-client-panel hidden>
            <label class="confirm-client-label">Contact
              ${renderClientTypeahead({
                name: 'confirmClientId',
                selectedId: '',
                clients: clientList,
                allowAddNew,
                newClientName: '',
              })}
            </label>
            ${allowAddNew ? `
              <label class="confirm-client-type-field" data-confirm-client-type hidden>
                Contact type
                <select data-confirm-client-record-type aria-label="Contact type">
                  ${typeOptionsHtml}
                </select>
                <span class="hint confirm-contact-type-hint">Client is a contact type (along with Company and any types you add).</span>
              </label>` : ''}
            <div class="error confirm-client-error" data-confirm-client-error hidden></div>
          </div>
          <div class="confirm-actions confirm-actions--create-matter">
            <button type="button" data-confirm-add-client>Add contact</button>
            <span class="confirm-actions-spacer"></span>
            <button type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
            <button type="button" class="primary" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
          </div>
        </div>`;
      document.body.appendChild(overlay);
      const msgEl = overlay.querySelector('[data-create-matter-msg]');
      const panel = overlay.querySelector('[data-confirm-client-panel]');
      const addBtn = overlay.querySelector('[data-confirm-add-client]');
      const errEl = overlay.querySelector('[data-confirm-client-error]');
      const typeWrap = overlay.querySelector('[data-confirm-client-type]');
      const typeSelect = overlay.querySelector('[data-confirm-client-record-type]');
      let picker = null;

      function selectedRecordTypeKey() {
        const fromSelect = String(typeSelect?.value || '').trim();
        if (fromSelect) return fromSelect;
        return String(
          state.createMatterNewClient?.recordTypeKey || defaultContactTypeKey,
        ).trim() || 'client';
      }

      function syncRecordTypeVisibility() {
        if (!typeWrap || !allowAddNew) return;
        const choice = String(
          picker?.getValue?.() || state.createMatterClientId || '',
        ).trim();
        // Existing contact id selected → never show contact type.
        if (choice && choice !== '__new__') {
          typeWrap.hidden = true;
          return;
        }
        const typed = String(picker?.getTypedName?.() || '').trim();
        const exact = typed ? findExactClientMatch(clientList, typed) : null;
        const creatingNew = choice === '__new__'
          || (!!typed && !exact);
        typeWrap.hidden = !creatingNew;
        if (creatingNew && typeSelect && !typeSelect.value) {
          typeSelect.value = defaultContactTypeKey;
        }
      }

      function contactLabelFromState() {
        const choice = String(state.createMatterClientId || '').trim();
        if (choice === '__new__') {
          return String(state.createMatterNewClient?.name || '').trim() || null;
        }
        if (choice) {
          return clientList.find((c) => String(c.id) === choice)?.name || 'contact';
        }
        const typed = picker?.getTypedName?.() || '';
        return typed || null;
      }

      function updateMessage() {
        const label = contactLabelFromState();
        if (!msgEl) return;
        if (!label) {
          msgEl.textContent = `Create “${matterName}” with no contact? You can associate a contact later on the matter page.`;
        } else {
          const choice = String(
            picker?.getValue?.() || state.createMatterClientId || '',
          ).trim();
          const typed = String(picker?.getTypedName?.() || label).trim();
          const exact = typed ? findExactClientMatch(clientList, typed) : null;
          const creatingNew = choice === '__new__' || (!!typed && !exact && allowAddNew);
          if (creatingNew) {
            const typeLabel = contactTypeLabel(selectedRecordTypeKey());
            msgEl.textContent = `Create “${matterName}” for new ${typeLabel} “${label}”? You can add time and details after it’s created.`;
          } else {
            msgEl.textContent = `Create “${matterName}” for ${label}? You can add time and details after it’s created.`;
          }
        }
        syncRecordTypeVisibility();
      }

      function showContactError(text) {
        if (!errEl) return;
        if (text) {
          errEl.hidden = false;
          errEl.textContent = text;
        } else {
          errEl.hidden = true;
          errEl.textContent = '';
        }
      }

      function resolveContactChoice() {
        const typedContactName = String(
          picker?.getTypedName?.()
            || state.createMatterNewClient?.name
            || '',
        ).trim();
        let clientChoice = String(
          picker?.getValue?.() || state.createMatterClientId || '',
        ).trim();
        let clientId = null;
        let newClientName = '';
        let newClientRecordTypeKey = selectedRecordTypeKey();
        if ((!clientChoice || clientChoice === '__new__') && typedContactName) {
          const exactTyped = findExactClientMatch(clientList, typedContactName);
          if (exactTyped) {
            clientChoice = String(exactTyped.id);
          } else if (allowAddNew) {
            clientChoice = '__new__';
            newClientName = typedContactName;
          } else {
            return { error: 'Pick a contact from the suggestions, or leave Contact blank.' };
          }
        }
        if (clientChoice === '__new__') {
          if (!newClientName) {
            return { error: 'Enter a contact name to continue, or clear Contact.' };
          }
          const dupContact = findExactClientMatch(clientList, newClientName);
          if (dupContact) {
            return {
              error: `A contact named “${dupContact.name}” already exists. Pick them from suggestions instead.`,
            };
          }
          if (!contactTypes.some((t) => t.key === newClientRecordTypeKey)) {
            newClientRecordTypeKey = defaultContactTypeKey;
          }
        } else if (clientChoice) {
          clientId = Number(clientChoice);
          if (!Number.isFinite(clientId) || clientId <= 0) {
            return { error: 'Pick a contact from the suggestions, or leave Contact blank.' };
          }
        }
        return { clientChoice, newClientName, clientId, newClientRecordTypeKey };
      }

      updateMessage();

      const finish = (value) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          finish(null);
          return;
        }
        if (ev.key !== 'Enter') return;
        const active = document.activeElement;
        if (active?.matches?.('[data-client-search], [data-confirm-add-client], [data-confirm-client-record-type]')) {
          return;
        }
        if (overlay.querySelector('[data-client-typeahead].is-open')) return;
        overlay.querySelector('[data-confirm-ok]')?.click();
      };
      document.addEventListener('keydown', onKey);

      if (typeSelect) {
        typeSelect.onchange = () => {
          const key = selectedRecordTypeKey();
          state.createMatterNewClient = {
            ...(state.createMatterNewClient || { name: '', email: '' }),
            recordTypeKey: key,
          };
          updateMessage();
        };
      }

      addBtn.onclick = () => {
        if (panel.hidden) {
          panel.hidden = false;
          addBtn.textContent = 'Change contact';
          if (!picker) {
            picker = wireClientTypeahead(panel, {
              clients: clientList,
              selectedId: '',
              allowAddNew,
              onChange: () => {
                showContactError('');
                updateMessage();
              },
            });
            panel.addEventListener('input', () => {
              showContactError('');
              updateMessage();
            });
          }
          syncRecordTypeVisibility();
          setTimeout(() => picker?.focus?.(), 0);
        } else {
          picker?.focus?.();
        }
      };

      overlay.querySelector('[data-confirm-cancel]').onclick = () => finish(null);
      overlay.querySelector('[data-confirm-ok]').onclick = () => {
        const resolved = resolveContactChoice();
        if (resolved.error) {
          if (panel.hidden) addBtn.click();
          showContactError(resolved.error);
          picker?.focus?.();
          return;
        }
        state.createMatterClientId = resolved.clientChoice || '';
        if (resolved.clientChoice === '__new__') {
          state.createMatterNewClient = {
            ...(state.createMatterNewClient || { email: '' }),
            name: resolved.newClientName,
            recordTypeKey: resolved.newClientRecordTypeKey || defaultContactTypeKey,
          };
        }
        finish(resolved);
      };
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) finish(null);
      });
      setTimeout(() => overlay.querySelector('[data-confirm-ok]')?.focus(), 0);
    });
  }

  /**
   * Create-contact confirmation: optionally associate an existing matter.
   * Resolves to null if cancelled, otherwise { matterId, matterName }.
   */
  async function confirmCreateContact({
    contactName = '',
    matters = null,
    confirmLabel = 'Yes, create contact',
    cancelLabel = 'Not yet',
  } = {}) {
    let matterList = Array.isArray(matters) ? [...matters] : null;
    if (!matterList) {
      matterList = await api('/api/matters').catch(() => state.matters || []);
    }
    const canAssociate = roleCanModify('matter') && Array.isArray(matterList);

    return new Promise((resolve) => {
      const existing = document.querySelector('.confirm-overlay');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog confirm-dialog--create-contact" role="alertdialog" aria-modal="true"
          aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
          <h2 id="confirmTitle">Create this contact?</h2>
          <div id="confirmMessage">
            <p data-create-contact-msg></p>
            <p class="confirm-billing-note" data-create-contact-billing>
              To bill time for this contact, a matter must be associated.
            </p>
          </div>
          ${canAssociate ? `
            <div class="confirm-matter-panel" data-confirm-matter-panel hidden>
              <label class="confirm-matter-label">Matter
                ${renderMatterPicker({
                  name: 'confirmMatterId',
                  selectedId: null,
                  matters: matterList,
                })}
              </label>
              <p class="hint confirm-matter-hint" data-confirm-matter-hint hidden></p>
              <div class="error confirm-matter-error" data-confirm-matter-error hidden></div>
            </div>
            <div class="confirm-actions confirm-actions--create-contact">
              <button type="button" data-confirm-add-matter>Associate matter</button>
              <span class="confirm-actions-spacer"></span>
              <button type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
              <button type="button" class="primary" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
            </div>` : `
            <div class="confirm-actions">
              <button type="button" data-confirm-cancel>${escapeHtml(cancelLabel)}</button>
              <button type="button" class="primary" data-confirm-ok>${escapeHtml(confirmLabel)}</button>
            </div>`}
        </div>`;
      document.body.appendChild(overlay);

      const msgEl = overlay.querySelector('[data-create-contact-msg]');
      const panel = overlay.querySelector('[data-confirm-matter-panel]');
      const addBtn = overlay.querySelector('[data-confirm-add-matter]');
      const errEl = overlay.querySelector('[data-confirm-matter-error]');
      const hintEl = overlay.querySelector('[data-confirm-matter-hint]');
      let picker = null;
      let selectedMatter = null;

      function showMatterError(text) {
        if (!errEl) return;
        if (text) {
          errEl.hidden = false;
          errEl.textContent = text;
        } else {
          errEl.hidden = true;
          errEl.textContent = '';
        }
      }

      function updateMessage() {
        if (!msgEl) return;
        if (selectedMatter) {
          msgEl.textContent = `Create “${contactName}” and associate with “${selectedMatter.name}”? You can edit details after it’s created.`;
        } else {
          msgEl.textContent = `Create “${contactName}”? Associate a matter now if you want — you can also link one later on the matter page.`;
        }
        if (hintEl) {
          if (selectedMatter?.client_name) {
            hintEl.hidden = false;
            hintEl.textContent = `This matter is currently linked to “${selectedMatter.client_name}”. Associating will reassign it to “${contactName}”.`;
          } else {
            hintEl.hidden = true;
            hintEl.textContent = '';
          }
        }
      }

      const finish = (value) => {
        overlay.remove();
        document.removeEventListener('keydown', onKey);
        resolve(value);
      };
      const onKey = (ev) => {
        if (ev.key === 'Escape') {
          finish(null);
          return;
        }
        if (ev.key !== 'Enter') return;
        const active = document.activeElement;
        if (active?.matches?.('[data-matter-search], [data-confirm-add-matter], .matter-picker-trigger')) {
          return;
        }
        if (overlay.querySelector('[data-matter-picker].is-open')) return;
        overlay.querySelector('[data-confirm-ok]')?.click();
      };
      document.addEventListener('keydown', onKey);

      updateMessage();

      if (addBtn && panel) {
        addBtn.onclick = () => {
          if (panel.hidden) {
            panel.hidden = false;
            addBtn.textContent = 'Change matter';
            if (!picker) {
              picker = wireMatterPicker(panel, {
                matters: matterList,
                onChange: (m) => {
                  selectedMatter = m || null;
                  showMatterError('');
                  updateMessage();
                },
              });
            }
            setTimeout(() => picker?.focus?.(), 0);
          } else {
            picker?.focus?.();
          }
        };
      }

      overlay.querySelector('[data-confirm-cancel]').onclick = () => finish(null);
      overlay.querySelector('[data-confirm-ok]').onclick = () => {
        const matterId = canAssociate ? (picker?.getValue?.() || null) : null;
        if (matterId) {
          const m = matterList.find((x) => Number(x.id) === Number(matterId));
          finish({
            matterId: Number(matterId),
            matterName: m?.name || selectedMatter?.name || '',
          });
          return;
        }
        finish({ matterId: null, matterName: '' });
      };
      overlay.addEventListener('click', (ev) => {
        if (ev.target === overlay) finish(null);
      });
      setTimeout(() => overlay.querySelector('[data-confirm-ok]')?.focus(), 0);
    });
  }

  /** Built-in fields (client, status, etc.) are not managed from Add field UI. */
  function isBuiltInField(field) {
    const key = field?.fieldKey || field?.key || '';
    return String(key).startsWith('std:');
  }

  function fieldIdFromMgmt(f) {
    if (f.fieldId != null) return Number(f.fieldId);
    if (f.id != null) return Number(f.id);
    const key = f.fieldKey || f.key || '';
    if (String(key).startsWith('cf:')) return Number(String(key).slice(3));
    return null;
  }

  function fieldScopeLabel(field) {
    const scope = field?.scope
      || (field?.client_id || field?.clientId || field?.matter_id || field?.matterId
        ? 'record'
        : (field?.record_type_key || field?.recordTypeKey ? 'record_type' : null));
    if (scope === 'record') {
      const isContact = field?.appliesTo === 'client'
        || field?.applies_to === 'client'
        || field?.client_id != null
        || field?.clientId != null;
      return isContact ? 'This contact only' : 'This matter only';
    }
    if (scope === 'record_type') return 'Record type';
    if (scope === 'client') return 'All contacts';
    return null;
  }

  function fieldMgmtRows(fields, {
    editAttr = 'data-edit-matter-field',
    canDelete = isAdminUser(),
    showScope = false,
  } = {}) {
    const rows = (fields || []).filter((f) => !isBuiltInField(f));
    if (!rows.length) return '<p class="muted">No custom fields yet</p>';
    return rows.map((f) => {
      const id = fieldIdFromMgmt(f);
      const typeLabel = fieldTypeLabel(f.fieldType || f.type || f.kind);
      const scopeLabel = showScope ? fieldScopeLabel(f) : null;
      return `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(typeLabel)}${f.required ? ' · required' : ''}${
            scopeLabel ? ` · ${escapeHtml(scopeLabel)}` : ''
          }</span>
        </div>
        <div class="row-actions">
          ${id ? `<button type="button" ${editAttr}="${id}">Edit</button>` : ''}
          ${canDelete && id
            ? `<button type="button" data-del-custom-field="${id}">Delete</button>`
            : (canDelete && f.removable
              ? `<button type="button" data-del-matter-field="${escapeHtml(f.fieldKey)}">Delete</button>`
              : '')}
        </div>
      </div>`;
    }).join('');
  }

  function typeFieldMgmtRows(fields, {
    delAttr = 'data-del-type-field',
    editAttr = 'data-edit-type-field',
    canDelete = isAdminUser(),
    includeBuiltIns = false,
  } = {}) {
    const rows = includeBuiltIns
      ? (fields || [])
      : (fields || []).filter((f) => !isBuiltInField(f));
    if (!rows.length) {
      return includeBuiltIns
        ? '<p class="muted">No fields on this record page layout yet</p>'
        : '<p class="muted">No custom fields yet</p>';
    }
    return rows.map((f) => {
      const id = fieldIdFromMgmt(f);
      const builtIn = isBuiltInField(f);
      const typeLabel = builtIn
        ? 'built-in'
        : fieldTypeLabel(f.fieldType || f.type || f.kind);
      const isDefault = !!(f.isDefault || f.is_default);
      const core = !f.removable && builtIn;
      return `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <span class="muted"> · ${escapeHtml(typeLabel)} · record type${f.required ? ' · required' : ''}${isDefault ? ' · default on type' : ''}${core ? ' · always shown' : ''}</span>
        </div>
        <div class="row-actions">
          ${id ? `
            <label class="check-inline">
              <input type="checkbox" data-toggle-default-cf="${id}" ${isDefault ? 'checked' : ''} />
              Record type default field
            </label>` : ''}
          ${id ? `<button type="button" ${editAttr}="${id}">Edit</button>` : ''}
          ${canDelete && id
            ? `<button type="button" data-del-custom-field="${id}">Delete</button>`
            : (canDelete && f.removable
              ? `<button type="button" ${delAttr}="${escapeHtml(f.fieldKey || f.key)}">Remove</button>`
              : '')}
        </div>
      </div>`;
    }).join('');
  }

  function requiredFieldCheckboxHtml(checked = false, label = 'Required on create') {
    return `
      <label class="check-inline span-all">
        <input type="checkbox" name="required" ${checked ? 'checked' : ''} />
        <span data-required-label-text>${escapeHtml(label)}</span>
      </label>`;
  }

  function defaultFieldCheckboxHtml(checked = false, label = 'Default field') {
    return `
      <label class="check-inline span-all">
        <input type="checkbox" name="isDefault" ${checked ? 'checked' : ''} />
        <span data-default-label-text>${escapeHtml(label)}</span>
      </label>`;
  }

  /** Field formatters available when adding default / custom record fields. */
  const FIELD_FORMATTERS = [
    { value: 'auto_number', label: 'Auto Number' },
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'currency', label: 'Currency' },
    { value: 'date', label: 'Date' },
    { value: 'datetime', label: 'Date/Time' },
    { value: 'email', label: 'Email' },
    { value: 'geolocation', label: 'Geolocation' },
    { value: 'number', label: 'Number' },
    { value: 'percent', label: 'Percent' },
    { value: 'phone', label: 'Phone' },
    { value: 'dropdown', label: 'Picklist' },
    { value: 'multiselect', label: 'Picklist (Multi-Select)' },
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Text Area' },
    { value: 'long_text', label: 'Long Text Area' },
    { value: 'rich_text', label: 'Rich Text Area' },
    { value: 'url', label: 'URL' },
    { value: 'formula', label: 'Formula' },
  ];

  /** Practical types for time-entry custom fields (no formula/geo/rich text/etc.). */
  const TIME_ENTRY_FIELD_FORMATTERS = [
    { value: 'checkbox', label: 'Checkbox' },
    { value: 'currency', label: 'Currency' },
    { value: 'date', label: 'Date' },
    { value: 'number', label: 'Number' },
    { value: 'percent', label: 'Percent' },
    { value: 'dropdown', label: 'Picklist' },
    { value: 'multiselect', label: 'Picklist (Multi-Select)' },
    { value: 'text', label: 'Text' },
    { value: 'textarea', label: 'Text Area' },
  ];

  /** End-user matter-only fields (Settings → Matter page keeps the full admin set). */
  const MATTER_ONLY_FIELD_FORMATTERS = TIME_ENTRY_FIELD_FORMATTERS;

  const SYSTEM_FIELD_TYPES = new Set(['auto_number', 'formula']);
  const OPTION_FIELD_TYPES = new Set(['dropdown', 'select', 'multiselect', 'picklist']);

  function formattersForAppliesTo(appliesTo) {
    const scope = String(appliesTo || 'matter').toLowerCase();
    if (scope === 'time' || scope === 'time_entry' || scope === 'time-entry') {
      return TIME_ENTRY_FIELD_FORMATTERS;
    }
    if (scope === 'matter_only' || scope === 'matter-only') {
      return MATTER_ONLY_FIELD_FORMATTERS;
    }
    return FIELD_FORMATTERS;
  }

  function fieldFormatterOptions(selected = 'text', appliesTo = 'matter') {
    const list = [...formattersForAppliesTo(appliesTo)];
    if (selected && !list.some((f) => f.value === selected)) {
      const extra = FIELD_FORMATTERS.find((f) => f.value === selected);
      if (extra) list.push(extra);
    }
    const selectedValue = list.some((f) => f.value === selected) ? selected : 'text';
    return list.map((f) =>
      `<option value="${f.value}" ${f.value === selectedValue ? 'selected' : ''}>${f.label}</option>`
    ).join('');
  }

  function fieldTypeLabel(type) {
    const t = String(type || '');
    const match = FIELD_FORMATTERS.find((f) => f.value === t
      || (t === 'select' && f.value === 'dropdown'));
    if (match) return match.label;
    if (t === 'select' || t === 'dropdown') return 'Picklist';
    return t.replace(/_/g, ' ');
  }

  function parseOptionsInput(raw) {
    return String(raw || '')
      .split(/[\n,]+/)
      .map((o) => o.trim())
      .filter(Boolean);
  }

  /** API stores picklists as select; accept either in the UI. */
  function apiFieldType(fieldType) {
    if (fieldType === 'dropdown' || fieldType === 'picklist') return 'select';
    return fieldType;
  }

  function customFieldPayload(fd) {
    const fieldType = String(fd.get('fieldType') || 'text');
    const options = parseOptionsInput(fd.get('optionsText'));
    const body = {
      label: fd.get('label'),
      fieldType: apiFieldType(fieldType),
      required: fd.get('required') === 'on',
      isDefault: fd.get('isDefault') === 'on',
    };
    if (OPTION_FIELD_TYPES.has(fieldType)) {
      body.options = options;
      body.optionsText = String(fd.get('optionsText') || '');
    }
    if (fieldType === 'formula') {
      body.expression = String(fd.get('expression') || '').trim();
    }
    if (fieldType === 'auto_number') {
      body.prefix = String(fd.get('autoNumberPrefix') || 'AN-');
      body.pad = Number(fd.get('autoNumberPad') || 4) || 4;
    }
    return { fieldType, options, body };
  }

  function dropdownOptionsFieldHtml(optionsText = '', { show = false } = {}) {
    return `
      <label class="span-all" data-dropdown-options ${show ? '' : 'hidden'}>
        Picklist options
        <textarea name="optionsText" rows="3"
          placeholder="One option per line, or comma-separated&#10;e.g. Discovery&#10;Trial&#10;Appeal">${escapeHtml(optionsText)}</textarea>
        <span class="hint">Enter choices for the picklist — one per line, or separated by commas</span>
      </label>`;
  }

  function formulaConfigFieldHtml(expression = '', { show = false } = {}) {
    return `
      <label class="span-all" data-formula-config ${show ? '' : 'hidden'}>
        Formula expression
        <textarea name="expression" rows="2"
          placeholder="e.g. {Amount} * {Rate} / 100">${escapeHtml(expression || '')}</textarea>
        <span class="hint">Use {'{'}Field label{'}'}, {'{'}api_name{'}'}, or {'{'}cf:id{'}'} with + − × ÷. Read-only for users.</span>
      </label>`;
  }

  function autoNumberConfigFieldHtml(prefix = 'AN-', pad = 4, { show = false } = {}) {
    return `
      <div class="span-all grid two" data-autonumber-config ${show ? '' : 'hidden'}>
        <label>Prefix
          <input name="autoNumberPrefix" value="${escapeHtml(prefix || 'AN-')}" placeholder="AN-" />
        </label>
        <label>Digits
          <input name="autoNumberPad" type="number" min="1" max="12" value="${escapeHtml(String(pad || 4))}" />
        </label>
        <p class="hint span-all">Generates values like ${escapeHtml(prefix || 'AN-')}${String(1).padStart(Number(pad) || 4, '0')} automatically.</p>
      </div>`;
  }

  /** Collect cf_* values including multiselect, geo, checkbox, and system types. */
  function collectCustomFieldValues(form, fieldDefs = []) {
    const values = {};
    if (!form) return values;
    const defs = fieldDefs || [];
    const byId = new Map(defs.map((f) => [Number(f.fieldId ?? f.id), f]));
    if (!defs.length) {
      const fd = new FormData(form);
      for (const [key, value] of fd.entries()) {
        if (String(key).startsWith('cf_') && !String(key).includes('_lat') && !String(key).includes('_lng')) {
          values[key.slice(3)] = value;
        }
      }
      form.querySelectorAll('input[type="checkbox"][name^="cf_"]').forEach((cb) => {
        values[cb.name.slice(3)] = cb.checked ? '1' : '0';
      });
      return values;
    }
    for (const f of defs) {
      const id = Number(f.fieldId ?? f.id);
      if (!Number.isFinite(id)) continue;
      const type = String(f.type || f.field_type || f.fieldType || 'text');
      const name = `cf_${id}`;
      if (SYSTEM_FIELD_TYPES.has(type)) continue;
      if (type === 'checkbox') {
        const el = form.querySelector(`input[type="checkbox"][name="${name}"]`);
        values[id] = el?.checked ? '1' : '0';
      } else if (type === 'multiselect') {
        const sel = form.querySelector(`select[name="${name}"]`);
        const selected = sel
          ? [...sel.selectedOptions].map((o) => o.value).filter(Boolean)
          : [];
        values[id] = JSON.stringify(selected);
      } else if (type === 'geolocation') {
        const lat = form.querySelector(`[name="${name}_lat"]`)?.value ?? '';
        const lng = form.querySelector(`[name="${name}_lng"]`)?.value ?? '';
        values[id] = (String(lat).trim() || String(lng).trim())
          ? `${String(lat).trim()},${String(lng).trim()}`
          : '';
      } else {
        const el = form.elements.namedItem(name);
        values[id] = el ? el.value : '';
      }
    }
    // Include any leftover cf_ inputs not in defs
    const fd = new FormData(form);
    for (const [key, value] of fd.entries()) {
      if (!String(key).startsWith('cf_')) continue;
      if (key.endsWith('_lat') || key.endsWith('_lng')) continue;
      const id = key.slice(3);
      if (values[id] !== undefined || values[Number(id)] !== undefined) continue;
      if (byId.has(Number(id)) && SYSTEM_FIELD_TYPES.has(String(byId.get(Number(id)).type))) continue;
      values[id] = value;
    }
    return values;
  }

  function createRecordTypeFieldsPanelHtml({
    panelId,
    formId,
    msgId,
    typeLabel,
    fields = [],
    open = false,
    hint = null,
    msgHtml = '',
    entityNoun = 'record',
    appliesTo = 'matter',
    title = 'Add custom fields',
    showEmptyList = false,
  } = {}) {
    const count = (fields || []).length;
    const meta = count
      ? `${count} field${count === 1 ? '' : 's'}`
      : '';
    const list = count
      ? fields.map((f) => `
          <div class="field-mgmt-row">
            <div>
              <strong>${escapeHtml(f.label)}</strong>
              <span class="muted"> · ${escapeHtml(fieldTypeLabel(f.field_type || f.fieldType))}${
                f.required ? ' · required' : ''
              }</span>
            </div>
          </div>`).join('')
      : (showEmptyList
        ? `<p class="muted">No custom fields for ${escapeHtml(typeLabel)} yet</p>`
        : '');
    const hintHtml = hint
      ? `<p class="hint">${hint}</p>`
      : '';
    return `
      <details class="onedrive-collapse settings-collapse create-matter-fields-panel page-section"
        id="${escapeHtml(panelId)}"${open ? ' open' : ''}>
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">${escapeHtml(title)}</span>
          ${meta ? `<span class="onedrive-collapse-meta muted">${escapeHtml(meta)}</span>` : ''}
        </summary>
        <div class="onedrive-collapse-body stack create-rt-fields-body">
          ${hintHtml}
          ${list ? `<div class="field-mgmt-list create-rt-fields-list">${list}</div>` : ''}
          ${customFieldFormHtml({
            formId,
            submitLabel: 'Add field',
            defaultLabel: 'Default on this record type',
            requiredLabel: 'Required on create',
            appliesTo,
          })}
          <div id="${escapeHtml(msgId)}">${msgHtml || ''}</div>
        </div>
      </details>`;
  }

  function wireCreateRecordTypeFieldsPanel(panelId, stateKey) {
    const panel = typeof panelId === 'string' ? document.getElementById(panelId) : panelId;
    if (!panel || !stateKey) return;
    panel.addEventListener('toggle', () => {
      state[stateKey] = !!panel.open;
    });
  }

  function customFieldFormHtml({
    formId,
    submitLabel = 'Add field',
    field = null,
    showCancel = false,
    requiredLabel = 'Required on create',
    defaultLabel = 'Default field',
    showDefault = true,
    formHint = '',
    scopeField = null,
    appliesTo = 'matter',
  } = {}) {
    const type = field
      ? (field.field_type || field.fieldType || field.type || 'text')
      : 'text';
    const uiType = type === 'select' ? 'dropdown' : type;
    const allowed = formattersForAppliesTo(appliesTo);
    const allowFormula = allowed.some((f) => f.value === 'formula');
    const allowAuto = allowed.some((f) => f.value === 'auto_number');
    const options = Array.isArray(field?.options)
      ? field.options.join('\n')
      : (field?.optionsText || '');
    const expression = field?.expression || field?.config?.expression || '';
    const prefix = field?.prefix || field?.config?.prefix || 'AN-';
    const pad = field?.pad || field?.config?.pad || 4;
    const required = !!(field && field.required);
    const isDefault = !!(field && (field.isDefault || field.is_default));
    const label = field?.label || '';
    const scopeHtml = scopeField ? `
      <label class="span-all">Field applies to
        <select name="fieldScope" id="${escapeHtml(scopeField.selectId || 'fieldScope')}">
          ${(scopeField.options || []).map((opt) => `
            <option value="${escapeHtml(opt.value)}" ${opt.value === scopeField.selected ? 'selected' : ''}>
              ${escapeHtml(opt.label)}
            </option>`).join('')}
        </select>
        <span class="hint">${escapeHtml(scopeField.hint || 'Choose whether this field is for one matter or the whole record type.')}</span>
      </label>` : '';
    return `
      <form id="${escapeHtml(formId)}" class="grid two" data-field-applies-to="${escapeHtml(appliesTo)}">
        ${formHint ? `<p class="hint span-all">${formHint}</p>` : ''}
        ${scopeHtml}
        <label>Custom field label
          <input name="label" required value="${escapeHtml(label)}"
            placeholder="e.g. Case stage" />
        </label>
        <label>Custom field type
          <select name="fieldType">
            ${fieldFormatterOptions(uiType, appliesTo)}
          </select>
        </label>
        ${dropdownOptionsFieldHtml(options, { show: OPTION_FIELD_TYPES.has(uiType) })}
        ${allowFormula ? formulaConfigFieldHtml(expression, { show: uiType === 'formula' }) : ''}
        ${allowAuto ? autoNumberConfigFieldHtml(prefix, pad, { show: uiType === 'auto_number' }) : ''}
        <div class="span-all" data-default-field-wrap ${showDefault ? '' : 'hidden'}>
          ${defaultFieldCheckboxHtml(isDefault, defaultLabel)}
        </div>
        <div class="span-all" data-required-field-wrap>
          ${requiredFieldCheckboxHtml(required, requiredLabel)}
        </div>
        <div class="row-actions span-all">
          <button class="primary" type="submit">${escapeHtml(submitLabel)}</button>
          ${showCancel ? '<button type="button" data-cancel-field-edit>Cancel</button>' : ''}
        </div>
      </form>`;
  }

  function wireDropdownOptionsToggle(form) {
    if (!form) return;
    const typeSelect = form.querySelector('select[name="fieldType"]');
    const optionsRow = form.querySelector('[data-dropdown-options]');
    const optionsInput = form.querySelector('[name="optionsText"]');
    const formulaRow = form.querySelector('[data-formula-config]');
    const formulaInput = form.querySelector('[name="expression"]');
    const autoRow = form.querySelector('[data-autonumber-config]');
    const autoPrefix = form.querySelector('[name="autoNumberPrefix"]');
    const autoPad = form.querySelector('[name="autoNumberPad"]');
    const requiredWrap = form.querySelector('[data-required-field-wrap]');
    if (!typeSelect) return;
    const setPanel = (el, on) => {
      if (!el) return;
      el.hidden = !on;
      el.setAttribute('aria-hidden', on ? 'false' : 'true');
      el.querySelectorAll('input, textarea, select').forEach((input) => {
        input.disabled = !on;
      });
    };
    const sync = () => {
      const t = typeSelect.value;
      const needsOptions = OPTION_FIELD_TYPES.has(t);
      const needsFormula = t === 'formula';
      const needsAuto = t === 'auto_number';
      setPanel(optionsRow, needsOptions);
      if (optionsInput) {
        optionsInput.required = needsOptions;
        optionsInput.disabled = !needsOptions;
      }
      setPanel(formulaRow, needsFormula);
      if (formulaInput) {
        formulaInput.required = needsFormula;
        formulaInput.disabled = !needsFormula;
      }
      setPanel(autoRow, needsAuto);
      if (autoPrefix) autoPrefix.disabled = !needsAuto;
      if (autoPad) autoPad.disabled = !needsAuto;
      if (requiredWrap) {
        requiredWrap.hidden = SYSTEM_FIELD_TYPES.has(t);
        requiredWrap.setAttribute('aria-hidden', SYSTEM_FIELD_TYPES.has(t) ? 'true' : 'false');
      }
    };
    typeSelect.addEventListener('change', sync);
    sync();
  }

  function contactStandardInputHtml(field, { value = '', canEdit = true } = {}) {
    const disabled = canEdit ? '' : 'disabled';
    const req = field.required ? 'required' : '';
    const safeVal = escapeHtml(value ?? '');
    if (field.type === 'textarea') {
      return `<textarea name="${escapeHtml(field.key)}" rows="2" ${req} ${disabled}
        placeholder="${field.key === 'notes' ? 'Optional' : ''}">${safeVal}</textarea>`;
    }
    const type = field.type === 'email' ? 'email' : 'text';
    const placeholder = field.key === 'company'
      ? 'Company or organization'
      : field.key === 'email'
        ? 'name@example.com'
        : field.key === 'phone'
          ? 'Phone'
          : field.key === 'name'
            ? 'Contact name'
            : '';
    return `<input name="${escapeHtml(field.key)}" type="${type}" value="${safeVal}"
      ${req} ${disabled} placeholder="${escapeHtml(placeholder)}" />`;
  }

  /** Manage matter (default layout) or time-entry custom fields on Settings. */
  async function bindDefaultFieldsEditor({
    bodyEl,
    msgEl,
    recordTypeKey = 'billable',
    appliesTo = 'matter',
    recordTypes = null,
    onRecordTypeChange = null,
  } = {}) {
    if (!bodyEl) return;
    const entityAppliesTo = appliesTo === 'client' ? 'client' : 'matter';
    let key = recordTypeKey
      || (entityAppliesTo === 'client' ? 'client' : 'billable');
    const firmWide = appliesTo === 'time_entry';
    const scopeLabel = appliesTo === 'client'
      ? 'contact'
      : appliesTo === 'time_entry'
        ? 'time entry'
        : 'matter';
    const entityNoun = appliesTo === 'client' ? 'contact' : 'matter';
    let editingId = null;
    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };

    const submitFieldForm = async (form, { createBody } = {}) => {
      const fd = new FormData(form);
      const { fieldType, options, body } = customFieldPayload(fd);
      if ((fieldType === 'dropdown' || fieldType === 'select' || fieldType === 'multiselect') && !options.length) {
        setMsg('<div class="error">Add at least one dropdown option.</div>');
        return;
      }
      try {
        if (editingId) {
          await api(`/api/custom-fields/${editingId}`, {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
          setMsg('<div class="ok-banner">Custom field updated.</div>');
          editingId = null;
        } else {
          await api('/api/custom-fields', {
            method: 'POST',
            body: JSON.stringify({ ...body, ...createBody }),
          });
          setMsg(`<div class="ok-banner">${scopeLabel.charAt(0).toUpperCase()}${scopeLabel.slice(1)} field added.</div>`);
        }
        await render();
      } catch (e) {
        setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
      }
    };

    const saveContactStandardKeys = async (keys) => {
      await api('/api/settings', {
        method: 'PATCH',
        body: JSON.stringify({ contactStandardFields: keys }),
      });
    };

    const render = async () => {
      if (firmWide) {
        const fields = await api(`/api/custom-fields?appliesTo=${encodeURIComponent(appliesTo)}`);
        if (!bodyEl.isConnected || !stillOnView('settings')) return;
        const editing = editingId
          ? (fields || []).find((f) => Number(f.id) === Number(editingId))
          : null;
        const formId = appliesTo === 'client' ? 'contactFieldForm' : 'timeFieldForm';
        const canDeleteFields = isAdminUser();
        let contactConfig = null;
        if (appliesTo === 'client') {
          contactConfig = await api('/api/clients/field-config');
          if (!bodyEl.isConnected || !stillOnView('settings')) return;
        }
        const enabledStdKeys = new Set(contactConfig?.enabledKeys || []);
        const builtinRows = appliesTo === 'client'
          ? (contactConfig?.availableStandard || [])
            .concat(contactConfig?.enabledStandard || [])
            .sort((a, b) => String(a.label).localeCompare(String(b.label)))
            .map((f) => {
              const isOn = enabledStdKeys.has(f.key);
              return `
              <div class="field-mgmt-row">
                <div>
                  <strong>${escapeHtml(f.label)}</strong>
                  <div class="muted">built-in · ${escapeHtml(f.type || 'text')}</div>
                </div>
                <div class="row-actions">
                  <label class="check-inline">
                    <input type="checkbox" data-toggle-contact-std="${escapeHtml(f.key)}"
                      ${isOn ? 'checked' : ''} />
                    Default field
                  </label>
                </div>
              </div>`;
            }).join('')
          : '';
        const customRows = (fields || []).map((f) => `
          <div class="field-mgmt-row">
            <div>
              <strong>${escapeHtml(f.label)}</strong>
              <div class="muted">${escapeHtml(fieldTypeLabel(f.field_type))} · ${escapeHtml(scopeLabel)}${f.required ? ' · required' : ''}${f.isDefault || f.is_default ? ' · default' : ''}</div>
            </div>
            <div class="row-actions">
              <label class="check-inline">
                <input type="checkbox" data-toggle-default-cf="${f.id}"
                  ${f.isDefault || f.is_default ? 'checked' : ''} />
                Default field
              </label>
              <button type="button" data-edit-firm-field="${f.id}">Edit</button>
              ${canDeleteFields
                ? `<button type="button" data-del-firm-field="${f.id}">Delete</button>`
                : ''}
            </div>
          </div>`).join('');
        const rows = `${builtinRows}${customRows}`
          || `<p class="muted">No ${escapeHtml(scopeLabel)} fields yet.</p>`;
        const listHint = appliesTo === 'client'
          ? '<p class="hint">Name is always shown. Add custom fields below and use <strong>Default field</strong> to show them on contacts.</p>'
          : `<p class="hint">Mark <strong>Default field</strong> for fields that should appear by default on ${escapeHtml(scopeLabel)} forms.</p>`;

        bodyEl.innerHTML = `
          ${listHint}
          <div class="field-mgmt-list">${rows}</div>
          ${editing
            ? `<h3 class="field-edit-title">Edit ${escapeHtml(scopeLabel)} field</h3>${customFieldFormHtml({
              formId,
              submitLabel: 'Save changes',
              field: editing,
              showCancel: true,
              appliesTo,
            })}`
            : customFieldFormHtml({
              formId,
              submitLabel: `Add ${scopeLabel} field`,
              appliesTo,
              formHint: appliesTo === 'time_entry'
                ? 'Choose types used when logging time (text, picklist, number, date, checkbox, etc.).'
                : '',
            })}`;

        if (appliesTo === 'client') {
          bodyEl.querySelectorAll('[data-toggle-contact-std]').forEach((box) => {
            box.onchange = async () => {
              try {
                const config = await api('/api/clients/field-config');
                const key = box.dataset.toggleContactStd;
                let next = [...(config.enabledKeys || [])];
                if (box.checked) {
                  if (!next.includes(key)) next.push(key);
                } else {
                  next = next.filter((k) => k !== key);
                }
                await saveContactStandardKeys(next);
                setMsg('<div class="ok-banner">Contact fields updated.</div>');
                await render();
              } catch (e) {
                setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
                box.checked = !box.checked;
              }
            };
          });
        }
        bodyEl.querySelectorAll('[data-toggle-default-cf]').forEach((box) => {
          box.onchange = async () => {
            try {
              await api(`/api/custom-fields/${box.dataset.toggleDefaultCf}`, {
                method: 'PATCH',
                body: JSON.stringify({ isDefault: !!box.checked }),
              });
              setMsg('<div class="ok-banner">Default field updated.</div>');
              await render();
            } catch (e) {
              setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
              box.checked = !box.checked;
            }
          };
        });

        bodyEl.querySelectorAll('[data-edit-firm-field]').forEach((btn) => {
          btn.onclick = () => {
            editingId = Number(btn.dataset.editFirmField);
            setMsg('');
            render();
          };
        });
        bodyEl.querySelectorAll('[data-del-firm-field]').forEach((btn) => {
          btn.onclick = async () => {
            const label = fieldLabelFromDeleteBtn(btn);
            const sure = await confirmDeleteCustomField(label);
            if (!sure) return;
            try {
              await api(`/api/custom-fields/${btn.dataset.delFirmField}`, { method: 'DELETE' });
              if (Number(editingId) === Number(btn.dataset.delFirmField)) editingId = null;
              setMsg(`<div class="ok-banner">${scopeLabel.charAt(0).toUpperCase()}${scopeLabel.slice(1)} field deleted.</div>`);
              await render();
            } catch (e) {
              setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
            }
          };
        });
        const cancel = bodyEl.querySelector('[data-cancel-field-edit]');
        if (cancel) {
          cancel.onclick = () => {
            editingId = null;
            setMsg('');
            render();
          };
        }
        const firmForm = bodyEl.querySelector(`#${formId}`);
        wireDropdownOptionsToggle(firmForm);
        if (firmForm) {
          firmForm.onsubmit = async (ev) => {
            ev.preventDefault();
            await submitFieldForm(firmForm, { createBody: { appliesTo } });
          };
        }
        return;
      }

      const types = await api(
        `/api/record-types?appliesTo=${encodeURIComponent(entityAppliesTo)}`
      ).catch(() => recordTypes || []);
      if (!bodyEl.isConnected || !stillOnView('settings')) return;
      if (!types.some((t) => t.key === key) && types[0]) key = types[0].key;
      const typeLayout = await api(`/api/record-types/${encodeURIComponent(key)}/layout`);
      if (!bodyEl.isConnected || !stillOnView('settings')) return;
      const editing = editingId
        ? (typeLayout.fields || []).find((f) => Number(fieldIdFromMgmt(f)) === Number(editingId))
          || (typeLayout.customFields || []).find((f) => Number(f.id) === Number(editingId))
        : null;
      const typeLabel = typeLayout.label || key;
      const availableStd = typeLayout.availableStandardFields || [];
      const typeExample = entityAppliesTo === 'client' ? 'Vendor' : 'Contested';
      const typePicker = `
        <div class="row-actions" style="flex-wrap:wrap;align-items:flex-end;gap:.75rem">
          <label class="matter-type-picker">Record page
            <select id="settingsMatterTypeSelect" name="recordTypeKey">
              ${(types || []).map((t) => `
                <option value="${escapeHtml(t.key)}" ${t.key === key ? 'selected' : ''}>
                  ${escapeHtml(t.label || t.key)}
                </option>`).join('')}
            </select>
          </label>
          ${isAdminUser() ? `
          <form id="addRecordTypeForm" class="row-actions"
            style="flex-wrap:wrap;align-items:flex-end;gap:.75rem;margin:0">
            <label class="matter-type-picker">Label
              <input name="label" required maxlength="80"
                placeholder="e.g. ${escapeHtml(typeExample)}" autocomplete="off" />
            </label>
            <button class="primary" type="submit">Create a New record Page</button>
          </form>` : ''}
        </div>
        <p class="hint">Fields you add here are for the <strong>${escapeHtml(typeLabel)}</strong> record type — they appear on every ${escapeHtml(entityNoun)} of this type.${
          entityAppliesTo === 'matter'
            ? ' For a field on one matter only, open that matter and use Matter level fields at the bottom of the page.'
            : ' For a field on one contact only, open that contact and use Contact level fields.'
        }</p>`;
      bodyEl.innerHTML = `
        ${typePicker}
        <div class="field-mgmt-list">
          ${typeFieldMgmtRows(typeLayout.fields, { canDelete: isAdminUser(), includeBuiltIns: true })}
        </div>
        ${availableStd.length ? `
          <div class="row-actions" style="flex-wrap:wrap;gap:.5rem;align-items:center">
            <label class="matter-type-picker" style="margin:0">Add built-in field
              <select id="addTypeStandardField">
                <option value="">Choose…</option>
                ${availableStd.map((f) => `
                  <option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`).join('')}
              </select>
            </label>
            <button type="button" id="addTypeStandardFieldBtn">Add to layout</button>
          </div>` : ''}
        ${editing
          ? `<h3 class="field-edit-title">Edit record type field</h3>${customFieldFormHtml({
            formId: 'typeFieldForm',
            submitLabel: 'Save changes',
            field: editing,
            showCancel: true,
            defaultLabel: 'Record type default field',
            requiredLabel: 'Record type required field',
            appliesTo: entityAppliesTo,
            formHint: `This field belongs to the <strong>${escapeHtml(typeLabel)}</strong> record type and shows on all ${escapeHtml(entityNoun)}s of that type.`,
          })}`
          : customFieldFormHtml({
            formId: 'typeFieldForm',
            submitLabel: 'Add to this record type',
            defaultLabel: 'Record type default field',
            requiredLabel: 'Record type required field',
            appliesTo: entityAppliesTo,
            formHint: `New fields are added to the <strong>${escapeHtml(typeLabel)}</strong> record type layout for every ${escapeHtml(entityNoun)} of this type. Check <strong>Record type default field</strong> to mark it as a default on this record type.`,
          })}`;

      const typeSelect = bodyEl.querySelector('#settingsMatterTypeSelect');
      if (typeSelect) {
        typeSelect.onchange = () => {
          key = typeSelect.value;
          editingId = null;
          setMsg('');
          if (typeof onRecordTypeChange === 'function') onRecordTypeChange(key);
          render();
        };
      }
      const addTypeForm = bodyEl.querySelector('#addRecordTypeForm');
      if (addTypeForm) {
        addTypeForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(addTypeForm);
          const label = String(fd.get('label') || '').trim();
          try {
            const created = await api('/api/record-types', {
              method: 'POST',
              body: JSON.stringify({ label, appliesTo: entityAppliesTo }),
            });
            key = created.key;
            editingId = null;
            if (typeof onRecordTypeChange === 'function') onRecordTypeChange(key);
            setMsg(`<div class="ok-banner">Record page “${escapeHtml(created.label)}” created.</div>`);
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
      const addStdSelect = bodyEl.querySelector('#addTypeStandardField');
      const addStdBtn = bodyEl.querySelector('#addTypeStandardFieldBtn');
      if (addStdBtn && addStdSelect) {
        addStdBtn.onclick = async () => {
          const fieldKey = addStdSelect.value;
          if (!fieldKey) {
            setMsg('<div class="error">Choose a built-in field to add.</div>');
            return;
          }
          try {
            await api(`/api/record-types/${encodeURIComponent(key)}/standard-fields`, {
              method: 'POST',
              body: JSON.stringify({ fieldKey }),
            });
            setMsg('<div class="ok-banner">Built-in field added to this record page layout.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
      bodyEl.querySelectorAll('[data-edit-type-field]').forEach((btn) => {
        btn.onclick = () => {
          editingId = Number(btn.dataset.editTypeField);
          setMsg('');
          render();
        };
      });
      bodyEl.querySelectorAll('[data-toggle-default-cf]').forEach((box) => {
        box.onchange = async () => {
          try {
            await api(`/api/custom-fields/${box.dataset.toggleDefaultCf}`, {
              method: 'PATCH',
              body: JSON.stringify({ isDefault: !!box.checked }),
            });
            setMsg('<div class="ok-banner">Record type default field updated for this record type.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
            box.checked = !box.checked;
          }
        };
      });
      bodyEl.querySelectorAll('[data-del-type-field]').forEach((btn) => {
        btn.onclick = async () => {
          const label = fieldLabelFromDeleteBtn(btn);
          const sure = await confirmDeleteCustomField(label);
          if (!sure) return;
          try {
            const fieldKey = btn.dataset.delTypeField;
            await api(
              `/api/record-types/${encodeURIComponent(key)}/layout-fields?fieldKey=${encodeURIComponent(fieldKey)}`,
              { method: 'DELETE' }
            );
            if (String(fieldKey) === `cf:${editingId}`) editingId = null;
            setMsg('<div class="ok-banner">Custom field deleted.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      });
      bodyEl.querySelectorAll('[data-del-custom-field]').forEach((btn) => {
        btn.onclick = async () => {
          const label = fieldLabelFromDeleteBtn(btn);
          const sure = await confirmDeleteCustomField(label);
          if (!sure) return;
          try {
            const id = Number(btn.dataset.delCustomField);
            await api(`/api/custom-fields/${id}`, { method: 'DELETE' });
            if (Number(editingId) === id) editingId = null;
            setMsg('<div class="ok-banner">Custom field deleted.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      });
      const cancel = bodyEl.querySelector('[data-cancel-field-edit]');
      if (cancel) {
        cancel.onclick = () => {
          editingId = null;
          setMsg('');
          render();
        };
      }
      const typeFieldForm = bodyEl.querySelector('#typeFieldForm');
      wireDropdownOptionsToggle(typeFieldForm);
      if (typeFieldForm) {
        typeFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          await submitFieldForm(typeFieldForm, {
            createBody: { recordTypeKey: key, appliesTo: entityAppliesTo },
          });
        };
      }
    };

    await render();
  }

  function normalizeRolePermEntry(entry, roleKey = null) {
    const objects = { matter: {}, contact: {}, time: {}, report: {} };
    const src = entry && typeof entry === 'object' ? entry : {};
    const objectsSrc = src.objects && typeof src.objects === 'object' ? src.objects : src;
    const proxyDefault = roleKey === 'admin' || roleKey === 'billing_clerk';
    const addUsersDefault = roleKey === 'admin';
    if (typeof entry === 'string') {
      const full = entry !== 'read_only';
      for (const key of Object.keys(objects)) {
        objects[key] = {
          viewAll: true,
          modifyAll: full,
          delete: full,
          search: true,
          ...(key === 'time' ? {
            selectTimekeeper: full && proxyDefault,
            viewOthers: full,
            modifyOthers: full && proxyDefault,
            deleteOthers: full,
          } : {}),
        };
      }
      return { objects, addUsers: addUsersDefault };
    }
    for (const key of Object.keys(objects)) {
      const o = objectsSrc[key] || {};
      const viewAll = o.viewAll !== false;
      objects[key] = {
        viewAll,
        modifyAll: o.modifyAll !== false,
        delete: !!o.delete,
        search: viewAll && (o.search != null ? !!o.search : true),
      };
      if (key === 'time') {
        objects[key].selectTimekeeper = o.selectTimekeeper != null
          ? !!o.selectTimekeeper
          : proxyDefault;
        objects[key].viewOthers = o.viewOthers !== false;
        objects[key].modifyOthers = o.modifyOthers != null
          ? !!o.modifyOthers
          : proxyDefault;
        objects[key].deleteOthers = o.deleteOthers != null
          ? !!o.deleteOthers
          : !!o.delete;
      }
    }
    return {
      objects,
      addUsers: roleKey === 'admin'
        ? true
        : !!(src.addUsers ?? src.add_users),
    };
  }

  function formatRoleLabel(roleOrLabel) {
    if (roleOrLabel && typeof roleOrLabel === 'object') {
      return String(roleOrLabel.label || roleOrLabel.key || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .split(' ')
        .filter(Boolean)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(' ');
    }
    return String(roleOrLabel || '')
      .replace(/[_-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join(' ');
  }

  async function bindRolePermissionsEditor({ bodyEl, msgEl, permissions } = {}) {
    if (!bodyEl || !permissions) return;
    let roles = (permissions.roles || permissions.profiles || []).map((r) => ({
      ...r,
      label: formatRoleLabel(r),
    }));
    const objects = permissions.objects || [
      { key: 'matter', label: 'Matters' },
      { key: 'contact', label: 'Contacts' },
      { key: 'time', label: 'Time entries' },
      { key: 'report', label: 'Reports' },
    ];
    const accessFlags = [
      { flag: 'viewAll', label: 'View', hint: 'See these records in the app' },
      { flag: 'search', label: 'Find', hint: 'Include in the top search bar' },
      { flag: 'modifyAll', label: 'Edit', hint: 'Create and change records' },
      {
        flag: 'delete',
        label: 'Delete',
        hint: 'Remove records (Contacts: delete on the contact page; linked matters become client-less)',
      },
    ];
    const timeExtraFlags = [
      {
        flag: 'selectTimekeeper',
        label: 'Enter time for someone else',
        hint: 'Choose another timekeeper when logging time',
      },
      {
        flag: 'viewOthers',
        label: 'See other people’s time',
        hint: 'View entries logged by other timekeepers',
      },
      {
        flag: 'modifyOthers',
        label: 'Edit other people’s time',
        hint: 'Change entries logged by other timekeepers',
      },
      {
        flag: 'deleteOthers',
        label: 'Delete other people’s time',
        hint: 'Remove entries logged by other timekeepers',
      },
    ];
    const current = {};
    const syncRolesFromPermissions = (perms) => {
      roles = (perms?.roles || perms?.profiles || roles).map((r) => ({
        ...r,
        label: formatRoleLabel(r),
      }));
      for (const role of roles) {
        current[role.key] = normalizeRolePermEntry(
          (perms?.rolePermissions || permissions.rolePermissions || {})[role.key]
            ?? (perms?.profilePermissions || permissions.profilePermissions || {})[role.key],
          role.key
        );
      }
    };
    syncRolesFromPermissions(permissions);
    const editableRolesOf = () => roles.filter((r) => r.key !== 'admin');
    let activeRole = editableRolesOf().some((r) => r.key === state.settingsRoleKey)
      ? state.settingsRoleKey
      : (editableRolesOf()[0]?.key || 'attorney');
    let dirty = false;
    let cascadeNote = '';
    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };
    const ensureTimeObject = (roleKey) => {
      if (!current[roleKey]) current[roleKey] = normalizeRolePermEntry({}, roleKey);
      if (!current[roleKey].objects.time) {
        current[roleKey].objects.time = normalizeRolePermEntry({}, roleKey).objects.time;
      }
      return current[roleKey].objects.time;
    };
    const objectAccessLabel = (p) => {
      if (!p?.viewAll) return 'No access';
      const parts = ['View'];
      if (p.search) parts.push('Find');
      if (p.modifyAll) parts.push('Edit');
      if (p.delete) parts.push('Delete');
      return parts.join(' · ');
    };
    const roleSummaryHtml = (roleKey) => {
      const objs = current[roleKey]?.objects || {};
      const chips = objects.map((obj) => {
        const label = objectAccessLabel(objs[obj.key]);
        const muted = label === 'No access';
        return `<span class="role-perm-chip${muted ? ' is-muted' : ''}">
          <strong>${escapeHtml(obj.label)}</strong>
          <span>${escapeHtml(label)}</span>
        </span>`;
      });
      const addUsersOn = !!current[roleKey]?.addUsers;
      chips.push(`<span class="role-perm-chip${addUsersOn ? '' : ' is-muted'}">
          <strong>Add users</strong>
          <span>${addUsersOn ? 'Allowed' : 'Off'}</span>
        </span>`);
      return chips.join('');
    };
    const applyPreset = (roleKey, preset) => {
      const proxyDefault = roleKey === 'billing_clerk';
      for (const obj of objects) {
        const key = obj.key;
        if (preset === 'full') {
          current[roleKey].objects[key] = {
            viewAll: true,
            search: true,
            modifyAll: true,
            delete: true,
            ...(key === 'time' ? {
              selectTimekeeper: proxyDefault,
              viewOthers: true,
              modifyOthers: proxyDefault,
              deleteOthers: true,
            } : {}),
          };
        } else if (preset === 'edit_view') {
          // One-click: View + Find + Edit across all areas (no Delete).
          current[roleKey].objects[key] = {
            viewAll: true,
            search: true,
            modifyAll: true,
            delete: false,
            ...(key === 'time' ? {
              selectTimekeeper: false,
              viewOthers: true,
              modifyOthers: false,
              deleteOthers: false,
            } : {}),
          };
        } else if (preset === 'view') {
          current[roleKey].objects[key] = {
            viewAll: true,
            search: true,
            modifyAll: false,
            delete: false,
            ...(key === 'time' ? {
              selectTimekeeper: false,
              viewOthers: true,
              modifyOthers: false,
              deleteOthers: false,
            } : {}),
          };
        } else if (preset === 'no_delete') {
          const cur = current[roleKey].objects[key] || {};
          current[roleKey].objects[key] = {
            viewAll: true,
            search: cur.search !== false,
            modifyAll: true,
            delete: false,
            ...(key === 'time' ? {
              selectTimekeeper: !!cur.selectTimekeeper,
              viewOthers: cur.viewOthers !== false,
              modifyOthers: !!cur.modifyOthers,
              deleteOthers: false,
            } : {}),
          };
        }
      }
      dirty = true;
      cascadeNote = preset === 'edit_view'
        ? 'View, Find, and Edit turned on for all areas. Delete stays off.'
        : '';
      setMsg('');
      render();
    };
    const render = () => {
      const editableRoles = editableRolesOf();
      state.settingsRoleKey = activeRole;
      const role = editableRoles.find((r) => r.key === activeRole) || editableRoles[0];
      if (!role) {
        bodyEl.innerHTML = '<p class="muted">No editable roles.</p>';
        return;
      }
      const roleKey = role.key;
      const roleLabel = formatRoleLabel(role);
      const objs = current[roleKey].objects;
      const timePerms = objs.time || {};
      const showTimeExtras = !!(timePerms.viewAll);
      const canAddUsersForRole = !!current[roleKey].addUsers;
      bodyEl.innerHTML = `
        <div class="role-perms-editor stack">
          <p class="role-perms-admin-note">
            <strong>Admin</strong> always has full access and isn’t shown here.
            <strong>Add users</strong> is on for Admin by default — grant it to other roles below if they should invite people.
          </p>
          <form id="addRoleForm" class="role-perms-add">
            <label class="role-perms-add-label" for="newRoleName">Add role
              <input id="newRoleName" name="label" type="text" maxlength="40"
                placeholder="e.g. Intake Specialist" autocomplete="off" />
            </label>
            <button type="submit" class="primary">Add role</button>
          </form>
          <div class="role-perms-tabs" role="tablist" aria-label="Choose a role">
            ${editableRoles.map((r) => `
              <button type="button" class="role-perms-tab${r.key === roleKey ? ' is-active' : ''}"
                role="tab" aria-selected="${r.key === roleKey ? 'true' : 'false'}"
                data-role-tab="${escapeHtml(r.key)}">
                ${escapeHtml(formatRoleLabel(r))}
              </button>`).join('')}
          </div>
          <div class="role-perm-panel" data-role="${escapeHtml(roleKey)}" role="tabpanel">
            <div class="role-perm-panel-head">
              <div>
                <h3>${escapeHtml(roleLabel)}</h3>
                <p class="hint">What can people with the ${escapeHtml(roleLabel)} role do?</p>
              </div>
              <div class="role-perm-presets" aria-label="Quick setups">
                <span class="muted role-perm-presets-label">Quick setup</span>
                <button type="button" class="primary" data-role-preset="edit_view"
                  title="Turn on View, Find, and Edit for every area">Edit &amp; View</button>
                <button type="button" data-role-preset="view"
                  title="Turn on View and Find only">View only</button>
                <button type="button" data-role-preset="full"
                  title="Turn on View, Find, Edit, and Delete">Full access</button>
                <button type="button" data-role-preset="no_delete"
                  title="Keep edit access but turn Delete off">No delete</button>
              </div>
            </div>
            <div class="role-perm-summary" aria-live="polite">${roleSummaryHtml(roleKey)}</div>
            ${cascadeNote ? `<p class="role-perm-cascade hint">${escapeHtml(cascadeNote)}</p>` : ''}
            <div class="table-wrap"><table class="perms-table role-object-perms">
              <thead>
                <tr>
                  <th scope="col">Area</th>
                  ${accessFlags.map((f) => `
                    <th scope="col" title="${escapeHtml(f.hint)}">
                      <span class="role-perm-col">${escapeHtml(f.label)}</span>
                      <span class="role-perm-col-hint muted">${escapeHtml(f.hint)}</span>
                    </th>`).join('')}
                </tr>
              </thead>
              <tbody>
                ${objects.map((obj) => {
                  const p = objs[obj.key] || {
                    viewAll: true, search: true, modifyAll: true, delete: true,
                  };
                  return `
                  <tr>
                    <td>
                      <strong>${escapeHtml(obj.label)}</strong>
                      <div class="muted role-perm-row-summary">${escapeHtml(objectAccessLabel(p))}</div>
                    </td>
                    ${accessFlags.map((f) => {
                      const checked = !!p[f.flag];
                      const disabled = f.flag === 'search' && !p.viewAll;
                      return `
                      <td>
                        <label class="role-perm-check">
                          <input type="checkbox"
                            data-role-perm="${escapeHtml(roleKey)}"
                            data-object="${escapeHtml(obj.key)}"
                            data-flag="${escapeHtml(f.flag)}"
                            ${checked ? 'checked' : ''}
                            ${disabled ? 'disabled' : ''}
                            title="${escapeHtml(f.hint)}"
                            aria-label="${escapeHtml(f.label)} ${escapeHtml(obj.label)}" />
                          <span class="role-perm-check-label">${escapeHtml(f.label)}</span>
                        </label>
                      </td>`;
                    }).join('')}
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>
            <div class="firm-action-perms">
              <h4>Firm actions</h4>
              <p class="hint">Optional firm-wide actions outside Matters / Contacts / Time / Reports.</p>
              <label class="check-inline role-perm-extra" title="Invite people from Navigate → Add a user">
                <input type="checkbox"
                  data-role-firm="${escapeHtml(roleKey)}"
                  data-flag="addUsers"
                  ${canAddUsersForRole ? 'checked' : ''} />
                <span>
                  <span class="role-perm-extra-label">Add users</span>
                  <span class="muted">Invite people to the firm (Navigate → Add a user)</span>
                </span>
              </label>
            </div>
            ${showTimeExtras ? `
            <div class="timekeeper-perms">
              <h4>Working with other people’s time</h4>
              <p class="hint">Extra options for Time entries — who they can enter, see, edit, or delete for.</p>
              <div class="timekeeper-perms-grid">
                ${timeExtraFlags.map((item) => `
                  <label class="check-inline role-perm-extra" title="${escapeHtml(item.hint)}">
                    <input type="checkbox"
                      data-role-perm="${escapeHtml(roleKey)}"
                      data-object="time"
                      data-flag="${escapeHtml(item.flag)}"
                      ${timePerms[item.flag] ? 'checked' : ''} />
                    <span>
                      <span class="role-perm-extra-label">${escapeHtml(item.label)}</span>
                      <span class="muted">${escapeHtml(item.hint)}</span>
                    </span>
                  </label>`).join('')}
              </div>
            </div>` : `
            <p class="hint role-perm-time-off">
              Turn on <strong>View</strong> for Time entries to set access to other people’s time.
            </p>`}
          </div>
          <div class="row-actions role-perms-save-row">
            <button class="primary" type="button" id="saveRolePermissions"
              ${dirty ? '' : 'disabled'}>
              ${dirty ? 'Save role permissions' : 'Saved'}
            </button>
            ${dirty ? '<span class="muted">Unsaved changes</span>' : ''}
          </div>
        </div>`;
      const addRoleForm = $('#addRoleForm', bodyEl);
      if (addRoleForm) {
        addRoleForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const label = String(new FormData(addRoleForm).get('label') || '').trim();
          if (!label) {
            setMsg('<div class="error">Enter a role name to continue.</div>');
            $('#newRoleName', bodyEl)?.focus();
            return;
          }
          try {
            const updated = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ addRole: { label } }),
            });
            state.settings = updated;
            syncRolesFromPermissions(updated.permissions || {});
            const created = (updated.permissions?.roles || []).find(
              (r) => formatRoleLabel(r).toLowerCase() === formatRoleLabel(label).toLowerCase()
            ) || editableRolesOf().slice(-1)[0];
            if (created?.key) activeRole = created.key;
            dirty = false;
            cascadeNote = '';
            setMsg(`<div class="ok-banner">Role “${escapeHtml(formatRoleLabel(created || { label }))}” added. Adjust permissions below, then Save.</div>`);
            render();
            renderShell({ force: true });
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
      bodyEl.querySelectorAll('[data-role-tab]').forEach((btn) => {
        btn.onclick = () => {
          activeRole = btn.dataset.roleTab;
          cascadeNote = '';
          render();
        };
      });
      bodyEl.querySelectorAll('[data-role-preset]').forEach((btn) => {
        btn.onclick = () => applyPreset(roleKey, btn.dataset.rolePreset);
      });
      bodyEl.querySelectorAll('[data-role-firm]').forEach((box) => {
        box.onchange = () => {
          const rk = box.dataset.roleFirm;
          const flag = box.dataset.flag;
          if (!current[rk]) current[rk] = normalizeRolePermEntry({}, rk);
          if (flag === 'addUsers') current[rk].addUsers = !!box.checked;
          dirty = true;
          cascadeNote = '';
          setMsg('');
          render();
        };
      });
      bodyEl.querySelectorAll('[data-role-perm]').forEach((box) => {
        box.onchange = () => {
          const rk = box.dataset.rolePerm;
          const objectKey = box.dataset.object;
          const flag = box.dataset.flag;
          if (!current[rk]) current[rk] = normalizeRolePermEntry({}, rk);
          if (!current[rk].objects[objectKey]) {
            current[rk].objects[objectKey] = objectKey === 'time'
              ? ensureTimeObject(rk)
              : { viewAll: true, search: true, modifyAll: true, delete: false };
          }
          current[rk].objects[objectKey][flag] = !!box.checked;
          const objPerms = current[rk].objects[objectKey];
          const notes = [];
          // Edit / Delete / Find imply View for usable access.
          if ((flag === 'modifyAll' || flag === 'delete' || flag === 'search') && box.checked) {
            if (!objPerms.viewAll) notes.push('View was turned on too');
            objPerms.viewAll = true;
          }
          // Turning off View also clears Find.
          if (flag === 'viewAll' && !box.checked) {
            if (objPerms.search) notes.push('Find was turned off because View is off');
            objPerms.search = false;
          }
          // Timekeeper extras imply related access.
          if (objectKey === 'time' && box.checked) {
            const timeObj = current[rk].objects.time;
            if (flag === 'selectTimekeeper' || flag === 'modifyOthers' || flag === 'deleteOthers') {
              if (!timeObj.viewOthers) notes.push('See other people’s time was turned on');
              timeObj.viewOthers = true;
            }
            if (flag === 'modifyOthers' || flag === 'deleteOthers' || flag === 'viewOthers'
              || flag === 'selectTimekeeper') {
              if (!timeObj.viewAll) notes.push('View for Time entries was turned on');
              timeObj.viewAll = true;
            }
            if (flag === 'modifyOthers') {
              if (!timeObj.modifyAll) notes.push('Edit for Time entries was turned on');
              timeObj.modifyAll = true;
            }
            if (flag === 'deleteOthers') {
              if (!timeObj.delete) notes.push('Delete for Time entries was turned on');
              timeObj.delete = true;
            }
          }
          dirty = true;
          cascadeNote = notes.length ? `${notes.join('. ')}.` : '';
          setMsg('');
          // Re-render so summaries, Find disabled state, and time block stay in sync.
          render();
        };
      });
      const saveBtn = $('#saveRolePermissions', bodyEl);
      if (saveBtn) {
        saveBtn.onclick = async () => {
          if (!dirty) return;
          try {
            saveBtn.disabled = true;
            const updated = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ rolePermissions: current }),
            });
            state.settings = updated;
            syncRolesFromPermissions(updated.permissions || {});
            dirty = false;
            cascadeNote = '';
            setMsg('<div class="ok-banner">Role permissions saved.</div>');
            render();
            renderShell({ force: true });
            ensureLookupBar();
          } catch (e) {
            saveBtn.disabled = false;
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };
    render();
  }

  function isAlwaysWritableFieldKey(fieldKey) {
    const key = String(fieldKey || '');
    return key === 'name'
      || key === 'std:name'
      || key === 'std:service_date'
      || key === 'std:hours'
      || key === 'std:description';
  }

  function roleFieldAccess(pageKey, fieldKey, settings = state.settings) {
    if (isAlwaysWritableFieldKey(fieldKey)) return 'write';
    const role = state.user?.role;
    if (!role || role === 'admin') return 'write';
    const layout = settings?.permissions?.fieldPermissions
      || settings?.permissions?.recordPageLayout
      || {};
    const page = pageKey === 'time_entry' ? 'time' : pageKey;
    const row = layout[page]?.[fieldKey];
    if (!row || row[role] === undefined) return 'write';
    const raw = row[role];
    if (raw === true || raw === 1) return 'write';
    if (raw === false || raw === 0) return 'hidden';
    const mode = String(raw).toLowerCase();
    if (mode === 'hidden' || mode === 'read' || mode === 'write') return mode;
    return 'write';
  }

  function roleCanSeeField(pageKey, fieldKey, settings = state.settings) {
    return roleFieldAccess(pageKey, fieldKey, settings) !== 'hidden';
  }

  function roleCanEditField(pageKey, fieldKey, settings = state.settings) {
    if (!roleCanModify(pageKey === 'time_entry' ? 'time' : pageKey, settings)) return false;
    return roleFieldAccess(pageKey, fieldKey, settings) === 'write';
  }

  const DEFAULT_TIME_FIELD_CATALOG = [
    { key: 'std:service_date', label: 'Date', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:hours', label: 'Hours', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:timekeeper', label: 'Timekeeper', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:billable', label: 'Billable', kind: 'standard', group: 'Time entry fields' },
    { key: 'std:description', label: 'Description', kind: 'standard', group: 'Time entry fields' },
  ];

  function mergeTimeFieldCatalog(apiFields = []) {
    const byKey = new Map(DEFAULT_TIME_FIELD_CATALOG.map((f) => [f.key, { ...f }]));
    for (const f of apiFields || []) {
      if (!f?.key) continue;
      byKey.set(f.key, {
        key: f.key,
        label: f.label || f.key,
        kind: f.kind || (String(f.key).startsWith('cf:') ? 'custom' : 'standard'),
        group: f.group || (String(f.key).startsWith('cf:') ? 'Custom fields' : 'Time entry fields'),
        fieldId: f.fieldId,
      });
    }
    const standards = DEFAULT_TIME_FIELD_CATALOG.map((f) => byKey.get(f.key)).filter(Boolean);
    const customs = [...byKey.values()].filter((f) => !String(f.key).startsWith('std:'));
    return [...standards, ...customs];
  }

  async function bindFieldPermissionsEditor({ bodyEl, msgEl, permissions } = {}) {
    if (!bodyEl || !permissions) return;
    const roles = (permissions.roles || permissions.profiles || []).map((r) => ({
      ...r,
      label: formatRoleLabel(r),
    }));
    let page = state.settingsLayoutPage || 'matter';
    if (!['matter', 'contact', 'time'].includes(page)) page = 'matter';
    const source = permissions.fieldPermissions || permissions.recordPageLayout || {};
    const layout = {
      matter: { ...(source.matter || {}) },
      contact: { ...(source.contact || {}) },
      time: { ...(source.time || {}) },
    };
    let timeCatalog = mergeTimeFieldCatalog(permissions.timeFields || []);
    // If settings payload omitted time catalogs (stale cache), load customs directly.
    if (!(permissions.timeFields || []).length) {
      try {
        const timeCustoms = await api('/api/custom-fields?appliesTo=time_entry').catch(() => []);
        timeCatalog = mergeTimeFieldCatalog([
          ...DEFAULT_TIME_FIELD_CATALOG,
          ...(timeCustoms || []).map((f) => ({
            key: `cf:${f.id}`,
            label: f.label,
            kind: 'custom',
            group: 'Custom fields',
            fieldId: f.id,
          })),
        ]);
      } catch {
        /* keep defaults */
      }
    }

    let matterRecordTypes = [...(permissions.matterRecordTypes || [])];
    let contactRecordTypes = [...(permissions.contactRecordTypes || [])];
    if (!matterRecordTypes.length || !contactRecordTypes.length) {
      const [matterTypes, contactTypes] = await Promise.all([
        api('/api/record-types?appliesTo=matter').catch(() => []),
        api('/api/record-types?appliesTo=client').catch(() => []),
      ]);
      if (!matterRecordTypes.length) {
        matterRecordTypes = (matterTypes || []).map((t) => ({ key: t.key, label: t.label, fields: null }));
      }
      if (!contactRecordTypes.length) {
        contactRecordTypes = (contactTypes || []).map((t) => ({ key: t.key, label: t.label, fields: null }));
      }
    }

    let matterTypeKey = state.settingsMatterRecordTypeKey
      || matterRecordTypes[0]?.key
      || 'billable';
    let contactTypeKey = state.settingsContactRecordTypeKey
      || contactRecordTypes[0]?.key
      || 'client';
    if (!matterRecordTypes.some((t) => t.key === matterTypeKey) && matterRecordTypes[0]) {
      matterTypeKey = matterRecordTypes[0].key;
    }
    if (!contactRecordTypes.some((t) => t.key === contactTypeKey) && contactRecordTypes[0]) {
      contactTypeKey = contactRecordTypes[0].key;
    }

    const typeFieldCache = {
      matter: new Map(
        matterRecordTypes
          .filter((t) => Array.isArray(t.fields))
          .map((t) => [t.key, t.fields])
      ),
      contact: new Map(
        contactRecordTypes
          .filter((t) => Array.isArray(t.fields))
          .map((t) => [t.key, t.fields])
      ),
    };

    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };
    const fieldMode = (pageKey, fieldKey, roleKey) => {
      if (isAlwaysWritableFieldKey(fieldKey)) return 'write';
      const row = layout[pageKey]?.[fieldKey];
      if (!row || row[roleKey] === undefined) return 'write';
      const raw = row[roleKey];
      if (raw === true || raw === 1) return 'write';
      if (raw === false || raw === 0) return 'hidden';
      const mode = String(raw).toLowerCase();
      if (mode === 'hidden' || mode === 'read' || mode === 'write') return mode;
      return 'write';
    };
    const fieldRoles = roles.filter((r) => r.key !== 'admin');

    async function fieldsForPage() {
      if (page === 'time') return timeCatalog;
      const typeKey = page === 'contact' ? contactTypeKey : matterTypeKey;
      const cache = typeFieldCache[page];
      if (cache.has(typeKey)) return cache.get(typeKey);
      try {
        const typeLayout = await api(`/api/record-types/${encodeURIComponent(typeKey)}/layout`);
        const groupStd = page === 'contact' ? 'Contact fields' : 'Matter fields';
        const seen = new Set();
        const fields = [];
        const push = (entry) => {
          if (!entry?.key || seen.has(entry.key)) return;
          if (page === 'contact' && entry.key === 'std:name') {
            entry = { ...entry, key: 'name', label: entry.label || 'Name', kind: 'standard', group: groupStd };
          }
          if (entry.key === 'std:number' || seen.has(entry.key)) return;
          seen.add(entry.key);
          fields.push(entry);
        };
        if (page === 'contact') {
          push({ key: 'name', label: 'Name', kind: 'standard', group: groupStd });
        }
        for (const f of typeLayout.fields || []) {
          const key = f.fieldKey || f.key;
          push({
            key,
            label: f.label || key,
            kind: f.kind || (String(key).startsWith('cf:') ? 'custom' : 'standard'),
            group: String(key).startsWith('cf:') ? 'Custom fields' : groupStd,
            fieldId: f.fieldId,
          });
        }
        const appliesTo = page === 'contact' ? 'client' : 'matter';
        const customs = await api(
          `/api/custom-fields?appliesTo=${encodeURIComponent(appliesTo)}&type=${encodeURIComponent(typeKey)}`
        ).catch(() => []);
        for (const c of customs || []) {
          if (c.matter_id || c.matterId || c.client_id || c.clientId) continue;
          push({
            key: `cf:${c.id}`,
            label: c.label,
            kind: 'custom',
            group: 'Custom fields',
            fieldId: c.id,
          });
        }
        cache.set(typeKey, fields);
        return fields;
      } catch {
        return page === 'contact'
          ? (permissions.contactFields || [])
          : (permissions.matterFields || []);
      }
    }

    const render = async () => {
      const types = page === 'matter'
        ? matterRecordTypes
        : page === 'contact'
          ? contactRecordTypes
          : [];
      const selectedTypeKey = page === 'matter'
        ? matterTypeKey
        : page === 'contact'
          ? contactTypeKey
          : null;
      const selectedType = types.find((t) => t.key === selectedTypeKey) || types[0];
      const fields = await fieldsForPage();
      if (!bodyEl.isConnected || !stillOnView('settings')) return;

      const recordPagePicker = page === 'time' ? '' : `
        <div class="row-actions" style="flex-wrap:wrap;align-items:flex-end;gap:.75rem">
          <label class="matter-type-picker">Record page
            <select id="fieldPermsRecordPageSelect" name="recordTypeKey">
              ${types.map((t) => `
                <option value="${escapeHtml(t.key)}" ${t.key === selectedTypeKey ? 'selected' : ''}>
                  ${escapeHtml(t.label || t.key)}
                </option>`).join('')}
            </select>
          </label>
        </div>
        <p class="hint">Showing fields for the <strong>${escapeHtml(selectedType?.label || selectedTypeKey || '')}</strong> record page. Pick a record page first, then set who can see or edit each field. Matter name and time Date / Hours / Description stay editable for everyone. Admin always has full access.</p>`;

      bodyEl.innerHTML = `
        <div class="field-perms-editor stack">
          <div class="role-perms-tabs" role="tablist" aria-label="Object">
            <button type="button" data-layout-page="matter" role="tab"
              class="role-perms-tab${page === 'matter' ? ' is-active' : ''}"
              aria-selected="${page === 'matter' ? 'true' : 'false'}">Matter fields</button>
            <button type="button" data-layout-page="contact" role="tab"
              class="role-perms-tab${page === 'contact' ? ' is-active' : ''}"
              aria-selected="${page === 'contact' ? 'true' : 'false'}">Contact fields</button>
            <button type="button" data-layout-page="time" role="tab"
              class="role-perms-tab${page === 'time' ? ' is-active' : ''}"
              aria-selected="${page === 'time' ? 'true' : 'false'}">Time entry fields</button>
          </div>
          ${recordPagePicker || '<p class="hint">For each field, choose whether a role can see it, only read it, or edit it. Date / Hours / Description stay editable for everyone. Admin always has full access.</p>'}
          <div class="table-wrap"><table class="perms-table layout-vis-table field-perms-table">
            <thead>
              <tr>
                <th>Field</th>
                ${fieldRoles.map((p) => `<th>${escapeHtml(p.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${fields.map((f) => {
                const locked = isAlwaysWritableFieldKey(f.key);
                return `
                <tr>
                  <td>
                    <strong>${escapeHtml(f.label)}</strong>
                    <div class="muted">${escapeHtml(f.group || f.kind || '')}${locked ? ' · always editable' : ''}</div>
                  </td>
                  ${fieldRoles.map((p) => `
                    <td>
                      <select data-field-mode="${escapeHtml(f.key)}" data-field-role="${escapeHtml(p.key)}"
                        ${locked ? 'disabled' : ''} aria-label="${escapeHtml(f.label)} for ${escapeHtml(p.label)}">
                        <option value="hidden" ${fieldMode(page, f.key, p.key) === 'hidden' ? 'selected' : ''}>Can’t see</option>
                        <option value="read" ${fieldMode(page, f.key, p.key) === 'read' ? 'selected' : ''}>Can view</option>
                        <option value="write" ${fieldMode(page, f.key, p.key) === 'write' ? 'selected' : ''}>Can edit</option>
                      </select>
                    </td>`).join('')}
                </tr>`;
              }).join('') || `<tr><td class="muted" colspan="${fieldRoles.length + 1}">No fields on this record page yet</td></tr>`}
            </tbody>
          </table></div>
          <div class="row-actions">
            <button class="primary" type="button" id="saveFieldPermissions">Save field permissions</button>
          </div>
        </div>`;
      bodyEl.querySelectorAll('[data-layout-page]').forEach((btn) => {
        btn.onclick = () => {
          page = btn.dataset.layoutPage;
          state.settingsLayoutPage = page;
          setMsg('');
          void render();
        };
      });
      const typeSelect = bodyEl.querySelector('#fieldPermsRecordPageSelect');
      if (typeSelect) {
        typeSelect.onchange = () => {
          const next = typeSelect.value;
          if (page === 'matter') {
            matterTypeKey = next;
            state.settingsMatterRecordTypeKey = next;
          } else if (page === 'contact') {
            contactTypeKey = next;
            state.settingsContactRecordTypeKey = next;
          }
          setMsg('');
          void render();
        };
      }
      bodyEl.querySelectorAll('[data-field-mode]').forEach((sel) => {
        sel.onchange = () => {
          const fieldKey = sel.dataset.fieldMode;
          const roleKey = sel.dataset.fieldRole;
          if (!layout[page][fieldKey]) layout[page][fieldKey] = {};
          layout[page][fieldKey][roleKey] = sel.value;
        };
      });
      const saveBtn = $('#saveFieldPermissions', bodyEl);
      if (saveBtn) {
        saveBtn.onclick = async () => {
          try {
            const currentFields = await fieldsForPage();
            for (const f of currentFields || []) {
              if (!layout[page][f.key]) layout[page][f.key] = {};
              for (const p of roles) {
                if (layout[page][f.key][p.key] === undefined) {
                  layout[page][f.key][p.key] = fieldMode(page, f.key, p.key);
                }
              }
            }
            const updated = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ fieldPermissions: layout }),
            });
            state.settings = updated;
            const next = updated.permissions?.fieldPermissions
              || updated.permissions?.recordPageLayout
              || layout;
            layout.matter = { ...(next.matter || {}) };
            layout.contact = { ...(next.contact || {}) };
            layout.time = { ...(next.time || {}) };
            if (updated.permissions?.matterRecordTypes) {
              matterRecordTypes = updated.permissions.matterRecordTypes;
              typeFieldCache.matter = new Map(
                matterRecordTypes
                  .filter((t) => Array.isArray(t.fields))
                  .map((t) => [t.key, t.fields])
              );
            }
            if (updated.permissions?.contactRecordTypes) {
              contactRecordTypes = updated.permissions.contactRecordTypes;
              typeFieldCache.contact = new Map(
                contactRecordTypes
                  .filter((t) => Array.isArray(t.fields))
                  .map((t) => [t.key, t.fields])
              );
            }
            setMsg('<div class="ok-banner">Field permissions saved.</div>');
            await render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };
    await render();
  }

  /** @deprecated */
  async function bindProfilePermissionsEditor(opts) {
    return bindRolePermissionsEditor(opts);
  }

  /** @deprecated */
  async function bindRecordPageLayoutEditor(opts) {
    return bindFieldPermissionsEditor(opts);
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

  /** Undecorated matter name for duplicate checks (strips Status/Year, No Client, month-year). */
  function matterBaseName(name) {
    let base = String(name || '').trim();
    let m = base.match(/^(.*?)(?:\s+[—-]\s+.+?\s+[—-]\s+\d{4})$/);
    if (m) base = m[1].trim();
    else {
      m = base.match(/^(.*?)\s+[—-]\s+(\d{4})$/);
      if (m) base = m[1].trim();
      else {
        m = base.match(/^(.*?)\s+[—-]\s+(.+)$/);
        if (m && !/^\d{4}$/.test(m[2].trim())) base = m[1].trim();
      }
    }
    // Match server cleanMatterBaseName: no client placeholder / billing month on matter names.
    const months = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
    base = base.replace(/\bNo\s*[-_]?\s*Client\b/gi, ' ');
    base = base.replace(new RegExp(`\\b${months}\\s+\\d{4}\\b`, 'gi'), ' ');
    base = base.replace(new RegExp(`\\b${months}[-/]\\d{4}\\b`, 'gi'), ' ');
    return base
      .replace(/\s+/g, ' ')
      .replace(/\s*[—-]\s*/g, ' - ')
      .replace(/^(?: - )+|(?: - )+$/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function clientSearchText(c) {
    return [c?.name, c?.record_type, c?.recordType, c?.email]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function rankClientMatches(clients, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const scored = [];
    for (const c of clients || []) {
      const name = String(c.name || '').toLowerCase();
      const hay = clientSearchText(c);
      let score = 0;
      if (name.startsWith(needle)) score = 3;
      else if (name.split(/\s+/).some((w) => w.startsWith(needle))) score = 2;
      else if (hay.includes(needle)) score = 1;
      if (score) scored.push({ c, score, name });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.map((row) => row.c);
  }

  function rankMatterMatches(matters, query) {
    const needle = String(query || '').trim().toLowerCase();
    if (!needle) return [];
    const scored = [];
    for (const m of matters || []) {
      const full = String(m.name || '').toLowerCase();
      const base = matterBaseName(m.name).toLowerCase();
      const hay = matterSearchText(m);
      let score = 0;
      if (base.startsWith(needle) || full.startsWith(needle)) score = 3;
      else if (base.split(/\s+/).some((w) => w.startsWith(needle))
        || full.split(/\s+/).some((w) => w.startsWith(needle))) score = 2;
      else if (hay.includes(needle)) score = 1;
      if (score) scored.push({ m, score, name: base || full });
    }
    scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
    return scored.map((row) => row.m);
  }

  function findExactMatterMatch(matters, name) {
    const needle = matterBaseName(name).toLowerCase();
    if (!needle) return null;
    return (matters || []).find((m) => matterBaseName(m.name).toLowerCase() === needle) || null;
  }

  function findExactClientMatch(clients, name, email = '') {
    const needle = String(name || '').trim().toLowerCase();
    const emailNeedle = String(email || '').trim().toLowerCase();
    if (needle) {
      const byName = (clients || []).find((c) => String(c.name || '').trim().toLowerCase() === needle);
      if (byName) return byName;
    }
    if (emailNeedle) {
      return (clients || []).find((c) => String(c.email || '').trim().toLowerCase() === emailNeedle) || null;
    }
    return null;
  }

  function emptyMatterSearchState() {
    return { q: '', filterKey: '', filterValue: '' };
  }

  function matterBrowseQueryParams(search = state.matterSearch) {
    const params = new URLSearchParams();
    const q = String(search?.q || '').trim();
    // Indexed text search starts at 2 characters; shorter queries keep the full browse list.
    if (q.length >= 2) params.set('q', q);
    const filterKey = String(search?.filterKey || '').trim();
    const filterValue = String(search?.filterValue || '').trim();
    if (filterKey === 'status' && filterValue) {
      params.set('status', filterValue);
    } else if (filterKey.startsWith('cf:') && filterValue) {
      const fieldId = filterKey.slice(3);
      if (fieldId) {
        params.set('fieldId', fieldId);
        params.set('fieldValue', filterValue);
      }
    }
    params.set('listColumns', '1');
    return params;
  }

  function formatMatterStatusLabel(status) {
    const s = String(status || '').trim();
    if (!s) return '—';
    // Display with an initial capital (stored values stay lowercase: open/closed).
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function defaultMatterListColumns() {
    return [
      { key: 'name', label: 'Name', kind: 'built_in', removable: false },
      { key: 'client', label: 'Client', kind: 'built_in', removable: true },
      { key: 'status', label: 'Status', kind: 'custom', removable: true },
      { key: 'attorney', label: 'Attorney', kind: 'built_in', removable: true },
    ];
  }

  function matterListColumnsOrDefault(config = state.matterListColumns) {
    const cols = Array.isArray(config?.columns) && config.columns.length
      ? config.columns
      : defaultMatterListColumns();
    return cols;
  }

  function matterListCellDisplay(m, col, typeLabelByKey = {}) {
    const key = col?.key || col;
    switch (key) {
      case 'name':
        return m.name || '—';
      case 'number':
        return m.number || '—';
      case 'client':
        return m.client_name || '—';
      case 'status':
        return formatMatterStatusLabel(m.status);
      case 'attorney':
        return m.attorney_name || '—';
      case 'matter_type': {
        const k = m.matter_type || '';
        return (typeLabelByKey && typeLabelByKey[k]) || k || '—';
      }
      case 'opened_on':
        return m.opened_on || '—';
      default: {
        if (String(key).startsWith('cf:')) {
          const id = String(key).slice(3);
          const bag = m.customValues || {};
          const v = bag[id] ?? bag[Number(id)];
          return (v == null || v === '') ? '—' : String(v);
        }
        return '—';
      }
    }
  }

  function matterListCellHtml(m, col, typeLabelByKey = {}) {
    const key = col?.key || col;
    const text = matterListCellDisplay(m, col, typeLabelByKey);
    if (key === 'name') {
      return `<td><strong>${escapeHtml(text)}</strong></td>`;
    }
    if (key === 'status') {
      return `<td><span class="pill" data-status="${escapeHtml(m.status || '')}">${escapeHtml(text)}</span></td>`;
    }
    return `<td>${escapeHtml(text)}</td>`;
  }

  function matterListHtml(hits, {
    q = '',
    filterKey = '',
    filterValue = '',
    canDelete = false,
    columns = null,
    typeLabelByKey = {},
  } = {}) {
    const query = String(q || '').trim();
    const rows = hits || [];
    const cols = Array.isArray(columns) && columns.length
      ? columns
      : matterListColumnsOrDefault();
    const filterBits = [];
    if (query) filterBits.push(`“${query}”`);
    if (filterKey && filterValue) {
      const label = filterKey === 'status'
        ? 'Status'
        : (filterKey.startsWith('cf:') ? 'custom field' : 'filter');
      filterBits.push(`${label}: ${filterValue}`);
    }
    const summary = rows.length
      ? `${rows.length} matter${rows.length === 1 ? '' : 's'}${filterBits.length ? ` · ${filterBits.join(' · ')}` : ''}`
      : (filterBits.length
        ? `No matters match ${filterBits.join(' · ')}`
        : 'No matters yet');
    const colSpan = cols.length + (canDelete ? 1 : 0);
    return `
      <p class="muted matters-list-summary">${escapeHtml(summary)}</p>
      <div class="matters-list-scroll table-wrap">
        <table class="matters-list-table">
          <thead>
            <tr>
              ${cols.map((c) => `<th>${escapeHtml(c.label || c.key)}</th>`).join('')}
              ${canDelete ? '<th class="matters-list-actions-col"></th>' : ''}
            </tr>
          </thead>
          <tbody>
            ${rows.map((m) => `
              <tr class="click-row" data-matter="${m.id}">
                ${cols.map((c) => matterListCellHtml(m, c, typeLabelByKey)).join('')}
                ${canDelete ? `
                  <td class="matters-list-actions">
                    <button type="button" class="danger" data-del-matter="${m.id}"
                      data-del-matter-name="${escapeHtml(m.name || '')}">Delete</button>
                  </td>` : ''}
              </tr>`).join('') || `<tr><td colspan="${colSpan}" class="muted">No matters to show</td></tr>`}
          </tbody>
        </table>
      </div>`;
  }

  function matterListColumnCatalog(config = state.matterListColumns) {
    const active = matterListColumnsOrDefault(config);
    const available = Array.isArray(config?.available) ? config.available : [];
    const byKey = new Map();
    for (const c of [...active, ...available]) {
      if (c?.key) byKey.set(c.key, c);
    }
    return { active, available, byKey };
  }

  function matterListColumnsModalBodyHtml(activeKeys, catalog, { canEdit = false } = {}) {
    const active = activeKeys
      .map((key) => catalog.byKey.get(key) || { key, label: key, kind: 'built_in', removable: key !== 'name' })
      .filter(Boolean);
    const activeSet = new Set(activeKeys);
    const available = [...catalog.byKey.values()].filter((c) => !activeSet.has(c.key));
    return `
      <p class="hint" id="mlcModalHint">${canEdit
        ? 'Add or remove columns, and drag to rearrange. Name stays on the list. Applies to the Matters list and Excel export.'
        : 'These columns appear on the Matters list and Excel export.'}</p>
      <div class="mlc-modal-section">
        <p class="mlc-available-label">Columns on the list</p>
        <div class="mlc-active-list" id="matterListColumnRows" ${canEdit ? 'data-mlc-sortable="1"' : ''}>
          ${active.map((c) => `
            <div class="mlc-chip is-active${canEdit ? ' is-draggable' : ''}${c.removable === false ? ' is-locked' : ''}"
              data-mlc-key="${escapeHtml(c.key)}"
              ${canEdit ? 'draggable="true"' : ''}>
              ${canEdit ? '<span class="mlc-drag" title="Drag to rearrange" aria-hidden="true">⋮⋮</span>' : ''}
              <span class="mlc-chip-label">
                <strong>${escapeHtml(c.label || c.key)}</strong>
                <small>${c.kind === 'custom' ? 'Custom' : 'Built-in'}${c.removable === false ? ' · required' : ''}</small>
              </span>
              ${canEdit && c.removable !== false
                ? `<button type="button" class="mlc-remove" data-mlc-remove="${escapeHtml(c.key)}"
                    title="Remove column" aria-label="Remove ${escapeHtml(c.label || c.key)}">×</button>`
                : ''}
            </div>`).join('') || '<p class="muted">No columns configured.</p>'}
        </div>
      </div>
      ${canEdit ? `
        <div class="mlc-modal-section mlc-available" id="matterListAvailableColumns">
          <p class="mlc-available-label">Add columns</p>
          <div class="mlc-available-chips">
            ${available.length
              ? available.map((c) => `
                <button type="button" class="mlc-chip is-available" data-mlc-add="${escapeHtml(c.key)}">
                  <span class="mlc-chip-label">
                    <strong>${escapeHtml(c.label || c.key)}</strong>
                    <small>${c.kind === 'custom' ? 'Custom' : 'Built-in'}</small>
                  </span>
                  <span class="mlc-add-mark" aria-hidden="true">+</span>
                </button>`).join('')
              : '<p class="muted">All available columns are already on the list.</p>'}
          </div>
        </div>` : ''}
      <div id="matterListColumnsMsg"></div>`;
  }

  function showMatterDeleteError(hostEl, message) {
    if (!hostEl) {
      alert(message || 'Could not delete matter');
      return;
    }
    const existing = hostEl.querySelector('.matters-list-delete-error, .matter-delete-time-block');
    if (existing) existing.remove();
    const banner = document.createElement('div');
    banner.className = 'error matters-list-delete-error stack';
    banner.style.gap = '0.5rem';
    const msg = message || 'Could not delete matter';
    const explainTransfer = /time entr/i.test(msg) && /still reference this matter/i.test(msg);
    banner.innerHTML = `
      <p style="margin:0">${escapeHtml(msg)}</p>
      ${explainTransfer
        ? '<p class="hint" style="margin:0;color:inherit">Time entries must be transferred to another matter before this matter can be deleted.</p>'
        : ''}`;
    hostEl.prepend(banner);
  }

  async function deleteMatterFromList(id, name) {
    const sure = await confirmAction({
      title: 'Delete this matter?',
      message: 'Are you sure you want to delete this matter? This cannot be undone.',
      name: name || 'this matter',
      confirmLabel: 'Yes, delete matter',
      cancelLabel: 'Cancel',
    });
    if (!sure) return false;
    await api(`/api/matters/${id}`, { method: 'DELETE' });
    if (Number(state.matterId) === Number(id)) {
      state.matterId = null;
      state.showPostCreateFields = false;
      state.editingMatterFieldId = null;
    }
    await refreshRefs();
    return true;
  }

  function wireMatterListRows(rootEl, { canDelete = false } = {}) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-matter]').forEach((row) => {
      row.onclick = () => {
        openMatter(Number(row.dataset.matter));
      };
    });
    if (!canDelete) return;
    rootEl.querySelectorAll('[data-del-matter]').forEach((btn) => {
      btn.onclick = async (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const id = Number(btn.dataset.delMatter);
        const name = btn.getAttribute('data-del-matter-name') || 'this matter';
        if (!id) return;
        try {
          const deleted = await deleteMatterFromList(id, name);
          if (!deleted) return;
          if (stillOnView('matters')) await renderMatters();
          else {
            state.view = 'matters';
            renderShell();
            await renderMatters();
          }
        } catch (e) {
          showMatterDeleteError($('#matterSearchResults') || rootEl, e.message);
        }
      };
    });
  }

  function matterFilterValueControlHtml(filterFields, filterKey, filterValue) {
    const key = String(filterKey || '');
    const value = String(filterValue || '');
    if (!key) {
      return `
        <label class="matter-filter-value">Value
          <select name="filterValue" id="matterFilterValue" disabled>
            <option value="">Choose a field first</option>
          </select>
        </label>`;
    }
    if (key === 'status') {
      const builtIn = (filterFields?.builtIn || []).find((f) => f.key === 'status');
      const options = builtIn?.options || [
        { value: 'open', label: 'Open' },
        { value: 'closed', label: 'Closed' },
      ];
      return `
        <label class="matter-filter-value">Value
          <select name="filterValue" id="matterFilterValue">
            <option value="">All</option>
            ${options.map((o) => {
              const v = typeof o === 'string' ? o : o.value;
              const label = typeof o === 'string' ? formatMatterStatusLabel(o) : (o.label || formatMatterStatusLabel(o.value));
              return `<option value="${escapeHtml(v)}" ${value === v ? 'selected' : ''}>${escapeHtml(label)}</option>`;
            }).join('')}
          </select>
        </label>`;
    }
    if (key.startsWith('cf:')) {
      const id = Number(key.slice(3));
      const field = (filterFields?.custom || []).find((f) => Number(f.id) === id);
      const options = field?.options || [];
      if (options.length) {
        return `
          <label class="matter-filter-value">Value
            <select name="filterValue" id="matterFilterValue">
              <option value="">All</option>
              ${options.map((o) => `
                <option value="${escapeHtml(o)}" ${value === String(o) ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
            </select>
          </label>`;
      }
      return `
        <label class="matter-filter-value">Value
          <input name="filterValue" id="matterFilterValue" value="${escapeHtml(value)}"
            placeholder="Type a value…" autocomplete="off" />
        </label>`;
    }
    return `
      <label class="matter-filter-value">Value
        <input name="filterValue" id="matterFilterValue" value="${escapeHtml(value)}"
          placeholder="Type a value…" autocomplete="off" />
      </label>`;
  }

  function matterFilterBarHtml(filterFields, search = state.matterSearch) {
    const filterKey = String(search?.filterKey || '');
    const filterValue = String(search?.filterValue || '');
    const custom = filterFields?.custom || [];
    return `
      <div class="matter-filter-bar" id="matterFilterBar">
        <label class="matter-filter-field">Filter by
          <select name="filterKey" id="matterFilterKey">
            <option value="">No field filter</option>
            <option value="status" ${filterKey === 'status' ? 'selected' : ''}>Status</option>
            ${custom.map((f) => {
              const key = `cf:${f.id}`;
              return `<option value="${escapeHtml(key)}" ${filterKey === key ? 'selected' : ''}>${escapeHtml(f.label)}</option>`;
            }).join('')}
          </select>
        </label>
        ${matterFilterValueControlHtml(filterFields, filterKey, filterValue)}
      </div>`;
  }

  /**
   * Modal to add/remove Matters list columns and rearrange order
   * (Name, Client, Status, …). Saves on Apply.
   */
  function openMatterListColumnsModal({ canEdit = false } = {}) {
    const catalog = matterListColumnCatalog(state.matterListColumns);
    let draftKeys = matterListColumnsOrDefault(state.matterListColumns).map((c) => c.key);

    const existing = document.querySelector('.confirm-overlay');
    if (existing) existing.remove();
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-dialog confirm-dialog--matter-columns" role="dialog" aria-modal="true"
        aria-labelledby="mlcModalTitle">
        <h2 id="mlcModalTitle">${canEdit ? 'Add or remove columns' : 'List columns'}</h2>
        <div id="mlcModalBody" class="mlc-modal-body stack">
          ${matterListColumnsModalBodyHtml(draftKeys, catalog, { canEdit })}
        </div>
        <div class="confirm-actions">
          <button type="button" data-mlc-cancel>${canEdit ? 'Cancel' : 'Close'}</button>
          ${canEdit ? '<button type="button" class="primary" data-mlc-apply>Apply</button>' : ''}
        </div>
      </div>`;
    document.body.appendChild(overlay);

    const bodyEl = overlay.querySelector('#mlcModalBody');
    const msg = (html) => {
      const el = overlay.querySelector('#matterListColumnsMsg');
      if (el) el.innerHTML = html || '';
    };

    const close = () => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (ev) => {
      if (ev.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    overlay.addEventListener('click', (ev) => {
      if (ev.target === overlay) close();
    });
    overlay.querySelector('[data-mlc-cancel]')?.addEventListener('click', close);

    const keysFromDom = () => [...(overlay.querySelectorAll('#matterListColumnRows [data-mlc-key]') || [])]
      .map((el) => String(el.getAttribute('data-mlc-key') || '').trim())
      .filter(Boolean);

    const syncDraftFromDom = () => {
      const keys = keysFromDom();
      if (keys.length) draftKeys = keys;
    };

    const paint = () => {
      if (!bodyEl) return;
      bodyEl.innerHTML = matterListColumnsModalBodyHtml(draftKeys, catalog, { canEdit });
      wireModalInteractions();
    };

    const wireModalInteractions = () => {
      if (!canEdit) return;
      const list = overlay.querySelector('#matterListColumnRows');

      overlay.querySelectorAll('[data-mlc-remove]').forEach((btn) => {
        btn.onclick = (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const key = String(btn.dataset.mlcRemove || '');
          if (!key || key === 'name') return;
          syncDraftFromDom();
          draftKeys = draftKeys.filter((k) => k !== key);
          paint();
        };
      });

      overlay.querySelectorAll('[data-mlc-add]').forEach((btn) => {
        btn.onclick = (ev) => {
          ev.preventDefault();
          const key = String(btn.dataset.mlcAdd || '').trim();
          if (!key) return;
          syncDraftFromDom();
          if (!draftKeys.includes(key)) draftKeys = [...draftKeys, key];
          paint();
        };
      });

      if (!list || list.getAttribute('data-mlc-sortable') !== '1') return;

      let dragEl = null;
      list.querySelectorAll('.mlc-chip.is-draggable').forEach((chip) => {
        chip.addEventListener('mousedown', (ev) => {
          if (ev.target.closest?.('[data-mlc-remove]')) {
            chip.draggable = false;
            return;
          }
          chip.draggable = true;
        });
        chip.addEventListener('dragstart', (ev) => {
          if (ev.target.closest?.('[data-mlc-remove]')) {
            ev.preventDefault();
            return;
          }
          dragEl = chip;
          chip.classList.add('is-dragging');
          try {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', chip.getAttribute('data-mlc-key') || '');
          } catch (_) { /* ignore */ }
        });
        chip.addEventListener('dragend', () => {
          chip.classList.remove('is-dragging');
          list.querySelectorAll('.mlc-chip.is-drop-target').forEach((el) => {
            el.classList.remove('is-drop-target');
          });
          syncDraftFromDom();
          dragEl = null;
        });
      });

      list.addEventListener('dragover', (ev) => {
        if (!dragEl || !list.contains(dragEl)) return;
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (_) { /* ignore */ }
        const over = ev.target.closest?.('.mlc-chip.is-draggable');
        if (!over || over === dragEl || !list.contains(over)) return;
        list.querySelectorAll('.mlc-chip.is-drop-target').forEach((el) => {
          if (el !== over) el.classList.remove('is-drop-target');
        });
        over.classList.add('is-drop-target');
        const rect = over.getBoundingClientRect();
        const before = ev.clientY < rect.top + rect.height / 2;
        if (before) list.insertBefore(dragEl, over);
        else list.insertBefore(dragEl, over.nextSibling);
      });

      list.addEventListener('drop', (ev) => {
        if (!dragEl || !list.contains(dragEl)) return;
        ev.preventDefault();
        list.querySelectorAll('.mlc-chip.is-drop-target').forEach((el) => {
          el.classList.remove('is-drop-target');
        });
        syncDraftFromDom();
      });
    };

    wireModalInteractions();

    const applyBtn = overlay.querySelector('[data-mlc-apply]');
    if (applyBtn && canEdit) {
      applyBtn.onclick = async () => {
        syncDraftFromDom();
        if (!draftKeys.includes('name')) draftKeys = ['name', ...draftKeys];
        applyBtn.disabled = true;
        msg('<p class="muted">Saving columns…</p>');
        try {
          const next = await api('/api/matters/list-columns', {
            method: 'PUT',
            body: JSON.stringify({ columns: draftKeys }),
          });
          state.matterListColumns = next;
          close();
          if (stillOnView('matters')) await renderMatters();
        } catch (e) {
          msg(`<div class="error">${escapeHtml(e.message || 'Could not save columns')}</div>`);
          applyBtn.disabled = false;
        }
      };
    }

    setTimeout(() => {
      (applyBtn || overlay.querySelector('[data-mlc-cancel]'))?.focus();
    }, 0);
  }

  function wireMatterListColumnsButton({ canEdit = false } = {}) {
    const btn = $('#matterListColumnsBtn');
    if (!btn) return;
    btn.onclick = () => openMatterListColumnsModal({ canEdit });
  }

  let matterLiveSearchTimer = null;
  let matterLiveSearchSeq = 0;

  function wireMatterLiveSearch(filterFields = null, {
    canDelete = false,
    columns = null,
    typeLabelByKey = {},
  } = {}) {
    const form = $('#matterSearch');
    const input = form?.querySelector('input[name="q"]');
    const resultsEl = $('#matterSearchResults');
    const filterKeyEl = $('#matterFilterKey');
    if (!form || !input || !resultsEl) return;

    const listOpts = () => ({
      columns: columns || matterListColumnsOrDefault(state.matterListColumns),
      typeLabelByKey,
    });

    const paintRows = () => {
      wireMatterListRows(resultsEl, { canDelete });
    };

    const readFilters = () => {
      const filterKey = String($('#matterFilterKey')?.value || '').trim();
      const filterValue = String($('#matterFilterValue')?.value || '').trim();
      return {
        q: String(input.value || '').trim(),
        filterKey,
        filterValue,
      };
    };

    const refreshFilterValueControl = () => {
      const wrap = $('#matterFilterBar');
      if (!wrap) return;
      const filterKey = String($('#matterFilterKey')?.value || '').trim();
      const prevValue = String($('#matterFilterValue')?.value || '').trim();
      const keepValue = filterKey === String(state.matterSearch?.filterKey || '')
        ? (prevValue || String(state.matterSearch?.filterValue || ''))
        : '';
      const valueLabel = wrap.querySelector('.matter-filter-value');
      const html = matterFilterValueControlHtml(filterFields, filterKey, keepValue);
      const tmp = document.createElement('div');
      tmp.innerHTML = html.trim();
      const next = tmp.firstElementChild;
      if (valueLabel && next) valueLabel.replaceWith(next);
      else if (!valueLabel && next) wrap.appendChild(next);
      const valueEl = $('#matterFilterValue');
      if (valueEl) {
        valueEl.addEventListener('change', () => { void runSearch(); });
        valueEl.addEventListener('input', () => { schedule(); });
      }
    };

    const runSearch = async () => {
      const next = readFilters();
      // Text search needs 2+ characters; shorter text is ignored so the browse list stays visible.
      const effective = (next.q && next.q.length < 2) ? { ...next, q: '' } : next;
      state.matterSearch = next;
      const seq = ++matterLiveSearchSeq;
      resultsEl.innerHTML = '<p class="muted">Loading matters…</p>';
      try {
        const params = matterBrowseQueryParams(effective);
        const hits = await api(`/api/matters?${params}`);
        if (seq !== matterLiveSearchSeq || !stillOnView('matters')) return;
        resultsEl.innerHTML = matterListHtml(hits, { ...effective, canDelete, ...listOpts() });
        paintRows();
      } catch (e) {
        if (seq !== matterLiveSearchSeq || !stillOnView('matters')) return;
        resultsEl.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };

    const schedule = () => {
      if (matterLiveSearchTimer) clearTimeout(matterLiveSearchTimer);
      matterLiveSearchTimer = setTimeout(() => {
        matterLiveSearchTimer = null;
        void runSearch();
      }, 180);
    };

    input.addEventListener('input', () => { schedule(); });
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      if (matterLiveSearchTimer) clearTimeout(matterLiveSearchTimer);
      matterLiveSearchTimer = null;
      await runSearch();
    };
    if (filterKeyEl) {
      filterKeyEl.addEventListener('change', () => {
        state.matterSearch = {
          ...state.matterSearch,
          filterKey: String(filterKeyEl.value || ''),
          filterValue: '',
        };
        refreshFilterValueControl();
        void runSearch();
      });
    }
    const valueEl = $('#matterFilterValue');
    if (valueEl) {
      valueEl.addEventListener('change', () => { void runSearch(); });
      valueEl.addEventListener('input', () => { schedule(); });
    }
    const clearBtn = $('#clearSearch');
    if (clearBtn) {
      clearBtn.onclick = async () => {
        if (matterLiveSearchTimer) clearTimeout(matterLiveSearchTimer);
        matterLiveSearchTimer = null;
        input.value = '';
        state.matterSearch = emptyMatterSearchState();
        if (filterKeyEl) filterKeyEl.value = '';
        refreshFilterValueControl();
        await runSearch();
      };
    }
    paintRows();
  }

  let matterNameTypeaheadDocBound = false;
  function ensureMatterNameTypeaheadDocClose() {
    if (matterNameTypeaheadDocBound) return;
    matterNameTypeaheadDocBound = true;
    document.addEventListener('click', (ev) => {
      document.querySelectorAll('[data-matter-name-typeahead].is-open').forEach((el) => {
        if (!el.contains(ev.target)) {
          const list = el.querySelector('[data-matter-name-list]');
          const input = el.querySelector('input');
          if (list) list.hidden = true;
          if (input) input.setAttribute('aria-expanded', 'false');
          el.classList.remove('is-open');
        }
      });
    });
  }

  function wireCreateMatterNameTypeahead(nameInput, matters) {
    if (!nameInput) return;
    const wrap = nameInput.closest('[data-matter-name-typeahead]');
    const list = wrap?.querySelector('[data-matter-name-list]');
    if (!wrap || !list) return;
    ensureMatterNameTypeaheadDocClose();

    const close = () => {
      list.hidden = true;
      nameInput.setAttribute('aria-expanded', 'false');
      wrap.classList.remove('is-open');
    };

    const renderList = (q) => {
      const needle = String(q || '').trim();
      if (needle.length < 2) {
        close();
        return;
      }
      const matches = rankMatterMatches(matters, needle).slice(0, 6);
      const exact = findExactMatterMatch(matters, needle);
      if (!matches.length) {
        list.innerHTML = `
          <li class="client-typeahead-option is-muted" aria-disabled="true">
            <span>No existing matters match</span>
            <small>Safe to create a new one</small>
          </li>`;
        list.hidden = false;
        nameInput.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        return;
      }
      list.innerHTML = `
        ${exact ? `
          <li class="client-typeahead-option is-muted" aria-disabled="true">
            <span>Duplicate name</span>
            <small>A matter with this name already exists — open it instead</small>
          </li>` : `
          <li class="client-typeahead-option is-muted" aria-disabled="true">
            <span>Existing matters</span>
            <small>Select one to open, or keep typing a unique name</small>
          </li>`}
        ${matches.map((m) => `
          <li role="option" class="client-typeahead-option" data-matter-pick="${m.id}">
            <span>${escapeHtml(m.name)}</span>
            <small>${escapeHtml([m.client_name, m.status ? formatMatterStatusLabel(m.status) : ''].filter(Boolean).join(' · ') || 'Matter')}</small>
          </li>`).join('')}`;
      list.hidden = false;
      nameInput.setAttribute('aria-expanded', 'true');
      wrap.classList.add('is-open');
      list.querySelectorAll('[data-matter-pick]').forEach((el) => {
        el.onmousedown = (ev) => {
          ev.preventDefault();
          state.matterSearch = emptyMatterSearchState();
          state.showCreateMatter = false;
          openMatter(Number(el.dataset.matterPick));
        };
      });
    };

    nameInput.setAttribute('autocomplete', 'off');
    nameInput.setAttribute('aria-autocomplete', 'list');
    nameInput.addEventListener('input', () => {
      const q = String(nameInput.value || '');
      state.createMatterDraftName = q;
      // Keep Create Matter name separate from Search matters — only show local duplicate suggestions.
      renderList(q);
    });
    nameInput.addEventListener('focus', () => {
      renderList(nameInput.value);
    });
    nameInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') close();
    });
  }

  function renderClientTypeahead({
    name = 'clientId',
    selectedId = '',
    clients = [],
    allowAddNew = false,
    newClientName = '',
  } = {}) {
    const selected = (clients || []).find((c) => String(c.id) === String(selectedId)) || null;
    const isNew = selectedId === '__new__';
    const display = isNew
      ? String(newClientName || '').trim()
      : (selected?.name || '');
    const placeholder = allowAddNew
      ? 'Type to find a contact or enter a new name…'
      : 'Type a few letters to find a contact…';
    return `
      <div class="client-typeahead${isNew ? ' is-new' : ''}${display && !isNew ? ' has-value' : ''}" data-client-typeahead>
        <div class="client-typeahead-input-wrap">
          <input type="text" class="client-typeahead-input" data-client-search
            value="${escapeHtml(display)}"
            placeholder="${escapeHtml(placeholder)}"
            autocomplete="off" aria-autocomplete="list" aria-expanded="false"
            aria-label="Contact" />
          <button type="button" class="client-typeahead-clear" data-client-clear
            title="Clear contact" aria-label="Clear contact"
            ${display ? '' : 'hidden'}>×</button>
          <ul class="client-typeahead-list" data-client-list role="listbox" hidden></ul>
        </div>
        <input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(selectedId || ''))}"
          data-client-id />
        <p class="hint">${allowAddNew
          ? 'Optional — pick a match, or keep typing a new contact name. Choose a contact type (Client, Company, …) below when creating new.'
          : 'Optional — suggestions appear as you type. Leave blank for none.'}</p>
        ${allowAddNew ? `
          <p class="hint client-typeahead-new-note" ${isNew ? '' : 'hidden'}>New contact — choose a contact type, then save when you create the matter.</p>` : ''}
      </div>`;
  }

  let clientTypeaheadDocBound = false;
  function ensureClientTypeaheadDocClose() {
    if (clientTypeaheadDocBound) return;
    clientTypeaheadDocBound = true;
    document.addEventListener('click', (ev) => {
      document.querySelectorAll('[data-client-typeahead].is-open').forEach((el) => {
        if (!el.contains(ev.target)) {
          const list = el.querySelector('[data-client-list]');
          const search = el.querySelector('[data-client-search]');
          if (list) list.hidden = true;
          if (search) search.setAttribute('aria-expanded', 'false');
          el.classList.remove('is-open');
        }
      });
    });
  }

  function wireClientTypeahead(scopeEl, {
    clients = [],
    selectedId = '',
    allowAddNew = false,
    onChange = null,
  } = {}) {
    const root = scopeEl.querySelector('[data-client-typeahead]');
    if (!root) return null;
    ensureClientTypeaheadDocClose();
    const hidden = root.querySelector('[data-client-id]');
    const search = root.querySelector('[data-client-search]');
    const list = root.querySelector('[data-client-list]');
    const clearBtn = root.querySelector('[data-client-clear]');
    const newNote = root.querySelector('.client-typeahead-new-note');
    let activeIndex = -1;
    let suggestions = [];
    const findPlaceholder = allowAddNew
      ? 'Type to find a contact or enter a new name…'
      : 'Type a few letters to find a contact…';

    function emit(value) {
      if (typeof onChange === 'function') onChange(value);
    }

    function syncNewNote(isNew) {
      if (!newNote) return;
      newNote.hidden = !isNew;
    }

    function setValue(value, { announce = true, keepTyped = false } = {}) {
      const next = value == null ? '' : String(value);
      hidden.value = next;
      if (next === '__new__') {
        const draftName = keepTyped
          ? String(search.value || '').trim()
          : String(state.createMatterNewClient?.name || search.value || '').trim();
        if (draftName) {
          state.createMatterNewClient = {
            ...(state.createMatterNewClient || { recordTypeKey: 'client', email: '' }),
            name: draftName,
          };
        }
        search.value = draftName;
        search.placeholder = 'Type a new contact name…';
        if (clearBtn) clearBtn.hidden = !draftName;
      } else if (next) {
        const c = clients.find((x) => String(x.id) === next);
        search.value = c?.name || '';
        search.placeholder = findPlaceholder;
        if (clearBtn) clearBtn.hidden = false;
      } else {
        if (!keepTyped) search.value = '';
        search.placeholder = findPlaceholder;
        if (clearBtn) clearBtn.hidden = !String(search.value || '').trim();
      }
      root.classList.toggle('has-value', !!next && next !== '__new__');
      root.classList.toggle('is-new', next === '__new__');
      syncNewNote(next === '__new__');
      if (announce) emit(next);
    }

    function closeList() {
      list.hidden = true;
      search.setAttribute('aria-expanded', 'false');
      root.classList.remove('is-open');
      activeIndex = -1;
    }

    function renderSuggestions(q) {
      const needle = String(q || '').trim();
      const rows = [];
      if (!needle) {
        rows.push({
          id: '',
          label: 'None — optional',
          detail: 'No contact on this matter',
          kind: 'none',
        });
        suggestions = [];
      } else {
        suggestions = rankClientMatches(clients, needle).slice(0, 8);
        for (const c of suggestions) {
          rows.push({
            id: String(c.id),
            label: c.name || `Contact ${c.id}`,
            detail: [c.record_type || c.recordType || c.record_type_key, c.email].filter(Boolean).join(' · '),
            kind: 'client',
          });
        }
        if (!rows.length) {
          rows.push({
            id: '',
            label: 'No contacts match',
            detail: allowAddNew
              ? 'Keep this name to create a new contact with the matter'
              : 'Try different letters',
            kind: 'empty',
          });
        }
      }
      if (allowAddNew && needle) {
        const exact = findExactClientMatch(clients, needle);
        if (!exact) {
          rows.push({
            id: '__new__',
            label: `Use “${needle}” as new contact`,
            detail: 'Choose a contact type, then create the matter',
            kind: 'new',
          });
        }
      }
      activeIndex = rows.findIndex((r) => r.kind === 'client' || r.kind === 'none');
      if (activeIndex < 0) activeIndex = rows.findIndex((r) => r.kind === 'new');
      list.innerHTML = rows.map((r, i) => `
        <li role="option"
          class="client-typeahead-option ${i === activeIndex ? 'is-active' : ''} ${
            r.kind === 'empty' ? 'is-muted' : ''
          }"
          data-client-option="${escapeHtml(r.id)}"
          data-kind="${escapeHtml(r.kind)}"
          aria-selected="${i === activeIndex ? 'true' : 'false'}"
          ${r.kind === 'empty' ? 'aria-disabled="true"' : ''}>
          <span>${escapeHtml(r.label)}</span>
          ${r.detail ? `<small>${escapeHtml(r.detail)}</small>` : ''}
        </li>`).join('');
      list.hidden = false;
      search.setAttribute('aria-expanded', 'true');
      root.classList.add('is-open');
      list.querySelectorAll('[data-kind]').forEach((el) => {
        if (el.dataset.kind === 'empty') return;
        el.onmousedown = (ev) => {
          ev.preventDefault();
          pick(el.dataset.clientOption, el.dataset.kind);
        };
      });
    }

    function pick(id, kind) {
      if (kind === 'empty') return;
      if (kind === 'new' || id === '__new__') {
        const typed = String(search.value || '').trim();
        const exact = findExactClientMatch(clients, typed);
        if (exact) {
          // Prefer the existing contact over creating a duplicate.
          setValue(String(exact.id));
          closeList();
          return;
        }
        state.createMatterNewClient = {
          ...(state.createMatterNewClient || { recordTypeKey: 'client', email: '' }),
          name: typed,
        };
        setValue('__new__', { keepTyped: true });
      } else {
        setValue(id || '');
      }
      closeList();
    }

    function moveActive(delta) {
      const opts = [...list.querySelectorAll('.client-typeahead-option:not(.is-muted)')];
      if (!opts.length) return;
      const cur = opts.findIndex((el) => el.classList.contains('is-active'));
      const next = (cur + delta + opts.length) % opts.length;
      list.querySelectorAll('.client-typeahead-option').forEach((el) => {
        el.classList.remove('is-active');
        el.setAttribute('aria-selected', 'false');
      });
      opts[next].classList.add('is-active');
      opts[next].setAttribute('aria-selected', 'true');
      opts[next].scrollIntoView({ block: 'nearest' });
      activeIndex = [...list.children].indexOf(opts[next]);
    }

    search.addEventListener('focus', () => {
      renderSuggestions(search.value);
    });
    search.addEventListener('input', () => {
      const typed = String(search.value || '').trim();
      if (clearBtn) clearBtn.hidden = !typed;
      // Typing replaces a prior existing selection until the user picks again.
      if (hidden.value && hidden.value !== '__new__') {
        const selected = clients.find((c) => String(c.id) === String(hidden.value));
        if (!selected || search.value !== selected.name) {
          hidden.value = '';
          root.classList.remove('has-value');
        }
      }
      if (allowAddNew) {
        // Keep new-client mode in the same box: typed text is the contact name.
        if (typed) {
          const exact = findExactClientMatch(clients, typed);
          if (exact && search.value === exact.name) {
            // leave selection logic to pick / blur; while typing show matches
          } else {
            hidden.value = '__new__';
            root.classList.add('is-new');
            root.classList.remove('has-value');
            state.createMatterNewClient = {
              ...(state.createMatterNewClient || { recordTypeKey: 'client', email: '' }),
              name: typed,
            };
            state.createMatterClientId = '__new__';
            syncNewNote(true);
          }
        } else if (hidden.value === '__new__') {
          hidden.value = '';
          root.classList.remove('is-new');
          state.createMatterClientId = '';
          state.createMatterNewClient = {
            ...(state.createMatterNewClient || {}),
            name: '',
          };
          syncNewNote(false);
        }
      }
      renderSuggestions(search.value);
    });
    search.addEventListener('keydown', (ev) => {
      if (ev.key === 'ArrowDown') {
        ev.preventDefault();
        if (list.hidden) renderSuggestions(search.value);
        else moveActive(1);
      } else if (ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (!list.hidden) moveActive(-1);
      } else if (ev.key === 'Enter') {
        if (!list.hidden) {
          ev.preventDefault();
          ev.stopPropagation();
          const active = list.querySelector('.client-typeahead-option.is-active:not(.is-muted)');
          if (active) pick(active.dataset.clientOption, active.dataset.kind);
        }
      } else if (ev.key === 'Escape') {
        ev.preventDefault();
        closeList();
      }
    });
    if (clearBtn) {
      clearBtn.onclick = (ev) => {
        ev.preventDefault();
        state.createMatterNewClient = {
          ...(state.createMatterNewClient || { recordTypeKey: 'client', email: '' }),
          name: '',
        };
        setValue('');
        closeList();
        search.focus();
      };
    }

    // Sync initial selectedId without re-emitting (caller owns state).
    if (selectedId) setValue(selectedId, { announce: false });

    return {
      getValue: () => String(hidden.value || ''),
      getTypedName: () => String(search.value || '').trim(),
      focus: () => search.focus(),
    };
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

  function normalizeMatterTypeKey(matterType) {
    return String(matterType || '')
      .trim()
      .toLowerCase()
      .replace(/-/g, '_');
  }

  function matterBillingMode(matterType) {
    const key = normalizeMatterTypeKey(matterType);
    if (key === 'do_not_charge' || key.startsWith('do_not_charge')) return 'do_not_charge';
    if (key === 'non_billable' || key.startsWith('non_billable')) return 'non_billable';
    return 'billable';
  }

  function defaultBillableFromMatterType(matterType) {
    return matterBillingMode(matterType) === 'billable';
  }

  function forcesNonBillableMatterType(matterType) {
    return matterBillingMode(matterType) === 'do_not_charge';
  }

  function wireMatterPicker(scopeEl, { matters = [], onChange = null } = {}) {
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
      if (typeof onChange === 'function') onChange(m || null);
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
          <small>${escapeHtml(m.client_name || '—')}${m.status ? ` · ${escapeHtml(formatMatterStatusLabel(m.status))}` : ''}</small>
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

  function firmTimeZone() {
    return state.settings?.firmTimezone || 'America/New_York';
  }

  /** Calendar YYYY-MM-DD in the firm timezone (not browser/UTC midnight). */
  function firmToday(tz = firmTimeZone()) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: tz || 'America/New_York',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(new Date());
    } catch {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function listBrowserTimeZoneGroups() {
    let zones = [];
    try {
      if (typeof Intl.supportedValuesOf === 'function') {
        zones = Intl.supportedValuesOf('timeZone');
      }
    } catch {
      zones = [];
    }
    if (!zones.length) {
      zones = [
        'UTC',
        'America/New_York',
        'America/Chicago',
        'America/Denver',
        'America/Los_Angeles',
        'Europe/London',
        'Asia/Tokyo',
        'Australia/Sydney',
      ];
    }
    const now = new Date();
    const offsetOf = (tz) => {
      try {
        return new Intl.DateTimeFormat('en-US', {
          timeZone: tz,
          timeZoneName: 'shortOffset',
        }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || '';
      } catch {
        return '';
      }
    };
    const groups = new Map();
    for (const id of zones) {
      const region = id.includes('/') ? id.split('/')[0] : 'Other';
      const offset = offsetOf(id);
      const label = offset
        ? `${id.replace(/_/g, ' ')} (${offset})`
        : id.replace(/_/g, ' ');
      if (!groups.has(region)) groups.set(region, []);
      groups.get(region).push({ id, label });
    }
    return [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([region, list]) => ({
        region,
        zones: list.sort((a, b) => a.id.localeCompare(b.id)),
      }));
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

  let analogClockRaf = null;

  function stopLoginClock() {
    if (analogClockRaf != null) {
      cancelAnimationFrame(analogClockRaf);
      analogClockRaf = null;
    }
  }

  function tickAnalogClocks() {
    const hourEls = document.querySelectorAll('.login-clock-hand-hour');
    if (!hourEls.length) return false;
    const now = new Date();
    const ms = now.getMilliseconds();
    const s = now.getSeconds() + ms / 1000;
    const m = now.getMinutes() + s / 60;
    const h = (now.getHours() % 12) + m / 60;
    const hourRot = `rotate(${h * 30} 100 100)`;
    const minuteRot = `rotate(${m * 6} 100 100)`;
    const secondRot = `rotate(${s * 6} 100 100)`;
    hourEls.forEach((el) => el.setAttribute('transform', hourRot));
    document.querySelectorAll('.login-clock-hand-minute')
      .forEach((el) => el.setAttribute('transform', minuteRot));
    document.querySelectorAll('.login-clock-hand-second')
      .forEach((el) => el.setAttribute('transform', secondRot));
    return true;
  }

  function startAnalogClocks() {
    tickAnalogClocks();
    const reduceMotion = window.matchMedia
      && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduceMotion) return;
    if (analogClockRaf != null) return;
    const loop = () => {
      if (!tickAnalogClocks()) {
        analogClockRaf = null;
        return;
      }
      analogClockRaf = requestAnimationFrame(loop);
    };
    analogClockRaf = requestAnimationFrame(loop);
  }

  function loginClockHtml() {
    return `
      <div class="login-clock" aria-hidden="true">
        <div class="login-clock-glow"></div>
        ${analogClockSvgHtml()}
      </div>`;
  }

  function loginStageHtml(panelInner) {
    return `<div class="login-stage">${loginClockHtml()}<div class="login-panel">${panelInner}</div></div>`;
  }

  function wireLoginClock() {
    startAnalogClocks();
  }

  async function finishAuthSession(data) {
    if (data && data.mfaRequired && data.mfaToken) {
      return renderMfaChallenge(data.mfaToken);
    }
    persistSession(data.token, data.csrf);
    state.user = data.user;
    clearAuthTokenFromUrl();
    stopLoginClock();
    document.body.classList.remove('login-mode');
    if (appEl) appEl.classList.remove('login-mode');
    await refreshRefs();
    renderShell();
    await renderView();
    ['matters', 'contacts', 'users', 'time', 'billing', 'reports', 'dashboard', 'settings']
      .filter((v) => v !== state.view)
      .forEach((v) => prefetchView(v));
  }

  async function loadSecurityConfig() {
    try {
      const cfg = await api('/api/security-config', { cache: false });
      state.securityConfig = cfg;
      state.cookieOnlyAuth = Boolean(cfg && cfg.cookieOnlyAuth);
      if (state.cookieOnlyAuth) {
        state.token = null;
        try { sessionStorage.removeItem(TOKEN_KEY); } catch { /* ignore */ }
      }
    } catch {
      state.securityConfig = { cookieOnlyAuth: false, mfaAvailable: true };
      state.cookieOnlyAuth = false;
    }
  }

  async function boot() {
    const params = new URLSearchParams(window.location.search);
    await loadSecurityConfig();
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
    await renderView();
    ensureHelpAgent();
    // Warm sibling nav targets so the next toggle is usually cache-hit.
    ['matters', 'contacts', 'users', 'time', 'billing', 'reports', 'dashboard', 'settings']
      .filter((v) => v !== state.view)
      .forEach((v) => prefetchView(v));
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
      appEl.classList.remove('sidebar-collapsed');
      appEl.classList.add('login-mode');
    }
    document.body.classList.add('login-mode');
    if (nav) nav.innerHTML = '';
    if (userbar) userbar.textContent = '';
    if (sidebarActions) sidebarActions.innerHTML = '';
    if (lookupBar) {
      lookupBar.hidden = true;
      lookupBar.innerHTML = '';
    }
    setHelpAgentVisible(false);
  }

  function renderLogin(_mode = 'password') {
    enterLoginChrome();
    // Magic-link / forgot-password email flows stay hidden until OUTBOUND_EMAIL is enabled at go-live.
    const panel = `
          <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
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
          <div id="loginErr"></div>
          <p class="login-hint">Demo · avery@firm.example / demo-change-me</p>`;

    setMainHtml(loginStageHtml(panel));
    wireLoginClock();

    const err = (msg) => {
      const el = $('#loginErr');
      if (el) el.innerHTML = msg ? `<div class="error">${escapeHtml(msg)}</div>` : '';
    };

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

  function renderMfaChallenge(mfaToken) {
    enterLoginChrome();
    setMainHtml(loginStageHtml(`
          <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
          <p class="login-lead">Enter the 6-digit code from your authenticator app</p>
          <label class="login-field">Authenticator code
            <input id="mfaCode" type="text" inputmode="numeric" autocomplete="one-time-code"
              maxlength="16" placeholder="123456" />
          </label>
          <button class="primary login-submit" id="mfaBtn" type="button">Verify</button>
          <button class="linkish" id="mfaBack" type="button">Back to sign in</button>
          <div id="loginErr"></div>
          <p class="login-hint">You can also use a one-time backup code.</p>`));
    wireLoginClock();
    const err = (msg) => {
      const el = $('#loginErr');
      if (el) el.innerHTML = msg ? `<div class="error">${escapeHtml(msg)}</div>` : '';
    };
    const submit = async () => {
      try {
        $('#mfaBtn').disabled = true;
        err('');
        const data = await api('/api/login/mfa', {
          method: 'POST',
          body: JSON.stringify({ mfaToken, code: $('#mfaCode').value.trim() }),
        });
        await finishAuthSession(data);
      } catch (e) {
        $('#mfaBtn').disabled = false;
        err(e.message);
      }
    };
    $('#mfaBtn').onclick = submit;
    $('#mfaBack').onclick = () => renderLogin('password');
    $('#mfaCode').addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        submit();
      }
    });
    $('#mfaCode').focus();
  }

  async function renderAuthToken(rawToken) {
    enterLoginChrome();
    setMainHtml(loginStageHtml(`
          <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
          <p class="login-lead">Checking secure link…</p>
          <div id="loginErr"></div>`));
    wireLoginClock();
    try {
      const info = await api(`/api/auth/token-info?token=${encodeURIComponent(rawToken)}`);
      if (!info.valid) {
        setMainHtml(loginStageHtml(`
              <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
              <p class="login-lead">This link is invalid or has expired.</p>
              <button class="primary login-submit" id="backToLogin" type="button">Back to sign in</button>
              <div id="loginErr"></div>`));
        wireLoginClock();
        clearAuthTokenFromUrl();
        $('#backToLogin').onclick = () => renderLogin('password');
        return;
      }

      if (info.purpose === 'magic_login') {
        setMainHtml(loginStageHtml(`
              <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
              <p class="login-lead">Signing you in…</p>
              <div id="loginErr"></div>`));
        wireLoginClock();
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
      setMainHtml(loginStageHtml(`
            <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
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
            <div id="loginErr"></div>`));
      wireLoginClock();
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
      setMainHtml(loginStageHtml(`
            <p class="login-brand" aria-label="Chrono"><span class="login-brand-glyph">Chrono</span></p>
            <p class="login-lead">Could not open this link.</p>
            <div class="error">${escapeHtml(e.message)}</div>
            <button class="primary login-submit" id="backToLogin" type="button">Back to sign in</button>`));
      wireLoginClock();
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
    state.createMatterRecordTypeKey = 'billable';
    state.createMatterDraftName = '';
    state.createMatterClientId = '';
    state.createMatterNewClient = { name: '', recordTypeKey: 'client', email: '' };
    state.showCreateContact = false;
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
    state.showCreateContact = false;
    renderShell();
    renderView();
  }

  function goAddContact() {
    state.view = 'contacts';
    state.contactId = null;
    state.showCreateMatter = false;
    // Open create when the role can add contacts; otherwise show the list/search.
    state.showCreateContact = !!(canCreateMatter(state.user) && roleCanModify('contact'));
    renderShell();
    renderView();
  }

  async function openContact(id) {
    state.contactId = Number(id);
    state.view = 'contact';
    state.showCreateContact = false;
    renderShell();
    await renderView();
  }

  /** Inline SVG marks for sidebar nav / quick actions (no icon font deps). */
  function navIcon(name) {
    const common = 'class="nav-icon" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"';
    const icons = {
      matters: `<svg ${common}><rect x="3.5" y="7" width="17" height="13" rx="2"/><path d="M8 7V5.5A2.5 2.5 0 0 1 10.5 3h3A2.5 2.5 0 0 1 16 5.5V7"/><path d="M3.5 12h17"/></svg>`,
      contacts: `<svg ${common}><circle cx="9" cy="8.5" r="3.2"/><path d="M3.8 18.5c.6-3.1 2.9-4.8 5.2-4.8s4.6 1.7 5.2 4.8"/><circle cx="16.5" cy="9" r="2.5"/><path d="M14.2 18.5c.4-2.1 1.9-3.3 3.5-3.3 1.1 0 2.1.5 2.8 1.4"/></svg>`,
      time: `<svg ${common}><circle cx="12" cy="12" r="8.25"/><path d="M12 7.5V12l3 2"/></svg>`,
      billing: `<svg ${common}><rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/><circle cx="16.5" cy="16" r="1.2" fill="currentColor" stroke="none"/></svg>`,
      reports: `<svg ${common}><path d="M7 3.5h7l5 5V20a1.5 1.5 0 0 1-1.5 1.5H7A1.5 1.5 0 0 1 5.5 20V5A1.5 1.5 0 0 1 7 3.5z"/><path d="M14 3.5V9h5.5M9 13h6M9 16.5h4"/></svg>`,
      dashboard: `<svg ${common}><rect x="3.5" y="3.5" width="7.5" height="7.5" rx="1.4"/><rect x="13" y="3.5" width="7.5" height="4.5" rx="1.4"/><rect x="13" y="10" width="7.5" height="10.5" rx="1.4"/><rect x="3.5" y="13" width="7.5" height="7.5" rx="1.4"/></svg>`,
      settings: `<svg ${common}><circle cx="12" cy="12" r="3.1"/><path d="M12 3.5v2.2M12 18.3v2.2M4.9 6.5l1.6 1.6M17.5 15.9l1.6 1.6M3.5 12h2.2M18.3 12h2.2M4.9 17.5l1.6-1.6M17.5 8.1l1.6-1.6"/></svg>`,
      users: `<svg ${common}><circle cx="9" cy="8.5" r="3.2"/><path d="M3.8 18.5c.6-3.1 2.9-4.8 5.2-4.8s4.6 1.7 5.2 4.8"/><path d="M17 8v6M14 11h6"/></svg>`,
      plus: `<svg ${common}><path d="M12 5v14M5 12h14"/></svg>`,
      briefcase: `<svg ${common}><rect x="3.5" y="7.5" width="17" height="12.5" rx="2"/><path d="M9 7.5V5.8A1.8 1.8 0 0 1 10.8 4h2.4A1.8 1.8 0 0 1 15 5.8V7.5"/><path d="M3.5 12.25h17"/><path d="M12 11.25v2.25"/></svg>`,
    };
    return icons[name] || icons.matters;
  }

  function wireSidebarSection(root) {
    if (!root) return;
    root.querySelectorAll('details[data-sidebar-section]').forEach((el) => {
      const body = el.querySelector('.sidebar-section-body');
      const syncBody = () => {
        if (!body) return;
        // Keep the whole section body out of layout when collapsed.
        body.hidden = !el.open;
      };
      syncBody();
      el.addEventListener('toggle', () => {
        const key = el.getAttribute('data-sidebar-section');
        if (key) state.sidebarSectionOpen[key] = el.open;
        syncBody();
      });
    });
  }

  function renderShell(opts = {}) {
    if (sidebar) sidebar.hidden = false;
    wireSidebarToggle();
    ensureBrandClock();
    applySidebarCollapsed();
    document.body.classList.remove('login-mode');
    if (appEl) {
      appEl.classList.remove('login-mode');
      appEl.classList.add('app-shell');
    }
    // Matters + Contacts stay under Quick actions (create opens create + search/list).
    // Add a user sits at the bottom of Navigate, just above Settings.
    const items = [
      ['billing', 'Billing', 'billing', 'Create bills'],
      roleCanView('report') ? ['reports', 'Reports', 'reports', 'Lodestar & custom'] : null,
      roleCanView('report') ? ['dashboard', 'Dashboard', 'dashboard', 'Report visuals'] : null,
      canManageUsers() ? ['users', 'Add a user', 'users', 'Invite people'] : null,
      ['settings', 'Settings', 'settings', 'Firm preferences'],
    ].filter(Boolean);
    // Approvals / payments / WIP views stay retired — billing covers pre-bill → bill
    if (['approvals', 'payments', 'audit', 'wip'].includes(state.view)) {
      state.view = roleCanView('matter') ? 'matters' : (items[0]?.[0] || 'settings');
    }
    if (state.view === 'matters' || state.view === 'matter') {
      if (!roleCanView('matter')) state.view = items[0]?.[0] || 'settings';
    }
    if (state.view === 'contacts' || state.view === 'contact') {
      if (!roleCanView('contact')) state.view = items[0]?.[0] || 'settings';
    }
    if (state.view === 'time' && !roleCanView('time')) {
      state.view = items[0]?.[0] || 'settings';
    }
    if ((state.view === 'reports' || state.view === 'dashboard') && !roleCanView('report')) {
      state.view = items[0]?.[0] || 'settings';
    }
    if (state.view === 'users' && !canManageUsers()) {
      state.view = items[0]?.[0] || 'settings';
    }
    const activeView = navActiveId(state.view);
    const sig = shellSignature();
    // Fast path: permissions unchanged — only flip the active nav highlight.
    if (!opts.force && state._shellSig === sig && nav?.querySelector('[data-view]')) {
      setActiveNav(state.view);
      ensureLookupBar();
      return;
    }
    state._shellSig = sig;

    if (!state.sidebarSectionOpen || typeof state.sidebarSectionOpen !== 'object') {
      state.sidebarSectionOpen = { quickActions: true, navigate: true };
    }
    const quickOpen = state.sidebarSectionOpen.quickActions !== false;
    const navOpen = state.sidebarSectionOpen.navigate !== false;

    if (sidebarActions) {
      const quickButtons = [
        canCreateMatter(state.user) && roleCanModify('matter')
          ? `<button type="button" class="sidebar-action primary" id="sideAddMatter">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('briefcase')}</span>
              <span class="sidebar-action-text">
                <strong>Create Matter</strong>
                <small>Open create + search</small>
              </span>
            </button>`
          : '',
        roleCanView('contact')
          ? `<button type="button" class="sidebar-action primary" id="sideAddContact">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('contacts')}</span>
              <span class="sidebar-action-text">
                <strong>Create Contact</strong>
                <small>Open create + search</small>
              </span>
            </button>`
          : '',
        roleCanModify('time')
          ? `<button type="button" class="sidebar-action primary" id="sideAddTime">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('time')}</span>
              <span class="sidebar-action-text">
                <strong>Add Time Entry</strong>
                <small>Log time on a matter</small>
              </span>
            </button>`
          : '',
      ].filter(Boolean).join('');
      sidebarActions.innerHTML = `
        <details class="sidebar-section" data-sidebar-section="quickActions" ${quickOpen ? 'open' : ''}>
          <summary class="sidebar-section-summary">
            <span class="sidebar-label">Quick actions</span>
            <span class="sidebar-section-chevron" aria-hidden="true">▸</span>
          </summary>
          <div class="sidebar-section-body">
            ${quickButtons || '<p class="sidebar-section-empty muted">No quick actions for your role</p>'}
          </div>
        </details>`;
      const sideAddMatter = $('#sideAddMatter');
      if (sideAddMatter) sideAddMatter.onclick = () => goAddMatter();
      const sideAddContact = $('#sideAddContact');
      if (sideAddContact) sideAddContact.onclick = () => goAddContact();
      const sideAddTime = $('#sideAddTime');
      if (sideAddTime) sideAddTime.onclick = () => goAddTimeEntry();
      wireSidebarSection(sidebarActions);
    }

    nav.innerHTML = `
      <details class="sidebar-section" data-sidebar-section="navigate" ${navOpen ? 'open' : ''}>
        <summary class="sidebar-section-summary">
          <span class="sidebar-label">Navigate</span>
          <span class="sidebar-section-chevron" aria-hidden="true">▸</span>
        </summary>
        <div class="sidebar-section-body">
          ${items.map(([id, label, icon, hint]) =>
            `<button type="button" data-view="${id}"
              class="sidebar-action primary sidebar-nav-btn ${activeView === id ? 'active' : ''}">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon(icon)}</span>
              <span class="sidebar-action-text">
                <strong>${label}</strong>
                <small>${hint}</small>
              </span>
            </button>`
          ).join('')}
        </div>
      </details>`;
    wireSidebarSection(nav);
    nav.querySelectorAll('[data-view]').forEach((b) => {
      b.addEventListener('pointerenter', () => prefetchView(b.dataset.view));
      b.addEventListener('focus', () => prefetchView(b.dataset.view));
      b.onclick = () => {
        const next = b.dataset.view;
        const sameSection = navActiveId(state.view) === next
          && !state.showCreateMatter
          && !state.showCreateContact
          && !state.matterId
          && !state.contactId;
        if (sameSection) return;
        prefetchView(next);
        state.view = next;
        if (state.view !== 'matter') state.matterId = null;
        if (state.view !== 'matters') state.showCreateMatter = false;
        if (state.view !== 'contact') state.contactId = null;
        if (state.view !== 'contacts') state.showCreateContact = false;
        setActiveNav(state.view);
        void renderView();
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
    ensureHelpAgent();
    ensureLookupBar();
  }

  async function renderView() {
    const token = ++state._renderToken;
    const view = state.view;
    clearViewLoadingArm();
    // Keep prior content visible while warm cache resolves; only flash loading if slow.
    // Must not fire after setMainHtml() for this token, or Settings (and other views with
    // post-paint binds) get replaced with a permanent Loading… screen.
    state._viewLoadingTimer = setTimeout(() => {
      if (token === state._renderToken) showViewLoading();
    }, 140);
    try {
      if (view === 'matters') await renderMatters();
      else if (view === 'matter') await renderMatterDetail();
      else if (view === 'contacts') await renderContacts();
      else if (view === 'contact') await renderContactDetail();
      else if (view === 'time') await renderTime();
      else if (view === 'billing') await renderBilling();
      else if (view === 'reports') await renderReports();
      else if (view === 'dashboard') await renderDashboard();
      else if (view === 'users') await renderUsers();
      else if (view === 'settings') await renderSettings();
      else if (view === 'audit') await renderAudit();
      else await renderMatters();
      if (token !== state._renderToken) return;
    } catch (e) {
      if (token !== state._renderToken) return;
      const msg = e.message === 'forbidden'
        ? 'You do not have access to this section with your current role.'
        : e.message;
      setMainHtml(`<div class="card"><div class="error">${escapeHtml(msg)}</div></div>`);
    } finally {
      clearViewLoadingArm();
    }
  }

  async function openMatter(id) {
    state.matterId = id;
    state.view = 'matter';
    renderShell();
    await renderView();
  }

  async function renderMatters() {
    if (!state.matterSearch || typeof state.matterSearch !== 'object') {
      state.matterSearch = emptyMatterSearchState();
    }
    const browseParams = matterBrowseQueryParams(state.matterSearch);
    const canEdit = canCreateMatter(state.user) && roleCanModify('matter');
    const canDeleteMatters = roleCanDelete('matter');

    const showCreate = canEdit && state.showCreateMatter;
    let createRecordTypeKey = state.createMatterRecordTypeKey || 'billable';
    const requestedCreateTypeKey = createRecordTypeKey;
    const [hits, clients, allMatters, filterFields, listColumnConfig, recordTypes, createSettings, createMatterFieldsRaw] = await Promise.all([
      api(`/api/matters?${browseParams}`),
      api('/api/clients').catch(() => state.clients || []),
      api('/api/matters'), // full list for dropdowns elsewhere
      api('/api/matters/filter-fields').catch(() => ({ builtIn: [], custom: [] })),
      api('/api/matters/list-columns').catch(() => ({
        columns: defaultMatterListColumns(),
        available: [],
        keys: defaultMatterListColumns().map((c) => c.key),
      })),
      api('/api/record-types').catch(() => []),
      showCreate
        ? api('/api/settings').catch(() => state.settings || {})
        : Promise.resolve(state.settings || {}),
      showCreate
        ? api(`/api/custom-fields?appliesTo=matter&type=${encodeURIComponent(createRecordTypeKey)}`).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (!stillOnView('matters')) return;
    state.matters = allMatters;
    state.clients = clients || [];
    state.matterListColumns = listColumnConfig || state.matterListColumns;
    const listColumns = matterListColumnsOrDefault(state.matterListColumns);
    const typeLabelByKey = Object.fromEntries(
      (recordTypes || []).map((t) => [t.key, t.label || t.key])
    );
    const canEditListColumns = canCreateMatter(state.user) && roleCanModify('matter');
    const clientList = [...(clients || [])].sort((a, b) =>
      String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
    );
    if (createSettings && Object.keys(createSettings).length) state.settings = createSettings;
    const nameFormula = createSettings?.matterNameFormula || state.settings?.matterNameFormula || null;
    const formulaActive = !!(nameFormula?.enabled && (nameFormula.parts || []).length);
    const draftName = state.createMatterDraftName || '';
    if ((recordTypes || []).length && !recordTypes.some((t) => t.key === createRecordTypeKey)) {
      createRecordTypeKey = recordTypes[0].key;
      state.createMatterRecordTypeKey = createRecordTypeKey;
    }
    let createMatterFields = createMatterFieldsRaw;
    if (showCreate && createRecordTypeKey !== requestedCreateTypeKey) {
      createMatterFields = await api(
        `/api/custom-fields?appliesTo=matter&type=${encodeURIComponent(createRecordTypeKey)}`
      ).catch(() => []);
      if (!stillOnView('matters')) return;
    }
    const createTypeLabel = ((recordTypes || []).find((t) => t.key === createRecordTypeKey) || {}).label
      || createRecordTypeKey;
    const formulaFieldIds = new Set(
      (nameFormula?.parts || [])
        .filter((p) => p.kind === 'custom_field')
        .map((p) => Number(p.fieldId))
        .filter((id) => Number.isFinite(id))
    );
    // Ensure formula fields appear on create even if not yet on this type's list response.
    const mergedCreateFields = [...(createMatterFields || [])];
    for (const part of (nameFormula?.parts || [])) {
      if (part.kind !== 'custom_field') continue;
      const id = Number(part.fieldId);
      if (!Number.isFinite(id) || mergedCreateFields.some((f) => Number(f.id) === id)) continue;
      const fromConfig = (nameFormula.availableFields || []).find((f) => Number(f.id) === id)
        || part.field;
      if (!fromConfig) continue;
      mergedCreateFields.push({
        id,
        label: fromConfig.label || part.label || `Field ${id}`,
        field_type: fromConfig.fieldType || fromConfig.field_type || 'text',
        options: fromConfig.options || null,
        required: true,
        isDefault: true,
      });
    }
    const createFieldDefs = mergedCreateFields.map((f) => ({
      key: `cf:${f.id}`,
      label: f.label,
      type: f.field_type,
      options: f.options,
      config: f.config,
      expression: f.expression || f.config?.expression,
      required: !!f.required || formulaFieldIds.has(Number(f.id)),
      fieldId: f.id,
      kind: 'custom',
      width: ['textarea', 'long_text', 'rich_text', 'formula', 'geolocation', 'multiselect']
        .includes(f.field_type) ? 'full' : 'half',
      value: null,
      readonly: SYSTEM_FIELD_TYPES.has(String(f.field_type)),
      inNameFormula: formulaFieldIds.has(Number(f.id)),
    }));
    // Put formula name fields first so they read with the name builder.
    createFieldDefs.sort((a, b) => Number(b.inNameFormula) - Number(a.inNameFormula));

    setMainHtml(`
      <div class="card stack page-card">
        <div class="page-head matters-toolbar">
          <h1>${showCreate ? 'Create Matter' : 'Matters'}</h1>
        </div>

        ${showCreate ? `
        <div id="createMatterSection" class="create-matter-panel page-section">
          <form id="newMatterForm" class="create-matter-form">
            ${formulaActive ? `
              <p class="hint">Matter name is built from:
                ${escapeHtml((nameFormula.parts || []).map((p) => p.label || (p.kind === 'token' ? 'Year' : 'Field')).join(nameFormula.separator || '-'))}</p>
            ` : ''}
            <div class="create-matter-row">
              <div class="create-matter-name-typeahead" data-matter-name-typeahead>
                <input id="createMatterName" name="name" ${formulaActive ? 'readonly' : 'required'}
                  value="${escapeHtml(draftName)}"
                  placeholder="${formulaActive ? 'Fills from name fields below' : 'Type a matter name…'}"
                  aria-label="Matter name" autocomplete="off" aria-autocomplete="list"
                  aria-expanded="false" />
                <ul class="client-typeahead-list create-matter-name-list" data-matter-name-list
                  role="listbox" hidden></ul>
              </div>
              <button class="primary" type="submit">Create</button>
              <button type="button" id="clearCreateMatter">Clear</button>
              <label class="create-matter-type-field">Record type
                <select name="recordTypeKey" id="createMatterTypeSelect" required>
                  ${(recordTypes || []).map((t) => `
                    <option value="${escapeHtml(t.key)}" ${t.key === createRecordTypeKey ? 'selected' : ''}>
                      ${escapeHtml(t.label || t.key)}
                    </option>`).join('') || `
                    <option value="billable" selected>Billable</option>
                    <option value="non_billable">Non-Billable</option>
                    <option value="do_not_charge">Do not charge</option>`}
                </select>
              </label>
            </div>
            ${!formulaActive ? '<p class="hint create-matter-dup-hint">Suggestions show existing matters as you type.</p>' : ''}
            <div class="grid two create-matter-custom">
              ${createFieldDefs.map((field) => `
                <label class="${field.width === 'full' ? 'span-all' : ''}${field.inNameFormula ? ' name-formula-field' : ''}">
                  ${escapeHtml(field.label)}${field.required ? ' *' : ''}${field.inNameFormula ? ' <span class="muted">(name)</span>' : ''}
                  ${renderFieldInput(field, { canEdit: true })}
                </label>`).join('')}
            </div>
          </form>
          <div id="newMatterMsg"></div>
        </div>` : ''}

        <div class="page-section">
          <h2>Search matters</h2>
          <form id="matterSearch" class="matter-search-bar">
            <input name="q" value="${escapeHtml(state.matterSearch.q || '')}"
              placeholder="Search by name, client, or keyword…" aria-label="Search matters"
              autocomplete="off" />
            <button class="primary" type="submit">Search</button>
            <button type="button" id="clearSearch">Clear</button>
          </form>
          ${matterFilterBarHtml(filterFields, state.matterSearch)}
        </div>

        <div class="page-section">
          <div class="matters-list-heading">
            <h2>Matters</h2>
            <div class="row-actions">
              <button type="button" id="matterListColumnsBtn">${
                canEditListColumns ? 'Add or remove columns' : 'List columns'
              }</button>
              <button type="button" id="exportMattersExcelBtn">Export Excel</button>
            </div>
          </div>
          <div id="matterSearchResults">
            ${matterListHtml(hits, {
              ...state.matterSearch,
              canDelete: canDeleteMatters,
              columns: listColumns,
              typeLabelByKey,
            })}
          </div>
        </div>
      </div>`);

    wireMatterLiveSearch(filterFields, {
      canDelete: canDeleteMatters,
      columns: listColumns,
      typeLabelByKey,
    });
    wireMatterListColumnsButton({ canEdit: canEditListColumns });
    const exportMattersBtn = $('#exportMattersExcelBtn');
    if (exportMattersBtn) {
      exportMattersBtn.onclick = async () => {
        try {
          const params = matterBrowseQueryParams(state.matterSearch);
          params.delete('listColumns');
          params.set('format', 'xlsx');
          const headers = { 'X-App-Origin': window.location.origin };
          if (state.token && !state.cookieOnlyAuth) headers.Authorization = `Bearer ${state.token}`;
          if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
          const res = await fetch(`/api/matters/export?${params}`, {
            credentials: 'include',
            headers,
          });
          if (!res.ok) {
            let msg = res.statusText;
            try {
              const data = await res.json();
              msg = data.message || data.error || msg;
            } catch { /* ignore */ }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const tmp = document.createElement('a');
          tmp.href = URL.createObjectURL(blob);
          tmp.download = 'matters.xlsx';
          document.body.appendChild(tmp);
          tmp.click();
          tmp.remove();
          URL.revokeObjectURL(tmp.href);
        } catch (e) {
          alert(e.message || 'Could not export matters');
        }
      };
    }
    const clearCreate = $('#clearCreateMatter');
    if (clearCreate) {
      clearCreate.onclick = async () => {
        state.createMatterDraftName = '';
        state.createMatterRecordTypeKey = 'billable';
        state.createMatterClientId = '';
        state.createMatterNewClient = { name: '', recordTypeKey: 'client', email: '' };
        const msg = $('#newMatterMsg');
        if (msg) msg.innerHTML = '';
        await renderMatters();
        $('#createMatterName')?.focus();
      };
    }
    if (showCreate) {
      const nameInput = $('#createMatterName') || $('#createMatterSection input[name="name"]');
      const syncFormulaName = () => {
        const formEl = $('#newMatterForm');
        if (!formulaActive || !nameInput || !formEl) return '';
        const fd = new FormData(formEl);
        const values = {};
        for (const [key, value] of fd.entries()) {
          if (String(key).startsWith('cf_')) values[key.slice(3)] = String(value || '').trim();
        }
        const sep = nameFormula.separator == null || nameFormula.separator === ''
          ? '-'
          : String(nameFormula.separator);
        const year = new Date().toISOString().slice(0, 4);
        const pieces = [];
        for (const part of (nameFormula.parts || [])) {
          if (part.kind === 'token' && (part.token === 'opened_year' || part.token === 'year')) {
            if (year) pieces.push(year);
          } else if (part.kind === 'custom_field') {
            const v = values[part.fieldId] ?? values[String(part.fieldId)] ?? '';
            if (v) pieces.push(v);
          }
        }
        let built = pieces.join(sep);
        if (nameFormula.appendStatusYear && built) {
          built = `${built} - Open - ${year}`;
        }
        nameInput.value = built;
        state.createMatterDraftName = built;
        return built;
      };
      if (nameInput) {
        if (formulaActive) {
          const formEl = $('#newMatterForm');
          if (formEl) {
            formEl.addEventListener('input', syncFormulaName);
            formEl.addEventListener('change', syncFormulaName);
          }
          syncFormulaName();
        } else {
          wireCreateMatterNameTypeahead(nameInput, allMatters || state.matters || []);
        }
        setTimeout(() => {
          const focusEl = formulaActive
            ? ($('#newMatterForm')?.querySelector('.name-formula-field input, .name-formula-field select, .name-formula-field textarea')
              || nameInput)
            : nameInput;
          if (focusEl?.focus) focusEl.focus();
          const section = $('#createMatterSection');
          if (section && section.scrollIntoView) {
            section.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 0);
      }
      const typeSelect = $('#createMatterTypeSelect');
      if (typeSelect) {
        typeSelect.onchange = async () => {
          const nameEl = $('#createMatterName');
          if (nameEl && !formulaActive) state.createMatterDraftName = String(nameEl.value || '');
          state.createMatterRecordTypeKey = typeSelect.value || 'billable';
          await renderMatters();
        };
      }
    }

    wireMatterListRows($('#matterSearchResults') || main, { canDelete: canDeleteMatters });

    const newMatterForm = $('#newMatterForm');
    if (newMatterForm) {
      newMatterForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(newMatterForm);
        const customValues = collectCustomFieldValues(newMatterForm, createFieldDefs);
        if (formulaActive) {
          for (const part of (nameFormula.parts || [])) {
            if (part.kind !== 'custom_field') continue;
            const v = String(customValues[part.fieldId] ?? customValues[String(part.fieldId)] ?? '').trim();
            if (!v) {
              $('#newMatterMsg').innerHTML = `<div class="error">${escapeHtml(part.label || 'Name field')} is required for the matter name.</div>`;
              return;
            }
          }
        }
        let name = String(fd.get('name') || '').trim();
        if (formulaActive) {
          const sep = nameFormula.separator == null || nameFormula.separator === ''
            ? '-'
            : String(nameFormula.separator);
          const year = new Date().toISOString().slice(0, 4);
          const pieces = [];
          for (const part of (nameFormula.parts || [])) {
            if (part.kind === 'token' && (part.token === 'opened_year' || part.token === 'year')) {
              if (year) pieces.push(year);
            } else if (part.kind === 'custom_field') {
              const v = String(customValues[part.fieldId] ?? customValues[String(part.fieldId)] ?? '').trim();
              if (v) pieces.push(v);
            }
          }
          name = pieces.join(sep);
        }
        if (!name) {
          $('#newMatterMsg').innerHTML = `<div class="error">${
            formulaActive
              ? 'Fill the name fields to build a matter name.'
              : 'Enter a matter name to continue.'
          }</div>`;
          return;
        }
        const existingMatter = findExactMatterMatch(allMatters || state.matters || [], name);
        if (existingMatter) {
          $('#newMatterMsg').innerHTML = `<div class="error">A matter named “${
            escapeHtml(matterBaseName(existingMatter.name) || existingMatter.name)
          }” already exists. <button type="button" class="linkish" data-open-dup-matter="${
            existingMatter.id
          }">Open existing matter</button></div>`;
          $('#newMatterMsg [data-open-dup-matter]')?.addEventListener('click', () => {
            state.showCreateMatter = false;
            openMatter(Number(existingMatter.id));
          });
          return;
        }
        const confirmed = await confirmCreateMatter({
          matterName: name,
          clients: clientList,
          confirmLabel: 'Yes, create matter',
          cancelLabel: 'Not yet',
        });
        if (!confirmed) return;
        let clientChoice = String(confirmed.clientChoice || '').trim();
        let clientId = confirmed.clientId != null ? confirmed.clientId : null;
        const newClientName = String(confirmed.newClientName || '').trim();
        const newClientRecordTypeKey = String(
          confirmed.newClientRecordTypeKey
            || state.createMatterNewClient?.recordTypeKey
            || 'client',
        ).trim() || 'client';

        const recordTypeKey = String(
          fd.get('recordTypeKey') || state.createMatterRecordTypeKey || 'billable'
        ).trim();
        try {
          if (clientChoice === '__new__') {
            if (!roleCanModify('contact')) {
              throw new Error('You do not have permission to create contacts');
            }
            const createdClient = await api('/api/clients', {
              method: 'POST',
              body: JSON.stringify({
                name: newClientName,
                recordTypeKey: newClientRecordTypeKey,
              }),
            });
            clientId = Number(createdClient?.client?.id);
            if (!Number.isFinite(clientId) || clientId <= 0) {
              throw new Error('Could not create the new contact');
            }
          }
          const page = await api('/api/matters', {
            method: 'POST',
            body: JSON.stringify({
              name,
              recordTypeKey,
              ...(clientId ? { clientId } : {}),
              customValues,
            }),
          });
          await refreshRefs();
          state.showCreateMatter = false;
          state.createMatterDraftName = '';
          state.createMatterRecordTypeKey = 'billable';
          state.createMatterClientId = '';
          state.createMatterNewClient = { name: '', recordTypeKey: 'client', email: '' };
          state.matterSearch = emptyMatterSearchState();
          state.matterCreateFlash = {
            title: 'Matter created',
            detail: page.matter.name,
          };
          state.showPostCreateFields = true;
          state.editingMatterFieldId = null;
          await openMatter(page.matter.id);
        } catch (e) {
          $('#newMatterMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
  }

  async function renderContacts() {
    const canEdit = canCreateMatter(state.user) && roleCanModify('contact');
    const showCreate = canEdit && state.showCreateContact;
    const q = state.contactSearch.q || '';
    let createRecordTypeKey = state.createContactRecordTypeKey || 'client';
    const requestedCreateTypeKey = createRecordTypeKey;
    const [contacts, fieldConfig, recordTypes, createFieldsRaw] = await Promise.all([
      api(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      api('/api/clients/field-config').catch(() => ({ enabledStandard: [], enabledKeys: [] })),
      api('/api/record-types?appliesTo=client').catch(() => []),
      showCreate
        ? api(
          `/api/custom-fields?appliesTo=client&type=${encodeURIComponent(createRecordTypeKey)}`
        ).catch(() => [])
        : Promise.resolve([]),
    ]);
    if (!stillOnView('contacts')) return;
    state.clients = contacts || state.clients || [];
    const enabledStd = fieldConfig.enabledStandard || [];
    const listCols = enabledStd.filter((f) => f.key !== 'notes');
    const searchBits = ['name', ...enabledStd.map((f) => f.label.toLowerCase())];
    const listFlash = state.contactListFlash;
    state.contactListFlash = null;
    state.createContactFieldMsg = null;
    state.createContactFieldsOpen = false;
    const contactTypeLabel = (key) => {
      const k = String(key || 'client');
      const hit = (recordTypes || []).find((t) => t.key === k);
      if (hit?.label) return hit.label;
      if (k === 'client' || k === 'person') return 'Client';
      if (k === 'company') return 'Company';
      return k;
    };
    if ((recordTypes || []).length && !recordTypes.some((t) => t.key === createRecordTypeKey)) {
      createRecordTypeKey = recordTypes[0].key;
      state.createContactRecordTypeKey = createRecordTypeKey;
    }
    let createFields = createFieldsRaw;
    if (showCreate && createRecordTypeKey !== requestedCreateTypeKey) {
      createFields = await api(
        `/api/custom-fields?appliesTo=client&type=${encodeURIComponent(createRecordTypeKey)}`
      ).catch(() => []);
      if (!stillOnView('contacts')) return;
    }
    const createFieldDefs = (createFields || []).map((f) => ({
      key: `cf:${f.id}`,
      label: f.label,
      type: f.field_type,
      options: f.options,
      config: f.config,
      expression: f.expression || f.config?.expression,
      required: !!f.required,
      fieldId: f.id,
      kind: 'custom',
      width: ['textarea', 'long_text', 'rich_text', 'formula', 'geolocation', 'multiselect']
        .includes(f.field_type) ? 'full' : 'half',
      value: null,
      readonly: SYSTEM_FIELD_TYPES.has(String(f.field_type)),
    }));

    setMainHtml(`
      <div class="card stack page-card">
        <div class="page-head matters-toolbar">
          <h1>${showCreate ? 'Create Contact' : 'Contacts'}</h1>
          ${canEdit && !showCreate ? `
            <button type="button" class="primary" id="startCreateContact">Create contact</button>` : ''}
        </div>
        ${listFlash ? successNoticeHtml(listFlash) : ''}

        ${showCreate ? `
        <div id="createContactSection" class="create-matter-panel page-section">
          <form id="newContactForm" class="stack">
            <div class="grid two">
              <label>Name *
                ${contactStandardInputHtml({ key: 'name', type: 'text', required: true }, { canEdit: true })}
              </label>
              <label>Record type
                <select name="recordTypeKey" id="createContactTypeSelect" required>
                  ${(recordTypes || []).map((t) => `
                    <option value="${escapeHtml(t.key)}" ${t.key === createRecordTypeKey ? 'selected' : ''}>
                      ${escapeHtml(t.label || t.key)}
                    </option>`).join('') || `
                    <option value="client" selected>Client</option>
                    <option value="company">Company</option>`}
                </select>
              </label>
              ${enabledStd.map((field) => `
                <label class="${field.width === 'full' ? 'span-all' : ''}">
                  ${escapeHtml(field.label)}
                  ${contactStandardInputHtml(field, { canEdit: true })}
                </label>`).join('')}
              ${createFieldDefs.map((field) => `
                <label class="${field.width === 'full' ? 'span-all' : ''}">
                  ${escapeHtml(field.label)}${field.required ? ' *' : ''}
                  ${renderFieldInput(field, { canEdit: true })}
                </label>`).join('')}
            </div>
            <div class="row-actions">
              <button class="primary" type="submit">Create</button>
              <button type="button" id="cancelCreateContact">Cancel</button>
            </div>
          </form>
          <div id="newContactMsg"></div>
        </div>` : ''}

        <div class="page-section">
          <h2>Contacts</h2>
          <form id="contactSearch" class="matter-search-bar">
            <input name="q" value="${escapeHtml(q)}"
              placeholder="Type a few characters to search by ${escapeHtml(searchBits.join(', '))}…"
              aria-label="Search contacts" autocomplete="off" />
            <button class="primary" type="submit">Search</button>
            <button type="button" id="clearContactSearch">Clear</button>
          </form>
          <div id="contactSearchResults">
            ${q ? `<p class="muted" style="margin:.55rem 0 0">${
              (contacts || []).length
                ? `${(contacts || []).length} match${(contacts || []).length === 1 ? '' : 'es'} for “${escapeHtml(q)}”`
                : `No contacts match “${escapeHtml(q)}”`
            }</p>` : '<p class="muted" style="margin:.55rem 0 0">Type a few characters to filter contacts.</p>'}
            <div class="table-wrap" style="margin-top:.65rem"><table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  ${listCols.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}
                </tr>
              </thead>
              <tbody id="contactSearchBody">
                ${(contacts || []).map((c) => `
                  <tr class="click-row" data-contact="${c.id}">
                    <td><strong>${escapeHtml(c.name)}</strong></td>
                    <td>${escapeHtml(contactTypeLabel(c.record_type))}</td>
                    ${listCols.map((f) => `<td>${escapeHtml(c[f.key] || '—')}</td>`).join('')}
                  </tr>`).join('') || `<tr><td colspan="${2 + listCols.length}" class="muted">${
                    q ? 'No contacts match this search' : 'No contacts yet'
                  }</td></tr>`}
              </tbody>
            </table></div>
          </div>
        </div>
      </div>`);

    const startCreate = $('#startCreateContact');
    if (startCreate) startCreate.onclick = () => goAddContact();
    const cancelCreate = $('#cancelCreateContact');
    if (cancelCreate) {
      cancelCreate.onclick = async () => {
        state.showCreateContact = false;
        state.createContactRecordTypeKey = 'client';
        state.createContactFieldMsg = null;
        state.createContactFieldsOpen = false;
        await renderContacts();
      };
    }
    if (showCreate) {
      const typeSelect = $('#createContactTypeSelect');
      if (typeSelect) {
        typeSelect.onchange = async () => {
          state.createContactRecordTypeKey = typeSelect.value || 'client';
          await renderContacts();
        };
      }
    }
    let contactLiveTimer = null;
    let contactLiveSeq = 0;
    const paintContactRows = () => {
      main.querySelectorAll('[data-contact]').forEach((row) => {
        row.onclick = () => openContact(Number(row.dataset.contact));
      });
    };
    const contactSearchForm = $('#contactSearch');
    const contactSearchInput = contactSearchForm?.querySelector('input[name="q"]');
    const contactResults = $('#contactSearchResults');
    const runContactLiveSearch = async (raw) => {
      const nextQ = String(raw || '').trim();
      state.contactSearch = { q: nextQ };
      if (!contactResults) return;
      const seq = ++contactLiveSeq;
      const colCount = 2 + listCols.length;
      const paintTable = (rows, status, emptyLabel) => {
        contactResults.innerHTML = `
          <p class="muted" style="margin:.55rem 0 0">${escapeHtml(status)}</p>
          <div class="table-wrap" style="margin-top:.65rem"><table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                ${listCols.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${(rows || []).map((c) => `
                <tr class="click-row" data-contact="${c.id}">
                  <td><strong>${escapeHtml(c.name)}</strong></td>
                  <td>${escapeHtml(contactTypeLabel(c.record_type))}</td>
                  ${listCols.map((f) => `<td>${escapeHtml(c[f.key] || '—')}</td>`).join('')}
                </tr>`).join('') || `<tr><td colspan="${colCount}" class="muted">${
                  escapeHtml(emptyLabel)
                }</td></tr>`}
            </tbody>
          </table></div>`;
        paintContactRows();
      };
      if (nextQ && nextQ.length < 2) {
        paintTable([], 'Keep typing — results appear after 2 characters.', 'Keep typing to search');
        return;
      }
      try {
        const rows = await api(`/api/clients${nextQ ? `?q=${encodeURIComponent(nextQ)}` : ''}`);
        if (seq !== contactLiveSeq || !stillOnView('contacts')) return;
        const status = nextQ
          ? ((rows || []).length
            ? `${rows.length} match${rows.length === 1 ? '' : 'es'} for “${nextQ}”`
            : `No contacts match “${nextQ}”`)
          : 'Type a few characters to filter contacts.';
        paintTable(rows, status, nextQ ? 'No contacts match this search' : 'No contacts yet');
      } catch (e) {
        if (seq !== contactLiveSeq || !stillOnView('contacts')) return;
        contactResults.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };
    if (contactSearchForm && contactSearchInput) {
      contactSearchInput.addEventListener('input', () => {
        if (contactLiveTimer) clearTimeout(contactLiveTimer);
        contactLiveTimer = setTimeout(() => {
          contactLiveTimer = null;
          void runContactLiveSearch(contactSearchInput.value);
        }, 180);
      });
      contactSearchForm.onsubmit = async (ev) => {
        ev.preventDefault();
        if (contactLiveTimer) clearTimeout(contactLiveTimer);
        contactLiveTimer = null;
        await runContactLiveSearch(contactSearchInput.value);
      };
    }
    const clearContactSearch = $('#clearContactSearch');
    if (clearContactSearch) {
      clearContactSearch.onclick = async () => {
        if (contactLiveTimer) clearTimeout(contactLiveTimer);
        contactLiveTimer = null;
        if (contactSearchInput) contactSearchInput.value = '';
        await runContactLiveSearch('');
      };
    }
    paintContactRows();

    const form = $('#newContactForm');
    if (form) {
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const name = String(fd.get('name') || '').trim();
        if (!name) {
          $('#newContactMsg').innerHTML = '<div class="error">Enter a contact name to continue.</div>';
          return;
        }
        const email = String(fd.get('email') || '').trim();
        const dup = findExactClientMatch(contacts || state.clients || [], name, email);
        if (dup) {
          $('#newContactMsg').innerHTML = `<div class="error">A contact named “${
            escapeHtml(dup.name)
          }” already exists. <button type="button" class="linkish" data-open-dup-contact="${
            dup.id
          }">Open existing contact</button></div>`;
          $('#newContactMsg [data-open-dup-contact]')?.addEventListener('click', () => {
            state.showCreateContact = false;
            openContact(Number(dup.id));
          });
          return;
        }
        const confirmed = await confirmCreateContact({
          contactName: name,
          matters: state.matters?.length ? state.matters : null,
          confirmLabel: 'Yes, create contact',
          cancelLabel: 'Not yet',
        });
        if (!confirmed) return;

        const customValues = collectCustomFieldValues(form, createFieldDefs);
        const recordTypeKey = String(
          fd.get('recordTypeKey') || state.createContactRecordTypeKey || 'client'
        ).trim();
        const payload = { name, recordTypeKey, customValues };
        for (const field of enabledStd) {
          payload[field.key] = fd.get(field.key);
        }
        try {
          const page = await api('/api/clients', {
            method: 'POST',
            body: JSON.stringify(payload),
          });
          let associateDetail = '';
          if (confirmed.matterId) {
            try {
              await api(`/api/matters/${confirmed.matterId}`, {
                method: 'PATCH',
                body: JSON.stringify({ clientId: page.client.id }),
              });
              associateDetail = confirmed.matterName
                ? `Associated with ${confirmed.matterName}`
                : 'Associated with a matter';
              await refreshRefs().catch(() => {});
            } catch (assocErr) {
              associateDetail = `Created, but could not associate matter: ${
                assocErr.message || 'unknown error'
              }`;
            }
          }
          state.showCreateContact = false;
          state.createContactRecordTypeKey = 'client';
          state.createContactFieldMsg = null;
          state.createContactFieldsOpen = false;
          state.contactCreateFlash = {
            title: 'Contact created',
            detail: associateDetail
              ? `${page.client.name} · ${associateDetail}`
              : page.client.name,
          };
          state.showPostCreateContactFields = true;
          state.editingContactFieldId = null;
          await openContact(page.client.id);
        } catch (e) {
          $('#newContactMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
  }

  async function renderContactDetail() {
    if (!state.contactId) {
      state.view = 'contacts';
      return renderContacts();
    }
    const page = await api(`/api/clients/${state.contactId}`);
    const canEdit = canCreateMatter(state.user) && page.canEdit !== false && roleCanModify('contact');
    // Delete contact: Admin always; other roles via Settings → Role permissions → Contacts → Delete.
    const canDelete = page.canDelete !== false && roleCanDelete('contact');
    const c = page.client;
    const fields = page.fields || [];
    const enabledStd = (page.fieldConfig && page.fieldConfig.enabledStandard) || [];
    const flash = state.contactFlash;
    const createFlash = state.contactCreateFlash;
    const fieldPanelFlash = state.contactFieldPanelFlash;
    const showPostCreateFields = canEdit && !!state.showPostCreateContactFields;
    const typeLabel = page.recordTypeLabel || c.record_type || 'Client';
    state.contactFlash = null;
    state.contactCreateFlash = null;
    state.contactFieldPanelFlash = null;

    const isContactOnlyField = (f) => !!(
      f
      && !isBuiltInField(f)
      && (f.scope === 'record' || f.clientId || f.client_id)
    );
    const contactOnlyFields = (fields || []).filter(isContactOnlyField);
    const editingField = state.editingContactFieldId
      ? contactOnlyFields.find(
        (f) => Number(fieldIdFromMgmt(f)) === Number(state.editingContactFieldId)
      )
      : null;

    const contactFieldMgmtPanelHtml = (opts = {}) => {
      const {
        title = 'Contact level fields',
        hint = 'Add a field for <strong>this contact only</strong>. Shared defaults for all contacts are managed in Settings → Contact page.',
        formId = 'contactRecordFieldForm',
        panelId = '',
        showDismiss = false,
        msgHtml = '',
      } = opts;
      return `
      <div class="card stack${showDismiss ? ' post-create-fields-panel' : ''}"${panelId ? ` id="${panelId}"` : ''}>
        <div class="page-head matters-toolbar" style="margin:0">
          <h2 style="margin:0">${escapeHtml(title)}</h2>
          ${showDismiss ? '<button type="button" id="dismissPostCreateContactFields">Done</button>' : ''}
        </div>
        <p class="hint">${hint}</p>
        <div class="field-mgmt-list">
          ${fieldMgmtRows(contactOnlyFields, { editAttr: 'data-edit-contact-field', showScope: false })}
        </div>
        ${editingField
          ? `<h3 class="field-edit-title">Edit contact field</h3>${customFieldFormHtml({
            formId,
            submitLabel: 'Save changes',
            field: editingField,
            showCancel: true,
            showDefault: false,
            requiredLabel: 'Required on this contact',
            appliesTo: 'client',
            formHint: 'This field stays on <strong>this contact only</strong>.',
          })}`
          : customFieldFormHtml({
            formId,
            submitLabel: 'Add to this contact',
            showDefault: false,
            requiredLabel: 'Required on this contact',
            appliesTo: 'client',
            formHint: 'New fields apply to this contact only — not to other contacts.',
          })}
        <div id="contactFieldMsg">${msgHtml}</div>
      </div>`;
    };

    const canCreate = canCreateMatter(state.user) && roleCanModify('contact');
    setMainHtml(`
      <div class="card">
        <div class="page-head matters-toolbar" style="margin-bottom:.75rem">
          <div class="row-actions">
            <button type="button" id="backContacts">← Contacts</button>
          </div>
          ${canCreate
            ? '<button type="button" class="primary" id="createContactFromDetail">Create contact</button>'
            : ''}
        </div>
        <h1>${escapeHtml(c.name || 'Contact')}</h1>
        <p class="muted">Record type: ${escapeHtml(typeLabel)}</p>
        ${createFlash ? successNoticeHtml(createFlash) : ''}
      </div>

      <form id="contactForm" class="card stack">
        <div class="grid two">
          <label>Name *
            ${contactStandardInputHtml(
              { key: 'name', type: 'text', required: true },
              { value: c.name || '', canEdit }
            )}
          </label>
          ${enabledStd.map((field) => `
            <label class="${field.width === 'full' ? 'span-all' : ''}">
              ${escapeHtml(field.label)}
              ${contactStandardInputHtml(field, {
                value: c[field.key] || '',
                canEdit: canEdit && !field.readonly,
              })}
            </label>`).join('')}
          ${fields.map((f) => `
            <label class="${f.width === 'full' ? 'span-all' : ''}">
              ${escapeHtml(f.label)}${f.required ? ' *' : ''}
              ${renderFieldInput(f, { canEdit })}
            </label>`).join('')}
        </div>
        ${canEdit ? `
          <div class="row-actions">
            <button class="primary" type="submit">Save</button>
          </div>` : ''}
        <div id="contactMsg">${flash ? successNoticeHtml(flash) : ''}</div>
      </form>

      ${showPostCreateFields ? contactFieldMgmtPanelHtml({
        title: 'Contact level fields',
        hint: 'Optional — add a field for <strong>this contact only</strong>. Keep adding as needed, then press Done. Shared contact defaults stay in Settings → Contact page.',
        formId: 'contactRecordFieldForm',
        panelId: 'postCreateContactFieldsPanel',
        showDismiss: true,
        msgHtml: fieldPanelFlash ? successNoticeHtml(fieldPanelFlash) : '',
      }) : ''}

      ${canEdit && !showPostCreateFields ? contactFieldMgmtPanelHtml({
        msgHtml: fieldPanelFlash ? successNoticeHtml(fieldPanelFlash) : '',
      }) : ''}

      ${canDelete ? `
      <div class="card stack contact-delete-panel">
        <h2 style="margin:0">Delete contact</h2>
        <p class="hint">Remove this contact from the firm. Linked matters keep their data and become client-less. This cannot be undone.</p>
        <div class="row-actions">
          <button type="button" class="danger" id="deleteContact">Delete contact</button>
        </div>
        <div id="contactDeleteMsg"></div>
      </div>` : ''}`);

    $('#backContacts').onclick = () => {
      state.view = 'contacts';
      state.contactId = null;
      state.showPostCreateContactFields = false;
      state.editingContactFieldId = null;
      renderShell();
      renderView();
    };

    const createFromDetail = $('#createContactFromDetail');
    if (createFromDetail) createFromDetail.onclick = () => goAddContact();

    const dismissPostCreate = $('#dismissPostCreateContactFields');
    if (dismissPostCreate) {
      dismissPostCreate.onclick = async () => {
        state.showPostCreateContactFields = false;
        state.editingContactFieldId = null;
        await renderContactDetail();
      };
    }
    if (showPostCreateFields) {
      setTimeout(() => {
        const panel = $('#postCreateContactFieldsPanel');
        if (panel?.scrollIntoView) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }

    const deleteBtn = $('#deleteContact');
    if (deleteBtn && canDelete) {
      deleteBtn.onclick = async () => {
        const sure = await confirmAction({
          title: 'Delete this contact?',
          message: `Are you sure you want to delete “${c.name || 'this contact'}”? Linked matters keep their data and become client-less. This cannot be undone.`,
          confirmLabel: 'Yes, delete contact',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        const deleteMsg = $('#contactDeleteMsg');
        try {
          const result = await api(`/api/clients/${c.id}`, { method: 'DELETE' });
          state.contactId = null;
          state.view = 'contacts';
          state.contactFlash = null;
          state.showPostCreateContactFields = false;
          state.editingContactFieldId = null;
          const unlinked = Number(result?.unlinkedMatters) || 0;
          state.contactListFlash = {
            title: 'Contact deleted',
            detail: unlinked
              ? `${c.name || 'Contact'} removed · ${unlinked} matter${unlinked === 1 ? '' : 's'} unlinked`
              : (c.name || 'The contact was removed.'),
          };
          await refreshRefs();
          renderShell();
          await renderContacts();
        } catch (e) {
          if (deleteMsg) {
            deleteMsg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          }
        }
      };
    }

    const form = $('#contactForm');
    if (form && canEdit) {
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const customValues = collectCustomFieldValues(form, fields || []);
        const payload = {
          name: fd.get('name'),
          customValues,
        };
        for (const field of enabledStd) {
          payload[field.key] = fd.get(field.key);
        }
        try {
          await api(`/api/clients/${c.id}`, {
            method: 'PATCH',
            body: JSON.stringify(payload),
          });
          state.contactFlash = {
            title: 'Contact saved',
            detail: 'Details and custom fields are up to date.',
          };
          await renderContactDetail();
          await refreshRefs();
        } catch (e) {
          $('#contactMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    main.querySelectorAll('[data-edit-contact-field]').forEach((btn) => {
      btn.onclick = async () => {
        state.editingContactFieldId = Number(btn.dataset.editContactField);
        await renderContactDetail();
      };
    });
    main.querySelectorAll('[data-del-custom-field]').forEach((btn) => {
      btn.onclick = async () => {
        if (!isAdminUser()) return;
        const label = fieldLabelFromDeleteBtn(btn);
        const sure = await confirmDeleteCustomField(label);
        if (!sure) return;
        try {
          const id = Number(btn.dataset.delCustomField);
          await api(`/api/custom-fields/${id}`, { method: 'DELETE' });
          if (Number(state.editingContactFieldId) === id) state.editingContactFieldId = null;
          state.contactFieldPanelFlash = {
            title: 'Custom field deleted',
            detail: 'The field was removed for this firm.',
          };
          await renderContactDetail();
        } catch (e) {
          const msg = $('#contactFieldMsg');
          if (msg) msg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    const cancelFieldEdit = main.querySelector('[data-cancel-field-edit]');
    if (cancelFieldEdit) {
      cancelFieldEdit.onclick = async () => {
        state.editingContactFieldId = null;
        await renderContactDetail();
      };
    }

    const rf = $('#contactRecordFieldForm');
    wireDropdownOptionsToggle(rf);
    if (rf && canEdit) {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        const { fieldType, options, body } = customFieldPayload(fd);
        if ((fieldType === 'dropdown' || fieldType === 'select' || fieldType === 'multiselect') && !options.length) {
          $('#contactFieldMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
          return;
        }
        try {
          if (state.editingContactFieldId) {
            await api(`/api/custom-fields/${state.editingContactFieldId}`, {
              method: 'PATCH',
              body: JSON.stringify(body),
            });
            state.editingContactFieldId = null;
            state.contactFieldPanelFlash = {
              title: 'Contact field updated',
              detail: `${body.label || 'Field'} was saved for this contact.`,
            };
          } else {
            await api(`/api/clients/${c.id}/custom-fields`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            state.contactFieldPanelFlash = {
              title: 'Contact field added',
              detail: `${body.label || 'Field'} is available on this contact only.`,
            };
          }
          await renderContactDetail();
        } catch (e) {
          $('#contactFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
  }

  function renderFieldInput(field, ctx = {}) {
    const name = field.kind === 'custom' ? `cf_${field.fieldId}` : field.key;
    const val = field.value ?? '';
    const type = String(field.type || 'text');
    const systemManaged = SYSTEM_FIELD_TYPES.has(type);
    const disabled = field.readonly || systemManaged || !ctx.canEdit ? 'disabled' : '';
    const req = field.required && !systemManaged ? 'required' : '';
    const safeVal = escapeHtml(val ?? '');

    if (field.key === 'std:client') {
      const opts = (ctx.clients || []).map((c) =>
        `<option value="${c.id}" ${String(val) === String(c.id) ? 'selected' : ''}>${c.name}</option>`
      ).join('');
      return `<select name="${name}" ${disabled} required>${opts}</select>`;
    }
    if (field.key === 'std:matter_type') {
      const label = (ctx.recordTypes || []).find((t) => t.key === val)?.label || val || 'Billable';
      return `<input name="${name}" value="${escapeHtml(label)}" disabled />`;
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
    if (field.key === 'std:status') {
      const options = (field.options && field.options.length) ? field.options : ['open', 'closed'];
      const opts = options.map((o) => {
        const value = typeof o === 'string' ? o : (o.value ?? o);
        const label = typeof o === 'string'
          ? formatMatterStatusLabel(o)
          : (o.label || formatMatterStatusLabel(o.value));
        return `<option value="${escapeHtml(value)}" ${String(val) === String(value) ? 'selected' : ''}>${escapeHtml(label)}</option>`;
      }).join('');
      const orphan = val && !options.some((o) => String(typeof o === 'string' ? o : (o.value ?? o)) === String(val))
        ? `<option value="${escapeHtml(val)}" selected>${escapeHtml(formatMatterStatusLabel(val))}</option>`
        : '';
      return `<select name="${name}" ${disabled} ${req}>
        <option value=""></option>${opts}${orphan}
      </select>`;
    }

    if (type === 'auto_number') {
      return `<input type="text" name="${name}" value="${safeVal}" disabled
        placeholder="Auto-generated on save" />`;
    }
    if (type === 'formula') {
      const expr = field.expression || field.config?.expression || '';
      return `<input type="text" name="${name}" value="${safeVal}" disabled
        placeholder="Calculated" title="${escapeHtml(expr)}" />
        ${expr ? `<span class="hint">= ${escapeHtml(expr)}</span>` : ''}`;
    }
    if (type === 'textarea' || type === 'long_text' || type === 'rich_text') {
      const rows = type === 'long_text' || type === 'rich_text' ? 6 : 3;
      const cls = type === 'rich_text' ? ' class="rich-text-input"' : '';
      return `<textarea name="${name}" ${disabled} ${req} rows="${rows}"${cls}
        maxlength="${type === 'textarea' ? 2000 : 131000}">${safeVal}</textarea>
        ${type === 'rich_text' ? '<span class="hint">Rich text: plain text with line breaks (formatting tools coming later).</span>' : ''}`;
    }
    if (type === 'select' || type === 'dropdown') {
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
    if (type === 'multiselect') {
      let selected = [];
      if (Array.isArray(val)) selected = val;
      else if (val) {
        try {
          const parsed = JSON.parse(val);
          selected = Array.isArray(parsed) ? parsed : String(val).split(/[\n,]+/);
        } catch {
          selected = String(val).split(/[\n,]+/).map((s) => s.trim()).filter(Boolean);
        }
      }
      const selectedSet = new Set(selected.map(String));
      const opts = (field.options || []).map((o) =>
        `<option value="${escapeHtml(o)}" ${selectedSet.has(String(o)) ? 'selected' : ''}>${escapeHtml(o)}</option>`
      ).join('');
      return `<select name="${name}" multiple size="${Math.min(6, Math.max(3, (field.options || []).length || 3))}"
        ${disabled} ${req}>${opts}</select>
        <span class="hint">Hold Ctrl/Cmd to select multiple</span>`;
    }
    if (type === 'checkbox') {
      return `<span class="field-checkbox">
        <input type="checkbox" name="${name}" value="1" ${disabled} ${req}
          ${val === '1' || val === 'true' || val === true || val === 1 ? 'checked' : ''} />
      </span>`;
    }
    if (type === 'geolocation') {
      const [lat = '', lng = ''] = String(val || '').split(',').map((p) => p.trim());
      return `<div class="geo-inputs">
        <input type="number" step="any" name="${name}_lat" value="${escapeHtml(lat)}"
          placeholder="Latitude" ${disabled} ${req} />
        <input type="number" step="any" name="${name}_lng" value="${escapeHtml(lng)}"
          placeholder="Longitude" ${disabled} ${req} />
      </div>`;
    }
    if (type === 'currency') {
      return `<div class="input-affix"><span class="affix">$</span>
        <input type="number" step="0.01" name="${name}" value="${safeVal}" ${disabled} ${req} /></div>`;
    }
    if (type === 'percent') {
      return `<div class="input-affix">
        <input type="number" step="0.01" name="${name}" value="${safeVal}" ${disabled} ${req} />
        <span class="affix">%</span></div>`;
    }
    if (type === 'url' && (disabled || !ctx.canEdit) && val) {
      return `<a class="field-link" href="${safeVal}" target="_blank" rel="noopener noreferrer">${safeVal}</a>
        <input type="hidden" name="${name}" value="${safeVal}" />`;
    }
    if (type === 'email' && (disabled || !ctx.canEdit) && val) {
      return `<a class="field-link" href="mailto:${safeVal}">${safeVal}</a>
        <input type="hidden" name="${name}" value="${safeVal}" />`;
    }
    const inputType = type === 'number' ? 'number'
      : type === 'date' ? 'date'
        : type === 'datetime' ? 'datetime-local'
          : type === 'email' ? 'email'
            : type === 'url' ? 'url'
              : type === 'phone' ? 'tel'
                : 'text';
    const maxLen = type === 'text' ? ' maxlength="255"' : '';
    return `<input type="${inputType}" name="${name}" value="${String(val).replace(/"/g, '&quot;')}" ${disabled} ${req}${maxLen} />`;
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
              Live Microsoft sync is deferred for a later build. Use <strong>Load demo files</strong> or link a folder URL for now.
              <div class="row-actions" style="margin-top:.65rem">
                <button type="button" id="onedriveDemoSeedInline">Load demo files</button>
              </div>
            </div>`;
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
                Live Microsoft sync is deferred for a later build. Use demo files or a folder URL for now.
              </div>`;
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
    formBillable = true,
    billableLocked = false,
    timeFieldDefs,
  }) {
    const canSelectTk = roleCanSelectTimekeeper() && roleCanEditField('time', 'std:timekeeper');
    const showTimekeeper = roleCanSeeField('time', 'std:timekeeper');
    const canEditBillable = !billableLocked && roleCanEditField('time', 'std:billable');
    const showBillable = roleCanSeeField('time', 'std:billable');
    const visibleCustom = (timeFieldDefs || []).filter((field) => {
      const key = field.key || (field.fieldId != null ? `cf:${field.fieldId}` : '');
      return roleCanSeeField('time', key);
    });
    const selfId = Number(state.user?.id);
    const lockedId = selfId;
    const selectedId = canSelectTk
      ? (Number(formTimekeeperId) || selfId)
      : lockedId;
    const timekeeperOptions = canSelectTk
      ? (state.users || [])
      : (state.users || []).filter((u) => Number(u.id) === selfId);
    const selfName = (state.users || []).find((u) => Number(u.id) === selfId)?.name
      || state.user?.name
      || 'You';
    return `
      <div class="time-entry-date-hours span-all">
        <label class="time-entry-date">Date
          <input name="serviceDate" type="date" value="${escapeHtml(formDate)}" required />
        </label>
        <label class="time-entry-hours">Hours
          <input name="hours" type="number" min="0.25" step="0.25" inputmode="decimal"
            value="${escapeHtml(formHours)}" placeholder="0.25" required />
        </label>
      </div>
      ${showTimekeeper ? `
      <label>Timekeeper
        ${canSelectTk ? `
        <select name="timekeeperId">
          ${timekeeperOptions.map((u) =>
            `<option value="${u.id}" ${Number(u.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(u.name)}</option>`
          ).join('')}
        </select>` : `
        <input type="hidden" name="timekeeperId" value="${lockedId}" />
        <input type="text" value="${escapeHtml(selfName)}" disabled aria-label="Timekeeper" />`}
      </label>` : `<input type="hidden" name="timekeeperId" value="${lockedId}" />`}
      ${showBillable ? `
      <label class="check-inline time-entry-billable">
        <input type="checkbox" name="billable" value="1" id="timeEntryBillable"
          ${formBillable && canEditBillable ? 'checked' : ''}
          ${canEditBillable ? '' : 'disabled'} />
        <span>Billable${billableLocked ? ' <span class="muted">(Do not charge)</span>' : ''}</span>
      </label>` : ''}
      <label class="span-all">Description
        <textarea name="description" rows="2" required
          placeholder="What did you work on?">${escapeHtml(formDescription)}</textarea>
      </label>
      ${visibleCustom.map((field) => {
        const key = field.key || (field.fieldId != null ? `cf:${field.fieldId}` : '');
        const canEdit = roleCanEditField('time', key) && !field.readonly;
        return `
        <label class="${field.width === 'full' ? 'span-all' : ''}">${escapeHtml(field.label)}${field.required ? ' *' : ''}
          ${renderFieldInput(field, { canEdit })}
        </label>`;
      }).join('')}
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
      body.timekeeperId = (roleCanSelectTimekeeper() && roleCanEditField('time', 'std:timekeeper'))
        ? Number(body.timekeeperId || state.user.id)
        : Number(state.user.id);
      // Checkbox omitted when unchecked — send an explicit 0/1 only when writable.
      if (roleCanEditField('time', 'std:billable')) {
        body.billable = (fd.get('billable') === '1' || fd.get('billable') === 'on') ? 1 : 0;
      } else {
        delete body.billable;
      }
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
      const writableCustomDefs = (timeFieldDefs || []).filter((field) => {
        const key = field.key || (field.fieldId != null ? `cf:${field.fieldId}` : '');
        return roleCanEditField('time', key);
      });
      const customValues = collectCustomFieldValues(ev.target, writableCustomDefs);
      for (const key of Object.keys(body)) {
        if (key.startsWith('cf_') || key.endsWith('_lat') || key.endsWith('_lng')) {
          delete body[key];
        }
      }
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

  function bindMatterDetailsFieldDrag(formEl, matterId) {
    if (!formEl || !matterId) return;
    const grids = [...formEl.querySelectorAll('[data-matter-details-grid]')];
    if (!grids.length) return;

    let dragEl = null;
    let saving = false;

    const collectItems = () => [...formEl.querySelectorAll('.matter-detail-field[data-field-key]')].map((el, i) => ({
      fieldKey: el.getAttribute('data-field-key'),
      section: el.getAttribute('data-section') || 'details',
      width: el.getAttribute('data-width') || 'half',
      sortOrder: i,
    }));

    const persistOrder = async () => {
      if (saving) return;
      saving = true;
      const msg = formEl.querySelector('#matterMsg');
      try {
        await api(`/api/matters/${matterId}/layout-items`, {
          method: 'PUT',
          body: JSON.stringify({ items: collectItems() }),
        });
        if (msg) {
          msg.innerHTML = successNoticeHtml({
            title: 'Layout updated',
            detail: 'Field order saved for this matter.',
          });
        }
      } catch (e) {
        if (msg) msg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      } finally {
        saving = false;
      }
    };

    grids.forEach((grid) => {
      grid.querySelectorAll('.matter-detail-field[draggable="true"]').forEach((tile) => {
        // Only start drags from the grip so inputs/selects stay usable.
        tile.addEventListener('mousedown', (ev) => {
          const fromHandle = !!ev.target.closest?.('.matter-detail-drag');
          tile.draggable = fromHandle;
        });
        tile.addEventListener('dragstart', (ev) => {
          if (!tile.draggable) {
            ev.preventDefault();
            return;
          }
          dragEl = tile;
          tile.classList.add('is-dragging');
          try {
            ev.dataTransfer.effectAllowed = 'move';
            ev.dataTransfer.setData('text/plain', tile.getAttribute('data-field-key') || '');
          } catch (_) { /* ignore */ }
        });
        tile.addEventListener('dragend', () => {
          tile.classList.remove('is-dragging');
          tile.draggable = true;
          grid.querySelectorAll('.matter-detail-field.is-drop-target').forEach((el) => {
            el.classList.remove('is-drop-target');
          });
          dragEl = null;
        });
      });

      grid.addEventListener('dragover', (ev) => {
        if (!dragEl || !grid.contains(dragEl)) return;
        ev.preventDefault();
        try { ev.dataTransfer.dropEffect = 'move'; } catch (_) { /* ignore */ }
        const over = ev.target.closest?.('.matter-detail-field');
        if (!over || over === dragEl || !grid.contains(over)) return;
        grid.querySelectorAll('.matter-detail-field.is-drop-target').forEach((el) => {
          if (el !== over) el.classList.remove('is-drop-target');
        });
        over.classList.add('is-drop-target');
        const rect = over.getBoundingClientRect();
        const before = ev.clientX < rect.left + rect.width / 2;
        if (before) grid.insertBefore(dragEl, over);
        else grid.insertBefore(dragEl, over.nextSibling);
      });

      grid.addEventListener('drop', async (ev) => {
        if (!dragEl || !grid.contains(dragEl)) return;
        ev.preventDefault();
        grid.querySelectorAll('.matter-detail-field.is-drop-target').forEach((el) => {
          el.classList.remove('is-drop-target');
        });
        await persistOrder();
      });
    });
  }

  async function renderMatterDetail() {
    if (!state.matterId) {
      state.view = 'matters';
      return renderMatters();
    }
    const matterId = state.matterId;
    const [page, timeFields, matterEntries, clients, recordTypes] = await Promise.all([
      api(`/api/matters/${matterId}`),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
      api(`/api/time-entries?matterId=${matterId}`).catch(() => []),
      api('/api/clients').catch(() => state.clients || []),
      api('/api/record-types').catch(() => []),
    ]);
    state.clients = clients || state.clients || [];
    const m = page.matter;
    const matterTypeLabel = ((recordTypes || []).find((t) => t.key === m.matter_type) || {}).label
      || m.matter_type
      || 'Billable';
    const canEdit = canCreateMatter(state.user) && page.canEdit !== false && roleCanModify('matter');
    const canDelete = canCreateMatter(state.user) && page.canDelete !== false && roleCanDelete('matter');
    const canLogTime = roleCanModify('time');
    const canViewTime = roleCanView('time');
    const canDeleteTime = roleCanDelete('time');
    const matterReports = [
      ['lodestar-matter-detail', 'Lodestar Detail', 'Simple list of time worked on this matter'],
      ['lodestar-matter-summary', 'Lodestar Summary', 'Hours and amounts by timekeeper'],
    ];
    const today = firmToday();
    const retain = state.matterTimeRetain || {};
    const addAnother = !!retain.addAnother;
    const formDate = retain.serviceDate || today;
    const formTimekeeperId = roleCanSelectTimekeeper()
      ? (retain.timekeeperId || state.user.id)
      : state.user.id;
    // Match Time Entry page defaults: seed first entry, clear hours/desc when adding another.
    const formHours = addAnother ? '' : '1.00';
    const formDescription = addAnother ? '' : 'Reviewed production set';
    const billableLocked = forcesNonBillableMatterType(m.matter_type);
    const formBillable = billableLocked
      ? false
      : (retain.billable != null
        ? !!Number(retain.billable)
        : defaultBillableFromMatterType(m.matter_type));
    const flash = state.matterTimeFlash;
    const matterFlash = state.matterFieldFlash;
    const createFlash = state.matterCreateFlash;
    const fieldPanelFlash = state.matterFieldPanelFlash;
    const scrollToMatterFields = canEdit && !!state.showPostCreateFields;
    state.matterTimeFlash = null;
    state.matterFieldFlash = null;
    state.matterCreateFlash = null;
    state.matterFieldPanelFlash = null;
    state.matterTimeRetain = null;
    const isMatterOnlyField = (f) => !!(
      f
      && !isBuiltInField(f)
      && (f.scope === 'record' || f.matter_id || f.matterId)
    );
    const matterOnlyFields = (page.layoutFields || []).filter(isMatterOnlyField);
    const editingField = state.editingMatterFieldId
      ? matterOnlyFields.find(
        (f) => Number(fieldIdFromMgmt(f)) === Number(state.editingMatterFieldId)
      )
      : null;
    const matterOnlyFieldsPanelHtml = () => `
      <div class="card stack${scrollToMatterFields ? ' post-create-fields-panel' : ''}" id="matterOnlyFieldsPanel">
        <div class="page-head matters-toolbar" style="margin:0">
          <h2 style="margin:0">Matter level fields</h2>
          ${scrollToMatterFields ? '<button type="button" id="dismissPostCreateFields">Done</button>' : ''}
        </div>
        <p class="hint">Add a field for <strong>this matter only</strong>. Shared defaults for all matters are managed in Settings → Matter page.</p>
        <div class="field-mgmt-list">
          ${fieldMgmtRows(matterOnlyFields, {
            canDelete: true,
            showScope: false,
          })}
        </div>
        ${editingField
          ? `<h3 class="field-edit-title">Edit matter field</h3>${customFieldFormHtml({
            formId: 'recordFieldForm',
            submitLabel: 'Save changes',
            field: editingField,
            showCancel: true,
            showDefault: false,
            requiredLabel: 'Required on this matter',
            appliesTo: 'matter_only',
            formHint: 'This field stays on <strong>this matter only</strong>.',
          })}`
          : customFieldFormHtml({
            formId: 'recordFieldForm',
            submitLabel: 'Add to this matter',
            showDefault: false,
            requiredLabel: 'Required on this matter',
            appliesTo: 'matter_only',
            formHint: 'New fields apply to this matter only — not to other matters.',
          })}
        <div id="matterFieldMsg">${fieldPanelFlash ? successNoticeHtml(fieldPanelFlash) : ''}</div>
      </div>`;
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
    const fieldCtx = {
      canEdit,
      clients: state.clients,
      recordTypes: recordTypes || [
        { key: 'billable', label: 'Billable' },
        { key: 'non_billable', label: 'Non-Billable' },
        { key: 'do_not_charge', label: 'Do not charge' },
      ],
      users: state.users,
    };
    const sections = Object.entries(page.sections || {})
      .map(([section, fields]) => [section, (fields || []).filter((f) => f.key !== 'std:number')])
      .filter(([, fields]) => fields.length > 0);

    const recentEntriesHtml = (matterEntries || []).slice(0, 30).map((e) => {
      const statusLabel = e.status === 'approved' ? 'Ready to bill'
        : e.status === 'invoiced' ? 'Billed'
          : e.status;
      const isOwn = Number(e.timekeeper_id) === Number(state.user.id);
      const billed = e.status === 'invoiced' || !!e.invoice_id;
      const editable = canLogTime
        && !billed
        && (isOwn || roleCanModifyOthersTime());
      const deletable = canDeleteTime && (isOwn || roleCanDeleteOthersTime());
      const hoursVal = formatDuration(e.rounded_minutes, 'decimal');
      const isBillable = !!Number(e.billable);
      if (editable) {
        const entryId = Number(e.id);
        return `
          <tr data-time-row="${entryId}">
            <td class="col-date">
              <input class="inline-input" type="date" data-field="serviceDate"
                value="${escapeHtml(String(e.service_date || '').slice(0, 10))}" />
            </td>
            <td class="col-hours">
              <input class="inline-input inline-hours" type="number" min="0.25" step="0.25"
                inputmode="decimal" data-field="hours" value="${escapeHtml(hoursVal)}"
                aria-label="Hours" />
            </td>
            <td class="col-desc">
              <textarea class="inline-input inline-desc" data-field="description" rows="2"
                aria-label="Description">${escapeHtml(e.description || '')}</textarea>
            </td>
            <td>
              ${roleCanSeeField('time', 'std:billable') ? `
              <label class="check-inline">
                <input type="checkbox" data-field="billable" value="1" ${isBillable ? 'checked' : ''}
                  ${roleCanEditField('time', 'std:billable') ? '' : 'disabled'} />
                <span>Yes</span>
              </label>` : '<span class="muted">—</span>'}
            </td>
            <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
            <td class="row-actions">
              <button type="button" class="primary" data-save-time="${entryId}">Save</button>
              ${deletable ? `<button type="button" class="danger" data-del-time="${entryId}" data-billed="0">Delete</button>` : ''}
            </td>
          </tr>`;
      }
      return `
        <tr>
          <td class="col-date">${escapeHtml(e.service_date)}</td>
          <td class="col-hours"><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
            <span class="muted">hrs</span></td>
          <td class="col-desc">${escapeHtml(e.description || '—')}
            <div class="muted">${escapeHtml(timekeeperDisplayName(e))}</div></td>
          <td>${roleCanSeeField('time', 'std:billable')
            ? (isBillable ? 'Yes' : '<span class="muted">No</span>')
            : '<span class="muted">—</span>'}</td>
          <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
          <td>${deletable
            ? `<button type="button" class="danger" data-del-time="${e.id}" data-billed="${billed ? '1' : '0'}">Delete</button>`
            : ''}</td>
        </tr>`;
    }).join('') || '<tr><td colspan="6" class="muted">No entries yet</td></tr>';

    setMainHtml(`
      <div class="card matter-top">
        <div class="row-actions matter-top-nav">
          <button type="button" id="backMatters">← Matters</button>
          ${canDelete ? '<button type="button" id="deleteMatter">Delete matter</button>' : ''}
        </div>
        <div class="matter-top-split">
          <div class="matter-top-main">
            <h1>${escapeHtml(m.name || 'Matter')}</h1>
            <p class="muted matter-top-meta">Record type · ${escapeHtml(matterTypeLabel)}</p>
            ${createFlash ? successNoticeHtml(createFlash) : ''}
            <details class="onedrive-collapse matter-details-collapse" id="matterDetailsCollapse"${
              state.matterDetailsOpen !== false ? ' open' : ''
            }>
              <summary class="onedrive-collapse-summary">
                <span class="onedrive-collapse-title">Matter details</span>
              </summary>
              <div class="onedrive-collapse-body">
                <form id="matterForm" class="matter-details-panel stack">
                  <div class="matter-details-scroll">
                    ${sections.map(([section, fields]) => `
                      <div class="matter-details-grid" data-matter-details-grid data-section="${escapeHtml(section)}">
                        ${fields.map((f) => {
                          const width = f.width === 'full' ? 'full' : 'half';
                          return `
                        <div class="matter-detail-field matter-detail-field--${width}"
                          data-field-key="${escapeHtml(f.key)}"
                          data-width="${width}"
                          data-section="${escapeHtml(section)}"
                          ${canEdit ? 'draggable="true"' : ''}>
                          ${canEdit ? '<span class="matter-detail-drag" title="Drag to reorder" aria-hidden="true">⋮⋮</span>' : ''}
                          <label>
                            ${escapeHtml(f.label)}${f.required ? ' *' : ''}
                            ${renderFieldInput(f, fieldCtx)}
                          </label>
                        </div>`;
                        }).join('')}
                      </div>
                    `).join('') || '<p class="muted">No fields on this matter yet. Add one under Matter level fields below.</p>'}
                  </div>
                  ${canEdit ? `
                    <div class="row-actions matter-details-actions">
                      <button class="primary" type="submit">Save</button>
                    </div>` : ''}
                  <div id="matterMsg">${matterFlash ? successNoticeHtml(matterFlash) : ''}</div>
                </form>
              </div>
            </details>
          </div>
          <aside class="matter-reports-aside" aria-label="Time reports">
            <div class="matter-reports-aside-head">
              <h2>Time reports</h2>
              <p class="hint">Lodestar for this matter</p>
            </div>
            <div class="matter-report-list">
              ${matterReports.map(([id, label, hint]) => `
                <div class="matter-report-item">
                  <div class="matter-report-copy">
                    <strong>${escapeHtml(label)}</strong>
                    <span class="muted">${escapeHtml(hint)}</span>
                  </div>
                  <div class="matter-report-actions">
                    <button type="button" data-view-matter-report="${id}">View</button>
                    <button type="button" data-matter-report="${id}" data-format="pdf">PDF</button>
                    <button type="button" data-matter-report="${id}" data-format="xlsx">Excel</button>
                  </div>
                </div>`).join('')}
            </div>
            <div id="matterReportMsg"></div>
          </aside>
        </div>
        <div id="matterReportOut" class="matter-report-out" hidden></div>
      </div>

      ${canViewTime ? `
      ${canLogTime ? `<div class="card">
        <h1>Time Entry</h1>
        <p class="hint">Logging time on <strong>${escapeHtml(m.name || 'this matter')}</strong>. ${
          billableLocked
            ? 'Do not charge matters are always non-billable and never appear on invoices.'
            : matterBillingMode(m.matter_type) === 'non_billable'
              ? 'Non-Billable matters appear on invoices with hours at $0 (no charge).'
              : `Billable defaults from the ${escapeHtml(matterTypeLabel)} record type.`
        }</p>
        <form id="matterTimeForm" class="grid two">
          <input type="hidden" name="matterId" value="${Number(m.id)}" />
          ${timeEntryFormFieldsHtml({
            formDate,
            formHours,
            formDescription,
            formTimekeeperId,
            formBillable,
            billableLocked,
            timeFieldDefs,
          })}
        </form>
        <div id="matterTimeMsg" style="margin-top:.75rem">${flash ? successNoticeHtml(flash) : ''}</div>
      </div>` : `<div class="card"><h1>Time Entry</h1>${flash ? successNoticeHtml(flash) : ''}<p class="muted">Your role can view time entries but not create them.</p></div>`}
      <div class="card">
        <h2>Recent entries</h2>
        <p class="hint">All saved time on this matter. Non-billable rows still appear in Lodestar with hours at $0.</p>
        <div class="table-wrap"><table class="time-entries-table">
          <thead>
            <tr>
              <th class="col-date">Date</th>
              <th class="col-hours">Hours</th>
              <th class="col-desc">Description</th>
              <th>Billable</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${recentEntriesHtml}
          </tbody>
        </table></div>
        <div id="matterTimeListMsg" style="margin-top:.75rem"></div>
      </div>` : ''}

      ${canEdit ? matterOnlyFieldsPanelHtml() : ''}

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
                <p class="hint">Live Microsoft sync is deferred for a later build. Demo files and OneDrive view still work.</p>
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
      </details>`);

    $('#backMatters').onclick = () => {
      state.view = 'matters';
      state.matterId = null;
      state.showPostCreateFields = false;
      state.editingMatterFieldId = null;
      renderShell();
      renderView();
    };

    const deleteMatterBtn = $('#deleteMatter');
    if (deleteMatterBtn && canDelete) {
      deleteMatterBtn.onclick = async () => {
        const sure = await confirmAction({
          title: 'Delete this matter?',
          message: 'Are you sure you want to delete this matter? This cannot be undone.',
          name: m.name || 'this matter',
          confirmLabel: 'Yes, delete matter',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/matters/${m.id}`, { method: 'DELETE' });
          state.matterId = null;
          state.view = 'matters';
          state.showPostCreateFields = false;
          state.editingMatterFieldId = null;
          await refreshRefs();
          renderShell();
          await renderMatters();
        } catch (e) {
          const msgHost = $('#matterMsg');
          if (msgHost) {
            msgHost.innerHTML = '';
            showMatterDeleteError(msgHost, e.message);
          }
        }
      };
    }

    const dismissPostCreate = $('#dismissPostCreateFields');
    if (dismissPostCreate) {
      dismissPostCreate.onclick = async () => {
        state.showPostCreateFields = false;
        state.editingMatterFieldId = null;
        await renderMatterDetail();
      };
    }
    if (scrollToMatterFields) {
      setTimeout(() => {
        const panel = $('#matterOnlyFieldsPanel');
        if (panel?.scrollIntoView) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }

    const matterDetailsCollapse = $('#matterDetailsCollapse');
    if (matterDetailsCollapse) {
      matterDetailsCollapse.addEventListener('toggle', () => {
        state.matterDetailsOpen = !!matterDetailsCollapse.open;
      });
    }

    const matterForm = $('#matterForm');
    if (matterForm && canEdit) {
      matterForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(matterForm);
        const patch = {};
        for (const [key, value] of fd.entries()) {
          if (key.startsWith('cf_') || key.endsWith('_lat') || key.endsWith('_lng')) continue;
          if (key === 'std:name') patch.name = value;
          else if (key === 'std:client') patch.clientId = Number(value);
          else if (key === 'std:matter_type') { /* fixed */ }
          else if (key === 'std:status') patch.status = value;
          else if (key === 'std:jurisdiction') patch.jurisdiction = value;
          else if (key === 'std:court') patch.court = value;
          else if (key === 'std:responsible_attorney') {
            patch.responsibleAttorneyId = value ? Number(value) : null;
          } else if (key === 'std:opened_on') patch.openedOn = value;
        }
        const matterFieldDefs = Object.values(page.sections || {}).flat()
          .filter((f) => f.kind === 'custom');
        patch.customValues = collectCustomFieldValues(matterForm, matterFieldDefs);
        try {
          await api(`/api/matters/${m.id}`, { method: 'PATCH', body: JSON.stringify(patch) });
          state.matterFieldFlash = {
            title: 'Changes saved',
            detail: 'Matter details are up to date.',
          };
          await renderMatterDetail();
          await refreshRefs();
        } catch (e) {
          $('#matterMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
      bindMatterDetailsFieldDrag(matterForm, m.id);
    }

    const matterListMsg = (html) => {
      const el = $('#matterTimeListMsg');
      if (el) el.innerHTML = html || '';
    };

    main.querySelectorAll('[data-save-time]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-save-time'));
        if (!Number.isFinite(id) || id <= 0) {
          matterListMsg('<div class="error">Could not determine which time entry to save.</div>');
          return;
        }
        const row = main.querySelector(`[data-time-row="${id}"]`);
        if (!row) {
          matterListMsg('<div class="error">Time entry row not found. Refresh and try again.</div>');
          return;
        }
        const serviceDate = String(row.querySelector('[data-field="serviceDate"]')?.value || '').slice(0, 10);
        const description = String(row.querySelector('[data-field="description"]')?.value || '').trim();
        const hours = Number(row.querySelector('[data-field="hours"]')?.value);
        const billableEl = row.querySelector('[data-field="billable"]');
        const billable = (billableEl && roleCanEditField('time', 'std:billable'))
          ? (billableEl.checked ? 1 : 0)
          : undefined;
        if (!serviceDate) {
          matterListMsg('<div class="error">Enter a service date.</div>');
          return;
        }
        if (!description) {
          matterListMsg('<div class="error">Enter a description.</div>');
          return;
        }
        if (!Number.isFinite(hours) || hours <= 0) {
          matterListMsg('<div class="error">Enter hours in 0.25 increments.</div>');
          return;
        }
        btn.disabled = true;
        try {
          const updated = await api(`/api/time-entries/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              serviceDate,
              matterId: Number(m.id),
              description,
              hours,
              ...(billable !== undefined ? { billable } : {}),
            }),
          });
          state.matterTimeFlash = {
            title: 'Time entry updated',
            detail: `${description} · ${formatHoursLabel(updated.roundedMinutes)}`,
          };
          await renderMatterDetail();
        } catch (e) {
          matterListMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          btn.disabled = false;
        }
      };
    });

    main.querySelectorAll('[data-del-time]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-del-time'));
        if (!Number.isFinite(id) || id <= 0) {
          matterListMsg('<div class="error">Could not determine which time entry to delete.</div>');
          return;
        }
        const billed = btn.getAttribute('data-billed') === '1';
        const sure = await confirmAction({
          title: 'Delete this time entry?',
          message: billed
            ? 'This entry is billed. Deleting it removes the time and its line from the bill (or the whole bill if it was the only line). This cannot be undone.'
            : 'Are you sure you want to delete this time entry? This cannot be undone.',
          confirmLabel: 'Yes, delete entry',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/time-entries/${id}`, { method: 'DELETE' });
          state.matterTimeFlash = { title: 'Time entry deleted' };
          await renderMatterDetail();
        } catch (e) {
          matterListMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });

    const matterTimeForm = $('#matterTimeForm');
    if (matterTimeForm) {
      wireTimeEntrySubmit(matterTimeForm, {
        msgEl: $('#matterTimeMsg'),
        timeFieldDefs,
        fixedMatterId: m.id,
        onSaved: async (entry, body) => {
          const savedDesc = String(body.description || entry.description || '').trim() || 'Time entry';
          state.matterTimeFlash = {
            title: 'Time saved',
            detail: `${savedDesc} · ${formatHoursLabel(entry.roundedMinutes)}`,
          };
          state.matterTimeRetain = {
            addAnother: true,
            serviceDate: body.serviceDate,
            timekeeperId: body.timekeeperId,
            billable: body.billable ? 1 : 0,
          };
          await renderMatterDetail();
          const hoursInput = $('#matterTimeForm')?.querySelector('input[name="hours"]');
          const descInput = $('#matterTimeForm')?.querySelector('textarea[name="description"]');
          setTimeout(() => {
            if (descInput) descInput.focus();
            else if (hoursInput) hoursInput.focus();
          }, 0);
        },
      });
    }

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
              <p class="hint">Includes non-billable time at $0 so every saved entry is listed.</p>
              <div class="table-wrap"><table>
                <thead><tr><th>Date</th><th>Timekeeper</th><th>Hours</th><th>Amount</th><th>Billable</th><th>Description</th></tr></thead>
                <tbody>
                  ${entries.map((e) => `
                    <tr>
                      <td>${escapeHtml(e.service_date || '')}</td>
                      <td>${escapeHtml(e.timekeeper || '')}</td>
                      <td>${escapeHtml(formatDuration(e.minutes))}</td>
                      <td>${money(e.amount_cents)}</td>
                      <td>${e.billable ? 'Yes' : '<span class="muted">No</span>'}</td>
                      <td>${escapeHtml(e.description || '')}</td>
                    </tr>`).join('') || '<tr><td colspan="6" class="muted">No time entries yet</td></tr>'}
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
                    </tr>`).join('') || '<tr><td colspan="5" class="muted">No time entries yet</td></tr>'}
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

    main.querySelectorAll('[data-edit-matter-field]').forEach((btn) => {
      btn.onclick = async () => {
        state.editingMatterFieldId = Number(btn.dataset.editMatterField);
        await renderMatterDetail();
      };
    });
    main.querySelectorAll('[data-del-matter-field]').forEach((btn) => {
      btn.onclick = async () => {
        const label = fieldLabelFromDeleteBtn(btn);
        const sure = await confirmDeleteCustomField(label);
        if (!sure) return;
        try {
          await api(
            `/api/matters/${m.id}/layout-fields?fieldKey=${encodeURIComponent(btn.dataset.delMatterField)}`,
            { method: 'DELETE' }
          );
          if (String(btn.dataset.delMatterField) === `cf:${state.editingMatterFieldId}`) {
            state.editingMatterFieldId = null;
          }
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    });
    main.querySelectorAll('[data-del-custom-field]').forEach((btn) => {
      btn.onclick = async () => {
        const label = fieldLabelFromDeleteBtn(btn);
        const sure = await confirmDeleteCustomField(label);
        if (!sure) return;
        try {
          const id = Number(btn.dataset.delCustomField);
          await api(`/api/custom-fields/${id}`, { method: 'DELETE' });
          if (Number(state.editingMatterFieldId) === id) state.editingMatterFieldId = null;
          state.matterFieldPanelFlash = {
            title: 'Custom field deleted',
            detail: 'The field was removed from this matter.',
          };
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });

    const cancelFieldEdit = main.querySelector('[data-cancel-field-edit]');
    if (cancelFieldEdit) {
      cancelFieldEdit.onclick = async () => {
        state.editingMatterFieldId = null;
        await renderMatterDetail();
      };
    }

    const rf = $('#recordFieldForm');
    wireDropdownOptionsToggle(rf);
    if (rf) {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        const { fieldType, options, body } = customFieldPayload(fd);
        if ((fieldType === 'dropdown' || fieldType === 'select' || fieldType === 'multiselect') && !options.length) {
          $('#matterFieldMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
          return;
        }
        try {
          if (state.editingMatterFieldId) {
            await api(`/api/custom-fields/${state.editingMatterFieldId}`, {
              method: 'PATCH',
              body: JSON.stringify(body),
            });
            state.editingMatterFieldId = null;
            state.matterFieldPanelFlash = {
              title: 'Matter field updated',
              detail: `${body.label || 'Field'} was saved for this matter.`,
            };
          } else {
            await api(`/api/matters/${m.id}/custom-fields`, {
              method: 'POST',
              body: JSON.stringify(body),
            });
            state.matterFieldPanelFlash = {
              title: 'Matter field added',
              detail: `${body.label || 'Field'} is available on this matter only.`,
            };
          }
          await renderMatterDetail();
        } catch (e) {
          $('#matterFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
  }

  async function renderTime() {
    const canEdit = roleCanModify('time');
    const canDelete = roleCanDelete('time');
    const [entries, settings, matters, timeFields] = await Promise.all([
      api('/api/time-entries'),
      api('/api/settings'),
      api('/api/matters').catch(() => []),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
    ]);
    if (!stillOnView('time')) return;
    state.settings = settings;
    state.matters = matters;
    const today = firmToday();
    const retain = state.timeEntryRetain || {};
    const addAnother = !!retain.addAnother;
    const preferredMatterId = retain.matterId
      || state.matterId
      || (matters.length === 1 ? matters[0].id : null);
    const formDate = retain.serviceDate || today;
    const formTimekeeperId = roleCanSelectTimekeeper()
      ? (retain.timekeeperId || state.user.id)
      : state.user.id;
    const formHours = addAnother ? '' : '1.00';
    const formDescription = addAnother ? '' : 'Reviewed production set';
    const preferredMatter = matters.find((m) => Number(m.id) === Number(preferredMatterId)) || null;
    const billableLocked = forcesNonBillableMatterType(preferredMatter?.matter_type);
    const formBillable = billableLocked
      ? false
      : (retain.billable != null
        ? !!Number(retain.billable)
        : defaultBillableFromMatterType(preferredMatter?.matter_type));
    const flash = state.timeFlash;
    state.timeFlash = null;
    state.timeEntryRetain = null;
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
    setMainHtml(`
      ${canEdit ? `<div class="card">
        <h1>Time Entry</h1>
        <form id="timeForm" class="grid two">
          <div class="field span-all">
            <span class="field-label">Matter</span>
            ${renderMatterPicker({
              name: 'matterId',
              selectedId: preferredMatterId,
              matters,
            })}
            <span class="hint">Type to filter by matter name or client. Billable matters charge on invoices; Non-Billable show hours at $0; Do not charge never invoice.</span>
          </div>
          ${timeEntryFormFieldsHtml({
            formDate,
            formHours,
            formDescription,
            formTimekeeperId,
            formBillable,
            billableLocked,
            timeFieldDefs,
          })}
        </form>
        <div id="timeMsg" style="margin-top:.75rem">${flash ? successNoticeHtml(flash) : ''}</div>
      </div>` : `<div class="card"><h1>Time Entry</h1>${flash ? successNoticeHtml(flash) : ''}<p class="muted">Your role can view time entries but not create them.</p></div>`}
      <div class="card">
        <h2>Recent entries</h2>
        <div class="table-wrap"><table class="time-entries-table">
          <thead>
            <tr>
              <th class="col-date">Date</th>
              <th class="col-hours">Hours</th>
              <th>Matter</th>
              <th class="col-desc">Description</th>
              <th>Billable</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${entries.slice(0, 30).map((e) => {
              const matterName = e.matter_name
                || (matters.find((m) => Number(m.id) === Number(e.matter_id)) || {}).name
                || e.matter_number
                || '—';
              const statusLabel = e.status === 'approved' ? 'Ready to bill'
                : e.status === 'invoiced' ? 'Billed'
                  : e.status;
              const isOwn = Number(e.timekeeper_id) === Number(state.user.id);
              const billed = e.status === 'invoiced' || !!e.invoice_id;
              const editable = canEdit
                && !billed
                && (isOwn || roleCanModifyOthersTime());
              const deletable = canDelete && (isOwn || roleCanDeleteOthersTime());
              const hoursVal = formatDuration(e.rounded_minutes, 'decimal');
              const isBillable = !!Number(e.billable);
              if (editable) {
                const entryId = Number(e.id);
                const matterChoices = Array.isArray(matters) ? [...matters] : [];
                if (
                  e.matter_id != null
                  && !matterChoices.some((m) => Number(m.id) === Number(e.matter_id))
                ) {
                  matterChoices.unshift({
                    id: e.matter_id,
                    name: e.matter_name || e.matter_number || `Matter ${e.matter_id}`,
                  });
                }
                return `
              <tr data-time-row="${entryId}">
                <td class="col-date">
                  <input class="inline-input" type="date" data-field="serviceDate"
                    value="${escapeHtml(String(e.service_date || '').slice(0, 10))}" />
                </td>
                <td class="col-hours">
                  <input class="inline-input inline-hours" type="number" min="0.25" step="0.25"
                    inputmode="decimal" data-field="hours" value="${escapeHtml(hoursVal)}"
                    aria-label="Hours" />
                </td>
                <td>
                  <select class="inline-input" data-field="matterId" aria-label="Matter">
                    ${matterChoices.map((m) => `
                      <option value="${Number(m.id)}" ${Number(m.id) === Number(e.matter_id) ? 'selected' : ''}>
                        ${escapeHtml(m.name || m.number || String(m.id))}
                      </option>`).join('')}
                  </select>
                </td>
                <td class="col-desc">
                  <textarea class="inline-input inline-desc" data-field="description" rows="2"
                    aria-label="Description">${escapeHtml(e.description || '')}</textarea>
                </td>
                <td>
                  ${roleCanSeeField('time', 'std:billable') ? `
                  <label class="check-inline">
                    <input type="checkbox" data-field="billable" value="1" ${isBillable ? 'checked' : ''}
                      ${roleCanEditField('time', 'std:billable') ? '' : 'disabled'} />
                    <span>Yes</span>
                  </label>` : '<span class="muted">—</span>'}
                </td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
                <td class="row-actions">
                  <button type="button" class="primary" data-save-time="${entryId}">Save</button>
                  ${deletable ? `<button type="button" class="danger" data-del-time="${entryId}" data-billed="0">Delete</button>` : ''}
                </td>
              </tr>`;
              }
              return `
              <tr>
                <td class="col-date">${escapeHtml(e.service_date)}</td>
                <td class="col-hours"><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">hrs</span></td>
                <td>${escapeHtml(matterName)}</td>
                <td class="col-desc">${escapeHtml(e.description || '—')}</td>
                <td>${roleCanSeeField('time', 'std:billable')
                  ? (isBillable ? 'Yes' : '<span class="muted">No</span>')
                  : '<span class="muted">—</span>'}</td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
                <td>${deletable
                  ? `<button type="button" class="danger" data-del-time="${e.id}" data-billed="${billed ? '1' : '0'}">Delete</button>`
                  : ''}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="7" class="muted">No entries yet</td></tr>'}
          </tbody>
        </table></div>
        <div id="timeListMsg" style="margin-top:.75rem"></div>
      </div>`);

    const listMsg = (html) => {
      const el = $('#timeListMsg');
      if (el) el.innerHTML = html || '';
    };

    main.querySelectorAll('[data-save-time]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-save-time'));
        if (!Number.isFinite(id) || id <= 0) {
          listMsg('<div class="error">Could not determine which time entry to save.</div>');
          return;
        }
        const row = main.querySelector(`[data-time-row="${id}"]`);
        if (!row) {
          listMsg('<div class="error">Time entry row not found. Refresh and try again.</div>');
          return;
        }
        const serviceDate = String(row.querySelector('[data-field="serviceDate"]')?.value || '').slice(0, 10);
        const matterId = Number(row.querySelector('[data-field="matterId"]')?.value);
        const description = String(row.querySelector('[data-field="description"]')?.value || '').trim();
        const hours = Number(row.querySelector('[data-field="hours"]')?.value);
        const billableEl = row.querySelector('[data-field="billable"]');
        const billable = (billableEl && roleCanEditField('time', 'std:billable'))
          ? (billableEl.checked ? 1 : 0)
          : undefined;
        if (!serviceDate) {
          listMsg('<div class="error">Enter a service date.</div>');
          return;
        }
        if (!matterId) {
          listMsg('<div class="error">Select a matter.</div>');
          return;
        }
        if (!description) {
          listMsg('<div class="error">Enter a description.</div>');
          return;
        }
        if (!Number.isFinite(hours) || hours <= 0) {
          listMsg('<div class="error">Enter hours in 0.25 increments.</div>');
          return;
        }
        btn.disabled = true;
        try {
          const updated = await api(`/api/time-entries/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              serviceDate,
              matterId,
              description,
              hours,
              ...(billable !== undefined ? { billable } : {}),
            }),
          });
          state.timeFlash = {
            title: 'Time entry updated',
            detail: `${description} · ${formatHoursLabel(updated.roundedMinutes)}`,
          };
          await renderTime();
        } catch (e) {
          listMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          btn.disabled = false;
        }
      };
    });

    main.querySelectorAll('[data-del-time]').forEach((btn) => {
      btn.onclick = async () => {
        const id = Number(btn.getAttribute('data-del-time'));
        if (!Number.isFinite(id) || id <= 0) {
          listMsg('<div class="error">Could not determine which time entry to delete.</div>');
          return;
        }
        const billed = btn.getAttribute('data-billed') === '1';
        const sure = await confirmAction({
          title: 'Delete this time entry?',
          message: billed
            ? 'This entry is billed. Deleting it removes the time and its line from the bill (or the whole bill if it was the only line). This cannot be undone.'
            : 'Are you sure you want to delete this time entry? This cannot be undone.',
          confirmLabel: 'Yes, delete entry',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/time-entries/${id}`, { method: 'DELETE' });
          state.timeFlash = { title: 'Time entry deleted' };
          await renderTime();
        } catch (e) {
          listMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });

    let matterPicker = null;
    const timeForm = $('#timeForm');
    if (timeForm) {
      const syncBillableFromMatter = (m) => {
        const cb = timeForm.querySelector('input[name="billable"]');
        if (!cb) return;
        const locked = forcesNonBillableMatterType(m?.matter_type);
        cb.disabled = locked;
        cb.checked = locked ? false : defaultBillableFromMatterType(m?.matter_type);
        const label = cb.closest('label')?.querySelector('span');
        if (label) {
          label.innerHTML = locked
            ? 'Billable <span class="muted">(Do not charge)</span>'
            : 'Billable';
        }
      };
      matterPicker = wireMatterPicker(timeForm, {
        matters,
        onChange: syncBillableFromMatter,
      });
      wireTimeEntrySubmit(timeForm, {
        msgEl: $('#timeMsg'),
        timeFieldDefs,
        matterPicker,
        onSaved: async (entry, body) => {
          const desc = String(body.description || entry.description || '').trim() || 'Time entry';
          state.matterId = body.matterId;
          state.timeEntryRetain = {
            addAnother: true,
            matterId: body.matterId,
            serviceDate: body.serviceDate,
            timekeeperId: body.timekeeperId,
            billable: body.billable ? 1 : 0,
          };
          state.focusTimeEntry = true;
          state.timeFlash = {
            title: 'Time saved',
            detail: `${desc} · ${formatHoursLabel(entry.roundedMinutes)}`,
          };
          await renderTime();
        },
      });
    }

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

  function billHeaderMetaHtml(inv, fieldConfig) {
    const keys = fieldConfig?.headerKeys || [];
    const bits = [];
    for (const key of keys) {
      if (key === 'subtotal' || key === 'total') continue;
      let value = '';
      if (key === 'matter_name') value = inv.matter_name || inv.matter_number || '';
      else if (key === 'matter_number') value = inv.matter_number || '';
      else if (key === 'client') value = inv.client_name || '';
      else if (key === 'status') value = invoiceStageLabel(inv.status);
      else if (key === 'issue_date') value = inv.issue_date || '';
      else if (key === 'due_date') value = inv.due_date || '';
      if (value) bits.push(escapeHtml(String(value)));
    }
    const moneyBits = [];
    if (keys.includes('subtotal')) moneyBits.push(`Subtotal ${money(inv.subtotal_cents)}`);
    if (keys.includes('total')) moneyBits.push(`Total ${money(inv.total_cents)}`);
    const all = [...bits, ...moneyBits];
    return all.length ? `<p class="muted">${all.join(' · ')}</p>` : '';
  }

  function billLineCellHtml(line, key) {
    if (key === 'service_date') return `<td>${escapeHtml(line.service_date || '')}</td>`;
    if (key === 'timekeeper') return `<td>${escapeHtml(line.timekeeper_name || '')}</td>`;
    if (key === 'description') return `<td>${escapeHtml(line.description || '')}</td>`;
    if (key === 'hours') return `<td>${escapeHtml(formatDuration(line.minutes))}</td>`;
    if (key === 'minutes') return `<td>${escapeHtml(String(line.minutes || 0))}</td>`;
    if (key === 'rate') return `<td>${money(line.rate_cents)}</td>`;
    if (key === 'amount') return `<td>${money(line.amount_cents)}</td>`;
    return '<td></td>';
  }

  function maxServiceDate(...dates) {
    const valid = dates
      .map((d) => String(d || '').slice(0, 10))
      .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    if (!valid.length) return '';
    return valid.sort().at(-1);
  }

  async function billingServiceDateBounds(matterId) {
    if (!matterId) return { earliestDate: '', latestDate: '' };
    try {
      const data = await api(
        `/api/time-entries/earliest-date?matterId=${encodeURIComponent(matterId)}`,
        { cache: false },
      );
      return {
        earliestDate: String(data?.earliestDate || '').slice(0, 10),
        latestDate: String(data?.latestDate || '').slice(0, 10),
      };
    } catch {
      return { earliestDate: '', latestDate: '' };
    }
  }

  async function applyBillingMatterDateDefaults(matterId, { force = false } = {}) {
    const today = firmToday();
    const key = matterId != null && matterId !== '' ? String(matterId) : '';
    if (!state.billingForm) {
      state.billingForm = { matterId: '', dateFrom: '', dateTo: today, defaultsForMatterId: '' };
    }
    const form = state.billingForm;
    if (!key) {
      form.matterId = '';
      form.dateFrom = '';
      form.dateTo = form.dateTo == null ? today : form.dateTo;
      form.defaultsForMatterId = '';
      state.billingForm = form;
      return form;
    }
    // Suffix forces one re-default after the TZ/bounds fix so stale From>To ranges refresh.
    const defaultsKey = `${key}@bounds-v2`;
    const fromMissing = !/^\d{4}-\d{2}-\d{2}$/.test(String(form.dateFrom || ''));
    const inverted = !fromMissing
      && /^\d{4}-\d{2}-\d{2}$/.test(String(form.dateTo || ''))
      && String(form.dateFrom) > String(form.dateTo);
    // Re-default when forced, first visit for this matter, From was cleared, or range is inverted.
    if (!force && form.defaultsForMatterId === defaultsKey && !fromMissing && !inverted) {
      return form;
    }
    const bounds = await billingServiceDateBounds(key);
    let earliest = bounds.earliestDate || '';
    let latest = bounds.latestDate || earliest;
    // Fallback: derive bounds from the matter's time list if the dedicated endpoint fails.
    if (!earliest) {
      try {
        const entries = await api(
          `/api/time-entries?matterId=${encodeURIComponent(key)}`,
          { cache: false },
        );
        const dates = (entries || [])
          .map((e) => String(e.service_date || '').slice(0, 10))
          .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d))
          .sort();
        if (dates.length) {
          earliest = dates[0];
          latest = dates[dates.length - 1];
        }
      } catch {
        /* keep empty — fall through to today */
      }
    }
    form.matterId = key;
    form.dateFrom = earliest || today;
    // Include firm-today and any entries already on the matter (covers TZ/UTC skew).
    form.dateTo = maxServiceDate(today, earliest, latest) || today;
    form.defaultsForMatterId = defaultsKey;
    state.billingForm = form;
    return form;
  }

  async function renderBilling() {
    const canBill = ['admin', 'billing_clerk'].includes(state.user.role);
    const [invoices, matters] = await Promise.all([
      api('/api/invoices', { cache: false }),
      api('/api/matters').catch(() => []),
    ]);
    if (!stillOnView('billing')) return;
    state.matters = matters || [];
    const today = firmToday();
    if (!state.billingForm) {
      state.billingForm = { matterId: '', dateFrom: '', dateTo: today, defaultsForMatterId: '' };
    }
    // null = never set → default To to today; '' means the user cleared it.
    if (state.billingForm.dateTo == null) state.billingForm.dateTo = today;
    if (state.billingForm.matterId) {
      // Always restore From when missing (e.g. user cleared it, then left and returned).
      await applyBillingMatterDateDefaults(state.billingForm.matterId);
      if (!stillOnView('billing')) return;
    }
    const form = state.billingForm;
    const selectedMatterId = form.matterId || '';
    const dateFrom = form.dateFrom || '';
    const dateTo = form.dateTo || '';
    setMainHtml(`
      <div class="card stack">
        <h1>Billing</h1>
        <p class="lead">Select a matter and date range, run Lodestar, then create a bill.</p>
        ${canBill ? `
        <form id="billForm" class="grid two">
          <div class="field span-all">
            <span class="field-label">Matter</span>
            ${renderMatterPicker({
              name: 'matterId',
              selectedId: selectedMatterId || null,
              matters: matters || [],
            })}
          </div>
          <label>From
            <input type="date" name="dateFrom" id="billDateFrom" value="${escapeHtml(dateFrom)}" />
          </label>
          <label>To
            <input type="date" name="dateTo" id="billDateTo" value="${escapeHtml(dateTo)}" />
          </label>
          <p class="hint span-all">Defaults to the matter’s earliest time entry through today (or the latest entry if newer). Billable matters charge normally; Non-Billable invoices show hours at $0; Do not charge matters cannot be billed.</p>
          <div class="row-actions span-all" style="flex-wrap:wrap;gap:.5rem">
            <button type="button" data-bill-report="lodestar-matter-summary">Lodestar Summary</button>
            <button type="button" data-bill-report="lodestar-matter-detail">Lodestar Detail</button>
            <button type="button" data-bill-report-format="pdf" data-bill-report="lodestar-matter-summary">Summary PDF</button>
            <button type="button" data-bill-report-format="pdf" data-bill-report="lodestar-matter-detail">Detail PDF</button>
            <button type="button" data-bill-report-format="xlsx" data-bill-report="lodestar-matter-summary">Summary Excel</button>
            <button type="button" data-bill-report-format="xlsx" data-bill-report="lodestar-matter-detail">Detail Excel</button>
            <button class="primary" type="submit">Create bill</button>
          </div>
        </form>
        <div id="billReportOut" hidden></div>` : '<div class="error">Only admins and billing clerks can create bills.</div>'}
        <div id="billMsg"></div>
      </div>
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
                <td class="row-actions">
                  <button type="button" data-open="${i.id}">Open</button>
                  ${canBill ? `<button type="button" class="danger" data-invoice-delete="${Number(i.id)}" data-invoice-number="${escapeHtml(i.number || '')}">Delete</button>` : ''}
                </td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No bills yet</td></tr>'}
          </tbody>
        </table></div>
      </div>
      <div id="invoiceDetail"></div>`);

    if (canBill) {
      const billForm = $('#billForm');
      const billMatterPicker = wireMatterPicker(billForm, {
        matters,
        onChange: (m) => {
          // Mark matter immediately so a mid-flight persistDates cannot drop it.
          state.billingForm = {
            ...(state.billingForm || {}),
            matterId: m?.id != null ? String(m.id) : '',
            defaultsForMatterId: '',
          };
          void (async () => {
            const form = await applyBillingMatterDateDefaults(
              m?.id != null ? m.id : '',
              { force: true },
            );
            if (!stillOnView('billing')) return;
            const fromEl = $('#billDateFrom');
            const toEl = $('#billDateTo');
            if (fromEl) fromEl.value = form.dateFrom || '';
            if (toEl) toEl.value = form.dateTo || today;
          })();
        },
      });
      const persistDates = () => {
        const fromRaw = String($('#billDateFrom')?.value || '').trim();
        const toRaw = String($('#billDateTo')?.value || '').trim();
        state.billingForm = {
          ...(state.billingForm || {}),
          matterId: String(new FormData(billForm).get('matterId') || state.billingForm?.matterId || ''),
          dateFrom: /^\d{4}-\d{2}-\d{2}$/.test(fromRaw) ? fromRaw : '',
          dateTo: /^\d{4}-\d{2}-\d{2}$/.test(toRaw) ? toRaw : '',
          defaultsForMatterId: state.billingForm?.defaultsForMatterId || '',
        };
      };
      $('#billDateFrom')?.addEventListener('change', persistDates);
      $('#billDateTo')?.addEventListener('change', persistDates);

      const billingQuery = () => {
        persistDates();
        const fd = new FormData(billForm);
        const matterId = Number(fd.get('matterId') || state.billingForm?.matterId);
        const from = String(fd.get('dateFrom') || '').trim();
        const to = String(fd.get('dateTo') || '').trim();
        return { matterId, dateFrom: from, dateTo: to };
      };

      const runBillReport = async (reportId, format = null) => {
        const { matterId, dateFrom: from, dateTo: to } = billingQuery();
        if (!matterId) {
          billMatterPicker?.setInvalid(true);
          $('#billMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
          billMatterPicker?.focus();
          return;
        }
        const params = new URLSearchParams({ matterId: String(matterId) });
        if (from) params.set('dateFrom', from);
        if (to) params.set('dateTo', to);
        if (format) params.set('format', format);
        const url = `/api/reports/${reportId}?${params}`;
        const out = $('#billReportOut');
        const msg = $('#billMsg');
        try {
          if (format === 'pdf' || format === 'xlsx') {
            const res = await api(url);
            const blob = await res.blob();
            const tmp = document.createElement('a');
            tmp.href = URL.createObjectURL(blob);
            tmp.download = `${reportId}-${matterId}.${format === 'xlsx' ? 'xlsx' : 'pdf'}`;
            document.body.appendChild(tmp);
            tmp.click();
            tmp.remove();
            URL.revokeObjectURL(tmp.href);
            if (msg) msg.innerHTML = '';
            return;
          }
          const data = await api(url);
          if (!out) return;
          out.hidden = false;
          const totalHours = formatDuration(data.totals?.minutes || 0);
          const totalAmount = money(data.totals?.amount_cents || 0);
          const billableHours = formatDuration(data.totals?.billable_minutes || 0);
          const nonBillableHours = formatDuration(data.totals?.nonbillable_minutes || 0);
          const entryCount = Number(data.totals?.entry_count || 0);
          const period = data.header?.period
            || ((from || to) ? [from || '…', to || '…'].join(' → ') : 'All dates');
          const totalsUnderLabel = `
            <p class="lodestar-report-totals">
              <span><span class="muted">Total hours</span> <strong>${escapeHtml(totalHours)}</strong></span>
              <span><span class="muted">Total amount</span> <strong>${totalAmount}</strong></span>
              <span><span class="muted">Entries</span> <strong>${entryCount}</strong></span>
            </p>
            <p class="hint">Billable ${escapeHtml(billableHours)} · Non-billable ${escapeHtml(nonBillableHours)} at $0</p>`;
          const matterLine = `<p class="muted">${escapeHtml(data.header?.matter_number || '')}
            ${data.header?.matter_number ? ' — ' : ''}${escapeHtml(data.header?.matter_name || '')}
            ${data.header?.client_name ? ` · ${escapeHtml(data.header.client_name)}` : ''}
            · ${escapeHtml(period)}</p>`;
          if (reportId === 'lodestar-matter-summary') {
            const rows = data.summary || [];
            out.innerHTML = `
              <h3 style="margin:0 0 .35rem;font-family:var(--font)">Lodestar Summary</h3>
              ${totalsUnderLabel}
              ${matterLine}
              <p class="hint">Rows split when a timekeeper’s rate changes in the period.</p>
              <div class="table-wrap"><table>
                <thead><tr><th>Timekeeper</th><th>Role</th><th>Billable</th><th>Rate</th><th>Hours</th><th>Amount</th><th>Entries</th></tr></thead>
                <tbody>
                  ${rows.map((r) => `
                    <tr>
                      <td>${escapeHtml(r.timekeeper)}</td>
                      <td>${escapeHtml(r.role || '')}</td>
                      <td>${r.billable ? 'Yes' : '<span class="muted">No</span>'}</td>
                      <td>${money(r.rate_cents)}</td>
                      <td>${escapeHtml(formatDuration(r.minutes))}</td>
                      <td>${money(r.amount_cents)}</td>
                      <td>${Number(r.entry_count || 0)}</td>
                    </tr>`).join('') || '<tr><td colspan="7" class="muted">No time entries in this range</td></tr>'}
                </tbody>
              </table></div>`;
          } else {
            const entries = (data.timekeepers || []).flatMap((g) => g.entries || []);
            out.innerHTML = `
              <h3 style="margin:0 0 .35rem;font-family:var(--font)">Lodestar Detail</h3>
              ${totalsUnderLabel}
              ${matterLine}
              <div class="table-wrap"><table>
                <thead><tr><th>Date</th><th>Timekeeper</th><th>Role</th><th>Hours</th><th>Rate</th><th>Amount</th><th>Billable</th><th>Description</th></tr></thead>
                <tbody>
                  ${entries.map((e) => `
                    <tr>
                      <td>${escapeHtml(e.service_date || '')}</td>
                      <td>${escapeHtml(e.timekeeper || '')}</td>
                      <td>${escapeHtml(e.role || '')}</td>
                      <td>${escapeHtml(formatDuration(e.minutes))}</td>
                      <td>${money(e.rate_cents)}</td>
                      <td>${money(e.amount_cents)}</td>
                      <td>${e.billable ? 'Yes' : '<span class="muted">No</span>'}</td>
                      <td>${escapeHtml(e.description || '')}</td>
                    </tr>`).join('') || '<tr><td colspan="8" class="muted">No time entries in this range</td></tr>'}
                </tbody>
              </table></div>`;
          }
          if (msg) msg.innerHTML = '';
        } catch (e) {
          if (out) {
            out.hidden = false;
            out.innerHTML = `<div class="error">${escapeHtml(e.message || 'Could not load Lodestar report')}</div>`;
          }
          if (msg) msg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };

      main.querySelectorAll('[data-bill-report]').forEach((btn) => {
        btn.onclick = () => runBillReport(btn.dataset.billReport, btn.dataset.billReportFormat || null);
      });

      billForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const { matterId, dateFrom: from, dateTo: to } = billingQuery();
        if (!matterId) {
          billMatterPicker?.setInvalid(true);
          $('#billMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
          billMatterPicker?.focus();
          return;
        }
        try {
          const inv = await api('/api/invoices/bill', {
            method: 'POST',
            body: JSON.stringify({
              matterId,
              ...(from ? { dateFrom: from } : {}),
              ...(to ? { dateTo: to } : {}),
            }),
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
    main.querySelectorAll('[data-invoice-delete]').forEach((b) => {
      b.onclick = () => {
        const id = Number(b.getAttribute('data-invoice-delete'));
        const number = b.getAttribute('data-invoice-number') || '';
        deleteInvoiceFromLedger(id, number);
      };
    });
  }

  async function deleteInvoiceFromLedger(id, number) {
    const invoiceId = Number(id);
    if (!Number.isFinite(invoiceId) || invoiceId <= 0) {
      const msg = $('#billMsg') || $('#invMsg');
      if (msg) msg.innerHTML = '<div class="error">Could not determine which bill to delete.</div>';
      return;
    }
    const label = number || `bill #${invoiceId}`;
    const ok = await confirmAction({
      title: 'Delete bill?',
      message: `Delete ${label} from the ledger? Time entries return to unbilled. Payment applications on this bill are removed.`,
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    try {
      // Prefer POST /delete — some previews/proxies mishandle HTTP DELETE.
      await api(`/api/invoices/${invoiceId}/delete`, {
        method: 'POST',
        body: '{}',
        headers: { 'X-No-Cache': '1' },
      });
      const detail = $('#invoiceDetail');
      if (detail && Number(detail.dataset.invoiceId) === invoiceId) {
        detail.innerHTML = '';
        delete detail.dataset.invoiceId;
      }
      await renderBilling();
      const msg = $('#billMsg');
      if (msg) msg.innerHTML = `<div class="ok-banner">Deleted ${escapeHtml(label)}.</div>`;
    } catch (e) {
      const msg = $('#billMsg') || $('#invMsg');
      const text = /not found/i.test(String(e.message || ''))
        ? 'Bill not found — it may already be deleted. Refreshing the list.'
        : e.message;
      if (msg) msg.innerHTML = `<div class="error">${escapeHtml(text)}</div>`;
      try { await renderBilling(); } catch { /* ignore */ }
    }
  }

  async function showInvoice(id) {
    const inv = await api(`/api/invoices/${id}`);
    const el = $('#invoiceDetail');
    if (!el) return;
    el.dataset.invoiceId = String(id);
    const canBill = ['admin', 'billing_clerk'].includes(state.user.role);
    const fieldConfig = inv.fieldConfig || {};
    const lineKeys = (fieldConfig.lineKeys && fieldConfig.lineKeys.length)
      ? fieldConfig.lineKeys
      : ['service_date', 'timekeeper', 'hours', 'rate', 'amount'];
    const lineLabels = Object.fromEntries(
      [...(fieldConfig.enabledLines || [])].map((f) => [f.key, f.label])
    );
    el.innerHTML = `
      <div class="card stack">
        <h2>${escapeHtml(inv.number)}
          <span class="pill" data-status="${escapeHtml(inv.status)}">${escapeHtml(invoiceStageLabel(inv.status))}</span>
        </h2>
        ${billHeaderMetaHtml(inv, fieldConfig)}
        <div class="table-wrap"><table>
          <thead><tr>${lineKeys.map((k) => `<th>${escapeHtml(lineLabels[k] || k)}</th>`).join('')}</tr></thead>
          <tbody>
            ${(inv.lines || []).map((l) => `
              <tr>
                ${lineKeys.map((k) => billLineCellHtml(l, k)).join('')}
              </tr>`).join('') || `<tr><td colspan="${Math.max(lineKeys.length, 1)}" class="muted">No lines</td></tr>`}
          </tbody>
        </table></div>
        <div class="row-actions" style="flex-wrap:wrap;gap:.5rem">
          <button type="button" class="primary" data-export-invoice="pdf">Download PDF</button>
          <button type="button" data-export-invoice="xlsx">Download Excel</button>
          <button type="button" data-export-invoice="template">Download with template</button>
        </div>
        <p class="hint">“Download with template” uses your default Word/Adobe invoice template from Settings (merge fields).</p>
        <div class="row-actions" id="invActions"></div>
        <div id="invMsg"></div>
      </div>`;

    el.querySelectorAll('[data-export-invoice]').forEach((b) => {
      b.onclick = async () => {
        try {
          const fmt = b.dataset.exportInvoice;
          const qs = fmt === 'template' ? 'format=docx&useTemplate=1' : `format=${fmt}`;
          const res = await api(`/api/invoices/${id}/export?${qs}`);
          const blob = await res.blob();
          const tmp = document.createElement('a');
          tmp.href = URL.createObjectURL(blob);
          const ext = fmt === 'xlsx' ? 'xlsx' : (fmt === 'template' ? 'docx' : 'pdf');
          // Template may be pdf/docx — prefer server filename when present.
          const dispo = res.headers?.get?.('content-disposition') || '';
          const match = /filename="([^"]+)"/i.exec(dispo);
          tmp.download = match?.[1] || `${inv.number || `invoice-${id}`}.${ext}`;
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
    if (canBill && actions) {
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = 'Delete from ledger';
      del.className = 'danger';
      del.onclick = () => deleteInvoiceFromLedger(id, inv.number);
      actions.appendChild(del);
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
        <div class="table-wrap report-table-wrap"><table class="report-table">
          <thead><tr>${cols.map((c) => reportCellTag('th', label(c))).join('')}</tr></thead>
          <tbody>
            ${(rows || []).map((r) => `
              <tr>${cols.map((c) => reportCellTag('td', fmtCell(c, r[c]))).join('')}</tr>
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
        <div class="table-wrap report-table-wrap"><table class="report-table">
          <thead><tr>${reportCellTag('th', report.groupByLabel || 'Group')}${reportCellTag('th', valueLabel || 'Value')}${reportCellTag('th', 'Count')}</tr></thead>
          <tbody>
            ${(rows || []).map((r) => `
              <tr>
                ${reportCellTag('td', r.label)}
                ${reportCellTag('td', formatReportValue(metric, r.value, r))}
                ${reportCellTag('td', r.count)}
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
    if (!stillOnView('dashboard')) return;
    const widgets = data.widgets || [];
    const available = data.available || { firm: [], custom: [] };
    const canEdit = roleCanModify('report');
    const addOptions = [
      ...(available.firm || []).map((r) =>
        `<option value="firm:${escapeHtml(r.id)}">${escapeHtml(r.name)}</option>`),
      ...(available.custom || []).map((r) =>
        `<option value="custom:${r.id}">${escapeHtml(r.name)} (custom)</option>`),
    ].join('');

    const widgetMeta = (w) => {
      if (w.kind === 'firm') return 'Firm report';
      return `${w.report.groupByLabel || ''} · ${w.valueLabel || ''} · ${
        w.report.source === 'time_entry' ? 'Time' : 'Matters'
      }`;
    };

    setMainHtml(`
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
        </div>`}`);

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
    const includeDisabledFirm = roleCanModify('report') || roleCanDelete('report');
    const [customReportList, recordTypes, timeFields, firmReportList] = await Promise.all([
      api('/api/custom-reports').catch(() => []),
      api('/api/record-types').catch(() => []),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
      api(`/api/firm-reports${includeDisabledFirm ? '?includeDisabled=1' : ''}`).catch(() => []),
    ]);
    if (!stillOnView('reports')) return;
    const matterFieldLists = await Promise.all(
      (recordTypes || []).map((t) =>
        api(`/api/custom-fields?appliesTo=matter&type=${encodeURIComponent(t.key)}`).catch(() => []))
    );
    if (!stillOnView('reports')) return;
    const matterFields = matterFieldLists.flat()
      .filter((f, i, arr) => arr.findIndex((x) => Number(x.id) === Number(f.id)) === i);
    const canEditReports = roleCanModify('report');
    const canDeleteReports = roleCanDelete('report');
    const editingReportId = state.editingCustomReportId
      ? Number(state.editingCustomReportId)
      : null;
    const editingReport = editingReportId
      ? (customReportList || []).find((r) => Number(r.id) === editingReportId)
      : null;
    const firmReports = (firmReportList || []).length
      ? firmReportList
      : [
        { id: 'matters', name: 'Matters', disabled: false },
        { id: 'lodestar-summary', name: 'Lodestar Summary (all matters)', disabled: false },
        { id: 'lodestar-detail', name: 'Lodestar Detail (all matters)', disabled: false },
      ];
    const fieldOptions = (fields, selectedId = null) => (fields || []).map((f) =>
      `<option value="${f.id}" ${Number(f.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
    ).join('');
    const reportFormHtml = ({
      formId,
      submitLabel,
      report = null,
      sourceSelectId,
      fieldSelectId,
      metricSelectId,
    }) => {
      const source = report?.source || 'time_entry';
      const fields = source === 'matter' ? matterFields : timeFields;
      return `
        <form id="${formId}" class="grid two">
          <label>Report name
            <input name="name" required placeholder="e.g. Hours by case stage"
              value="${escapeHtml(report?.name || '')}" />
          </label>
          <label>Source
            <select name="source" id="${sourceSelectId}">
              <option value="time_entry" ${source === 'time_entry' ? 'selected' : ''}>Time entries</option>
              <option value="matter" ${source === 'matter' ? 'selected' : ''}>Matters</option>
            </select>
          </label>
          <label>Group by custom field
            <select name="groupByFieldId" id="${fieldSelectId}" required>
              ${fieldOptions(fields, report?.group_by_field_id)
                || '<option value="">No custom fields for this source</option>'}
            </select>
          </label>
          <label>Metric
            <select name="metric" id="${metricSelectId}">
              <option value="hours" ${!report || report?.metric === 'hours' ? 'selected' : ''}>Hours</option>
              <option value="amount" ${report?.metric === 'amount' ? 'selected' : ''}>Amount</option>
              <option value="count" ${report?.metric === 'count' ? 'selected' : ''}>Count</option>
            </select>
          </label>
          <label>Report type
            <select name="chartType">
              <option value="bar" ${!report || report?.chart_type === 'bar' ? 'selected' : ''}>Bar</option>
              <option value="pie" ${report?.chart_type === 'pie' ? 'selected' : ''}>Pie</option>
              <option value="table" ${report?.chart_type === 'table' ? 'selected' : ''}>Table only</option>
              <option value="xlsx" ${report?.chart_type === 'xlsx' ? 'selected' : ''}>Excel (xlsx)</option>
            </select>
          </label>
          <label class="check-inline">
            <input type="checkbox" name="showOnDashboard"
              ${!report || report?.show_on_dashboard ? 'checked' : ''} />
            Show on dashboard
          </label>
          <label class="span-all">Description
            <input name="description" placeholder="Optional"
              value="${escapeHtml(report?.description || '')}" />
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">${escapeHtml(submitLabel)}</button>
            ${report ? '<button type="button" data-cancel-edit-report>Cancel</button>' : ''}
          </div>
        </form>`;
    };
    setMainHtml(`
      <div class="card stack">
        <h1>Reports</h1>
        <p class="lead">Run firm Lodestar reports, or build custom reports from custom fields for the Dashboard.</p>

        <h2>Custom reports</h2>
        <p class="hint">Group matters or time by a custom field, then pin the result to the Dashboard.</p>
        ${canEditReports ? `
        ${editingReport ? `
          <h3>Edit report</h3>
          ${reportFormHtml({
            formId: 'customReportEditForm',
            submitLabel: 'Save report',
            report: editingReport,
            sourceSelectId: 'crEditSource',
            fieldSelectId: 'crEditField',
            metricSelectId: 'crEditMetric',
          })}
        ` : reportFormHtml({
          formId: 'customReportForm',
          submitLabel: 'Create report',
          sourceSelectId: 'crSource',
          fieldSelectId: 'crField',
          metricSelectId: 'crMetric',
        })}
        <div id="customReportMsg"></div>` : '<p class="muted">Your role can view reports but not create or edit them.</p>'}
        <div class="stack" id="customReportList">
          ${(customReportList || []).map((r) => `
            <div class="report-row" data-custom-report="${r.id}">
              <div>
                <strong>${escapeHtml(r.name)}</strong>
                <div class="muted">${escapeHtml(r.group_by_label)} · ${escapeHtml(r.metric)}
                  · ${escapeHtml(r.source === 'time_entry' ? 'Time' : 'Matters')}
                  · ${escapeHtml(r.chart_type === 'xlsx' ? 'Excel' : r.chart_type || 'table')}
                  ${r.show_on_dashboard ? ' · Dashboard' : ''}</div>
              </div>
              <div class="row-actions">
                <button type="button" data-run-custom="${r.id}">View</button>
                ${r.chart_type === 'xlsx'
                  ? `<a class="btn" href="/api/custom-reports/${r.id}/export?format=xlsx">Excel</a>`
                  : ''}
                ${canEditReports ? `<button type="button" data-edit-custom="${r.id}">Edit</button>` : ''}
                ${canDeleteReports ? `<button type="button" data-del-custom="${r.id}">Delete</button>` : ''}
              </div>
            </div>`).join('') || '<p class="muted">No custom reports yet.</p>'}
        </div>
        <div id="customReportOut" hidden></div>
      </div>

      <div class="card">
        <h2>Firm reports</h2>
        <p class="hint">Pin these to the Dashboard from the Dashboard page to include them in dashboard exports.
          ${canDeleteReports ? ' Delete removes a firm report from this firm (it can be restored later).' : ''}</p>
        <div id="firmReportMsg"></div>
        <div>
          ${firmReports.map((r) => {
            const id = r.id;
            const label = r.name || id;
            const disabled = !!r.disabled;
            if (disabled) {
              return `
            <div class="report-row is-disabled" data-firm-report-row="${escapeHtml(id)}">
              <div>
                <strong>${escapeHtml(label)}</strong>
                <div class="muted">Removed from firm</div>
              </div>
              ${canEditReports || canDeleteReports
                ? `<button type="button" data-restore-firm="${escapeHtml(id)}">Restore</button>`
                : '<span class="muted">—</span>'}
            </div>`;
            }
            return `
            <div class="report-row" data-firm-report-row="${escapeHtml(id)}">
              <strong>${escapeHtml(label)}</strong>
              <div class="row-actions">
                <button type="button" data-view-report="${escapeHtml(id)}">View</button>
                <a class="btn" href="/api/reports/${encodeURIComponent(id)}?format=pdf">PDF</a>
                <a class="btn" href="/api/reports/${encodeURIComponent(id)}?format=csv" target="_blank">CSV</a>
                <a class="btn" href="/api/reports/${encodeURIComponent(id)}?format=xlsx">Excel</a>
                ${canDeleteReports
                  ? `<button type="button" data-del-firm="${escapeHtml(id)}">Delete</button>`
                  : ''}
              </div>
            </div>`;
          }).join('') || '<p class="muted">No firm reports available.</p>'}
        </div>
      </div>
      <div id="reportOut" class="card" hidden></div>`);

    const wireReportSourceFields = (sourceEl, fieldEl, metricEl, preferredFieldId = null) => {
      if (!sourceEl || !fieldEl) return;
      const sync = () => {
        const source = sourceEl.value;
        const fields = source === 'matter' ? matterFields : timeFields;
        fieldEl.innerHTML = fields.length
          ? fields.map((f) =>
            `<option value="${f.id}" ${Number(f.id) === Number(preferredFieldId) ? 'selected' : ''}>${escapeHtml(f.label)}</option>`
          ).join('')
          : '<option value="">No custom fields for this source</option>';
        if (metricEl) {
          [...metricEl.options].forEach((opt) => {
            opt.hidden = source === 'matter' && opt.value !== 'count';
          });
          if (source === 'matter') metricEl.value = 'count';
        }
      };
      sourceEl.onchange = sync;
      sync();
    };
    wireReportSourceFields($('#crSource'), $('#crField'), $('#crMetric'));
    wireReportSourceFields(
      $('#crEditSource'),
      $('#crEditField'),
      $('#crEditMetric'),
      editingReport?.group_by_field_id
    );

    const reportBodyFromForm = (form) => {
      const fd = new FormData(form);
      return {
        name: fd.get('name'),
        description: fd.get('description'),
        source: fd.get('source'),
        groupByFieldId: Number(fd.get('groupByFieldId')),
        metric: fd.get('metric'),
        chartType: fd.get('chartType'),
        showOnDashboard: fd.get('showOnDashboard') === 'on',
      };
    };

    const customForm = $('#customReportForm');
    if (customForm) {
      customForm.onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          await api('/api/custom-reports', {
            method: 'POST',
            body: JSON.stringify(reportBodyFromForm(customForm)),
          });
          state.editingCustomReportId = null;
          $('#customReportMsg').innerHTML = '<div class="ok-banner">Custom report created.</div>';
          await renderReports();
        } catch (e) {
          $('#customReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const editForm = $('#customReportEditForm');
    if (editForm && editingReportId) {
      editForm.onsubmit = async (ev) => {
        ev.preventDefault();
        try {
          await api(`/api/custom-reports/${editingReportId}`, {
            method: 'PATCH',
            body: JSON.stringify(reportBodyFromForm(editForm)),
          });
          state.editingCustomReportId = null;
          $('#customReportMsg').innerHTML = '<div class="ok-banner">Report updated.</div>';
          await renderReports();
        } catch (e) {
          $('#customReportMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }
    main.querySelectorAll('[data-cancel-edit-report]').forEach((btn) => {
      btn.onclick = async () => {
        state.editingCustomReportId = null;
        await renderReports();
      };
    });

    const showCustomRun = async (id) => {
      try {
        const payload = await api(`/api/custom-reports/${id}/run`);
        const out = $('#customReportOut');
        out.hidden = false;
        const isXlsx = payload.report?.chartType === 'xlsx';
        out.innerHTML = `
          <div class="row-actions" style="justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:.75rem">
            <div>
              <h2>${escapeHtml(payload.report.name)}</h2>
              <p class="muted">${escapeHtml(payload.report.description || '')}</p>
            </div>
            ${isXlsx ? `<a class="btn primary" href="/api/custom-reports/${id}/export?format=xlsx">Download Excel</a>` : ''}
          </div>
          ${renderReportResult(payload)}`;
        out.querySelectorAll('a.btn').forEach((a) => {
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
              out.insertAdjacentHTML('afterbegin', `<div class="error">${escapeHtml(message)}</div>`);
              return;
            }
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const tmp = document.createElement('a');
            tmp.href = url;
            tmp.download = `${payload.report.name || 'report'}.xlsx`;
            tmp.click();
            URL.revokeObjectURL(url);
          };
        });
        out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        const msg = $('#customReportMsg');
        if (msg) msg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
      }
    };

    main.querySelectorAll('[data-run-custom]').forEach((b) => {
      b.onclick = () => showCustomRun(Number(b.dataset.runCustom));
    });
    main.querySelectorAll('[data-edit-custom]').forEach((b) => {
      b.onclick = async () => {
        state.editingCustomReportId = Number(b.dataset.editCustom);
        await renderReports();
        const form = $('#customReportEditForm');
        if (form && form.scrollIntoView) form.scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
    main.querySelectorAll('[data-del-custom]').forEach((b) => {
      b.onclick = async () => {
        const id = Number(b.dataset.delCustom);
        const row = (customReportList || []).find((r) => Number(r.id) === id);
        const sure = await confirmAction({
          title: 'Delete this report?',
          message: row?.name
            ? `Delete “${row.name}”? It will be removed from Reports and the Dashboard.`
            : 'Delete this custom report? It will be removed from Reports and the Dashboard.',
          confirmLabel: 'Yes, delete report',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/custom-reports/${id}`, { method: 'DELETE' });
          if (Number(state.editingCustomReportId) === id) state.editingCustomReportId = null;
          await renderReports();
        } catch (e) {
          const msg = $('#customReportMsg');
          if (msg) msg.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
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
        const firmMatch = href.match(/\/api\/reports\/([^/?]+)/);
        const customMatch = href.match(/\/api\/custom-reports\/(\d+)\/export/);
        const customMeta = customMatch
          ? (customReportList || []).find((r) => Number(r.id) === Number(customMatch[1]))
          : null;
        tmp.download = `${customMeta?.name || firmMatch?.[1] || 'report'}.${ext}`;
        tmp.click();
        URL.revokeObjectURL(url);
      };
    });

    const showFirmReport = async (reportId) => {
      const rows = await api(`/api/reports/${reportId}`);
      const out = $('#reportOut');
      out.hidden = false;
      const title = firmReports.find((r) => r.id === reportId)?.name || reportId;
      const columns = rows.length ? Object.keys(rows[0]) : [];
      out.innerHTML = `
        <h2>${escapeHtml(title)}</h2>
        ${renderFirmTable({ rows, columns })}`;
      out.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };

    main.querySelectorAll('[data-view-report]').forEach((b) => {
      b.onclick = () => showFirmReport(b.dataset.viewReport);
    });

    const firmMsg = (html) => {
      const el = $('#firmReportMsg');
      if (el) el.innerHTML = html || '';
    };
    main.querySelectorAll('[data-del-firm]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.delFirm;
        const meta = firmReports.find((r) => String(r.id) === String(id));
        const sure = await confirmAction({
          title: 'Delete this firm report?',
          message: meta?.name
            ? `Remove “${meta.name}” from this firm’s Reports list and Dashboard? You can restore it later.`
            : 'Remove this firm report from Reports and the Dashboard? You can restore it later.',
          confirmLabel: 'Yes, delete report',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/firm-reports/${encodeURIComponent(id)}`, { method: 'DELETE' });
          await renderReports();
        } catch (e) {
          firmMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });
    main.querySelectorAll('[data-restore-firm]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/firm-reports/${encodeURIComponent(b.dataset.restoreFirm)}/restore`, {
            method: 'POST',
            body: JSON.stringify({}),
          });
          await renderReports();
        } catch (e) {
          firmMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });

    if (state.focusFirmReportId) {
      const firmId = state.focusFirmReportId;
      state.focusFirmReportId = null;
      showFirmReport(firmId);
    }
  }

  function wireChoiceGroup(root, name) {
    if (!root) return;
    const rows = [...root.querySelectorAll(`.choice[data-name="${name}"]`)];
    const sync = () => {
      rows.forEach((row) => {
        const input = row.querySelector('input');
        if (!input) return;
        row.classList.toggle('is-selected', !!input.checked);
      });
    };
    rows.forEach((row) => {
      row.addEventListener('click', (ev) => {
        ev.preventDefault();
        if (row.dataset.disabled === '1') return;
        const input = row.querySelector('input');
        if (!input) return;
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

  async function bindMatterNameFormulaEditor({ bodyEl, config, recordTypes = [] } = {}) {
    if (!bodyEl) return;
    let draft = {
      enabled: !!config?.enabled,
      separator: config?.separator != null && String(config.separator).length
        ? String(config.separator)
        : '-',
      appendStatusYear: !!config?.appendStatusYear,
      parts: Array.isArray(config?.parts)
        ? config.parts.map((p) => ({ ...p }))
        : [],
    };
    const availableFields = Array.isArray(config?.availableFields) ? config.availableFields : [];
    const types = Array.isArray(recordTypes) && recordTypes.length
      ? recordTypes
      : [
        { key: 'billable', label: 'Billable' },
        { key: 'non_billable', label: 'Non-Billable' },
        { key: 'do_not_charge', label: 'Do not charge' },
      ];
    let addRecordTypeKey = state.settingsMatterRecordTypeKey || types[0]?.key || 'billable';

    const previewText = () => {
      if (!draft.parts.length) return 'Ticker-Year-Company Name-Case Type';
      return draft.parts.map((p) => p.label || (p.kind === 'token' ? 'Year' : `Field ${p.fieldId}`))
        .join(draft.separator || '-');
    };

    const usedFieldIds = () => new Set(
      draft.parts.filter((p) => p.kind === 'custom_field').map((p) => Number(p.fieldId))
    );

    const render = () => {
      const used = usedFieldIds();
      const addable = availableFields.filter((f) => !used.has(Number(f.id)));
      bodyEl.innerHTML = `
        <p class="hint">Build Create Matter names by concatenating custom fields (and Year), for example
          <strong>Ticker-Year-Company Name-Case Type</strong>. Those fields appear on Create Matter and the name is filled automatically.</p>
        <label class="check-inline">
          <input type="checkbox" id="mnfEnabled" ${draft.enabled ? 'checked' : ''} />
          Use formula when creating matters
        </label>
        <div class="grid two">
          <label>Separator
            <input id="mnfSeparator" type="text" maxlength="8" value="${escapeHtml(draft.separator)}"
              placeholder="-" ${draft.enabled ? '' : 'disabled'} />
          </label>
          <label class="check-inline" style="align-self:end">
            <input type="checkbox" id="mnfAppendStatusYear" ${draft.appendStatusYear ? 'checked' : ''}
              ${draft.enabled ? '' : 'disabled'} />
            Also append Status and Year (legacy)
          </label>
        </div>
        <div class="stack">
          <h3 style="margin:0;font-family:var(--font);font-size:1rem">Name parts (in order)</h3>
          <p class="muted" id="mnfPreview">Preview: ${escapeHtml(previewText())}</p>
          <div class="field-mgmt-list" id="mnfParts">
            ${draft.parts.map((p, i) => `
              <div class="field-mgmt-row" data-part="${i}">
                <div>
                  <strong>${escapeHtml(p.label || (p.kind === 'token' ? 'Year' : `Field ${p.fieldId}`))}</strong>
                  <span class="muted"> · ${p.kind === 'token' ? 'Year (opened year)' : 'Custom field'}</span>
                </div>
                <div class="row-actions">
                  <button type="button" data-mnf-up="${i}" ${i === 0 ? 'disabled' : ''}>Up</button>
                  <button type="button" data-mnf-down="${i}" ${i === draft.parts.length - 1 ? 'disabled' : ''}>Down</button>
                  <button type="button" data-mnf-remove="${i}">Remove</button>
                </div>
              </div>`).join('') || '<p class="muted">No parts yet — add fields below.</p>'}
          </div>
        </div>
        <div class="row-actions" style="flex-wrap:wrap;gap:.5rem;align-items:end">
          <label style="margin:0;min-width:12rem">Add existing field
            <select id="mnfAddField" ${draft.enabled ? '' : 'disabled'}>
              ${addable.length
                ? addable.map((f) => `
                  <option value="${f.id}">${escapeHtml(f.label)}</option>`).join('')
                : '<option value="">No more fields available</option>'}
            </select>
          </label>
          <button type="button" id="mnfAddFieldBtn" ${draft.enabled && addable.length ? '' : 'disabled'}>Add field</button>
          <button type="button" id="mnfAddYearBtn" ${draft.enabled ? '' : 'disabled'}>Add Year</button>
        </div>
        <div class="stack" style="margin-top:.5rem">
          <h3 style="margin:0;font-family:var(--font);font-size:1rem">Create a field for the formula</h3>
          <p class="hint">Creates a record-type field (shown on Create Matter) and adds it to the formula.</p>
          <label class="matter-type-picker">Record type for new field
            <select id="mnfNewFieldType" ${draft.enabled ? '' : 'disabled'}>
              ${types.map((t) => `
                <option value="${escapeHtml(t.key)}" ${t.key === addRecordTypeKey ? 'selected' : ''}>
                  ${escapeHtml(t.label || t.key)}
                </option>`).join('')}
            </select>
          </label>
          ${customFieldFormHtml({
            formId: 'mnfNewFieldForm',
            submitLabel: 'Create field & add to formula',
            defaultLabel: 'Show on create (default field)',
            requiredLabel: 'Required on create',
            appliesTo: 'matter',
            formHint: 'New fields are added to the selected record type and included in the name formula.',
          })}
        </div>
        <div class="row-actions">
          <button class="primary" type="button" id="mnfSaveBtn">Save matter name formula</button>
        </div>
        <div id="mnfMsg"></div>`;

      const enabledEl = $('#mnfEnabled');
      const sepEl = $('#mnfSeparator');
      const appendEl = $('#mnfAppendStatusYear');
      if (enabledEl) {
        enabledEl.onchange = () => {
          draft.enabled = enabledEl.checked;
          render();
        };
      }
      if (sepEl) {
        sepEl.oninput = () => {
          draft.separator = sepEl.value;
          const prev = $('#mnfPreview');
          if (prev) prev.textContent = `Preview: ${previewText()}`;
        };
      }
      if (appendEl) {
        appendEl.onchange = () => {
          draft.appendStatusYear = appendEl.checked;
        };
      }

      bodyEl.querySelectorAll('[data-mnf-up]').forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.dataset.mnfUp);
          if (i <= 0) return;
          const tmp = draft.parts[i - 1];
          draft.parts[i - 1] = draft.parts[i];
          draft.parts[i] = tmp;
          render();
        };
      });
      bodyEl.querySelectorAll('[data-mnf-down]').forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.dataset.mnfDown);
          if (i >= draft.parts.length - 1) return;
          const tmp = draft.parts[i + 1];
          draft.parts[i + 1] = draft.parts[i];
          draft.parts[i] = tmp;
          render();
        };
      });
      bodyEl.querySelectorAll('[data-mnf-remove]').forEach((btn) => {
        btn.onclick = () => {
          const i = Number(btn.dataset.mnfRemove);
          draft.parts.splice(i, 1);
          render();
        };
      });

      const addFieldBtn = $('#mnfAddFieldBtn');
      if (addFieldBtn) {
        addFieldBtn.onclick = () => {
          const sel = $('#mnfAddField');
          const id = Number(sel?.value);
          if (!Number.isFinite(id)) return;
          const field = availableFields.find((f) => Number(f.id) === id);
          if (!field) return;
          draft.parts.push({
            kind: 'custom_field',
            fieldId: id,
            label: field.label,
            field,
          });
          render();
        };
      }
      const addYearBtn = $('#mnfAddYearBtn');
      if (addYearBtn) {
        addYearBtn.onclick = () => {
          draft.parts.push({ kind: 'token', token: 'opened_year', label: 'Year' });
          render();
        };
      }

      const typeSel = $('#mnfNewFieldType');
      if (typeSel) {
        typeSel.onchange = () => {
          addRecordTypeKey = typeSel.value || 'billable';
          state.settingsMatterRecordTypeKey = addRecordTypeKey;
        };
      }

      const newFieldForm = $('#mnfNewFieldForm');
      wireDropdownOptionsToggle(newFieldForm);
      if (newFieldForm) {
        // Prefill required + default for formula fields
        const req = newFieldForm.querySelector('input[name="required"]');
        const def = newFieldForm.querySelector('input[name="isDefault"]');
        if (req) req.checked = true;
        if (def) def.checked = true;
        newFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(newFieldForm);
          const { fieldType, options, body } = customFieldPayload(fd);
          if ((fieldType === 'dropdown' || fieldType === 'select' || fieldType === 'multiselect') && !options.length) {
            $('#mnfMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
            return;
          }
          try {
            const typeKey = $('#mnfNewFieldType')?.value || addRecordTypeKey || 'billable';
            const created = await api('/api/custom-fields', {
              method: 'POST',
              body: JSON.stringify({
                ...body,
                required: true,
                isDefault: true,
                recordTypeKey: typeKey,
                appliesTo: 'matter',
              }),
            });
            draft.enabled = true;
            draft.parts.push({
              kind: 'custom_field',
              fieldId: created.id,
              label: created.label,
              field: {
                id: created.id,
                label: created.label,
                fieldType: created.field_type || created.fieldType,
                recordTypeKey: created.record_type_key || typeKey,
                required: true,
                isDefault: true,
              },
            });
            availableFields.push({
              id: created.id,
              label: created.label,
              fieldType: created.field_type || created.fieldType,
              recordTypeKey: created.record_type_key || typeKey,
              required: true,
              isDefault: true,
            });
            const saved = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({
                matterNameFormula: {
                  enabled: draft.enabled,
                  separator: draft.separator,
                  appendStatusYear: draft.appendStatusYear,
                  parts: draft.parts.map((p) => (p.kind === 'token'
                    ? { kind: 'token', token: p.token }
                    : { kind: 'custom_field', fieldId: p.fieldId })),
                },
              }),
            });
            state.settings = saved;
            $('#mnfMsg').innerHTML = `<div class="ok-banner">Created “${escapeHtml(created.label)}” and saved the formula.</div>`;
            await renderSettings();
            const card = $('#matterNameFormulaCard');
            if (card) card.open = true;
          } catch (e) {
            $('#mnfMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          }
        };
      }

      const saveBtn = $('#mnfSaveBtn');
      if (saveBtn) {
        saveBtn.onclick = async () => {
          try {
            const saved = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({
                matterNameFormula: {
                  enabled: draft.enabled,
                  separator: draft.separator,
                  appendStatusYear: draft.appendStatusYear,
                  parts: draft.parts.map((p) => (p.kind === 'token'
                    ? { kind: 'token', token: p.token }
                    : { kind: 'custom_field', fieldId: p.fieldId })),
                },
              }),
            });
            state.settings = saved;
            draft = {
              enabled: !!saved.matterNameFormula?.enabled,
              separator: saved.matterNameFormula?.separator || '-',
              appendStatusYear: !!saved.matterNameFormula?.appendStatusYear,
              parts: Array.isArray(saved.matterNameFormula?.parts)
                ? saved.matterNameFormula.parts.map((p) => ({ ...p }))
                : [],
            };
            $('#mnfMsg').innerHTML = '<div class="ok-banner">Matter name formula saved.</div>';
            await renderSettings();
            const card = $('#matterNameFormulaCard');
            if (card) card.open = true;
          } catch (e) {
            $('#mnfMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          }
        };
      };
    };

    render();
  }

  function timekeeperRatesTableHtml(timekeepers, { today, showReset = false } = {}) {
    const cols = showReset ? 6 : 5;
    return `
      <form id="tkSearch" class="matter-search-bar" role="search">
        <input name="q" value="${escapeHtml(state.tkSearch.q || '')}"
          placeholder="Search by timekeeper…" aria-label="Search by timekeeper"
          autocomplete="off" />
        <button type="button" id="clearTkSearch">Clear</button>
      </form>
      <div class="table-wrap"><table>
        <thead>
          <tr><th>Timekeeper</th><th>Role</th><th>Current rate</th><th>Effective</th><th>Add rate change</th>${
            showReset ? '<th></th>' : ''
          }</tr>
        </thead>
        <tbody id="tkRatesBody">
          ${(timekeepers || []).map((t) => {
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
                  <input name="effectiveDate" type="date" value="${escapeHtml(today)}" required />
                  <button type="submit">Add</button>
                </form>
                <details class="hint" style="margin-top:.4rem">
                  <summary>Rate history (${t.rates.length})</summary>
                  <ul>
                    ${t.rates.map((r) => `<li>${escapeHtml(r.effective_date)}: ${money(r.amount_cents)}/hr</li>`).join('') || '<li>None</li>'}
                  </ul>
                </details>
              </td>
              ${showReset ? `
              <td>
                <button type="button" data-send-reset="${t.id}">Create reset link</button>
              </td>` : ''}
            </tr>`;
          }).join('') || `<tr data-tk-empty="1"><td colspan="${cols}" class="muted">No timekeepers</td></tr>`}
          <tr data-tk-none hidden><td colspan="${cols}" class="muted">No timekeepers match your search</td></tr>
        </tbody>
      </table></div>
      <div id="rateMsg"></div>`;
  }

  function wireTimekeeperRatesPanel({ onRefresh } = {}) {
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
        if (section && 'open' in section && needle) section.open = true;
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

    main.querySelectorAll('[data-send-reset]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          btn.disabled = true;
          const result = await api(`/api/users/${btn.dataset.sendReset}/send-reset`, {
            method: 'POST',
            body: '{}',
          });
          const delivered = result.delivery?.ok === true;
          const deferred = result.delivery?.mode === 'deferred';
          const mode = delivered
            ? 'Password reset email sent.'
            : (deferred
              ? 'Reset link created. Share it with the user (email delivery is deferred until go-live).'
              : (result.warning || 'Reset link created. Share it with the user.'));
          const link = localAuthLink(result.devToken) || result.devLink || '';
          $('#rateMsg').innerHTML = `<div class="ok-banner">${escapeHtml(mode)}${
            link ? `<div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open reset link</a> <span class="muted">(copy and share)</span></div>` : ''
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
          if (typeof onRefresh === 'function') await onRefresh();
        } catch (e) {
          $('#rateMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    });
  }

  async function renderUsers() {
    if (!canManageUsers()) {
      setMainHtml(`<div class="card"><div class="error">You don’t have permission to add users. Ask an admin to invite someone, or grant <strong>Add users</strong> under Settings → Role permissions.</div></div>`);
      return;
    }
    const showRates = canManageRates();
    const timekeepers = showRates
      ? await api('/api/timekeepers').catch(() => [])
      : [];
    if (!stillOnView('users')) return;
    const today = firmToday();
    const flash = state.usersFlash;
    state.usersFlash = null;

    setMainHtml(`
      <div class="card stack page-card">
        <div class="page-head">
          <h1>Users</h1>
        </div>
        <p class="lead">Invite people to the firm${showRates ? ' and manage timekeeper default rates' : ''}.</p>
        ${flash ? successNoticeHtml(flash) : ''}

        <div class="page-section" id="addUserSection">
          <h2>Add a user</h2>
          <p class="hint">Creates a one-time invite link to set a password and sign in. Share the link directly — email delivery waits until a live domain.</p>
          <form id="tkForm" class="grid two">
            <label>Name <input name="name" required placeholder="Alex Associate" /></label>
            <label>Email <input name="email" type="email" required placeholder="alex@firm.example" /></label>
            <label>Role
              <select name="role">
                ${(state.settings?.permissions?.roles || [
                  { key: 'attorney', label: 'Attorney' },
                  { key: 'paralegal', label: 'Paralegal' },
                  { key: 'billing_clerk', label: 'Billing Clerk' },
                  { key: 'admin', label: 'Admin' },
                ]).map((r) => `
                  <option value="${escapeHtml(r.key)}" ${r.key === 'attorney' ? 'selected' : ''}>
                    ${escapeHtml(formatRoleLabel(r))}
                  </option>`).join('')}
              </select>
            </label>
            <label>Default rate ($/hr)
              <input class="rate-dollars" name="defaultRate" type="text" inputmode="decimal" placeholder="350.00" required />
            </label>
            <label>Rate effective date
              <input name="rateEffectiveDate" type="date" value="${today}" required />
            </label>
            <div class="row-actions span-all" style="align-items:end">
              <button class="primary" type="submit">Create invite link</button>
            </div>
          </form>
          <div id="tkMsg"></div>
        </div>

        ${showRates ? `
        <div class="page-section" id="tkRatesSection">
          <h2>Timekeepers &amp; Rates</h2>
          <p class="hint">Default rates are timekeeper-scoped and effective-dated. Historical invoices keep snapshotted rates.</p>
          ${timekeeperRatesTableHtml(timekeepers, { today, showReset: isAdminUser() })}
        </div>` : ''}
      </div>`);

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
          const deferred = invited.delivery?.mode === 'deferred';
          const mode = delivered
            ? 'Invite email sent.'
            : (deferred
              ? 'Invite created. Share the link below (email delivery is deferred until go-live).'
              : (invited.warning || 'Invite created. Share the link below.'));
          await refreshRefs();
          state.tkSearch = { q: '' };
          const link = localAuthLink(invited.devToken) || invited.devLink || '';
          state.usersFlash = {
            title: 'Invite created',
            detail: mode,
          };
          await renderUsers();
          const msg = $('#tkMsg');
          if (msg && link) {
            msg.innerHTML = `<div class="ok-banner">${escapeHtml(mode)}
              <div style="margin-top:.5rem"><a href="${escapeHtml(link)}">Open invite link</a>
              <span class="muted">(copy and share)</span></div></div>`;
          }
          $('#addUserSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } catch (e) {
          $('#tkMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    if (showRates) {
      wireTimekeeperRatesPanel({
        onRefresh: async () => {
          state.usersFlash = { title: 'Rate change saved', detail: 'The new effective-dated rate is active.' };
          await renderUsers();
        },
      });
    }

    if (state.focusAddUser) {
      state.focusAddUser = false;
      setTimeout(() => {
        $('#tkForm input[name="name"]')?.focus();
        $('#addUserSection')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }, 0);
    }
  }

  function settingsTabOpen(tabKey, fallback = false) {
    if (!state.settingsTabOpen) state.settingsTabOpen = {};
    if (Object.prototype.hasOwnProperty.call(state.settingsTabOpen, tabKey)) {
      return Boolean(state.settingsTabOpen[tabKey]);
    }
    return fallback;
  }

  function settingsCollapseTab({
    id,
    tabKey,
    title,
    meta = '',
    open = false,
    bodyHtml = '',
  }) {
    return `
      <details class="onedrive-collapse settings-collapse settings-tab"
        id="${escapeHtml(id)}" data-settings-tab="${escapeHtml(tabKey)}"
        ${open ? 'open' : ''}>
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">${title}</span>
          ${meta ? `<span class="onedrive-collapse-meta muted">${meta}</span>` : ''}
        </summary>
        <div class="onedrive-collapse-body stack">
          ${bodyHtml}
        </div>
      </details>`;
  }

  function wireSettingsCollapseTabs(root = main) {
    if (!root) return;
    if (!state.settingsTabOpen) state.settingsTabOpen = {};
    root.querySelectorAll('details[data-settings-tab]').forEach((el) => {
      el.addEventListener('toggle', () => {
        const key = el.getAttribute('data-settings-tab');
        if (!key) return;
        state.settingsTabOpen[key] = el.open;
      });
    });
  }

  async function renderSettings() {
    const isAdmin = state.user.role === 'admin';
    const canEditBilling = isAdmin || state.user.role === 'billing_clerk';
    const canConfigureMatterDefaults = isAdmin;
    const canConfigureFields = isAdmin || state.user.role === 'billing_clerk';
    // Billing clerks manage rates here; admins use Navigate → Add a user.
    const showClerkRates = canManageRates() && !canManageUsers();
    const [settings, matterRecordTypesPrefetch, contactRecordTypesPrefetch, timekeepers, mfaStatus, invoiceTemplatePayload] = await Promise.all([
      api('/api/settings'),
      canConfigureMatterDefaults ? api('/api/record-types').catch(() => []) : Promise.resolve([]),
      canConfigureFields ? api('/api/record-types?appliesTo=client').catch(() => []) : Promise.resolve([]),
      showClerkRates ? api('/api/timekeepers').catch(() => []) : Promise.resolve([]),
      api('/api/mfa/status').catch(() => ({ enabled: false, backupCodesRemaining: 0 })),
      canEditBilling
        ? Promise.all([
          api('/api/invoice-templates').catch(() => ({ templates: [] })),
          api('/api/invoice-templates/merge-fields').catch(() => ({ fields: [] })),
        ]).then(([t, f]) => ({ templates: t.templates || [], fields: f.fields || [] }))
        : Promise.resolve({ templates: [], fields: [] }),
    ]);
    if (!stillOnView('settings')) return;
    state.settings = settings;
    const invoiceTemplatesList = invoiceTemplatePayload.templates || [];
    const mergeFields = invoiceTemplatePayload.fields || [];
    const today = firmToday(settings.firmTimezone || firmTimeZone());
    const selectedTz = settings.firmTimezone || 'America/New_York';
    let tzGroups = listBrowserTimeZoneGroups();
    if (selectedTz && !tzGroups.some((g) => (g.zones || []).some((z) => z.id === selectedTz))) {
      const region = selectedTz.includes('/') ? selectedTz.split('/')[0] : 'Other';
      const label = settings.firmTimezoneLabel || selectedTz.replace(/_/g, ' ');
      const existing = tzGroups.find((g) => g.region === region);
      if (existing) existing.zones.unshift({ id: selectedTz, label });
      else tzGroups = [{ region, zones: [{ id: selectedTz, label }] }, ...tzGroups];
    }
    const tzCount = tzGroups.reduce((n, g) => n + (g.zones?.length || 0), 0);
    const mfaMeta = mfaStatus.enabled
      ? `On · ${Number(mfaStatus.backupCodesRemaining) || 0} backup codes`
      : 'Off';
    const billingMeta = `${escapeHtml(settings.firmTimezoneLabel || selectedTz)} · ${escapeHtml(settings.durationFormat || '')}`;
    const billingFlash = state.settingsBillingFlash;
    state.settingsBillingFlash = null;

    setMainHtml(`
      <div class="card stack settings-page-head">
        <h1>Settings</h1>
        <p class="lead">Open a tab below to edit. Collapse any section when you’re done.</p>
        ${canEditBilling ? '' : '<div class="error">Sign in as an admin (avery@firm.example) or billing clerk (billie@firm.example) to edit these settings.</div>'}
        <div class="row-actions settings-tab-toolbar">
          <button type="button" id="settingsExpandAll" class="linkish">Expand all</button>
          <button type="button" id="settingsCollapseAll" class="linkish">Collapse all</button>
        </div>
      </div>

      <div class="settings-tabs">
      ${settingsCollapseTab({
        id: 'mfaSecurityCard',
        tabKey: 'sign-in-security',
        title: 'Sign-in security',
        meta: mfaMeta,
        open: settingsTabOpen('sign-in-security'),
        bodyHtml: `
          <p class="hint">Authenticator MFA (TOTP) protects billing access. Enable it before go-live — required for admins and billing on a live domain.</p>
          <p class="muted" id="mfaStatusLine">${
            mfaStatus.enabled
              ? `MFA is <strong>on</strong>${mfaStatus.enabledAt ? ` · since ${escapeHtml(String(mfaStatus.enabledAt).slice(0, 10))}` : ''} · ${Number(mfaStatus.backupCodesRemaining) || 0} backup codes left`
              : 'MFA is <strong>off</strong> for your account'
          }</p>
          <div class="row-actions" id="mfaActions">
            ${mfaStatus.enabled
              ? `<button type="button" id="mfaDisableBtn">Disable MFA…</button>`
              : `<button type="button" class="primary" id="mfaSetupBtn">Set up authenticator</button>`}
          </div>
          <div id="mfaSetupPanel" class="stack" hidden></div>
          <div id="mfaMsg"></div>`,
      })}

      ${(canConfigureMatterDefaults || canConfigureFields) ? settingsCollapseTab({
        id: 'recordPagesSection',
        tabKey: 'record-pages',
        title: 'Record pages',
        meta: [
          canConfigureMatterDefaults ? 'Matters' : null,
          canConfigureFields ? 'Contacts' : null,
        ].filter(Boolean).join(' · '),
        open: settingsTabOpen('record-pages', true),
        bodyHtml: `
          <p class="hint">Field layouts for each record page. Open Matter page or Contact page below to edit fields, or create a record page with a label.</p>
          <div class="record-pages-list stack">
            ${canConfigureMatterDefaults ? `
            <details class="onedrive-collapse settings-collapse settings-subtab record-page-tab"
              id="defaultFieldsCard" data-settings-tab="matter-record-pages"
              ${settingsTabOpen('matter-record-pages') ? 'open' : ''}>
              <summary class="onedrive-collapse-summary">
                <span class="onedrive-collapse-title">Matter page</span>
                <span class="onedrive-collapse-meta muted">Admin</span>
              </summary>
              <div class="onedrive-collapse-body stack">
                <p class="hint">Admin only. Each record type (Billable, Non-Billable, or ones you add) has its own field layout. Fields you add here appear on every matter of that type. For a field on one matter only, open the matter and use Matter level fields at the bottom. New matters default to Billable.</p>
                <div id="defaultFieldsBody" class="stack"></div>
                <div id="typeFieldMsg"></div>
              </div>
            </details>` : ''}
            ${canConfigureFields ? `
            <details class="onedrive-collapse settings-collapse settings-subtab record-page-tab"
              id="contactFieldsCard" data-settings-tab="contact-record-pages"
              ${settingsTabOpen('contact-record-pages') ? 'open' : ''}>
              <summary class="onedrive-collapse-summary">
                <span class="onedrive-collapse-title">Contact page</span>
                <span class="onedrive-collapse-meta muted">Clients &amp; companies</span>
              </summary>
              <div class="onedrive-collapse-body stack">
                <p class="hint">Each contact record type (Client, Company, or ones you add) has its own field layout. Fields you add here are record-type fields — they appear on every contact of that type. New contacts default to Client.</p>
                <div id="contactFieldsBody" class="stack"></div>
                <div id="contactFieldMsg"></div>
              </div>
            </details>` : ''}
          </div>`,
      }) : ''}

      ${isAdmin ? `
      ${settingsCollapseTab({
        id: 'rolePermissionsCard',
        tabKey: 'role-permissions',
        title: 'Role permissions',
        meta: 'Admin',
        open: settingsTabOpen('role-permissions'),
        bodyHtml: `
          <p class="hint">Pick a role, then choose what they can view, find in search, edit, or delete. Use Quick setup for common patterns.</p>
          <div id="rolePermissionsBody" class="stack"></div>
          <div id="rolePermissionsMsg"></div>`,
      })}
      ${settingsCollapseTab({
        id: 'fieldPermissionsCard',
        tabKey: 'field-permissions',
        title: 'Field permissions',
        meta: 'Admin',
        open: settingsTabOpen('field-permissions'),
        bodyHtml: `
          <p class="hint">Choose a record page (for Matter or Contact), then set which fields each role can see or edit. Time entry fields are firm-wide.</p>
          <div id="fieldPermissionsBody" class="stack"></div>
          <div id="fieldPermissionsMsg"></div>`,
      })}` : ''}

      ${canEditBilling ? settingsCollapseTab({
        id: 'invoiceTemplatesCard',
        tabKey: 'invoice-templates',
        title: 'Invoice templates',
        meta: `${invoiceTemplatesList.length} template${invoiceTemplatesList.length === 1 ? '' : 's'}`,
        open: settingsTabOpen('invoice-templates'),
        bodyHtml: `
          <p class="hint">Upload a Microsoft Word (.docx) or Adobe PDF template with merge fields like <code>{{client_name}}</code>. Set one as default for “Download with template” on bills.</p>
          <div class="row-actions" style="flex-wrap:wrap;gap:.5rem">
            <a class="linkish" href="/api/invoice-templates/sample?format=docx" id="sampleDocxLink">Download Word sample</a>
            <a class="linkish" href="/api/invoice-templates/sample?format=pdf" id="samplePdfLink">Download Adobe PDF sample</a>
          </div>
          <details class="onedrive-collapse settings-collapse settings-subtab" data-settings-tab="invoice-merge-fields" ${settingsTabOpen('invoice-merge-fields') ? 'open' : ''}>
            <summary class="onedrive-collapse-summary">
              <span class="onedrive-collapse-title">Merge fields</span>
              <span class="onedrive-collapse-meta muted">${mergeFields.length} fields</span>
            </summary>
            <div class="onedrive-collapse-body">
              <div class="table-wrap"><table>
                <thead><tr><th>Field</th><th>Token</th><th>Example</th></tr></thead>
                <tbody>
                  ${mergeFields.map((f) => `
                    <tr>
                      <td>${escapeHtml(f.label)}</td>
                      <td><code>${escapeHtml(f.token)}</code></td>
                      <td class="muted">${escapeHtml(f.example || '')}</td>
                    </tr>`).join('') || '<tr><td colspan="3" class="muted">No fields</td></tr>'}
                </tbody>
              </table></div>
            </div>
          </details>
          <form id="invoiceTemplateForm" class="stack">
            <label>Template name
              <input name="name" required placeholder="Firm letterhead bill" />
            </label>
            <label>Description
              <input name="description" placeholder="Optional" />
            </label>
            <label>Word (.docx) or Adobe PDF file
              <input name="file" type="file" accept=".docx,.pdf,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" required />
            </label>
            <label class="choice" style="display:flex;gap:.5rem;align-items:center">
              <input type="checkbox" name="isDefault" />
              <span>Make default for bill downloads</span>
            </label>
            <div class="row-actions">
              <button class="primary" type="submit">Upload template</button>
            </div>
          </form>
          <div id="invoiceTemplateMsg"></div>
          <div class="table-wrap"><table>
            <thead><tr><th>Name</th><th>Format</th><th>Size</th><th>Default</th><th></th></tr></thead>
            <tbody>
              ${invoiceTemplatesList.map((t) => `
                <tr>
                  <td>${escapeHtml(t.name)}<div class="muted">${escapeHtml(t.description || '')}</div></td>
                  <td>${escapeHtml(String(t.format || '').toUpperCase())}</td>
                  <td class="muted">${Math.round(Number(t.size_bytes || 0) / 1024)} KB</td>
                  <td>${t.is_default ? 'Yes' : '—'}</td>
                  <td class="row-actions">
                    <button type="button" data-tpl-download="${t.id}">Download</button>
                    ${t.is_default ? '' : `<button type="button" data-tpl-default="${t.id}">Set default</button>`}
                    <button type="button" class="danger" data-tpl-delete="${t.id}">Remove</button>
                  </td>
                </tr>`).join('') || '<tr><td colspan="5" class="muted">No custom templates yet — upload a Word or Adobe file above.</td></tr>'}
            </tbody>
          </table></div>`,
      }) : ''}

      ${settingsCollapseTab({
        id: 'timeBillingCard',
        tabKey: 'time-billing',
        title: 'Time and Billing',
        meta: billingMeta,
        open: settingsTabOpen('time-billing', true)
          || settingsTabOpen('time-entry-settings')
          || settingsTabOpen('time-entry-fields'),
        bodyHtml: `
          <p class="hint">Firm timezone, duration display, rounding, and time entry fields.</p>
          <form id="settingsForm" class="stack">
            <details class="onedrive-collapse settings-collapse settings-subtab" data-settings-tab="timezone" ${settingsTabOpen('timezone', true) ? 'open' : ''}>
              <summary class="onedrive-collapse-summary">
                <span class="onedrive-collapse-title">Timezone</span>
                <span class="onedrive-collapse-meta muted">${escapeHtml(settings.firmTimezoneLabel || selectedTz)}</span>
              </summary>
              <div class="onedrive-collapse-body">
                <div class="settings-block" data-editable="${canEditBilling ? '1' : '0'}">
                  <h3 style="margin:0 0 .35rem;font-family:var(--font)">Firm timezone</h3>
                  <p class="hint">Time entry dates and billing “today” use this timezone (${tzCount} zones). Scroll the list to browse all zones.</p>
                  <label class="tz-filter-label">Filter
                    <input type="search" id="firmTimezoneFilter" placeholder="Search city or region…"
                      autocomplete="off" ${canEditBilling ? '' : 'disabled'} />
                  </label>
                  <label class="tz-select-label">Timezone
                    <div class="tz-select-scroll" role="presentation">
                      <select name="firmTimezone" id="firmTimezoneSelect" size="28" ${canEditBilling ? '' : 'disabled'}>
                        ${tzGroups.map((group) => `
                          <optgroup label="${escapeHtml(group.region)}" data-tz-region="${escapeHtml(group.region)}">
                            ${(group.zones || []).map((z) => `
                              <option value="${escapeHtml(z.id)}"
                                data-tz-label="${escapeHtml((z.label || z.id).toLowerCase())}"
                                ${z.id === selectedTz ? 'selected' : ''}>
                                ${escapeHtml(z.label || z.id)}
                              </option>`).join('')}
                          </optgroup>`).join('') || `
                          <option value="${escapeHtml(selectedTz)}" selected>${escapeHtml(selectedTz)}</option>`}
                      </select>
                    </div>
                  </label>
                  <p class="hint">Current firm date: <strong>${escapeHtml(today)}</strong>. Select a zone, then Save — or double-click a zone to save it.</p>
                  ${canEditBilling ? `
                  <div class="row-actions">
                    <button class="primary" type="button" id="saveFirmTimezoneBtn">Save firm timezone</button>
                  </div>` : ''}
                  <div id="firmTimezoneMsg">${billingFlash?.scope === 'timezone' ? `<div class="ok-banner">${escapeHtml(billingFlash.text)}</div>` : ''}</div>
                </div>
              </div>
            </details>

            <details class="onedrive-collapse settings-collapse settings-subtab" data-settings-tab="duration-rounding" ${settingsTabOpen('duration-rounding') ? 'open' : ''}>
              <summary class="onedrive-collapse-summary">
                <span class="onedrive-collapse-title">Duration &amp; rounding</span>
                <span class="onedrive-collapse-meta muted">${escapeHtml(settings.durationFormat || '')} · ${escapeHtml(settings.roundMode || '')}${settings.roundMode !== 'none' ? ` / ${settings.roundIncrementMinutes}m` : ''}</span>
              </summary>
              <div class="onedrive-collapse-body">
                <div class="settings-block" data-editable="${canEditBilling ? '1' : '0'}">
                  <h3 style="margin:0 0 .35rem;font-family:var(--font)">Duration Format</h3>
                  <p class="hint">How timers and time entries are shown.</p>
                  ${(settings.durationFormats || []).map((f) => `
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
                  ${(settings.roundingModes || []).map((m) => `
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
                      ${(settings.roundingIncrements || []).map((r) => `
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
            <div id="settingsMsg">${billingFlash?.scope === 'billing' ? `<div class="ok-banner">${escapeHtml(billingFlash.text)}</div>` : ''}</div>
          </form>
          ${canConfigureFields ? `
          <details class="onedrive-collapse settings-collapse settings-subtab" id="timeFieldsCard"
            data-settings-tab="time-entry-settings"
            ${settingsTabOpen('time-entry-settings') || settingsTabOpen('time-entry-fields') ? 'open' : ''}>
            <summary class="onedrive-collapse-summary">
              <span class="onedrive-collapse-title">Time entry settings</span>
              <span class="onedrive-collapse-meta muted">Fields</span>
            </summary>
            <div class="onedrive-collapse-body stack">
              <p class="hint">Shown when logging time. Custom fields apply to all time entries.</p>
              <div id="timeFieldsBody" class="stack"></div>
              <div id="timeFieldMsg"></div>
            </div>
          </details>` : ''}`,
      })}

      ${showClerkRates ? settingsCollapseTab({
        id: 'tkRatesSection',
        tabKey: 'timekeepers-rates',
        title: 'Timekeepers &amp; Rates',
        meta: `${timekeepers.length} timekeeper${timekeepers.length === 1 ? '' : 's'}`,
        open: settingsTabOpen('timekeepers-rates', Boolean(state.tkSearch.q)),
        bodyHtml: `
          <p class="hint">Default rates are timekeeper-scoped and effective-dated. Historical invoices keep snapshotted rates. Invite users from Navigate → Add a user (Admin by default; grant Add users under Role permissions to allow other roles).</p>
          ${timekeeperRatesTableHtml(timekeepers, { today, showReset: false })}`,
      }) : ''}
      </div>`);

    wireSettingsCollapseTabs(main);
    $('#settingsExpandAll')?.addEventListener('click', () => {
      main.querySelectorAll('details.settings-tab, details.settings-subtab').forEach((el) => {
        el.open = true;
        const key = el.getAttribute('data-settings-tab');
        if (key) state.settingsTabOpen[key] = true;
      });
    });
    $('#settingsCollapseAll')?.addEventListener('click', () => {
      main.querySelectorAll('details.settings-tab, details.settings-subtab').forEach((el) => {
        el.open = false;
        const key = el.getAttribute('data-settings-tab');
        if (key) state.settingsTabOpen[key] = false;
      });
    });

    wireChoiceGroup(main, 'durationFormat');
    wireChoiceGroup(main, 'roundMode');

    const authFetchBlob = async (path, filename) => {
      const headers = { 'X-App-Origin': window.location.origin };
      if (state.token && !state.cookieOnlyAuth) headers.Authorization = `Bearer ${state.token}`;
      if (state.csrf) headers['X-CSRF-Token'] = state.csrf;
      const res = await fetch(path, { credentials: 'include', headers });
      if (!res.ok) {
        let msg = res.statusText;
        try {
          const data = await res.json();
          msg = data.message || data.error || msg;
        } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const tmp = document.createElement('a');
      tmp.href = URL.createObjectURL(blob);
      tmp.download = filename;
      document.body.appendChild(tmp);
      tmp.click();
      tmp.remove();
      URL.revokeObjectURL(tmp.href);
    };

    const tplMsg = (html) => {
      const el = $('#invoiceTemplateMsg');
      if (el) el.innerHTML = html || '';
    };
    $('#sampleDocxLink')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      authFetchBlob('/api/invoice-templates/sample?format=docx', 'invoice-template-sample.docx')
        .catch((e) => tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`));
    });
    $('#samplePdfLink')?.addEventListener('click', (ev) => {
      ev.preventDefault();
      authFetchBlob('/api/invoice-templates/sample?format=pdf', 'invoice-template-sample.pdf')
        .catch((e) => tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`));
    });
    $('#invoiceTemplateForm')?.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const form = ev.currentTarget;
      const fd = new FormData(form);
      const file = fd.get('file');
      if (!(file instanceof File) || !file.size) {
        tplMsg('<div class="error">Choose a .docx or .pdf file.</div>');
        return;
      }
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        let binary = '';
        for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
        const contentBase64 = btoa(binary);
        await api('/api/invoice-templates', {
          method: 'POST',
          body: JSON.stringify({
            name: String(fd.get('name') || '').trim(),
            description: String(fd.get('description') || '').trim(),
            fileName: file.name,
            contentBase64,
            isDefault: Boolean(fd.get('isDefault')),
          }),
        });
        tplMsg('<div class="ok">Template uploaded.</div>');
        await renderSettings();
      } catch (e) {
        tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
      }
    });
    main.querySelectorAll('[data-tpl-download]').forEach((btn) => {
      btn.onclick = () => {
        const id = btn.getAttribute('data-tpl-download');
        authFetchBlob(`/api/invoice-templates/${id}/download`, `template-${id}`)
          .catch((e) => tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`));
      };
    });
    main.querySelectorAll('[data-tpl-default]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(`/api/invoice-templates/${btn.getAttribute('data-tpl-default')}`, {
            method: 'PATCH',
            body: JSON.stringify({ isDefault: true }),
          });
          await renderSettings();
        } catch (e) {
          tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });
    main.querySelectorAll('[data-tpl-delete]').forEach((btn) => {
      btn.onclick = async () => {
        const ok = await confirmAction({
          title: 'Remove template?',
          message: 'This removes the template from Settings. Existing bills are unchanged.',
          confirmLabel: 'Remove',
          cancelLabel: 'Cancel',
        });
        if (!ok) return;
        try {
          await api(`/api/invoice-templates/${btn.getAttribute('data-tpl-delete')}`, {
            method: 'DELETE',
            body: '{}',
          });
          await renderSettings();
        } catch (e) {
          tplMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });

    const mfaMsg = (html) => {
      const el = $('#mfaMsg');
      if (el) el.innerHTML = html || '';
    };
    const showMfaSetup = async () => {
      try {
        mfaMsg('');
        const setup = await api('/api/mfa/setup', { method: 'POST', body: '{}' });
        const panel = $('#mfaSetupPanel');
        if (!panel) return;
        panel.hidden = false;
        panel.innerHTML = `
          <p class="hint">Add this account in Google Authenticator, 1Password, or Authy, then enter a code to confirm.</p>
          <label class="login-field">Secret key
            <input type="text" readonly value="${escapeHtml(setup.secret)}" id="mfaSecret" />
          </label>
          <p class="hint muted" style="word-break:break-all">otpauth: ${escapeHtml(setup.otpauthUrl)}</p>
          <p class="hint"><strong>Backup codes</strong> (store offline — each works once):</p>
          <pre class="mfa-backup-codes">${escapeHtml((setup.backupCodes || []).join('\n'))}</pre>
          <label class="login-field">Authenticator code
            <input id="mfaEnableCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="16" />
          </label>
          <div class="row-actions">
            <button type="button" class="primary" id="mfaEnableBtn">Confirm and enable MFA</button>
          </div>`;
        $('#mfaEnableBtn').onclick = async () => {
          try {
            await api('/api/mfa/enable', {
              method: 'POST',
              body: JSON.stringify({ code: $('#mfaEnableCode').value.trim() }),
            });
            mfaMsg('<div class="ok">MFA enabled.</div>');
            await renderSettings();
          } catch (e) {
            mfaMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      } catch (e) {
        mfaMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
      }
    };
    $('#mfaSetupBtn')?.addEventListener('click', showMfaSetup);
    $('#mfaDisableBtn')?.addEventListener('click', () => {
      const panel = $('#mfaSetupPanel');
      if (!panel) return;
      panel.hidden = false;
      panel.innerHTML = `
        <p class="hint">Disabling MFA requires your password and a current authenticator (or backup) code.</p>
        <label class="login-field">Password
          <input id="mfaDisablePassword" type="password" autocomplete="current-password" />
        </label>
        <label class="login-field">Authenticator or backup code
          <input id="mfaDisableCode" type="text" inputmode="numeric" autocomplete="one-time-code" />
        </label>
        <div class="row-actions">
          <button type="button" id="mfaDisableConfirm">Disable MFA</button>
        </div>`;
      $('#mfaDisableConfirm').onclick = async () => {
        try {
          await api('/api/mfa/disable', {
            method: 'POST',
            body: JSON.stringify({
              password: $('#mfaDisablePassword').value,
              code: $('#mfaDisableCode').value.trim(),
            }),
          });
          mfaMsg('<div class="ok">MFA disabled.</div>');
          await renderSettings();
        } catch (e) {
          mfaMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
        }
      };
    });

    if (canConfigureMatterDefaults) {
      const matterRecordTypes = matterRecordTypesPrefetch || [];
      await bindDefaultFieldsEditor({
        bodyEl: $('#defaultFieldsBody'),
        msgEl: $('#typeFieldMsg'),
        recordTypeKey: state.settingsMatterRecordTypeKey || 'billable',
        appliesTo: 'matter',
        recordTypes: matterRecordTypes,
        onRecordTypeChange: (key) => {
          state.settingsMatterRecordTypeKey = key;
        },
      });
      if (!stillOnView('settings')) return;
    }

    if (canConfigureFields) {
      const contactRecordTypes = contactRecordTypesPrefetch || [];
      await Promise.all([
        bindDefaultFieldsEditor({
          bodyEl: $('#contactFieldsBody'),
          msgEl: $('#contactFieldMsg'),
          recordTypeKey: state.settingsContactRecordTypeKey || 'client',
          appliesTo: 'client',
          recordTypes: contactRecordTypes,
          onRecordTypeChange: (key) => {
            state.settingsContactRecordTypeKey = key;
          },
        }).catch(() => {}),
        bindDefaultFieldsEditor({
          bodyEl: $('#timeFieldsBody'),
          msgEl: $('#timeFieldMsg'),
          appliesTo: 'time_entry',
        }).catch(() => {}),
      ]);
      if (!stillOnView('settings')) return;
    }

    if (isAdmin && settings.permissions) {
      // Keep field-permission binding independent so a role-editor failure
      // cannot leave Time entry fields blank in Field permissions.
      await Promise.all([
        bindRolePermissionsEditor({
          bodyEl: $('#rolePermissionsBody'),
          msgEl: $('#rolePermissionsMsg'),
          permissions: settings.permissions,
        }).catch(() => {}),
        bindFieldPermissionsEditor({
          bodyEl: $('#fieldPermissionsBody'),
          msgEl: $('#fieldPermissionsMsg'),
          permissions: settings.permissions,
        }).catch(() => {}),
      ]);
      if (!stillOnView('settings')) return;
    }

    const form = $('#settingsForm');
    if (!form) return;
    const interval = $('#roundIncrementMinutes');
    const syncInterval = () => {
      const mode = form.querySelector('input[name="roundMode"]:checked')?.value;
      if (interval) interval.disabled = !canEditBilling || mode === 'none';
    };
    main.querySelectorAll('.choice[data-name="roundMode"]').forEach((row) => {
      row.addEventListener('choice-change', syncInterval);
    });
    syncInterval();

    const tzSelect = $('#firmTimezoneSelect');
    const tzFilter = $('#firmTimezoneFilter');
    if (tzSelect && tzFilter) {
      const applyTzFilter = () => {
        const q = String(tzFilter.value || '').trim().toLowerCase();
        tzSelect.querySelectorAll('option').forEach((opt) => {
          const hay = `${opt.value} ${opt.getAttribute('data-tz-label') || opt.textContent || ''}`.toLowerCase();
          opt.hidden = !!(q && !hay.includes(q));
        });
        tzSelect.querySelectorAll('optgroup').forEach((group) => {
          const anyVisible = [...group.querySelectorAll('option')].some((opt) => !opt.hidden);
          group.hidden = !anyVisible;
        });
      };
      tzFilter.addEventListener('input', applyTzFilter);
    }

    if (canEditBilling) {
      const saveTimeBillingSettings = async ({
        timezoneOnly = false,
        flashScope = 'billing',
        flashText = 'Time & billing settings saved.',
      } = {}) => {
        const firmTimezone = tzSelect?.value || form.firmTimezone?.value;
        const msgEl = timezoneOnly ? $('#firmTimezoneMsg') : $('#settingsMsg');
        if (!firmTimezone) {
          if (msgEl) msgEl.innerHTML = '<div class="error">Choose a firm timezone first.</div>';
          return false;
        }
        const body = timezoneOnly
          ? { firmTimezone }
          : {
              durationFormat: form.querySelector('input[name="durationFormat"]:checked')?.value,
              roundMode: form.querySelector('input[name="roundMode"]:checked')?.value,
              roundIncrementMinutes: Number(
                interval?.disabled
                  ? form.roundIncrementMinutesFallback?.value
                  : interval?.value
              ),
              firmTimezone,
            };
        try {
          state.settings = await api('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify(body),
          });
          state.settingsBillingFlash = { scope: flashScope, text: flashText };
          await renderSettings();
          return true;
        } catch (e) {
          if (msgEl) msgEl.innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          return false;
        }
      };

      form.onsubmit = async (ev) => {
        ev.preventDefault();
        await saveTimeBillingSettings();
      };

      $('#saveFirmTimezoneBtn')?.addEventListener('click', async () => {
        await saveTimeBillingSettings({
          timezoneOnly: true,
          flashScope: 'timezone',
          flashText: 'Firm timezone saved.',
        });
      });

      tzSelect?.addEventListener('dblclick', async () => {
        if (!tzSelect.value) return;
        await saveTimeBillingSettings({
          timezoneOnly: true,
          flashScope: 'timezone',
          flashText: 'Firm timezone saved.',
        });
      });
    }

    if (showClerkRates) {
      wireTimekeeperRatesPanel({
        onRefresh: async () => {
          await renderSettings();
          const section = $('#tkRatesSection');
          if (section) section.open = true;
          const rateMsg = $('#rateMsg');
          if (rateMsg) rateMsg.innerHTML = '<div class="ok-banner">Rate change saved.</div>';
        },
      });
    }
  }

  async function renderAudit() {
    const rows = await api('/api/audit-log');
    setMainHtml(`
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
      </div>`);
  }

  /** Compact in-app help agent: training & how-to for Chrono.
   *  Answer text may include [[Label|target]] deep links; see goHelpTarget(). */
  const HELP_TOPICS = [
    {
      id: 'matter',
      label: 'Create a matter',
      keywords: ['matter', 'create matter', 'new matter', 'open matter', 'case', 'search matters', 'filter matters', 'matter list'],
      answer: 'Open [[Create Matter|create-matter]] (or the sidebar Create Matter action). Enter a name, complete required custom fields, then confirm. On [[Matters|matters]], Search matters shows a scrollable list of all matters; filter by Status or a custom field (for example Status) to narrow it. Roles with Matters → Delete can delete a matter from that list.',
      links: [
        { label: 'Go to Create Matter', target: 'create-matter' },
        { label: 'Browse Matters', target: 'matters' },
        { label: 'Matter page', target: 'settings-matter-fields' },
      ],
    },
    {
      id: 'time',
      label: 'Log time',
      keywords: ['time', 'hours', 'log time', 'time entry', 'timesheet', 'billable'],
      answer: 'Open [[Time Entry|time]], or open a matter — each matter includes the same Time Entry form and Recent entries list. Pick date, hours (0.25 steps), and description, then Save. Recent entries can be edited or deleted there. Saved time is ready for [[Billing|billing]]—no approval step.',
      links: [
        { label: 'Go to Time Entry', target: 'time' },
        { label: 'Open Billing', target: 'billing' },
      ],
    },
    {
      id: 'contact',
      label: 'Add a contact',
      keywords: ['contact', 'client', 'company', 'person', 'create contact', 'delete contact'],
      answer: 'Open [[Create Contact|create-contact]] (or [[Contacts|contacts]] → Create contact). Choose a record type, fill name and type-specific custom fields, then confirm. After create, Contact level fields lets you add fields for that contact only. Roles with Contacts → Delete (Admin always) can use Delete contact at the bottom of the contact page — linked matters become client-less. [[Contact page|settings-contact-fields]] in Settings manages shared type layouts.',
      links: [
        { label: 'Go to Create Contact', target: 'create-contact' },
        { label: 'Contact page', target: 'settings-contact-fields' },
        { label: 'Role permissions', target: 'settings' },
      ],
    },
    {
      id: 'fields',
      label: 'Custom fields',
      keywords: ['custom field', 'fields', 'required', 'dropdown', 'settings field'],
      answer: 'Matter and contact fields can be record-type (shared defaults) or record-only. Admins configure shared layouts under [[Record pages|settings-record-pages]] in Settings — [[Matter page|settings-matter-fields]] and [[Contact page|settings-contact-fields]]. Supported types include Auto Number, Checkbox, Currency, Date/Date-Time, Email, Geolocation, Number, Percent, Phone, Picklist, Multi-Select Picklist, Text, Text Area / Long / Rich, URL, and Formula (not roll-up, lookup, or master-detail). On a matter or contact page, Matter level fields / Contact level fields add a field for that record only.',
      links: [
        { label: 'Record pages', target: 'settings-record-pages' },
        { label: 'Matter page', target: 'settings-matter-fields' },
        { label: 'Contact page', target: 'settings-contact-fields' },
        { label: 'Time entry settings', target: 'settings-time-billing-fields' },
        { label: 'Time and Billing', target: 'settings-time-billing' },
      ],
    },
    {
      id: 'reports',
      label: 'Reports & dashboard',
      keywords: ['report', 'dashboard', 'lodestar', 'export', 'chart', 'custom report'],
      answer: 'Open [[Reports|reports]] to run firm Lodestar reports or create custom reports grouped by a custom field. Open [[Dashboard|dashboard]] to pin firm or custom reports, remove them with Remove, and export everything with Export PDF / CSV / Excel.',
      links: [
        { label: 'Go to Reports', target: 'reports' },
        { label: 'Go to Dashboard', target: 'dashboard' },
      ],
    },
    {
      id: 'billing',
      label: 'Create a bill',
      keywords: ['bill', 'billing', 'invoice', 'prebill'],
      answer: 'Open [[Billing|billing]], choose the matter and approved time to include, then create the bill. Time & billing preferences live in [[Settings|settings]]. Only roles like admin or billing clerk can manage billing settings.',
      links: [
        { label: 'Go to Billing', target: 'billing' },
        { label: 'Open Settings', target: 'settings' },
      ],
    },
    {
      id: 'users',
      label: 'Add a user',
      keywords: ['user', 'invite', 'timekeeper', 'rate', 'add a user', 'hire'],
      answer: '[[Add a user|users]] invites someone by name, email, role, and default rate — you get a one-time link to share so they can set a password. Admin has this by default; turn on <strong>Add users</strong> for other roles under [[Role permissions|settings]]. Billing clerks can still change timekeeper rates under [[Settings|settings]].',
      links: [
        { label: 'Go to Add a user', target: 'users' },
        { label: 'Open Settings', target: 'settings' },
      ],
    },
    {
      id: 'login',
      label: 'Sign in',
      keywords: ['login', 'password', 'sign in', 'demo', 'avery'],
      answer: 'Use your work email and password. Demo: avery@firm.example / demo-change-me. Email sign-in and reset links stay off until a live domain; ask an admin for a reset link if needed. You’re signed in now — open [[Settings|settings]] for firm preferences, or [[Matters|matters]] to get started.',
      links: [
        { label: 'Go to Matters', target: 'matters' },
        { label: 'Open Settings', target: 'settings' },
      ],
    },
  ];

  function matchHelpAnswer(question) {
    const q = String(question || '').trim().toLowerCase();
    if (!q) return null;
    let best = null;
    let bestScore = 0;
    for (const topic of HELP_TOPICS) {
      let score = 0;
      for (const key of topic.keywords) {
        if (q.includes(key)) score += key.length;
      }
      if (topic.label.toLowerCase().split(/\s+/).some((w) => w.length > 3 && q.includes(w))) {
        score += 2;
      }
      if (score > bestScore) {
        bestScore = score;
        best = topic;
      }
    }
    return bestScore > 0 ? best : null;
  }

  /** Turn [[Label|target]] markers into help deep-link anchors. */
  function formatHelpAnswerHtml(text) {
    const raw = String(text || '');
    let html = '';
    let i = 0;
    while (i < raw.length) {
      const start = raw.indexOf('[[', i);
      if (start < 0) {
        html += escapeHtml(raw.slice(i));
        break;
      }
      html += escapeHtml(raw.slice(i, start));
      const end = raw.indexOf(']]', start + 2);
      if (end < 0) {
        html += escapeHtml(raw.slice(start));
        break;
      }
      const inner = raw.slice(start + 2, end);
      const bar = inner.indexOf('|');
      if (bar < 0) {
        html += escapeHtml(raw.slice(start, end + 2));
      } else {
        const label = inner.slice(0, bar).trim();
        const target = inner.slice(bar + 1).trim();
        if (label && target) {
          html += `<a href="#${escapeHtml(target)}" class="help-go" data-help-go="${escapeHtml(target)}">${escapeHtml(label)}</a>`;
        } else {
          html += escapeHtml(raw.slice(start, end + 2));
        }
      }
      i = end + 2;
    }
    return html;
  }

  function closeHelpAgentPanel() {
    const root = document.getElementById('helpAgent');
    if (!root) return;
    root.classList.remove('is-open');
    const panel = $('#helpAgentPanel', root);
    if (panel) panel.setAttribute('hidden', '');
    const bubble = $('#helpAgentBubble', root);
    if (bubble) {
      bubble.setAttribute('aria-expanded', 'false');
      bubble.setAttribute('aria-label', 'Open help agent');
    }
  }

  async function goAppView(view, { clearDetail = true } = {}) {
    state.view = view;
    if (clearDetail) {
      state.matterId = null;
      state.contactId = null;
      if (view !== 'matters') state.showCreateMatter = false;
      if (view !== 'contacts') state.showCreateContact = false;
    }
    renderShell();
    await renderView();
  }

  /** Navigate from a Help Agent deep link, then close the panel. */
  async function goHelpTarget(target) {
    const key = String(target || '').trim();
    if (!key || !state.user) return;

    const focusSettings = async (selector, { openDetails = false } = {}) => {
      await goAppView('settings');
      const el = typeof selector === 'string' ? $(selector) : selector;
      if (!el) return;
      if ('open' in el) {
        el.open = true;
        const key = el.getAttribute?.('data-settings-tab');
        if (key) {
          if (!state.settingsTabOpen) state.settingsTabOpen = {};
          state.settingsTabOpen[key] = true;
        }
      } else if (openDetails) {
        const details = el.closest?.('details');
        if (details) details.open = true;
      }
      const parentTab = el.closest?.('details.settings-tab');
      if (parentTab && parentTab !== el) {
        parentTab.open = true;
        const parentKey = parentTab.getAttribute('data-settings-tab');
        if (parentKey) {
          if (!state.settingsTabOpen) state.settingsTabOpen = {};
          state.settingsTabOpen[parentKey] = true;
        }
      }
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    try {
      if (key === 'create-matter') {
        goAddMatter();
      } else if (key === 'create-contact') {
        goAddContact();
      } else if (key === 'time') {
        goAddTimeEntry();
      } else if (key === 'matters') {
        state.showCreateMatter = false;
        await goAppView('matters');
      } else if (key === 'contacts') {
        state.showCreateContact = false;
        await goAppView('contacts');
      } else if (key === 'billing') {
        await goAppView('billing');
      } else if (key === 'reports') {
        await goAppView('reports');
      } else if (key === 'dashboard') {
        await goAppView('dashboard');
      } else if (key === 'settings') {
        await goAppView('settings');
      } else if (key === 'users' || key === 'add-user') {
        if (!canManageUsers()) {
          setMainHtml(`<div class="card"><div class="error">Only admins can add users.</div></div>`);
        } else {
          state.focusAddUser = true;
          await goAppView('users');
        }
      } else if (key === 'settings-record-pages') {
        await focusSettings('#recordPagesSection');
      } else if (key === 'settings-matter-fields') {
        await focusSettings('#defaultFieldsCard');
      } else if (key === 'settings-contact-fields') {
        await focusSettings('#contactFieldsCard');
      } else if (key === 'settings-time-fields' || key === 'settings-time-billing-fields') {
        await focusSettings('#timeFieldsCard');
      } else if (key === 'settings-time-billing') {
        await focusSettings('#timeBillingCard');
      } else if (key === 'settings-name-formula') {
        // Matter name formula UI is temporarily hidden; land on Matter page instead.
        await focusSettings('#defaultFieldsCard');
      } else {
        return;
      }
    } finally {
      closeHelpAgentPanel();
    }
  }

  function wireHelpGoLinks(rootEl) {
    if (!rootEl) return;
    rootEl.querySelectorAll('[data-help-go]').forEach((el) => {
      el.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        void goHelpTarget(el.getAttribute('data-help-go'));
      };
    });
  }

  async function goLookupResult(item) {
    const target = item?.target || {};
    const view = target.view;
    if (!view) return;
    state.showCreateMatter = false;
    state.showCreateContact = false;
    if (view === 'matter' && target.matterId) {
      await openMatter(target.matterId);
      return;
    }
    if (view === 'contact' && target.contactId) {
      await openContact(target.contactId);
      return;
    }
    if (view === 'time') {
      state.view = 'time';
      state.matterId = target.matterId || null;
      state.focusTimeEntryId = target.timeEntryId || null;
      renderShell();
      await renderView();
      return;
    }
    if (view === 'reports') {
      state.view = 'reports';
      if (target.reportKind === 'custom' && target.reportId) {
        state.editingCustomReportId = target.reportId;
      }
      if (target.reportKind === 'firm' && target.reportKey) {
        state.focusFirmReportKey = target.reportKey;
      }
      state.matterId = null;
      state.contactId = null;
      renderShell();
      await renderView();
      return;
    }
    if (view === 'billing') {
      state.view = 'billing';
      state.focusInvoiceId = target.invoiceId || null;
      state.matterId = null;
      state.contactId = null;
      renderShell();
      await renderView();
    }
  }

  function ensureLookupBar() {
    if (!lookupBar) return;
    if (!state.user) {
      lookupBar.hidden = true;
      lookupBar.innerHTML = '';
      delete lookupBar.dataset.ready;
      return;
    }
    lookupBar.hidden = false;
    // Drop legacy scope line / ⌘K chip if an older lookup chrome is still mounted.
    if (lookupBar.dataset.ready
      && (lookupBar.querySelector('.lookup-hotkey') || lookupBar.querySelector('#globalLookupScopes'))) {
      delete lookupBar.dataset.ready;
      lookupBar.innerHTML = '';
    }
    if (!lookupBar.dataset.ready) {
      lookupBar.innerHTML = `
        <form class="lookup-form" id="globalLookupForm" autocomplete="off" role="search">
          <label class="lookup-label" for="globalLookupInput">Lookup</label>
          <div class="lookup-input-wrap">
            <svg class="lookup-icon" viewBox="0 0 24 24" width="18" height="18" fill="none"
              stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="6.5"/>
              <path d="M16.2 16.2 20 20"/>
            </svg>
            <input id="globalLookupInput" name="q" type="search"
              placeholder="Search matters, contacts, time, reports…"
              aria-label="Global lookup" aria-autocomplete="list" aria-controls="globalLookupResults"
              aria-expanded="false" />
          </div>
          <div class="lookup-results" id="globalLookupResults" hidden role="listbox" aria-label="Lookup results"></div>
        </form>`;
      lookupBar.dataset.ready = '1';

      const form = $('#globalLookupForm', lookupBar);
      const input = $('#globalLookupInput', lookupBar);
      const resultsEl = $('#globalLookupResults', lookupBar);
      let timer = null;
      let activeIndex = -1;
      let lastResults = [];
      let reqSeq = 0;

      const closeResults = () => {
        resultsEl.hidden = true;
        resultsEl.innerHTML = '';
        input.setAttribute('aria-expanded', 'false');
        activeIndex = -1;
        lastResults = [];
      };

      const renderResults = (payload) => {
        lastResults = payload?.results || [];
        if (!String(input.value || '').trim()) {
          closeResults();
          return;
        }
        if (!lastResults.length) {
          resultsEl.hidden = false;
          input.setAttribute('aria-expanded', 'true');
          resultsEl.innerHTML = '<div class="lookup-empty muted">No matches</div>';
          return;
        }
        resultsEl.hidden = false;
        input.setAttribute('aria-expanded', 'true');
        activeIndex = 0;
        resultsEl.innerHTML = lastResults.map((item, i) => `
          <button type="button" class="lookup-result ${i === 0 ? 'is-active' : ''}"
            role="option" data-lookup-idx="${i}" aria-selected="${i === 0 ? 'true' : 'false'}">
            <span class="lookup-result-type">${escapeHtml(item.typeLabel || item.type)}</span>
            <span class="lookup-result-main">
              <strong>${escapeHtml(item.title || '')}</strong>
              <small class="muted">${escapeHtml(item.subtitle || '')}</small>
            </span>
          </button>`).join('');
        resultsEl.querySelectorAll('[data-lookup-idx]').forEach((btn) => {
          btn.onmouseenter = () => {
            activeIndex = Number(btn.dataset.lookupIdx);
            resultsEl.querySelectorAll('.lookup-result').forEach((el, i) => {
              el.classList.toggle('is-active', i === activeIndex);
              el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
            });
          };
          btn.onclick = async () => {
            const item = lastResults[Number(btn.dataset.lookupIdx)];
            closeResults();
            input.blur();
            if (item) await goLookupResult(item);
          };
        });
      };

      const runLookup = async () => {
        const q = String(input.value || '').trim();
        if (!q) {
          closeResults();
          return;
        }
        const seq = ++reqSeq;
        try {
          const data = await api(`/api/lookup?q=${encodeURIComponent(q)}&limit=5`, { cache: false });
          if (seq !== reqSeq) return;
          renderResults(data);
        } catch (e) {
          if (seq !== reqSeq) return;
          resultsEl.hidden = false;
          input.setAttribute('aria-expanded', 'true');
          resultsEl.innerHTML = `<div class="lookup-empty error">${escapeHtml(e.message)}</div>`;
        }
      };

      const scheduleLookup = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { void runLookup(); }, 180);
      };

      form.onsubmit = async (ev) => {
        ev.preventDefault();
        if (activeIndex >= 0 && lastResults[activeIndex]) {
          const item = lastResults[activeIndex];
          closeResults();
          await goLookupResult(item);
          return;
        }
        await runLookup();
      };
      input.addEventListener('input', scheduleLookup);
      input.addEventListener('focus', () => {
        if (String(input.value || '').trim()) void runLookup();
      });
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape') {
          closeResults();
          input.blur();
          return;
        }
        if (!lastResults.length) return;
        if (ev.key === 'ArrowDown') {
          ev.preventDefault();
          activeIndex = (activeIndex + 1) % lastResults.length;
        } else if (ev.key === 'ArrowUp') {
          ev.preventDefault();
          activeIndex = (activeIndex - 1 + lastResults.length) % lastResults.length;
        } else {
          return;
        }
        resultsEl.querySelectorAll('.lookup-result').forEach((el, i) => {
          el.classList.toggle('is-active', i === activeIndex);
          el.setAttribute('aria-selected', i === activeIndex ? 'true' : 'false');
        });
        resultsEl.querySelector('.lookup-result.is-active')?.scrollIntoView({ block: 'nearest' });
      });
      document.addEventListener('click', (ev) => {
        if (!lookupBar.contains(ev.target)) closeResults();
      });
      document.addEventListener('keydown', (ev) => {
        if (!(ev.metaKey || ev.ctrlKey) || String(ev.key).toLowerCase() !== 'k') return;
        if (!state.user || lookupBar.hidden) return;
        ev.preventDefault();
        input.focus();
        input.select();
      });
    }
  }

  function setHelpAgentVisible(visible) {
    const root = document.getElementById('helpAgent');
    if (root) root.hidden = !visible;
  }

  function ensureHelpAgent() {
    let root = document.getElementById('helpAgent');
    if (!root) {
      root = document.createElement('div');
      root.id = 'helpAgent';
      root.className = 'help-agent';
      root.innerHTML = `
        <div class="help-agent-panel" id="helpAgentPanel" hidden>
          <div class="help-agent-head">
            <div>
              <strong>Help Agent</strong>
              <span class="muted">Training & how-to</span>
            </div>
            <button type="button" class="help-agent-close" id="helpAgentClose" aria-label="Close help">×</button>
          </div>
          <div class="help-agent-body" id="helpAgentBody"></div>
          <form class="help-agent-form" id="helpAgentForm">
            <input id="helpAgentInput" name="q" autocomplete="off"
              placeholder="Ask how to do something…" aria-label="Ask the help agent" />
            <button class="primary" type="submit">Ask</button>
          </form>
        </div>
        <button type="button" class="help-agent-bubble" id="helpAgentBubble"
          aria-label="Open help agent" title="Help & training">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
            stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 3.8a6.4 6.4 0 0 0-5.5 9.7L5 20l6.7-1.7A6.4 6.4 0 1 0 12 3.8z"/>
            <path d="M9.2 11.2h.01M12 11.2h.01M14.8 11.2h.01"/>
          </svg>
        </button>`;
      document.body.appendChild(root);

      const panel = $('#helpAgentPanel', root);
      const body = $('#helpAgentBody', root);
      const bubble = $('#helpAgentBubble', root);
      const form = $('#helpAgentForm', root);
      const input = $('#helpAgentInput', root);

      const renderHome = () => {
        body.innerHTML = `
          <p class="help-agent-intro">Need a hand? Pick a topic or ask how to do something in Chrono. Answers include links that take you there.</p>
          <div class="help-agent-topics">
            ${HELP_TOPICS.map((t) => `
              <button type="button" class="help-topic" data-help-topic="${t.id}">${escapeHtml(t.label)}</button>
            `).join('')}
          </div>`;
        body.querySelectorAll('[data-help-topic]').forEach((btn) => {
          btn.onclick = () => {
            const topic = HELP_TOPICS.find((t) => t.id === btn.dataset.helpTopic);
            if (topic) showAnswer(topic);
          };
        });
      };

      const showAnswer = (topicOrTitle, maybeAnswer) => {
        const topic = typeof topicOrTitle === 'object' && topicOrTitle
          ? topicOrTitle
          : { label: topicOrTitle, answer: maybeAnswer, links: [] };
        const links = Array.isArray(topic.links) ? topic.links : [];
        body.innerHTML = `
          <div class="help-agent-answer">
            <strong>${escapeHtml(topic.label || 'Help')}</strong>
            <p>${formatHelpAnswerHtml(topic.answer || '')}</p>
            ${links.length ? `
              <div class="help-agent-links">
                ${links.map((l) => `
                  <a href="#${escapeHtml(l.target)}" class="help-go-btn" data-help-go="${escapeHtml(l.target)}">
                    ${escapeHtml(l.label)} →
                  </a>`).join('')}
              </div>` : ''}
            <button type="button" class="linkish" id="helpAgentBack">← All topics</button>
          </div>`;
        wireHelpGoLinks(body);
        $('#helpAgentBack', body).onclick = renderHome;
        body.scrollTop = 0;
      };

      const setOpen = (open) => {
        root.classList.toggle('is-open', !!open);
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
        bubble.setAttribute('aria-expanded', open ? 'true' : 'false');
        bubble.setAttribute('aria-label', open ? 'Close help agent' : 'Open help agent');
        if (open) {
          renderHome();
          setTimeout(() => input?.focus(), 0);
        }
      };

      bubble.onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(!root.classList.contains('is-open'));
      };
      $('#helpAgentClose', root).onclick = (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        setOpen(false);
      };
      document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && root.classList.contains('is-open')) setOpen(false);
      });
      form.onsubmit = (ev) => {
        ev.preventDefault();
        const q = String(input.value || '').trim();
        if (!q) return;
        const match = matchHelpAnswer(q);
        if (match) {
          showAnswer(match);
        } else {
          showAnswer({
            label: 'I can help with that',
            answer: 'Try a topic below, or ask about creating matters, logging time, contacts, custom fields, reports, dashboard, or billing. Each answer includes links that take you there.',
            links: [
              { label: 'Create a matter', target: 'create-matter' },
              { label: 'Log time', target: 'time' },
              { label: 'Billing', target: 'billing' },
            ],
          });
          const wrap = body.querySelector('.help-agent-answer');
          if (wrap) {
            const topics = document.createElement('div');
            topics.className = 'help-agent-topics';
            topics.innerHTML = HELP_TOPICS.slice(0, 4).map((t) => `
              <button type="button" class="help-topic" data-help-topic="${t.id}">${escapeHtml(t.label)}</button>
            `).join('');
            const back = wrap.querySelector('#helpAgentBack');
            wrap.insertBefore(topics, back);
            topics.querySelectorAll('[data-help-topic]').forEach((btn) => {
              btn.onclick = () => {
                const topic = HELP_TOPICS.find((t) => t.id === btn.dataset.helpTopic);
                if (topic) showAnswer(topic);
              };
            });
          }
        }
        input.value = '';
      };
    }
    setHelpAgentVisible(!!state.user);
  }

  boot();
})();
