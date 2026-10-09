import path from 'node:path';
import os from 'node:os';
import { chromium } from 'playwright';

const ARGS = ['--disable-blink-features=AutomationControlled'];

// Local Chromium only (headless unless --headed).
export async function open(opts) {
  const profile = opts.profile || path.join(os.homedir(), '.config/jobbot/profile');
  const context = await chromium.launchPersistentContext(profile, {
    headless: !opts.headed,
    args: ARGS,
    viewport: { width: 1280, height: 900 },
    locale: opts.site === 'ca' ? 'en-CA' : 'en-US',
  });
  return { context, page: context.pages()[0] || (await context.newPage()), close: () => context.close() };
}
