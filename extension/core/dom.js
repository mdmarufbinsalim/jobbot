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

    // Everything the tile-challenge modules need to know about the page, in viewport CSS pixels. Reports hashes, not the
    // challenge's own URLs or text.
    captchaProbe: () => {
      const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
      const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) };
      // the modal, or the full-page "Let's confirm you are human" once Begin has been pressed and the tiles are showing
      const begin = [...document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')].find((b) => visible(b) && /^begin\b/i.test(textOf(b)));
      const humanPage = /confirm you are human/i.test(document.body.innerText) && !begin;
      const root = [...document.querySelectorAll('.captcha-modal')].find((e) =>
        e.style.display === 'block' || (getComputedStyle(e).display === 'block' && e.offsetWidth > 0 && e.offsetHeight > 0)) || (humanPage ? document.body : null);
      const out = { visible: !!root, viewport, url: location.origin + location.pathname, region: null, confirm: null, error: false, expired: false, fingerprint: '', prompt: '', view: null };
      if (!root) return out;
      const rect = (r) => ({ x: r.left / viewport.width, y: r.top / viewport.height, w: r.width / viewport.width, h: r.height / viewport.height });
      const all = [...root.querySelectorAll('img, canvas, svg')].filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((m) => m.r.width >= 40 && m.r.height >= 40);
      // a grid of tiles = the most common image size (at least 4 of them); the region is their bounding box
      const bySize = new Map();
      for (const m of all) { const k = `${Math.round(m.r.width / 4)}x${Math.round(m.r.height / 4)}`; bySize.set(k, [...(bySize.get(k) || []), m]); }
      const tiles = [...bySize.values()].sort((a, b) => b.length - a.length)[0];
      let media = all.slice().sort((a, b) => b.r.width * b.r.height - a.r.width * a.r.height)[0];
      if (tiles && tiles.length >= 4) {
        const L = Math.min(...tiles.map((t) => t.r.left)), T = Math.min(...tiles.map((t) => t.r.top)), R = Math.max(...tiles.map((t) => t.r.right)), B = Math.max(...tiles.map((t) => t.r.bottom));
        media = { e: tiles[0].e, r: { left: L, top: T, right: R, bottom: B, width: R - L, height: B - T } };
        out.tiles = tiles.length;
      }
      if (media && media.r.left >= 0 && media.r.top >= 0 && media.r.right <= viewport.width && media.r.bottom <= viewport.height) {
        out.region = rect(media.r);
        out.fingerprint = hash(`${tiles && tiles.length >= 4 ? tiles.map((t) => t.e.currentSrc || t.e.src || '').join('|') : media.e.currentSrc || media.e.src || media.e.tagName}|${Math.round(media.r.width)}x${Math.round(media.r.height)}`);
      } else out.fingerprint = hash(`${root.querySelectorAll('img, canvas').length}|${root.offsetWidth}x${root.offsetHeight}`);
      const btn = [...root.querySelectorAll('button, input[type=submit], input[type=button], [role=button]')]
        .find((b) => visible(b) && /^(verify|submit|confirm|done|check|continue|next)\b/i.test(textOf(b)));
      if (btn) { const r = btn.getBoundingClientRect(); out.confirm = { x: (r.left + r.width / 2) / viewport.width, y: (r.top + r.height / 2) / viewport.height }; }
      // what to choose ("Choose all the clocks"), and the part of the page worth showing: prompt .. tiles .. confirm button
      const ask = [...root.querySelectorAll('p, h1, h2, h3, h4, div, span, label')].filter((e) => visible(e) && e.children.length < 4)
        .find((e) => /^(choose|select|click|pick|tap)\b.{3,100}$/i.test((e.innerText || '').trim().split('\n')[0]) && (e.innerText || '').trim().length < 120);
      if (ask) out.prompt = ask.innerText.trim().replace(/\s+/g, ' ');
      const boxes = [out.region && media.r, ask && ask.getBoundingClientRect(), btn && btn.getBoundingClientRect()].filter(Boolean);
      if (boxes.length && out.region) {
        const pad = 12, L = Math.max(0, Math.min(...boxes.map((r) => r.left)) - pad), T = Math.max(0, Math.min(...boxes.map((r) => r.top)) - pad);
        const R = Math.min(viewport.width, Math.max(...boxes.map((r) => r.right)) + pad), B = Math.min(viewport.height, Math.max(...boxes.map((r) => r.bottom)) + pad);
        out.view = { x: L / viewport.width, y: T / viewport.height, w: (R - L) / viewport.width, h: (B - T) / viewport.height };
      }
      const text = (root.innerText || '').toLowerCase();
      out.expired = /expired|timed out|time ran out|session has ended/.test(text);
      out.error = /incorrect|wrong|try again|not correct|failed|didn.t match/.test(text);
      return out;
    },

    // Fallback click for drivers without a real mouse: the element under a viewport point gets the usual event sequence.
    clickAt: ({ x, y }) => {
      const el = document.elementFromPoint(x, y);
      if (!el) return false;
      const init = { bubbles: true, cancelable: true, clientX: x, clientY: y, view: window };
      for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, init));
      return true;
    },

    // Amazon's "Let's confirm you are human" interstitial: press Begin to start the check. (Solving it is up to a person or a solver.)
    clickBegin: () => {
      const b = [...document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')]
        .find((x) => visible(x) && /^begin\b/i.test(textOf(x)));
      if (!b || !/confirm you are human/i.test(document.body.innerText)) return false;
      b.click();
      return true;
    },

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
