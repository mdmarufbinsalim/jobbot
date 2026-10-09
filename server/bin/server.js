#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import crypto from 'node:crypto';
import readline from 'node:readline';
import { DEFAULT_STATE } from '../src/browser.js';
import { createRuntime } from '../src/runtime.js';
import { startServer } from '../src/server.js';

const HELP = `jobbot-server <command> [options]

Commands
  run      Run the hiring flow in a local browser (reuses the saved session)
  login    Log in once and save the session
  serve    Run the bot behind an HTTP API so the extension or the jobbot CLI can control it, locally or from a server

Typical use:  npm run login  (once)  then  npm run serve  — then drive it with the extension (Remote) or the jobbot CLI (../cli)

Options
  --site ca|com          Amazon hiring site (default ca)
  --headed               Show the browser window (everything is headless by default)
  --state <file>         Saved session (default ~/.config/jobbot/state.json)
  --once                 Stop after the first saved KYC link (default: start over)
  --shots <dir>          Save screenshots on every step change, captcha, stuck and KYC (run/login default ./shots)
  --no-shots             Do not save screenshots
  --out <dir>            Where KYC links are written (default ./out)
  --captcha-solver <js>  Module with a default export { solve({ driver, dom, screenshot, log }) } returning true when solved
  --no-interactive       Do not read keyboard commands

serve only
  --host <addr>          Interface to listen on (default 127.0.0.1; 0.0.0.0 to accept remote connections)
  --port <n>             Port (default 8787)
  --token <secret>       API token (default: JOBBOT_TOKEN, or generated once and kept in ~/.config/jobbot/token)

Keyboard while running (run/login):  p pause · r resume · s screenshot · n restart · q quit

Account details: JOBBOT_PHONE, JOBBOT_PIN, JOBBOT_SMS_URL, config.local.json, or pushed from the extension's Settings.
`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string' }, headless: { type: 'boolean', default: false }, // --headless kept as a no-op
    headed: { type: 'boolean', default: false }, once: { type: 'boolean', default: false },
    state: { type: 'string', default: DEFAULT_STATE }, shots: { type: 'string' }, 'no-shots': { type: 'boolean', default: false },
    out: { type: 'string', default: 'out' }, 'captcha-solver': { type: 'string' }, 'no-interactive': { type: 'boolean', default: false },
    host: { type: 'string', default: '127.0.0.1' }, port: { type: 'string', default: '8787' }, token: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const cmd = positionals[0] || 'run';
if (v.help || !['run', 'login', 'serve'].includes(cmd)) { console.log(HELP); process.exit(v.help ? 0 : 1); }
if (v.site && !['ca', 'com'].includes(v.site)) { console.error('--site must be ca or com'); process.exit(1); }

let solver = null;
if (v['captcha-solver']) solver = (await import(new URL(v['captcha-solver'], `file://${process.cwd()}/`).href)).default;

const overrides = {};
if (v.site) overrides.site = v.site;
if (v.once) overrides.continuous = false;
const wantShots = cmd !== 'serve' && !v['no-shots'] || !!v.shots;
const runtime = createRuntime({
  headed: v.headed, state: path.resolve(v.state), loginOnly: cmd === 'login', solver, overrides,
  shots: wantShots && !v['no-shots'] ? path.resolve(v.shots || 'shots') : null, out: path.resolve(v.out),
});
const { controller, say } = runtime;

if (cmd === 'serve') {
  const tokenFile = path.join(os.homedir(), '.config/jobbot/token');
  let token = v.token || process.env.JOBBOT_TOKEN, fresh = false;
  if (!token) {
    try { token = fs.readFileSync(tokenFile, 'utf8').trim(); } catch {}
    if (!token) {
      token = crypto.randomBytes(24).toString('hex'); fresh = true;
      fs.mkdirSync(path.dirname(tokenFile), { recursive: true });
      fs.writeFileSync(tokenFile, token, { mode: 0o600 });
    }
  }
  const port = Number(v.port);
  await startServer({ runtime, token, host: v.host, port, say });
  say(`API listening on http://${v.host}:${port} (browser: ${v.headed ? 'headed' : 'headless'})`);
  // never print a token that already exists (service logs end up in journald); a brand-new one is shown once
  say(fresh ? `token (new, saved to ${tokenFile}): ${token}` : 'token: configured (JOBBOT_TOKEN / --token / ~/.config/jobbot/token)');
  if (v.host !== '127.0.0.1' && v.host !== 'localhost') say('warning: this is plain HTTP; put it behind TLS or an SSH tunnel before exposing it');
  say('waiting for Start from the extension (or: curl -X POST -H "Authorization: Bearer <token>" http://host:port/start)');
  const quit = async () => { await controller.stop(); process.exit(0); };
  process.on('SIGINT', quit); process.on('SIGTERM', quit);
} else {
  const quit = async () => { await controller.stop(); process.exit(0); };
  process.on('SIGINT', quit); process.on('SIGTERM', quit);
  if (!v['no-interactive'] && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', async (_, k) => {
      if (k.ctrl && k.name === 'c') return quit();
      if (k.name === 'p') controller.pause();
      if (k.name === 'r') controller.resume();
      if (k.name === 's') {
        const d = await controller.screenshot();
        if (!d) return say('no screenshot available yet');
        const dir = path.resolve(v.shots || 'shots');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${new Date().toISOString().replace(/[:.]/g, '-')}-manual.png`);
        fs.writeFileSync(file, Buffer.from(d.split(',')[1], 'base64'));
        say(`screenshot saved: ${file}`);
      }
      if (k.name === 'n') controller.restart();
      if (k.name === 'q') quit();
    });
  }
  say(`${cmd} on hiring.amazon.${runtime.settings.get().site} (${v.headed ? 'headed' : 'headless'})`);
  await controller.start();
  // run until the bot ends (login done, --once finished, tab closed)
  await new Promise((resolve) => { const t = setInterval(() => { if (!controller.running) { clearInterval(t); resolve(); } }, 500); });
  process.exit(0);
}
