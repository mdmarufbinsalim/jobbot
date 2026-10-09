// The captcha solver, shared by the server (loaded by default, see server/bin/server.js) and the extension's local mode
// (background.js). Both hand it the same arguments, so the contract is defined here once.
//
// Contract: a module whose default export is { name: string, solve(ctx) }.
//   ctx.driver       the working page: url(), evaluate(fn, arg), goto(url), reload(), screenshot()
//   ctx.dom(op, arg) the shared in-page helpers in core/dom.js
//   ctx.screenshot() asks the host to save a screenshot (returns the image only when the host saves them)
//   ctx.log(text)    writes a log line (terminal / server log / extension service worker console)
// solve() returns true when the check is solved (the bot carries on at once). Anything else, or a throw, keeps the bot
// holding until a person solves it and presses Resume.
//
// This version solves nothing: it only records that a check appeared and leaves it to a person.
export default {
  name: 'solver',
  async solve({ driver, log }) {
    log(`solver: a check is showing on ${driver.url()}; leaving it to a person`);
    return false;
  },
};

// Hosts call this on whatever module they load, so a malformed solver fails with a clear message instead of mid-run.
export function checkSolver(mod, source = 'solver') {
  if (!mod || typeof mod.solve !== 'function') throw new Error(`${source}: default export must be { name, solve(ctx) }`);
  return mod;
}
