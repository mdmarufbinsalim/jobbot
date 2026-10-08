# Jobbot

Chrome extension (Manifest V3) for `hiring.amazon.com` / `hiring.amazon.ca`.

- Captures every GraphQL response on the page (including `auth.hiring.*`).
- Shows a right-hand sidebar with the current flow step (Search → Job → Application → Login),
  the first job found, the first schedule found, and a live GraphQL log.
- With **Auto-continue** on, moves the tab through search → first job → first schedule's application page,
  3 seconds after each step.

## Load it

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this folder.
3. Open the popup, turn **Show panel** on, then open the job search.

## Status

Early work in progress. The `.com` application URL pattern is unverified, and login autofill is not implemented.
