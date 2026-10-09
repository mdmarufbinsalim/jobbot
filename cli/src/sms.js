import { scanSms } from './dom.js';

const WINDOW_MS = 100000;
const HOSTS = new Set(['temp-number.com', 'www.temp-number.com']);

// Opens the inbox in a second tab and reloads it every 5s until the code that arrived after `requestedAt` shows up.
export async function fetchSmsCode(context, url, requestedAt, log) {
  let u;
  try { u = new URL(url); } catch { log('SMS inbox URL is not valid'); return null; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) { log('SMS inbox must be an https temp-number.com URL'); return null; }
  const tab = await context.newPage();
  try {
    const until = Date.now() + WINDOW_MS;
    while (Date.now() < until) {
      await tab.goto(u.href, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
      await tab.waitForTimeout(1500);
      const found = await tab.evaluate(scanSms, { requestedAt, now: Date.now() }).catch(() => null);
      if (found) return found.code;
      await tab.waitForTimeout(3500);
    }
    return null;
  } finally {
    await tab.close().catch(() => {});
  }
}
