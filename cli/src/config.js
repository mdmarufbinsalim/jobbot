import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Account details: env vars, ./config.local.json or ~/.config/jobbot/config.json (first found wins per key).
// Shape: { "loginPhone": "...", "loginPin": "...", "smsUrl": "https://temp-number.com/..." }
export function loadConfig() {
  const files = [path.resolve('config.local.json'), path.join(os.homedir(), '.config/jobbot/config.json')];
  let file = {};
  for (const f of files) {
    try { file = { ...JSON.parse(fs.readFileSync(f, 'utf8')), ...file }; } catch {}
  }
  const e = process.env;
  return {
    loginPhone: e.JOBBOT_PHONE || file.loginPhone || '',
    loginPin: e.JOBBOT_PIN || file.loginPin || '',
    smsUrl: e.JOBBOT_SMS_URL || file.smsUrl || '',
  };
}
