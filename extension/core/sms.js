const WINDOW_MS = 100000;
const HOSTS = new Set(['temp-number.com', 'www.temp-number.com']);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Opens the inbox in a second tab (driver.openTab) and reloads it every 5s until the code that arrived after
// `requestedAt` shows up. Returns the code, or null when the window closes.
export async function fetchSmsCode(driver, pageFn, url, requestedAt, log) {
  let u;
  try { u = new URL(url); } catch { log('SMS inbox URL is not valid'); return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) { log('SMS inbox must be an https temp-number.com URL'); return null; }
  const tab = await driver.openTab(u.href);
  try {
    const until = Date.now() + WINDOW_MS;
    while (Date.now() < until) {
      await sleep(1500);
      const found = await tab.evaluate(pageFn, { op: 'scanSms', arg: { requestedAt, now: Date.now() } }).catch(() => null);
      if (found) return found.code;
      await sleep(3500);
      await tab.reload().catch(() => {});
    }
    return null;
  } finally {
    await tab.close().catch(() => {});
  }
}
