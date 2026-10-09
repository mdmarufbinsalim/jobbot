# Jobbot server

Playwright runner and HTTP API for the hiring flow. The flow itself is in `../extension/core`; control it with `../cli` or the extension. Same flow: search → job → application → login (SMS code from the temp-number inbox) → saved KYC link, with the same 10s / 5-try refresh rule per step.

## Run locally
    npm i && npx playwright install chromium
    npm run login                              # once: log in (automatic, headless; use -- --headed to solve a captcha) and save the session
    npm start                                  # = node bin/server.js run: headless, reuses the saved session, screenshots to ./shots, KYC links to ./out
    node bin/server.js run --headed            # show the window (everything is headless by default)
    node bin/server.js run --site com --once   # other site, stop after one KYC link

Keys while running: `p` pause · `r` resume/retry · `s` screenshot · `n` restart · `q` quit.
Screenshots (default `./shots`, `--no-shots` to turn off) are saved on every step change, captcha, stuck state and KYC link, or on demand with `s`.
KYC links are appended to `<out>/kyc-links.txt`.

## Saved session
`login` and `run` share `~/.config/jobbot/state.json` (cookies and storage, mode 600, never committed). `run` refreshes it every minute and on exit; delete it to force a fresh login.

## Account details
`JOBBOT_PHONE`, `JOBBOT_PIN`, `JOBBOT_SMS_URL`, or `config.local.json` (gitignored):
    { "loginPhone": "+1…", "loginPin": "…", "smsUrl": "https://temp-number.com/…" }

## Captcha
For now the bot takes a screenshot and waits. To plug in a solver service, pass `--captcha-solver ./solver.js`, a module whose default export is
`{ async solve({ page, screenshot, log }) { …; return true; } }`; returning true lets the flow continue.

## Server API (`jobbot serve`)
`Authorization: Bearer <token>` on everything except `GET /health`. Default `127.0.0.1:8787`, headless (`--headed` to show the window).

| Route | |
|---|---|
| `GET /status` | running, paused, live step/detail, first job/schedule, KYC links, recent log |
| `POST /start` `/pause` `/resume` `/restart` `/stop` | controls |
| `GET /screenshot` | PNG of the bot's tab right now |
| `PUT /config` | `{ site, continuous, loginPhone, loginPin, smsUrl }` |
| `PUT /session` | `{ cookies, origins }` (Playwright storage state; only Amazon hiring cookies are kept) |
| `GET /kyc` | saved KYC links |

The flow logic lives in `../extension/core/`; this folder only provides the Playwright driver, the HTTP server and the CLI.
