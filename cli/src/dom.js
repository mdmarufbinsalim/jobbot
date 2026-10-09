// Functions run inside the page via page.evaluate (they must stay self-contained). Ported from the extension's content scripts.

// Installed on every document before the page's own scripts: shared helpers used by the functions below.
export const INIT_SCRIPT = () => {
  window.__jb = {
    visible: (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length)),
    textOf: (b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim(),
  };
};

export const captchaVisible = () =>
  // The page always has an empty .captcha-modal (computed display: block, 0x0); a real captcha sets an inline display: block or takes up space.
  [...document.querySelectorAll('.captcha-modal')].some((e) => e.style.display === 'block' || (getComputedStyle(e).display === 'block' && e.offsetWidth > 0 && e.offsetHeight > 0));

// --- search page ---
export const clickAllTab = () => {
  const { visible, textOf } = window.__jb;
  const all = [...document.querySelectorAll('button, [role=button], [role=tab], a, label, span, div')]
    .find((b) => visible(b) && !b.children.length && /^all$/i.test(textOf(b)));
  if (all) all.click();
  return !!all;
};

export const clearLocation = () => {
  const { visible, textOf } = window.__jb;
  const inputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].filter(visible);
  const input = inputs.find((i) => /location|postal|post ?code|city|zip/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.id} ${i.name}`))
    || inputs.find((i) => !/search jobs/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`) && i.value);
  if (!input || !input.value) return false;
  input.focus();
  input.select();
  let box = input.parentElement, x = null;
  for (let i = 0; i < 4 && box && !x; i++, box = box.parentElement) {
    x = [...box.querySelectorAll('button, [role=button]')].find((b) => visible(b) && /clear|close|remove|reset/i.test(`${b.getAttribute('aria-label') || ''} ${b.title} ${textOf(b)}`));
  }
  if (x) x.click();
  if (input.value) {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, '');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  return true;
};

// --- application pages ---
const BUTTONS = ['^apply for other jobs$', '^create (an )?application$', '^start identity verification$', '^i agree$', '^continue$', '^next$'];

// Ticks checkboxes, answers the referral question, and reports the button that should be pressed next.
export const appInspect = (patterns) => {
  const { visible, textOf } = window.__jb;
  let ticked = 0, answered = false;
  for (const c of document.querySelectorAll('input[type=checkbox]')) {
    if (c.checked || c.disabled) continue;
    const target = visible(c) ? c : (c.closest('label') || c.parentElement);
    if (!target) continue;
    target.click();
    if (!c.checked) c.click();
    ticked++;
  }
  for (const c of document.querySelectorAll('[role=checkbox][aria-checked=false]')) {
    if (visible(c) && c.getAttribute('aria-disabled') !== 'true') { c.click(); ticked++; }
  }
  for (const r of document.querySelectorAll('input[type=radio]')) {
    if (r.checked || r.disabled) continue;
    const label = r.closest('label') || r.parentElement;
    if (!/^no$/i.test(textOf(label || r))) continue;
    let box = r, hit = false;
    for (let i = 0; i < 5 && box; i++, box = box.parentElement) if (/referred by an amazonian/i.test(box.textContent)) { hit = true; break; }
    if (!hit) continue;
    (visible(r) ? r : label).click();
    if (!r.checked) r.click();
    answered = true;
    break;
  }
  const list = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible);
  for (const p of patterns) {
    const b = list.find((x) => new RegExp(p, 'i').test(textOf(x)));
    if (b) return { ticked, answered, button: { text: textOf(b), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' } };
  }
  return { ticked, answered, button: null };
};

export const clickButton = (text) => {
  const { visible, textOf } = window.__jb;
  const b = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible).find((x) => textOf(x) === text);
  if (b) b.click();
  return !!b;
};
export { BUTTONS };

// --- login (auth.hiring.*) ---
export const loginInspect = () => {
  const { visible } = window.__jb;
  const labelOf = (i) => [i.getAttribute('aria-label'), i.placeholder, i.name, i.id, ...[...(i.labels || [])].map((l) => l.textContent)].join(' ');
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const CODE = /\b(code|otp|verification)\b/i, PIN = /\b(pin|passcode|password)\b/i;
  let sms = false;
  for (const r of document.querySelectorAll('input[type=radio]')) {
    const box = r.closest('label') || r.parentElement?.parentElement || r.parentElement;
    if (box && /^\s*send verification code to/i.test(box.textContent)) sms = true;
  }
  return {
    code: inputs.some((i) => CODE.test(labelOf(i))),
    sms,
    pin: inputs.some((i) => i.type === 'password' || PIN.test(labelOf(i))),
    phone: inputs.some((i) => ['text', 'email', 'tel'].includes(i.type) && !PIN.test(labelOf(i)) && !CODE.test(labelOf(i))),
    codeValue: inputs.find((i) => CODE.test(labelOf(i)))?.value || '',
    pinValue: inputs.find((i) => i.type === 'password' || PIN.test(labelOf(i)))?.value || '',
    phoneValue: inputs.find((i) => ['text', 'email', 'tel'].includes(i.type) && !PIN.test(labelOf(i)) && !CODE.test(labelOf(i)))?.value || '',
  };
};

// Fills a React-controlled input with the native setter, then fires the events the framework listens for.
export const loginFill = ({ kind, value }) => {
  const { visible } = window.__jb;
  const labelOf = (i) => [i.getAttribute('aria-label'), i.placeholder, i.name, i.id, ...[...(i.labels || [])].map((l) => l.textContent)].join(' ');
  const inputs = [...document.querySelectorAll('input')].filter(visible);
  const CODE = /\b(code|otp|verification)\b/i, PIN = /\b(pin|passcode|password)\b/i;
  const input = kind === 'pin' ? inputs.find((i) => i.type === 'password') || inputs.find((i) => PIN.test(labelOf(i)))
    : kind === 'code' ? inputs.find((i) => CODE.test(labelOf(i)))
    : inputs.find((i) => ['text', 'email', 'tel'].includes(i.type) && !PIN.test(labelOf(i)) && !CODE.test(labelOf(i)));
  if (!input) return false;
  input.focus();
  Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
};

export const chooseSms = () => {
  for (const r of document.querySelectorAll('input[type=radio]')) {
    const box = r.closest('label') || r.parentElement?.parentElement || r.parentElement;
    if (box && /^\s*send verification code to/i.test(box.textContent)) { if (!r.checked) (box || r).click(); return true; }
  }
  return false;
};

export const pressLoginButton = () => {
  const { visible } = window.__jb;
  const LOGIN_BUTTON = /^(continue|next|sign in|log in|login|submit|verify|send verification code)$/i;
  const b = [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible)
    .find((x) => LOGIN_BUTTON.test((x.textContent || x.value || '').trim()) && !x.disabled);
  if (b) b.click();
  return !!b;
};

// --- SMS inbox (temp-number.com) ---
export const scanSms = ({ requestedAt, now }) => {
  const UNIT = { second: 1, minute: 60, hour: 3600, day: 86400 };
  const text = document.body.innerText;
  const elapsed = (now - requestedAt) / 1000 + 15;
  let best = null, m;
  const re = /Your Amazon Jobs verification code is:?\s*(\d{4,8})/gi;
  while ((m = re.exec(text))) {
    const before = text.slice(Math.max(0, m.index - 150), m.index);
    const ages = [...before.matchAll(/(\d+|a|an)\s*(second|minute|hour|day)s?\s+ago/gi)];
    const last = ages[ages.length - 1];
    if (!last) continue;
    const n = /^\d+$/.test(last[1]) ? Number(last[1]) : 1;
    const age = n * UNIT[last[2].toLowerCase()];
    if (age <= 180 && age <= elapsed && (!best || age < best.age)) best = { code: m[1], age };
  }
  return best;
};
