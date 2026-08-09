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
    createMatterDraftName: '',
    createMatterRecordTypeKey: 'billable',
    settingsMatterRecordTypeKey: 'billable',
    settingsContactRecordTypeKey: 'person',
    focusTimeEntry: false,
    timeFlash: null,
    matterTimeFlash: null,
    matterFieldFlash: null,
    matterCreateFlash: null,
    showPostCreateFields: false,
    matterFieldPanelFlash: null,
    createMatterFieldMsg: null,
    createContactFieldMsg: null,
    createContactRecordTypeKey: 'person',
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
  };

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
        selectTimekeeper: proxy,
        viewOthers: full,
        modifyOthers: proxy,
        deleteOthers: full,
      };
    }
    const obj = entry.objects?.[objectKey] || entry[objectKey] || {};
    const base = {
      viewAll: obj.viewAll !== false,
      modifyAll: obj.modifyAll !== false,
      delete: !!obj.delete,
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
    confirmLabel = 'Confirm',
    cancelLabel = 'Cancel',
  } = {}) {
    return new Promise((resolve) => {
      const existing = document.querySelector('.confirm-overlay');
      if (existing) existing.remove();
      const overlay = document.createElement('div');
      overlay.className = 'confirm-overlay';
      overlay.innerHTML = `
        <div class="confirm-dialog" role="alertdialog" aria-modal="true"
          aria-labelledby="confirmTitle" aria-describedby="confirmMessage">
          <h2 id="confirmTitle">${escapeHtml(title)}</h2>
          ${message ? `<p id="confirmMessage">${escapeHtml(message)}</p>` : '<p id="confirmMessage" hidden></p>'}
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
    const scope = field?.scope || (field?.matter_id || field?.matterId ? 'record' : 'record_type');
    if (scope === 'record') return 'This matter only';
    if (scope === 'record_type') return 'Record type';
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
      .split(/[\n,]+/)
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
      isDefault: fd.get('isDefault') === 'on',
    };
    if (fieldType === 'dropdown' || fieldType === 'select') {
      body.options = options;
      body.optionsText = String(fd.get('optionsText') || '');
    }
    return { fieldType, options, body };
  }

  function dropdownOptionsFieldHtml(optionsText = '', { show = false } = {}) {
    return `
      <label class="span-all" data-dropdown-options ${show ? '' : 'hidden'}>
        Dropdown options
        <textarea name="optionsText" rows="3"
          placeholder="One option per line, or comma-separated&#10;e.g. Discovery&#10;Trial&#10;Appeal">${escapeHtml(optionsText)}</textarea>
        <span class="hint">Enter choices for the dropdown — one per line, or separated by commas</span>
      </label>`;
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
  } = {}) {
    const type = field
      ? (field.field_type || field.fieldType || field.type || 'text')
      : 'text';
    const uiType = type === 'select' ? 'dropdown' : type;
    const options = Array.isArray(field?.options)
      ? field.options.join('\n')
      : (field?.optionsText || '');
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
      <form id="${escapeHtml(formId)}" class="grid two">
        ${formHint ? `<p class="hint span-all">${formHint}</p>` : ''}
        ${scopeHtml}
        <label>Custom field label
          <input name="label" required value="${escapeHtml(label)}"
            placeholder="e.g. Case stage" />
        </label>
        <label>Custom field type
          <select name="fieldType">
            ${fieldFormatterOptions(uiType)}
          </select>
        </label>
        ${dropdownOptionsFieldHtml(options, { show: uiType === 'dropdown' })}
        <div class="span-all" data-default-field-wrap ${showDefault ? '' : 'hidden'}>
          ${defaultFieldCheckboxHtml(isDefault, defaultLabel)}
        </div>
        ${requiredFieldCheckboxHtml(required, requiredLabel)}
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
    if (!typeSelect || !optionsRow) return;
    const sync = () => {
      const isDropdown = typeSelect.value === 'dropdown' || typeSelect.value === 'select';
      optionsRow.hidden = !isDropdown;
      if (optionsInput) {
        optionsInput.required = isDropdown;
        if (!isDropdown) optionsInput.value = '';
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
      || (entityAppliesTo === 'client' ? 'person' : 'billable');
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
      if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
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
        const editing = editingId
          ? (fields || []).find((f) => Number(f.id) === Number(editingId))
          : null;
        const formId = appliesTo === 'client' ? 'contactFieldForm' : 'timeFieldForm';
        const canDeleteFields = isAdminUser();
        let contactConfig = null;
        if (appliesTo === 'client') {
          contactConfig = await api('/api/clients/field-config');
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
            })}`
            : customFieldFormHtml({
              formId,
              submitLabel: `Add ${scopeLabel} field`,
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
      if (!types.some((t) => t.key === key) && types[0]) key = types[0].key;
      const typeLayout = await api(`/api/record-types/${encodeURIComponent(key)}/layout`);
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
            <button type="button" id="showAddRecordType">Add record page</button>` : ''}
        </div>
        <p class="hint">Fields you add here are for the <strong>${escapeHtml(typeLabel)}</strong> record type — they appear on every ${escapeHtml(entityNoun)} of this type.${
          entityAppliesTo === 'matter'
            ? ' For a field on one matter only, open that matter and use Manage fields.'
            : ''
        }</p>
        <form id="addRecordTypeForm" class="stack" hidden>
          <div class="grid two">
            <label>Label *
              <input name="label" required placeholder="e.g. ${escapeHtml(typeExample)}" />
            </label>
            <label>Key
              <input name="key" placeholder="auto from label" />
            </label>
          </div>
          <div class="row-actions">
            <button class="primary" type="submit">Create record page</button>
            <button type="button" id="cancelAddRecordType">Cancel</button>
          </div>
        </form>`;
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
            formHint: `This field belongs to the <strong>${escapeHtml(typeLabel)}</strong> record type and shows on all ${escapeHtml(entityNoun)}s of that type.`,
          })}`
          : customFieldFormHtml({
            formId: 'typeFieldForm',
            submitLabel: 'Add to this record type',
            defaultLabel: 'Record type default field',
            requiredLabel: 'Record type required field',
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
      const showAddType = bodyEl.querySelector('#showAddRecordType');
      const addTypeForm = bodyEl.querySelector('#addRecordTypeForm');
      const cancelAddType = bodyEl.querySelector('#cancelAddRecordType');
      if (showAddType && addTypeForm) {
        showAddType.onclick = () => {
          addTypeForm.hidden = false;
          showAddType.hidden = true;
        };
      }
      if (cancelAddType && addTypeForm && showAddType) {
        cancelAddType.onclick = () => {
          addTypeForm.hidden = true;
          showAddType.hidden = false;
        };
      }
      if (addTypeForm) {
        addTypeForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const fd = new FormData(addTypeForm);
          const payload = {
            label: String(fd.get('label') || '').trim(),
            key: String(fd.get('key') || '').trim() || undefined,
          };
          try {
            const created = await api('/api/record-types', {
              method: 'POST',
              body: JSON.stringify({ ...payload, appliesTo: entityAppliesTo }),
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
    if (typeof entry === 'string') {
      const full = entry !== 'read_only';
      for (const key of Object.keys(objects)) {
        objects[key] = {
          viewAll: true,
          modifyAll: full,
          delete: full,
          ...(key === 'time' ? {
            selectTimekeeper: full && proxyDefault,
            viewOthers: full,
            modifyOthers: full && proxyDefault,
            deleteOthers: full,
          } : {}),
        };
      }
      return { objects };
    }
    for (const key of Object.keys(objects)) {
      const o = objectsSrc[key] || {};
      objects[key] = {
        viewAll: o.viewAll !== false,
        modifyAll: o.modifyAll !== false,
        delete: !!o.delete,
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
    return { objects };
  }

  async function bindRolePermissionsEditor({ bodyEl, msgEl, permissions } = {}) {
    if (!bodyEl || !permissions) return;
    const roles = permissions.roles || permissions.profiles || [];
    const objects = permissions.objects || [
      { key: 'matter', label: 'Matters' },
      { key: 'contact', label: 'Contacts' },
      { key: 'time', label: 'Time entries' },
      { key: 'report', label: 'Reports' },
    ];
    const timeExtraFlags = [
      { flag: 'selectTimekeeper', label: 'Select timekeeper' },
      { flag: 'viewOthers', label: 'View other timekeepers’ entries' },
      { flag: 'modifyOthers', label: 'Edit other timekeepers’ entries' },
      { flag: 'deleteOthers', label: 'Delete other timekeepers’ entries' },
    ];
    const current = {};
    for (const role of roles) {
      current[role.key] = normalizeRolePermEntry(
        (permissions.rolePermissions || {})[role.key]
          ?? (permissions.profilePermissions || {})[role.key],
        role.key
      );
    }
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
    const render = () => {
      bodyEl.innerHTML = `
        <div class="role-perms-list stack">
          ${roles.map((role) => {
            const locked = role.key === 'admin';
            const objs = current[role.key].objects;
            const timePerms = objs.time || {};
            return `
            <div class="role-perm-card" data-role="${escapeHtml(role.key)}">
              <h3>${escapeHtml(role.label)}${locked ? ' <span class="muted">(full access)</span>' : ''}</h3>
              <div class="table-wrap"><table class="perms-table role-object-perms">
                <thead>
                  <tr>
                    <th>Record</th>
                    <th>View All</th>
                    <th>Modify All</th>
                    <th>Delete</th>
                  </tr>
                </thead>
                <tbody>
                  ${objects.map((obj) => {
                    const p = objs[obj.key] || { viewAll: true, modifyAll: true, delete: true };
                    return `
                    <tr>
                      <td><strong>${escapeHtml(obj.label)}</strong></td>
                      <td><label class="check-inline"><input type="checkbox" data-role-perm="${escapeHtml(role.key)}" data-object="${escapeHtml(obj.key)}" data-flag="viewAll" ${p.viewAll ? 'checked' : ''} ${locked ? 'disabled' : ''} /></label></td>
                      <td><label class="check-inline"><input type="checkbox" data-role-perm="${escapeHtml(role.key)}" data-object="${escapeHtml(obj.key)}" data-flag="modifyAll" ${p.modifyAll ? 'checked' : ''} ${locked ? 'disabled' : ''} /></label></td>
                      <td><label class="check-inline"><input type="checkbox" data-role-perm="${escapeHtml(role.key)}" data-object="${escapeHtml(obj.key)}" data-flag="delete" ${p.delete ? 'checked' : ''} ${locked ? 'disabled' : ''} /></label></td>
                    </tr>`;
                  }).join('')}
                </tbody>
              </table></div>
              <div class="timekeeper-perms">
                <h4>Timekeeper access</h4>
                <p class="hint">Controls entering time for others and seeing other timekeepers’ names and entries.</p>
                <div class="timekeeper-perms-grid">
                  ${timeExtraFlags.map((item) => `
                    <label class="check-inline">
                      <input type="checkbox"
                        data-role-perm="${escapeHtml(role.key)}"
                        data-object="time"
                        data-flag="${escapeHtml(item.flag)}"
                        ${timePerms[item.flag] ? 'checked' : ''}
                        ${locked ? 'disabled' : ''} />
                      ${escapeHtml(item.label)}
                    </label>`).join('')}
                </div>
              </div>
            </div>`;
          }).join('')}
        </div>
        <div class="row-actions">
          <button class="primary" type="button" id="saveRolePermissions">Save role permissions</button>
        </div>`;
      bodyEl.querySelectorAll('[data-role-perm]').forEach((box) => {
        box.onchange = () => {
          const roleKey = box.dataset.rolePerm;
          const objectKey = box.dataset.object;
          const flag = box.dataset.flag;
          if (!current[roleKey]) current[roleKey] = normalizeRolePermEntry({}, roleKey);
          if (!current[roleKey].objects[objectKey]) {
            current[roleKey].objects[objectKey] = objectKey === 'time'
              ? ensureTimeObject(roleKey)
              : { viewAll: true, modifyAll: true, delete: false };
          }
          current[roleKey].objects[objectKey][flag] = !!box.checked;
          // Modify/Delete imply View All for usable access.
          if ((flag === 'modifyAll' || flag === 'delete') && box.checked) {
            current[roleKey].objects[objectKey].viewAll = true;
            const viewBox = bodyEl.querySelector(
              `[data-role-perm="${roleKey}"][data-object="${objectKey}"][data-flag="viewAll"]`
            );
            if (viewBox) viewBox.checked = true;
          }
          // Timekeeper extras imply related access.
          if (objectKey === 'time' && box.checked) {
            const timeObj = current[roleKey].objects.time;
            if (flag === 'selectTimekeeper' || flag === 'modifyOthers' || flag === 'deleteOthers') {
              timeObj.viewOthers = true;
              const viewOthersBox = bodyEl.querySelector(
                `[data-role-perm="${roleKey}"][data-object="time"][data-flag="viewOthers"]`
              );
              if (viewOthersBox) viewOthersBox.checked = true;
            }
            if (flag === 'modifyOthers' || flag === 'deleteOthers' || flag === 'viewOthers'
              || flag === 'selectTimekeeper') {
              timeObj.viewAll = true;
              const viewBox = bodyEl.querySelector(
                `[data-role-perm="${roleKey}"][data-object="time"][data-flag="viewAll"]`
              );
              if (viewBox) viewBox.checked = true;
            }
            if (flag === 'modifyOthers') {
              timeObj.modifyAll = true;
              const modifyBox = bodyEl.querySelector(
                `[data-role-perm="${roleKey}"][data-object="time"][data-flag="modifyAll"]`
              );
              if (modifyBox) modifyBox.checked = true;
            }
            if (flag === 'deleteOthers') {
              timeObj.delete = true;
              const delBox = bodyEl.querySelector(
                `[data-role-perm="${roleKey}"][data-object="time"][data-flag="delete"]`
              );
              if (delBox) delBox.checked = true;
            }
          }
        };
      });
      const saveBtn = $('#saveRolePermissions', bodyEl);
      if (saveBtn) {
        saveBtn.onclick = async () => {
          try {
            const updated = await api('/api/settings', {
              method: 'PATCH',
              body: JSON.stringify({ rolePermissions: current }),
            });
            state.settings = updated;
            const next = updated.permissions?.rolePermissions || current;
            for (const role of roles) {
              current[role.key] = normalizeRolePermEntry(next[role.key], role.key);
            }
            setMsg('<div class="ok-banner">Role permissions saved.</div>');
            render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };
    render();
  }

  async function bindFieldPermissionsEditor({ bodyEl, msgEl, permissions } = {}) {
    if (!bodyEl || !permissions) return;
    const roles = permissions.roles || permissions.profiles || [];
    let page = state.settingsLayoutPage || 'matter';
    const source = permissions.fieldPermissions || permissions.recordPageLayout || {};
    const layout = {
      matter: { ...(source.matter || {}) },
      contact: { ...(source.contact || {}) },
    };
    const catalogs = {
      matter: permissions.matterFields || [],
      contact: permissions.contactFields || [],
    };
    const setMsg = (html) => {
      if (msgEl) msgEl.innerHTML = html || '';
    };
    const fieldMode = (pageKey, fieldKey, roleKey) => {
      if (fieldKey === 'name' || fieldKey === 'std:name') return 'write';
      const row = layout[pageKey]?.[fieldKey];
      if (!row || row[roleKey] === undefined) return 'write';
      const raw = row[roleKey];
      if (raw === true || raw === 1) return 'write';
      if (raw === false || raw === 0) return 'hidden';
      const mode = String(raw).toLowerCase();
      if (mode === 'hidden' || mode === 'read' || mode === 'write') return mode;
      return 'write';
    };
    const render = () => {
      const fields = catalogs[page] || [];
      bodyEl.innerHTML = `
        <div class="row-actions" style="flex-wrap:wrap;gap:.5rem">
          <button type="button" data-layout-page="matter" class="${page === 'matter' ? 'primary' : ''}">Matter</button>
          <button type="button" data-layout-page="contact" class="${page === 'contact' ? 'primary' : ''}">Contact</button>
        </div>
        <div class="table-wrap"><table class="perms-table layout-vis-table field-perms-table">
          <thead>
            <tr>
              <th>Field</th>
              ${roles.map((p) => `<th>${escapeHtml(p.label)}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${fields.map((f) => {
              const locked = f.key === 'name' || f.key === 'std:name';
              return `
              <tr>
                <td>
                  <strong>${escapeHtml(f.label)}</strong>
                  <div class="muted">${escapeHtml(f.group || f.kind || '')}</div>
                </td>
                ${roles.map((p) => `
                  <td>
                    <select data-field-mode="${escapeHtml(f.key)}" data-field-role="${escapeHtml(p.key)}"
                      ${locked ? 'disabled' : ''} aria-label="${escapeHtml(f.label)} for ${escapeHtml(p.label)}">
                      <option value="hidden" ${fieldMode(page, f.key, p.key) === 'hidden' ? 'selected' : ''}>Hidden</option>
                      <option value="read" ${fieldMode(page, f.key, p.key) === 'read' ? 'selected' : ''}>Read</option>
                      <option value="write" ${fieldMode(page, f.key, p.key) === 'write' ? 'selected' : ''}>Read/Write</option>
                    </select>
                  </td>`).join('')}
              </tr>`;
            }).join('') || '<tr><td class="muted" colspan="5">No fields yet</td></tr>'}
          </tbody>
        </table></div>
        <div class="row-actions">
          <button class="primary" type="button" id="saveFieldPermissions">Save field permissions</button>
        </div>`;
      bodyEl.querySelectorAll('[data-layout-page]').forEach((btn) => {
        btn.onclick = () => {
          page = btn.dataset.layoutPage;
          state.settingsLayoutPage = page;
          setMsg('');
          render();
        };
      });
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
            for (const f of catalogs[page] || []) {
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
            setMsg('<div class="ok-banner">Field permissions saved.</div>');
            render();
          } catch (e) {
            setMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      }
    };
    render();
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
    ensureHelpAgent();
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
    setHelpAgentVisible(false);
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
    state.createMatterRecordTypeKey = 'billable';
    state.createMatterDraftName = '';
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
    if (!canCreateMatter(state.user) || !roleCanModify('contact')) {
      state.view = 'contacts';
      state.contactId = null;
      renderShell();
      renderView();
      return;
    }
    state.showCreateContact = true;
    state.view = 'contacts';
    state.contactId = null;
    state.showCreateMatter = false;
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
      roleCanView('matter') ? ['matters', 'Matters', 'matters', 'Matters & search'] : null,
      roleCanView('contact') ? ['contacts', 'Contacts', 'contacts', 'People & companies'] : null,
      ['billing', 'Billing', 'billing', 'Create bills'],
      roleCanView('report') ? ['reports', 'Reports', 'reports', 'Lodestar & custom'] : null,
      roleCanView('report') ? ['dashboard', 'Dashboard', 'dashboard', 'Report visuals'] : null,
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
    const activeView = state.view === 'matter'
      ? 'matters'
      : state.view === 'contact'
        ? 'contacts'
        : state.view;

    if (sidebarActions) {
      sidebarActions.innerHTML = `
        <p class="sidebar-label">Quick actions</p>
        ${canCreateMatter(state.user) && roleCanModify('matter')
          ? `<button type="button" class="sidebar-action primary" id="sideAddMatter">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('plus')}</span>
              <span class="sidebar-action-text">
                <strong>Create Matter</strong>
                <small>Open create + search</small>
              </span>
            </button>`
          : ''}
        ${canCreateMatter(state.user) && roleCanModify('contact')
          ? `<button type="button" class="sidebar-action primary" id="sideAddContact">
              <span class="sidebar-action-mark" aria-hidden="true">${navIcon('contacts')}</span>
              <span class="sidebar-action-text">
                <strong>Create Contact</strong>
                <small>Add a person or company</small>
              </span>
            </button>`
          : ''}
        ${roleCanModify('time') ? `
        <button type="button" class="sidebar-action secondary" id="sideAddTime">
          <span class="sidebar-action-mark" aria-hidden="true">${navIcon('time')}</span>
          <span class="sidebar-action-text">
            <strong>Add Time Entry</strong>
            <small>Log time on a matter</small>
          </span>
        </button>` : ''}`;
      const sideAddMatter = $('#sideAddMatter');
      if (sideAddMatter) sideAddMatter.onclick = () => goAddMatter();
      const sideAddContact = $('#sideAddContact');
      if (sideAddContact) sideAddContact.onclick = () => goAddContact();
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
        if (state.view !== 'contact') state.contactId = null;
        if (state.view !== 'contacts') state.showCreateContact = false;
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
    ensureHelpAgent();
  }

  async function renderView() {
    try {
      if (state.view === 'matters') await renderMatters();
      else if (state.view === 'matter') await renderMatterDetail();
      else if (state.view === 'contacts') await renderContacts();
      else if (state.view === 'contact') await renderContactDetail();
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
    const canEdit = canCreateMatter(state.user) && roleCanModify('matter');

    const showCreate = canEdit && state.showCreateMatter;
    const [hits, clients, allMatters, recordTypes, createSettings] = await Promise.all([
      api(`/api/matters?${params}`),
      api('/api/clients').catch(() => state.clients || []),
      api('/api/matters'), // full list for dropdowns elsewhere; not shown here
      showCreate
        ? api('/api/record-types').catch(() => [])
        : Promise.resolve([]),
      showCreate
        ? api('/api/settings').catch(() => state.settings || {})
        : Promise.resolve(state.settings || {}),
    ]);
    state.matters = allMatters;
    state.clients = clients || [];
    if (createSettings && Object.keys(createSettings).length) state.settings = createSettings;
    const nameFormula = createSettings?.matterNameFormula || state.settings?.matterNameFormula || null;
    const formulaActive = !!(nameFormula?.enabled && (nameFormula.parts || []).length);
    const draftName = state.createMatterDraftName || '';
    const createFieldMsg = state.createMatterFieldMsg;
    state.createMatterFieldMsg = null;
    let createRecordTypeKey = state.createMatterRecordTypeKey || 'billable';
    if ((recordTypes || []).length && !recordTypes.some((t) => t.key === createRecordTypeKey)) {
      createRecordTypeKey = recordTypes[0].key;
      state.createMatterRecordTypeKey = createRecordTypeKey;
    }
    const createTypeLabel = ((recordTypes || []).find((t) => t.key === createRecordTypeKey) || {}).label
      || createRecordTypeKey;
    const createMatterFields = showCreate
      ? await api(`/api/custom-fields?appliesTo=matter&type=${encodeURIComponent(createRecordTypeKey)}`).catch(() => [])
      : [];
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
      required: !!f.required || formulaFieldIds.has(Number(f.id)),
      fieldId: f.id,
      kind: 'custom',
      width: f.field_type === 'textarea' ? 'full' : 'half',
      value: null,
      inNameFormula: formulaFieldIds.has(Number(f.id)),
    }));
    // Put formula name fields first so they read with the name builder.
    createFieldDefs.sort((a, b) => Number(b.inNameFormula) - Number(a.inNameFormula));
    const createCustomRows = mergedCreateFields.filter((f) => f.id != null);

    main.innerHTML = `
      <div class="card stack page-card">
        <div class="page-head matters-toolbar">
          <h1>${showCreate ? 'Create Matter' : 'Matters'}</h1>
        </div>

        ${showCreate ? `
        <div id="createMatterSection" class="create-matter-panel page-section">
          <form id="newMatterForm" class="create-matter-form">
            <label class="create-matter-label" for="createMatterName">Create Matter</label>
            ${formulaActive ? `
              <p class="hint">Matter name is built from:
                ${escapeHtml((nameFormula.parts || []).map((p) => p.label || (p.kind === 'token' ? 'Year' : 'Field')).join(nameFormula.separator || '-'))}</p>
            ` : ''}
            <div class="create-matter-row">
              <input id="createMatterName" name="name" ${formulaActive ? 'readonly' : 'required'}
                value="${escapeHtml(draftName)}"
                placeholder="${formulaActive ? 'Fills from name fields below' : 'Create Matter'}"
                aria-label="Create Matter" />
              <button class="primary" type="submit">Create</button>
              <button type="button" id="cancelCreateMatter">Cancel</button>
            </div>
            <div class="grid two create-matter-custom">
              <label>Record type
                <select name="recordTypeKey" id="createMatterTypeSelect" required>
                  ${(recordTypes || []).map((t) => `
                    <option value="${escapeHtml(t.key)}" ${t.key === createRecordTypeKey ? 'selected' : ''}>
                      ${escapeHtml(t.label || t.key)}
                    </option>`).join('') || `
                    <option value="billable" selected>Billable</option>
                    <option value="non_billable">Non-Billable</option>`}
                </select>
              </label>
              ${createFieldDefs.map((field) => `
                <label class="${field.width === 'full' ? 'span-all' : ''}${field.inNameFormula ? ' name-formula-field' : ''}">
                  ${escapeHtml(field.label)}${field.required ? ' *' : ''}${field.inNameFormula ? ' <span class="muted">(name)</span>' : ''}
                  ${renderFieldInput(field, { canEdit: true })}
                </label>`).join('')}
            </div>
          </form>
          <div id="newMatterMsg"></div>
        </div>

        <div id="createMatterFieldsPanel" class="card stack page-section create-matter-fields-panel">
          <h2>Add record type fields</h2>
          <p class="hint">Fields added here go on the <strong>${escapeHtml(createTypeLabel)}</strong> record type — every matter of that type gets them. To add a field for one matter only, create the matter first, then use Manage fields on that matter.</p>
          <div class="field-mgmt-list">
            ${createCustomRows.map((f) => `
              <div class="field-mgmt-row">
                <div>
                  <strong>${escapeHtml(f.label)}</strong>
                  <span class="muted"> · ${escapeHtml(fieldTypeLabel(f.field_type))} · record type${f.required ? ' · required' : ''}</span>
                </div>
              </div>`).join('') || `<p class="muted">No custom fields for ${escapeHtml(createTypeLabel)} yet</p>`}
          </div>
          ${customFieldFormHtml({
            formId: 'createMatterFieldForm',
            submitLabel: 'Add to this record type',
            defaultLabel: 'Record type default field',
            requiredLabel: 'Record type required field',
            formHint: `Adds the field to the <strong>${escapeHtml(createTypeLabel)}</strong> record type layout.`,
          })}
          <div id="createMatterFieldMsg">${createFieldMsg ? successNoticeHtml(createFieldMsg) : ''}</div>
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
        state.createMatterDraftName = '';
        state.createMatterRecordTypeKey = 'billable';
        state.createMatterFieldMsg = null;
        await renderMatters();
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
          nameInput.addEventListener('input', () => {
            state.createMatterDraftName = String(nameInput.value || '');
          });
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
      const createFieldForm = $('#createMatterFieldForm');
      wireDropdownOptionsToggle(createFieldForm);
      if (createFieldForm) {
        createFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const nameEl = $('#createMatterName');
          if (nameEl) state.createMatterDraftName = String(nameEl.value || '');
          const typeKey = state.createMatterRecordTypeKey || 'billable';
          const fd = new FormData(createFieldForm);
          const { fieldType, options, body } = customFieldPayload(fd);
          if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
            $('#createMatterFieldMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
            return;
          }
          try {
            await api('/api/custom-fields', {
              method: 'POST',
              body: JSON.stringify({ ...body, recordTypeKey: typeKey, appliesTo: 'matter' }),
            });
            state.createMatterFieldMsg = {
              title: 'Record type field added',
              detail: `${body.label || 'Field'} added to the ${createTypeLabel} record type.`,
            };
            await renderMatters();
            const panel = $('#createMatterFieldsPanel');
            if (panel?.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (e) {
            $('#createMatterFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          }
        };
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
        const sure = await confirmAction({
          title: 'Create this matter?',
          message: `Create “${name}”? You can add time and details after it’s created.`,
          confirmLabel: 'Yes, create matter',
          cancelLabel: 'Not yet',
        });
        if (!sure) return;

        const recordTypeKey = String(
          fd.get('recordTypeKey') || state.createMatterRecordTypeKey || 'billable'
        ).trim();
        try {
          const page = await api('/api/matters', {
            method: 'POST',
            body: JSON.stringify({
              name,
              recordTypeKey,
              customValues,
            }),
          });
          await refreshRefs();
          state.showCreateMatter = false;
          state.createMatterDraftName = '';
          state.createMatterRecordTypeKey = 'billable';
          state.createMatterFieldMsg = null;
          state.matterSearch = { q: page.matter.name };
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
    const [contacts, fieldConfig, recordTypes] = await Promise.all([
      api(`/api/clients${q ? `?q=${encodeURIComponent(q)}` : ''}`),
      api('/api/clients/field-config').catch(() => ({ enabledStandard: [], enabledKeys: [] })),
      showCreate
        ? api('/api/record-types?appliesTo=client').catch(() => [])
        : Promise.resolve([]),
    ]);
    state.clients = contacts || state.clients || [];
    const enabledStd = fieldConfig.enabledStandard || [];
    const listCols = enabledStd.filter((f) => f.key !== 'notes');
    const searchBits = ['name', ...enabledStd.map((f) => f.label.toLowerCase())];
    const listFlash = state.contactListFlash;
    state.contactListFlash = null;
    const createFieldMsg = state.createContactFieldMsg;
    state.createContactFieldMsg = null;
    let createRecordTypeKey = state.createContactRecordTypeKey || 'person';
    if ((recordTypes || []).length && !recordTypes.some((t) => t.key === createRecordTypeKey)) {
      createRecordTypeKey = recordTypes[0].key;
      state.createContactRecordTypeKey = createRecordTypeKey;
    }
    const createTypeLabel = ((recordTypes || []).find((t) => t.key === createRecordTypeKey) || {}).label
      || createRecordTypeKey;
    const createFields = showCreate
      ? await api(
        `/api/custom-fields?appliesTo=client&type=${encodeURIComponent(createRecordTypeKey)}`
      ).catch(() => [])
      : [];
    const createFieldDefs = (createFields || []).map((f) => ({
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
    const createCustomRows = (createFields || []).filter((f) => f.id != null);

    main.innerHTML = `
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
                    <option value="person" selected>Person</option>
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
        </div>

        <div id="createContactFieldsPanel" class="card stack page-section create-matter-fields-panel">
          <h2>Add record type fields</h2>
          <p class="hint">Fields added here go on the <strong>${escapeHtml(createTypeLabel)}</strong> record type — every contact of that type gets them.</p>
          <div class="field-mgmt-list">
            ${createCustomRows.map((f) => `
              <div class="field-mgmt-row">
                <div>
                  <strong>${escapeHtml(f.label)}</strong>
                  <span class="muted"> · ${escapeHtml(fieldTypeLabel(f.field_type))} · record type${f.required ? ' · required' : ''}</span>
                </div>
              </div>`).join('') || `<p class="muted">No custom fields for ${escapeHtml(createTypeLabel)} yet</p>`}
          </div>
          ${customFieldFormHtml({
            formId: 'createContactFieldForm',
            submitLabel: 'Add to this record type',
            defaultLabel: 'Record type default field',
            requiredLabel: 'Record type required field',
            formHint: `Adds the field to the <strong>${escapeHtml(createTypeLabel)}</strong> record type layout.`,
          })}
          <div id="createContactFieldMsg">${createFieldMsg ? successNoticeHtml(createFieldMsg) : ''}</div>
        </div>` : ''}

        <div class="page-section">
          <h2>Search contacts</h2>
          <form id="contactSearch" class="matter-search-bar">
            <input name="q" value="${escapeHtml(q)}"
              placeholder="Search by ${escapeHtml(searchBits.join(', '))}…" aria-label="Search contacts" />
            <button class="primary" type="submit">Search</button>
            <button type="button" id="clearContactSearch">Clear</button>
          </form>
        </div>

        <div class="page-section">
          <h2>All contacts</h2>
          <div class="table-wrap"><table>
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                ${listCols.map((f) => `<th>${escapeHtml(f.label)}</th>`).join('')}
              </tr>
            </thead>
            <tbody>
              ${(contacts || []).map((c) => `
                <tr class="click-row" data-contact="${c.id}">
                  <td><strong>${escapeHtml(c.name)}</strong></td>
                  <td>${escapeHtml(c.record_type || 'person')}</td>
                  ${listCols.map((f) => `<td>${escapeHtml(c[f.key] || '—')}</td>`).join('')}
                </tr>`).join('') || `<tr><td colspan="${2 + listCols.length}" class="muted">No contacts yet</td></tr>`}
            </tbody>
          </table></div>
        </div>
      </div>`;

    const startCreate = $('#startCreateContact');
    if (startCreate) startCreate.onclick = () => goAddContact();
    const cancelCreate = $('#cancelCreateContact');
    if (cancelCreate) {
      cancelCreate.onclick = async () => {
        state.showCreateContact = false;
        state.createContactRecordTypeKey = 'person';
        state.createContactFieldMsg = null;
        await renderContacts();
      };
    }
    if (showCreate) {
      const typeSelect = $('#createContactTypeSelect');
      if (typeSelect) {
        typeSelect.onchange = async () => {
          state.createContactRecordTypeKey = typeSelect.value || 'person';
          await renderContacts();
        };
      }
      const createFieldForm = $('#createContactFieldForm');
      wireDropdownOptionsToggle(createFieldForm);
      if (createFieldForm) {
        createFieldForm.onsubmit = async (ev) => {
          ev.preventDefault();
          const typeKey = state.createContactRecordTypeKey || 'person';
          const fd = new FormData(createFieldForm);
          const { fieldType, options, body } = customFieldPayload(fd);
          if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
            $('#createContactFieldMsg').innerHTML = '<div class="error">Add at least one dropdown option.</div>';
            return;
          }
          try {
            await api('/api/custom-fields', {
              method: 'POST',
              body: JSON.stringify({
                ...body,
                recordTypeKey: typeKey,
                appliesTo: 'client',
              }),
            });
            state.createContactFieldMsg = {
              title: 'Record type field added',
              detail: `${body.label || 'Field'} added to the ${createTypeLabel} record type.`,
            };
            await renderContacts();
            const panel = $('#createContactFieldsPanel');
            if (panel?.scrollIntoView) panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          } catch (e) {
            $('#createContactFieldMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
          }
        };
      }
    }
    $('#contactSearch').onsubmit = async (ev) => {
      ev.preventDefault();
      state.contactSearch = { q: String(new FormData(ev.target).get('q') || '').trim() };
      await renderContacts();
    };
    $('#clearContactSearch').onclick = async () => {
      state.contactSearch = { q: '' };
      await renderContacts();
    };
    main.querySelectorAll('[data-contact]').forEach((row) => {
      row.onclick = () => openContact(Number(row.dataset.contact));
    });

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
        const sure = await confirmAction({
          title: 'Create this contact?',
          message: `Create “${name}”? You can edit details and custom fields after it’s created.`,
          confirmLabel: 'Yes, create contact',
          cancelLabel: 'Not yet',
        });
        if (!sure) return;

        const customValues = {};
        for (const [key, value] of fd.entries()) {
          if (String(key).startsWith('cf_')) customValues[key.slice(3)] = value;
        }
        createFieldDefs.forEach((f) => {
          if (f.type === 'checkbox' && customValues[f.fieldId] == null) {
            customValues[f.fieldId] = '0';
          }
        });
        const recordTypeKey = String(
          fd.get('recordTypeKey') || state.createContactRecordTypeKey || 'person'
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
          state.showCreateContact = false;
          state.createContactRecordTypeKey = 'person';
          state.createContactFieldMsg = null;
          state.contactCreateFlash = {
            title: 'Contact created',
            detail: page.client.name,
          };
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
    const canDelete = canCreateMatter(state.user) && page.canDelete !== false && roleCanDelete('contact');
    const c = page.client;
    const fields = page.fields || [];
    const enabledStd = (page.fieldConfig && page.fieldConfig.enabledStandard) || [];
    const flash = state.contactFlash;
    const createFlash = state.contactCreateFlash;
    state.contactFlash = null;
    state.contactCreateFlash = null;

    const canCreate = canCreateMatter(state.user) && roleCanModify('contact');
    main.innerHTML = `
      <div class="card">
        <div class="page-head matters-toolbar" style="margin-bottom:.75rem">
          <div class="row-actions">
            <button type="button" id="backContacts">← Contacts</button>
            ${canDelete ? '<button type="button" id="deleteContact">Delete contact</button>' : ''}
          </div>
          ${canCreate
            ? '<button type="button" class="primary" id="createContactFromDetail">Create contact</button>'
            : ''}
        </div>
        <h1>${escapeHtml(c.name || 'Contact')}</h1>
        <p class="muted">Record type: ${escapeHtml(page.recordTypeLabel || c.record_type || 'Person')}</p>
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
      </form>`;

    $('#backContacts').onclick = () => {
      state.view = 'contacts';
      state.contactId = null;
      renderShell();
      renderView();
    };

    const createFromDetail = $('#createContactFromDetail');
    if (createFromDetail) createFromDetail.onclick = () => goAddContact();

    const deleteBtn = $('#deleteContact');
    if (deleteBtn && canDelete) {
      deleteBtn.onclick = async () => {
        const sure = await confirmAction({
          title: 'Delete this contact?',
          message: `Are you sure you want to delete “${c.name || 'this contact'}”? This cannot be undone.`,
          confirmLabel: 'Yes, delete contact',
          cancelLabel: 'Cancel',
        });
        if (!sure) return;
        try {
          await api(`/api/clients/${c.id}`, { method: 'DELETE' });
          state.contactId = null;
          state.view = 'contacts';
          state.contactFlash = null;
          state.contactListFlash = {
            title: 'Contact deleted',
            detail: c.name || 'The contact was removed.',
          };
          await refreshRefs();
          renderShell();
          await renderContacts();
        } catch (e) {
          $('#contactMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
        }
      };
    }

    const form = $('#contactForm');
    if (form && canEdit) {
      form.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(form);
        const customValues = {};
        for (const [key, value] of fd.entries()) {
          if (String(key).startsWith('cf_')) {
            customValues[key.slice(3)] = value;
          }
        }
        form.querySelectorAll('input[type="checkbox"][name^="cf_"]').forEach((cb) => {
          customValues[cb.name.slice(3)] = cb.checked ? '1' : '0';
        });
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
    const canSelectTk = roleCanSelectTimekeeper();
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
      <label>Date
        <input name="serviceDate" type="date" value="${escapeHtml(formDate)}" required />
      </label>
      <label>Hours
        <input name="hours" type="number" min="0.25" step="0.25" inputmode="decimal"
          value="${escapeHtml(formHours)}" placeholder="0.25" required />
      </label>
      <label>Timekeeper
        ${canSelectTk ? `
        <select name="timekeeperId">
          ${timekeeperOptions.map((u) =>
            `<option value="${u.id}" ${Number(u.id) === Number(selectedId) ? 'selected' : ''}>${escapeHtml(u.name)}</option>`
          ).join('')}
        </select>` : `
        <input type="hidden" name="timekeeperId" value="${lockedId}" />
        <input type="text" value="${escapeHtml(selfName)}" disabled aria-label="Timekeeper" />`}
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
      body.timekeeperId = roleCanSelectTimekeeper()
        ? Number(body.timekeeperId || state.user.id)
        : Number(state.user.id);
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
    const matterReports = [
      ['lodestar-matter-detail', 'Lodestar Detail', 'Simple list of time worked on this matter'],
      ['lodestar-matter-summary', 'Lodestar Summary', 'Hours and amounts by timekeeper'],
    ];
    const today = new Date().toISOString().slice(0, 10);
    const retain = state.matterTimeRetain || {};
    const formDate = retain.serviceDate || today;
    const formTimekeeperId = roleCanSelectTimekeeper()
      ? (retain.timekeeperId || state.user.id)
      : state.user.id;
    const formHours = '';
    const formDescription = '';
    const flash = state.matterTimeFlash;
    const matterFlash = state.matterFieldFlash;
    const createFlash = state.matterCreateFlash;
    const fieldPanelFlash = state.matterFieldPanelFlash;
    const showPostCreateFields = canEdit && !!state.showPostCreateFields;
    state.matterTimeFlash = null;
    state.matterFieldFlash = null;
    state.matterCreateFlash = null;
    state.matterFieldPanelFlash = null;
    state.matterTimeRetain = null;
    const editingField = state.editingMatterFieldId
      ? (page.layoutFields || []).find(
        (f) => Number(fieldIdFromMgmt(f)) === Number(state.editingMatterFieldId)
      )
      : null;
    const editingFieldScope = editingField
      ? (editingField.scope === 'record' || editingField.matter_id || editingField.matterId
        ? 'record'
        : 'record_type')
      : null;
    const fieldMgmtPanelHtml = (opts = {}) => {
      const {
        title = 'Manage fields',
        hint = `Choose whether a new field is for this matter only, or for every <strong>${escapeHtml(matterTypeLabel)}</strong> matter (record type). Record type fields can also be managed in Settings → Matter record pages.`,
        formId = 'recordFieldForm',
        panelId = '',
        showDismiss = false,
        msgHtml = '',
      } = opts;
      const isEditingMatterOnly = editingFieldScope === 'record';
      return `
      <div class="card stack${showDismiss ? ' post-create-fields-panel' : ''}"${panelId ? ` id="${panelId}"` : ''}>
        <div class="page-head matters-toolbar" style="margin:0">
          <h2 style="margin:0">${escapeHtml(title)}</h2>
          ${showDismiss ? '<button type="button" id="dismissPostCreateFields">Done</button>' : ''}
        </div>
        <p class="hint">${hint}</p>
        <div class="field-mgmt-list">
          ${fieldMgmtRows(page.layoutFields, { showScope: true })}
        </div>
        ${editingField
          ? `<h3 class="field-edit-title">Edit ${isEditingMatterOnly ? 'matter' : 'record type'} field</h3>${customFieldFormHtml({
            formId,
            submitLabel: 'Save changes',
            field: editingField,
            showCancel: true,
            showDefault: !isEditingMatterOnly,
            defaultLabel: 'Record type default field',
            requiredLabel: isEditingMatterOnly ? 'Required on this matter' : 'Record type required field',
            formHint: isEditingMatterOnly
              ? 'This field is for <strong>this matter only</strong>.'
              : `This field is on the <strong>${escapeHtml(matterTypeLabel)}</strong> record type (all matters of this type).`,
          })}`
          : customFieldFormHtml({
            formId,
            submitLabel: 'Add field',
            showDefault: false,
            defaultLabel: 'Record type default field',
            requiredLabel: 'Required field',
            scopeField: {
              selectId: `${formId}Scope`,
              selected: 'record',
              options: [
                { value: 'record', label: 'This matter only' },
                { value: 'record_type', label: `All ${matterTypeLabel} matters (record type)` },
              ],
              hint: 'This matter only = one matter. Record type = every matter of this type.',
            },
          })}
        <div id="matterFieldMsg">${msgHtml}</div>
      </div>`;
    };
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
    const fieldCtx = {
      canEdit,
      clients: state.clients,
      recordTypes: recordTypes || [
        { key: 'billable', label: 'Billable' },
        { key: 'non_billable', label: 'Non-Billable' },
      ],
      users: state.users,
    };
    const sections = Object.entries(page.sections || {})
      .map(([section, fields]) => [section, (fields || []).filter((f) => f.key !== 'std:number')])
      .filter(([, fields]) => fields.length > 0);

    main.innerHTML = `
      <div class="card">
        <div class="row-actions" style="margin-bottom:.75rem">
          <button type="button" id="backMatters">← Matters</button>
          ${canDelete ? '<button type="button" id="deleteMatter">Delete matter</button>' : ''}
        </div>
        <h1>${escapeHtml(m.name || 'Matter')}</h1>
        <p class="muted" style="margin:.25rem 0 0">Record type · ${escapeHtml(matterTypeLabel)}</p>
        ${createFlash ? successNoticeHtml(createFlash) : ''}
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
            <button class="primary" type="submit">Save</button>
          </div>` : ''}
        <div id="matterMsg">${matterFlash ? successNoticeHtml(matterFlash) : ''}</div>
      </form>

      ${showPostCreateFields ? fieldMgmtPanelHtml({
        title: 'Add custom fields',
        hint: `Optional — add a field for <strong>this matter only</strong>, or for every <strong>${escapeHtml(matterTypeLabel)}</strong> matter. Keep adding as needed, then press Done.`,
        formId: 'recordFieldForm',
        panelId: 'postCreateFieldsPanel',
        showDismiss: true,
        msgHtml: fieldPanelFlash ? successNoticeHtml(fieldPanelFlash) : '',
      }) : ''}

      ${canLogTime ? `<div class="card">
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
        <div id="matterTimeMsg" style="margin-top:.75rem">${flash ? successNoticeHtml(flash) : ''}</div>
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
                <td>${escapeHtml(timekeeperDisplayName(e))}<div class="muted">${escapeHtml(e.description || '')}</div></td>
                <td><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">hrs</span></td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
              </tr>`;
            }).join('') || '<tr><td colspan="4" class="muted">No time on this matter yet</td></tr>'}
          </tbody>
        </table></div>
      </div>` : ''}

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

      ${canEdit && !showPostCreateFields ? fieldMgmtPanelHtml({
        msgHtml: fieldPanelFlash ? successNoticeHtml(fieldPanelFlash) : '',
      }) : ''}

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
          message: `Are you sure you want to delete “${m.name || 'this matter'}”? This cannot be undone.`,
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
          $('#matterMsg').innerHTML = `<div class="error">${escapeHtml(e.message)}</div>`;
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
    if (showPostCreateFields) {
      setTimeout(() => {
        const panel = $('#postCreateFieldsPanel');
        if (panel?.scrollIntoView) {
          panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        }
      }, 0);
    }

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
    }

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
          };
          await renderMatterDetail();
          const descInput = $('#matterTimeForm')?.querySelector('textarea[name="description"]');
          if (descInput) setTimeout(() => descInput.focus(), 0);
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
        if (!isAdminUser()) return;
        const label = fieldLabelFromDeleteBtn(btn);
        const sure = await confirmDeleteCustomField(label);
        if (!sure) return;
        try {
          const id = Number(btn.dataset.delCustomField);
          await api(`/api/custom-fields/${id}`, { method: 'DELETE' });
          if (Number(state.editingMatterFieldId) === id) state.editingMatterFieldId = null;
          state.matterFieldPanelFlash = {
            title: 'Custom field deleted',
            detail: 'The field was removed for this firm.',
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
    const syncMatterFieldScopeUi = () => {
      if (!rf || state.editingMatterFieldId) return;
      const scopeSelect = rf.querySelector('[name="fieldScope"]');
      const defaultWrap = rf.querySelector('[data-default-field-wrap]');
      if (!scopeSelect) return;
      const isRecordType = scopeSelect.value === 'record_type';
      if (defaultWrap) {
        defaultWrap.hidden = !isRecordType;
        if (!isRecordType) {
          const box = defaultWrap.querySelector('input[name="isDefault"]');
          if (box) box.checked = false;
        } else {
          const defaultText = defaultWrap.querySelector('[data-default-label-text]');
          if (defaultText) defaultText.textContent = 'Record type default field';
        }
      }
      const requiredText = rf.querySelector('[data-required-label-text]');
      if (requiredText) {
        requiredText.textContent = isRecordType
          ? 'Record type required field'
          : 'Required on this matter';
      }
      const submitBtn = rf.querySelector('button[type="submit"]');
      if (submitBtn) {
        submitBtn.textContent = isRecordType
          ? 'Add to record type'
          : 'Add to this matter';
      }
    };
    if (rf) {
      const scopeSelect = rf.querySelector('[name="fieldScope"]');
      if (scopeSelect) {
        scopeSelect.onchange = syncMatterFieldScopeUi;
        syncMatterFieldScopeUi();
      }
      rf.onsubmit = async (ev) => {
        ev.preventDefault();
        const fd = new FormData(rf);
        const { fieldType, options, body } = customFieldPayload(fd);
        if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
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
          } else {
            const scope = String(fd.get('fieldScope') || 'record');
            if (scope === 'record_type') {
              await api('/api/custom-fields', {
                method: 'POST',
                body: JSON.stringify({
                  ...body,
                  recordTypeKey: m.matter_type || 'billable',
                  appliesTo: 'matter',
                }),
              });
              state.matterFieldPanelFlash = {
                title: 'Record type field added',
                detail: `${body.label || 'Field'} added to every ${matterTypeLabel} matter.`,
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
    state.settings = settings;
    state.matters = matters;
    const today = new Date().toISOString().slice(0, 10);
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
    const flash = state.timeFlash;
    state.timeFlash = null;
    state.timeEntryRetain = null;
    const timeFieldDefs = timeEntryFieldDefs(timeFields);
    main.innerHTML = `
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
        <div id="timeMsg" style="margin-top:.75rem">${flash ? successNoticeHtml(flash) : ''}</div>
      </div>` : `<div class="card"><h1>Time Entry</h1>${flash ? successNoticeHtml(flash) : ''}<p class="muted">Your role can view time entries but not create them.</p></div>`}
      <div class="card">
        <h2>Recent entries</h2>
        <div class="table-wrap"><table class="time-entries-table">
          <thead>
            <tr>
              <th>Date</th>
              <th>Matter</th>
              <th>Description</th>
              <th>Hours</th>
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
              const editable = canEdit
                && e.status !== 'invoiced'
                && !e.invoice_id
                && (isOwn || roleCanModifyOthersTime());
              const deletable = canDelete
                && e.status !== 'invoiced'
                && !e.invoice_id
                && (isOwn || roleCanDeleteOthersTime());
              const hoursVal = formatDuration(e.rounded_minutes, 'decimal');
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
                <td>
                  <input class="inline-input" type="date" data-field="serviceDate"
                    value="${escapeHtml(String(e.service_date || '').slice(0, 10))}" />
                </td>
                <td>
                  <select class="inline-input" data-field="matterId" aria-label="Matter">
                    ${matterChoices.map((m) => `
                      <option value="${Number(m.id)}" ${Number(m.id) === Number(e.matter_id) ? 'selected' : ''}>
                        ${escapeHtml(m.name || m.number || String(m.id))}
                      </option>`).join('')}
                  </select>
                </td>
                <td>
                  <textarea class="inline-input inline-desc" data-field="description" rows="2"
                    aria-label="Description">${escapeHtml(e.description || '')}</textarea>
                </td>
                <td>
                  <input class="inline-input inline-hours" type="number" min="0.25" step="0.25"
                    inputmode="decimal" data-field="hours" value="${escapeHtml(hoursVal)}"
                    aria-label="Hours" />
                </td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
                <td class="row-actions">
                  <button type="button" class="primary" data-save-time="${entryId}">Save</button>
                  ${deletable ? `<button type="button" data-del-time="${entryId}">Delete</button>` : ''}
                </td>
              </tr>`;
              }
              return `
              <tr>
                <td>${escapeHtml(e.service_date)}</td>
                <td>${escapeHtml(matterName)}</td>
                <td>${escapeHtml(e.description || '—')}</td>
                <td><strong>${escapeHtml(formatDuration(e.rounded_minutes))}</strong>
                  <span class="muted">hrs</span></td>
                <td><span class="pill" data-status="${escapeHtml(e.status)}">${escapeHtml(statusLabel)}</span></td>
                <td>${deletable
                  ? `<button type="button" data-del-time="${e.id}">Delete</button>`
                  : '<span class="muted">—</span>'}</td>
              </tr>`;
            }).join('') || '<tr><td colspan="6" class="muted">No entries yet</td></tr>'}
          </tbody>
        </table></div>
        <div id="timeListMsg" style="margin-top:.75rem"></div>
      </div>`;

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
            body: JSON.stringify({ serviceDate, matterId, description, hours }),
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
        const sure = await confirmAction({
          title: 'Delete this time entry?',
          message: 'Are you sure you want to delete this time entry? This cannot be undone.',
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
      matterPicker = wireMatterPicker(timeForm, { matters });
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

  function billFieldsPanelHtml(fieldConfig, { canEdit = false } = {}) {
    const enabledHeader = [
      ...(fieldConfig.coreHeader || []),
      ...(fieldConfig.enabledHeader || []),
    ];
    const enabledLines = fieldConfig.enabledLines || [];
    const availableHeader = fieldConfig.availableHeader || [];
    const availableLines = fieldConfig.availableLines || [];
    const row = (f, group) => `
      <div class="field-mgmt-row">
        <div>
          <strong>${escapeHtml(f.label)}</strong>
          <div class="muted">${group === 'header' ? 'Bill header' : 'Line column'}${f.removable === false ? ' · always included' : ''}</div>
        </div>
        <div class="row-actions">
          ${canEdit && f.removable !== false
            ? `<button type="button" data-del-bill-field="${escapeHtml(f.key)}" data-bill-group="${group}">Remove</button>`
            : ''}
        </div>
      </div>`;
    return `
      <div class="card stack" id="billFieldsCard">
        <h2>Fields on bills</h2>
        <p class="hint">Choose which header details and line columns appear on bills, PDF, and Excel.</p>
        <h3 style="margin:0;font-family:var(--font);font-size:1rem">Header</h3>
        <div class="field-mgmt-list">
          ${enabledHeader.map((f) => row(f, 'header')).join('') || '<p class="muted">No header fields</p>'}
        </div>
        ${canEdit && availableHeader.length ? `
          <div class="row-actions" style="flex-wrap:wrap;gap:.5rem;align-items:center">
            <label class="matter-type-picker" style="margin:0">Add header field
              <select id="addBillHeaderField">
                <option value="">Choose…</option>
                ${availableHeader.map((f) => `
                  <option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`).join('')}
              </select>
            </label>
            <button type="button" id="addBillHeaderFieldBtn">Add</button>
          </div>` : ''}
        <h3 style="margin:.75rem 0 0;font-family:var(--font);font-size:1rem">Line columns</h3>
        <div class="field-mgmt-list">
          ${enabledLines.map((f) => row(f, 'lines')).join('') || '<p class="muted">No line columns yet</p>'}
        </div>
        ${canEdit && availableLines.length ? `
          <div class="row-actions" style="flex-wrap:wrap;gap:.5rem;align-items:center">
            <label class="matter-type-picker" style="margin:0">Add line column
              <select id="addBillLineField">
                <option value="">Choose…</option>
                ${availableLines.map((f) => `
                  <option value="${escapeHtml(f.key)}">${escapeHtml(f.label)}</option>`).join('')}
              </select>
            </label>
            <button type="button" id="addBillLineFieldBtn">Add</button>
          </div>` : ''}
        <div id="billFieldsMsg"></div>
      </div>`;
  }

  async function renderBilling() {
    const canBill = ['admin', 'billing_clerk'].includes(state.user.role);
    const [invoices, matters, ready, fieldConfig] = await Promise.all([
      api('/api/invoices'),
      api('/api/matters').catch(() => []),
      canBill ? api('/api/billing/ready').catch(() => []) : Promise.resolve([]),
      api('/api/billing/fields').catch(() => ({
        coreHeader: [], enabledHeader: [], availableHeader: [],
        enabledLines: [], availableLines: [], headerKeys: [], lineKeys: [],
      })),
    ]);
    state.matters = matters || [];
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
      ${billFieldsPanelHtml(fieldConfig, { canEdit: canBill })}
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

      const setFieldsMsg = (html) => {
        const msg = $('#billFieldsMsg');
        if (msg) msg.innerHTML = html || '';
      };
      const refreshFields = async () => {
        const openId = $('#invoiceDetail')?.dataset?.invoiceId;
        await renderBilling();
        if (openId) await showInvoice(Number(openId));
      };
      main.querySelectorAll('[data-del-bill-field]').forEach((btn) => {
        btn.onclick = async () => {
          try {
            await api(
              `/api/billing/fields?group=${encodeURIComponent(btn.dataset.billGroup)}&key=${encodeURIComponent(btn.dataset.delBillField)}`,
              { method: 'DELETE' }
            );
            await refreshFields();
          } catch (e) {
            setFieldsMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      });
      const wireAdd = (selectId, btnId, group) => {
        const sel = $(selectId);
        const btn = $(btnId);
        if (!sel || !btn) return;
        btn.onclick = async () => {
          const key = sel.value;
          if (!key) {
            setFieldsMsg('<div class="error">Choose a field to add.</div>');
            return;
          }
          try {
            await api('/api/billing/fields', {
              method: 'POST',
              body: JSON.stringify({ group, key }),
            });
            await refreshFields();
          } catch (e) {
            setFieldsMsg(`<div class="error">${escapeHtml(e.message)}</div>`);
          }
        };
      };
      wireAdd('#addBillHeaderField', '#addBillHeaderFieldBtn', 'header');
      wireAdd('#addBillLineField', '#addBillLineFieldBtn', 'lines');
    }
    main.querySelectorAll('[data-open]').forEach((b) => {
      b.onclick = () => showInvoice(Number(b.dataset.open));
    });
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
    const includeDisabledFirm = roleCanModify('report') || roleCanDelete('report');
    const [customReportList, recordTypes, timeFields, firmReportList] = await Promise.all([
      api('/api/custom-reports').catch(() => []),
      api('/api/record-types').catch(() => []),
      api('/api/custom-fields?appliesTo=time_entry').catch(() => []),
      api(`/api/firm-reports${includeDisabledFirm ? '?includeDisabled=1' : ''}`).catch(() => []),
    ]);
    const matterFieldLists = await Promise.all(
      (recordTypes || []).map((t) =>
        api(`/api/custom-fields?appliesTo=matter&type=${encodeURIComponent(t.key)}`).catch(() => []))
    );
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
    main.innerHTML = `
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
      <div id="reportOut" class="card" hidden></div>`;

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
                  <option value="${f.id}">${escapeHtml(f.label)}${
                    f.recordTypeKey ? ` (${escapeHtml(f.recordTypeKey)})` : ''
                  }</option>`).join('')
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
          if ((fieldType === 'dropdown' || fieldType === 'select') && !options.length) {
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
        <p class="lead">Matter, contact, and time fields, plus billing preferences${isAdmin ? ', email, and integrations' : ''}.</p>
        ${canEditBilling ? '' : '<div class="error">Sign in as an admin (avery@firm.example) or billing clerk (billie@firm.example) to edit these settings.</div>'}
      </div>

      ${canConfigureFields ? `
      <div class="card stack" id="defaultFieldsCard">
        <h2>Matter record pages</h2>
        <p class="hint">Each record type (Billable, Non-Billable, or ones you add) has its own field layout. Fields you add here are record-type fields — they appear on every matter of that type. For a field on one matter only, open the matter and use Manage fields. New matters default to Billable.</p>
        <div id="defaultFieldsBody" class="stack"></div>
        <div id="typeFieldMsg"></div>
      </div>
      <div class="card stack" id="contactFieldsCard">
        <h2>Contact record pages</h2>
        <p class="hint">Each contact record type (Person, Company, or ones you add) has its own field layout. Fields you add here are record-type fields — they appear on every contact of that type. New contacts default to Person.</p>
        <div id="contactFieldsBody" class="stack"></div>
        <div id="contactFieldMsg"></div>
      </div>
      <div class="card stack" id="timeFieldsCard">
        <h2>Time entry fields</h2>
        <p class="hint">Shown when logging time. Custom fields apply to all time entries.</p>
        <div id="timeFieldsBody" class="stack"></div>
        <div id="timeFieldMsg"></div>
      </div>

      <details class="onedrive-collapse settings-collapse" id="matterNameFormulaCard">
        <summary class="onedrive-collapse-summary">
          <span class="onedrive-collapse-title">Matter name formula</span>
          <span class="onedrive-collapse-meta muted">${
            settings.matterNameFormula?.enabled
              ? escapeHtml(settings.matterNameFormula.previewExample || 'On')
              : 'Off — type a name on create'
          }</span>
        </summary>
        <div class="onedrive-collapse-body stack" id="matterNameFormulaBody"></div>
      </details>` : ''}

      ${isAdmin ? `
      <div class="card stack" id="rolePermissionsCard">
        <h2>Role permissions</h2>
        <p class="hint">Set View All, Modify All, and Delete for Matters, Contacts, Time entries, and Reports. For time, also set timekeeper access (select timekeeper; view/edit/delete other timekeepers’ entries). Admin always has full access.</p>
        <div id="rolePermissionsBody" class="stack"></div>
        <div id="rolePermissionsMsg"></div>
      </div>
      <div class="card stack" id="fieldPermissionsCard">
        <h2>Field permissions</h2>
        <p class="hint">Choose Hidden, Read, or Read/Write for each matter and contact field per role. Name stays Read/Write.</p>
        <div id="fieldPermissionsBody" class="stack"></div>
        <div id="fieldPermissionsMsg"></div>
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
      const matterRecordTypes = await api('/api/record-types').catch(() => []);
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
      const contactRecordTypes = await api('/api/record-types?appliesTo=client').catch(() => []);
      await bindDefaultFieldsEditor({
        bodyEl: $('#contactFieldsBody'),
        msgEl: $('#contactFieldMsg'),
        recordTypeKey: state.settingsContactRecordTypeKey || 'person',
        appliesTo: 'client',
        recordTypes: contactRecordTypes,
        onRecordTypeChange: (key) => {
          state.settingsContactRecordTypeKey = key;
        },
      });
      await bindDefaultFieldsEditor({
        bodyEl: $('#timeFieldsBody'),
        msgEl: $('#timeFieldMsg'),
        appliesTo: 'time_entry',
      });
      await bindMatterNameFormulaEditor({
        bodyEl: $('#matterNameFormulaBody'),
        config: settings.matterNameFormula,
        recordTypes: matterRecordTypes,
      });
    }

    if (isAdmin && settings.permissions) {
      await bindRolePermissionsEditor({
        bodyEl: $('#rolePermissionsBody'),
        msgEl: $('#rolePermissionsMsg'),
        permissions: settings.permissions,
      });
      await bindFieldPermissionsEditor({
        bodyEl: $('#fieldPermissionsBody'),
        msgEl: $('#fieldPermissionsMsg'),
        permissions: settings.permissions,
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

  /** Compact in-app help agent: training & how-to for Firm Billing. */
  const HELP_TOPICS = [
    {
      id: 'matter',
      label: 'Create a matter',
      keywords: ['matter', 'create matter', 'new matter', 'open matter', 'case'],
      answer: 'Go to Matters → Create Matter (or the sidebar Create Matter action). Enter a name (or, if Settings → Matter name formula is on, fill the name fields and the name is built automatically), complete required custom fields, then confirm. The matter opens so you can add time and details.',
    },
    {
      id: 'matter-name-formula',
      label: 'Matter name formula',
      keywords: ['matter name', 'formula', 'concatenate', 'ticker', 'create matter name', 'name parts'],
      answer: 'Settings → Matter name formula (collapsed section): turn it on, set a separator (e.g. -), add custom fields and Year in order, or create fields there. On Create Matter those fields appear and the matter name is built by concatenating them.',
    },
    {
      id: 'time',
      label: 'Log time',
      keywords: ['time', 'hours', 'log time', 'time entry', 'timesheet', 'billable'],
      answer: 'Open Time Entry or a matter’s Add time form. Pick the matter, date, hours (0.25 steps), and description, then Save. Saved time is ready for Billing—no approval step.',
    },
    {
      id: 'contact',
      label: 'Add a contact',
      keywords: ['contact', 'client', 'company', 'person', 'create contact'],
      answer: 'Use Quick action Create Contact, or Contacts → Create contact. Choose a record type (Person, Company, or ones from Settings → Contact record pages), fill name and type-specific custom fields, then confirm. Add more fields for a type from Create Contact or Settings.',
    },
    {
      id: 'fields',
      label: 'Custom fields',
      keywords: ['custom field', 'fields', 'required', 'dropdown', 'settings field'],
      answer: 'Matter and contact fields can be record-type (shared by every record of that type). Settings → Matter record pages / Contact record pages and Create Matter/Contact → Add record type fields add type fields. On a matter, Manage fields can also add a field for one matter only.',
    },
    {
      id: 'reports',
      label: 'Reports & dashboard',
      keywords: ['report', 'dashboard', 'lodestar', 'export', 'chart', 'custom report'],
      answer: 'Reports: run firm Lodestar reports or create custom reports grouped by a custom field. Dashboard: pin firm or custom reports, remove them with Remove, and export everything with Export PDF / CSV / Excel.',
    },
    {
      id: 'billing',
      label: 'Create a bill',
      keywords: ['bill', 'billing', 'invoice', 'prebill'],
      answer: 'Open Billing, choose the matter and approved time to include, then create the bill. Only roles like admin or billing clerk can manage billing settings.',
    },
    {
      id: 'login',
      label: 'Sign in',
      keywords: ['login', 'password', 'sign in', 'demo', 'avery'],
      answer: 'Use your work email and password. Demo: avery@firm.example / demo-change-me. You can also request a magic link or reset password from the login screen.',
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
          <p class="help-agent-intro">Need a hand? Pick a topic or ask how to do something in Firm Billing.</p>
          <div class="help-agent-topics">
            ${HELP_TOPICS.map((t) => `
              <button type="button" class="help-topic" data-help-topic="${t.id}">${escapeHtml(t.label)}</button>
            `).join('')}
          </div>`;
        body.querySelectorAll('[data-help-topic]').forEach((btn) => {
          btn.onclick = () => {
            const topic = HELP_TOPICS.find((t) => t.id === btn.dataset.helpTopic);
            if (topic) showAnswer(topic.label, topic.answer);
          };
        });
      };

      const showAnswer = (title, answer) => {
        body.innerHTML = `
          <div class="help-agent-answer">
            <strong>${escapeHtml(title)}</strong>
            <p>${escapeHtml(answer)}</p>
            <button type="button" class="linkish" id="helpAgentBack">← All topics</button>
          </div>`;
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
          showAnswer(match.label, match.answer);
        } else {
          showAnswer('I can help with that',
            'Try a topic below, or ask about creating matters, logging time, contacts, custom fields, reports, dashboard, or billing.');
          // After showing fallback, also list topics again under the message
          const wrap = body.querySelector('.help-agent-answer');
          if (wrap) {
            const topics = document.createElement('div');
            topics.className = 'help-agent-topics';
            topics.innerHTML = HELP_TOPICS.slice(0, 4).map((t) => `
              <button type="button" class="help-topic" data-help-topic="${t.id}">${escapeHtml(t.label)}</button>
            `).join('');
            wrap.appendChild(topics);
            topics.querySelectorAll('[data-help-topic]').forEach((btn) => {
              btn.onclick = () => {
                const topic = HELP_TOPICS.find((t) => t.id === btn.dataset.helpTopic);
                if (topic) showAnswer(topic.label, topic.answer);
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
