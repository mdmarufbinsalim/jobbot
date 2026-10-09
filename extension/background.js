// Service worker. Runs the shared bot (core/) against a tab of this Chrome ("local"), or controls a `jobbot serve`
// over HTTP ("remote"). The side panel only talks to this file, through { type: 'ctl', cmd } messages and storage.
import { Controller } from './core/controller.js';
import { pageFn } from './core/dom.js';
import { SESSION_URLS, buildStorageState } from './core/session.js';
import { ChromeDriver } from './drivers/chrome.js';
import { hub } from './core/captcha/hub.js';
import solver, { checkSolver } from './core/solver.js';
import { geminiSolver } from './core/captcha/gemini-solver.js';

// Local defaults (gitignored defaults.json): fill any setting that has never been saved.
async function localDefaults() {
  try { return await (await fetch(chrome.runtime.getURL('defaults.json'))).json(); } catch { return {}; }
}

const SEARCH_URLS = { ca: 'https://hiring.amazon.ca/app#/jobSearch', com: 'https://hiring.amazon.com/app#/jobSearch' };
const HIRING_TABS = ['https://*.hiring.amazon.ca/*', 'https://*.hiring.amazon.com/*'];
const DEFAULT_SERVER_URL = 'http://127.0.0.1:8787'; // editable in Settings → Run on → Server URL
const serverUrl = () => (store.serverUrl || DEFAULT_SERVER_URL).replace(/\/+$/, '');

// --- settings cache (config() must be synchronous) ---
let cfg = { site: 'ca', continuous: true, loginPhone: '', loginPin: '', smsUrl: '' };
let store = {};
const ready = (async () => {
  store = await chrome.storage.local.get(null);
  const fill = {};
  for (const [k, v] of Object.entries(await localDefaults())) if (store[k] == null) fill[k] = v;
  if (Object.keys(fill).length) { await chrome.storage.local.set(fill); Object.assign(store, fill); }
  readCfg();
  const { kycLinks } = await chrome.storage.session.get('kycLinks');
  controller.kyc = kycLinks || [];
})();
function readCfg() {
  cfg = { site: store.site === 'com' ? 'com' : 'ca', continuous: store.continuous !== false,
    loginPhone: store.loginPhone || '', loginPin: store.loginPin || '', smsUrl: store.smsUrl || '' };
}
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'local') return;
  for (const [k, v] of Object.entries(c)) store[k] = v.newValue;
  readCfg();
});
const mode = () => (store.mode === 'remote' ? 'remote' : 'local');

// --- publishing status for the side panel (same storage keys it always used) ---
let lastFlow = '', pendingStatus = null, publishTimer = null;
function publish(status) {
  pendingStatus = status;
  if (publishTimer) return;
  publishTimer = setTimeout(async () => {
    publishTimer = null;
    const s = pendingStatus;
    const flow = JSON.stringify(s.flow);
    const local = { running: s.running, paused: s.paused };
    if (flow !== lastFlow) { lastFlow = flow; local.flow = s.flow; }
    const cleared = store.kycClearedAt || 0;
    await chrome.storage.local.set(local).catch(() => {});
    await chrome.storage.session.set({ live: s.live, kycLinks: (s.kyc || []).filter((k) => k.at > cleared), botLog: s.log || [] }).catch(() => {});
  }, 250);
}

// --- local mode: the shared Controller on a tab of this browser ---
async function closeHiringTabs() {
  const tabs = await chrome.tabs.query({ url: HIRING_TABS });
  const byWindow = new Map();
  for (const t of tabs) byWindow.set(t.windowId, (byWindow.get(t.windowId) || 0) + 1);
  for (const [windowId, n] of byWindow) {
    const all = await chrome.tabs.query({ windowId });
    if (all.length === n) await chrome.tabs.create({ windowId, active: true }); // keep the window alive
  }
  if (tabs.length) await chrome.tabs.remove(tabs.map((t) => t.id)).catch(() => {});
}

let driver = null;
const controller = new Controller({
  log: (m) => console.log(`[jobbot] ${m}`),
  // The shared solver contract: the free Gemini solver with the key from Settings or the hard-coded one (it falls back to the manual panel on failure).
  solver: checkSolver((() => {
    const gemini = geminiSolver({ getKey: () => store.geminiKey, getModel: () => store.geminiModel });
    return { name: 'auto', solve: (ctx) => gemini.solve(ctx) };
  })(), 'core/solver.js'),
  config: () => cfg,
  onChange: (s) => { if (mode() === 'local') publish(s); },
  async openDriver() {
    await closeHiringTabs();
    const tab = await chrome.tabs.create({ url: SEARCH_URLS[cfg.site], active: true });
    await chrome.storage.local.set({ botTab: tab.id });
    driver = new ChromeDriver(tab.id);
    return driver;
  },
  async closeDriver(d) { d?.dispose(); if (driver === d) driver = null; await chrome.storage.local.remove('botTab'); }, // the tab stays as it is
  onKyc: (list) => chrome.storage.session.set({ kycLinks: list }),
});

// The worker can be stopped by Chrome while paused; pick the run back up on the same tab.
async function restore() {
  await ready;
  if (mode() !== 'local' || !store.running || store.botTab == null || controller.running) return;
  try {
    const tab = await chrome.tabs.get(store.botTab);
    driver = new ChromeDriver(tab.id);
    await controller.start({ navigate: false, driver });
    if (store.paused) controller.pause();
  } catch { await chrome.storage.local.set({ running: false, paused: false }); }
}
restore();
// Keeps the worker alive while a run is active (API calls reset Chrome's idle timer).
setInterval(() => { if (controller.running) chrome.runtime.getPlatformInfo(); }, 20000);

// GraphQL exchanges from relay.js go to the driver of the tab they came from.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type === 'gql' && driver && sender.tab?.id === driver.tabId && sender.frameId === 0) {
    driver.emit('gql', { request: msg.entry.request, response: msg.entry.response });
  }
});

// --- remote mode: the same commands over HTTP ---
async function api(path, method = 'GET', body) {
  const r = await fetch(serverUrl() + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  return r;
}
const apiJson = async (...a) => (await api(...a)).json();
const pushConfig = () => apiJson('/config', 'PUT', cfg);

async function collectSession() {
  const cookies = [];
  for (const url of SESSION_URLS) cookies.push(...await chrome.cookies.getAll({ url }));
  const storages = [], seen = new Set();
  for (const t of await chrome.tabs.query({ url: HIRING_TABS })) {
    const origin = new URL(t.url).origin;
    if (seen.has(origin)) continue;
    seen.add(origin);
    try {
      const [res] = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: pageFn, args: [{ op: 'localStorage' }] });
      storages.push({ origin, localStorage: res?.result || [] });
    } catch {}
  }
  return buildStorageState(cookies, storages);
}

// --- commands from the side panel ---
const commands = {
  async start() {
    await chrome.storage.local.remove('flow');
    await chrome.storage.session.remove('live');
    lastFlow = '';
    if (mode() === 'remote') { await pushConfig(); publish(await apiJson('/start', 'POST')); return; }
    await controller.start();
  },
  async pause() { if (mode() === 'remote') publish(await apiJson('/pause', 'POST')); else controller.pause(); },
  async resume() { if (mode() === 'remote') publish(await apiJson('/resume', 'POST')); else controller.resume(); },
  async restart() { if (mode() === 'remote') publish(await apiJson('/restart', 'POST')); else await controller.restart(); },
  async stop() {
    if (mode() === 'remote') publish(await apiJson('/stop', 'POST'));
    else await controller.stop();
    await chrome.storage.session.remove('live');
  },
  async status() { if (mode() === 'remote') publish(await apiJson('/status')); },
  async screenshot() {
    if (mode() === 'local') return { dataUrl: await controller.screenshot() };
    const buf = new Uint8Array(await (await api('/screenshot')).arrayBuffer());
    let bin = '';
    for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { dataUrl: `data:image/png;base64,${btoa(bin)}` };
  },
  async test() {
    const health = await fetch(`${serverUrl()}/health`, { signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null);
    if (!health?.ok) throw new Error(`No jobbot server at ${serverUrl()}. Start it with: jobbot up`);
    const s = await apiJson('/status');
    return { message: `Connected to ${serverUrl()}. The bot is ${s.running ? 'running' : 'idle'}.` };
  },
  // Sends this browser's login for the hiring sites (and the account settings) to the server, so it starts logged in.
  async syncSession() {
    if (mode() !== 'remote') throw new Error('Switch to Remote server first');
    const state = await collectSession();
    if (!state.cookies.length) throw new Error('No hiring.amazon cookies found. Log in on the site in this browser first');
    await pushConfig();
    const r = await apiJson('/session', 'PUT', state);
    return { message: `Synced ${r.cookies} cookies${r.restarted ? ' (server browser restarted)' : ''}.` };
  },
  // The tile challenge: the panel reads it and sends back the confirmed selections (core/captcha/).
  async captcha() { return { challenge: mode() === 'remote' ? (await apiJson('/captcha')).challenge : hub.view() }; },
  async captchaAnswer({ answer }) {
    if (mode() === 'remote') await apiJson('/captcha', 'POST', answer); else hub.respond(answer);
  },
  async captchaRetry() { if (mode() === 'remote') await apiJson('/captcha/retry', 'POST'); else controller.retryCaptcha(); },
  async clearKyc() {
    await chrome.storage.local.set({ kycClearedAt: Date.now() });
    controller.kyc = [];
    await chrome.storage.session.remove('kycLinks');
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'ctl' || !commands[msg.cmd]) return;
  ready.then(() => commands[msg.cmd](msg)).then((r) => sendResponse({ ok: true, ...(r || {}) }), (e) => sendResponse({ ok: false, error: e.message }));
  return true;
});

// let content scripts (the sidebar panel) read the saved KYC links too
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
// Clicking the toolbar icon opens the docked side panel (there is no popup any more).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
