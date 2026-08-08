(() => {
  const state = {
    token: localStorage.getItem('billing_token') || null,
    user: null,
    view: 'time',
    matters: [],
    users: [],
    clients: [],
  };

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

  function hours(mins) {
    return (mins / 60).toFixed(2);
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
    const [matters, users, clients] = await Promise.all([
      api('/api/matters'),
      api('/api/users'),
      api('/api/clients'),
    ]);
    state.matters = matters;
    state.users = users;
    state.clients = clients;
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
            <input id="email" list="emails" placeholder="sam@firm.example" value="sam@firm.example" />
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
          <p class="hint">Demo: sam@firm.example or billie@firm.example → Time Entry → Billing → Reports.</p>
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
      ['time', 'Time Entry'],
      ['billing', 'Billing'],
      ['payments', 'Payments'],
      ['reports', 'Reports'],
    ];
    if (state.user.role === 'admin') items.push(['audit', 'Audit Log']);
    if (state.view === 'approvals') state.view = 'time';
    nav.innerHTML = items.map(([id, label]) =>
      `<button data-view="${id}" class="${state.view === id ? 'active' : ''}">${label}</button>`
    ).join('');
    nav.querySelectorAll('button').forEach((b) => {
      b.onclick = () => { state.view = b.dataset.view; renderShell(); renderView(); };
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
      if (state.view === 'time') await renderTime();
      else if (state.view === 'approvals') await renderApprovals();
      else if (state.view === 'billing') await renderBilling();
      else if (state.view === 'payments') await renderPayments();
      else if (state.view === 'reports') await renderReports();
      else if (state.view === 'audit') await renderAudit();
    } catch (e) {
      const msg = e.message === 'forbidden'
        ? 'You do not have access to this section with your current role.'
        : e.message;
      main.innerHTML = `<div class="card"><div class="error">${msg}</div></div>`;
    }
  }

  async function renderTime() {
    const entries = await api('/api/time-entries');
    const today = new Date().toISOString().slice(0, 10);
    main.innerHTML = `
      <div class="card">
        <h1>Time Entry</h1>
        <p class="lead">15-minute round-up. Zero minutes blocked. N.D. Cal matters need category/subcategory.</p>
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
                <td>${e.raw_minutes} → ${e.rounded_minutes} <span class="muted">(${hours(e.rounded_minutes)}h)</span></td>
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
        let msg = `Saved #${entry.id}: ${entry.rawMinutes} → ${entry.roundedMinutes} minutes.`;
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
                <td>${hours(e.rounded_minutes)}h</td>
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
                <td>${hours(l.minutes)}</td>
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
      ['wip', 'WIP'],
      ['ar-aging', 'AR Aging'],
      ['write-offs', 'Write-offs'],
      ['realization', 'Realization'],
      ['unapplied-cash', 'Unapplied Cash'],
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
