#!/usr/bin/env node
import { parseArgs } from 'node:util';
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DEFAULT_STATE } from '../src/browser.js';
import { createRuntime } from '../src/runtime.js';
import { startServer } from '../src/server.js';
import { checkSolver } from '../../extension/core/solver.js';

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
  --captcha-solver <js>  Use another solver module instead of extension/core/solver.js (default export { solve({ driver, dom, screenshot, log }) })
  --no-interactive       Do not read keyboard commands

serve only
  --port <n>              Port (default 8787). Always listens on 127.0.0.1; use an SSH tunnel to reach it from elsewhere

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
    port: { type: 'string', default: '8787' },
    help: { type: 'boolean', short: 'h', default: false },
  },
});
const HOST = '127.0.0.1'; // localhost only: there is no token
const cmd = positionals[0] || 'run';
if (v.help || !['run', 'login', 'serve'].includes(cmd)) { console.log(HELP); process.exit(v.help ? 0 : 1); }
if (v.site && !['ca', 'com'].includes(v.site)) { console.error('--site must be ca or com'); process.exit(1); }

// The solver is always connected: --captcha-solver if given, else the free Gemini solver (key from GEMINI_API_KEY, or the
// temporary hard-coded one in gemini-solver.js). It hands over to the manual side-panel solver when Gemini fails.
const solverFile = v['captcha-solver'] ? path.resolve(v['captcha-solver'])
  : fileURLToPath(new URL('../src/gemini-solver.js', import.meta.url));
const solver = checkSolver((await import(pathToFileURL(solverFile).href)).default, solverFile);
console.log(`captcha solver: ${solver.name || 'unnamed'} (${solverFile})`);

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
  const port = Number(v.port);
  await startServer({ runtime, host: HOST, port, say });
  say(`API listening on http://${HOST}:${port} (browser: ${v.headed ? 'headed' : 'headless'}); no token, localhost only`);
  say('waiting for Start from the extension (or: curl -X POST http://host:port/start)');
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
