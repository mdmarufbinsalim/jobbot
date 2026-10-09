// Walks the Amazon hiring login (auth.hiring.*) one step at a time: phone/email, choose SMS for the verification code
// and send it, then PIN. Typing the SMS code itself is left to you.
// Credentials come from chrome.storage.local (set in the popup); nothing is stored in the source.
(() => {
  const ATTEMPTS_KEY = 'jobbot-login-attempts';
  const SMS_KEY = 'jobbot-sms-requested';
  const SMS_WAIT_MS = 10000; // let the text arrive before looking at the inbox
  const MAX_ATTEMPTS = 4; // per tab session, so a wrong PIN can't lock the account in a loop
  const BUTTON_TEXT = /^(continue|next|sign in|log in|login|submit|verify|send verification code)$/i;

  let phoneTried = false, pinTried = false, sendTried = false, fetchStarted = false, codeTried = false;
  const flags = { running: false, paused: false };
  let cfg = { paused: true, loginPhone: '', loginPin: '', smsUrl: '', smsCode: null };

  const attempts = () => Number(sessionStorage.getItem(ATTEMPTS_KEY) || 0);
  const bump = () => sessionStorage.setItem(ATTEMPTS_KEY, String(attempts() + 1));

  function status(text) {
    window.__jobbotLoginStatus = text;
    window.dispatchEvent(new Event('jobbot-login-status'));
  }

  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const labelOf = (i) =>
    [i.getAttribute('aria-label'), i.placeholder, i.name, i.id, ...[...(i.labels || [])].map((l) => l.textContent)].join(' ');

  // Works with React-controlled inputs: use the native setter, then fire the events the framework listens for.
  function setValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value').set;
    input.focus();
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  const inputs = () => [...document.querySelectorAll('input')].filter(visible);
  const findPin = () =>
    inputs().find((i) => i.type === 'password') ||
    inputs().find((i) => /\b(pin|passcode|password)\b/i.test(labelOf(i)));
  const CODE_FIELD = /\b(code|otp|verification)\b/i;
  const findPhone = () =>
    inputs().find((i) => ['text', 'email', 'tel'].includes(i.type)
      && !/\b(pin|passcode|password)\b/i.test(labelOf(i)) && !CODE_FIELD.test(labelOf(i)));
  const findCodeField = () => inputs().find((i) => CODE_FIELD.test(labelOf(i)));

  // "Where should we send your verification code?" page: the SMS option reads "Send verification code to ****648".
  function findSmsOption() {
    for (const r of document.querySelectorAll('input[type=radio]')) {
      const box = r.closest('label') || r.parentElement?.parentElement || r.parentElement;
      if (box && /^\s*send verification code to/i.test(box.textContent)) return { radio: r, box };
    }
    return null;
  }

  const findButton = () =>
    [...document.querySelectorAll('button, input[type=submit], [role=button]')]
      .filter(visible)
      .find((b) => BUTTON_TEXT.test((b.textContent || b.value || '').trim()) && !b.disabled);

  // Give the framework a moment to enable the button after the input event, then click it.
  function pressContinue(then) {
    setTimeout(() => {
      const b = findButton();
      if (b) { b.click(); then?.(true); } else then?.(false);
    }, 400);
  }

  // Code entry page: after a short wait, ask the background worker to read the code from the SMS inbox, then type it in.
  // Inbox page for the saved number, unless a URL was typed into the popup (assumes a Canadian temp-number.com page).
  const inboxUrl = () => cfg.smsUrl || (cfg.loginPhone ? `https://temp-number.com/temporary-numbers/canada/${cfg.loginPhone.replace(/\D/g, '')}` : '');

  function handleCode(field) {
    if (codeTried) return status('Verification: code submitted');
    if (!inboxUrl()) return status('Verification: waiting for you to enter the SMS code (save your phone number or an SMS inbox URL in the popup)');
    if (!sessionStorage.getItem(SMS_KEY)) sessionStorage.setItem(SMS_KEY, String(Date.now()));
    const requestedAt = Number(sessionStorage.getItem(SMS_KEY));

    if (!fetchStarted) {
      const left = Math.ceil((SMS_WAIT_MS - (Date.now() - requestedAt)) / 1000);
      if (left > 0) return status(`Verification: checking the SMS inbox in ${left}s…`);
      fetchStarted = true;
      chrome.runtime.sendMessage({ type: 'fetch-sms', url: inboxUrl(), requestedAt });
      return status('Verification: reading the code from the SMS inbox…');
    }
    if (cfg.smsCode?.code && cfg.smsCode.at >= requestedAt) {
      if (field.value) return;
      codeTried = true;
      status('Verification: entering the code…');
      setValue(field, cfg.smsCode.code);
      chrome.storage.local.remove('smsCode');
      return pressContinue((ok) => status(ok ? 'Verification: code submitted' : 'Verification: code entered, no Verify button found'));
    }
    status('Verification: reading the code from the SMS inbox…');
  }

  function tick() {
    if (cfg.paused) return status(flags.running ? 'Paused' : 'Stopped — press Start in the side panel');

    const codeField = findCodeField();
    if (codeField && !findSmsOption()) return handleCode(codeField); // reading the SMS code needs neither credentials nor attempts

    if (!cfg.loginPhone || !cfg.loginPin) return status('Auto-login paused: save phone and PIN in the popup');
    if (attempts() >= MAX_ATTEMPTS) return status('Auto-login stopped: attempt limit reached (click ↻ in the sidebar to reset)');

    const sms = findSmsOption();
    if (sms) {
      if (sendTried) return status('Verification: code requested by SMS');
      sendTried = true; bump();
      sessionStorage.setItem(SMS_KEY, String(Date.now()));
      status('Verification: choosing SMS and sending the code…');
      if (!sms.radio.checked) (sms.box || sms.radio).click();
      return pressContinue((ok) => status(ok ? 'Verification: code requested by SMS, enter it when it arrives' : 'Verification: SMS chosen, no send button found'));
    }

    const pin = findPin();
    if (pin) {
      if (pinTried) return status('PIN step: submitted');
      if (pin.value) return;
      pinTried = true; bump();
      status('PIN step: filling PIN…');
      setValue(pin, cfg.loginPin);
      return pressContinue((ok) => status(ok ? 'PIN step: submitted' : 'PIN step: filled, no submit button found'));
    }

    const phone = findPhone();
    if (phone) {
      if (phoneTried) return status('Phone step: submitted');
      if (phone.value) return;
      phoneTried = true; bump();
      status('Phone step: filling…');
      setValue(phone, cfg.loginPhone);
      return pressContinue((ok) => status(ok ? 'Phone step: submitted' : 'Phone step: filled, no Continue button found'));
    }
    status('Waiting for the login form…');
  }

  // The sidebar's restart button bumps loginReset; when it's newer than what this tab last saw, re-arm the attempt limit.
  function checkReset(stamp) {
    if (!stamp || String(stamp) === sessionStorage.getItem('jobbot-login-reset-seen')) return;
    sessionStorage.setItem('jobbot-login-reset-seen', String(stamp));
    sessionStorage.removeItem(ATTEMPTS_KEY);
    phoneTried = pinTried = sendTried = fetchStarted = codeTried = false;
    sessionStorage.removeItem(SMS_KEY);
  }

  chrome.storage.local.get(['running', 'paused', 'loginPhone', 'loginPin', 'loginReset', 'smsUrl', 'smsCode']).then((s) => {
    checkReset(s.loginReset);
    flags.running = s.running === true; flags.paused = !!s.paused;
    cfg = { paused: flags.running !== true || flags.paused, loginPhone: s.loginPhone || '', loginPin: s.loginPin || '', smsUrl: s.smsUrl || '', smsCode: s.smsCode || null };
    tick();
    setInterval(tick, 700);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('loginReset' in c) checkReset(c.loginReset.newValue);
    if ('running' in c) flags.running = c.running.newValue === true;
    if ('paused' in c) flags.paused = !!c.paused.newValue;
    cfg.paused = flags.running !== true || flags.paused;
    for (const k of Object.keys(cfg)) if (k !== 'paused' && k in c) cfg[k] = c[k].newValue || '';
  });
})();
