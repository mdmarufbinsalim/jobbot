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

  // A real (trusted) mouse click at viewport CSS pixels through the debugger protocol. Throws if it cannot attach, e.g.
  // DevTools is open on the tab; the caller then falls back to clicking from inside the page.
  async click(x, y) {
    const target = { tabId: this.tabId };
    await chrome.debugger.attach(target, '1.3');
    try {
      const at = { x, y, button: 'left', clickCount: 1 };
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mousePressed', ...at });
      await chrome.debugger.sendCommand(target, 'Input.dispatchMouseEvent', { type: 'mouseReleased', ...at });
    } finally { await chrome.debugger.detach(target).catch(() => {}); }
  }

  // Only the visible tab of its window can be captured; otherwise there is nothing truthful to return.
  async screenshot() {
    const tab = await chrome.tabs.get(this.tabId);
    if (!tab.active) return null;
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
