// Drives the Amazon application pages (/application/...). Right now: the "pre-consent" page, where it clicks Next.
(() => {
  const NEXT_TEXT = /^next$/i;
  const clicked = new Set(); // routes where Next was already pressed, so it is never clicked twice on one page

  let cfg = { enabled: false, autoOpen: true };

  function status(text) {
    window.__jobbotAppStatus = text;
    window.dispatchEvent(new Event('jobbot-app-status'));
  }

  const route = () => location.hash.split('?')[0] || '#/';
  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const findNext = () =>
    [...document.querySelectorAll('button, input[type=submit], [role=button]')]
      .filter(visible)
      .find((b) => NEXT_TEXT.test((b.textContent || b.value || '').trim()));

  function tick() {
    if (!cfg.enabled || !cfg.autoOpen) return status(`${route()} · Auto-continue is off`);
    const r = route();
    if (!r.startsWith('#/pre-consent')) return status(`${r} · no automation for this page yet`);
    if (clicked.has(r)) return status(`${r} · Next clicked`);

    const btn = findNext();
    if (!btn) return status(`${r} · waiting for the Next button…`);
    if (btn.disabled || btn.getAttribute('aria-disabled') === 'true') return status(`${r} · Next is disabled (a required choice may be missing)`);

    clicked.add(r);
    status(`${r} · clicking Next…`);
    setTimeout(() => { btn.click(); status(`${r} · Next clicked`); }, 600);
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
