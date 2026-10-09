// Result verification: classify the page after a submission. Reads page state only; never clicks.
import { probe } from './capture.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Pure part, so it can be tested without a page. `before` is the page record from capture, `after` a fresh probe.
//   accepted    the challenge is gone
//   expired     the page says it timed out
//   rejected    the page says the answer was wrong
//   replaced    a different challenge is showing
//   unresolved  still the same challenge and nothing was said
export function classify(before, after) {
  if (!after?.visible || after.solved) return 'accepted';
  if (after.expired) return 'expired';
  if (after.error) return 'rejected';
  if (before?.fingerprint && after.fingerprint !== before.fingerprint) return 'replaced';
  return 'unresolved';
}

// Polls until the page settles on something other than 'unresolved', or the wait runs out.
export async function verify(driver, before, { waitMs = 5000, stepMs = 400 } = {}) {
  const end = Date.now() + waitMs;
  let result = 'unresolved';
  do {
    await sleep(stepMs);
    let after;
    try { after = await probe(driver); } catch { continue; } // mid-navigation
    result = classify(before, after);
  } while (result === 'unresolved' && Date.now() < end);
  return result;
}
