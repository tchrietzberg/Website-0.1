(() => {
  const state = {
    token: localStorage.getItem('billing_token') || null,
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

  async function api(path, opts = {}) {
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (state.token) headers.Authorization = `Bearer ${state.token}`;
    const res = await fetch(path, { ...opts, headers });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || res.statusText);
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

  function matterSearchText(m) {
    return [m.number, m.name, m.client_name, m.status, m.attorney_name]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
  }

  function renderMatterPicker({ name = 'matterId', selectedId = null, matters = [] } = {}) {
    const selected = matters.find((m) => Number(m.id) === Number(selectedId)) || null;
    return `
      <div class="matter-picker" data-matter-picker>
        <input type="hidden" name="${name}" value="${selected ? selected.id : ''}" data-matter-id />
        <button type="button" class="matter-picker-trigger" data-matter-trigger
          aria-haspopup="listbox" aria-expanded="false">
          <span class="matter-picker-value" data-matter-label>
            ${selected ? `
              <strong>${escapeHtml(selected.number)}</strong>
              <span>${escapeHtml(selected.name)}</span>
              ${selected.client_name ? `<small>${escapeHtml(selected.client_name)}</small>` : ''}
            ` : `
              <span class="matter-picker-placeholder">Search matters by number, name, or client…</span>
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
        label.innerHTML = '<span class="matter-picker-placeholder">Search matters by number, name, or client…</span>';
      } else {
        label.innerHTML = `
          <strong>${escapeHtml(m.number)}</strong>
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
        : matters.filter((m) => matterSearchText(m).includes(needle)).slice(0, 80);
      activeIndex = filtered.length ? 0 : -1;
      empty.hidden = filtered.length > 0;
      list.innerHTML = filtered.map((m, i) => `
        <li role="option" class="matter-picker-option ${i === activeIndex ? 'is-active' : ''}"
          data-id="${m.id}" aria-selected="${i === activeIndex ? 'true' : 'false'}">
          <strong>${escapeHtml(m.number)}</strong>
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
      ev.stopPropagation();
      if (panel.hidden) open();
      else close();
    };
    search.oninput = () => renderList(search.value);
    search.onkeydown = (ev) => {
      if (ev.key === 'ArrowDown') { ev.preventDefault(); moveActive(1); }
      else if (ev.key === 'ArrowUp') { ev.preventDefault(); moveActive(-1); }
      else if (ev.key === 'Enter') {
        ev.preventDefault();
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

  async function boot() {
    try {
      const me = await api('/api/me');
      state.user = me.user;
    } catch {
      state.user = null;
    }
    if (!state.user) return renderLogin();
    await refreshRefs();
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

  function renderLogin() {
    if (sidebar) sidebar.hidden = true;
    if (appEl) appEl.classList.remove('app-shell');
    if (nav) nav.innerHTML = '';
    if (userbar) userbar.textContent = '';
    if (sidebarActions) sidebarActions.innerHTML = '';
    main.innerHTML = `
      <div class="login-wrap">
        <div class="card stack">
          <h1>Sign in</h1>
          <p class="lead">Prototype auth: enter a demo email.</p>
          <label>Email
            <input id="email" list="emails" placeholder="avery@firm.example" value="avery@firm.example" />
          </label>
          <datalist id="emails">
            <option value="avery@firm.example">
            <option value="jordan@firm.example">
            <option value="riley@firm.example">
            <option value="sam@firm.example">
            <option value="billie@firm.example">
          </datalist>
          <button class="primary" id="loginBtn">Continue</button>
          <div id="loginErr"></div>
          <p class="hint">Demo: avery@firm.example → Create Matter → Search matters → Add Time Entry → Billing.</p>
        </div>
      </div>`;
    $('#loginBtn').onclick = async () => {
      try {
        const data = await api('/api/login', {
          method: 'POST',
          body: JSON.stringify({ email: $('#email').value.trim() }),
        });
        state.token = data.token;
        localStorage.setItem('billing_token', data.token);
        state.user = data.user;
        await refreshRefs();
        renderShell();
        renderView();
      } catch (e) {
        $('#loginErr').innerHTML = `<div class="error">${e.message}</div>`;
      }
    };
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
    if (appEl) appEl.classList.add('app-shell');
    const items = [
      ['matters', 'Matters'],
      ['time', 'Time Entry'],
      ['billing', 'Billing'],
      ['reports', 'Reports'],
      ['settings', 'Settings'],
    ];
    if (state.view === 'approvals' || state.view === 'payments' || state.view === 'audit') {
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
      ${items.map(([id, label]) =>
        `<button type="button" data-view="${id}" class="sidebar-nav-btn ${activeView === id ? 'active' : ''}">${label}</button>`
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
      <div class="who"><strong>${state.user.name}</strong><span>${state.user.role.replace('_', ' ')}</span></div>
      <button type="button" id="logout" class="sidebar-logout">Sign out</button>`;
    $('#logout').onclick = async () => {
      await api('/api/logout', { method: 'POST' });
      state.token = null;
      localStorage.removeItem('billing_token');
      state.user = null;
      renderLogin();
    };
  }

  async function renderView() {
    try {
      if (state.view === 'matters') await renderMatters();
      else if (state.view === 'matter') await renderMatterDetail();
      else if (state.view === 'time') await renderTime();
      else if (state.view === 'approvals') await renderApprovals();
      else if (state.view === 'billing') await renderBilling();
      else if (state.view === 'reports') await renderReports();
      else if (state.view === 'settings') await renderSettings();
      else if (state.view === 'audit') await renderAudit();
      else await renderMatters();
    } catch (e) {
      const msg = e.message === 'forbidden'
        ? 'You do not have access to this section with your current role.'
        : e.message;
      main.innerHTML = `<div class="card"><div class="error">${msg}</div></div>`;
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
    const canConfigure = ['admin', 'billing_clerk'].includes(state.user.role);

    const [hits, recordTypes, clients, allMatters] = await Promise.all([
      api(`/api/matters?${params}`),
      api('/api/record-types'),
      api('/api/clients'),
      api('/api/matters'), // full list for dropdowns elsewhere; not shown here
    ]);
    state.matters = allMatters;
    state.clients = clients;
    const showCreate = canEdit && state.showCreateMatter;
    const defaultTypeKey = (recordTypes[0] && recordTypes[0].key) || 'default';
    const defaultTypeLabel = (recordTypes[0] && recordTypes[0].label) || 'Default';

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
      </div>

      ${canConfigure ? `
      <div class="card stack" id="defaultFieldsCard">
        <h2>Default fields</h2>
        <p class="hint">Manage fields on the <strong>${defaultTypeLabel}</strong> record type layout. These apply to matters that use the type layout.</p>
        <div id="defaultFieldsBody" class="stack"></div>
        <div id="typeFieldMsg"></div>
      </div>` : ''}`;

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

    if (canConfigure) {
      const key = defaultTypeKey;
      const renderDefaultFields = async () => {
        const typeLayout = await api(`/api/record-types/${encodeURIComponent(key)}/layout`);
        const body = $('#defaultFieldsBody');
        body.innerHTML = `
          <div class="field-mgmt-list">
            ${(typeLayout.fields || []).map((f) => `
              <div class="field-mgmt-row">
                <div>
                  <strong>${f.label}</strong>
                  <span class="muted"> · ${f.kind}${f.removable ? '' : ' · required'}</span>
                </div>
                ${f.removable ? `<button type="button" data-del-type-field="${f.fieldKey}">Delete</button>` : ''}
              </div>`).join('') || '<p class="muted">No fields</p>'}
          </div>
          ${(typeLayout.availableStandardFields || []).length ? `
          <form id="addTypeStandardForm" class="field-mgmt-add">
            <label>Add default field
              <select name="fieldKey" required>
                ${typeLayout.availableStandardFields.map((f) =>
                  `<option value="${f.key}">${f.label}</option>`).join('')}
              </select>
            </label>
            <button class="primary" type="submit">Add field</button>
          </form>` : '<p class="muted">All optional default fields are on this type.</p>'}
          <form id="typeFieldForm" class="grid two">
            <label>Custom field label
              <input name="label" required placeholder="Case stage" />
            </label>
            <label>Field type
              <select name="fieldType">
                <option value="text">Text</option>
                <option value="textarea">Text area</option>
                <option value="number">Number</option>
                <option value="date">Date</option>
                <option value="select">Select</option>
                <option value="checkbox">Checkbox</option>
              </select>
            </label>
            <div class="row-actions span-all">
              <button class="primary" type="submit">Add custom type field</button>
            </div>
          </form>`;

        body.querySelectorAll('[data-del-type-field]').forEach((btn) => {
          btn.onclick = async () => {
            try {
              await api(
                `/api/record-types/${encodeURIComponent(key)}/layout-fields?fieldKey=${encodeURIComponent(btn.dataset.delTypeField)}`,
                { method: 'DELETE' }
              );
              await renderDefaultFields();
            } catch (e) {
              $('#typeFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
            }
          };
        });
        const addStdType = $('#addTypeStandardForm');
        if (addStdType) {
          addStdType.onsubmit = async (ev) => {
            ev.preventDefault();
            const fd = new FormData(addStdType);
            try {
              await api(`/api/record-types/${encodeURIComponent(key)}/standard-fields`, {
                method: 'POST',
                body: JSON.stringify({ fieldKey: fd.get('fieldKey') }),
              });
              await renderDefaultFields();
            } catch (e) {
              $('#typeFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
            }
          };
        }
        const typeFieldForm = $('#typeFieldForm');
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
              $('#typeFieldMsg').innerHTML = '<div class="ok-banner">Custom type field added.</div>';
              await renderDefaultFields();
            } catch (e) {
              $('#typeFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
            }
          };
        }
      };
      await renderDefaultFields();
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
        if (!onedriveMeta.graphConfigured) {
          $('#onedriveMsg').innerHTML = `
            <div class="error">
              Live OneDrive sync needs a Microsoft Graph token.
              <div class="hint" style="margin-top:.5rem">
                Go to <strong>Settings → OneDrive / SharePoint</strong> (admin), paste a token from
                <a href="https://developer.microsoft.com/graph/graph-explorer" target="_blank" rel="noopener noreferrer">Graph Explorer</a>
                (sign in → Access token), then click Refresh again.
                Or use <strong>Load demo files</strong> / the <strong>OneDrive view</strong> tab for now.
              </div>
            </div>`;
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
          $('#onedriveMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
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

      <div class="card stack" id="onedriveCard">
        <h2>OneDrive</h2>
        <p class="hint">Link a matter folder, then browse files here like OneDrive/SharePoint — open folders, preview the live library, and sync from Microsoft Graph when a token is configured.</p>
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
              <p class="hint">Live sync is off until an admin adds a Graph token under <strong>Settings → OneDrive / SharePoint</strong>. Demo files load automatically when you link a folder; use <strong>OneDrive view</strong> for the real Microsoft library.</p>
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
            <p class="hint">If the embed asks you to sign in, use your Microsoft account. Some tenants block embedding — use <strong>Open in Microsoft</strong> or the Files tab after sync.</p>
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
          <p class="muted">No OneDrive folder linked yet. After linking, files and folders appear here for browsing.</p>
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

      ${canEdit ? `
      <div class="card stack">
        <h2>Manage fields</h2>
        <p class="hint">Add or delete fields on this matter, or on the default layout for record type <strong>${(page.typeLayout && page.typeLayout.label) || m.matter_type}</strong>.</p>

        <h3>Matter fields</h3>
        <div class="field-mgmt-list">
          ${(page.layoutFields || []).map((f) => `
            <div class="field-mgmt-row">
              <div>
                <strong>${f.label}</strong>
                <span class="muted"> · ${f.kind}${f.removable ? '' : ' · required'}</span>
              </div>
              ${f.removable ? `<button type="button" data-del-matter-field="${f.fieldKey}">Delete</button>` : ''}
            </div>`).join('') || '<p class="muted">No fields</p>'}
        </div>
        ${(page.availableStandardFields || []).length ? `
        <form id="addStandardFieldForm" class="field-mgmt-add">
          <label>Add field
            <select name="fieldKey" required>
              ${(page.availableStandardFields || []).map((f) =>
                `<option value="${f.key}">${f.label}</option>`).join('')}
            </select>
          </label>
          <button class="primary" type="submit">Add to matter</button>
        </form>` : '<p class="muted">All optional standard fields are on this matter.</p>'}
        <form id="recordFieldForm" class="grid two">
          <label>Custom field label <input name="label" required placeholder="Special billing note" /></label>
          <label>Field type
            <select name="fieldType">
              <option value="text">Text</option>
              <option value="textarea">Text area</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Select</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add custom field</button>
            ${page.layout.source !== 'record' ? '<button type="button" id="useRecordLayout">Use matter-only layout</button>' : ''}
          </div>
        </form>
        <div id="matterFieldMsg"></div>

        ${['admin', 'billing_clerk'].includes(state.user.role) && page.typeLayout ? `
        <h3>Default fields (${page.typeLayout.label})</h3>
        <p class="hint">Changes here apply to the record-type default layout.</p>
        <div class="field-mgmt-list">
          ${(page.typeLayout.fields || []).map((f) => `
            <div class="field-mgmt-row">
              <div>
                <strong>${f.label}</strong>
                <span class="muted"> · ${f.kind}${f.removable ? '' : ' · required'}</span>
              </div>
              ${f.removable ? `<button type="button" data-del-type-field="${f.fieldKey}">Delete</button>` : ''}
            </div>`).join('') || '<p class="muted">No fields</p>'}
        </div>
        ${(page.typeLayout.availableStandardFields || []).length ? `
        <form id="addTypeStandardOnMatterForm" class="field-mgmt-add">
          <label>Add default field
            <select name="fieldKey" required>
              ${page.typeLayout.availableStandardFields.map((f) =>
                `<option value="${f.key}">${f.label}</option>`).join('')}
            </select>
          </label>
          <button class="primary" type="submit">Add to default</button>
        </form>` : '<p class="muted">All optional default fields are on this type.</p>'}
        <form id="typeFieldOnMatterForm" class="grid two">
          <label>Custom type field label <input name="label" required placeholder="Case stage" /></label>
          <label>Field type
            <select name="fieldType">
              <option value="text">Text</option>
              <option value="textarea">Text area</option>
              <option value="number">Number</option>
              <option value="date">Date</option>
              <option value="select">Select</option>
              <option value="checkbox">Checkbox</option>
            </select>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add custom type field</button>
          </div>
        </form>
        <div id="typeFieldOnMatterMsg"></div>` : ''}
      </div>` : ''}`;

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

    main.querySelectorAll('[data-del-type-field]').forEach((btn) => {
      btn.onclick = async () => {
        try {
          await api(
            `/api/record-types/${encodeURIComponent(m.matter_type)}/layout-fields?fieldKey=${encodeURIComponent(btn.dataset.delTypeField)}`,
            { method: 'DELETE' }
          );
          await renderMatterDetail();
        } catch (e) {
          const el = $('#typeFieldOnMatterMsg');
          if (el) el.innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    });
    const addTypeStd = $('#addTypeStandardOnMatterForm');
    if (addTypeStd) {
      addTypeStd.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(addTypeStd);
        try {
          await api(`/api/record-types/${encodeURIComponent(m.matter_type)}/standard-fields`, {
            method: 'POST',
            body: JSON.stringify({ fieldKey: fd.get('fieldKey') }),
          });
          await renderMatterDetail();
        } catch (e) {
          $('#typeFieldOnMatterMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
    const typeOnMatter = $('#typeFieldOnMatterForm');
    if (typeOnMatter) {
      typeOnMatter.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(typeOnMatter);
        try {
          await api('/api/custom-fields', {
            method: 'POST',
            body: JSON.stringify({
              label: fd.get('label'),
              fieldType: fd.get('fieldType'),
              recordTypeKey: m.matter_type,
            }),
          });
          await renderMatterDetail();
        } catch (e) {
          $('#typeFieldOnMatterMsg').innerHTML = `<div class="error">${e.message}</div>`;
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
          <label class="span-all">Matter
            ${renderMatterPicker({ name: 'matterId', selectedId: preferredMatterId, matters })}
            <span class="hint">Type a matter number, name, or client to find it quickly.</span>
          </label>
          <label>Service date
            <input name="serviceDate" type="date" value="${today}" required />
          </label>
          <label>Minutes (raw)
            <input name="rawMinutes" type="number" min="1" value="7" required />
          </label>
          <label>Timekeeper
            <select name="timekeeperId">
              ${state.users.map((u) =>
                `<option value="${u.id}" ${u.id === state.user.id ? 'selected' : ''}>${u.name}</option>`
              ).join('')}
            </select>
          </label>
          <label>Category
            <input name="category" placeholder="e.g. Discovery" />
          </label>
          <label>Subcategory
            <input name="subcategory" placeholder="e.g. Document review" />
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
          <thead><tr><th>Date</th><th>Matter</th><th>Raw→Rnd</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${entries.slice(0, 30).map((e) => `
              <tr>
                <td>${e.service_date}</td>
                <td>${e.matter_number}<div class="muted">${e.description}</div></td>
                <td>${e.raw_minutes}m → <strong>${formatDuration(e.rounded_minutes)}</strong>
                  <span class="muted">(${e.rounded_minutes} min)</span></td>
                <td><span class="pill" data-status="${e.status}">${e.status}</span></td>
                <td class="row-actions">
                  ${e.status === 'draft' || e.status === 'rejected'
                    ? `<button data-submit="${e.id}">Submit</button>` : ''}
                </td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No entries yet</td></tr>'}
          </tbody>
        </table></div>
      </div>`;

    const matterPicker = wireMatterPicker($('#timeForm'), { matters });
    $('#timeForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd.entries());
      body.matterId = Number(body.matterId);
      body.timekeeperId = Number(body.timekeeperId);
      body.rawMinutes = Number(body.rawMinutes);
      if (!body.matterId) {
        matterPicker?.setInvalid(true);
        $('#timeMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
        matterPicker?.focus();
        return;
      }
      try {
        const entry = await api('/api/time-entries', { method: 'POST', body: JSON.stringify(body) });
        let msg = `Saved #${entry.id}: ${entry.rawMinutes}m → ${formatDuration(entry.roundedMinutes)} (${entry.roundedMinutes} min).`;
        if (entry.duplicateWarnings?.length) {
          msg += ` Duplicate warning vs entries ${entry.duplicateWarnings.join(', ')}.`;
        }
        $('#timeMsg').innerHTML = `<div class="ok-banner">${msg}</div>`;
        await renderTime();
      } catch (e) {
        $('#timeMsg').innerHTML = `<div class="error">${e.message}</div>`;
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

  async function renderApprovals() {
    const queue = await api('/api/approval-queue');
    main.innerHTML = `
      <div class="card">
        <h1>Approval Queue</h1>
        <p class="lead">Billing clerks/admins approve anything; lead attorneys approve their matters.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Matter</th><th>Timekeeper</th><th>Time</th><th></th></tr></thead>
          <tbody>
            ${queue.map((e) => `
              <tr>
                <td>${e.service_date}</td>
                <td>${e.matter_number}<div class="muted">${e.description}</div></td>
                <td>${e.timekeeper_name}</td>
                <td>${formatDuration(e.rounded_minutes)}</td>
                <td class="row-actions">
                  <button class="primary" data-approve="${e.id}">Approve</button>
                  <button data-reject="${e.id}">Reject</button>
                </td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">Queue empty</td></tr>'}
          </tbody>
        </table></div>
        <div id="apprMsg"></div>
      </div>`;
    main.querySelectorAll('[data-approve]').forEach((b) => {
      b.onclick = async () => {
        try {
          await api(`/api/time-entries/${b.dataset.approve}/approve`, { method: 'POST', body: '{}' });
          await renderApprovals();
        } catch (e) { $('#apprMsg').innerHTML = `<div class="error">${e.message}</div>`; }
      };
    });
    main.querySelectorAll('[data-reject]').forEach((b) => {
      b.onclick = async () => {
        const reason = prompt('Rejection reason?');
        if (!reason) return;
        try {
          await api(`/api/time-entries/${b.dataset.reject}/reject`, {
            method: 'POST', body: JSON.stringify({ reason }),
          });
          await renderApprovals();
        } catch (e) { $('#apprMsg').innerHTML = `<div class="error">${e.message}</div>`; }
      };
    });
  }

  async function renderBilling() {
    const [invoices, matters] = await Promise.all([
      api('/api/invoices'),
      api('/api/matters'),
    ]);
    state.matters = matters;
    main.innerHTML = `
      <div class="card">
        <h1>Billing</h1>
        <p class="lead">Generate pre-bill from approved WIP → write-down → review → approve → send.</p>
        <form id="prebillForm" class="grid two">
          <label class="span-all">Matter
            ${renderMatterPicker({ name: 'matterId', selectedId: null, matters })}
            <span class="hint">Search by matter number, name, or client.</span>
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Generate pre-bill</button>
          </div>
        </form>
        <div id="billMsg"></div>
      </div>
      <div class="card">
        <h2>Invoices</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Number</th><th>Matter</th><th>Status</th><th>Total</th><th></th></tr></thead>
          <tbody>
            ${invoices.map((i) => `
              <tr>
                <td>${i.number}</td>
                <td>${i.matter_number}<div class="muted">${i.client_name}</div></td>
                <td><span class="pill" data-status="${i.status}">${i.status}</span></td>
                <td>${money(i.total_cents)}</td>
                <td><button data-open="${i.id}">Open</button></td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No invoices</td></tr>'}
          </tbody>
        </table></div>
      </div>
      <div id="invoiceDetail"></div>`;

    const billMatterPicker = wireMatterPicker($('#prebillForm'), { matters });
    $('#prebillForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const matterId = Number(new FormData(ev.target).get('matterId'));
      if (!matterId) {
        billMatterPicker?.setInvalid(true);
        $('#billMsg').innerHTML = '<div class="error">Select a matter to continue.</div>';
        billMatterPicker?.focus();
        return;
      }
      try {
        const inv = await api('/api/invoices/prebill', {
          method: 'POST', body: JSON.stringify({ matterId }),
        });
        $('#billMsg').innerHTML = `<div class="ok-banner">Created ${inv.number}</div>`;
        await renderBilling();
        await showInvoice(inv.id);
      } catch (e) {
        $('#billMsg').innerHTML = `<div class="error">${e.message}</div>`;
      }
    };
    main.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = () => showInvoice(Number(b.dataset.open));
    });
  }

  async function showInvoice(id) {
    const inv = await api(`/api/invoices/${id}`);
    const el = $('#invoiceDetail');
    el.innerHTML = `
      <div class="card stack">
        <h2>${inv.number} <span class="pill" data-status="${inv.status}">${inv.status}</span></h2>
        <p class="muted">${inv.client_name} · ${inv.matter_number} · Subtotal ${money(inv.subtotal_cents)}
          · Write-down ${money(inv.write_down_cents)} · Total ${money(inv.total_cents)}</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Timekeeper</th><th>Hours</th><th>Rate</th><th>Amount</th><th>WD</th><th></th></tr></thead>
          <tbody>
            ${inv.lines.map((l) => `
              <tr>
                <td>${l.service_date}<div class="muted">${l.description}</div></td>
                <td>${l.timekeeper_name}</td>
                <td>${formatDuration(l.minutes)}</td>
                <td>${money(l.rate_cents)}</td>
                <td>${money(l.amount_cents)}</td>
                <td>${money(l.write_down_cents)}</td>
                <td>${['prebill','in_review'].includes(inv.status)
                  ? `<button data-wd="${l.id}">Write-down</button>` : ''}</td>
              </tr>`).join('')}
          </tbody>
        </table></div>
        <div class="row-actions" id="invActions"></div>
        <div id="invMsg"></div>
      </div>`;

    const actions = $('#invActions');
    const btn = (label, status, primary) => {
      const b = document.createElement('button');
      b.textContent = label;
      if (primary) b.className = 'primary';
      b.onclick = async () => {
        try {
          await api(`/api/invoices/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) });
          await renderBilling();
          await showInvoice(id);
        } catch (e) { $('#invMsg').innerHTML = `<div class="error">${e.message}</div>`; }
      };
      actions.appendChild(b);
    };
    if (inv.status === 'prebill') { btn('To review', 'in_review', true); btn('Void', 'void'); }
    if (inv.status === 'in_review') { btn('Approve', 'approved', true); btn('Back to pre-bill', 'prebill'); btn('Void', 'void'); }
    if (inv.status === 'approved') { btn('Send', 'sent', true); btn('Void', 'void'); }

    el.querySelectorAll('[data-wd]').forEach((b) => {
      b.onclick = async () => {
        const dollars = prompt('Write-down amount in dollars (e.g. 25.00)?');
        if (!dollars) return;
        const reason = prompt('Reason?') || 'adjustment';
        const parts = dollars.replace('$', '').split('.');
        const deltaCents = Number(parts[0]) * 100 + Number((parts[1] || '0').padEnd(2, '0').slice(0, 2));
        try {
          await api(`/api/invoice-lines/${b.dataset.wd}/write-down`, {
            method: 'POST', body: JSON.stringify({ deltaCents, reason }),
          });
          await showInvoice(id);
        } catch (e) { $('#invMsg').innerHTML = `<div class="error">${e.message}</div>`; }
      };
    });
  }

  async function renderPayments() {
    const payments = await api('/api/payments');
    const today = new Date().toISOString().slice(0, 10);
    main.innerHTML = `
      <div class="card">
        <h1>Payments / AR</h1>
        <p class="lead">Default application is oldest-first. Overpayment stays unapplied.</p>
        <form id="payForm" class="grid two">
          <label>Client
            <select name="clientId">
              ${state.clients.map((c) => `<option value="${c.id}">${c.name}</option>`).join('')}
            </select>
          </label>
          <label>Amount (cents)
            <input name="amountCents" type="number" min="1" value="50000" required />
          </label>
          <label>Received on
            <input name="receivedOn" type="date" value="${today}" required />
          </label>
          <label>Method
            <input name="method" value="check" />
          </label>
          <div class="row-actions"><button class="primary" type="submit">Record payment</button></div>
        </form>
        <div id="payMsg"></div>
      </div>
      <div class="card">
        <h2>Payments</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Date</th><th>Client</th><th>Amount</th><th>Applied</th><th>Unapplied</th></tr></thead>
          <tbody>
            ${payments.map((p) => `
              <tr>
                <td>${p.received_on}</td>
                <td>${p.client_name}</td>
                <td>${money(p.amount_cents)}</td>
                <td>${money(p.applied_cents)}</td>
                <td class="${p.unapplied_cents ? 'warn' : ''}">${money(p.unapplied_cents)}</td>
              </tr>`).join('') || '<tr><td colspan="5" class="muted">None</td></tr>'}
          </tbody>
        </table></div>
      </div>`;
    $('#payForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = {
        clientId: Number(fd.get('clientId')),
        amountCents: Number(fd.get('amountCents')),
        receivedOn: fd.get('receivedOn'),
        method: fd.get('method'),
      };
      try {
        const p = await api('/api/payments', { method: 'POST', body: JSON.stringify(body) });
        $('#payMsg').innerHTML = `<div class="ok-banner">Payment #${p.id} recorded. Unapplied: ${money(p.unappliedCents)}</div>`;
        await renderPayments();
      } catch (e) {
        $('#payMsg').innerHTML = `<div class="error">${e.message}</div>`;
      }
    };
  }

  async function renderReports() {
    const names = [
      ['lodestar-summary', 'Lodestar Summary'],
      ['lodestar-detail', 'Lodestar Detail'],
    ];
    main.innerHTML = `
      <div class="card">
        <h1>Reports</h1>
        <p class="lead">Export CSV or Excel (.xlsx with numeric currency cells).</p>
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

    main.innerHTML = `
      <div class="card stack">
        <h1>Settings</h1>
        <p class="lead">Time and billing preferences${isAdmin ? ', timekeepers, and rates' : ''}.</p>
        ${canEditBilling ? '' : '<div class="error">Sign in as an admin (avery@firm.example) or billing clerk (billie@firm.example) to edit these settings.</div>'}
      </div>

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
      <form id="onedriveSettingsForm" class="card stack">
        <h2>OneDrive / SharePoint</h2>
        <p class="lead">Status: <strong>${settings.msGraphConfigured ? 'Graph token configured' : 'Graph token not configured'}</strong></p>
        <p class="hint">Needed only for <strong>Refresh from OneDrive</strong> (live file list). Without it, matters still use the embedded OneDrive view and demo/local file browser.</p>
        <ol class="hint" style="padding-left:1.2rem;margin:.35rem 0 0.75rem">
          <li>Open <a href="https://developer.microsoft.com/graph/graph-explorer" target="_blank" rel="noopener noreferrer">Graph Explorer</a> and sign in with Microsoft.</li>
          <li>Consent to Files.Read.All / Sites.Read.All if prompted.</li>
          <li>Open the <strong>Access token</strong> tab → copy the token.</li>
          <li>Paste it below and save. Then open a matter → OneDrive → Refresh from OneDrive.</li>
        </ol>
        <p class="hint">Or set env <code>MS_GRAPH_ACCESS_TOKEN</code> before starting the server.</p>
        <label>Graph access token
          <input name="msGraphAccessToken" type="password" autocomplete="off"
            placeholder="${settings.msGraphConfigured ? '•••• configured — paste to replace' : 'Paste access token from Graph Explorer'}" />
        </label>
        <div class="row-actions">
          <button class="primary" type="submit">Save Graph token</button>
          ${settings.msGraphConfigured ? '<button type="button" id="clearGraphToken">Clear token</button>' : ''}
        </div>
        <div id="onedriveSettingsMsg"></div>
      </form>` : ''}

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
          <div class="row-actions" style="align-items:end">
            <button class="primary" type="submit">Add timekeeper</button>
          </div>
        </form>
        <div id="tkMsg"></div>
        ` : '<p class="hint">Only admins can add timekeepers. Billing clerks can add/change rates.</p>'}

        <div class="table-wrap"><table>
          <thead>
            <tr><th>Timekeeper</th><th>Role</th><th>Current rate</th><th>Effective</th><th>Add rate change</th></tr>
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
              </tr>`).join('') || '<tr><td colspan="5" class="muted">No timekeepers</td></tr>'}
          </tbody>
        </table></div>
        <div id="rateMsg"></div>
      </div>` : ''}`;

    wireChoiceGroup(main, 'durationFormat');
    wireChoiceGroup(main, 'roundMode');

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

    const odSettingsForm = $('#onedriveSettingsForm');
    if (odSettingsForm) {
      odSettingsForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const token = new FormData(odSettingsForm).get('msGraphAccessToken');
        if (!String(token || '').trim()) {
          $('#onedriveSettingsMsg').innerHTML = '<div class="error">Paste a token, or use Clear token.</div>';
          return;
        }
        try {
          await api('/api/settings', {
            method: 'PATCH',
            body: JSON.stringify({ msGraphAccessToken: token }),
          });
          $('#onedriveSettingsMsg').innerHTML = '<div class="ok-banner">Graph token saved.</div>';
          await renderSettings();
        } catch (e) {
          $('#onedriveSettingsMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
      const clearBtn = $('#clearGraphToken');
      if (clearBtn) {
        clearBtn.onclick = async () => {
          try {
            await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ msGraphAccessToken: '' }),
            });
            await renderSettings();
          } catch (e) {
            $('#onedriveSettingsMsg').innerHTML = `<div class="error">${e.message}</div>`;
          }
        };
      }
    }

    const tkForm = $('#tkForm');
    if (tkForm) {
      tkForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(tkForm);
        try {
          const defaultRateCents = dollarsToCents(fd.get('defaultRate'));
          await api('/api/users', {
            method: 'POST',
            body: JSON.stringify({
              name: fd.get('name'),
              email: fd.get('email'),
              role: fd.get('role'),
              defaultRateCents,
              rateEffectiveDate: fd.get('rateEffectiveDate'),
            }),
          });
          $('#tkMsg').innerHTML = '<div class="ok-banner">Timekeeper added.</div>';
          await refreshRefs();
          await renderSettings();
        } catch (e) {
          $('#tkMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }

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
