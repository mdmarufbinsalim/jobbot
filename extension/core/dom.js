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
  // The login page's "Select your Country" control: a native <select> (even a visually hidden or restyled one, or one inside
  // a shadow root), or a custom dropdown (the first combobox / button / readonly input after the label text).
  const deepQ = (sel, node = document) => [...node.querySelectorAll(sel), ...[...node.querySelectorAll('*')].filter((h) => h.shadowRoot).flatMap((h) => deepQ(sel, h.shadowRoot))];
  // The modal's own success text ("That is correct"), read through shadow roots. While it shows, the challenge is over.
  const SOLVED = /\bthat is correct\b|\bthat's correct\b|verification (is )?complete|\bsuccess(ful)?\b/i;
  const modalSolved = (node) => SOLVED.test([node.innerText || '', ...deepQ('*', node).filter((h) => h.shadowRoot).flatMap((h) => [...h.shadowRoot.children].filter((c) => !/^(STYLE|LINK|SCRIPT)$/.test(c.tagName)).map((c) => c.innerText || ''))].join('\n'));
  const countryControl = () => {
    const matches = (x) => /country/i.test(`${labelOf(x)} ${x.getAttribute('data-test-id') || ''} ${x.closest('label')?.textContent || ''}`);
    const sels = deepQ('select').filter(matches);
    const nat = sels.find(visible) || sels[0];
    if (nat) return { el: nat, native: true };
    const lab = deepQ('label, span, div, p, legend').filter((e) => visible(e) && /^\s*select your country\b/i.test(e.textContent || '') && (e.textContent || '').length < 60)
      .sort((x, y) => (x.textContent || '').length - (y.textContent || '').length)[0]; // the tightest element holding the label text
    if (!lab) return null;
    const ctl = lab.control || lab.querySelector?.('select, input, button');
    if (ctl && ctl.tagName === 'SELECT') return { el: ctl, native: true };
    const el = deepQ('[role=combobox], [aria-haspopup], button, input[readonly], select')
      .find((c) => visible(c) && !(c.compareDocumentPosition(lab) & Node.DOCUMENT_POSITION_FOLLOWING) && !c.contains(lab) && !/^(continue|get help)/i.test(textOf(c)));
    return el ? { el, native: el.tagName === 'SELECT' } : null;
  };
  const countryText = (c) => (c.native ? c.el.selectedOptions[0]?.textContent || '' : c.el.value || textOf(c.el)) || '';

  const ops = {
    // The page always has an empty .captcha-modal (computed display: block, 0x0); a real captcha sets an inline
    // display: block or takes up space.
    captchaVisible: () => [...document.querySelectorAll('.captcha-modal')].some((e) =>
      (e.style.display === 'block' || (getComputedStyle(e).display === 'block' && e.offsetWidth > 0 && e.offsetHeight > 0)) && !modalSolved(e)),

    // Everything the tile-challenge modules need to know about the page, in viewport CSS pixels. Reports hashes, not the
    // challenge's own URLs or text.
    captchaProbe: () => {
      const hash = (str) => { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
      const viewport = { width: innerWidth, height: innerHeight, dpr: devicePixelRatio || 1, scrollX: Math.round(scrollX), scrollY: Math.round(scrollY) };
      // The modal's challenge lives in an open shadow root (<awswaf-captcha>), which plain querySelectorAll / innerText skip.
      const deepAll = (node, sel) => { const out = [...node.querySelectorAll(sel)]; for (const h of node.querySelectorAll('*')) if (h.shadowRoot) out.push(...deepAll(h.shadowRoot, sel)); return out; };
      const deepText = (node) => [node.innerText || '', ...deepAll(node, '*').filter((h) => h.shadowRoot)
        .flatMap((h) => [...h.shadowRoot.children].filter((c) => !/^(STYLE|LINK|SCRIPT)$/.test(c.tagName)).map((c) => c.innerText || ''))].join('\n');
      // the modal, or the full-page "Let's confirm you are human" once Begin has been pressed and the tiles are showing
      const begin = [...document.querySelectorAll('button, input[type=submit], input[type=button], a, [role=button]')].find((b) => visible(b) && /^begin\b/i.test(textOf(b)));
      const humanPage = /confirm you are human/i.test(document.body.innerText) && !begin;
      const root = [...document.querySelectorAll('.captcha-modal')].find((e) =>
        e.style.display === 'block' || (getComputedStyle(e).display === 'block' && e.offsetWidth > 0 && e.offsetHeight > 0)) || (humanPage ? document.body : null);
      const out = { visible: !!root, solved: false, viewport, url: location.origin + location.pathname, region: null, confirm: null, error: false, expired: false, fingerprint: '', prompt: '', view: null };
      if (!root) return out;
      if (root !== document.body && modalSolved(root)) { out.solved = true; return out; } // "That is correct": nothing left to solve
      const rect = (r) => ({ x: r.left / viewport.width, y: r.top / viewport.height, w: r.width / viewport.width, h: r.height / viewport.height });
      const all = deepAll(root, 'img, canvas, svg').filter(visible).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((m) => m.r.width >= 40 && m.r.height >= 40);
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
        // a canvas has no src: sample its pixels so a new puzzle gives a new fingerprint
        const pix = (e) => { try { const u = e.toDataURL(); return `${u.length}:${u.slice(-300)}`; } catch { return e.tagName; } };
        const id = (e) => e.currentSrc || e.src || (e.tagName === 'CANVAS' ? pix(e) : e.tagName);
        out.fingerprint = hash(`${tiles && tiles.length >= 4 ? tiles.map((t) => id(t.e)).join('|') : id(media.e)}|${Math.round(media.r.width)}x${Math.round(media.r.height)}`);
      } else out.fingerprint = hash(`${root.querySelectorAll('img, canvas').length}|${root.offsetWidth}x${root.offsetHeight}`);
      const btn = deepAll(root, 'button, input[type=submit], input[type=button], [role=button]')
        .find((b) => visible(b) && /^(verify|submit|confirm|done|check|continue|next)\b/i.test(textOf(b)));
      if (btn) { const r = btn.getBoundingClientRect(); out.confirm = { x: (r.left + r.width / 2) / viewport.width, y: (r.top + r.height / 2) / viewport.height }; }
      // what to choose ("Choose all the clocks"), and the part of the page worth showing: prompt .. tiles .. confirm button
      const ask = deepAll(root, 'p, h1, h2, h3, h4, div, span, label').filter((e) => visible(e) && e.children.length < 4)
        .filter((e) => /^(choose|select|click|pick|tap)\b.{3,100}$/i.test((e.innerText || '').trim().split('\n')[0]) && (e.innerText || '').trim().length < 120)
        .sort((a, b) => (a.innerText || '').length - (b.innerText || '').length)[0]; // the tightest match, not a wrapper around the canvas
      if (ask) out.prompt = ask.innerText.trim().replace(/\s+/g, ' ');
      const boxes = [out.region && media.r, ask && ask.getBoundingClientRect(), btn && btn.getBoundingClientRect()].filter(Boolean);
      if (boxes.length && out.region) {
        const pad = 12, L = Math.max(0, Math.min(...boxes.map((r) => r.left)) - pad), T = Math.max(0, Math.min(...boxes.map((r) => r.top)) - pad);
        const R = Math.min(viewport.width, Math.max(...boxes.map((r) => r.right)) + pad), B = Math.min(viewport.height, Math.max(...boxes.map((r) => r.bottom)) + pad);
        out.view = { x: L / viewport.width, y: T / viewport.height, w: (R - L) / viewport.width, h: (B - T) / viewport.height };
      }
      const text = deepText(root).toLowerCase();
      out.expired = /expired|timed out|time ran out|time limit exceeded|session has ended/.test(text);
      out.error = /incorrect|wrong|try again|not correct|failed|didn.t match/.test(text);
      return out;
    },

    // Fallback click for drivers without a real mouse: the element under a viewport point gets the usual event sequence.
    clickAt: ({ x, y }) => {
      let el = document.elementFromPoint(x, y);
      while (el?.shadowRoot) { const inner = el.shadowRoot.elementFromPoint(x, y); if (!inner || inner === el) break; el = inner; } // into <awswaf-captcha>
      if (!el) return false;
      const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, screenX: x + (screenX || 0), screenY: y + (screenY || 0), button: 0, view: window };
      const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true, width: 1, height: 1, pressure: 0 };
      const fire = (t, extra = {}) => el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, t.startsWith('pointer') ? { ...base, ...ptr, ...extra } : { ...base, ...extra }));
      for (const t of ['pointerover', 'mouseover', 'pointermove', 'mousemove']) fire(t, { buttons: 0 });
      fire('pointerdown', { buttons: 1, pressure: 0.5 }); fire('mousedown', { buttons: 1 });
      fire('pointerup', { buttons: 0 }); fire('mouseup', { buttons: 0 });
      fire('click', { buttons: 0 }); // the canvas reads offsetX/Y of this event, which the browser derives from clientX/Y
      return true;
    },

    // Presses the challenge's own Confirm button by element (it lives in the captcha's shadow root), for drivers whose real
    // mouse is unavailable. A synthetic .click() on a submit button still submits the form.
    clickConfirm: () => {
      const deep = (node) => [...node.querySelectorAll('button, input[type=submit], [role=button]'), ...[...node.querySelectorAll('*')].filter((h) => h.shadowRoot).flatMap((h) => deep(h.shadowRoot))];
      const modal = [...document.querySelectorAll('.captcha-modal')].find((e) => e.style.display === 'block' || e.offsetWidth > 0) || document.body;
      const b = deep(modal).find((x) => visible(x) && /^(verify|submit|confirm|done|check|continue|next)\b/i.test(textOf(x)));
      if (!b) return false;
      b.click();
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
        selects: document.querySelectorAll('select').length, country: !!countryControl(), countryOk: /canada/i.test(countryControl() ? countryText(countryControl()) : ''),
        codeValue: codeField(inputs)?.value || '', pinValue: pinField(inputs)?.value || '', phoneValue: phoneField(inputs)?.value || '',
      };
    },
    // Works with React-controlled inputs: native setter, then the events the framework listens for.
    // Chooses Canada in the country control the way a person does: click the control, then click Canada. Two calls.
    //   1st call -> 'opened'  (the control was clicked)
    //   2nd call -> 'selected' / 'picked' (Canada was clicked; a native <select> that did not take the click is set directly)
    // -> 'none' | 'no option' | 'opened' | 'selected' | 'picked'
    pickCountry: () => {
      const c = countryControl();
      if (!c) return 'none';
      const want = (t) => /^\s*canada\b/i.test(t);
      const tap = (el) => { // the usual pointer / mouse sequence at the middle of the element
        const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
        const base = { bubbles: true, cancelable: true, composed: true, clientX: x, clientY: y, button: 0, view: window };
        const ptr = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
        const fire = (t, extra) => el.dispatchEvent(new (t.startsWith('pointer') ? PointerEvent : MouseEvent)(t, t.startsWith('pointer') ? { ...base, ...ptr, ...extra } : { ...base, ...extra }));
        fire('pointerover', { buttons: 0 }); fire('mouseover', { buttons: 0 }); fire('pointermove', { buttons: 0 }); fire('mousemove', { buttons: 0 });
        fire('pointerdown', { buttons: 1 }); fire('mousedown', { buttons: 1 }); fire('pointerup', { buttons: 0 }); fire('mouseup', { buttons: 0 }); fire('click', { buttons: 0 });
      };
      const entries = () => [...document.querySelectorAll('[role=option], [role=listbox] li, li, option, [data-value]')].filter((x) => visible(x) && want(textOf(x)));
      const mark = c.el.dataset.jbOpened ? Number(c.el.dataset.jbOpened) : 0;
      const fresh = !mark || Date.now() - mark > 4000;
      if (fresh && !(c.native ? false : entries().length)) { // 1st: click the control (a custom list may already be open)
        c.el.dataset.jbOpened = String(Date.now());
        c.el.focus(); tap(c.el);
        try { c.el.showPicker?.(); } catch { /* needs a real user gesture; the click above is what we have */ }
        return 'opened';
      }
      delete c.el.dataset.jbOpened;
      const entry = entries()[0]; // 2nd: click Canada in the list
      if (entry) tap(entry);
      if (c.native) {
        const o = [...c.el.options].find((x) => want(x.textContent));
        if (!o) return 'no option';
        if (!/canada/i.test(c.el.selectedOptions[0]?.textContent || '')) { // the click did not take (the list is the browser's own): set it
          Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(c.el, o.value);
          c.el.dispatchEvent(new Event('input', { bubbles: true })); c.el.dispatchEvent(new Event('change', { bubbles: true }));
        }
        return 'selected';
      }
      return entry ? 'picked' : 'no option';
    },

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
