import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from './config.js';

const FILE = path.join(os.homedir(), '.config/jobbot/settings.json');
const KEYS = ['site', 'continuous', 'loginPhone', 'loginPin', 'smsUrl'];

function readFile() { try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch { return {}; } }

// Effective settings: defaults < config.local.json / env < settings pushed through the API (the extension's Settings tab)
// < command-line overrides.
export function createSettings(overrides = {}) {
  const get = () => ({ site: 'ca', continuous: true, ...loadConfig(), ...readFile(), ...overrides });
  const update = (patch) => {
    const clean = {};
    for (const k of KEYS) if (k in patch) clean[k] = patch[k];
    if (clean.site && !['ca', 'com'].includes(clean.site)) throw new Error('site must be ca or com');
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify({ ...readFile(), ...clean }, null, 2), { mode: 0o600 });
    for (const k of Object.keys(clean)) delete overrides[k]; // an explicit update wins over a flag
    return get();
  };
  return { get, update };
}
