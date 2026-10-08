// Isolated-world bridge: receives GraphQL captures from inject.js, shows the first job and first schedule found plus
// a GraphQL debug log in an on-page sidebar, and walks the tab search -> job detail -> application page.
(() => {
  const OPERATION = 'searchJobCardsByLocation';
  const ROUTE = '#/jobSearch';
  // Site origin without the "auth." subdomain, so links work on hiring.amazon.ca/.com from every page (incl. the login page).
  const SITE = location.origin.replace('//auth.', '//');
  const DETAIL_BASE = `${SITE}/app#/jobDetail`;
  const isTop = window === window.top; // only the top frame draws the sidebar
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
  const persist = () => chrome.storage.local.set({ flow: { jobs: [...jobs], responses, firstId, schedule } }).catch(() => {});

  // Every captured GraphQL exchange, on any route.
  let entries = [];
  try { entries = JSON.parse(sessionStorage.getItem(LOG_KEY)) || []; } catch {}
  const persistLog = () => { try { sessionStorage.setItem(LOG_KEY, JSON.stringify(entries)); } catch {} };

  const OPEN_DELAY_MS = 3000;
  const STALL_MS = 5000;      // no progress for this long -> refresh the page
  const MAX_REFRESHES = 5;    // per URL, so a dead page can't be hammered forever
  const REFRESH_KEY = 'jobbot-refreshes';
  let lastProgress = Date.now();
  let gaveUp = false;
  const progress = () => { lastProgress = Date.now(); };
  let navTimer = null, navAt = 0, navLabel = '';
  let enabled = false;
  let secrets = []; // saved login phone/PIN: scrubbed from anything we capture, display or copy
  let autoOpen = true;
  let collapsed = false;
  let filter = '';
  let host, root, el = {};

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
    navTimer = setTimeout(() => { navAt = 0; if (stillValid()) location.href = target; render(); }, OPEN_DELAY_MS);
    tick();
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
      if (!first) return render();
      const locale = entry.request?.variables?.searchScheduleRequest?.locale;
      schedule = { ...first, link: applicationLink(first, locale) };
      persist();
      render();
      if (enabled && autoOpen && onDetail() && first.jobId === hashJobId()) {
        navigateSoon('Opening application', schedule.link, () => onDetail() && first.jobId === hashJobId());
      }
      return;
    }

    const cards = entry.response?.data?.searchJobCardsByLocation?.jobCards;
    if (op !== OPERATION || !Array.isArray(cards)) return render();
    const locale = entry.request?.variables?.searchJobRequest?.locale;
    const known = new Set(jobs.keys());
    responses++;
    for (const c of cards) {
      if (!c?.jobId) continue;
      jobs.set(c.jobId, { ...c, link: detailLink(c.jobId, locale), isNew: !known.has(c.jobId) && known.size > 0 });
    }
    firstId = cards.find((c) => c?.jobId)?.jobId || firstId;
    persist();
    render();

    // Next step: jump to the first job from this response, in the same tab.
    const first = cards.find((c) => c?.jobId);
    if (enabled && autoOpen && onRoute() && first) {
      navigateSoon('Opening first job', jobs.get(first.jobId).link, onRoute);
    }
  }

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { --bg:#0f141a; --card:#171e27; --line:#2a3441; --fg:#e6edf3; --muted:#8b98a8; --accent:#ff9900;
      position: fixed; top: 12px; right: 12px; bottom: 12px; width: 440px; max-width: calc(100vw - 24px);
      z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden;
      font: 12px/1.45 system-ui, -apple-system, sans-serif; color: var(--fg); background: var(--bg);
      border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.45); }
    .panel.collapsed { bottom: auto; }
    .panel.collapsed .body { display: none; }
    .body { flex: 1; }
    .bar { display: flex; align-items: center; gap: 8px; padding: 10px 12px; user-select: none;
      background: #232f3e; border-bottom: 1px solid var(--line); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); box-shadow: 0 0 8px var(--accent); }
    .title { font-weight: 600; font-size: 13px; }
    .count { margin-right: auto; padding: 1px 8px; border-radius: 10px; background: #0f141a; color: var(--muted); }
    button { font: inherit; color: var(--fg); background: transparent; border: 1px solid var(--line); border-radius: 6px;
      padding: 3px 9px; cursor: pointer; }
    button:hover { border-color: var(--accent); }
    .body { display: flex; flex-direction: column; min-height: 0; }
    .tools { padding: 8px 12px; border-bottom: 1px solid var(--line); }
    input { width: 100%; padding: 5px 9px; color: var(--fg); background: var(--card); border: 1px solid var(--line);
      border-radius: 6px; font: inherit; }
    input:focus { outline: none; border-color: var(--accent); }
    .stat { padding: 4px 12px; color: var(--muted); font-size: 11px; border-bottom: 1px solid var(--line); }
    .list { overflow: auto; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
    .empty { padding: 28px 12px; text-align: center; color: var(--muted); }
    .job { background: var(--card); border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; }
    .top { display: flex; gap: 8px; align-items: baseline; }
    .name { font-weight: 600; margin-right: auto; }
    .pay { color: #4ade80; font-weight: 600; white-space: nowrap; }
    .new { padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 700; background: var(--accent); color: #111; }
    .meta { color: var(--muted); margin: 2px 0 6px; }
    .linkrow { display: flex; gap: 6px; align-items: center; }
    .steps { display: flex; gap: 4px; padding: 8px 12px 0; }
    .step { flex: 1; text-align: center; padding: 4px 2px; border: 1px solid var(--line); border-radius: 6px; color: var(--muted); font-size: 11px; }
    .step.done { color: #4ade80; border-color: #1f5130; }
    .step.now { color: #111; background: var(--accent); border-color: var(--accent); font-weight: 700; }
    .detail { padding: 6px 12px 0; color: var(--fg); }
    .first { padding: 8px 12px; border-bottom: 1px solid var(--line); }
    .first h3 { margin: 0 0 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; color: var(--accent); }
    .first .job { border-color: var(--accent); }
    .first .empty { padding: 8px 0; }
    details { background: var(--card); border: 1px solid var(--line); border-radius: 8px; }
    details[open] { border-color: #3b4859; }
    summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▸'; color: var(--muted); }
    details[open] > summary::before { content: '▾'; }
    .op { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .time { color: var(--muted); font-size: 11px; }
    .badge { padding: 0 7px; border-radius: 9px; font-size: 11px; font-weight: 600; background: #12351f; color: #4ade80; }
    .badge.bad { background: #3d1519; color: #f87171; }
    .section { padding: 0 10px 10px; }
    .shead { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .shead button { padding: 1px 7px; font-size: 11px; text-transform: none; letter-spacing: 0; }
    pre { margin: 0; padding: 8px; max-height: 280px; overflow: auto; background: #0b0f14; border-radius: 6px;
      font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
    .k { color: #79c0ff; } .s { color: #a5d6a7; } .n { color: #ffab70; } .b { color: #d2a8ff; } .z { color: #8b98a8; }
    a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #79c0ff;
      font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; text-decoration: none; }
    a:hover { text-decoration: underline; }
  `;

  // Minimal JSON highlighter that builds DOM nodes (no innerHTML on page data).
  const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  function highlight(text) {
    const frag = document.createDocumentFragment();
    if (text.length > 200000) { frag.append(text); return frag; }
    const put = (str, cls) => {
      if (!str) return;
      if (!cls) return frag.append(str);
      const sp = document.createElement('span'); sp.className = cls; sp.textContent = str; frag.append(sp);
    };
    let last = 0, m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(text))) {
      put(text.slice(last, m.index));
      if (m[1]) { put(m[1], m[2] ? 'k' : 's'); put(m[2]); }
      else if (m[3]) put(m[0], 'b');
      else if (m[0] === 'null') put(m[0], 'z');
      else put(m[0], 'n');
      last = TOKEN.lastIndex;
    }
    put(text.slice(last));
    return frag;
  }

  function copy(text, btn) {
    navigator.clipboard.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = 'Copied';
      setTimeout(() => { btn.textContent = old; }, 900);
    });
  }

  const visibleEntries = () => entries.filter((e) =>
    !filter || (opName(e) + ' ' + pretty(e.response)).toLowerCase().includes(filter));

  function section(label, val) {
    const wrap = document.createElement('div'); wrap.className = 'section';
    const head = document.createElement('div'); head.className = 'shead';
    const l = document.createElement('span'); l.textContent = label;
    const b = document.createElement('button'); b.textContent = 'Copy';
    const text = pretty(val);
    b.onclick = () => copy(text, b);
    head.append(l, b);
    const pre = document.createElement('pre'); pre.append(highlight(text));
    wrap.append(head, pre);
    return wrap;
  }

  function entryRow(e, wasOpen) {
    const d = document.createElement('details'); d.dataset.id = `${e.t}:${e.url}:${opName(e)}`; d.open = wasOpen;
    const sm = document.createElement('summary');
    const op = document.createElement('span'); op.className = 'op'; op.textContent = opName(e);
    const tm = document.createElement('span'); tm.className = 'time'; tm.textContent = new Date(e.t).toLocaleTimeString();
    const bd = document.createElement('span'); bd.className = 'badge' + (isBad(e) ? ' bad' : ''); bd.textContent = e.status;
    sm.append(op, tm, bd);
    d.append(sm);
    // Heavy JSON is only built when the entry is expanded.
    const fill = () => { if (!d.querySelector('.section')) d.append(section('Request', e.request), section('Response', e.response)); };
    if (d.open) fill();
    d.addEventListener('toggle', () => d.open && fill());
    return d;
  }

  function makeHost() {
    host = document.createElement('div');
    root = host.attachShadow({ mode: 'open' });
    root.innerHTML = `<style>${CSS}</style>
      <div class="panel">
        <div class="bar"><span class="dot"></span><span class="title">Jobbot</span><span class="count"></span>
          <button data-a="restart" title="Start over from the search page">↻</button><button data-a="copy">Copy</button><button data-a="clear">Clear</button><button data-a="min">–</button></div>
        <div class="body">
          <div class="steps"></div>
          <div class="first"><h3>First job found</h3><div class="slot"></div></div>
          <div class="first"><h3>First schedule</h3><div class="sslot"></div></div>
          <div class="tools"><input placeholder="Filter by title, location or job id…"></div>
          <div class="stat"></div>
          <div class="list"></div>
        </div>
      </div>`;
    el = { panel: root.querySelector('.panel'), bar: root.querySelector('.bar'), count: root.querySelector('.count'),
      stat: root.querySelector('.stat'), steps: root.querySelector('.steps'), detail: null, slot: root.querySelector('.first .slot'), sslot: root.querySelector('.sslot'), list: root.querySelector('.list'), input: root.querySelector('input') };

    root.querySelector('[data-a=copy]').onclick = (ev) =>
      copy(JSON.stringify(visibleEntries(), (k, v) =>
        k !== 'query' && typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… [${v.length} chars]` : v, 2), ev.target);
    root.querySelector('[data-a=restart]').onclick = restart;
    root.querySelector('[data-a=clear]').onclick = () => {
      jobs = new Map(); responses = 0; firstId = null; schedule = null; entries = []; persist(); persistLog(); render();
    };
    root.querySelector('[data-a=min]').onclick = (ev) => {
      collapsed = !collapsed; el.panel.classList.toggle('collapsed', collapsed); ev.target.textContent = collapsed ? '+' : '–';
    };
    el.input.oninput = () => { filter = el.input.value.toLowerCase(); render(); };

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
  function paintSteps() {
    const cur = currentStep();
    el.steps.replaceChildren(...STEPS.map((name, i) => {
      const d = document.createElement('div');
      d.className = 'step' + (i === cur ? ' now' : i < cur ? ' done' : '');
      d.textContent = `${i < cur ? '✓' : i + 1} ${name}`;
      return d;
    }), Object.assign(document.createElement('div'), { className: 'detail', textContent: stepDetail(cur) }));
    // The detail line is a sibling in the same row container; give it its own line.
    el.steps.style.flexWrap = 'wrap';
    el.steps.lastChild.style.flexBasis = '100%';
  }

  // Forget the flow state and begin again from the search page (also re-arms the login attempt limit).
  function restart() {
    clearTimeout(navTimer); navAt = 0;
    try { sessionStorage.removeItem(REFRESH_KEY); } catch {}
    jobs = new Map(); responses = 0; firstId = null; schedule = null;
    chrome.storage.local.set({ loginReset: Date.now() }).catch(() => {});
    const same = location.origin === SITE && location.pathname === '/app' && location.hash.startsWith(ROUTE);
    Promise.resolve(persist()).then(() => (same ? location.reload() : location.assign(`${SITE}/app${ROUTE}`)));
  }

  function emptyNote(msg) { const d = document.createElement('div'); d.className = 'empty'; d.textContent = msg; return d; }

  function scheduleRow(c) {
    const d = document.createElement('div'); d.className = 'job';
    const top = document.createElement('div'); top.className = 'top';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = c.scheduleText || c.scheduleId;
    const pay = document.createElement('span'); pay.className = 'pay'; pay.textContent = c.totalPayRateL10N || '';
    top.append(name, pay);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [c.scheduleTypeL10N, c.hoursPerWeek && `${c.hoursPerWeek} h/wk`, c.laborDemandAvailableCount != null && `${c.laborDemandAvailableCount} open`,
      c.firstDayOnSiteL10N && `starts ${c.firstDayOnSiteL10N}`, c.scheduleId].filter(Boolean).join(' · ');
    const row = document.createElement('div'); row.className = 'linkrow';
    const a = document.createElement('a'); a.href = c.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = c.link; a.title = c.link;
    const b = document.createElement('button'); b.textContent = 'Copy'; b.onclick = () => copy(c.link, b);
    row.append(a, b);
    d.append(top, meta, row);
    return d;
  }

  function jobRow(j) {
    const d = document.createElement('div'); d.className = 'job';
    const top = document.createElement('div'); top.className = 'top';
    const name = document.createElement('span'); name.className = 'name'; name.textContent = j.jobTitle || j.jobId;
    top.append(name);
    if (j.isNew) { const n = document.createElement('span'); n.className = 'new'; n.textContent = 'NEW'; top.append(n); }
    const pay = document.createElement('span'); pay.className = 'pay';
    const lo = j.totalPayRateMinL10N, hi = j.totalPayRateMaxL10N;
    pay.textContent = lo && hi && lo !== hi ? `${lo}–${hi}` : (hi || lo || '');
    top.append(pay);
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = [j.locationName, j.jobTypeL10N || j.jobType, j.employmentTypeL10N || j.employmentType, `${j.scheduleCount ?? '?'} schedule(s)`, j.jobId].filter(Boolean).join(' · ');
    const row = document.createElement('div'); row.className = 'linkrow';
    const a = document.createElement('a'); a.href = j.link; a.target = '_blank'; a.rel = 'noopener'; a.textContent = j.link; a.title = j.link;
    const b = document.createElement('button'); b.textContent = 'Copy'; b.onclick = () => copy(j.link, b);
    row.append(a, b);
    d.append(top, meta, row);
    return d;
  }

  // Re-render once a second while the auto-open countdown is running.
  function paintStat() {
    if (!el.stat) return;
    const secs = navAt ? Math.max(0, Math.ceil((navAt - Date.now()) / 1000)) : 0;
    const stalled = Math.floor((Date.now() - lastProgress) / 1000);
    const note = gaveUp ? `Stuck: gave up after ${MAX_REFRESHES} refreshes (click ↻ to reset) · ` : secs ? `${navLabel} in ${secs}s · ` : stalled >= 2 && waitingOnAutomation() ? `No progress for ${stalled}s (refresh at ${STALL_MS / 1000}s) · ` : '';
    el.stat.textContent = note + `GraphQL log · ${entries.length} captured`;
  }
  function tick() {
    paintStat();
    if (navAt && Date.now() < navAt) setTimeout(tick, 500);
  }

  function render() {
    if (!enabled || !isTop) { if (host) host.remove(); return; }
    if (!host) makeHost();
    if (!host.isConnected) (document.body || document.documentElement).append(host);

    const first = jobs.get(firstId);
    if (first) el.slot.replaceChildren(jobRow(first));
    else el.slot.replaceChildren(emptyNote('None yet'));

    paintSteps();
    el.sslot.replaceChildren(schedule ? scheduleRow(schedule) : emptyNote('None yet'));
    el.count.textContent = entries.length;
    const empty = (msg) => { const d = document.createElement('div'); d.className = 'empty'; d.textContent = msg; return d; };
    paintStat();
    const open = new Set([...el.list.querySelectorAll('details[open]')].map((d) => d.dataset.id));
    const shown = visibleEntries();
    el.list.replaceChildren(...(shown.length
      ? shown.slice().reverse().map((e) => entryRow(e, open.has(`${e.t}:${e.url}:${opName(e)}`)))
      : [empty(entries.length ? 'No responses match the filter.' : 'Waiting for GraphQL responses…')]));
  }

  // True while the page is waiting on something the extension drives (not on you).
  function waitingOnAutomation() {
    if (!enabled || !autoOpen || navAt) return false;
    const step = currentStep();
    if (step < 0) return false;
    if (step === 2) return false; // the application pages are driven by application.js and may need you; never auto-refresh them
    if (step === 3) return !/^verification|waiting for you|auto-login (is off|paused|stopped)/i.test(window.__jobbotLoginStatus || '');
    return true;
  }

  function watchdog() {
    if (!ready || !isTop) return;
    paintStat();
    if (!waitingOnAutomation() || Date.now() - lastProgress <= STALL_MS) return;
    const key = location.origin + location.pathname + location.hash;
    let rec = {};
    try { rec = JSON.parse(sessionStorage.getItem(REFRESH_KEY)) || {}; } catch {}
    if (rec.key !== key) rec = { key, n: 0 };
    if (rec.n >= MAX_REFRESHES) { gaveUp = true; paintStat(); return; }
    rec.n++;
    try { sessionStorage.setItem(REFRESH_KEY, JSON.stringify(rec)); } catch {}
    lastProgress = Date.now();
    location.reload();
  }
  setInterval(watchdog, 1000);

  // Captures can arrive before the stored flow state has loaded; hold them until it has.
  let ready = false;
  const pending = [];
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'jobbot-gql') return;
    if (ready) ingest(ev.data.entry); else pending.push(ev.data.entry);
  });
  window.addEventListener('hashchange', render);
  window.addEventListener('popstate', render);
  window.addEventListener('jobbot-app-status', () => { if (host && enabled) paintSteps(); });
  let lastLoginStatus = '';
  window.addEventListener('jobbot-login-status', () => {
    if (window.__jobbotLoginStatus !== lastLoginStatus) { lastLoginStatus = window.__jobbotLoginStatus; progress(); }
    if (host && enabled) paintSteps();
  });
  // SPA route changes made with pushState don't fire hashchange, so also watch the URL.
  let lastHref = location.href;
  setInterval(() => { if (location.href !== lastHref) { lastHref = location.href; progress(); render(); } }, 500);

  chrome.storage.local.get(['enabled', 'autoOpen', 'flow', 'loginPhone', 'loginPin']).then((st) => {
    secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4);
    enabled = !!st.enabled; autoOpen = st.autoOpen !== false;
    const f = st.flow;
    if (f) { jobs = new Map(f.jobs || []); responses = f.responses || 0; firstId = f.firstId || null; schedule = f.schedule || null; }
    ready = true;
    progress();
    render();
    for (const e of pending.splice(0)) ingest(e);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('enabled' in c) enabled = !!c.enabled.newValue;
    if ('autoOpen' in c) autoOpen = c.autoOpen.newValue !== false;
    if ('loginPhone' in c || 'loginPin' in c) chrome.storage.local.get(['loginPhone', 'loginPin']).then((st) => { secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4); });
    render();
  });
})();
