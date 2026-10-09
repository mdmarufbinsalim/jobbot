#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import readline from 'node:readline';
import { loadConfig } from '../src/config.js';
import { open, DEFAULT_STATE } from '../src/browser.js';
import { Bot } from '../src/bot.js';
import { loadSolver } from '../src/captcha.js';

const HELP = `jobbot <command> [options]

Commands
  login    Log in once and save the session
  run      Run the hiring flow (search → job → application → login → KYC link), reusing the saved session

Typical use:  npm run login   (once)   then   npm start   (reuses the saved session; logs in itself if it expires)

Options (run)
  --site ca|com          Amazon hiring site (default ca)
  --headless             Hide the browser window (Amazon currently blocks headless browsers with a CloudFront 403)
  --state <file>         Saved session (default ~/.config/jobbot/state.json)
  --once                 Stop after the first saved KYC link (default: start over)
  --shots <dir>          Screenshots on every step change, captcha, stuck and KYC (default ./shots)
  --no-shots             Do not save screenshots
  --out <dir>            Where KYC links are written (default ./out)
  --captcha-solver <js>  Module with a default export { solve({ page, screenshot, log }) }
  --no-interactive       Do not read keyboard commands

Keyboard while running:  p pause · r resume/retry · s screenshot · n restart · q quit

Account details: JOBBOT_PHONE, JOBBOT_PIN, JOBBOT_SMS_URL, or config.local.json / ~/.config/jobbot/config.json
`;

const { values: v, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    site: { type: 'string', default: 'ca' }, headed: { type: 'boolean', default: true }, headless: { type: 'boolean', default: false }, state: { type: 'string', default: DEFAULT_STATE }, once: { type: 'boolean', default: false },
    shots: { type: 'string', default: 'shots' }, 'no-shots': { type: 'boolean', default: false }, out: { type: 'string', default: 'out' }, 
    'captcha-solver': { type: 'string' },
    'no-interactive': { type: 'boolean', default: false },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const cmd = positionals[0] || 'run';
const stamp = () => new Date().toTimeString().slice(0, 8);
const log = (m) => console.log(`${stamp()} ${m}`);

if (v.help || !['run', 'login'].includes(cmd)) { console.log(HELP); process.exit(v.help ? 0 : 1); }
if (!['ca', 'com'].includes(v.site)) { console.error('--site must be ca or com'); process.exit(1); }

{
  const opts = {
    site: v.site, headed: !v.headless,state: path.resolve(v.state), loginOnly: cmd === 'login', continuous: !v.once, shots: v['no-shots'] ? null : path.resolve(v.shots), out: path.resolve(v.out),
    solver: await loadSolver(v['captcha-solver']),
  };
  const browser = await open(opts);
  opts.saveState = async () => { await browser.save(); log(`session saved to ${opts.state}`); };
  if (cmd === 'run' && !browser.hasState) log('no saved session yet; run `npm run login` first for a headless run (continuing, it will log in itself)');
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
  log(`running on hiring.amazon.${opts.site} (${opts.headed ? 'headed' : 'headless'})`);
  await bot.run();
  if (cmd === 'run') await browser.save().catch(() => {}); // keep the session fresh for the next run
  await browser.close().catch(() => {});
  process.exit(0);
}
