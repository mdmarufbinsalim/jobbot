// Drives the Amazon application pages (/application/...). Right now: the "pre-consent" page, where it clicks Create Application.
(() => {
  const BUTTON_TEXT = /^create (an )?application$/i;
  const clicked = new Set(); // routes where the button was already pressed, so it is never clicked twice on one page

  let cfg = { enabled: false, autoOpen: true };

  function status(text) {
    window.__jobbotAppStatus = text;
    window.dispatchEvent(new Event('jobbot-app-status'));
  }

  const route = () => location.hash.split('?')[0] || '#/';
  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const findButton = () =>
    [...document.querySelectorAll('button, input[type=submit], [role=button]')]
      .filter(visible)
      .find((b) => BUTTON_TEXT.test((b.textContent || b.value || '').trim()));

  function tick() {
    if (!cfg.enabled || !cfg.autoOpen) return status(`${route()} · Auto-continue is off`);
    const r = route();
    if (!r.startsWith('#/pre-consent')) return status(`${r} · no automation for this page yet`);
    if (clicked.has(r)) return status(`${r} · Create Application clicked`);

    const btn = findButton();
    if (!btn) return status(`${r} · waiting for the Create Application button…`);
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return status(`${r} · Create Application is disabled (a required choice may be missing)`);

    clicked.add(r);
    status(`${r} · clicking Create Application…`);
    setTimeout(() => { btn.click(); status(`${r} · Create Application clicked`); }, 600);
  }

  chrome.storage.local.get(['enabled', 'autoOpen']).then((s) => {
    cfg = { enabled: !!s.enabled, autoOpen: s.autoOpen !== false };
    tick();
    setInterval(tick, 700);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('enabled' in c) cfg.enabled = !!c.enabled.newValue;
    if ('autoOpen' in c) cfg.autoOpen = c.autoOpen.newValue !== false;
  });
})();
