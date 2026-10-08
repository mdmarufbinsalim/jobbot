const $ = (id) => document.getElementById(id);

function paint(on) {
  $('enabled').checked = on;
  $('state').textContent = on ? 'On' : 'Off';
  $('state').classList.toggle('on', on);
}

function paintOpen(on) {
  $('autoOpen').checked = on;
  $('openState').textContent = on ? 'On' : 'Off';
  $('openState').classList.toggle('on', on);
}

function paintLogin(on) {
  $('autoLogin').checked = on;
  $('loginState').textContent = on ? 'On' : 'Off';
  $('loginState').classList.toggle('on', on);
}

chrome.storage.local.get(['enabled', 'autoOpen', 'autoLogin', 'loginPhone', 'loginPin', 'smsUrl']).then((s) => {
  paint(!!s.enabled); paintOpen(s.autoOpen !== false); paintLogin(s.autoLogin !== false);
  $('loginPhone').value = s.loginPhone || '';
  $('loginPin').value = s.loginPin || '';
  $('smsUrl').value = s.smsUrl || '';
});
$('autoLogin').onchange = (e) => { paintLogin(e.target.checked); chrome.storage.local.set({ autoLogin: e.target.checked }); };
for (const id of ['loginPhone', 'loginPin', 'smsUrl']) $(id).oninput = (e) => chrome.storage.local.set({ [id]: e.target.value.trim() });
$('autoOpen').onchange = (e) => { paintOpen(e.target.checked); chrome.storage.local.set({ autoOpen: e.target.checked }); };
$('enabled').onchange = (e) => { paint(e.target.checked); chrome.storage.local.set({ enabled: e.target.checked }); };
for (const b of document.querySelectorAll('[data-site]')) {
  b.onclick = () => { chrome.runtime.sendMessage({ type: 'open-search', site: b.dataset.site }); window.close(); };
}
