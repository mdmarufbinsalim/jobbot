// Runs on the Amazon remote KYC page. The page URL is the link you need later to finish identity verification:
// copy it to the clipboard, hand it to the background (saved in session storage) and go back to the hiring page.
(() => {
  if (!new URLSearchParams(location.search).has('clientId')) return;

  function copy(text) {
    return navigator.clipboard.writeText(text).catch(() => {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      if (!ok) throw new Error('copy failed');
    });
  }

  chrome.storage.local.get(['paused']).then(async (s) => {
    if (s.paused) return;
    const link = location.href;
    let copied = true;
    try { await copy(link); } catch { copied = false; }
    // Saved even if the clipboard was refused, so the link can still be read back from the extension.
    chrome.runtime.sendMessage({ type: 'kyc-link', link, copied });
  });
})();
