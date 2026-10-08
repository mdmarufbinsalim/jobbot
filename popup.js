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

chrome.storage.local.get(['enabled', 'autoOpen']).then((s) => { paint(!!s.enabled); paintOpen(s.autoOpen !== false); });
$('autoOpen').onchange = (e) => { paintOpen(e.target.checked); chrome.storage.local.set({ autoOpen: e.target.checked }); };
$('enabled').onchange = (e) => { paint(e.target.checked); chrome.storage.local.set({ enabled: e.target.checked }); };
for (const b of document.querySelectorAll('[data-site]')) {
  b.onclick = () => { chrome.runtime.sendMessage({ type: 'open-search', site: b.dataset.site }); window.close(); };
}
