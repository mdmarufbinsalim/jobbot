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
  let enabled = true;
  let secrets = []; // saved login phone/PIN: scrubbed from anything we capture, display or copy
  let userAuto = true, paused = false;
  let autoOpen = true; // user's Auto-continue switch and not paused
  let collapsed = true; // minimized by default; remembered in storage as panelMin
  let autoLogin = true;
  let filter = '';
  let kycLinks = []; // saved remote-KYC links, from session storage (see background.js)
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

  const ICON = {
    pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>',
    restart: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>',
    expand: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" /></svg>',
    collapse: '<svg viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" /></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18" /></svg>',
  };
  const LOGO = '<svg viewBox="0 0 32 32"><defs><linearGradient id="jg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6366f1"/><stop offset="1" stop-color="#06b6d4"/></linearGradient></defs><rect width="32" height="32" rx="8" fill="url(#jg)"/><path d="M9 17.5l4.5 4.5L23 11" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .panel { --bg:#0b1020; --card:#131a2e; --card2:#18213a; --line:#232d47; --fg:#e8ecf7; --muted:#8a96b3;
      --accent:#818cf8; --accent2:#22d3ee; --ok:#34d399; --warn:#fbbf24; --bad:#f87171;
      position: fixed; top: 12px; right: 12px; width: 440px; max-width: calc(100vw - 24px); max-height: calc(100vh - 24px);
      z-index: 2147483647; display: flex; flex-direction: column; overflow: hidden;
      font: 12px/1.45 system-ui, -apple-system, 'Segoe UI', sans-serif; color: var(--fg); background: var(--bg);
      border: 1px solid var(--line); border-radius: 14px; box-shadow: 0 16px 48px rgba(2,6,23,.55); }
    .panel.min { width: 360px; }
    .panel.min .full { display: none; }
    .panel:not(.min) { bottom: 12px; }
    svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }

    .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px; }
    .brand { display: flex; align-items: center; gap: 8px; margin-right: auto; font-weight: 700; font-size: 13px; letter-spacing: .01em; }
    .brand svg { width: 22px; height: 22px; stroke: none; }
    .chip { display: inline-flex; align-items: center; gap: 6px; padding: 2px 9px; border-radius: 999px; font-size: 11px; font-weight: 600;
      background: color-mix(in srgb, var(--ok) 14%, transparent); color: var(--ok); }
    .chip i { width: 6px; height: 6px; border-radius: 50%; background: currentColor; box-shadow: 0 0 6px currentColor; }
    .chip.paused { background: color-mix(in srgb, var(--warn) 14%, transparent); color: var(--warn); }
    .chip.bad { background: color-mix(in srgb, var(--bad) 14%, transparent); color: var(--bad); }
    .chip.idle { background: var(--card); color: var(--muted); }
    .ctl { display: flex; gap: 2px; }
    .ib { display: grid; place-items: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: 8px; color: var(--muted); background: transparent; cursor: pointer; }
    .ib:hover { background: var(--card2); color: var(--fg); }
    .ib.go { color: #052e1b; background: var(--ok); }
    .ib.go:hover { background: var(--ok); filter: brightness(1.1); }
    .ib:focus-visible, .tab:focus-visible, .btn:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

    .mini { padding: 0 12px 12px; }
    .seg { display: flex; gap: 4px; margin-bottom: 8px; }
    .seg span { flex: 1; height: 4px; border-radius: 2px; background: var(--line); }
    .seg span.done { background: var(--ok); }
    .seg span.now { background: linear-gradient(90deg, var(--accent), var(--accent2)); }
    .now-line { display: flex; gap: 6px; align-items: baseline; }
    .stepname { font-weight: 700; font-size: 13px; white-space: nowrap; }
    .detail { color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
    .toggles { display: flex; gap: 14px; margin-top: 10px; }
    .tg { display: inline-flex; align-items: center; gap: 7px; color: var(--muted); cursor: pointer; user-select: none; }
    .tg input { appearance: none; width: 28px; height: 16px; margin: 0; border-radius: 8px; background: var(--line); position: relative; cursor: pointer; transition: background .15s; }
    .tg input::after { content: ''; position: absolute; top: 2px; left: 2px; width: 12px; height: 12px; border-radius: 50%; background: #fff; transition: transform .15s; }
    .tg input:checked { background: var(--accent); }
    .tg input:checked::after { transform: translateX(12px); }
    .tg input:checked + span { color: var(--fg); }

    .full { display: flex; flex-direction: column; min-height: 0; flex: 1; border-top: 1px solid var(--line); }
    .tabs { display: flex; gap: 4px; padding: 8px 12px 0; }
    .tab { padding: 6px 12px; border: 0; border-radius: 8px 8px 0 0; background: transparent; color: var(--muted); font: inherit; font-weight: 600; cursor: pointer; border-bottom: 2px solid transparent; }
    .tab:hover { color: var(--fg); }
    .tab.on { color: var(--fg); border-bottom-color: var(--accent); }
    .tab small { margin-left: 4px; padding: 0 6px; border-radius: 8px; background: var(--card); color: var(--muted); font-weight: 600; }
    .pane { flex: 1; min-height: 0; overflow: auto; padding: 4px 12px 12px; display: flex; flex-direction: column; gap: 14px; }
    .pane[hidden] { display: none; }
    .sec h3 { margin: 10px 0 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    .sec .empty { padding: 10px; border: 1px dashed var(--line); border-radius: 10px; }

    button.btn { font: inherit; color: var(--fg); background: var(--card2); border: 1px solid var(--line); border-radius: 7px; padding: 3px 10px; cursor: pointer; }
    button.btn:hover { border-color: var(--accent); }
    .tools { display: flex; gap: 6px; align-items: center; }
    input[type=text] { flex: 1; min-width: 0; padding: 6px 10px; color: var(--fg); background: var(--card); border: 1px solid var(--line); border-radius: 8px; font: inherit; }
    input[type=text]:focus { outline: none; border-color: var(--accent); }
    .stat { color: var(--muted); font-size: 11px; }
    .list { display: flex; flex-direction: column; gap: 6px; }
    .empty { padding: 28px 12px; text-align: center; color: var(--muted); }
    .job { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; }
    .top { display: flex; gap: 8px; align-items: baseline; }
    .name { font-weight: 600; margin-right: auto; }
    .pay { color: var(--ok); font-weight: 700; white-space: nowrap; }
    .new { padding: 0 6px; border-radius: 8px; font-size: 10px; font-weight: 700; background: var(--accent); color: #0b1020; }
    .meta { color: var(--muted); margin: 2px 0 8px; }
    .linkrow { display: flex; gap: 6px; align-items: center; }
    details { background: var(--card); border: 1px solid var(--line); border-radius: 10px; }
    details[open] { border-color: #34416120; border-color: #344164; }
    summary { display: flex; align-items: center; gap: 8px; padding: 8px 10px; cursor: pointer; list-style: none; }
    summary::-webkit-details-marker { display: none; }
    summary::before { content: '▸'; color: var(--muted); }
    details[open] > summary::before { content: '▾'; }
    .op { font-weight: 600; margin-right: auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .time { color: var(--muted); font-size: 11px; }
    .badge { padding: 0 7px; border-radius: 9px; font-size: 11px; font-weight: 600; background: color-mix(in srgb, var(--ok) 16%, transparent); color: var(--ok); }
    .badge.bad { background: color-mix(in srgb, var(--bad) 16%, transparent); color: var(--bad); }
    .section { padding: 0 10px 10px; }
    .shead { display: flex; justify-content: space-between; align-items: center; margin: 4px 0; color: var(--muted);
      font-size: 11px; text-transform: uppercase; letter-spacing: .05em; }
    .shead button { padding: 1px 7px; font-size: 11px; text-transform: none; letter-spacing: 0; }
    pre { margin: 0; padding: 8px; max-height: 280px; overflow: auto; background: #070b16; border-radius: 8px;
      font: 11px/1.5 ui-monospace, SFMono-Regular, Menlo, monospace; white-space: pre-wrap; word-break: break-all; }
    .k { color: #7dd3fc; } .s { color: #86efac; } .n { color: #fdba74; } .b { color: #c4b5fd; } .z { color: #8a96b3; }
    a { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #7dd3fc;
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
      <div class="panel min">
        <div class="head">
          <div class="brand">${LOGO}<span>Jobbot</span></div>
          <span class="chip"><i></i><span data-r="chip"></span></span>
          <div class="ctl">
            <button class="ib" data-a="pause">${ICON.pause}</button>
            <button class="ib" data-a="restart" title="Start over from the search page">${ICON.restart}</button>
            <button class="ib" data-a="min">${ICON.expand}</button>
            <button class="ib" data-a="hide" title="Hide panel (turn it back on from the extension popup)">${ICON.close}</button>
          </div>
        </div>
        <div class="mini">
          <div class="seg">${STEPS.map(() => '<span></span>').join('')}</div>
          <div class="now-line"><span class="stepname"></span><span class="detail"></span></div>
          <div class="toggles">
            <label class="tg"><input type="checkbox" data-t="autoOpen"><span>Auto-continue</span></label>
            <label class="tg"><input type="checkbox" data-t="autoLogin"><span>Auto-login</span></label>
          </div>
        </div>
        <div class="full">
          <div class="tabs">
            <button class="tab on" data-tab="overview">Overview</button>
            <button class="tab" data-tab="log">GraphQL log<small class="count"></small></button>
          </div>
          <div class="pane" data-pane="overview">
            <div class="sec"><h3>First job</h3><div class="slot"></div></div>
            <div class="sec"><h3>First schedule</h3><div class="sslot"></div></div>
            <div class="sec"><h3>Saved KYC links</h3><div class="kslot"></div></div>
          </div>
          <div class="pane" data-pane="log" hidden>
            <div class="tools"><input type="text" placeholder="Filter by title, location or job id…"><button class="btn" data-a="copy">Copy</button><button class="btn" data-a="clear">Clear</button></div>
            <div class="stat"></div>
            <div class="list"></div>
          </div>
        </div>
      </div>`;
    const q = (sel) => root.querySelector(sel);
    el = { panel: q('.panel'), count: q('.count'), stat: q('.stat'), chip: q('[data-r=chip]'), chipBox: q('.chip'),
      seg: [...root.querySelectorAll('.seg span')], stepname: q('.stepname'), detail: q('.detail'),
      slot: q('.slot'), sslot: q('.sslot'), kslot: q('.kslot'), list: q('.list'), input: q('input[type=text]'),
      pause: q('[data-a=pause]'), min: q('[data-a=min]') };

    q('[data-a=copy]').onclick = (ev) =>
      copy(JSON.stringify(visibleEntries(), (k, v) =>
        k !== 'query' && typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… [${v.length} chars]` : v, 2), ev.target);
    q('[data-a=restart]').onclick = restart;
    el.pause.onclick = () => chrome.storage.local.set({ paused: !paused });
    q('[data-a=hide]').onclick = () => chrome.storage.local.set({ enabled: false });
    q('[data-a=clear]').onclick = () => {
      jobs = new Map(); responses = 0; firstId = null; schedule = null; entries = []; persist(); persistLog(); render();
    };
    el.min.onclick = () => { collapsed = !collapsed; chrome.storage.local.set({ panelMin: collapsed }); paintLayout(); };
    for (const t of root.querySelectorAll('[data-tab]')) t.onclick = () => {
      for (const o of root.querySelectorAll('[data-tab]')) o.classList.toggle('on', o === t);
      for (const p of root.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t.dataset.tab;
    };
    for (const t of root.querySelectorAll('[data-t]')) t.onchange = () => chrome.storage.local.set({ [t.dataset.t]: t.checked });
    el.input.oninput = () => { filter = el.input.value.toLowerCase(); render(); };
    paintLayout();
  }

  function paintLayout() {
    if (!el.panel) return;
    el.panel.classList.toggle('min', collapsed);
    el.min.innerHTML = collapsed ? ICON.expand : ICON.collapse;
    el.min.title = collapsed ? 'Show details' : 'Minimize';
    paintPause();
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
    if (!el.seg) return;
    const cur = currentStep();
    el.seg.forEach((d, i) => { d.className = i === cur ? 'now' : i < cur ? 'done' : ''; });
    el.stepname.textContent = cur >= 0 ? `${cur + 1}/${STEPS.length} ${STEPS[cur]}` : 'Idle';
    const secs = navAt ? Math.max(0, Math.ceil((navAt - Date.now()) / 1000)) : 0;
    el.detail.textContent = paused ? 'Paused — press play to continue' : gaveUp ? 'Stuck — press ↻ to start over'
      : secs ? `${navLabel} in ${secs}s` : stepDetail(cur);
    el.detail.title = el.detail.textContent;
    el.chipBox.className = 'chip' + (paused ? ' paused' : gaveUp ? ' bad' : cur < 0 ? ' idle' : '');
    el.chip.textContent = paused ? 'Paused' : gaveUp ? 'Stuck' : cur < 0 ? 'Idle' : 'Running';
  }

  function paintPause() {
    if (!el.pause) return;
    el.pause.innerHTML = paused ? ICON.play : ICON.pause;
    el.pause.title = paused ? 'Resume automation' : 'Pause automation';
    el.pause.classList.toggle('go', paused);
    for (const t of root.querySelectorAll('[data-t]')) t.checked = t.dataset.t === 'autoOpen' ? userAuto : autoLogin;
    paintSteps();
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

  function kycRow(k) {
    const d = document.createElement('div'); d.className = 'job';
    const meta = document.createElement('div'); meta.className = 'meta';
    meta.textContent = new Date(k.at).toLocaleTimeString() + (k.copied ? '' : ' · not copied to clipboard');
    const row = document.createElement('div'); row.className = 'linkrow';
    const a = document.createElement('a'); a.href = k.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = k.url; a.title = k.url;
    const b = document.createElement('button'); b.textContent = 'Copy'; b.onclick = () => copy(k.url, b);
    row.append(a, b);
    d.append(meta, row);
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
    el.stat.textContent = `${entries.length} GraphQL response${entries.length === 1 ? '' : 's'} captured`;
    paintSteps();
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
    el.kslot.replaceChildren(...(kycLinks.length ? kycLinks.map(kycRow) : [emptyNote('None yet')]));
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

  chrome.storage.local.get(['enabled', 'autoOpen', 'autoLogin', 'panelMin', 'paused', 'flow', 'loginPhone', 'loginPin']).then((st) => {
    collapsed = st.panelMin !== false; autoLogin = st.autoLogin !== false;
    secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4);
    enabled = st.enabled !== false; userAuto = st.autoOpen !== false; paused = !!st.paused; autoOpen = userAuto && !paused;
    const f = st.flow;
    if (f) { jobs = new Map(f.jobs || []); responses = f.responses || 0; firstId = f.firstId || null; schedule = f.schedule || null; }
    ready = true;
    progress();
    render();
    for (const e of pending.splice(0)) ingest(e);
  });
  chrome.storage.session.get('kycLinks').then((st) => { kycLinks = st.kycLinks || []; if (ready) render(); }).catch(() => {});
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && c.kycLinks) { kycLinks = c.kycLinks.newValue || []; render(); return; }
    if (area !== 'local') return;
    if ('enabled' in c) enabled = c.enabled.newValue !== false;
    if ('autoOpen' in c) userAuto = c.autoOpen.newValue !== false;
    if ('autoLogin' in c) autoLogin = c.autoLogin.newValue !== false;
    if ('panelMin' in c) { collapsed = c.panelMin.newValue !== false; paintLayout(); }
    if ('paused' in c) { paused = !!c.paused.newValue; if (paused) { clearTimeout(navTimer); navAt = 0; } }
    autoOpen = userAuto && !paused;
    paintPause();
    if ('loginPhone' in c || 'loginPin' in c) chrome.storage.local.get(['loginPhone', 'loginPin']).then((st) => { secrets = [st.loginPhone, st.loginPin].filter((v) => v && v.length >= 4); });
    render();
  });
})();
