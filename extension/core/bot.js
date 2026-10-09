// The hiring flow, written once. It never touches a browser API directly: it talks to a `driver` and a `host`.
//
// driver (Playwright in the CLI, chrome.tabs in the extension):
//   url() -> string                       current URL of the working tab (sync)
//   goto(url) / reload()                  navigate the working tab
//   evaluate(fn, arg) -> result           run a self-contained function inside the page
//   screenshot() -> data URL | null
//   openTab(url) -> { evaluate, reload, close }   second tab, used for the SMS inbox
//   on('navigated', () => {})             any navigation, reload or hash change of the working tab
//   on('gql', ({ request, response }) => {})      a GraphQL exchange seen by the page
//   on('closed', () => {})
// host:
//   config() -> { site, continuous, loginPhone, loginPin, smsUrl }   read on every use, so edits apply live
//   log(text), onChange?(), onKyc?(link), shot?(dataUrl, label), solver?, loginOnly?, onLoggedIn?()
import { pageFn, BUTTONS } from './dom.js';
import { fetchSmsCode } from './sms.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export const TIMING = {
  OPEN_DELAY_MS: 3000,
  STALL_MS: 10000,          // a step with no progress this long -> reload
  MAX_REFRESHES: 5,         // per step, then stuck
  RESET_AFTER_MS: 120000,   // refresh count starts over if the last reload was this long ago
  SEARCH_DELAY_MS: 800,
  CLICK_DELAY_MS: 600,
  SMS_WAIT_MS: 10000,
  MAX_LOGIN_ATTEMPTS: 4,
};
const T = TIMING;
export const STEPS = ['Login', 'Search', 'Job', 'Application'];

export class Bot {
  constructor({ driver, host }) {
    this.driver = driver; this.host = host;
    this.log = (m) => host.log(m);
    this.paused = false; this.stopped = false; this.stuck = false; this.captcha = false; this.captchaOverride = false; this.solving = null;
    this.jobs = new Map(); this.firstId = null; this.schedule = null;
    this.nav = null;
    this.holdUntil = 0; // after pressing Begin on the human check, don't reload while it is being solved
    this.refresh = { step: -1, n: 0, at: 0 };
    this.lastProgress = Date.now();
    this.statusText = 'Starting…';
    this.shotN = 0;
    this.resetDoc();
    this.resetLogin();
  }

  cfg() { return this.host.config(); }
  get site() { return this._site || this.cfg().site || 'ca'; }
  get origin() { return `https://hiring.amazon.${this.site}`; }
  get loginUrl() { return 'https://auth.hiring.amazon.com/#/login'; } // every run starts here, then moves on to the search
  get searchUrl() { return `${this.origin}/app#/jobSearch`; }
  get locale() { return this.site === 'ca' ? 'en-CA' : 'en-US'; }
  dom(op, arg) { return this.driver.evaluate(pageFn, { op, arg }); }
  changed() { try { this.host.onChange?.(); } catch {} }

  // per-document state: reset on every navigation (a page load used to reset the old content scripts)
  resetDoc() {
    this.docAt = Date.now();
    this.searchDone = { all: false, clear: false };
    this.clicked = new Set();
    this.pendingClick = false;
    this.beginClicked = false;
  }
  resetLogin() {
    this.attempts = 0;
    this.loginFlags = { phone: false, pin: false, send: false, fetch: false, code: false };
    this.smsRequestedAt = 0; this.smsCode = null;
  }
  progress() { this.lastProgress = Date.now(); }

  status(text) {
    if (text === this.statusText) return;
    this.statusText = text;
    this.log(text);
    this.changed();
  }

  async shot(label) {
    if (!this.host.shot) return null;
    try {
      const data = await this.driver.screenshot();
      if (data) await this.host.shot(data, label, ++this.shotN);
      return data;
    } catch (e) { this.log(`screenshot failed: ${e.message}`); return null; }
  }

  // --- snapshot for UIs ---
  snapshot() {
    const step = this.step();
    const detail = this.captcha ? (this.solverError ? `Captcha solver failed: ${this.solverError}. Solve it yourself, then press Resume` : 'Captcha is being asked. Solve it, then press Resume')
      : this.paused ? 'Paused — press Resume'
      : this.stuck ? this.statusText
      : this.statusText;
    return {
      paused: this.paused, stuck: this.stuck, captcha: this.captcha,
      step, stepName: step >= 0 ? `${step + 1}/${STEPS.length} ${STEPS[step]}` : 'Idle',
      detail,
      chip: this.captcha || this.paused ? 'paused' : this.stuck ? 'bad' : step < 0 ? 'idle' : '',
      chipText: this.captcha ? 'Captcha' : this.paused ? 'Paused' : this.stuck ? 'Stuck' : step < 0 ? 'Idle' : 'Running',
      url: this.url().href,
      flow: { jobs: [...this.jobs], firstId: this.firstId, schedule: this.schedule },
    };
  }

  // --- links and routes ---
  detailLink(jobId, locale) {
    return `${this.origin}/app#/jobDetail?jobId=${encodeURIComponent(jobId)}&locale=${encodeURIComponent(locale || this.locale)}`;
  }
  applicationLink(c, locale) {
    const loc = encodeURIComponent(locale || this.locale);
    if (this.site === 'ca') {
      return `${this.origin}/application/?jobId=${encodeURIComponent(c.jobUuid || c.jobId)}&locale=${loc}&page=pre-consent`
        + `&scheduleId=${encodeURIComponent(c.scheduleUuid || c.scheduleId)}&country=ca&token=`;
    }
    return `${this.origin}/application/us/?CS=true&jobId=${encodeURIComponent(c.jobId)}&locale=${loc}`
      + `&scheduleId=${encodeURIComponent(c.scheduleId)}&ssoEnabled=1`;
  }
  url() { try { return new URL(this.driver.url()); } catch { return new URL('about:blank'); } }
  hash() { return this.url().hash; }
  onSearch() { return this.hash().startsWith('#/jobSearch'); }
  onDetail() { return this.hash().startsWith('#/jobDetail'); }
  hashJobId() { return new URLSearchParams(this.hash().split('?')[1] || '').get('jobId'); }
  step() {
    const u = this.url();
    if (/^auth\./.test(u.hostname)) return 0;
    if (u.pathname.startsWith('/application')) return 3;
    if (u.hash.startsWith('#/jobDetail')) return 2;
    if (u.hash.startsWith('#/jobSearch')) return 1;
    return -1;
  }
  async go(url) {
    try { await this.driver.goto(url); } catch (e) { this.log(`goto failed: ${String(e.message).split('\n')[0]}`); }
    this.progress();
  }

  // --- GraphQL ---
  onGql({ request, response }) {
    this.progress();
    const op = request?.operationName || request?.[0]?.operationName;
    if (op === 'searchScheduleCards') {
      const first = response?.data?.searchScheduleCards?.scheduleCards?.find((c) => c?.scheduleId);
      if (!first) return;
      const locale = request?.variables?.searchScheduleRequest?.locale;
      this.schedule = { ...first, link: this.applicationLink(first, locale) };
      this.log(`schedule found: ${first.scheduleId}`);
      const jobId = first.jobId;
      if (this.onDetail() && jobId === this.hashJobId()) {
        this.navigateSoon('Opening application', this.schedule.link, () => this.onDetail() && jobId === this.hashJobId());
      }
      this.changed();
      return;
    }
    const cards = response?.data?.searchJobCardsByLocation?.jobCards;
    if (op !== 'searchJobCardsByLocation' || !Array.isArray(cards)) return;
    const locale = request?.variables?.searchJobRequest?.locale;
    for (const c of cards) if (c?.jobId) this.jobs.set(c.jobId, { ...c, link: this.detailLink(c.jobId, locale) });
    const first = cards.find((c) => c?.jobId);
    if (first) this.firstId = first.jobId;
    if (first && this.onSearch()) this.navigateSoon('Opening first job', this.jobs.get(first.jobId).link, () => this.onSearch());
    this.changed();
  }

  navigateSoon(label, target, valid) {
    this.clearRefreshes();
    this.nav = { at: Date.now() + T.OPEN_DELAY_MS, target, valid, label };
    this.status(`${label} in ${T.OPEN_DELAY_MS / 1000}s`);
  }

  // --- refresh bookkeeping: 10s of no progress -> reload, max 5 in a row, then stuck ---
  clearRefreshes() { this.stuck = false; this.refresh = { step: -1, n: 0, at: 0 }; }
  async reloadStalled(step, why) {
    const rec = this.refresh;
    const n = rec.step === step && Date.now() - rec.at < T.RESET_AFTER_MS ? rec.n : 0;
    if (n >= T.MAX_REFRESHES) {
      if (!this.stuck) {
        this.stuck = true;
        this.status(`Stuck on ${STEPS[step] || 'page'}: ${why} after ${T.MAX_REFRESHES} refreshes`);
        await this.shot('stuck');
        this.changed();
      }
      return;
    }
    this.refresh = { step, n: n + 1, at: Date.now() };
    this.status(`${why}, refreshing (${n + 1}/${T.MAX_REFRESHES})…`);
    this.progress();
    try { await this.driver.reload(); } catch {}
  }
  stalled() { return Date.now() - Math.max(this.lastProgress, this.docAt) > T.STALL_MS; }

  // --- controls ---
  pause() { this.paused = true; this.nav = null; this.status('Paused'); this.changed(); }
  resume() {
    this.paused = false; this.holdUntil = 0;
    this.solving?.abort();
    if (this.captcha) this.captchaOverride = true; // carry on even if the modal is still up; it re-arms once it is gone
    this.captcha = false; this.clearRefreshes(); this.progress(); this.status('Resumed'); this.changed();
  }
  async restart() {
    this.nav = null; this.clearRefreshes(); this.jobs.clear(); this.firstId = null; this.schedule = null;
    this.resetLogin(); this.paused = false; this._site = null; this.holdUntil = 0;
    this.loginFirst = true;
    await this.go(this.loginUrl);
    this.changed();
  }
  // Open the solver again after a person left the captcha to the page (the panel's "Try again").
  retryCaptcha() {
    if (this.solving) return;
    if (this.captcha) { this.captcha = false; this.changed(); } else if (this.beginClicked) this.retryHuman = true;
  }
  stop() { this.stopped = true; this.solving?.abort(); }

  // --- main loop ---
  async run({ navigate = true } = {}) {
    this.driver.on('navigated', () => { this.resetDoc(); this.progress(); this.changed(); });
    this.driver.on('gql', (e) => { try { this.onGql(e); } catch (err) { this.log(`gql error: ${err.message}`); } });
    this.driver.on('closed', () => { this.stopped = true; });
    this.loginFirst = true;
    if (navigate) await this.go(this.loginUrl);
    let lastStep = -2, sawLogin = false;
    while (!this.stopped) {
      try {
        const step = this.step();
        if (step === 0) sawLogin = true;
        // login-only mode: once the login page hands back to the hiring site, the session is complete
        if (this.host.loginOnly && sawLogin && step !== 0 && /^hiring\.amazon\./.test(this.url().hostname)) {
          await sleep(3000);
          await this.host.onLoggedIn?.();
          this.log('logged in');
          break;
        }
        if (step !== lastStep) {
          lastStep = step;
          if (step >= 0) { this.log(`step ${step + 1}/${STEPS.length} ${STEPS[step]}`); await this.shot(STEPS[step].toLowerCase()); }
          this.changed();
        }
        await this.tick();
      } catch (e) {
        if (!/Execution context|navigation|Target closed|closed|No tab|Cannot access|frame|Receiving end/i.test(e.message)) this.log(`error: ${String(e.message).split('\n')[0]}`);
      }
      await sleep(500);
    }
    this.stopped = true;
    this.changed();
  }

  async tick() {
    if (this.paused || this.stuck) return;
    if (await this.checkCaptcha()) return;
    if (await this.humanCheck()) return;

    if (this.nav) {
      if (Date.now() < this.nav.at) return;
      const { target, valid } = this.nav;
      this.nav = null;
      if (valid()) await this.go(target);
      return;
    }

    const u = this.url();
    if (/\/remoteKYC/.test(u.pathname) && /amazon\.(in|com|ca)$/.test(u.hostname)) return this.kyc(u);
    if (this.step() > 0) this.loginFirst = false; // past the login: the normal flow
    switch (this.step()) {
      case 0: return this.loginTick();
      case 1: return this.searchTick();
      case 2: return this.jobTick();
      case 3: return this.applicationTick();
      default:
        // the login page sends an already logged-in browser straight on to the hiring site: carry on with the search from there
        if (this.loginFirst && /^https:\/\/hiring\.amazon\./.test(this.driver.url())) { this.loginFirst = false; await this.go(this.searchUrl); } else
        if (!/^https:\/\/(auth\.)?hiring\.amazon\./.test(this.driver.url())) await this.go(this.searchUrl);
        else this.status('Not on a known step');
    }
  }

  async checkCaptcha() {
    const shown = await this.dom('captchaVisible').catch(() => false);
    if (!shown) {
      this.captchaOverride = false;
      if (this.captcha) { this.captcha = false; this.log('Captcha gone'); this.progress(); this.changed(); }
      return false;
    }
    if (this.captchaOverride) return false;
    if (!this.captcha) {
      this.captcha = true; this.solverError = '';
      this.status('Captcha is being asked');
      this.changed();
      await this.shot('captcha');
      // the modal draws its tiles a moment after it appears: give it time before the capture
      await sleep(T.CAPTCHA_SETTLE_MS ?? 2000);
      if (this.stopped || this.paused || !(await this.dom('captchaVisible').catch(() => false))) { this.captcha = false; this.changed(); return true; }
      if (this.host.solver) {
        try {
          const ok = await this.runSolver('captcha', 'captcha-solver');
          if (ok && !this.stopped) { this.captcha = false; this.progress(); this.changed(); return false; }
          if (!ok && !this.stopped && !this.captchaOverride) this.solverError = this.solverError || 'it gave up';
        } catch (e) { this.log(`captcha solver failed: ${e.message}`); this.solverError = String(e.message).split('\n')[0].slice(0, 160); this.changed(); }
      }
      if (!this.captchaOverride && !this.stopped) this.log('Waiting for the captcha to be solved (Resume to carry on)');
    }
    return true; // holds every step while the modal is up
  }

  // One solver call; it can be cancelled (Resume / Stop abort the signal) so a solver that waits for a person never outlives that.
  async runSolver(kind, shotLabel) {
    this.solving = new AbortController();
    try {
      return await this.host.solver.solve({ driver: this.driver, dom: (op, arg) => this.dom(op, arg), screenshot: () => this.shot(shotLabel), log: this.log, signal: this.solving.signal, kind });
    } finally { this.solving = null; }
  }

  // "Let's confirm you are human": press Begin, then leave the page alone for a while (a reload would restart the check).
  async humanCheck() {
    if (this.retryHuman) {
      this.retryHuman = false; this.holdUntil = Date.now() + 120000;
      try { if (await this.runSolver('human-check', 'human-check-solver')) this.holdUntil = 0; } catch (e) { this.log(`solver failed: ${e.message}`); }
      return true;
    }
    if (Date.now() < this.holdUntil) {
      this.progress();
      this.status('Security check started, waiting for it to be solved');
      return true;
    }
    if (this.beginClicked || !(await this.dom('clickBegin').catch(() => false))) return false;
    this.beginClicked = true;
    this.holdUntil = Date.now() + 120000;
    this.status('Security check: pressed Begin');
    await this.shot('human-check');
    if (this.host.solver) {
      try {
        if (await this.runSolver('human-check', 'human-check-solver')) this.holdUntil = 0;
      } catch (e) { this.log(`solver failed: ${e.message}`); }
    }
    return true;
  }

  // --- steps ---
  async searchTick() {
    if (Date.now() - this.docAt < T.SEARCH_DELAY_MS) return;
    if (!this.searchDone.all) {
      if (await this.dom('clickAllTab')) { this.searchDone.all = true; this.progress(); this.status('Search · pressed All'); }
    } else if (!this.searchDone.clear) {
      if (await this.dom('clearLocation')) { this.searchDone.clear = true; this.progress(); this.status('Search · cleared the location'); }
    }
    if (this.nav) return;
    this.status(this.firstId ? `Found ${this.jobs.size} job(s). First: ${this.firstId}` : 'Waiting for searchJobCardsByLocation…');
    if (this.stalled()) await this.reloadStalled(1, 'Search did not load');
  }

  async jobTick() {
    if (this.nav) return;
    this.status(this.schedule ? `Schedule found: ${this.schedule.scheduleId}` : 'Waiting for searchScheduleCards…');
    if (this.stalled()) await this.reloadStalled(2, 'Job page did not load');
  }

  async applicationTick() {
    const r = this.hash().split('?')[0] || '#/';
    if (this.pendingClick) return;
    const res = await this.dom('appInspect', BUTTONS);
    if (res.ticked || res.answered) {
      this.progress();
      return this.status(`Application ${r} · ${res.ticked ? `ticked ${res.ticked} checkbox(es)` : 'answered the referral question: No'}`);
    }
    const btn = res.button;
    if (!btn) {
      if ([...this.clicked].some((k) => k.startsWith(r))) return this.status(`Application ${r} · waiting after click`);
      this.status(`Application ${r} · waiting for a button…`);
      if (this.stalled()) await this.reloadStalled(3, `Nothing loaded on ${r}`);
      return;
    }
    const key = `${r}|${btn.text.toLowerCase()}`;
    if (this.clicked.has(key)) return this.status(`Application ${r} · ${btn.text} clicked`);
    if (btn.disabled) return this.status(`Application ${r} · ${btn.text} is disabled (a required choice may be missing)`);
    this.clicked.add(key);
    this.pendingClick = true;
    this.status(`Application ${r} · clicking ${btn.text}…`);
    await sleep(T.CLICK_DELAY_MS);
    this.pendingClick = false;
    await this.dom('clickButton', btn.text);
    this.progress(); this.clearRefreshes();
    await this.shot('clicked');
    if (/^apply for other jobs$/i.test(btn.text)) { // if the button doesn't lead to the search itself, go there
      await sleep(3000);
      if (this.url().pathname.startsWith('/application')) await this.go(this.searchUrl);
    }
  }

  async loginTick() {
    const f = this.loginFlags, c = this.cfg();
    const st = (t) => this.status(`Login · ${t}`);
    const info = await this.dom('loginInspect');

    if (info.code && !info.sms) { // reading the SMS code needs neither credentials nor attempts
      if (f.code) return st('Verification: code submitted');
      const inbox = c.smsUrl || (c.loginPhone ? `https://temp-number.com/temporary-numbers/canada/${c.loginPhone.replace(/\D/g, '')}` : '');
      if (!inbox) return st('Verification: waiting for you to enter the SMS code (set an SMS inbox URL)');
      if (!this.smsRequestedAt) this.smsRequestedAt = Date.now();
      if (!f.fetch) {
        const left = Math.ceil((T.SMS_WAIT_MS - (Date.now() - this.smsRequestedAt)) / 1000);
        if (left > 0) return st(`Verification: checking the SMS inbox in ${left}s…`);
        f.fetch = true;
        st('Verification: reading the code from the SMS inbox…');
        this.smsCode = await fetchSmsCode(this.driver, pageFn, inbox, this.smsRequestedAt, this.log);
        if (!this.smsCode) { f.fetch = false; this.smsRequestedAt = Date.now() - T.SMS_WAIT_MS; return st('Verification: no code found yet, retrying…'); }
      }
      if (this.smsCode && !info.codeValue) {
        f.code = true;
        st('Verification: entering the code…');
        await this.dom('loginFill', { kind: 'code', value: this.smsCode });
        this.smsCode = null; this.progress();
        await sleep(400);
        const ok = await this.dom('pressLoginButton');
        return st(ok ? 'Verification: code submitted' : 'Verification: code entered, no Verify button found');
      }
      return;
    }

    if (!c.loginPhone || !c.loginPin) return st('Auto-login paused: set the phone and PIN in Settings');
    if (this.attempts >= T.MAX_LOGIN_ATTEMPTS) return st('Auto-login stopped: attempt limit reached (Restart to reset)');

    if (info.sms) {
      if (f.send) return st('Verification: code requested by SMS');
      f.send = true; this.attempts++; this.smsRequestedAt = Date.now(); this.progress();
      st('Verification: choosing SMS and sending the code…');
      await this.dom('chooseSms');
      await sleep(400);
      const ok = await this.dom('pressLoginButton');
      return st(ok ? 'Verification: code requested by SMS' : 'Verification: SMS chosen, no send button found');
    }
    if (info.pin) {
      if (f.pin) return st('PIN step: submitted');
      if (info.pinValue) return;
      f.pin = true; this.attempts++; this.progress();
      st('PIN step: filling PIN…');
      await this.dom('loginFill', { kind: 'pin', value: c.loginPin });
      await sleep(400);
      const ok = await this.dom('pressLoginButton');
      return st(ok ? 'PIN step: submitted' : 'PIN step: filled, no submit button found');
    }
    if (info.phone) {
      if (f.phone) return st('Phone step: submitted');
      if (info.phoneValue) return;
      f.phone = true; this.attempts++; this.progress();
      st('Phone step: filling…');
      await this.dom('loginFill', { kind: 'phone', value: c.loginPhone });
      await sleep(400);
      const ok = await this.dom('pressLoginButton');
      return st(ok ? 'Phone step: submitted' : 'Phone step: filled, no Continue button found');
    }
    st('Waiting for the login form…');
    if (this.stalled()) await this.reloadStalled(3, 'Login form did not load');
  }

  async kyc(u) {
    if (!u.searchParams.has('clientId')) return;
    const link = u.href;
    const copied = await this.dom('copy', link).catch(() => false);
    this.log(`KYC link saved${copied ? ' and copied' : ''}: ${link}`);
    try { await this.host.onKyc?.(link, !!copied); } catch (e) { this.log(`saving KYC link failed: ${e.message}`); }
    await this.shot('kyc');
    this.resetLogin(); this.clearRefreshes();
    let site = this.site;
    try { site = /\.amazon\.com$/.test(new URL(u.searchParams.get('onSuccess')).hostname) ? 'com' : 'ca'; } catch {}
    if (this.cfg().continuous === false) { this.log('Done (continuous is off)'); this.stopped = true; return; }
    this._site = site;
    await this.go(this.searchUrl);
  }
}
