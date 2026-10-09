#!/usr/bin/env node
// Controls a Jobbot server over HTTP. No dependencies: it only needs Node 20+ (fetch). The server lives in ../server and
// can run on this machine (this CLI starts it in the background) or anywhere else (--url).
import { parseArgs } from 'node:util';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER_BIN = path.resolve(HERE, '../../server/bin/server.js');
const CONF = path.join(os.homedir(), '.config/jobbot');
const PID_FILE = path.join(CONF, 'server.pid');
const LOG_FILE = path.join(CONF, 'server.log');
const DEFAULT_URL = 'http://127.0.0.1:8787'; // change with --url or JOBBOT_URL

const HELP = `jobbot <command> [options]

Bot
  start                  start the bot (starts the background server first if it is not running)
  stop | pause | resume | restart
  status [--json]        everything: step, job, shift, KYC links, settings, recent log
  watch                  live: every status change and log line until Ctrl+C
  logs [-f]              the server log (-f to follow)
  shot [file]            save a screenshot of the bot's tab (default shot.png)
  kyc                    saved KYC links
  config [--site ca|com] [--once|--continuous] [--phone X] [--pin X] [--sms-url X]    show or change settings
  session import <state.json>    send a saved login (Playwright storage state) to the server
  login [--headed]       log in once (headless; a captcha needs --headed so you can solve it) and save the session

Server (the process that owns the browser; runs in the background)
  up [--headed] [--port 8787] [--host 127.0.0.1]    start it     (alias: server start)
  down                                              stop it      (alias: server stop)
  ps                                                is it up, which pid, what it is doing   (alias: server status)
  serve                                             run it in the foreground

Options
  --url <http://host:port>   server to control (default http://127.0.0.1:8787, or $JOBBOT_URL)
  --token <secret>           only for a server that was started with a token ($JOBBOT_TOKEN)
`;

const { values: v, positionals: pos } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: 'string' }, token: { type: 'string' }, json: { type: 'boolean', default: false },
    headed: { type: 'boolean', default: false }, port: { type: 'string', default: '8787' }, host: { type: 'string', default: '127.0.0.1' },
    f: { type: 'boolean', short: 'f', default: false }, site: { type: 'string' }, once: { type: 'boolean', default: false }, continuous: { type: 'boolean', default: false },
    phone: { type: 'string' }, pin: { type: 'string' }, 'sms-url': { type: 'string' }, help: { type: 'boolean', short: 'h', default: false },
  },
});
let [cmd, sub, arg] = pos;
if (cmd === 'server') { cmd = { start: 'up', stop: 'down', status: 'ps', logs: 'logs', run: 'serve' }[sub] || 'server'; sub = arg; arg = pos[3]; }
if (v.help || !cmd) { console.log(HELP); process.exit(cmd || v.help ? 0 : 1); }

// `up --port/--host` starts a server elsewhere than the default, so talk to that one in the same command
const BASE = (v.url || process.env.JOBBOT_URL || (pos[0] === 'up' || pos[0] === 'serve' ? `http://${v.host === '0.0.0.0' ? '127.0.0.1' : v.host}:${v.port}` : DEFAULT_URL)).replace(/\/+$/, '');
const token = () => v.token || process.env.JOBBOT_TOKEN || '';   // optional; only a server listening beyond localhost needs one
const authHeader = () => (token() ? { Authorization: `Bearer ${token()}` } : {});
const die = (m) => { console.error(m); process.exit(1); };

async function call(route, method = 'GET', body, raw = false) {
  let r;
  try {
    r = await fetch(BASE + route, {
      method,
      headers: { ...authHeader(), ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(15000),
    });
  } catch { die(`Cannot reach the server at ${BASE}. Start it with: jobbot server start`); }
  if (r.status === 401) die('This server needs a token: pass --token <secret> or set JOBBOT_TOKEN.');
  if (!r.ok) die(`Server error: ${(await r.json().catch(() => ({}))).error || r.status}`);
  return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
}
const healthy = () => fetch(`${BASE}/health`, { signal: AbortSignal.timeout(2000) }).then((r) => r.ok).catch(() => false);
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const readPid = () => { try { return Number(fs.readFileSync(PID_FILE, 'utf8')); } catch { return 0; } };

const STEP_NAMES = ['Search', 'Job', 'Application', 'Login'];
const pay = (lo, hi) => (lo && hi && lo !== hi ? `${lo}–${hi}` : hi || lo || '');

// Everything the server knows: bot state, step progress, the first job and shift found, KYC links, settings, recent log.
function summary(s, { log = 12 } = {}) {
  const l = s.live, out = [];
  out.push(`Bot      ${!s.running ? 'stopped' : l?.captcha ? 'CAPTCHA — waiting for you (solve it, then: jobbot resume)' : s.paused ? 'paused' : l?.stuck ? 'STUCK' : 'running'}`);
  if (l) {
    out.push(`Steps    ${STEP_NAMES.map((n, i) => `${i < l.step ? '✓' : i === l.step ? '●' : '○'} ${n}`).join('   ')}`);
    out.push(`Now      ${l.detail}`);
    out.push(`Page     ${l.url}`);
  }
  const f = s.flow;
  const job = f?.jobs?.find(([id]) => id === f.firstId)?.[1];
  if (job) {
    out.push('', `Job      ${job.jobTitle || job.jobId}  (${job.jobId})`);
    const bits = [job.locationName, job.jobTypeL10N || job.jobType, job.employmentTypeL10N || job.employmentType, pay(job.totalPayRateMinL10N, job.totalPayRateMaxL10N), `${job.scheduleCount ?? '?'} schedule(s)`].filter(Boolean);
    out.push(`         ${bits.join(' · ')}`, `         ${job.link}`, `         ${f.jobs.length} job(s) found in total`);
  }
  const sc = f?.schedule;
  if (sc) {
    out.push('', `Shift    ${sc.scheduleText || sc.scheduleId}  (${sc.scheduleId})`);
    const bits = [sc.scheduleTypeL10N, sc.totalPayRateL10N, sc.hoursPerWeek && `${sc.hoursPerWeek} h/wk`, sc.laborDemandAvailableCount != null && `${sc.laborDemandAvailableCount} open`, sc.firstDayOnSiteL10N && `starts ${sc.firstDayOnSiteL10N}`].filter(Boolean);
    out.push(`         ${bits.join(' · ')}`, `         ${sc.link}`);
  }
  out.push('', `KYC      ${s.kyc?.length ? '' : 'none saved yet'}`);
  for (const k of s.kyc || []) out.push(`         ${new Date(k.at).toLocaleString()}  ${k.url}`);
  if (s.config) out.push('', `Settings site ${s.config.site} · ${s.config.continuous ? 'continuous' : 'one run'} · credentials ${s.config.hasCredentials ? 'set' : 'MISSING'} · inbox ${s.config.smsUrl || 'default'}`);
  if (log && s.log?.length) out.push('', 'Recent', ...s.log.slice(-log).map((x) => `  ${x}`));
  return out.join('\n');
}

async function serverStart() {
  if (await healthy()) return console.log(`Server already running at ${BASE}`);
  fs.mkdirSync(CONF, { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a');
  const args = [SERVER_BIN, 'serve', '--port', v.port, '--host', v.host, ...(v.headed ? ['--headed'] : [])];
  if (v.token) args.push('--token', v.token);
  const child = spawn(process.execPath, args, { detached: true, stdio: ['ignore', out, out] });
  child.unref();
  fs.writeFileSync(PID_FILE, String(child.pid));
  for (let i = 0; i < 40; i++) {
    if (await healthy()) return console.log(`Server started in the background (pid ${child.pid}) at ${BASE}, ${v.headed ? 'headed' : 'headless'}.\nLog: ${LOG_FILE}`);
    if (!alive(child.pid)) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  die(`The server did not come up. Last log lines:\n${fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-8).join('\n') : '(no log)'}`);
}

async function serverStop() {
  if (await healthy()) await fetch(`${BASE}/stop`, { method: 'POST', headers: authHeader() }).catch(() => {});
  const pid = readPid();
  if (pid && alive(pid)) {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 30 && alive(pid); i++) await new Promise((r) => setTimeout(r, 200));
    if (alive(pid)) process.kill(pid, 'SIGKILL');
    fs.rmSync(PID_FILE, { force: true });
    return console.log('Server stopped.');
  }
  fs.rmSync(PID_FILE, { force: true });
  console.log((await healthy()) ? `A server at ${BASE} is running but was not started by this CLI (no pid file); stop it where it runs.` : 'No server running.');
}

const run = {
  async server() { die('server start | stop | status | logs | run   (or: up | down | ps | logs | serve)'); },
  async up() { return serverStart(); },
  async down() { return serverStop(); },
  async ps() {
    const up = await healthy(), pid = v.url ? 0 : readPid();
    console.log(`server   ${up ? 'up' : 'down'}  ${BASE}${pid && alive(pid) ? `  pid ${pid}` : ''}`);
    if (up) console.log(`\n${summary(await call('/status'))}`);
  },
  async serve() { return new Promise((r) => spawn(process.execPath, [SERVER_BIN, 'serve', '--port', v.port, '--host', v.host, ...(v.headed ? ['--headed'] : [])], { stdio: 'inherit' }).on('exit', r)); },
  async logs() {
    if (!v.url && fs.existsSync(LOG_FILE)) {
      const t = spawn('tail', ['-n', '60', ...(v.f ? ['-f'] : []), LOG_FILE], { stdio: 'inherit' });
      return new Promise((r) => t.on('exit', r));
    }
    const s = await call('/status'); // remote server: the recent log it keeps
    console.log((s.log || []).join('\n') || 'No log yet.');
  },
  async start() {
    if (!v.url && !process.env.JOBBOT_URL && !(await healthy())) await serverStart();
    console.log(summary(await call('/start', 'POST')));
  },
  async stop() { console.log(summary(await call('/stop', 'POST'))); },
  async pause() { console.log(summary(await call('/pause', 'POST'))); },
  async resume() { console.log(summary(await call('/resume', 'POST'))); },
  async restart() { console.log(summary(await call('/restart', 'POST'))); },
  async status() { const s = await call('/status'); console.log(v.json ? JSON.stringify(s, null, 2) : summary(s)); },
  async watch() {
    let last = '', printed = [];
    for (;;) {
      const s = await call('/status');
      const snap = summary(s, { log: 0 });
      if (snap !== last) { last = snap; console.log(`\n──── ${new Date().toTimeString().slice(0, 8)} ────\n${snap}`); }
      // new log lines since the last poll (the server keeps the last 30)
      const lines = s.log || [];
      let from = 0;
      if (printed.length) {
        const tail = printed[printed.length - 1];
        for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === tail) { from = i + 1; break; }
      }
      for (const x of lines.slice(from)) console.log(`  ${x}`);
      printed = lines.length ? lines : printed;
      await new Promise((r) => setTimeout(r, 1000));
    }
  },
  async shot() {
    const file = path.resolve(sub || 'shot.png');
    fs.writeFileSync(file, await call('/screenshot', 'GET', null, true));
    console.log(`Saved ${file}`);
  },
  async kyc() {
    const { kyc } = await call('/kyc');
    console.log(kyc.length ? kyc.map((k) => `${new Date(k.at).toLocaleString()}  ${k.url}`).join('\n') : 'No saved KYC links.');
  },
  async config() {
    const patch = {};
    if (v.site) patch.site = v.site;
    if (v.once) patch.continuous = false;
    if (v.continuous) patch.continuous = true;
    if (v.phone) patch.loginPhone = v.phone;
    if (v.pin) patch.loginPin = v.pin;
    if (v['sms-url']) patch.smsUrl = v['sms-url'];
    const s = Object.keys(patch).length ? await call('/config', 'PUT', patch) : await call('/status');
    console.log(JSON.stringify(s.config, null, 2));
  },
  async session() {
    if (sub !== 'import' || !arg) die('session import <state.json>');
    const state = JSON.parse(fs.readFileSync(arg, 'utf8'));
    const r = await call('/session', 'PUT', { cookies: state.cookies, origins: state.origins || [] });
    console.log(`Imported ${r.cookies} cookies (${r.dropped} other-domain cookies dropped)${r.restarted ? '; server browser restarted' : ''}.`);
  },
  async login() {
    await new Promise((r) => spawn(process.execPath, [SERVER_BIN, 'login', ...(v.headed ? ['--headed'] : [])], { stdio: 'inherit' }).on('exit', r));
  },
};
if (!run[cmd]) { console.log(HELP); process.exit(1); }
await run[cmd]();
