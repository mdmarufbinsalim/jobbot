// Side panel dashboard. Reads what the hiring-page scripts publish: flow (storage.local), live status, GraphQL log and
// saved KYC links (storage.session), and sends commands to the active tab.
const $ = (id) => document.getElementById(id);
const SEARCH_URLS = { ca: 'https://hiring.amazon.ca/app#/jobSearch', com: 'https://hiring.amazon.com/app#/jobSearch' };
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const ICON = {
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" /></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15l12-7.5z" fill="currentColor" /></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5" /></svg>',
};
ICON.copy = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>';
ICON.open = '<svg viewBox="0 0 24 24"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>';
ICON.inbox = '<svg viewBox="0 0 24 24"><path d="M3 13l2.5-7a2 2 0 0 1 1.9-1.3h9.2A2 2 0 0 1 18.5 6L21 13v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M3 13h5l1 3h6l1-3h5"/></svg>';
$('restart').innerHTML = `${ICON.restart}Restart`;

let st = {};        // chrome.storage.local values
let live = null;    // status published by the active hiring tab
// let log = [];
let kyc = [];
let filter = '';

let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1400);
}
function copy(text) { navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard')); }
const iconBtn = (icon, label, fn) => { const b = h('button', 'mini'); b.innerHTML = `${icon}${label}`; b.onclick = fn; return b; };
const copyBtn = (text) => iconBtn(ICON.copy, 'Copy', () => copy(text));
function empty(title, hint) {
  const d = h('div', 'empty');
  d.innerHTML = ICON.inbox;
  d.append(h('b', '', title));
  if (hint) d.append(h('small', '', hint));
  return d;
}

function linkRow(url) {
  const row = h('div', 'linkrow');
  const a = h('a', '', url); a.href = url; a.target = '_blank'; a.rel = 'noopener'; a.title = url;
  row.append(a, copyBtn(url), iconBtn(ICON.open, 'Open', () => chrome.tabs.create({ url })));
  return row;
}

function jobCard(j) {
  const d = h('div', 'card'), top = h('div', 'top');
  top.append(h('span', 'name', j.jobTitle || j.jobId));
  if (j.isNew) top.append(h('span', 'new', 'NEW'));
  const lo = j.totalPayRateMinL10N, hi = j.totalPayRateMaxL10N;
  const pay = lo && hi && lo !== hi ? `${lo}–${hi}` : (hi || lo || '');
  if (pay) top.append(h('span', 'pay', pay));
  const tags = h('div', 'tags');
  for (const t of [j.locationName, j.jobTypeL10N || j.jobType, j.employmentTypeL10N || j.employmentType, `${j.scheduleCount ?? '?'} schedule(s)`].filter(Boolean)) tags.append(h('span', 'tag', t));
  d.append(top, tags, h('div', 'meta', j.jobId), linkRow(j.link));
  return d;
}

function scheduleCard(c) {
  const d = h('div', 'card'), top = h('div', 'top');
  top.append(h('span', 'name', c.scheduleText || c.scheduleId));
  if (c.totalPayRateL10N) top.append(h('span', 'pay', c.totalPayRateL10N));
  const tags = h('div', 'tags');
  for (const t of [c.scheduleTypeL10N, c.hoursPerWeek && `${c.hoursPerWeek} h/wk`, c.laborDemandAvailableCount != null && `${c.laborDemandAvailableCount} open`,
    c.firstDayOnSiteL10N && `starts ${c.firstDayOnSiteL10N}`].filter(Boolean)) tags.append(h('span', 'tag', t));
  d.append(top, tags, h('div', 'meta', c.scheduleId), linkRow(c.link));
  return d;
}

function kycCard(k) {
  const d = h('div', 'card');
  d.append(h('div', 'meta', new Date(k.at).toLocaleString() + (k.copied ? '' : ' · not copied to clipboard')), linkRow(k.url));
  return d;
}

// GraphQL log: disabled for now (UI commented out in sidepanel.html)
// --- GraphQL log ---
// const pretty = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 2));
// const opName = (e) => e.request?.operationName || e.request?.[0]?.operationName || Object.keys(e.response?.data || {})[0] || 'unknown';
// const isBad = (e) => e.status >= 400 || !!e.response?.errors;
// const TOKEN = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
// function highlight(text) {
//   const frag = document.createDocumentFragment();
//   if (text.length > 200000) { frag.append(text); return frag; }
//   const put = (str, cls) => { if (!str) return; if (!cls) return frag.append(str); frag.append(h('span', cls, str)); };
//   let last = 0, m;
//   TOKEN.lastIndex = 0;
//   while ((m = TOKEN.exec(text))) {
//     put(text.slice(last, m.index));
//     if (m[1]) { put(m[1], m[2] ? 'k' : 's'); put(m[2]); }
//     else if (m[3]) put(m[0], 'b');
//     else if (m[0] === 'null') put(m[0], 'z');
//     else put(m[0], 'n');
//     last = TOKEN.lastIndex;
//   }
//   put(text.slice(last));
//   return frag;
// }
// function section(label, val) {
//   const wrap = h('div', 'section'), head = h('div', 'shead');
//   const text = pretty(val);
//   head.append(h('span', '', label), copyBtn(text));
//   const pre = h('pre'); pre.append(highlight(text));
//   wrap.append(head, pre);
//   return wrap;
// }
// function entryRow(e, wasOpen) {
//   const d = h('details'); d.dataset.id = `${e.t}:${e.url}:${opName(e)}`; d.open = wasOpen;
//   const sm = h('summary');
//   sm.append(h('span', 'op', opName(e)), h('span', 'time', new Date(e.t).toLocaleTimeString()), h('span', 'badge' + (isBad(e) ? ' bad' : ''), e.status));
//   d.append(sm);
//   const fill = () => { if (!d.querySelector('.section')) d.append(section('Request', e.request), section('Response', e.response)); };
//   if (d.open) fill();
//   d.addEventListener('toggle', () => d.open && fill());
//   return d;
// }
// const visibleLog = () => log.filter((e) => !filter || (opName(e) + ' ' + pretty(e.response)).toLowerCase().includes(filter));

// --- painting ---
function paintLive() {
  const running = st.running === true, paused = running && !!st.paused;
  const l = running && live ? live : { step: -1, stepName: 'Stopped', detail: 'Press Start to open the job search and begin.', chip: 'idle', chipText: 'Stopped' };
  $('chip').className = 'chip' + (paused ? ' paused' : l.chip ? ` ${l.chip}` : '');
  $('chipText').textContent = !running ? 'Stopped' : paused ? 'Paused' : l.chipText;
  [...$('steps').children].forEach((li, i) => { li.className = i === l.step ? 'now' : i < l.step ? 'done' : ''; });
  $('stepname').textContent = l.stepName.replace(/^\d\/\d\s*/, '') || 'Idle';
  $('detail').textContent = paused ? 'Paused — press Resume to continue.' : l.detail;
  $('start').innerHTML = `${ICON.play}Start`;
  $('pause').innerHTML = paused ? `${ICON.play}Resume` : `${ICON.pause}Pause`;
  $('pause').title = paused ? 'Resume automation' : 'Pause automation';
  $('pause').classList.toggle('go', paused);
  $('stop').innerHTML = `${ICON.stop}Stop`;
  $('start').hidden = running;
  $('pause').hidden = !running;
  $('stop').hidden = !running;
  $('restart').hidden = !running;
  try { $('where').textContent = running && live?.url ? new URL(live.url).host : 'Amazon hiring assistant'; } catch {}
}

function paintSettings() {
  $('continuous').checked = st.continuous !== false;
  const site = st.site === 'com' ? 'com' : 'ca';
  for (const r of document.querySelectorAll('[name=site]')) r.checked = r.value === site;
  for (const id of ['loginPhone', 'loginPin', 'smsUrl']) if (document.activeElement !== $(id)) $(id).value = st[id] || '';
}

function paintOverview() {
  const flow = st.flow || {};
  const first = (flow.jobs || []).find(([id]) => id === flow.firstId)?.[1];
  $('job').replaceChildren(first ? jobCard(first) : empty('Nothing yet', 'It shows up once the search finds one.'));
  $('schedule').replaceChildren(flow.schedule ? scheduleCard(flow.schedule) : empty('Nothing yet', 'It shows up once the search finds one.'));
  $('kyc').replaceChildren(...(kyc.length ? kyc.map(kycCard) : [empty('No saved links', 'KYC links appear here after the KYC step.')]));
  $('kycClear').hidden = !kyc.length;
}

// GraphQL log: disabled for now (UI commented out in sidepanel.html)
// function paintLog() {
//   $('logCount').textContent = log.length;
//   const open = new Set([...$('log').querySelectorAll('details[open]')].map((d) => d.dataset.id));
//   const shown = visibleLog();
//   $('log').replaceChildren(...(shown.length
//     ? shown.slice().reverse().map((e) => entryRow(e, open.has(`${e.t}:${e.url}:${opName(e)}`)))
//     : [empty(log.length ? 'No matches' : 'No responses yet', log.length ? 'Try a different filter.' : 'GraphQL responses appear here as pages load.')]));
// }

const paintAll = () => { paintLive(); paintSettings(); paintOverview(); };

Promise.all([
  chrome.storage.local.get(null),
  chrome.storage.session.get(['live', 'kycLinks']),
]).then(([l, s]) => {
  st = l; live = s.live || null; kyc = s.kycLinks || [];
  paintAll();
});

chrome.storage.onChanged.addListener((c, area) => {
  if (area === 'local') {
    for (const [k, v] of Object.entries(c)) st[k] = v.newValue;
    paintLive(); paintSettings(); if ('flow' in c) paintOverview();
  } else if (area === 'session') {
    if (c.live) { live = c.live.newValue || null; paintLive(); }
    // if (c.gqlLog) { log = c.gqlLog.newValue || []; paintLog(); }
    if (c.kycLinks) { kyc = c.kycLinks.newValue || []; paintOverview(); }
  }
});

// --- controls ---
const HIRING_TABS = ['https://*.hiring.amazon.ca/*', 'https://*.hiring.amazon.com/*'];
// Closes every hiring tab. A window that would be left empty gets a blank tab first, so it isn't closed with them.
async function closeHiringTabs() {
  const tabs = await chrome.tabs.query({ url: HIRING_TABS });
  const byWindow = new Map();
  for (const t of tabs) byWindow.set(t.windowId, (byWindow.get(t.windowId) || 0) + 1);
  for (const [windowId, n] of byWindow) {
    const all = await chrome.tabs.query({ windowId });
    if (all.length === n) await chrome.tabs.create({ windowId, active: true });
  }
  if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
}

$('start').onclick = async () => {
  await closeHiringTabs();
  await chrome.storage.local.remove(['flow', 'smsCode', 'smsError']);
  await chrome.storage.session.remove(['live']);
  await chrome.storage.local.set({ running: true, paused: false, loginReset: Date.now() });
  chrome.tabs.create({ url: SEARCH_URLS[st.site === 'com' ? 'com' : 'ca'], active: true });
};
$('pause').onclick = () => chrome.storage.local.set({ paused: !st.paused });
// Stop: automation off, tabs stay as they are, side panel closes.
$('stop').onclick = async () => {
  await chrome.storage.local.set({ running: false, paused: false });
  await chrome.storage.session.remove('live');
  const win = await chrome.windows.getCurrent();
  try { await chrome.sidePanel.close({ windowId: win.id }); } catch { window.close(); }
};
async function toActiveTab(cmd) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id != null) chrome.tabs.sendMessage(tab.id, { type: 'jobbot-cmd', cmd }).catch(() => {});
}
$('restart').onclick = () => toActiveTab('restart');
// $('logClear').onclick = () => { log = []; chrome.storage.session.set({ gqlLog: [] }); toActiveTab('clear-log'); paintLog(); };
// $('logCopy').onclick = () => copy(JSON.stringify(visibleLog(), (k, v) =>
//   k !== 'query' && typeof v === 'string' && v.length > 300 ? `${v.slice(0, 300)}… [${v.length} chars]` : v, 2));
// $('filter').oninput = (e) => { filter = e.target.value.toLowerCase(); paintLog(); };
$('kycClear').onclick = () => chrome.storage.session.remove('kycLinks');
for (const id of ['continuous']) $(id).onchange = (e) => chrome.storage.local.set({ [id]: e.target.checked });
let savedTimer;
for (const id of ['loginPhone', 'loginPin', 'smsUrl']) $(id).oninput = (e) => {
  chrome.storage.local.set({ [id]: e.target.value.trim() });
  $('saved').classList.add('show'); clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('saved').classList.remove('show'), 1200);
};
$('eye').onclick = () => {
  const show = $('loginPin').type === 'password';
  $('loginPin').type = show ? 'text' : 'password';
  $('eye').textContent = show ? 'Hide' : 'Show';
};
for (const t of document.querySelectorAll('[data-tab]')) t.onclick = () => {
  for (const o of document.querySelectorAll('[data-tab]')) o.classList.toggle('on', o === t);
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t.dataset.tab;
};

for (const r of document.querySelectorAll('[name=site]')) r.onchange = () => chrome.storage.local.set({ site: r.value });
