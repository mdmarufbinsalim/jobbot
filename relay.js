// Isolated-world bridge: receives GraphQL captures from inject.js, keeps the first job and first schedule found plus
// a GraphQL debug log for the side panel, and walks the tab search -> job detail -> application page.
(() => {
  // After the extension is reloaded or updated, this old copy keeps running in open tabs and every chrome.* call throws
  // "Extension context invalidated". Detect that and stop; a page refresh loads the new copy.
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  const timers = [];
  function every(fn, ms) {
    const id = setInterval(() => {
      if (!alive()) { timers.forEach(clearInterval); return; }
      fn();
    }, ms);
    timers.push(id);
  }
  const OPERATION = 'searchJobCardsByLocation';
  const ROUTE = '#/jobSearch';
  // Site origin without the "auth." subdomain, so links work on hiring.amazon.ca/.com from every page (incl. the login page).
  const SITE = location.origin.replace('//auth.', '//');
  const DETAIL_BASE = `${SITE}/app#/jobDetail`;
  const isTop = window === window.top; // only the top frame reports to the side panel
  const DEFAULT_LOCALE = location.hostname.endsWith('.ca') ? 'en-CA' : 'en-US';
  const LOG_KEY = 'jobbot-gql-log';
  const MAX_LOG = 100;

  // Flow state (jobs, first job, first schedule) lives in chrome.storage.local so it survives the hop between
  // hiring.amazon.com and auth.hiring.amazon.com. The GraphQL log stays per-origin in sessionStorage.
  // jobId -> { ...jobCard, link, isNew }
  let jobs = new Map();
  let responses = 0;
  let firstId = null; // first job card of the latest search response
  let schedule = null; // first schedule card of the latest searchScheduleCards response
  const persist = () => { try { return chrome.storage.local.set({ flow: { jobs: [...jobs], responses, firstId, schedule } }).catch(() => {}); } catch {} };

  // Every captured GraphQL exchange, on any route.
  let entries = [];
  try { entries = JSON.parse(sessionStorage.getItem(LOG_KEY)) || []; } catch {}
  const persistLog = () => { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch {} mirrorLog(); };
  // The side panel (sidepanel.html) reads the log and the live status from session storage; only the visible tab feeds it.
  let mirrorTimer = null;
  function mirrorLog() {
    if (!isTop || document.visibilityState !== 'visible') return;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => {
      if (!alive()) return;
      // GraphQL log in the side panel is disabled for now:
      // chrome.storage.session.set({ gqlLog: entries }).catch(() => chrome.storage.session.set({ gqlLog: entries.slice(-20) }).catch(() => {}));
    }, 400);
  }

  const OPEN_DELAY_MS = 3000;
  const STALL_MS = 5000;      // no progress for this long -> refresh the page
  const REFRESH_KEY = 'jobbot-refreshes';
  let lastProgress = Date.now();
  const progress = () => { lastProgress = Date.now(); };
  let navTimer = null, navAt = 0, navLabel = '';
  let secrets = []; // saved login phone/PIN: scrubbed from anything we capture, display or copy
  let running = false, userPaused = false; // nothing runs until Start is pressed in the side panel
  let paused = true;   // not running, or paused
  let autoOpen = false; // automation runs only while started

  const onRoute = () => location.hash.startsWith(ROUTE);
  const onDetail = () => location.hash.startsWith('#/jobDetail');
  const hashJobId = () => new URLSearchParams(location.hash.split('?')[1] || '').get('jobId');

  // Application page URL for a schedule card.
  // .ca pattern comes from a real URL; the .com pattern is from memory and still needs checking against a real one.
  function applicationLink(c, locale) {
    const loc = encodeURIComponent(locale || DEFAULT_LOCALE);
    if (location.hostname.endsWith('.ca')) {
      const q = `jobId=${encodeURIComponent(c.jobUuid || c.jobId)}&locale=${loc}&page=pre-consent`
        + `&scheduleId=${encodeURIComponent(c.scheduleUuid || c.scheduleId)}&country=ca&token=`;
      return `${SITE}/application/?${q}`;
    }
    return `${SITE}/application/us/?CS=true&jobId=${encodeURIComponent(c.jobId)}&locale=${loc}`
      + `&scheduleId=${encodeURIComponent(c.scheduleId)}&ssoEnabled=1`;
  }

  // Navigate in the same tab after a visible countdown; cancelled implicitly if `stillValid` fails when it fires.
  function navigateSoon(label, target, stillValid) {
    clearTimeout(navTimer);
    navLabel = label;
    navAt = Date.now() + OPEN_DELAY_MS;
    navTimer = setTimeout(() => { navAt = 0; if (stillValid()) location.href = target; }, OPEN_DELAY_MS);
  }
  const detailLink = (jobId, locale) => `${DETAIL_BASE}?jobId=${encodeURIComponent(jobId)}&locale=${encodeURIComponent(locale || DEFAULT_LOCALE)}`;

  const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
  const opName = (e) =>
    e.request?.operationName || e.request?.[0]?.operationName || Object.keys(e.response?.data || {})[0] || 'unknown';
  const isBad = (e) => e.status >= 400 || !!e.response?.errors;

  function redact(entry) {
    if (!secrets.length) return entry;
    let text = JSON.stringify(entry);
    for (const sec of secrets) text = text.split(sec).join('***');
    try { return JSON.parse(text); } catch { return entry; }
  }

  function ingest(entry) {
    progress();
    entry = redact(entry);
    entries.push(entry);
    if (entries.length > MAX_LOG) entries.shift();
    persistLog();
    const op = entry.request?.operationName || entry.request?.[0]?.operationName;

    if (op === 'searchScheduleCards') {
      const first = entry.response?.data?.searchScheduleCards?.scheduleCards?.find((c) => c?.scheduleId);
      if (!first) return;
      const locale = entry.request?.variables?.searchScheduleRequest?.locale;
      schedule = { ...first, link: applicationLink(first, locale) };
      persist();
      if (autoOpen && onDetail() && first.jobId === hashJobId()) {
        navigateSoon('Opening application', schedule.link, () => onDetail() && first.jobId === hashJobId());
      }
      return;
    }

    const cards = entry.response?.data?.searchJobCardsByLocation?.jobCards;
    if (op !== OPERATION || !Array.isArray(cards)) return;
    const locale = entry.request?.variables?.searchJobRequest?.locale;
    const known = new Set(jobs.keys());
    responses++;
    for (const c of cards) {
      if (!c?.jobId) continue;
      jobs.set(c.jobId, { ...c, link: detailLink(c.jobId, locale), isNew: !known.has(c.jobId) && known.size > 0 });
    }
    firstId = cards.find((c) => c?.jobId)?.jobId || firstId;
    persist();

    // Next step: jump to the first job from this response, in the same tab.
    const first = cards.find((c) => c?.jobId);
    if (autoOpen && onRoute() && first) {
      navigateSoon('Opening first job', jobs.get(first.jobId).link, onRoute);
    }
  }

  // Where in the flow this page is, derived from the URL (works on every origin).
  const STEPS = ['Search', 'Job', 'Application', 'Login'];
  function currentStep() {
    if (location.hostname.startsWith('auth.')) return 3;
    if (location.pathname.startsWith('/application')) return 2;
    if (location.hash.startsWith('#/jobDetail')) return 1;
    if (location.hash.startsWith('#/jobSearch')) return 0;
    return -1;
  }
  function stepDetail(step) {
    const sid = schedule?.scheduleId;
    if (step === 0) return firstId ? `Found ${jobs.size} job(s). First: ${firstId}` : 'Waiting for searchJobCardsByLocation…';
    if (step === 1) return schedule ? `Schedule found: ${sid}` : 'Waiting for searchScheduleCards…';
    if (step === 2) return `Application · ${window.__jobbotAppStatus || location.hash.split('?')[0] || 'loading…'}${sid ? ` · schedule ${sid}` : ''}`;
    if (step === 3) return `Login page · ${window.__jobbotLoginStatus || 'starting auto-login…'}`;
    return 'Not on a known step';
  }
  function statusInfo() {
    const cur = currentStep();
    const secs = navAt ? Math.max(0, Math.ceil((navAt - Date.now()) / 1000)) : 0;
    return {
      step: cur,
      stepName: cur >= 0 ? `${cur + 1}/${STEPS.length} ${STEPS[cur]}` : 'Idle',
      detail: paused ? (running ? 'Paused — press Resume in the side panel' : 'Stopped — press Start in the side panel') : secs ? `${navLabel} in ${secs}s` : stepDetail(cur),
      chip: paused ? (running ? 'paused' : 'idle') : cur < 0 ? 'idle' : '',
      chipText: paused ? (running ? 'Paused' : 'Stopped') : cur < 0 ? 'Idle' : 'Running',
    };
  }

  // The side panel reads this from session storage; only the visible tab feeds it.
  let lastLive = '';
  function publishLive() {
    if (!isTop || !ready || document.visibilityState !== 'visible') return;
    const live = { ...statusInfo(), count: entries.length, url: location.href };
    const text = JSON.stringify(live);
    if (text === lastLive) return;
    lastLive = text;
    chrome.storage.session.set({ live }).catch(() => {});
  }
  every(publishLive, 1000);
  document.addEventListener('visibilitychange', () => { lastLive = ''; publishLive(); mirrorLog(); });

  // Forget the flow state and begin again from the search page (also re-arms the login attempt limit).
  function restart() {
    clearTimeout(navTimer); navAt = 0;
    try { sessionStorage.removeItem(REFRESH_KEY); } catch {}
    jobs = new Map(); responses = 0; firstId = null; schedule = null;
    chrome.storage.local.set({ loginReset: Date.now() }).catch(() => {});
    const same = location.origin === SITE && location.pathname === '/app' && location.hash.startsWith(ROUTE);
    Promise.resolve(persist()).then(() => (same ? location.reload() : location.assign(`${SITE}/app${ROUTE}`)));
  }

  // Commands from the side panel (it is not part of the page, so it asks the active tab).
  chrome.runtime.onMessage.addListener((msg) => {
    if (!isTop || msg?.type !== 'jobbot-cmd') return;
    if (msg.cmd === 'restart') restart();
    if (msg.cmd === 'clear-log') { entries = []; persistLog(); }
  });

  // True while the page is waiting on something the extension drives (not on you).
  function waitingOnAutomation() {
    if (!autoOpen || navAt) return false;
    const step = currentStep();
    if (step < 0) return false;
    if (step === 2) return false; // the application pages are driven by application.js and may need you; never auto-refresh them
    if (step === 3) return !/^verification|waiting for you|auto-login (is off|paused|stopped)/i.test(window.__jobbotLoginStatus || '');
    return true;
  }

  // Stalled pages are reloaded until you stop it.
  function watchdog() {
    if (!ready || !isTop) return;
    if (!waitingOnAutomation() || Date.now() - lastProgress <= STALL_MS) return;
    lastProgress = Date.now();
    location.reload();
  }
  every(watchdog, 1000);

  // Captures can arrive before the stored flow state has loaded; hold them until it has.
  let ready = false;
  const pending = [];
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'jobbot-gql') return;
    if (ready) ingest(ev.data.entry); else pending.push(ev.data.entry);
  });
  window.addEventListener('jobbot-login-status', () => {
    if (window.__jobbotLoginStatus !== lastLoginStatus) { lastLoginStatus = window.__jobbotLoginStatus; progress(); }
  });
  let lastLoginStatus = '';
  // SPA route changes made with pushState don't fire hashchange, so also watch the URL.
  let lastHref = location.href;
  every(() => { if (location.href !== lastHref) { lastHref = location.href; progress(); } }, 500);

  chrome.storage.local.get(['running', 'paused', 'flow', 'loginPhone', 'loginPin']).then((st) => {
    secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4);
    running = st.running === true; userPaused = !!st.paused; paused = !running || userPaused; autoOpen = !paused;
    const f = st.flow;
    if (f) { jobs = new Map(f.jobs || []); responses = f.responses || 0; firstId = f.firstId || null; schedule = f.schedule || null; }
    ready = true;
    progress();
    for (const e of pending.splice(0)) ingest(e);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('running' in c) running = c.running.newValue === true;
    if ('paused' in c) userPaused = !!c.paused.newValue;
    paused = !running || userPaused;
    if (paused) { clearTimeout(navTimer); navAt = 0; }
    autoOpen = !paused;
    if ('loginPhone' in c || 'loginPin' in c) chrome.storage.local.get(['loginPhone', 'loginPin']).then((st) => { secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4); });
  });
})();
