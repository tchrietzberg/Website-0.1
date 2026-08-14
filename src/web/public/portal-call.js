(() => {
  const root = document.getElementById('portalCallRoot');
  const parts = location.pathname.split('/').filter(Boolean);
  const token = String(parts[3] || '').trim();
  const isTest = new URLSearchParams(location.search).get('test') === '1';
  let guestToken = '';
  let session = null;
  let listening = false;
  let recognition = null;
  let sending = false;

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function speechEngine() {
    return window.SpeechRecognition || window.webkitSpeechRecognition || null;
  }

  function renderMessages() {
    const box = document.getElementById('intakeCallTranscript');
    if (!box || !session) return;
    const messages = session.messages || [];
    box.innerHTML = messages.map((m) => `
      <div class="intake-msg is-${escapeHtml(m.role)}">
        <strong>${m.role === 'agent' ? 'Intake' : m.role === 'user' ? 'You' : 'System'}</strong>
        <p>${escapeHtml(m.content)}</p>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  function setError(text) {
    const el = document.getElementById('intakeCallError');
    if (!el) return;
    if (!text) {
      el.hidden = true;
      el.textContent = '';
      return;
    }
    el.hidden = false;
    el.textContent = text;
  }

  function setListenLabel() {
    const btn = document.getElementById('intakeCallListen');
    if (btn) btn.textContent = listening ? 'Stop' : 'Speak';
  }

  function stopListen() {
    listening = false;
    setListenLabel();
    try { recognition?.stop(); } catch { /* ignore */ }
  }

  async function api(path, body) {
    const headers = { Accept: 'application/json', 'Content-Type': 'application/json' };
    if (guestToken) headers['X-Intake-Guest'] = guestToken;
    const res = await fetch(path, {
      method: 'POST',
      headers,
      body: JSON.stringify(body || {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(data.message || data.error || 'Request failed');
      err.status = res.status;
      throw err;
    }
    return data;
  }

  function paintCall(form, firmName) {
    const canSpeak = !!speechEngine();
    root.innerHTML = `
      <div class="card portal-card portal-call-card">
        <p class="eyebrow">${isTest ? 'Test website call' : 'Intake call'}</p>
        <h1>${escapeHtml(form.name || 'Intake')}</h1>
        <p class="muted">${escapeHtml(firmName || 'the firm')}${isTest ? ' · This is the same page the external website button opens.' : ''}</p>
        <div class="intake-transcript" id="intakeCallTranscript"></div>
        <p id="intakeCallError" class="error" hidden></p>
        <form id="intakeCallTalk" class="intake-talk">
          <textarea id="intakeCallText" rows="2" placeholder="Type an answer if you prefer not to speak"></textarea>
          <div class="row-actions">
            <button type="button" class="btn" id="intakeCallListen" ${canSpeak ? '' : 'hidden'}>Speak</button>
            <button type="submit" class="btn">Send</button>
            <button type="button" class="btn primary" id="intakeCallDone" hidden>Submit intake</button>
          </div>
        </form>
        ${canSpeak ? '' : '<p class="hint">This browser cannot use the microphone. Type your answers instead.</p>'}
      </div>`;
    renderMessages();
    document.getElementById('intakeCallTalk').onsubmit = async (ev) => {
      ev.preventDefault();
      const box = document.getElementById('intakeCallText');
      const text = String(box?.value || '').trim();
      if (!text) return;
      box.value = '';
      await sendTurn(text, 'typed');
    };
    document.getElementById('intakeCallListen').onclick = () => {
      if (listening) stopListen();
      else startListen();
    };
    document.getElementById('intakeCallDone').onclick = () => void completeCall();
    updateDone();
  }

  function updateDone() {
    const done = document.getElementById('intakeCallDone');
    if (done) done.hidden = !(session && (session.readyToSubmit || session.extracted?.contactName));
  }

  async function sendTurn(text, source) {
    if (!session?.id || sending) return;
    sending = true;
    setError('');
    try {
      const out = await api(`/api/portal/intake/${token}/call/${session.id}/message`, { text, source });
      session = out.session;
      renderMessages();
      updateDone();
    } catch (e) {
      setError(e.message || 'Could not send that answer.');
    } finally {
      sending = false;
    }
  }

  function startListen() {
    const Speech = speechEngine();
    if (!Speech) {
      setError('This browser cannot take live speech. Type your answers instead.');
      return;
    }
    listening = true;
    setListenLabel();
    recognition = new Speech();
    recognition.lang = 'en-US';
    recognition.interimResults = false;
    recognition.onresult = (ev) => {
      const text = ev.results?.[0]?.[0]?.transcript || '';
      if (text) void sendTurn(text, 'speech');
    };
    recognition.onerror = () => {
      if (listening) setError('Microphone was blocked or unavailable. Type your answers instead.');
      stopListen();
    };
    recognition.onend = () => {
      if (!listening) return;
      try { recognition.start(); } catch { /* ignore */ }
    };
    try {
      recognition.start();
    } catch {
      stopListen();
      setError('Could not start the microphone. Type your answers instead.');
    }
  }

  async function completeCall() {
    if (!session?.id) return;
    stopListen();
    setError('');
    try {
      await api(`/api/portal/intake/${token}/call/${session.id}/complete`, {});
      root.innerHTML = `<div class="card portal-card"><h1>Thank you</h1><p>${isTest ? 'Test call received. Open Intake in Chrono to review the Website call (test) session. It is not auto-filed.' : 'Your information was received. The firm will review it shortly.'}</p></div>`;
    } catch (e) {
      setError(e.message || 'Could not submit intake.');
    }
  }

  async function startCall(form, firmName) {
    setError('');
    try {
      const out = await api(`/api/portal/intake/${token}/call`, isTest ? { test: true } : {});
      guestToken = out.guestToken || '';
      session = out.session;
      paintCall(form, firmName);
      if (speechEngine()) startListen();
    } catch (e) {
      setError(e.message || 'Could not start the intake call.');
    }
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
    root.innerHTML = `
      <div class="card portal-card">
        <p class="eyebrow">${isTest ? 'Test website call' : 'Intake call'}</p>
        <h1>${escapeHtml(form.name || 'Intake')}</h1>
        <p class="muted">${escapeHtml(data.firmName || 'the firm')}</p>
        <p>${escapeHtml(form.greeting || 'Start a short call to share the information we need for a new matter.')}</p>
        ${isTest ? '<p class="hint">This is a test of the button you will put on the firm website. Speak or type, then submit. Chrono will list it as a website test call.</p>' : ''}
        <p id="intakeCallError" class="error" hidden></p>
        <div class="row-actions">
          <button type="button" class="btn primary" id="intakeCallStart">${isTest ? 'Start test call' : 'Start intake call'}</button>
        </div>
      </div>`;
    document.getElementById('intakeCallStart').onclick = () => void startCall(form, data.firmName);
  }

  void load();
})();
