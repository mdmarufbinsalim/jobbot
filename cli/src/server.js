import http from 'node:http';
import crypto from 'node:crypto';

const MAX_BODY = 2 * 1024 * 1024;
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();

// HTTP control plane for a running bot: the extension (or curl) drives it with a bearer token.
export function startServer({ runtime, token, host, port, say }) {
  const { controller, settings } = runtime;
  const want = sha(token);

  const send = (res, code, body, type = 'application/json') => {
    res.writeHead(code, {
      'Content-Type': type,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
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
    try {
      if (req.method === 'OPTIONS') return send(res, 204, '');
      const route = `${req.method} ${new URL(req.url, 'http://x').pathname}`;
      if (route === 'GET /health') return send(res, 200, { ok: true });
      const given = /^Bearer (.+)$/.exec(req.headers.authorization || '')?.[1];
      if (!given || !crypto.timingSafeEqual(sha(given), want)) {
        await new Promise((r) => setTimeout(r, 400)); // slow down guessing
        return send(res, 401, { error: 'unauthorized' });
      }
      if (route === 'GET /screenshot') {
        const data = await controller.screenshot();
        if (!data) return send(res, 404, { error: 'no screenshot yet' });
        return send(res, 200, Buffer.from(data.split(',')[1], 'base64'), 'image/png');
      }
      const fn = routes[route];
      if (!fn) return send(res, 404, { error: 'not found' });
      send(res, 200, await fn(req));
    } catch (e) {
      say(`api error: ${e.message}`);
      send(res, e.message === 'invalid JSON' || /required|not allowed|must be/.test(e.message) ? 400 : 500, { error: e.message });
    }
  });
  return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
}
