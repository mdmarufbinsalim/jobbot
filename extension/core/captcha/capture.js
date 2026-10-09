// Challenge capture: one screenshot plus the page facts needed to map clicks back onto the page.
// Uses driver.screenshot() directly (not ctx.screenshot), so the challenge image is never written to disk by this module.
import { pageFn } from '../dom.js';
import { pngSize, sameShape } from './geometry.js';

export async function probe(driver) {
  return driver.evaluate(pageFn, { op: 'captchaProbe' });
}

// -> { image (data URL), imageSize, viewport, page: { url, fingerprint, region, confirm }, aspectOk, at }
// Throws when there is nothing to capture (no challenge on the page, or the host cannot take a screenshot right now).
export async function capture(driver) {
  const before = await probe(driver);
  if (!before?.visible || before.solved) throw new Error('no tile challenge is showing'); // gone, or already showing "That is correct"
  const image = await driver.screenshot();
  if (!image) throw new Error('no screenshot available (the tab must be visible)');
  const imageSize = pngSize(image);
  if (!imageSize) throw new Error('screenshot is not a PNG');
  const after = await probe(driver); // the page may have moved on while the screenshot was taken
  const page = after?.visible ? after : before;
  return {
    image, imageSize, viewport: page.viewport,
    page: { url: page.url, fingerprint: page.fingerprint, region: page.region, confirm: page.confirm, prompt: page.prompt, view: page.view, error: page.error, expired: page.expired },
    aspectOk: sameShape(imageSize, page.viewport),
    at: Date.now(),
  };
}
