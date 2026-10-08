// Side panel dashboard. Reads what the hiring-page scripts publish: flow (storage.local), live status, GraphQL log and
// saved KYC links (storage.session), and sends commands to the active tab.
const $ = (id) => document.getElementById(id);
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>',
};
$('restart').innerHTML = ICON.restart;

let st = {};        // chrome.storage.local values
let live = null;    // status published by the active hiring tab
let log = [];
let kyc = [];
let filter = '';

function copy(text, btn) {
  navigator.clipboard.writeText(text).then(() => {
    const old = btn.textContent; btn.textContent = 'Copied';
    setTimeout(() => { btn.textContent = old; }, 900);
  });
}
const copyBtn = (text) => { const b = h('button', 'btn', 'Copy'); b.onclick = () => copy(text, b); return b; };
const empty = (msg) => h('div', 'empty', msg);

function linkRow(url) {
  const row = h('div', 'linkrow');
  const a = h('a', '', url); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.title = url;
  row.append(a, copyBtn(url));
  return row;
}

function jobCard(j) {
  const d = h('div', 'card'), top = h('div', 'top');
  top.append(h('span', 'name', j.jobTitle || j.jobId));
  if (j.isNew) top.append(h('span', 'new', 'NEW'));
  const lo = j.totalPayRateMinL10N, hi = j.totalPayRateMaxL10N;
  top.append(h('span', 'pay', lo && hi && lo !== hi ? `${lo}–${hi}` : (hi || lo || '')));
  d.append(top,
    h('div', 'meta', [j.locationName, j.jobTypeL10N || j.jobType, j.employmentTypeL10N || j.employmentType, `${j.scheduleCount ?? '?'} schedule(s)`, j.jobId].filter(Boolean).join(' · ')),
    linkRow(j.link));
  return d;
}

function scheduleCard(c) {
  const d = h('div', 'card'), top = h('div', 'top');
  top.append(h('span', 'name', c.scheduleText || c.scheduleId), h('span', 'pay', c.totalPayRateL10N || ''));
  d.append(top,
    h('div', 'meta', [c.scheduleTypeL10N, c.hoursPerWeek && `${c.hoursPerWeek} h/wk`, c.laborDemandAvailableCount != null && `${c.laborDemandAvailableCount} open`,
      c.firstDayOnSiteL10N && `starts ${c.firstDayOnSiteL10N}`, c.scheduleId].filter(Boolean).join(' · ')),
    linkRow(c.link));
  return d;
}

function kycCard(k) {
  const d = h('div', 'card');
  d.append(h('div', 'meta', new Date(k.at).toLocaleString() + (k.copied ? '' : ' · not copied to clipboard')), linkRow(k.url));
  return d;
}

// --- GraphQL log ---
const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const opName = (e) => e.request?.operationName || e.request?.[0]?.operationName || Object.keys(e.response?.data || {})[0] || 'unknown';
const isBad = (e) => e.status >= 400 || !!e.response?.errors;
const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
function highlight(text) {
  const frag = document.createDocumentFragment();
  if (text.length > 200000) { frag.append(text); return frag; }
  const put = (str, cls) => { if (!str) return; if (!cls) return frag.append(str); frag.append(h('span', cls, str)); };
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
function section(label, val) {
  const wrap = h('div', 'section'), head = h('div', 'shead');
  const text = pretty(val);
  head.append(h('span', '', label), copyBtn(text));
  const pre = h('pre'); pre.append(highlight(text));
  wrap.append(head, pre);
  return wrap;
}
function entryRow(e, wasOpen) {
  const d = h('details'); d.dataset.id = `${e.t}:${e.url}:${opName(e)}`; d.open = wasOpen;
  const sm = h('summary');
  sm.append(h('span', 'op', opName(e)), h('span', 'time', new Date(e.t).toLocaleTimeString()), h('span', 'badge' + (isBad(e) ? ' bad' : ''), e.status));
  d.append(sm);
  const fill = () => { if (!d.querySelector('.section')) d.append(section('Request', e.request), section('Response', e.response)); };
  if (d.open) fill();
  d.addEventListener('toggle', () => d.open && fill());
  return d;
}
const visibleLog = () => log.filter((e) => !filter || (opName(e) + ' ' + pretty(e.response)).toLowerCase().includes(filter));

// --- painting ---
function paintLive() {
  const l = live || { step: -1, stepName: 'Idle', detail: 'Open a hiring page to begin.', chip: 'idle', chipText: 'Idle' };
  const paused = !!st.paused;
  $('chip').className = 'chip' + (paused ? ' paused' : l.chip ? ` ${l.chip}` : '');
  $('chipText').textContent = paused ? 'Paused' : l.chipText;
  [...$('seg').children].forEach((d, i) => { d.className = i === l.step ? 'now' : i < l.step ? 'done' : ''; });
  $('stepname').textContent = l.stepName;
  $('detail').textContent = paused ? 'Paused — press play to continue' : l.detail;
  $('pause').innerHTML = paused ? ICON.play : ICON.pause;
  $('pause').title = paused ? 'Resume automation' : 'Pause automation';
  $('pause').classList.toggle('go', paused);
}

function paintSettings() {
  $('autoOpen').checked = st.autoOpen !== false;
  $('autoLogin').checked = st.autoLogin !== false;
  $('enabled').checked = st.enabled !== false;
  for (const id of ['loginPhone', 'loginPin', 'smsUrl']) if (document.activeElement !== $(id)) $(id).value = st[id] || '';
}

function paintOverview() {
  const flow = st.flow || {};
  const first = (flow.jobs || []).find(([id]) => id === flow.firstId)?.[1];
  $('job').replaceChildren(first ? jobCard(first) : empty('None yet'));
  $('schedule').replaceChildren(flow.schedule ? scheduleCard(flow.schedule) : empty('None yet'));
  $('kyc').replaceChildren(...(kyc.length ? kyc.map(kycCard) : [empty('None yet')]));
  $('kycClear').hidden = !kyc.length;
}

function paintLog() {
  $('logCount').textContent = log.length;
  const open = new Set([...$('log').querySelectorAll('details[open]')].map((d) => d.dataset.id));
  const shown = visibleLog();
  $('log').replaceChildren(...(shown.length
    ? shown.slice().reverse().map((e) => entryRow(e, open.has(`${e.t}:${e.url}:${opName(e)}`)))
    : [empty(log.length ? 'No responses match the filter.' : 'Waiting for GraphQL responses…')]));
}

const paintAll = () => { paintLive(); paintSettings(); paintOverview(); paintLog(); };

Promise.all([
  chrome.storage.local.get(null),
  chrome.storage.session.get(['live', 'gqlLog', 'kycLinks']),
]).then(([l, s]) => {
  st = l; live = s.live || null; log = s.gqlLog || []; kyc = s.kycLinks || [];
  paintAll();
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local') {
    for (const [k, v] of Object.entries(c)) st[k] = v.newValue;
    paintLive(); paintSettings(); if ('flow' in c) paintOverview();
  } else if (area === 'session') {
    if (c.live) { live = c.live.newValue || null; paintLive(); }
    if (c.gqlLog) { log = c.gqlLog.newValue || []; paintLog(); }
    if (c.kycLinks) { kyc = c.kycLinks.newValue || []; paintOverview(); }
  }
});

// --- controls ---
$('pause').onclick = () => chrome.storage.local.set({ paused: !st.paused });
async function toActiveTab(cmd) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'jobbot-cmd', cmd }).catch(() => {});
}
$('restart').onclick = () => toActiveTab('restart');
$('logClear').onclick = () => { log = []; chrome.storage.session.set({ gqlLog: [] }); toActiveTab('clear-log'); paintLog(); };
$('logCopy').onclick = (ev) => copy(JSON.stringify(visibleLog(), (k, v) =>
  k !== 'query' && typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… [${v.length} chars]` : v, 2), ev.target);
$('filter').oninput = (e) => { filter = e.target.value.toLowerCase(); paintLog(); };
$('kycClear').onclick = () => chrome.storage.session.remove('kycLinks');
for (const id of ['autoOpen', 'autoLogin', 'enabled']) $(id).onchange = (e) => chrome.storage.local.set({ [id]: e.target.checked });
for (const id of ['loginPhone', 'loginPin', 'smsUrl']) $(id).oninput = (e) => chrome.storage.local.set({ [id]: e.target.value.trim() });
for (const t of document.querySelectorAll('[data-tab]')) t.onclick = () => {
  for (const o of document.querySelectorAll('[data-tab]')) o.classList.toggle('on', o === t);
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t.dataset.tab;
};

const SEARCH_URLS = { ca: 'https://hiring.amazon.ca/app#/jobSearch', com: 'https://hiring.amazon.com/app#/jobSearch' };
for (const b of document.querySelectorAll('[data-site]')) b.onclick = () => chrome.tabs.create({ url: SEARCH_URLS[b.dataset.site] });
