// The side panel's tile-challenge interface. Shows the captured challenge with a numbered tile grid over it; the person
// clicks tiles (in the order they want), can revise or remove picks, then presses Apply. Works the same for the local
// run and the remote server: it only talks to background.js ('captcha' / 'captchaAnswer' / 'captchaRetry').
// Geometry and validation are the shared core/captcha modules, so what is clicked here is exactly what the solver re-checks.
import { makeGrid, tileCount } from './core/captcha/geometry.js';
import { Selection } from './core/captcha/selection.js';

const root = document.getElementById('captcha');
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const btn = (label, fn, cls = 'mini') => { const b = h('button', cls, label); b.type = 'button'; b.onclick = fn; return b; };
const pct = (n) => `${(n * 100).toFixed(2)}%`;

const send = (cmd, extra) => chrome.runtime.sendMessage({ type: 'ctl', cmd, ...extra }).catch(() => null);
let ch = null, sel = null, drawnKey = '', busy = false, live = null, running = false;

async function poll() {
  if (!(live || ch || running)) return; // `live` is empty on the login step, so the run state counts too
  const r = await send('captcha');
  if (!r?.ok) return;
  ch = r.challenge || null;
  if (!ch) { sel = null; drawnKey = ''; root.hidden = true; return; }
  render();
}

function render() {
  root.hidden = false;
  const key = `${ch.id}|${ch.capturedAt}|${ch.status}|${ch.message}|${ch.attempt}`;
  if (key === drawnKey) return;
  drawnKey = key;
  // a new capture (first, refreshed, or after a rejection) starts with no picks
  if (!sel || sel.challenge !== `${ch.id}|${ch.capturedAt}`) { sel = new Selection(ch.grid); sel.seeded = false; sel.challenge = `${ch.id}|${ch.capturedAt}`; }
  // Gemini's picks (core/captcha/gemini-solver.js) are shown as ordinary selected tiles while the solver waits to click them
  if (ch.suggested?.length && !sel.seeded) { sel.seeded = true; for (const t of ch.suggested) sel.toggle(t); }
  const interactive = ch.status === 'awaiting' && !busy;

  const head = h('div', 'chead');
  head.append(h('h3', '', 'Captcha'), h('small', '', ch.status === 'solved' ? 'solved' : `attempt ${ch.attempt || 1}`));
  const msg = h('div', `msg ${ch.status === 'solved' ? 'ok' : ch.lastResult && ch.status === 'awaiting' ? 'bad' : ''}`,
    ch.message || (ch.status === 'awaiting' ? 'Click every matching tile, then press Apply.' : ''));
  root.replaceChildren(head);
  if (ch.image) root.append(h('div', 'ask', ch.prompt || 'Select the matching tiles'));
  root.append(msg);
  if (!ch.image) { // solved / closed: the image is gone
    if (ch.status === 'closed') { const row = h('div', 'row'); row.append(btn('Try again', () => send('captchaRetry'), 'act')); root.append(row); }
    return;
  }
  if (!ch.aspectOk) root.append(h('div', 'msg bad', 'The screenshot and the window have different shapes; clicks may land off. Press Refresh.'));

  // Show only the challenge (prompt .. tiles .. Confirm), enlarged to the panel width; everything inside is placed in image percentages.
  const v = ch.view || { x: 0, y: 0, w: 1, h: 1 };
  const stage = h('div', 'stage'), inner = h('div', 'inner'), img = h('img');
  stage.style.paddingTop = `${((v.h * ch.imageSize.height) / (v.w * ch.imageSize.width)) * 100}%`;
  Object.assign(inner.style, { width: `${100 / v.w}%`, height: `${100 / v.h}%`, left: `${(-v.x / v.w) * 100}%`, top: `${(-v.y / v.h) * 100}%` }); img.src = ch.image; img.alt = 'Captcha challenge'; img.draggable = false;
  const g = ch.grid, grid = h('div', 'grid');
  Object.assign(grid.style, { left: pct(g.region.x), top: pct(g.region.y), width: pct(g.region.w), height: pct(g.region.h),
    gridTemplateColumns: `repeat(${g.cols}, 1fr)`, gridTemplateRows: `repeat(${g.rows}, 1fr)` });
  const dots = h('div');
  const picks = h('ul', 'picks');
  const paint = () => {
    for (const t of grid.children) {
      const id = Number(t.dataset.id), at = sel.items.findIndex((s) => s.tile === id);
      t.classList.toggle('on', at >= 0);
      t.querySelector('.ord')?.remove();
      if (at >= 0) t.append(h('span', 'ord', at + 1));
    }
    dots.replaceChildren(...sel.items.map((s) => { const d = h('i', 'dot'); Object.assign(d.style, { left: pct(s.x), top: pct(s.y) }); return d; }));
    picks.replaceChildren(...sel.items.map((s, i) => {
      const li = h('li'), num = (k) => {
        const inp = h('input'); inp.type = 'number'; inp.min = 0; inp.max = 100; inp.step = 0.5; inp.value = (s[k] * 100).toFixed(1); inp.disabled = !interactive;
        inp.title = `${k} in % of the image`;
        inp.onchange = () => { try { sel.revise(s.tile, { ...s, [k]: Number(inp.value) / 100 }); } catch (e) { inp.value = (s[k] * 100).toFixed(1); msg.textContent = e.message; } paint(); };
        return inp;
      };
      li.append(h('b', '', `${i + 1}. tile ${s.tile}`), num('x'), num('y'), btn('Remove', () => { sel.remove(s.tile); paint(); }));
      li.lastChild.disabled = !interactive;
      return li;
    }));
    apply.textContent = `Apply ${sel.count} tile${sel.count === 1 ? '' : 's'}`;
    apply.disabled = !interactive || !sel.count;
    clear.disabled = !interactive || !sel.count;
  };
  for (let id = 1; id <= tileCount(g); id++) {
    const t = h('button', 'tile'); t.type = 'button'; t.dataset.id = id; t.append(h('span', 'id', id)); t.disabled = !interactive;
    t.onclick = () => { sel.toggle(id); paint(); };
    grid.append(t);
  }
  inner.append(img, grid, dots);
  stage.append(inner);

  const rows = h('input'), cols = h('input');
  for (const [inp, v] of [[rows, g.rows], [cols, g.cols]]) { inp.type = 'number'; inp.min = 1; inp.max = 8; inp.value = v; inp.disabled = !interactive; }
  const regrid = () => { try { ch.grid = makeGrid({ rows: Number(rows.value), cols: Number(cols.value), region: g.region }); sel = null; drawnKey = ''; render(); } catch (e) { msg.textContent = e.message; } };
  rows.onchange = cols.onchange = regrid;
  const clear = btn('Clear', () => { sel.clear(); paint(); });
  const apply = btn('Apply', async () => {
    busy = true; apply.disabled = true;
    const r = await send('captchaAnswer', { answer: { id: ch.id, action: 'submit', grid: { rows: ch.grid.rows, cols: ch.grid.cols }, selections: sel.list() } });
    busy = false; drawnKey = '';
    if (!r?.ok) msg.textContent = r?.error || 'Could not send';
    poll();
  }, 'act main');
  const tools = h('div', 'row');
  const lab = (t, inp) => { const l = h('label', '', t); l.append(' ', inp); return l; };
  tools.append(lab('Rows', rows), lab('Cols', cols), clear,
    btn('Refresh', () => send('captchaAnswer', { answer: { id: ch.id, action: 'refresh' } }).then(() => { drawnKey = ''; poll(); })),
    btn('Leave to me', () => send('captchaAnswer', { answer: { id: ch.id, action: 'giveup' } }).then(() => { drawnKey = ''; poll(); })));
  const go = h('div', 'row'); go.append(apply);
  root.append(stage, tools, picks, go);
  paint();
  if (!interactive) for (const b of root.querySelectorAll('.row button')) if (b !== apply) b.disabled = true;
}

chrome.storage.session.get('live').then((s) => { live = s.live || null; poll(); });
chrome.storage.local.get('running').then((s) => { running = !!s.running; poll(); });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'local' && c.running) { running = !!c.running.newValue; poll(); } });
chrome.storage.onChanged.addListener((c, area) => { if (area === 'session' && c.live) { live = c.live.newValue || null; poll(); } });
setInterval(poll, 900);
