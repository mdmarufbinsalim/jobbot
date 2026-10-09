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

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`. Settings → **Run on** → *Remote server*, URL
`http://127.0.0.1:8787`, token from `~/.config/jobbot/token`; log in on the site in your Chrome and press **Sync session**.
For a VPS use an SSH tunnel or an HTTPS reverse proxy (plain HTTP + bearer token) and `jobbot --url … --token …`.
