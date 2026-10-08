const $ = (id) => document.getElementById(id);
const SEARCH_URLS = {
  ca: 'https://hiring.amazon.ca/app#/jobSearch',
  com: 'https://hiring.amazon.com/app#/jobSearch',
};

function paint(on) {
  $('enabled').checked = on;
  $('chipText').textContent = on ? 'Active' : 'Off';
  $('chip').classList.toggle('on', on);
}

function paintOpen(on) { $('autoOpen').checked = on; }

function paintLogin(on) { $('autoLogin').checked = on; }

chrome.storage.local.get(['enabled', 'autoOpen', 'autoLogin', 'loginPhone', 'loginPin', 'smsUrl']).then((s) => {
  paint(s.enabled !== false); paintOpen(s.autoOpen !== false); paintLogin(s.autoLogin !== false);
  $('loginPhone').value = s.loginPhone || '';
  $('loginPin').value = s.loginPin || '';
  $('smsUrl').value = s.smsUrl || '';
});
$('autoLogin').onchange = (e) => { paintLogin(e.target.checked); chrome.storage.local.set({ autoLogin: e.target.checked }); };
for (const id of ['loginPhone', 'loginPin', 'smsUrl']) $(id).oninput = (e) => chrome.storage.local.set({ [id]: e.target.value.trim() });
$('autoOpen').onchange = (e) => { paintOpen(e.target.checked); chrome.storage.local.set({ autoOpen: e.target.checked }); };
$('enabled').onchange = (e) => { paint(e.target.checked); chrome.storage.local.set({ enabled: e.target.checked }); };
for (const b of document.querySelectorAll('[data-site]')) {
  b.onclick = () => chrome.tabs.create({ url: SEARCH_URLS[b.dataset.site] }).then(() => window.close());
}

// --- saved KYC links (session storage: cleared when the browser closes) ---
function paintKyc(list) {
  $('kycBox').hidden = !list.length;
  const ul = $('kycList');
  ul.replaceChildren(...list.map((k) => {
    const li = document.createElement('li');
    const t = document.createElement('small');
    t.textContent = new Date(k.at).toLocaleTimeString() + (k.copied ? '' : ' · not copied');
    const copy = document.createElement('button');
    copy.textContent = 'Copy';
    copy.onclick = () => navigator.clipboard.writeText(k.url).then(() => {
      copy.textContent = 'Copied'; setTimeout(() => { copy.textContent = 'Copy'; }, 900);
    });
    const open = document.createElement('button');
    open.textContent = 'Open';
    open.onclick = () => { chrome.tabs.create({ url: k.url }); window.close(); };
    li.append(t, copy, open);
    return li;
  }));
}
chrome.storage.session.get('kycLinks').then((s) => paintKyc(s.kycLinks || []));
chrome.storage.session.onChanged.addListener((c) => { if (c.kycLinks) paintKyc(c.kycLinks.newValue || []); });
$('kycClear').onclick = () => chrome.storage.session.remove('kycLinks');

for (const t of document.querySelectorAll('[data-tab]')) t.onclick = () => {
  for (const o of document.querySelectorAll('[data-tab]')) o.classList.toggle('on', o === t);
  for (const p of document.querySelectorAll('[data-pane]')) p.hidden = p.dataset.pane !== t.dataset.tab;
};
