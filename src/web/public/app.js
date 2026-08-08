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
  };

  function canCreateMatter(user) {
    return !!user && ['admin', 'billing_clerk', 'attorney', 'paralegal'].includes(user.role);
  }

  const $ = (sel, el = document) => el.querySelector(sel);
  const main = $('#main');
  const nav = $('#nav');
  const userbar = $('#userbar');

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
    nav.hidden = true;
    userbar.textContent = '';
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
          <p class="hint">Demo: avery@firm.example → Matters → Create matter → Search → Time Entry → Billing.</p>
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

  function renderShell() {
    nav.hidden = false;
    const items = [
      ['matters', 'Matters'],
      ['time', 'Time Entry'],
      ['billing', 'Billing'],
      ['payments', 'Payments'],
      ['reports', 'Reports'],
      ['settings', 'Settings'],
    ];
    if (state.user.role === 'admin') items.push(['audit', 'Audit Log']);
    if (state.view === 'approvals') state.view = 'time';
    const activeView = state.view === 'matter' ? 'matters' : state.view;
    nav.innerHTML = items.map(([id, label]) =>
      `<button data-view="${id}" class="${activeView === id ? 'active' : ''}">${label}</button>`
    ).join('');
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
      <div class="who"><strong>${state.user.name}</strong><span>${state.user.role.replace('_', ' ')}</span></div>
      <button id="logout">Sign out</button>`;
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
      else if (state.view === 'payments') await renderPayments();
      else if (state.view === 'reports') await renderReports();
      else if (state.view === 'settings') await renderSettings();
      else if (state.view === 'audit') await renderAudit();
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

    main.innerHTML = `
      <div class="card stack page-card">
        <div class="page-head matters-toolbar">
          <h1>Matters</h1>
          <form id="matterSearch" class="matter-search-bar">
            <input name="q" value="${state.matterSearch.q || ''}"
              placeholder="Search matters…" aria-label="Search matters" />
            <button class="primary" type="submit">Search</button>
            <button type="button" id="clearSearch">Clear</button>
          </form>
          ${canEdit ? `
            <button type="button" class="primary create-matter-btn" id="createMatterBtn">
              ${showCreate ? 'Cancel' : 'Create matter'}
            </button>` : ''}
        </div>

        ${showCreate ? `
        <div id="createMatterSection" class="create-matter-panel">
          <form id="newMatterForm" class="create-matter-form">
            <input name="name" required placeholder="Matter name" aria-label="Matter name" />
            <button class="primary" type="submit">Save</button>
            <button type="button" id="cancelCreateMatter">Cancel</button>
          </form>
          <div id="newMatterMsg"></div>
        </div>` : ''}

        <div class="page-section">
          <h2>Results</h2>
          ${!hasQuery ? '<p class="muted">Enter a search term to query the matter index.</p>' : `
          <div class="table-wrap"><table>
            <thead>
              <tr><th>Number</th><th>Name</th><th>Client</th><th>Type</th><th>Status</th><th>Attorney</th></tr>
            </thead>
            <tbody>
              ${hits.map((m) => `
                <tr class="click-row" data-matter="${m.id}">
                  <td><strong>${m.number}</strong></td>
                  <td>${m.name}</td>
                  <td>${m.client_name}</td>
                  <td><span class="pill">${m.matter_type}</span></td>
                  <td><span class="pill" data-status="${m.status}">${m.status}</span></td>
                  <td>${m.attorney_name || '—'}</td>
                </tr>`).join('') || '<tr><td colspan="6" class="muted">No indexed matters match</td></tr>'}
            </tbody>
          </table></div>`}
        </div>
      </div>

      ${canConfigure ? `
      <div class="card stack">
        <h2>Record-type custom fields</h2>
        <p class="hint">Fields added here appear on all matters of that record type (and their type layout). Values are included in the search index.</p>
        <form id="typeFieldForm" class="grid two">
          <label>Record type
            <select name="recordTypeKey" required>
              ${recordTypes.map((t) => `<option value="${t.key}">${t.label}</option>`).join('')}
            </select>
          </label>
          <label>Field label
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
          <label>Select options (comma-separated)
            <input name="options" placeholder="Discovery, Trial, Appeal" />
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add type field</button>
          </div>
        </form>
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
    const createMatterBtn = $('#createMatterBtn');
    if (createMatterBtn) {
      createMatterBtn.onclick = async () => {
        state.showCreateMatter = !showCreate;
        await renderMatters();
      };
    }
    const cancelCreate = $('#cancelCreateMatter');
    if (cancelCreate) {
      cancelCreate.onclick = async () => {
        state.showCreateMatter = false;
        await renderMatters();
      };
    }
    if (showCreate) {
      const nameInput = $('#createMatterSection input[name="name"]');
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

    const typeFieldForm = $('#typeFieldForm');
    if (typeFieldForm) {
      typeFieldForm.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(typeFieldForm);
        const fieldType = fd.get('fieldType');
        const options = String(fd.get('options') || '')
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
        try {
          await api('/api/custom-fields', {
            method: 'POST',
            body: JSON.stringify({
              label: fd.get('label'),
              fieldType,
              recordTypeKey: fd.get('recordTypeKey'),
              options: fieldType === 'select' ? options : undefined,
            }),
          });
          $('#typeFieldMsg').innerHTML = '<div class="ok-banner">Record-type field added to that type layout.</div>';
          typeFieldForm.reset();
        } catch (e) {
          $('#typeFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
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
      const opts = (ctx.recordTypes || []).map((t) =>
        `<option value="${t.key}" ${String(val) === String(t.key) ? 'selected' : ''}>${t.label}</option>`
      ).join('');
      return `<select name="${name}" ${disabled} required>${opts}</select>`;
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
        <p class="lead">${m.name} · ${m.client_name || 'No client set'}</p>
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
        <h2>Add record-based custom field</h2>
        <p class="hint">Creates a field and layout item only for this matter record.</p>
        <form id="recordFieldForm" class="grid two">
          <label>Field label <input name="label" required placeholder="Special billing note" /></label>
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
          <label class="span-all">Select options (comma-separated)
            <input name="options" placeholder="A, B, C" />
          </label>
          <div class="row-actions span-all">
            <button class="primary" type="submit">Add field to this matter</button>
            ${page.layout.source !== 'record' ? '<button type="button" id="useRecordLayout">Switch this matter to its own layout</button>' : ''}
          </div>
        </form>
        <div id="recordFieldMsg"></div>
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
          else if (key === 'std:matter_type') patch.matterType = value;
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

    const rf = $('#recordFieldForm');
    if (rf) {
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        const fieldType = fd.get('fieldType');
        const options = String(fd.get('options') || '').split(',').map((s) => s.trim()).filter(Boolean);
        try {
          await api(`/api/matters/${m.id}/custom-fields`, {
            method: 'POST',
            body: JSON.stringify({
              label: fd.get('label'),
              fieldType,
              options: fieldType === 'select' ? options : undefined,
            }),
          });
          $('#recordFieldMsg').innerHTML = '<div class="ok-banner">Record field added.</div>';
          await renderMatterDetail();
        } catch (e) {
          $('#recordFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
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
          $('#recordFieldMsg').innerHTML = `<div class="error">${e.message}</div>`;
        }
      };
    }
  }

  async function renderTime() {
    const [entries, settings] = await Promise.all([
      api('/api/time-entries'),
      api('/api/settings'),
    ]);
    state.settings = settings;
    const today = new Date().toISOString().slice(0, 10);
    main.innerHTML = `
      <div class="card">
        <h1>Time Entry</h1>
        <form id="timeForm" class="grid two">
          <label class="span-all">Matter
            <select name="matterId" required>
              ${state.matters.map((m) => `<option value="${m.id}">${m.number} — ${m.name}</option>`).join('')}
            </select>
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

    $('#timeForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const fd = new FormData(ev.target);
      const body = Object.fromEntries(fd.entries());
      body.matterId = Number(body.matterId);
      body.timekeeperId = Number(body.timekeeperId);
      body.rawMinutes = Number(body.rawMinutes);
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
    const invoices = await api('/api/invoices');
    main.innerHTML = `
      <div class="card">
        <h1>Billing</h1>
        <p class="lead">Generate pre-bill from approved WIP → write-down → review → approve → send.</p>
        <form id="prebillForm" class="grid two">
          <label class="span-all">Matter
            <select name="matterId">
              ${state.matters.map((m) => `<option value="${m.id}">${m.number} — ${m.name}</option>`).join('')}
            </select>
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

    $('#prebillForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const matterId = Number(new FormData(ev.target).get('matterId'));
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
