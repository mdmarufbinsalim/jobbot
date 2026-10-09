// Free captcha solver: asks a Gemini model (Google AI Studio free tier) which tiles match, then clicks them through the
// same capture / click / verify modules the manual solver uses. Falls back to the manual side-panel solver when it fails.
// Shared by the server (key from GEMINI_API_KEY) and the extension (key from its settings); each passes getKey/getModel.
// Sends the challenge screenshot to Google. Logs counts and timings only, never images or tile numbers.
import { capture, probe } from './capture.js';
import { makeGrid, tileCenter, tileCount } from './geometry.js';
import { validateSelections } from './selection.js';
import { submit } from './input.js';
import { verify } from './verify.js';
import { solveManually } from './manual-solver.js';
import LOCAL_KEY from './local-key.js'; // a key kept on this machine only (never committed)

const MAX_ATTEMPTS = 3;
// Google retires and rate-limits free models often, so a busy or retired model falls through to the next one.
export const DEFAULT_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-flash-latest', 'gemini-3.1-flash-lite'];

async function askGemini(cap, grid, signal, key, model, log) {
  if (!key) throw new Error('no Gemini API key set');
  const n = tileCount(grid), r = grid.region;
  const text = `This screenshot shows an image-selection captcha. The instruction reads: "${cap.page.prompt || 'Choose all matching tiles'}". `
    + `The ${grid.rows}x${grid.cols} grid of photo tiles occupies the region starting at ${Math.round(r.x * 100)}% from the left and ${Math.round(r.y * 100)}% from the top, `
    + `${Math.round(r.w * 100)}% wide and ${Math.round(r.h * 100)}% tall. Tiles are numbered 1..${n}, left to right, top to bottom. `
    + 'Look at each tile and return the numbers of every tile that clearly shows what the instruction asks for. Return an empty list if none do.';
  let res;
  for (const m of [model, ...FALLBACK_MODELS.filter((x) => x !== model)]) {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${m}:generateContent`, {
      method: 'POST', signal,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ parts: [{ inline_data: { mime_type: 'image/png', data: cap.image.split(',')[1] } }, { text }] }],
        generationConfig: {
          temperature: 0, responseMimeType: 'application/json',
          responseSchema: { type: 'OBJECT', properties: { tiles: { type: 'ARRAY', items: { type: 'INTEGER' } } }, required: ['tiles'] },
        },
      }),
    });
    if (![404, 429, 503].includes(res.status)) break;
    log?.(`captcha: ${m} unavailable (${res.status}), trying another model`);
  }
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 160).replace(/\s+/g, ' ')}`);
  const body = await res.json();
  const out = JSON.parse(body.candidates?.[0]?.content?.parts?.[0]?.text || '{}');
  if (!Array.isArray(out.tiles)) throw new Error('Gemini gave no tile list');
  return [...new Set(out.tiles.map(Number))].filter((t) => Number.isInteger(t) && t >= 1 && t <= n);
}

export function geminiSolver({ getKey, getModel = () => '' }) {
  return { name: 'gemini-free', solve: (ctx) => solve(ctx, getKey() || LOCAL_KEY, getModel() || DEFAULT_MODEL) };
}

async function solve(ctx, key, model) {
  const { driver, log, signal, kind } = ctx;
  try {
    if (kind === 'human-check') { // Begin was just pressed: wait for the tiles to load
      const until = Date.now() + 20000;
      while (!signal?.aborted && Date.now() < until && !(await probe(driver).catch(() => null))?.region) await new Promise((r) => setTimeout(r, 500));
    }
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !signal?.aborted; attempt++) {
      const t0 = Date.now();
      const cap = await capture(driver);
      const grid = makeGrid({ region: cap.page.region || undefined });
      const tiles = await askGemini(cap, grid, signal, key, model, log);
      log(`captcha: ${model} picked ${tiles.length} tile(s) (attempt ${attempt}, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
      const picks = validateSelections(tiles.map((tile) => ({ tile, ...tileCenter(grid, tile) })), grid);
      const sent = await submit(driver, picks, { viewport: cap.viewport, confirm: cap.page.confirm });
      log(`captcha: clicked ${sent.clicked}, confirm ${sent.confirmed ? 'pressed' : 'not found'}`);
      const result = await verify(driver, cap.page);
      log(`captcha: ${result}`);
      if (result === 'accepted') return true;
    }
  } catch (e) {
    if (signal?.aborted) return false;
    if (/no tile challenge/.test(e.message)) return true;
    log(`captcha: Gemini solver failed: ${String(e.message).split('\n')[0]}`);
  }
  if (signal?.aborted) return false;
  log('captcha: handing over to the manual solver');
  return solveManually(ctx);
}
