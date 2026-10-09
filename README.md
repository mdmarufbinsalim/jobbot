# Jobbot

Amazon hiring assistant for `hiring.amazon.ca` / `.com`: search → job → application → login (SMS code) → saved KYC link.

- `extension/` Chrome extension (side panel). Runs the bot **in your own Chrome**, or **controls a headless server** over HTTP.
- `cli/` Playwright runner and HTTP server (`jobbot serve`) that does the same flow in its own browser.
- `extension/core/` the flow itself (bot state machine, in-page actions, SMS, session helpers). **Both sides use this one copy**;
  each platform only supplies a small driver (`extension/drivers/chrome.js`, `cli/src/driver.js`). Change a rule once, here.

## Run it
    cd cli && npm i && npx playwright install chromium
    npm run login          # once: log in (automatic) and save the session
    npm start              # run locally, visible browser, reusing the saved session
    npm run serve          # HTTP API on 127.0.0.1:8787, headless browser; prints the token

Extension: `chrome://extensions` → Developer mode → Load unpacked → `extension/`.
Settings → **Run on**: *This browser*, or *Remote server* (URL `http://127.0.0.1:8787` + the token). With a remote server, log in on the
site in your Chrome, then **Sync session** to send the login to the server. For a VPS use an SSH tunnel or HTTPS reverse proxy
(the API is plain HTTP + bearer token) and run under a virtual display if you need a visible browser.

See `cli/README.md` for all options and the API.
