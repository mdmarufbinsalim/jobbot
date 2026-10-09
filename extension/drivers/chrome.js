// chrome.tabs / chrome.scripting implementation of the driver interface described in core/bot.js.
export class ChromeDriver {
  constructor(tabId) {
    this.tabId = tabId; this._url = ''; this.h = {};
    chrome.tabs.get(tabId).then((t) => { this._url = t.url || this._url; }).catch(() => {});
    this._updated = (id, info, tab) => {
      if (id !== tabId) return;
      if (tab?.url) this._url = tab.url;
      if (info.url || info.status === 'loading') this.emit('navigated');
    };
    this._removed = (id) => { if (id === tabId) this.emit('closed'); };
    chrome.tabs.onUpdated.addListener(this._updated);
    chrome.tabs.onRemoved.addListener(this._removed);
  }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); }
  emit(ev, arg) { for (const fn of this.h[ev] || []) fn(arg); }
  dispose() {
    chrome.tabs.onUpdated.removeListener(this._updated);
    chrome.tabs.onRemoved.removeListener(this._removed);
    this.h = {};
  }

  url() { return this._url; }
  async goto(url) { this._url = url; await chrome.tabs.update(this.tabId, { url }); }
  reload() { return chrome.tabs.reload(this.tabId); }
  evaluate(fn, arg) { return run(this.tabId, fn, arg); }

  // No debugger: clicks on the page (tiles, Confirm) are synthetic events sent from inside it (core/dom.js clickAt /
  // clickConfirm), because there is no `click` method here. The screenshot is Chrome's own capture of the visible tab,
  // which needs the <all_urls> host permission (or a live activeTab grant) and the tab to be the one on screen.
  async screenshot() {
    const tab = await chrome.tabs.get(this.tabId);
    if (!tab.active) return null; // only the visible tab can be captured
    return chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
  }

  // A foreground tab for the SMS inbox; the working tab is re-focused when it closes.
  async openTab(url) {
    const t = await chrome.tabs.create({ url, active: true });
    const wait = () => new Promise((resolve) => {
      const done = (id, info) => { if (id === t.id && info.status === 'complete') { chrome.tabs.onUpdated.removeListener(done); resolve(); } };
      chrome.tabs.onUpdated.addListener(done);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(done); resolve(); }, 12000);
    });
    await wait();
    return {
      evaluate: (fn, arg) => run(t.id, fn, arg),
      reload: async () => { await chrome.tabs.reload(t.id); await wait(); },
      close: async () => { await chrome.tabs.remove(t.id).catch(() => {}); chrome.tabs.update(this.tabId, { active: true }).catch(() => {}); },
    };
  }
}

async function run(tabId, func, arg) {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func, args: [arg] });
  return res?.result;
}
