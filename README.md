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

## Login and SMS code

On `auth.hiring.*` the extension can fill the phone/email, request the SMS verification code, read the code from a
temp-number inbox page and enter it. Credentials and the inbox URL are typed into the popup and kept in the
extension's local storage; none of them are in this repo. A public temp-number inbox is readable by anyone, so
only use it for accounts where that is acceptable.

If the flow makes no progress for 5 seconds it reloads the page (max 5 times per URL). The ↻ button in the sidebar
starts over from the search page.

## Status

Early work in progress. The `.com` application URL pattern is unverified, and login autofill is not implemented.
