# Jobbot

Amazon hiring assistant for `hiring.amazon.ca` / `.com`: search → job → application → login (SMS code) → saved KYC link.

| Folder | What it is |
|---|---|
| `server/` | Owns the browser (Playwright). Runs the flow and exposes an HTTP API (bearer token). Headless by default. |
| `cli/` | `jobbot …` commands that **control** a server: start it in the background, start/stop/pause the bot, status, logs, screenshots. No dependencies. |
| `extension/` | Chrome side panel. Runs the bot in your own Chrome, **or controls a server** (Remote), and can sync your Chrome login to it. |

The flow itself (bot state machine, in-page actions, SMS, session helpers) lives once in `extension/core/` and is used by both the
extension and the server. Each side only supplies a small driver (`extension/drivers/chrome.js`, `server/src/driver.js`).
Change a rule once, there.

## Quick start
    cd server && npm i && npx playwright install chromium
    cd ../cli  && npm link          # gives you the `jobbot` command (or run: node cli/bin/jobbot.js …)
    jobbot login                    # once: logs in by itself (headless), saves the session; add --headed to solve a captcha
    jobbot start                    # starts the server in the background if needed, then the bot
    jobbot status                   # step, job, shift, KYC links, settings, recent log
    jobbot watch                    # live updates
    jobbot shot                     # screenshot of the bot's tab
    jobbot down                     # stop the server

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`. Settings → **Run on** → *Remote server*
(the URL is preset to `http://127.0.0.1:8787`; no token needed); log in on the site in your Chrome and press **Sync session**.

**Auth:** no token on localhost. The server then only answers the CLI/curl and `chrome-extension://` pages (never websites, never a foreign
Host header), and it refuses to listen on a non-local address unless you pass `--token`. The CLI's server URL defaults to
`http://127.0.0.1:8787` (`--url` or `JOBBOT_URL` to change it).

**Where to run the server:** on a machine with a normal home or office connection. Amazon's CloudFront answers requests from datacenter
IPs (a VPS) with a 403 "Request blocked" for `hiring.amazon.*`, while the same code works from a home connection. Run `jobbot up` on your own machine,
or use the extension's local mode.
