import fs from 'node:fs';
import path from 'node:path';
import { Controller } from '../../extension/core/controller.js';
import { validateStorageState } from '../../extension/core/session.js';
import { open } from './browser.js';
import { PlaywrightDriver } from './driver.js';
import { createSettings } from './settings.js';

const stamp = () => new Date().toTimeString().slice(0, 8);

// Wires the shared Controller to Playwright: a local Chromium, the saved-session file, screenshots and KYC links on disk.
export function createRuntime(opts) {
  const settings = createSettings(opts.overrides || {});
  let browser = null, saveTimer = null, synced = false; // synced: a session was pushed since this server started
  const say = opts.quiet ? () => {} : (m) => console.log(`${stamp()} ${m}`);

  const controller = new Controller({
    log: say,
    config: () => settings.get(),
    loginOnly: opts.loginOnly,
    solver: opts.solver,
    onLoggedIn: async () => { await browser.save(); say(`session saved to ${opts.state}`); },
    async openDriver() {
      browser = await open({ ...opts, site: settings.get().site, synced: () => synced });
      if (!opts.loginOnly) saveTimer = setInterval(() => browser?.save().catch(() => {}), 60000); // keep the session fresh
      return new PlaywrightDriver(browser.page, browser.context);
    },
    async closeDriver() {
      clearInterval(saveTimer);
      const b = browser; browser = null;
      if (!b) return;
      if (!opts.loginOnly) await b.save().catch(() => {});
      await b.close().catch(() => {});
    },
    shot: opts.shots ? async (dataUrl, label, n) => {
      fs.mkdirSync(opts.shots, { recursive: true });
      const file = path.join(opts.shots, `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(n).padStart(3, '0')}-${label}.png`);
      fs.writeFileSync(file, Buffer.from(dataUrl.split(',')[1], 'base64'));
      say(`screenshot: ${file}`);
    } : undefined,
    async onKyc(list) {
      fs.mkdirSync(opts.out, { recursive: true });
      fs.appendFileSync(path.join(opts.out, 'kyc-links.txt'), `${new Date().toISOString()} ${list[0].url}\n`);
    },
  });
  // Replace the saved login (pushed by the extension) and restart the browser with it if it was running.
  async function applySession(raw) {
    const { dropped, ...state } = validateStorageState(raw);
    const wasRunning = controller.running;
    if (wasRunning) await controller.stop();
    fs.mkdirSync(path.dirname(opts.state), { recursive: true });
    fs.writeFileSync(opts.state, JSON.stringify(state), { mode: 0o600 });
    fs.chmodSync(opts.state, 0o600);
    synced = true;
    if (wasRunning) await controller.start();
    return { cookies: state.cookies.length, origins: state.origins.length, dropped, restarted: wasRunning };
  }

  return { controller, settings, applySession, say };
}
