// Pure maths for the tile challenge: no DOM, no I/O, so the side panel, the server and the tests all share it.
//
// Three coordinate systems are in play:
//   image       pixels of the saved screenshot (what the person sees and clicks on)
//   normalized  0..1 of the image on each axis; this is what is stored, so a selection survives the image being resized
//   viewport    CSS pixels of the page's viewport; this is what the driver clicks on
// A screenshot covers the whole viewport (captureVisibleTab / page.screenshot), so normalized maps straight onto the viewport.

export const MAX_GRID = 8;
const clamp01 = (n) => Math.min(1, Math.max(0, n));

// Size of a PNG data URL without decoding it (the service worker has no Image): width/height sit in the IHDR chunk.
export function pngSize(dataUrl) {
  const b64 = String(dataUrl || '').split(',')[1] || '';
  const head = atob(b64.slice(0, 44)); // 33 bytes cover the signature + IHDR
  if (head.length < 24 || head.slice(1, 4) !== 'PNG') return null;
  const u32 = (o) => ((head.charCodeAt(o) << 24) | (head.charCodeAt(o + 1) << 16) | (head.charCodeAt(o + 2) << 8) | head.charCodeAt(o + 3)) >>> 0;
  return { width: u32(16), height: u32(20) };
}

// The tile grid: rows x cols laid over `region` (normalized {x, y, w, h}; the whole image by default).
export function makeGrid({ rows = 3, cols = 3, region } = {}) {
  const r = Math.round(rows), c = Math.round(cols);
  if (!(r >= 1 && r <= MAX_GRID && c >= 1 && c <= MAX_GRID)) throw new Error(`grid must be 1..${MAX_GRID} rows and columns`);
  const reg = { x: 0, y: 0, w: 1, h: 1, ...region };
  if (!(reg.w > 0 && reg.h > 0 && reg.x >= 0 && reg.y >= 0 && reg.x + reg.w <= 1.0001 && reg.y + reg.h <= 1.0001)) throw new Error('grid region is outside the image');
  return { rows: r, cols: c, region: reg };
}

// Tiles are numbered 1.. left to right, top to bottom.
export const tileCount = (g) => g.rows * g.cols;
export function tileCenter(g, id) {
  if (!Number.isInteger(id) || id < 1 || id > tileCount(g)) throw new Error(`no tile ${id}`);
  const row = Math.floor((id - 1) / g.cols), col = (id - 1) % g.cols;
  return { x: g.region.x + ((col + 0.5) / g.cols) * g.region.w, y: g.region.y + ((row + 0.5) / g.rows) * g.region.h };
}
// The tile under a normalized point, or null when the point is outside the grid.
export function tileAt(g, { x, y }) {
  const fx = (x - g.region.x) / g.region.w, fy = (y - g.region.y) / g.region.h;
  if (fx < 0 || fy < 0 || fx >= 1 || fy >= 1) return null;
  return Math.floor(fy * g.rows) * g.cols + Math.floor(fx * g.cols) + 1;
}

export const normalize = ({ x, y }, size) => ({ x: clamp01(x / size.width), y: clamp01(y / size.height) });
export const denormalize = ({ x, y }, size) => ({ x: x * size.width, y: y * size.height });
// Normalized point -> viewport CSS pixels (rounded, clamped inside the viewport).
export function toViewport({ x, y }, viewport) {
  return { x: Math.min(viewport.width - 1, Math.round(clamp01(x) * viewport.width)), y: Math.min(viewport.height - 1, Math.round(clamp01(y) * viewport.height)) };
}
// Does the screenshot have the same shape as the viewport? If not the mapping above would drift.
export const sameShape = (size, viewport, tol = 0.02) => Math.abs(size.width / size.height - viewport.width / viewport.height) <= tol;
