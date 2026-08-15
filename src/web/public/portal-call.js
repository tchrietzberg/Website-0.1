(() => {
  const root = document.getElementById('portalCallRoot');
  const parts = location.pathname.split('/').filter(Boolean);
  const token = String(parts[3] || '').trim();
  const isTest = new URLSearchParams(location.search).get('test') === '1';
  let guestToken = '';
  let session = null;
  let pollTimer = null;
  let listening = false;
  let recognition = null;
  let sending = false;
  let spokenKey = '';

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
    const ask = document.getElementById('intakeCallAsk');
    if (ask && session?.nextQuestion) {
      ask.hidden = false;
      const q = document.getElementById('intakeCallAskQ');
      if (q) q.textContent = session.nextQuestion;
    }
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

  function interviewPrompt() {
    if (!session) return '';
    const hasName = !!(session.extracted && session.extracted.contactName);
    if (hasName) return session.nextQuestion || '';
    const agentMsgs = (session.messages || []).filter((m) => m.role === 'agent').map((m) => m.content);
    return agentMsgs.join(' ') || session.nextQuestion || '';
  }

  function speakThenListen() {
    const text = interviewPrompt();
    const key = `${session?.id || ''}:${session?.nextKey || session?.nextQuestion || ''}`;
    if (!text || spokenKey === key) {
      if (speechEngine() && !listening) startListen();
      return;
    }
    spokenKey = key;
    stopListen();
    const Utter = window.SpeechSynthesisUtterance;
    const synth = window.speechSynthesis;
    const after = () => { if (speechEngine()) startListen(); };
    if (!Utter || !synth) {
      after();
      return;
    }
    try { synth.cancel(); } catch { /* ignore */ }
    const utter = new Utter(text);
    utter.lang = 'en-US';
    utter.rate = 1;
    utter.onend = after;
    utter.onerror = after;
    synth.speak(utter);
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
        <div class="intake-ask" id="intakeCallAsk" hidden>
          <p class="sidebar-label">Agent is asking</p>
          <p class="intake-ask-q" id="intakeCallAskQ"></p>
        </div>
        <div class="intake-transcript" id="intakeCallTranscript"></div>
        <p id="intakeDialStatus" class="hint" hidden></p>
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
    renderMessages();
    speakThenListen();
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
      speakThenListen();
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

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  async function refreshSession() {
    if (!session?.id || !guestToken) return;
    try {
      const res = await fetch(`/api/portal/intake/${token}/call/${session.id}`, {
        headers: { Accept: 'application/json', 'X-Intake-Guest': guestToken },
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.session) {
        session = data.session;
        renderMessages();
        updateDone();
        if (session.status === 'completed' || session.status === 'filed') {
          stopPoll();
          stopListen();
          root.innerHTML = `<div class="card portal-card"><h1>Thank you</h1><p>${isTest ? 'Test call received.' : 'Your information was received from the call and sent to the firm.'}</p></div>`;
        }
      }
    } catch { /* keep last transcript */ }
  }

  async function startCall(form, firmName) {
    setError('');
    try {
      const out = await api(`/api/portal/intake/${token}/call`, isTest ? { test: true } : {});
      guestToken = out.guestToken || '';
      session = out.session;
      paintCall(form, firmName);
    } catch (e) {
      setError(e.message || 'Could not start the intake call.');
    }
  }

  async function dialNumber(form, firmName) {
    const phone = String(document.getElementById('intakeDialPhone')?.value || '').trim();
    setError('');
    if (!phone) {
      setError('Enter the phone number to call.');
      return;
    }
    try {
      const out = await api(`/api/portal/intake/${token}/call/dial`, { phone, test: isTest });
      guestToken = out.guestToken || '';
      session = out.session;
      paintCall(form, firmName);
      const hint = document.getElementById('intakeDialStatus');
      if (hint) {
        hint.hidden = false;
        hint.textContent = out.stub
          ? `Simulated call to ${out.toMasked || 'that number'}.`
          : `Calling ${out.toMasked || 'your phone'}. Answer — the agent will ask the questions on the call.`;
      }
      stopPoll();
      pollTimer = setInterval(() => void refreshSession(), 2500);
    } catch (e) {
      setError(e.message || 'Could not place the call.');
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
        <p>Enter a phone number and start the call. The agent will ask for your name and the other details, including custom fields, then save them for the firm.</p>
        <form id="intakeDialForm" class="stack intake-dial">
          <label>Phone number <input id="intakeDialPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-0100" /></label>
          <div class="row-actions">
            <button type="submit" class="btn primary" id="intakeDialBtn">Call this number</button>
          </div>
        </form>
        <p id="intakeCallError" class="error" hidden></p>
        <p class="muted">Or continue in this browser:</p>
        <div class="row-actions">
          <button type="button" class="btn" id="intakeCallStart">${isTest ? 'Type a test call' : 'Type instead'}</button>
        </div>
      </div>`;
    document.getElementById('intakeDialForm').onsubmit = (ev) => {
      ev.preventDefault();
      void dialNumber(form, data.firmName);
    };
    document.getElementById('intakeCallStart').onclick = () => void startCall(form, data.firmName);
  }

  void load();
})();
