// Syntax-checks every JS file and validates the extension manifest. Used by CI and `npm run check`.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const roots = ['extension', 'server/bin', 'server/src', 'cli/bin', 'scripts'];
const files = [];
const walk = (d) => {
  if (!fs.existsSync(d)) return;
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(m?js)$/.test(e.name)) files.push(p);
  }
};
roots.forEach(walk);
let bad = 0;
for (const f of files) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { bad++; console.error(`SYNTAX ${f}\n${e.stderr}`); }
}
const manifest = JSON.parse(fs.readFileSync('extension/manifest.json', 'utf8'));
for (const need of ['manifest_version', 'name', 'version', 'background']) if (!manifest[need]) { bad++; console.error(`manifest.json missing ${need}`); }
for (const s of manifest.content_scripts?.flatMap((c) => c.js) || []) if (!fs.existsSync(path.join('extension', s))) { bad++; console.error(`manifest references missing ${s}`); }
console.log(`${files.length} files checked${bad ? `, ${bad} problem(s)` : ', all good'}`);
process.exit(bad ? 1 : 0);
