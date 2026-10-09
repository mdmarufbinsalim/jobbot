# Jobbot CLI

Headless Playwright port of the Jobbot extension (`../extension`, which stays as it is). Same flow: search → job → application → login (SMS code from the temp-number inbox) → saved KYC link, with the same 10s / 5-try refresh rule per step.

## Run locally
    npm i && npx playwright install chromium
    node bin/jobbot.js run --shots shots            # headless; add --headed to watch
    node bin/jobbot.js run --site com --once

Keys while running: `p` pause · `r` resume/retry · `s` screenshot · `n` restart · `q` quit.
Screenshots (`--shots <dir>`) are saved on every step change, captcha, stuck state and KYC link, or on demand with `s`.
KYC links are appended to `<out>/kyc-links.txt`.

## Account details
`JOBBOT_PHONE`, `JOBBOT_PIN`, `JOBBOT_SMS_URL`, or `config.local.json` (gitignored):
    { "loginPhone": "+1…", "loginPin": "…", "smsUrl": "https://temp-number.com/…" }

## Docker
    docker compose up --build          # data (KYC links, screenshots, profile) lands in ./data
    docker compose run --rm jobbot run --site com --once --out /data/out --shots /data/shots --no-interactive

## Remote browser
On the remote host: `jobbot serve --host 0.0.0.0 --port 9222` (prints a `ws://` URL), then `jobbot run --ws ws://host:9222/<id>`.
`--cdp http://host:9222` also works with a Chrome started with `--remote-debugging-port`.

## Captcha
For now the bot takes a screenshot and waits. To plug in a solver service, pass `--captcha-solver ./solver.js`, a module whose default export is
`{ async solve({ page, screenshot, log }) { …; return true; } }`; returning true lets the flow continue.
