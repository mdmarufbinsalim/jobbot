// The captcha solver, shared by the server (loaded by default, see server/bin/server.js) and the extension's local mode
// (background.js). Both hand it the same arguments, so the contract is defined here once.
//
// Contract: a module whose default export is { name: string, solve(ctx) }.
//   ctx.driver       the working page: url(), evaluate(fn, arg), goto(url), reload(), screenshot()
//   ctx.dom(op, arg) the shared in-page helpers in core/dom.js
//   ctx.screenshot() asks the host to save a screenshot (returns the image only when the host saves them)
//   ctx.log(text)    writes a log line (terminal / server log / extension service worker console)
//   ctx.signal       AbortSignal: aborted when the bot is resumed or stopped, so a long wait must end
//   ctx.kind         'captcha' (the tile challenge is showing) or 'human-check' (Begin was just pressed)
// solve() returns true when the check is solved (the bot carries on at once). Anything else, or a throw, keeps the bot
// holding until a person solves it and presses Resume.
//
// Default solver: hands the tile challenge to a person through the side panel (see core/captcha/). Nothing is solved
// automatically. Another solver can be swapped in with --captcha-solver.
import { solveManually } from './captcha/manual-solver.js';

export default {
  name: 'manual-tiles',
  solve: (ctx) => solveManually(ctx),
};

// Hosts call this on whatever module they load, so a malformed solver fails with a clear message instead of mid-run.
export function checkSolver(mod, source = 'solver') {
  if (!mod || typeof mod.solve !== 'function') throw new Error(`${source}: default export must be { name, solve(ctx) }`);
  return mod;
}
