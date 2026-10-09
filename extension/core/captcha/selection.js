// The ordered list of chosen tiles. Plain data in, plain data out, so it works the same in the side panel, the server
// (which re-validates what the panel sends) and tests. Each entry: { tile, x, y } with x, y normalized 0..1.
import { tileAt, tileCenter, tileCount } from './geometry.js';

export class Selection {
  constructor(grid) { this.grid = grid; this.items = []; }

  get count() { return this.items.length; }
  has(tile) { return this.items.some((s) => s.tile === tile); }
  list() { return this.items.map((s) => ({ ...s })); }

  // A click on a tile: select it (at the tile's centre) or, if already selected, deselect it.
  toggle(tile) {
    const at = this.items.findIndex((s) => s.tile === tile);
    if (at >= 0) { this.items.splice(at, 1); return false; }
    this.items.push({ tile, ...tileCenter(this.grid, tile) });
    return true;
  }
  toggleAt(point) { const t = tileAt(this.grid, point); return t == null ? null : (this.toggle(t), t); }

  // Revise one selection's coordinates (it keeps its place in the order). The point must stay inside the grid.
  revise(tile, point) {
    const s = this.items.find((x) => x.tile === tile);
    if (!s) throw new Error(`tile ${tile} is not selected`);
    if (tileAt(this.grid, point) == null) throw new Error('point is outside the grid');
    s.x = point.x; s.y = point.y;
  }
  remove(tile) { this.items = this.items.filter((s) => s.tile !== tile); }
  clear() { this.items = []; }
  // A new grid (rows/cols changed) invalidates tile ids, so the selection starts again.
  reset(grid) { this.grid = grid; this.items = []; }
}

// What the server accepts from a panel: throws on anything malformed, returns clean entries.
export function validateSelections(list, grid) {
  if (!Array.isArray(list)) throw new Error('selections must be a list');
  if (list.length > tileCount(grid)) throw new Error('more selections than tiles');
  const seen = new Set();
  return list.map((s) => {
    const tile = Number(s?.tile), x = Number(s?.x), y = Number(s?.y);
    if (!Number.isInteger(tile) || tile < 1 || tile > tileCount(grid)) throw new Error(`selections must be real tiles (got ${s?.tile})`);
    if (seen.has(tile)) throw new Error(`tile ${tile} is selected twice`);
    seen.add(tile);
    if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) throw new Error('coordinates must be between 0 and 1');
    if (tileAt(grid, { x, y }) !== tile) throw new Error(`the point for tile ${tile} is outside that tile`);
    return { tile, x, y };
  });
}
