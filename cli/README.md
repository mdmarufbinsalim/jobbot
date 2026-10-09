# Jobbot CLI

Local-only Playwright port of the Jobbot extension (`../extension`, which stays as it is). Same flow: search → job → application → login (SMS code from the temp-number inbox) → saved KYC link, with the same 10s / 5-try refresh rule per step.

## Run locally
    npm i && npx playwright install chromium
    npm start                                  # = node bin/jobbot.js run: visible browser, screenshots to ./shots, KYC links to ./out
    node bin/jobbot.js run --headless          # no window (Amazon may block headless browsers)
    node bin/jobbot.js run --site com --once   # other site, stop after one KYC link

Keys while running: `p` pause · `r` resume/retry · `s` screenshot · `n` restart · `q` quit.
Screenshots (default `./shots`, `--no-shots` to turn off) are saved on every step change, captcha, stuck state and KYC link, or on demand with `s`.
KYC links are appended to `<out>/kyc-links.txt`.

## Account details
`JOBBOT_PHONE`, `JOBBOT_PIN`, `JOBBOT_SMS_URL`, or `config.local.json` (gitignored):
    { "loginPhone": "+1…", "loginPin": "…", "smsUrl": "https://temp-number.com/…" }

## Captcha
For now the bot takes a screenshot and waits. To plug in a solver service, pass `--captcha-solver ./solver.js`, a module whose default export is
`{ async solve({ page, screenshot, log }) { …; return true; } }`; returning true lets the flow continue.
