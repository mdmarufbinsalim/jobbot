#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import readline from 'node:readline';
import { chromium } from 'playwright';
import { loadConfig } from '../src/config.js';
import { open } from '../src/browser.js';
import { Bot } from '../src/bot.js';
import { loadSolver } from '../src/captcha.js';

const HELP = `jobbot <command> [options]

Commands
  run      Run the hiring flow (search → job → application → login → KYC link)
  serve    Start a Playwright server so a CLI elsewhere can use this machine's browser (--ws)

Options (run)
  --site ca|com          Amazon hiring site (default ca)
  --headed               Show the browser window (default headless)
  --once                 Stop after the first saved KYC link (default: start over)
  --shots <dir>          Save screenshots on every step change, captcha, stuck and KYC
  --out <dir>            Where KYC links are written (default ./out)
  --profile <dir>        Browser profile (keeps cookies); default ~/.config/jobbot/profile
  --ws <url>             Use a remote Playwright server (see \`serve\`)
  --cdp <url>            Use a remote Chrome started with --remote-debugging-port
  --captcha-solver <js>  Module with a default export { solve({ page, screenshot, log }) }
  --no-interactive       Do not read keyboard commands

Keyboard while running:  p pause · r resume/retry · s screenshot · n restart · q quit

Account details: JOBBOT_PHONE, JOBBOT_PIN, JOBBOT_SMS_URL, or config.local.json / ~/.config/jobbot/config.json

Options (serve)
  --port <n>  --host <addr>  --headed
`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string', default: 'ca' }, headed: { type: 'boolean', default: false }, once: { type: 'boolean', default: false },
    shots: { type: 'string' }, out: { type: 'string', default: 'out' }, profile: { type: 'string' },
    ws: { type: 'string' }, cdp: { type: 'string' }, 'captcha-solver': { type: 'string' },
    'no-interactive': { type: 'boolean', default: false }, port: { type: 'string', default: '9222' }, host: { type: 'string', default: '127.0.0.1' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const cmd = positionals[0];
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`${stamp()} ${m}`);

if (v.help || !['run', 'serve'].includes(cmd)) { console.log(HELP); process.exit(v.help ? 0 : 1); }
if (!['ca', 'com'].includes(v.site)) { console.error('--site must be ca or com'); process.exit(1); }

if (cmd === 'serve') {
  const server = await chromium.launchServer({ headless: !v.headed, host: v.host, port: Number(v.port), args: ['--disable-blink-features=AutomationControlled'] });
  console.log(`Playwright server: ${server.wsEndpoint()}`);
  console.log('Use it with: jobbot run --ws <that url>');
  process.on('SIGINT', () => server.close().then(() => process.exit(0)));
} else {
  const opts = {
    site: v.site, headed: v.headed, continuous: !v.once, shots: v.shots && path.resolve(v.shots), out: path.resolve(v.out),
    profile: v.profile, ws: v.ws, cdp: v.cdp, solver: await loadSolver(v['captcha-solver']),
  };
  const browser = await open(opts);
  const bot = new Bot({ context: browser.context, page: browser.page, cfg: loadConfig(), opts, log });

  const quit = async () => { bot.stop(); };
  process.on('SIGINT', quit); process.on('SIGTERM', quit);

  if (!v['no-interactive'] && process.stdin.isTTY) {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);
    process.stdin.on('keypress', (_, k) => {
      if (k.ctrl && k.name === 'c') return quit();
      if (k.name === 'p') bot.pause();
      if (k.name === 'r') bot.resume();
      if (k.name === 's') bot.shot('manual').then((f) => { if (!f && !opts.shots) log('pass --shots <dir> to save screenshots'); });
      if (k.name === 'n') bot.restart();
      if (k.name === 'q') quit();
    });
  }
  if (!opts.shots) log('tip: pass --shots <dir> to save screenshots');
  log(`running on hiring.amazon.${opts.site} (${opts.ws ? 'remote ws' : opts.cdp ? 'remote cdp' : opts.headed ? 'headed' : 'headless'})`);
  await bot.run();
  await browser.close().catch(() => {});
  process.exit(0);
}
