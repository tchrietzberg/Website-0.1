(() => {
  const script = document.currentScript;
  if (!script) return;
  const src = (() => {
    try { return new URL(script.src, window.location.href); } catch { return null; }
  })();
  const token = String(script.getAttribute('data-intake-token') || src?.searchParams.get('token') || '').trim();
  if (!/^[a-f0-9]{32,96}$/i.test(token)) return;
  const origin = String(script.getAttribute('data-intake-origin') || src?.origin || '').replace(/\/$/, '');
  if (!origin) return;
  const label = script.getAttribute('data-intake-label') || 'Start an intake call';
  const mountSel = script.getAttribute('data-intake-mount');
  const host = mountSel ? document.querySelector(mountSel) : document.body;
  if (!host) return;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  btn.className = script.getAttribute('data-intake-class') || 'chrono-intake-call';
  if (!script.getAttribute('data-intake-class') && !mountSel) {
    btn.setAttribute('style', [
      'position:fixed',
      'right:1.25rem',
      'bottom:1.25rem',
      'z-index:2147483646',
      'padding:0.7rem 1rem',
      'border:0',
      'border-radius:999px',
      'background:#173a56',
      'color:#fff',
      'font:600 0.95rem/1.2 system-ui,sans-serif',
      'cursor:pointer',
      'box-shadow:0 8px 24px rgba(15,23,42,0.28)',
    ].join(';'));
  }
  btn.addEventListener('click', () => {
    const width = 440;
    const height = 740;
    const left = Math.max(0, Math.round((window.screen.width - width) / 2));
    const top = Math.max(0, Math.round((window.screen.height - height) / 2));
    window.open(
      `${origin}/portal/intake/call/${token}`,
      'chronoIntakeCall',
      `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`
    );
  });
  host.appendChild(btn);
})();
