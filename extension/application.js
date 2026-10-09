// Drives the Amazon application pages (/application/...): pre-consent (Create Application, or Next then Create Application),
// then the consent/questions pages (tick every checkbox, answer "No" to the Amazonian referral question, press I Agree / Next / Continue,
// or Start identity verification). The page after identity verification is not automated yet.
(() => {
  const REFRESH_AFTER_MS = 10000; // a page that shows no button this long after load gets reloaded; reload, max MAX_REFRESHES times in a row
  const MAX_REFRESHES = 5;       // in a row, then it stays stuck
  const RESET_AFTER_MS = 300000; // the count starts over if the last refresh was this long ago
  const REFRESH_KEY = 'jobbot-app-refreshes';
  const CLICK_DELAY_MS = 600;

  // Highest priority first: the first one found is pressed.
  const BUTTONS = [
    /^apply for other jobs$/i, // "all shifts have been filled" page: back to the job search
    /^create (an )?application$/i,
    /^start identity verification$/i,
    /^i agree$/i,
    /^continue$/i,
    /^next$/i,
  ];

  const loadedAt = Date.now();
  const clicked = new Set(); // "route|button text" already pressed, so nothing is clicked twice on one page
  const flags = { running: false, paused: false };
  let cfg = { paused: true };
  let pending = false; // a delayed click is scheduled

  function status(text) {
    window.__jobbotAppStatus = text;
    window.dispatchEvent(new Event('jobbot-app-status'));
  }

  const route = () => location.hash.split('?')[0] || '#/';
  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const textOf = (b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim();
  const disabled = (b) => b.disabled || b.getAttribute('aria-disabled') === 'true';

  const allButtons = () => [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible);
  function findButton() {
    const list = allButtons();
    for (const re of BUTTONS) {
      const b = list.find((x) => re.test(textOf(x)));
      if (b) return b;
    }
    return null;
  }

  // Ticks every unchecked checkbox (native or ARIA). Returns how many it clicked.
  function checkBoxes() {
    let n = 0;
    for (const c of document.querySelectorAll('input[type=checkbox]')) {
      if (c.checked || c.disabled) continue;
      const target = visible(c) ? c : (c.closest('label') || c.parentElement);
      if (!target) continue;
      target.click();
      if (!c.checked) c.click();
      n++;
    }
    for (const c of document.querySelectorAll('[role=checkbox][aria-checked=false]')) {
      if (visible(c) && c.getAttribute('aria-disabled') !== 'true') { c.click(); n++; }
    }
    return n;
  }

  // "Were you referred by an Amazonian for this job?" -> No. Returns true when it clicked something.
  function answerReferral() {
    for (const r of document.querySelectorAll('input[type=radio]')) {
      if (r.checked || r.disabled) continue;
      const label = r.closest('label') || r.parentElement;
      if (!/^no$/i.test(textOf(label || r))) continue;
      let box = r, hit = false;
      for (let i = 0; i < 5 && box; i++, box = box.parentElement) if (/referred by an amazonian/i.test(box.textContent)) { hit = true; break; }
      if (!hit) continue;
      (visible(r) ? r : label).click();
      if (!r.checked) r.click();
      return true;
    }
    return false;
  }

  function maybeRefresh(r) {
    if ([...clicked].some((k) => k.startsWith(r))) return false;
    let rec = {};
    try { rec = JSON.parse(sessionStorage.getItem(REFRESH_KEY)) || {}; } catch {}
    const n = rec.at && Date.now() - rec.at < RESET_AFTER_MS ? rec.n || 0 : 0;
    const wait = REFRESH_AFTER_MS;
    const left = wait - (Date.now() - loadedAt);
    if (left > 0) { status(`${r} · waiting for the page to load (reload in ${Math.ceil(left / 1000)}s)`); return true; }
    if (n >= MAX_REFRESHES) { status(`${r} · stuck: page did not load after ${MAX_REFRESHES} refreshes`); return true; }
    try { sessionStorage.setItem(REFRESH_KEY, JSON.stringify({ n: n + 1, at: Date.now() })); } catch {}
    status(`${r} · nothing loaded, refreshing (${n + 1}/${MAX_REFRESHES})…`);
    location.reload();
    return true;
  }

  function tick() {
    if (cfg.paused) return status(`${route()} · ${flags.running ? 'Paused' : 'Stopped'}`);
    if (pending) return;
    const r = route();

    const ticked = checkBoxes();
    const answered = answerReferral();
    if (ticked || answered) return status(`${r} · ${ticked ? `ticked ${ticked} checkbox(es)` : 'answered the referral question: No'}`);

    const btn = findButton();
    if (!btn) {
      if (maybeRefresh(r)) return;
      return status(`${r} · waiting for a button…`);
    }
    const label = textOf(btn);
    const key = `${r}|${label.toLowerCase()}`;
    if (clicked.has(key)) return status(`${r} · ${label} clicked`);
    if (disabled(btn)) return status(`${r} · ${label} is disabled (a required choice may be missing)`);

    clicked.add(key);
    pending = true;
    status(`${r} · clicking ${label}…`);
    setTimeout(() => {
      pending = false; btn.click(); status(`${r} · ${label} clicked`);
      // If the button doesn't take us to the job search itself, go there directly.
      if (/^apply for other jobs$/i.test(label)) setTimeout(() => { if (location.pathname.startsWith('/application')) location.assign(`${location.origin}/app#/jobSearch`); }, 3000);
    }, CLICK_DELAY_MS);
  }

  chrome.storage.local.get(['running', 'paused']).then((s) => {
    flags.running = s.running === true; flags.paused = !!s.paused;
    cfg = { paused: flags.running !== true || flags.paused };
    tick();
    setInterval(tick, 700);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('running' in c) flags.running = c.running.newValue === true;
    if ('paused' in c) flags.paused = !!c.paused.newValue;
    cfg.paused = flags.running !== true || flags.paused;
  });
})();
