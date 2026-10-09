// Playwright implementation of the driver interface described in extension/core/bot.js.
export class PlaywrightDriver {
  constructor(page, context) {
    this.page = page; this.context = context; this.h = {};
    page.on('framenavigated', (f) => { if (f === page.mainFrame()) this.emit('navigated'); });
    page.on('close', () => this.emit('closed'));
    page.on('response', (r) => this.onResponse(r).catch(() => {}));
  }
  on(ev, fn) { (this.h[ev] ||= []).push(fn); }
  emit(ev, arg) { for (const fn of this.h[ev] || []) fn(arg); }

  async onResponse(res) {
    const req = res.request();
    const body = req.postData() || '';
    if (!/graphql|appsync/i.test(req.url()) && !/"(operationName|query)"\s*:/.test(body)) return;
    let request = body, response;
    try { request = JSON.parse(body); } catch {}
    try { response = await res.json(); } catch { return; }
    this.emit('gql', { request, response });
  }

  url() { return this.page.url(); }
  goto(url) { return this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }); }
  reload() { return this.page.reload({ waitUntil: 'domcontentloaded', timeout: 20000 }); }
  evaluate(fn, arg) { return this.page.evaluate(fn, arg); }
  click(x, y) { return this.page.mouse.click(x, y); } // a real mouse click at viewport CSS pixels
  async screenshot() { return `data:image/png;base64,${(await this.page.screenshot()).toString('base64')}`; }
  async openTab(url) {
    const t = await this.context.newPage();
    await t.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    return {
      evaluate: (fn, arg) => t.evaluate(fn, arg),
      reload: () => t.reload({ waitUntil: 'domcontentloaded' }),
      close: () => t.close(),
    };
  }
}
