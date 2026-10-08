// Local defaults (gitignored defaults.js): fill any setting that has never been saved.
try { importScripts('defaults.js'); } catch {}
chrome.storage.local.get(Object.keys(self.JOBBOT_DEFAULTS || {})).then((have) => {
  const fill = {};
  for (const [k, v] of Object.entries(self.JOBBOT_DEFAULTS || {})) if (have[k] == null) fill[k] = v;
  if (Object.keys(fill).length) chrome.storage.local.set(fill);
});

const SEARCH_URLS = {
  ca: 'https://hiring.amazon.ca/app#/jobSearch',
  com: 'https://hiring.amazon.com/app#/jobSearch',
};

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'open-search' && SEARCH_URLS[msg.site]) chrome.tabs.create({ url: SEARCH_URLS[msg.site] });
});

// --- SMS code lookup: open the inbox page in a background tab, let reader.js read it, hand the code to login.js ---
const SMS_HOSTS = new Set(['temp-number.com', 'www.temp-number.com']);
const SMS_WINDOW_MS = 100000;

// Close the inbox tab and, when asked, bring the login tab back to the front.
async function closeSmsTab(returnToLogin) {
  const { smsTabId, smsLoginTabId } = await chrome.storage.local.get(['smsTabId', 'smsLoginTabId']);
  if (smsTabId != null) chrome.tabs.remove(smsTabId).catch(() => {});
  if (returnToLogin && smsLoginTabId != null) chrome.tabs.update(smsLoginTabId, { active: true }).catch(() => {});
  await chrome.storage.local.remove(['smsJob', 'smsTabId', 'smsLoginTabId']);
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type === 'fetch-sms') {
    let url;
    try { url = new URL(msg.url); } catch { return; }
    if (url.protocol !== 'https:' || !SMS_HOSTS.has(url.hostname)) return;
    (async () => {
      if ((await chrome.storage.local.get('paused')).paused) return;
      await closeSmsTab(false);
      await chrome.storage.local.remove('smsCode');
      await chrome.storage.local.set({ smsJob: { requestedAt: msg.requestedAt, until: Date.now() + SMS_WINDOW_MS } });
      // Opened in the foreground so you can watch it read the inbox; the login tab is re-focused afterwards.
      const tab = await chrome.tabs.create({ url: url.href, active: true });
      await chrome.storage.local.set({ smsTabId: tab.id, smsLoginTabId: sender.tab?.id ?? null });
    })();
  }
  if (msg.type === 'sms-code' && sender.tab) {
    chrome.storage.local.set({ smsCode: { code: msg.code, at: Date.now() } }).then(() => closeSmsTab(true));
  }
  if (msg.type === 'sms-fail') {
    chrome.storage.local.set({ smsError: Date.now() }).then(() => closeSmsTab(true));
  }
});

// --- KYC: keep the remote KYC link in session storage, then send the tab back to the hiring page ---
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== 'kyc-link' || !sender.tab) return;
  let link;
  try { link = new URL(msg.link); } catch { return; }
  if (!/(^|\.)amazon\.(in|com|ca)$/.test(link.hostname) || link.pathname !== '/remoteKYC') return;
  // onSuccess points back at the hiring site (.ca or .com); default to .ca
  let site = 'ca';
  try { if (/\.amazon\.com$/.test(new URL(link.searchParams.get('onSuccess')).hostname)) site = 'com'; } catch {}
  chrome.storage.session.get('kycLinks').then(({ kycLinks = [] }) => {
    const rest = kycLinks.filter((k) => k.url !== link.href);
    return chrome.storage.session.set({ kycLinks: [{ url: link.href, copied: !!msg.copied, at: Date.now() }, ...rest] });
  }).then(() => chrome.tabs.update(sender.tab.id, { url: SEARCH_URLS[site] }));
});

// let content scripts (the sidebar panel) read the saved KYC links too
chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });

// Clicking the toolbar icon opens the docked side panel (there is no popup any more).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
