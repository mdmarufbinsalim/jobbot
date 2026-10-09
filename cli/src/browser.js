import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const ARGS = ['--disable-blink-features=AutomationControlled'];

// Local Chrome (headless unless --headed), a remote Chrome over CDP (--cdp), or a Playwright server (--ws).
export async function open(opts) {
  if (opts.ws) {
    const browser = await chromium.connect(opts.ws);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    return { context, page: await context.newPage(), close: () => browser.close() };
  }
  if (opts.cdp) {
    const browser = await chromium.connectOverCDP(opts.cdp);
    const context = browser.contexts()[0] || (await browser.newContext());
    return { context, page: await context.newPage(), close: () => browser.close() };
  }
  const profile = opts.profile || path.join(os.homedir(), '.config/jobbot/profile');
  const context = await chromium.launchPersistentContext(profile, {
    headless: !opts.headed,
    args: ARGS,
    viewport: { width: 1280, height: 900 },
    locale: opts.site === 'ca' ? 'en-CA' : 'en-US',
  });
  return { context, page: context.pages()[0] || (await context.newPage()), close: () => context.close() };
}
