import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';

chromium.use(StealthPlugin());

export const DEFAULT_STATE = path.join(os.homedir(), '.config/jobbot/state.json');

// Local Chromium. A saved login (cookies + storage) is loaded from the state file in a headed window, or in a headless
// run once the extension has synced a session since this server started (opts.synced()). Otherwise a headless run
// starts logged out, as a new visitor would, and never writes the state file back.
export async function open(opts) {
  const browser = await chromium.launch({ headless: !opts.headed, args: ['--disable-blink-features=AutomationControlled'] });
  const useSaved = !!opts.headed || !!opts.synced?.();
  const hasState = useSaved && fs.existsSync(opts.state);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: opts.site === 'ca' ? 'en-CA' : 'en-US',
    ...(hasState ? { storageState: opts.state } : {}),
  });
  const save = async () => {
    if (!useSaved && !opts.loginOnly) return; // a logged-out headless run must not replace the saved login
    fs.mkdirSync(path.dirname(opts.state), { recursive: true });
    await context.storageState({ path: opts.state });
    fs.chmodSync(opts.state, 0o600); // it holds session cookies
  };
  return { context, page: await context.newPage(), hasState, save, close: () => browser.close() };
}
