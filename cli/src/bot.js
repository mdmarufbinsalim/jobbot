import fs from 'node:fs';
import path from 'node:path';
import * as dom from './dom.js';
import { isCaptcha } from './captcha.js';
import { fetchSmsCode } from './sms.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const OPEN_DELAY_MS = 3000;
const STALL_MS = 10000;          // a step with no progress this long -> reload
const MAX_REFRESHES = 5;         // per step, then stuck
const RESET_AFTER_MS = 120000;   // refresh count starts over if the last reload was this long ago
const SEARCH_DELAY_MS = 800;
const CLICK_DELAY_MS = 600;
const SMS_WAIT_MS = 10000;
const MAX_LOGIN_ATTEMPTS = 4;
const STEPS = ['Search', 'Job', 'Application', 'Login'];

export class Bot {
  constructor({ context, page, cfg, opts, log }) {
    Object.assign(this, { context, page, cfg, opts, log });
    this.site = opts.site;
    this.origin = `https://hiring.amazon.${this.site}`;
    this.searchUrl = `${this.origin}/app#/jobSearch`;
    this.locale = this.site === 'ca' ? 'en-CA' : 'en-US';
    this.paused = false; this.stopped = false; this.stuck = false; this.captcha = false;
    this.jobs = new Map(); this.firstId = null; this.schedule = null;
    this.nav = null;                 // { at, target, valid, label }
    this.refresh = { step: -1, n: 0, at: 0 };
    this.lastProgress = Date.now();
    this.statusText = '';
    this.shotN = 0;
    this.kycFile = path.join(opts.out, 'kyc-links.txt');
    this.resetDoc();
    this.resetLogin();
  }

  // --- per-document state (the extension's content scripts reset this on every page load) ---
  resetDoc() {
    this.docAt = Date.now();
    this.searchDone = { all: false, clear: false };
    this.clicked = new Set();
    this.pendingClick = false;
  }
  resetLogin() {
    this.attempts = 0;
    this.loginFlags = { phone: false, pin: false, send: false, fetch: false, code: false };
    this.smsRequestedAt = 0; this.smsCode = null; this.loginStatus = '';
  }
  progress() { this.lastProgress = Date.now(); }

  status(text) {
    if (text === this.statusText) return;
    this.statusText = text;
    this.log(text);
  }

  async shot(label) {
    if (!this.opts.shots) return null;
    try {
      fs.mkdirSync(this.opts.shots, { recursive: true });
      const file = path.join(this.opts.shots, `${new Date().toISOString().replace(/[:.]/g, '-')}-${String(++this.shotN).padStart(3, '0')}-${label}.png`);
      await this.page.screenshot({ path: file });
      this.log(`screenshot: ${file}`);
      return file;
    } catch (e) { this.log(`screenshot failed: ${e.message}`); return null; }
  }

  // --- wiring ---
  attach() {
    const { page } = this;
    page.on('framenavigated', (f) => {
      if (f !== page.mainFrame()) return;
      this.resetDoc(); this.progress();
    });
    page.on('response', (r) => this.onResponse(r).catch(() => {}));
    page.on('close', () => { this.stopped = true; });
  }

  async onResponse(res) {
    const req = res.request();
    const body = req.postData() || '';
    if (!/graphql|appsync/i.test(req.url()) && !/"(operationName|query)"\s*:/.test(body)) return;
    let request = body, response;
    try { request = JSON.parse(body); } catch {}
    try { response = await res.json(); } catch { return; }
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
      return;
    }
    const cards = response?.data?.searchJobCardsByLocation?.jobCards;
    if (op !== 'searchJobCardsByLocation' || !Array.isArray(cards)) return;
    const locale = request?.variables?.searchJobRequest?.locale;
    for (const c of cards) if (c?.jobId) this.jobs.set(c.jobId, { ...c, link: this.detailLink(c.jobId, locale) });
    const first = cards.find((c) => c?.jobId);
    if (first) this.firstId = first.jobId;
    if (first && this.onSearch()) this.navigateSoon('Opening first job', this.jobs.get(first.jobId).link, () => this.onSearch());
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
  url() { try { return new URL(this.page.url()); } catch { return new URL('about:blank', 'http://x'); } }
  hash() { return this.url().hash; }
  onSearch() { return this.hash().startsWith('#/jobSearch'); }
  onDetail() { return this.hash().startsWith('#/jobDetail'); }
  hashJobId() { return new URLSearchParams(this.hash().split('?')[1] || '').get('jobId'); }
  step() {
    const u = this.url();
    if (/^auth\./.test(u.hostname)) return 3;
    if (u.pathname.startsWith('/application')) return 2;
    if (u.hash.startsWith('#/jobDetail')) return 1;
    if (u.hash.startsWith('#/jobSearch')) return 0;
    return -1;
  }
  async go(url) {
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch((e) => this.log(`goto failed: ${e.message.split('\n')[0]}`));
    this.progress();
  }

  navigateSoon(label, target, valid) {
    this.clearRefreshes();
    this.nav = { at: Date.now() + OPEN_DELAY_MS, target, valid, label };
    this.status(`${label} in ${OPEN_DELAY_MS / 1000}s`);
  }

  // --- refresh bookkeeping (10s of no progress -> reload, max 5 in a row, then stuck) ---
  clearRefreshes() { this.stuck = false; this.refresh = { step: -1, n: 0, at: 0 }; }
  async reloadStalled(step, why) {
    const rec = this.refresh;
    const n = rec.step === step && Date.now() - rec.at < RESET_AFTER_MS ? rec.n : 0;
    if (n >= MAX_REFRESHES) {
      if (!this.stuck) {
        this.stuck = true;
        this.status(`STUCK on ${STEPS[step] || 'page'}: ${why} after ${MAX_REFRESHES} refreshes (press r to retry)`);
        await this.shot('stuck');
      }
      return;
    }
    this.refresh = { step, n: n + 1, at: Date.now() };
    this.status(`${why}, refreshing (${n + 1}/${MAX_REFRESHES})…`);
    this.progress();
    await this.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
  }
  stalled() { return Date.now() - Math.max(this.lastProgress, this.docAt) > STALL_MS; }

  // --- controls ---
  pause() { this.paused = true; this.nav = null; this.status('paused'); }
  resume() { this.paused = false; this.captcha = false; this.clearRefreshes(); this.progress(); this.status('resumed'); }
  async restart() { this.nav = null; this.clearRefreshes(); this.jobs.clear(); this.firstId = null; this.schedule = null; this.resetLogin(); this.paused = false; await this.go(this.searchUrl); }
  stop() { this.stopped = true; }

  // --- main loop ---
  async run() {
    await this.context.addInitScript(dom.INIT_SCRIPT);
    this.attach();
    await this.go(this.searchUrl);
    let lastStep = -2;
    while (!this.stopped) {
      try {
        const step = this.step();
        if (step !== lastStep) { lastStep = step; if (step >= 0) { this.log(`step ${step + 1}/4 ${STEPS[step]}`); await this.shot(STEPS[step].toLowerCase()); } }
        await this.tick();
      } catch (e) {
        if (!/Execution context|navigation|Target closed|closed/i.test(e.message)) this.log(`error: ${e.message.split('\n')[0]}`);
      }
      await sleep(500);
    }
  }

  async tick() {
    if (this.paused || this.stuck) return;
    if (await this.checkCaptcha()) return;

    if (this.nav) {
      if (Date.now() < this.nav.at) return;
      const { target, valid } = this.nav;
      this.nav = null;
      if (valid()) await this.go(target);
      return;
    }

    const u = this.url();
    if (/\/remoteKYC/.test(u.pathname) && /amazon\.(in|com|ca)$/.test(u.hostname)) return this.kyc(u);
    switch (this.step()) {
      case 0: return this.searchTick();
      case 1: return this.jobTick();
      case 2: return this.applicationTick();
      case 3: return this.loginTick();
      default:
        if (!/^https:\/\/(auth\.)?hiring\.amazon\./.test(this.page.url())) await this.go(this.searchUrl);
        else this.status('Not on a known step');
    }
  }

  async checkCaptcha() {
    const shown = await isCaptcha(this.page);
    if (!shown) { if (this.captcha) { this.captcha = false; this.log('captcha gone'); this.progress(); } return false; }
    if (!this.captcha) {
      this.captcha = true;
      this.status('Captcha is being asked');
      await this.shot('captcha');
      if (this.opts.solver) {
        try {
          const ok = await this.opts.solver.solve({ page: this.page, screenshot: () => this.shot('captcha-solver'), log: this.log });
          if (ok) { this.captcha = false; this.progress(); return false; }
        } catch (e) { this.log(`captcha solver failed: ${e.message}`); }
      }
      this.log('captcha: waiting for it to be solved (r to continue)');
    }
    return true; // holds every step while the modal is up
  }

  // --- steps ---
  async searchTick() {
    if (Date.now() - this.docAt < SEARCH_DELAY_MS) return;
    if (!this.searchDone.all) {
      if (await this.page.evaluate(dom.clickAllTab)) { this.searchDone.all = true; this.progress(); this.status('Search · pressed All'); }
    } else if (!this.searchDone.clear) {
      if (await this.page.evaluate(dom.clearLocation)) { this.searchDone.clear = true; this.progress(); this.status('Search · cleared the location'); }
    }
    if (this.nav) return;
    this.status(this.firstId ? `Search · found ${this.jobs.size} job(s), first ${this.firstId}` : 'Search · waiting for searchJobCardsByLocation…');
    if (this.stalled()) await this.reloadStalled(0, 'search did not load');
  }

  async jobTick() {
    this.status(this.schedule ? `Job · schedule ${this.schedule.scheduleId}` : 'Job · waiting for searchScheduleCards…');
    if (this.stalled()) await this.reloadStalled(1, 'job page did not load');
  }

  async applicationTick() {
    const r = this.hash().split('?')[0] || '#/';
    if (this.pendingClick) return;
    const res = await this.page.evaluate(dom.appInspect, dom.BUTTONS);
    if (res.ticked || res.answered) {
      this.progress();
      return this.status(`Application ${r} · ${res.ticked ? `ticked ${res.ticked} checkbox(es)` : 'answered the referral question: No'}`);
    }
    const btn = res.button;
    if (!btn) {
      if ([...this.clicked].some((k) => k.startsWith(r))) return this.status(`Application ${r} · waiting after click`);
      this.status(`Application ${r} · waiting for a button…`);
      if (this.stalled()) await this.reloadStalled(2, `nothing loaded on ${r}`);
      return;
    }
    const key = `${r}|${btn.text.toLowerCase()}`;
    if (this.clicked.has(key)) return this.status(`Application ${r} · ${btn.text} clicked`);
    if (btn.disabled) return this.status(`Application ${r} · ${btn.text} is disabled (a required choice may be missing)`);
    this.clicked.add(key);
    this.pendingClick = true;
    this.status(`Application ${r} · clicking ${btn.text}…`);
    await sleep(CLICK_DELAY_MS);
    this.pendingClick = false;
    await this.page.evaluate(dom.clickButton, btn.text);
    this.progress(); this.clearRefreshes();
    await this.shot('clicked');
    if (/^apply for other jobs$/i.test(btn.text)) {
      await sleep(3000);
      if (this.url().pathname.startsWith('/application')) await this.go(this.searchUrl);
    }
  }

  async loginTick() {
    const f = this.loginFlags, c = this.cfg;
    const st = (t) => { this.loginStatus = t; this.status(`Login · ${t}`); };
    const info = await this.page.evaluate(dom.loginInspect);

    if (info.code && !info.sms) { // reading the SMS code needs neither credentials nor attempts
      if (f.code) return st('Verification: code submitted');
      const inbox = c.smsUrl || (c.loginPhone ? `https://temp-number.com/temporary-numbers/canada/${c.loginPhone.replace(/\D/g, '')}` : '');
      if (!inbox) return st('Verification: waiting for you to enter the SMS code (set an SMS inbox URL)');
      if (!this.smsRequestedAt) this.smsRequestedAt = Date.now();
      if (!f.fetch) {
        const left = Math.ceil((SMS_WAIT_MS - (Date.now() - this.smsRequestedAt)) / 1000);
        if (left > 0) return st(`Verification: checking the SMS inbox in ${left}s…`);
        f.fetch = true;
        st('Verification: reading the code from the SMS inbox…');
        this.smsCode = await fetchSmsCode(this.context, inbox, this.smsRequestedAt, this.log);
        if (!this.smsCode) { f.fetch = false; this.smsRequestedAt = Date.now() - SMS_WAIT_MS; return st('Verification: no code found yet, retrying…'); }
      }
      if (this.smsCode && !info.codeValue) {
        f.code = true;
        st('Verification: entering the code…');
        await this.page.evaluate(dom.loginFill, { kind: 'code', value: this.smsCode });
        this.smsCode = null; this.progress();
        await sleep(400);
        const ok = await this.page.evaluate(dom.pressLoginButton);
        return st(ok ? 'Verification: code submitted' : 'Verification: code entered, no Verify button found');
      }
      return;
    }

    if (!c.loginPhone || !c.loginPin) return st('Auto-login paused: set loginPhone and loginPin');
    if (this.attempts >= MAX_LOGIN_ATTEMPTS) return st('Auto-login stopped: attempt limit reached (restart to reset)');

    if (info.sms) {
      if (f.send) return st('Verification: code requested by SMS');
      f.send = true; this.attempts++; this.smsRequestedAt = Date.now(); this.progress();
      st('Verification: choosing SMS and sending the code…');
      await this.page.evaluate(dom.chooseSms);
      await sleep(400);
      const ok = await this.page.evaluate(dom.pressLoginButton);
      return st(ok ? 'Verification: code requested by SMS' : 'Verification: SMS chosen, no send button found');
    }
    if (info.pin) {
      if (f.pin) return st('PIN step: submitted');
      if (info.pinValue) return;
      f.pin = true; this.attempts++; this.progress();
      st('PIN step: filling PIN…');
      await this.page.evaluate(dom.loginFill, { kind: 'pin', value: c.loginPin });
      await sleep(400);
      const ok = await this.page.evaluate(dom.pressLoginButton);
      return st(ok ? 'PIN step: submitted' : 'PIN step: filled, no submit button found');
    }
    if (info.phone) {
      if (f.phone) return st('Phone step: submitted');
      if (info.phoneValue) return;
      f.phone = true; this.attempts++; this.progress();
      st('Phone step: filling…');
      await this.page.evaluate(dom.loginFill, { kind: 'phone', value: c.loginPhone });
      await sleep(400);
      const ok = await this.page.evaluate(dom.pressLoginButton);
      return st(ok ? 'Phone step: submitted' : 'Phone step: filled, no Continue button found');
    }
    st('Waiting for the login form…');
    if (this.stalled()) await this.reloadStalled(3, 'login form did not load');
  }

  async kyc(u) {
    const link = u.href;
    if (!u.searchParams.has('clientId')) return;
    fs.mkdirSync(this.opts.out, { recursive: true });
    fs.appendFileSync(this.kycFile, `${new Date().toISOString()} ${link}\n`);
    this.log(`KYC link saved to ${this.kycFile}`);
    this.log(link);
    await this.shot('kyc');
    this.resetLogin(); this.clearRefreshes();
    let site = this.site;
    try { site = /\.amazon\.com$/.test(new URL(u.searchParams.get('onSuccess')).hostname) ? 'com' : 'ca'; } catch {}
    if (!this.opts.continuous) { this.log('done (--once)'); this.stopped = true; return; }
    this.site = site; this.origin = `https://hiring.amazon.${site}`; this.searchUrl = `${this.origin}/app#/jobSearch`;
    await this.go(this.searchUrl);
  }
}
