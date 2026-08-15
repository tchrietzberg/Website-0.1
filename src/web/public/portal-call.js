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

  let connected = false;
  let greeted = false;

  function renderMessages() {
    const ask = document.getElementById('intakeCallAsk');
    if (ask && session?.nextQuestion && connected) {
      ask.hidden = false;
      const q = document.getElementById('intakeCallAskQ');
      if (q) q.textContent = greeted ? session.nextQuestion : (session.greeting || INTAKE_GREETING);
    } else if (ask) {
      ask.hidden = true;
    }
    const box = document.getElementById('intakeCallTranscript');
    if (!box) return;
    if (!connected) {
      box.innerHTML = `<div class="intake-msg is-system"><strong>System</strong><p>Calling… The agent will begin after the line connects.</p></div>`;
      return;
    }
    if (!session) return;
    const messages = session.messages || [];
    box.innerHTML = messages.map((m) => `
      <div class="intake-msg is-${escapeHtml(m.role)}">
        <strong>${m.role === 'agent' ? 'Intake' : m.role === 'user' ? 'You' : 'System'}</strong>
        <p>${escapeHtml(m.content)}</p>
      </div>`).join('');
    box.scrollTop = box.scrollHeight;
  }

  const INTAKE_GREETING = 'Hello, this is Chrono. I\'m calling about a new matter.';
  const INTAKE_AUDIO = {
    ring: '/audio/intake-ringback.wav?v=261',
    greeting: '/audio/intake-greeting.wav?v=261',
    contactName: '/audio/intake-name.wav?v=261',
    contactEmail: '/audio/intake-email.wav?v=261',
    matterName: '/audio/intake-matter.wav?v=261',
    thanks: '/audio/intake-thanks.wav?v=261',
  };
  let audioCtx = null;
  let audioSource = null;

  function unlockAudio() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    if (!audioCtx) audioCtx = new AC();
    void audioCtx.resume();
    const buf = audioCtx.createBuffer(1, 1, 22050);
    const tick = audioCtx.createBufferSource();
    tick.buffer = buf;
    tick.connect(audioCtx.destination);
    tick.start();
    return audioCtx;
  }

  function clipFor(text) {
    const spoken = String(text || '').replace(/\s+/g, ' ').trim().toLowerCase();
    if (!spoken) return INTAKE_AUDIO.greeting;
    if (spoken.includes('everything i need') || spoken.includes('goodbye')) return INTAKE_AUDIO.thanks;
    if (spoken.includes('email')) return INTAKE_AUDIO.contactEmail;
    if (spoken.includes('call this matter') || spoken.includes('name this matter') || spoken.includes('matter or case')) {
      return INTAKE_AUDIO.matterName;
    }
    if ((spoken.includes('full name') || spoken.includes('your name')) && !spoken.includes('chrono')) {
      return INTAKE_AUDIO.contactName;
    }
    if (spoken.includes('chrono') || spoken.includes('new matter')) return INTAKE_AUDIO.greeting;
    return null;
  }

  async function playClip(ctx, url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('audio missing');
    const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
    await new Promise((resolve) => {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.connect(ctx.destination);
      audioSource = src;
      src.onended = () => resolve();
      src.start();
    });
  }

  function playRing() {
    const ctx = unlockAudio();
    if (!ctx) return Promise.resolve();
    return Promise.race([
      playClip(ctx, INTAKE_AUDIO.ring).catch(() => {}),
      new Promise((resolve) => window.setTimeout(resolve, 4500)),
    ]);
  }

  function speakWithBrowserVoice(text) {
    const spoken = String(text || '').replace(/\s+/g, ' ').trim();
    const Utter = window.SpeechSynthesisUtterance;
    const synth = window.speechSynthesis;
    if (!Utter || !synth || !spoken) return Promise.resolve(false);
    try { synth.cancel(); } catch { /* ignore */ }
    try { synth.resume(); } catch { /* ignore */ }
    return new Promise((resolve) => {
      const utter = new Utter(spoken);
      utter.lang = 'en-US';
      utter.rate = 0.88;
      utter.pitch = 1.02;
      const voices = synth.getVoices() || [];
      const voice = voices.find((v) => /en-US/i.test(v.lang) && /neural|premium|natural|samantha|jenny|aria|google/i.test(v.name))
        || voices.find((v) => /en-US/i.test(v.lang) && /female|samantha|allison/i.test(v.name))
        || voices.find((v) => /en-US/i.test(v.lang))
        || voices[0];
      if (voice) utter.voice = voice;
      utter.onend = () => resolve(true);
      utter.onerror = () => resolve(false);
      synth.speak(utter);
    });
  }

  async function speakTextNow(text) {
    const spoken = String(text || '').replace(/\s+/g, ' ').trim();
    if (!spoken) return false;
    const ctx = unlockAudio();
    const clip = clipFor(spoken);
    try {
      if (ctx && clip) {
        await playClip(ctx, clip);
        return true;
      }
    } catch { /* fall through */ }
    return speakWithBrowserVoice(spoken);
  }

  function speakThenListen() {
    const text = session?.nextQuestion || '';
    const key = `${session?.id || ''}:${session?.nextKey || session?.nextQuestion || ''}`;
    if (!connected || !text || spokenKey === key) {
      if (connected && speechEngine() && !listening) startListen();
      return;
    }
    spokenKey = key;
    stopListen();
    void speakTextNow(text).then(() => {
      if (speechEngine()) startListen();
    });
  }

  async function speakAfterConnect() {
    const greeting = session?.greeting || INTAKE_GREETING;
    const question = session?.nextQuestion || 'May I have your full name, please?';
    if (!greeted) {
      await speakTextNow(greeting);
      greeted = true;
      renderMessages();
    }
    spokenKey = `${session?.id || ''}:${session?.nextKey || question}`;
    await speakTextNow(question);
    if (speechEngine()) startListen();
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

  function toTelHref(input) {
    const raw = String(input || '').trim();
    const digits = raw.replace(/\D/g, '');
    if (raw.startsWith('+') && digits.length >= 10 && digits.length <= 15) return `tel:+${digits}`;
    if (digits.length === 10) return `tel:+1${digits}`;
    if (digits.length === 11 && digits.startsWith('1')) return `tel:+${digits}`;
    return '';
  }

  function paintCalling(form, firmName, { toMasked }) {
    root.innerHTML = `
      <div class="card portal-card portal-call-card">
        <p class="eyebrow">${isTest ? 'Test website call' : 'Intake call'}</p>
        <h1>${connected ? 'Connected' : 'Calling'} ${escapeHtml(toMasked || 'that number')}${connected ? '' : '…'}</h1>
        <p class="muted">${escapeHtml(firmName || 'the firm')}</p>
        <div class="intake-calling">
          <p class="intake-ask-q">${connected ? 'The agent is speaking on this call.' : 'Please wait while the call connects.'}</p>
          <p class="hint">${connected ? 'Turn up this device’s volume to hear the agent.' : 'The agent will speak after the line is answered.'}</p>
        </div>
        <div class="intake-ask" id="intakeCallAsk" hidden>
          <p class="sidebar-label">On the call</p>
          <p class="intake-ask-q" id="intakeCallAskQ"></p>
        </div>
        <div class="intake-transcript" id="intakeCallTranscript"></div>
        <p id="intakeCallError" class="error" hidden></p>
      </div>`;
    renderMessages();
  }

  function paintCall(form, firmName) {
    const canSpeak = !!speechEngine();
    root.innerHTML = `
      <div class="card portal-card portal-call-card">
        <p class="eyebrow">${isTest ? 'Test website call' : 'Intake call'}</p>
        <h1>${escapeHtml(form.name || 'Intake')}</h1>
        <p class="muted">${escapeHtml(firmName || 'the firm')}${isTest ? ' · This is the same page the external website button opens.' : ''}</p>
        <div class="intake-ask" id="intakeCallAsk" hidden>
          <p class="sidebar-label">On the call</p>
          <p class="intake-ask-q" id="intakeCallAskQ"></p>
        </div>
        <div class="intake-transcript" id="intakeCallTranscript"></div>
        <p id="intakeDialStatus" class="hint" hidden></p>
        <p id="intakeCallError" class="error" hidden></p>
        <form id="intakeCallTalk" class="intake-talk">
          <textarea id="intakeCallText" rows="2" placeholder="Notes from the live call"></textarea>
          <div class="row-actions">
            <button type="button" class="btn" id="intakeCallListen" ${canSpeak ? '' : 'hidden'}>Speak</button>
            <button type="submit" class="btn">Send</button>
            <button type="button" class="btn primary" id="intakeCallDone" hidden>Submit intake</button>
          </div>
        </form>
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

  async function postDial(form, firmName, phone) {
    setError('');
    connected = false;
    greeted = false;
    spokenKey = '';
    unlockAudio();
    paintCalling(form, firmName, { toMasked: phone });
    const ringing = playRing();
    try {
      const out = await api(`/api/portal/intake/${token}/call/dial`, { phone, test: isTest });
      guestToken = out.guestToken || '';
      session = out.session;
      await ringing;
      connected = true;
      paintCalling(form, firmName, { toMasked: out.toMasked || phone });
      await speakAfterConnect();
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
        <p>Enter the number, then Call this number. The agent speaks on the call.</p>
        <form id="intakeDialForm" class="stack intake-dial">
          <label>Phone number <input id="intakeDialPhone" type="tel" inputmode="tel" autocomplete="tel" placeholder="(555) 555-0100" /></label>
          <div class="row-actions">
            <button type="submit" class="btn primary" id="intakeDialBtn">Call this number</button>
          </div>
        </form>
        <p id="intakeCallError" class="error" hidden></p>
      </div>`;
    const phoneInput = document.getElementById('intakeDialPhone');
    document.getElementById('intakeDialForm').onsubmit = (ev) => {
      ev.preventDefault();
      const phone = String(phoneInput?.value || '').trim();
      if (!toTelHref(phone)) {
        setError('Enter the phone number to call.');
        return;
      }
      void postDial(form, data.firmName, phone);
    };
  }

  void load();
})();
