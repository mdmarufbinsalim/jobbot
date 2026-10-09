#!/usr/bin/env bash
# Runs on the server as the `jobbot` user, from the uploaded release: install, switch, restart, verify, roll back on failure.
set -euo pipefail
SHA="${1:?release id}"
ROOT=/opt/jobbot
REL="$ROOT/releases/$SHA"
export HOME=/var/lib/jobbot PLAYWRIGHT_BROWSERS_PATH=/var/lib/jobbot/browsers
PREV="$(readlink -f "$ROOT/current" 2>/dev/null || true)"

echo "==> install dependencies"
cd "$REL/server"
npm ci --omit=dev --no-audit --no-fund
echo "==> make sure the browser is installed (cached across releases)"
npx playwright install chromium

echo "==> switch to $SHA"
ln -sfn "$REL" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
sudo systemctl restart jobbot-server

echo "==> health check"
ok=0
for i in $(seq 1 30); do
  if curl -fsS --max-time 2 http://127.0.0.1:8787/health >/dev/null 2>&1; then ok=1; break; fi
  sleep 1
done
if [ "$ok" != 1 ]; then
  echo "!! new release did not come up; rolling back" >&2
  if [ -n "$PREV" ] && [ -d "$PREV" ]; then
    ln -sfn "$PREV" "$ROOT/current.new" && mv -Tf "$ROOT/current.new" "$ROOT/current"
    sudo systemctl restart jobbot-server || true
  fi
  exit 1
fi
echo "==> healthy; pruning old releases (keeping 3)"
ls -1dt "$ROOT"/releases/*/ | tail -n +4 | xargs -r rm -rf
echo "deployed $SHA"
