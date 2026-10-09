import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

export const DEFAULT_STATE = path.join(os.homedir(), '.config/jobbot/state.json');

// Local Chromium. A saved login (cookies + storage) is loaded from the state file when it exists, so a headless run
// can reuse a login made once in a headed window (`jobbot login`).
export async function open(opts) {
  const browser = await chromium.launch({ headless: !opts.headed, args: ['--disable-blink-features=AutomationControlled'] });
  const hasState = fs.existsSync(opts.state);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
    locale: opts.site === 'ca' ? 'en-CA' : 'en-US',
    ...(hasState ? { storageState: opts.state } : {}),
  });
  const save = async () => {
    fs.mkdirSync(path.dirname(opts.state), { recursive: true });
    await context.storageState({ path: opts.state });
    fs.chmodSync(opts.state, 0o600); // it holds session cookies
  };
  return { context, page: await context.newPage(), hasState, save, close: () => browser.close() };
}
