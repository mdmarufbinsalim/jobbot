// Runs on the temp-number.com inbox page, but only while the background worker has an SMS lookup open (smsJob).
// Finds the newest "Your Amazon Jobs verification code is: NNNNNN" that arrived after the code was requested.
(async () => {
  const { smsJob } = await chrome.storage.local.get('smsJob');
  if (!smsJob || Date.now() > smsJob.until) return;

  const UNIT = { second: 1, minute: 60, hour: 3600, day: 86400 };
  const MAX_AGE_S = 180; // the login page says the code expires in 3 minutes

  // The page lists "<age> ago" followed by the message text, so read the age from just before each code.
  function scan() {
    const text = document.body.innerText;
    const elapsed = (Date.now() - smsJob.requestedAt) / 1000 + 15; // only messages sent since we asked
    let best = null, m;
    const re = /Your Amazon Jobs verification code is:?\s*(\d{4,8})/gi;
    while ((m = re.exec(text))) {
      const before = text.slice(Math.max(0, m.index - 150), m.index);
      const ages = [...before.matchAll(/(\d+|a|an)\s*(second|minute|hour|day)s?\s+ago/gi)];
      const last = ages[ages.length - 1];
      if (!last) continue;
      const n = /^\d+$/.test(last[1]) ? Number(last[1]) : 1;
      const age = n * UNIT[last[2].toLowerCase()];
      if (age <= MAX_AGE_S && age <= elapsed && (!best || age < best.age)) best = { code: m[1], age };
    }
    return best;
  }

  // Give the inbox a moment to render before reading it.
  await new Promise((r) => setTimeout(r, 1500));
  const found = scan();
  if (found) return chrome.runtime.sendMessage({ type: 'sms-code', code: found.code });

  // Not there yet (SMS can be slow): reload every 5s until the lookup window closes.
  setTimeout(() => {
    if (Date.now() > smsJob.until) chrome.runtime.sendMessage({ type: 'sms-fail' });
    else location.reload();
  }, 5000);
})();
