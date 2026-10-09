// The manual tile-challenge solver. Orchestrates the separate modules and nothing else:
//   capture.js   screenshot + page facts          verify.js   what happened to the page afterwards
//   geometry.js  coordinates                       hub.js      the link to the person's interface
//   selection.js validating what came back         input.js    clicks + confirm
// It holds the bot (solve() simply does not return) until the challenge is accepted, a person gives up, or the bot
// cancels it (ctx.signal: Resume / Stop). Returning true resumes the bot at once.
//
// Logs state changes, counts and timings only. Tile coordinates and images are never logged; the image lives in the hub
// for as long as the challenge does.
import { capture, probe } from './capture.js';
import { makeGrid } from './geometry.js';
import { validateSelections } from './selection.js';
import { submit } from './input.js';
import { verify } from './verify.js';
import { hub } from './hub.js';

const meta = (cap, grid) => ({
  image: cap.image, imageSize: cap.imageSize, viewport: cap.viewport, grid,
  prompt: cap.page.prompt || '', view: cap.page.view || { x: 0, y: 0, w: 1, h: 1 },
  hasConfirm: !!cap.page.confirm, aspectOk: cap.aspectOk, capturedAt: cap.at,
});

export async function solveManually({ driver, log, signal, kind }) {
  if (kind === 'human-check') { // Begin was just pressed: wait for the tiles to load, then it is the same challenge
    const until = Date.now() + 20000;
    while (!signal?.aborted && Date.now() < until && !(await probe(driver).catch(() => null))?.region) await new Promise((r) => setTimeout(r, 500));
    if (signal?.aborted) return false;
  }
  const t0 = Date.now(), since = () => `${((Date.now() - t0) / 1000).toFixed(1)}s`;
  let cap = await capture(driver);
  let grid = makeGrid({ region: cap.page.region || undefined });
  const id = hub.open(meta(cap, grid));
  log(`captcha: challenge captured, waiting for a person (grid ${grid.rows}x${grid.cols})`);
  let attempts = 0;
  try {
    for (;;) {
      const answer = await hub.wait(id, signal);
      if (answer.action === 'giveup') { log(`captcha: left to a person after ${attempts} attempt(s), ${since()}`); hub.finish('closed', 'Left for you to solve on the page.'); return false; }

      try {
        if (answer.action === 'submit') {
          grid = makeGrid({ rows: answer.grid?.rows ?? grid.rows, cols: answer.grid?.cols ?? grid.cols, region: grid.region });
          const picks = validateSelections(answer.selections, grid);
          attempts++;
          hub.update({ status: 'working', message: `Clicking ${picks.length} tile(s)…` });
          log(`captcha: attempt ${attempts}, ${picks.length} tile(s) selected`);
          const sent = await submit(driver, picks, { viewport: cap.viewport, confirm: cap.page.confirm });
          log(`captcha: clicked ${sent.clicked}, confirm ${sent.confirmed ? 'pressed' : 'not found'}`);
          hub.update({ message: 'Checking the result…' });
          const result = await verify(driver, cap.page);
          log(`captcha: ${result} (${since()})`);
          if (result === 'accepted') { hub.finish('solved', 'Solved. Resuming the bot.', null); return true; }
          cap = await capture(driver).catch(() => null);
          if (!cap) { log(`captcha: gone after ${result} (${since()})`); hub.finish('solved', 'Solved. Resuming the bot.', null); return true; }
          grid = makeGrid({ rows: grid.rows, cols: grid.cols, region: cap.page.region || grid.region });
          hub.update({ ...meta(cap, grid), status: 'awaiting', attempt: attempts + 1, lastResult: result,
            message: { rejected: 'Rejected. Try again.', expired: 'Expired. A new image is showing.', replaced: 'A different challenge appeared.', unresolved: 'No change on the page. Check it, then try again.' }[result] });
        } else if (answer.action === 'refresh') { // look again
          cap = await capture(driver);
          grid = makeGrid({ rows: grid.rows, cols: grid.cols, region: cap.page.region || grid.region });
          hub.update({ ...meta(cap, grid), status: 'awaiting', message: 'Refreshed.' });
          log('captcha: re-captured on request');
        } else throw new Error(`unknown action ${answer.action}`);
      } catch (e) {
        if (signal?.aborted) break;
        log(`captcha: error: ${String(e.message).split('\n')[0]}`);
        if (/no tile challenge/.test(e.message)) { hub.finish('solved', 'Solved. Resuming the bot.', null); return true; }
        hub.update({ status: 'awaiting', message: `Error: ${e.message}` }); // stay paused; the person can retry or give up
      }
    }
  } finally {
    if (hub.view()?.id === id && hub.view().status !== 'solved') hub.finish('closed', 'Cancelled.');
  }
  return false;
}
