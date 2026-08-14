(() => {
  const root = document.getElementById('portalRoot');
  const token = String(location.pathname.split('/').pop() || '').trim();

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function fieldInput(field) {
    const id = `cf_${field.id}`;
    const type = field.fieldType || 'text';
    if (type === 'select' && field.options?.length) {
      return `<select id="${id}" name="${id}">
        <option value="">Select…</option>
        ${field.options.map((opt) => `<option value="${escapeHtml(opt)}">${escapeHtml(opt)}</option>`).join('')}
      </select>`;
    }
    if (type === 'textarea' || type === 'long_text') {
      return `<textarea id="${id}" name="${id}" rows="3"></textarea>`;
    }
    if (type === 'checkbox') {
      return `<label class="check-inline"><input type="checkbox" id="${id}" name="${id}" value="1" /> Yes</label>`;
    }
    const inputType = type === 'email' ? 'email' : type === 'date' ? 'date' : type === 'number' || type === 'currency' ? 'text' : 'text';
    return `<input id="${id}" name="${id}" type="${inputType}" autocomplete="off" />`;
  }

  async function load() {
    if (!/^[a-f0-9]{32,96}$/i.test(token)) {
      root.innerHTML = '<div class="card"><p class="error">This intake link is not valid.</p></div>';
      return;
    }
    const res = await fetch(`/api/portal/intake/${token}`, { headers: { Accept: 'application/json' } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      root.innerHTML = `<div class="card"><p class="error">${escapeHtml(data.error || 'This intake link is not available.')}</p></div>`;
      return;
    }
    const form = data.form || {};
    const fields = form.fields || [];
    root.innerHTML = `
      <div class="card portal-card">
        <p class="eyebrow">Client portal</p>
        <h1>${escapeHtml(form.name || 'Intake')}</h1>
        <p class="muted">${escapeHtml(data.firmName || 'the firm')} · ${escapeHtml(form.greeting || '')}</p>
        <p><a class="help-go" href="/portal/intake/call/${encodeURIComponent(token)}">Prefer to talk? Start an intake call</a></p>
        <form id="portalForm" class="stack">
          <label>Your name <input name="contactName" required autocomplete="name" /></label>
          <label>Email <input name="contactEmail" type="email" autocomplete="email" /></label>
          <label>Phone <input name="contactPhone" type="tel" autocomplete="tel" /></label>
          <label>Matter or case name <input name="matterName" autocomplete="off" /></label>
          ${fields.map((field) => `
            <label>${escapeHtml(field.label)}${field.required ? ' *' : ''}
              ${fieldInput(field)}
            </label>`).join('')}
          <p id="portalError" class="error" hidden></p>
          <button type="submit" class="btn primary">Submit intake</button>
        </form>
      </div>`;
    const formEl = document.getElementById('portalForm');
    const errEl = document.getElementById('portalError');
    formEl.onsubmit = async (ev) => {
      ev.preventDefault();
      errEl.hidden = true;
      const fd = new FormData(formEl);
      const values = {};
      for (const field of fields) {
        const raw = fd.get(`cf_${field.id}`);
        if (field.fieldType === 'checkbox') values[field.id] = formEl.querySelector(`#cf_${field.id}`)?.checked ? '1' : '0';
        else if (raw != null && String(raw).trim()) values[field.id] = String(raw).trim();
      }
      const payload = {
        contactName: String(fd.get('contactName') || '').trim(),
        contactEmail: String(fd.get('contactEmail') || '').trim(),
        contactPhone: String(fd.get('contactPhone') || '').trim(),
        matterName: String(fd.get('matterName') || '').trim(),
        values,
      };
      const submit = await fetch(`/api/portal/intake/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const out = await submit.json().catch(() => ({}));
      if (!submit.ok) {
        errEl.textContent = out.error || out.message || 'Could not submit intake.';
        errEl.hidden = false;
        return;
      }
      root.innerHTML = `<div class="card portal-card"><h1>Thank you</h1><p>Your information was received. The firm will review it shortly.</p></div>`;
    };
  }

  void load();
})();
