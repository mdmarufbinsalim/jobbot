// Input handling: turns confirmed normalized selections into clicks in the driver's viewport, then presses the
// challenge's confirm button. Knows nothing about who chose the tiles.
import { pageFn } from '../dom.js';
import { probe } from './capture.js';
import { toViewport } from './geometry.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Real mouse when the driver has one (Playwright, chrome.debugger); otherwise synthetic events from inside the page.
async function click(driver, pt) {
  if (typeof driver.click === 'function') {
    try { await driver.click(pt.x, pt.y); return; } catch { /* fall through to the in-page click */ }
  }
  if (!(await driver.evaluate(pageFn, { op: 'clickAt', arg: pt }))) throw new Error('nothing to click at that point');
}

// selections: [{ tile, x, y }] normalized, in the order chosen. -> { clicked, confirmed }
// `viewport` is the one recorded at capture time; if the page was resized since, the caller should re-capture instead.
export async function submit(driver, selections, { viewport, confirm, gapMs = 180 } = {}) {
  const now = (await probe(driver))?.viewport;
  if (!now) throw new Error('page is not answering');
  if (viewport && (now.width !== viewport.width || now.height !== viewport.height)) throw new Error('the window was resized since the capture; capture again');
  for (const s of selections) { await click(driver, toViewport(s, now)); await sleep(gapMs); }
  let confirmed = false;
  const target = (await probe(driver))?.confirm || confirm; // the button may only appear after the tiles are picked
  if (target) { await click(driver, toViewport(target, now)); confirmed = true; }
  return { clicked: selections.length, confirmed };
}
