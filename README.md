# Jobbot

Chrome extension (Manifest V3) for `hiring.amazon.com` / `hiring.amazon.ca`.

Click the toolbar icon to open the docked side panel. It shows the current step (Search → Job → Application → Login),
the first job and schedule found, saved KYC links, a live GraphQL log and the settings.

## What it automates

- Moves the tab from the job search to the first job and its first schedule's application page.
- Job search: presses "All" and clears the pre-filled location.
- Login: fills phone/email and PIN, requests the SMS code, reads it from a temp-number inbox and enters it.
- Application pages: ticks the consent boxes, answers the referral question, presses the continue buttons.
- KYC: copies the remote KYC link to the clipboard, saves it in session storage, and returns to the job search.
- Reloads stalled pages until you pause.

Pause / Resume stops everything. **Continuous** (Settings, on by default) starts over after each saved KYC link;
turn it off to stop after one successful run.

## Load it

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this folder.
3. Click the Jobbot icon and enter the account details under Settings.

## Account details

Phone/email, PIN and SMS inbox URL are typed into Settings and kept in the extension's local storage. To pre-fill them,
create a `defaults.js` next to `background.js` (it is gitignored) that sets `self.JOBBOT_DEFAULTS = { loginPhone, loginPin, smsUrl }`.
A public temp-number inbox is readable by anyone, so only use it for accounts where that is acceptable.
