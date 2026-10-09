// Everything that runs INSIDE a page. A single self-contained function, so any driver can ship it to a page the same way
// (Playwright page.evaluate, chrome.scripting.executeScript). Call it through Bot.dom(op, arg).
export const BUTTONS = ['^apply for other jobs$', '^create (an )?application$', '^start identity verification$', '^i agree$', '^continue$', '^next$'];

export function pageFn({ op, arg }) {
  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const textOf = (b) => (b.textContent || b.value || '').replace(/\s+/g, ' ').trim();
  const labelOf = (i) => [i.getAttribute('aria-label'), i.placeholder, i.name, i.id, ...[...(i.labels || [])].map((l) => l.textContent)].join(' ');
  const CODE = /\b(code|otp|verification)\b/i, PIN = /\b(pin|passcode|password)\b/i;
  const buttons = () => [...document.querySelectorAll('button, input[type=submit], [role=button]')].filter(visible);
  const smsRadios = () => [...document.querySelectorAll('input[type=radio]')]
    .map((r) => ({ r, box: r.closest('label') || r.parentElement?.parentElement || r.parentElement }))
    .filter((x) => x.box && /^\s*send verification code to/i.test(x.box.textContent));
  const phoneField = (inputs) => inputs.find((i) => ['text', 'email', 'tel'].includes(i.type) && !PIN.test(labelOf(i)) && !CODE.test(labelOf(i)));
  const pinField = (inputs) => inputs.find((i) => i.type === 'password') || inputs.find((i) => PIN.test(labelOf(i)));
  const codeField = (inputs) => inputs.find((i) => CODE.test(labelOf(i)));

  const ops = {
    // The page always has an empty .captcha-modal (computed display: block, 0x0); a real captcha sets an inline
    // display: block or takes up space.
    captchaVisible: () => [...document.querySelectorAll('.captcha-modal')].some((e) =>
      e.style.display === 'block' || (getComputedStyle(e).display === 'block' && e.offsetWidth > 0 && e.offsetHeight > 0)),

    // --- search page ---
    clickAllTab: () => {
      const all = [...document.querySelectorAll('button, [role=button], [role=tab], a, label, span, div')]
        .find((b) => visible(b) && !b.children.length && /^all$/i.test(textOf(b)));
      if (all) all.click();
      return !!all;
    },
    clearLocation: () => {
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
    },

    // --- application pages: tick boxes, answer the referral question, report the button to press next ---
    appInspect: (patterns) => {
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
      const list = buttons();
      for (const p of patterns) {
        const b = list.find((x) => new RegExp(p, 'i').test(textOf(x)));
        if (b) return { ticked, answered, button: { text: textOf(b), disabled: b.disabled || b.getAttribute('aria-disabled') === 'true' } };
      }
      return { ticked, answered, button: null };
    },
    clickButton: (text) => {
      const b = buttons().find((x) => textOf(x) === text);
      if (b) b.click();
      return !!b;
    },

    // --- login (auth.hiring.*) ---
    loginInspect: () => {
      const inputs = [...document.querySelectorAll('input')].filter(visible);
      return {
        code: !!codeField(inputs), sms: smsRadios().length > 0, pin: !!pinField(inputs), phone: !!phoneField(inputs),
        codeValue: codeField(inputs)?.value || '', pinValue: pinField(inputs)?.value || '', phoneValue: phoneField(inputs)?.value || '',
      };
    },
    // Works with React-controlled inputs: native setter, then the events the framework listens for.
    loginFill: ({ kind, value }) => {
      const inputs = [...document.querySelectorAll('input')].filter(visible);
      const input = kind === 'pin' ? pinField(inputs) : kind === 'code' ? codeField(inputs) : phoneField(inputs);
      if (!input) return false;
      input.focus();
      Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set.call(input, value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    },
    chooseSms: () => {
      const o = smsRadios()[0];
      if (!o) return false;
      if (!o.r.checked) o.box.click();
      return true;
    },
    pressLoginButton: () => {
      const b = buttons().find((x) => /^(continue|next|sign in|log in|login|submit|verify|send verification code)$/i.test((x.textContent || x.value || '').trim()) && !x.disabled);
      if (b) b.click();
      return !!b;
    },

    // --- SMS inbox (temp-number.com): the newest code that arrived after `requestedAt` ---
    scanSms: ({ requestedAt, now }) => {
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
    },

    // --- misc ---
    copy: async (text) => {
      try { await navigator.clipboard.writeText(text); return true; } catch {}
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    },
    localStorage: () => Object.entries(localStorage).map(([name, value]) => ({ name, value })),
  };
  return ops[op](arg);
}
