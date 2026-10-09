import http from 'node:http';

const MAX_BODY = 2 * 1024 * 1024;

// HTTP control plane for a running bot. There is no token: the server listens on 127.0.0.1 only and only answers
//  - requests without an Origin header (the CLI, curl) or from a chrome-extension:// page, never from a website, and
//  - requests whose Host is localhost / 127.0.0.1 (blocks DNS rebinding).
// To reach it from another machine, use an SSH tunnel (ssh -L 8787:127.0.0.1:8787 host).
export function startServer({ runtime, host, port, say }) {
  const { controller, settings } = runtime;
  const LOCAL_HOST = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

  const send = (res, code, body, type = 'application/json', origin = '') => {
    res.writeHead(code, {
      'Content-Type': type,
      ...(origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {}),
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
      'Cache-Control': 'no-store',
    });
    res.end(code === 204 ? undefined : type === 'application/json' ? JSON.stringify(body) : body);
  };
  const readJson = (req) => new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > MAX_BODY) { reject(new Error('body too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {}); } catch { reject(new Error('invalid JSON')); } });
    req.on('error', reject);
  });
  const publicStatus = () => {
    const c = settings.get();
    return { ...controller.status(), config: { site: c.site, continuous: c.continuous, hasCredentials: !!(c.loginPhone && c.loginPin), smsUrl: c.smsUrl } };
  };

  const routes = {
    'GET /status': () => publicStatus(),
    'GET /kyc': () => ({ kyc: controller.kyc }),
    'POST /start': async () => { await controller.start(); return publicStatus(); },
    'POST /stop': async () => { await controller.stop(); return publicStatus(); },
    'POST /pause': () => { controller.pause(); return publicStatus(); },
    'POST /resume': () => { controller.resume(); return publicStatus(); },
    'POST /restart': async () => { await controller.restart(); return publicStatus(); },
    'PUT /config': async (req) => { settings.update(await readJson(req)); return publicStatus(); },
    'PUT /session': async (req) => ({ ok: true, ...(await runtime.applySession(await readJson(req))) }),
  };

  const server = http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const okOrigin = origin.startsWith('chrome-extension://') ? origin : '';
    const reply = (code, body, type) => send(res, code, body, type, okOrigin);
    try {
      if (origin && !okOrigin) return reply(403, { error: 'forbidden origin' });
      if (!LOCAL_HOST.test(req.headers.host || '')) return reply(403, { error: 'forbidden host' });
      if (req.method === 'OPTIONS') return reply(204, '');
      const route = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
      if (route === 'GET /health') return reply(200, { ok: true });
      if (route === 'GET /screenshot') {
        const data = await controller.screenshot();
        if (!data) return reply(404, { error: 'no screenshot yet' });
        return reply(200, Buffer.from(data.split(',')[1], 'base64'), 'image/png');
      }
      const fn = routes[route];
      if (!fn) return reply(404, { error: 'not found' });
      reply(200, await fn(req));
    } catch (e) {
      say(`api error: ${e.message}`);
      reply(e.message === 'invalid JSON' || /required|not allowed|must be/.test(e.message) ? 400 : 500, { error: e.message });
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
