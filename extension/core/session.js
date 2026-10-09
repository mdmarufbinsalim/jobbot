// Moves a login between browsers: Chrome's cookie jar -> Playwright "storageState" (what the server loads).
const HIRING_URLS = [
  'https://hiring.amazon.ca/', 'https://auth.hiring.amazon.ca/',
  'https://hiring.amazon.com/', 'https://auth.hiring.amazon.com/',
];
export const SESSION_URLS = HIRING_URLS;

const SAME_SITE = { no_restriction: 'None', lax: 'Lax', strict: 'Strict', unspecified: 'Lax' };

export function chromeCookieToPlaywright(c) {
  return {
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || '/',
    expires: c.session || c.expirationDate == null ? -1 : c.expirationDate,
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: c.secure ? (SAME_SITE[c.sameSite] || 'Lax') : (c.sameSite === 'strict' ? 'Strict' : 'Lax'),
  };
}

// cookies: chrome.cookies.Cookie[]; storages: [{ origin, localStorage: [{name,value}] }]
export function buildStorageState(cookies, storages = []) {
  const seen = new Set(), out = [];
  for (const c of cookies) {
    const k = `${c.domain}|${c.path}|${c.name}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(chromeCookieToPlaywright(c));
  }
  return { cookies: out, origins: storages.filter((s) => s.localStorage?.length) };
}

// The server only keeps a session for the Amazon hiring sites, whatever the sender says; anything else is dropped.
export function validateStorageState(state) {
  if (!state || !Array.isArray(state.cookies)) throw new Error('cookies[] required');
  const ok = (d) => /(^|\.)amazon\.(ca|com|in)$/.test(String(d).replace(/^\./, ''));
  const cookies = state.cookies.filter((c) => c && c.name && ok(c.domain));
  if (!cookies.length) throw new Error('no cookies for the amazon hiring sites in this session (not allowed: other domains)');
  const origins = (state.origins || []).filter((o) => /^https:\/\/([\w-]+\.)*amazon\.(ca|com|in)$/.test(o.origin));
  return { cookies, origins, dropped: state.cookies.length - cookies.length };
}
