// Forwards the GraphQL exchanges that inject.js (page world) reports to the background worker, which feeds the bot.
// This is the only content script besides inject.js: the flow itself runs in core/bot.js.
(() => {
  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };
  if (window !== window.top) return;
  window.addEventListener('message', (ev) => {
    if (ev.source !== window || ev.data?.source !== 'jobbot-gql' || !alive()) return;
    try { chrome.runtime.sendMessage({ type: 'gql', entry: ev.data.entry }).catch(() => {}); } catch {}
  });
})();
