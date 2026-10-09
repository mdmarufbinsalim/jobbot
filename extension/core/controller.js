// Start / pause / stop around one Bot, plus the saved KYC links and a status snapshot. Used as-is by the extension
// (service worker) and by the CLI (run + HTTP server), so a new control or field is added here once.
//
// platform:
//   openDriver() -> driver          a fresh working tab/page (the Bot navigates it to the search page itself)
//   closeDriver?(driver, { keep })  tidy up after Stop
//   config() -> { site, continuous, loginPhone, loginPin, smsUrl }
//   log(text)   onChange?(status)   shot?(dataUrl, label)   solver?   loginOnly?   onLoggedIn?()
import { Bot } from './bot.js';

export class Controller {
  constructor(platform) {
    this.p = platform;
    this.bot = null; this.driver = null; this.running = false;
    this.kyc = [];                 // [{ url, copied, at }], newest first
    this.logLines = [];
    this.lastShot = null;
  }

  log = (text) => {
    this.logLines.push(`${new Date().toTimeString().slice(0, 8)} ${text}`);
    if (this.logLines.length > 200) this.logLines.shift();
    this.p.log?.(text);
  };

  status() {
    const s = this.bot && this.running ? this.bot.snapshot() : null;
    return {
      running: this.running,
      paused: !!(s && (s.paused || s.captcha)),
      live: s,
      flow: s ? s.flow : { jobs: [], firstId: null, schedule: null },
      kyc: this.kyc,
      log: this.logLines.slice(-30),
    };
  }
  emit = () => { try { this.p.onChange?.(this.status()); } catch {} };

  async start({ navigate = true, driver } = {}) {
    if (this.running) return;
    this.driver = driver || await this.p.openDriver();
    const host = {
      config: () => this.p.config(),
      log: this.log,
      onChange: this.emit,
      onKyc: async (url, copied) => {
        this.kyc = [{ url, copied, at: Date.now() }, ...this.kyc.filter((k) => k.url !== url)];
        await this.p.onKyc?.(this.kyc);
        this.emit();
      },
      shot: this.p.shot ? async (data, label, n) => { this.lastShot = data; await this.p.shot(data, label, n); } : undefined, // no sink: the bot skips per-step screenshots
      solver: this.p.solver, loginOnly: this.p.loginOnly, onLoggedIn: this.p.onLoggedIn,
    };
    this.bot = new Bot({ driver: this.driver, host });
    this.running = true;
    this.emit();
    const bot = this.bot;
    bot.run({ navigate }).catch((e) => this.log(`bot crashed: ${e.message}`)).finally(async () => {
      if (this.bot !== bot) return;
      this.running = false;
      await this.p.closeDriver?.(this.driver, { ended: true }).catch(() => {});
      this.bot = null; this.driver = null;
      this.emit();
    });
  }

  async stop() {
    if (!this.bot) return;
    const bot = this.bot, driver = this.driver;
    bot.stop();
    this.bot = null; this.driver = null; this.running = false;
    await this.p.closeDriver?.(driver, { ended: false }).catch(() => {});
    this.emit();
  }

  pause() { this.bot?.pause(); }
  resume() { this.bot?.resume(); }
  retryCaptcha() { this.bot?.retryCaptcha(); }
  async restart() { await this.bot?.restart(); }

  // A screenshot of the working tab right now (works even without a shot sink).
  async screenshot() {
    if (!this.driver) return this.lastShot;
    const data = await this.driver.screenshot().catch(() => null);
    if (data) this.lastShot = data;
    return data || this.lastShot;
  }
}
