// Job search page (#/jobSearch), first step: press the "All" tab, then select and clear the location/postcode input
// (it is pre-filled from the profile, e.g. "ঢাকা"), so the search isn't limited to that place.
(() => {
  const DELAY_MS = 800; // let the page render its pre-filled value first
  const loadedAt = Date.now();
  let cfg = { enabled: true, autoOpen: true, paused: false };
  let allDone = false, clearDone = false;

  const onSearch = () => location.hash.startsWith('#/jobSearch');
  const visible = (e) => !!(e && (e.offsetWidth || e.offsetHeight || e.getClientRects().length));
  const textOf = (b) => (b.textContent || '').replace(/\s+/g, ' ').trim();

  function locationInput() {
    const inputs = [...document.querySelectorAll('input[type=text], input[type=search], input:not([type])')].filter(visible);
    return inputs.find((i) => /location|postal|post ?code|city|zip/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''} ${i.id} ${i.name}`))
      || inputs.find((i) => !/search jobs/i.test(`${i.placeholder} ${i.getAttribute('aria-label') || ''}`) && i.value);
  }

  function clearInput(input) {
    input.focus();
    input.select();
    // The page's own clear (X) button, next to the input, keeps its React state in sync best.
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
  }

  function tick() {
    if (!cfg.enabled || !cfg.autoOpen || cfg.paused || !onSearch() || Date.now() - loadedAt < DELAY_MS) return;
    if (!allDone) {
      const all = [...document.querySelectorAll('button, [role=button], [role=tab]')].find((b) => visible(b) && /^all$/i.test(textOf(b)));
      if (all) { all.click(); allDone = true; }
      return; // the filters re-render after "All"; clear the location on a later tick
    }
    if (!clearDone) {
      const input = locationInput();
      if (input && input.value) { clearInput(input); clearDone = true; }
    }
  }

  chrome.storage.local.get(['enabled', 'autoOpen', 'paused']).then((s) => {
    cfg = { enabled: s.enabled !== false, autoOpen: s.autoOpen !== false, paused: !!s.paused };
    setInterval(tick, 500);
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local') return;
    if ('enabled' in c) cfg.enabled = c.enabled.newValue !== false;
    if ('paused' in c) cfg.paused = !!c.paused.newValue;
    if ('autoOpen' in c) cfg.autoOpen = c.autoOpen.newValue !== false;
  });
})();
