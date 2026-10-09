import { captchaVisible } from './dom.js';

// Captcha handling is a plug-in point. A solver is a module exporting
//   export default { name: 'my-solver', async solve({ page, screenshot, log }) { ...; return true /* solved */ } }
// and is loaded with --captcha-solver ./path.js. Without one, the bot pauses and waits for you (resume with `r`,
// or it carries on by itself once the modal disappears).
export async function loadSolver(spec) {
  if (!spec) return null;
  const mod = await import(new URL(spec, `file://${process.cwd()}/`).href);
  return mod.default;
}

export const isCaptcha = (page) => page.evaluate(captchaVisible).catch(() => false);
