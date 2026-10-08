// Runs in the page's own JS world so it can wrap fetch/XHR. Reports GraphQL traffic via postMessage.
(() => {
  if (window.__jobbotGql) return;
  window.__jobbotGql = true;

  // Match by URL, or by a GraphQL-looking request body in case the endpoint has an unexpected name.
  const isGql = (url, body) =>
    /graphql|appsync/i.test(String(url)) || (typeof body === 'string' && /"(operationName|query)"\s*:/.test(body));
  const stats = { fetch: 0, xhr: 0, captured: 0 };
  const stat = () => window.postMessage({ source: 'jobbot-gql-stat', stats: { ...stats } }, '*');
  const toText = (body) => (typeof body === 'string' ? body : body == null ? '' : '[non-text body]');

  function report(url, reqBody, status, resText) {
    let response = resText;
    try { response = JSON.parse(resText); } catch {}
    let request = toText(reqBody);
    try { request = JSON.parse(request); } catch {}
    stats.captured++;
    stat();
    window.postMessage(
      { source: 'jobbot-gql', entry: { t: Date.now(), page: location.href, url: String(url), status, request, response } },
      '*'
    );
  }

  const origFetch = window.fetch;
  window.fetch = async function (input, init) {
    stats.fetch++;
    stat();
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === 'string' ? input : input.url;
      const body = init?.body ?? (input instanceof Request ? await input.clone().text() : '');
      if (isGql(url, body)) {
        res.clone().text().then((txt) => report(url, body, res.status, txt));
      }
    } catch {}
    return res;
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__jobbotUrl = url;
    return open.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function (body) {
    stats.xhr++;
    stat();
    if (isGql(this.__jobbotUrl, body)) {
      this.addEventListener('load', () => {
        try {
          const txt = this.responseType === '' || this.responseType === 'text' ? this.responseText : JSON.stringify(this.response);
          report(this.__jobbotUrl, body, this.status, txt);
        } catch {}
      });
    }
    return send.apply(this, arguments);
  };
})();
