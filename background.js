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
