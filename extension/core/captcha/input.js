// Input handling: turns confirmed normalized selections into clicks in the driver's viewport, then presses the
// challenge's confirm button. Knows nothing about who chose the tiles.
import { pageFn } from '../dom.js';
import { probe } from './capture.js';
import { toViewport } from './geometry.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real mouse when the driver has one (Playwright); otherwise synthetic events from inside the page.
// -> 'mouse' | 'page'. The captcha only trusts a real mouse, so a fall back to 'page' is reported to the caller.
async function click(driver, pt, log) {
  if (typeof driver.click === 'function') {
    try { await driver.click(pt.x, pt.y); return 'mouse'; } catch (e) { log?.(`captcha: real mouse click unavailable (${String(e.message).split('\n')[0]}); clicking from the page instead`); }
  }
  if (!(await driver.evaluate(pageFn, { op: 'clickAt', arg: pt }))) throw new Error('nothing to click at that point');
  return 'page';
}

// selections: [{ tile, x, y }] normalized, in the order chosen. -> { clicked, confirmed, via }
// `viewport` is the one recorded at capture time; if the page was resized since, the caller should re-capture instead.
export async function submit(driver, selections, { viewport, confirm, gapMs = 180, log } = {}) {
  const now = (await probe(driver))?.viewport;
  if (!now) throw new Error('page is not answering');
  if (viewport && (now.width !== viewport.width || now.height !== viewport.height)) throw new Error('the window was resized since the capture; capture again');
  let via = 'mouse';
  for (const s of selections) { if ((await click(driver, toViewport(s, now), log)) === 'page') via = 'page'; await sleep(gapMs); }
  await sleep(250);
  let confirmed = false;
  const target = (await probe(driver))?.confirm || confirm; // the button may only appear after the tiles are picked
  if (target) {
    const how = await click(driver, toViewport(target, now), log);
    if (how === 'page') via = 'page';
    confirmed = true;
    // no real mouse: pressing the button by element is more dependable than a synthetic click on its coordinates
    if (how === 'page') confirmed = !!(await driver.evaluate(pageFn, { op: 'clickConfirm' }).catch(() => false)) || confirmed;
  } else confirmed = !!(await driver.evaluate(pageFn, { op: 'clickConfirm' }).catch(() => false));
  return { clicked: selections.length, confirmed, via };
}
