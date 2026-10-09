#!/usr/bin/env bash
# One-time bootstrap, run as root on the server (idempotent). Usage: setup-server.sh "<deploy public key>"
# Secrets (JOBBOT_TOKEN, optional JOBBOT_PHONE / JOBBOT_PIN / JOBBOT_SMS_URL) are read from stdin as KEY=VALUE lines
# and written to /etc/jobbot/env (root only, never in git).
set -euo pipefail
PUBKEY="${1:?deploy public key}"
HERE="$(cd "$(dirname "$0")" && pwd)"

id jobbot >/dev/null 2>&1 || useradd --system --create-home --home-dir /var/lib/jobbot --shell /bin/bash --comment "jobbot server" jobbot
install -d -o jobbot -g jobbot -m 755 /opt/jobbot /opt/jobbot/releases /var/lib/jobbot/browsers /var/lib/jobbot/out
install -d -o jobbot -g jobbot -m 700 /var/lib/jobbot/.ssh
grep -qxF "restrict $PUBKEY" /var/lib/jobbot/.ssh/authorized_keys 2>/dev/null || echo "restrict $PUBKEY" >> /var/lib/jobbot/.ssh/authorized_keys
chown jobbot:jobbot /var/lib/jobbot/.ssh/authorized_keys; chmod 600 /var/lib/jobbot/.ssh/authorized_keys

# env file: keep an existing token, add what came in on stdin
install -d -m 755 /etc/jobbot
touch /etc/jobbot/env; chmod 600 /etc/jobbot/env
while IFS= read -r line; do
  [ -z "$line" ] && continue
  key="${line%%=*}"
  grep -v "^${key}=" /etc/jobbot/env > /etc/jobbot/env.tmp || true
  printf '%s\n' "$line" >> /etc/jobbot/env.tmp
  mv /etc/jobbot/env.tmp /etc/jobbot/env; chmod 600 /etc/jobbot/env
done
grep -q '^JOBBOT_TOKEN=' /etc/jobbot/env || echo "JOBBOT_TOKEN=$(openssl rand -hex 24)" >> /etc/jobbot/env

# the deploy user may restart only this service
cat > /etc/sudoers.d/jobbot <<'SUDO'
jobbot ALL=(root) NOPASSWD: /usr/bin/systemctl restart jobbot-server, /usr/bin/systemctl is-active jobbot-server
SUDO
chmod 440 /etc/sudoers.d/jobbot
visudo -cf /etc/sudoers.d/jobbot >/dev/null

install -m 644 "$HERE/jobbot-server.service" /etc/systemd/system/jobbot-server.service
systemctl daemon-reload
systemctl enable jobbot-server >/dev/null 2>&1
echo "server prepared"
