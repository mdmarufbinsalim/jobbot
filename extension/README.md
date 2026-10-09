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
- Reloads a step that shows no progress after 10 seconds, up to 5 times in a row; after that it stays stuck (shown in the side panel). Restart in the side panel re-arms it.

**Start** closes every open hiring tab, opens the job search for the site chosen in Settings (default `.ca`) and runs the flow.
**Pause / Resume** temporarily halts and resumes the automation. **Stop** ends the run, leaves your tabs as they are and closes the side panel. Nothing runs until Start is pressed.
**Continuous** (Settings, on by default) starts over after each saved KYC link;
turn it off to stop after one successful run.

## Load it

1. Open `chrome://extensions` and enable Developer mode.
2. Click **Load unpacked** and select this folder.
3. Click the Jobbot icon and enter the account details under Settings.

## Account details

Phone/email, PIN and SMS inbox URL are typed into Settings and kept in the extension's local storage. To pre-fill them,
create a `defaults.js` next to `background.js` (it is gitignored) that sets `self.JOBBOT_DEFAULTS = { loginPhone, loginPin, smsUrl }`.
A public temp-number inbox is readable by anyone, so only use it for accounts where that is acceptable.

## Captcha (tile challenge)
When the tile challenge appears the bot holds and the side panel shows it: the captured screenshot with a numbered tile grid over it.
Click tiles in the order you want (rows/cols are adjustable), revise or remove picks in the list, then **Apply**. The same panel works for
local runs and for a remote server (`GET/POST /captcha`). After applying, the page is checked: *accepted* resumes the bot; *rejected / expired / replaced*
shows a fresh capture to retry; **Leave to me** keeps the bot paused so you can solve it on the page, and **Try again** reopens the panel.
Code: `extension/core/captcha/` (capture, geometry, selection, input, verify, hub, manual-solver). Clicks use `chrome.debugger` in the extension
(hence the `debugger` permission; Chrome shows a brief "debugging" banner) and Playwright's mouse on the server.
Only counts, states and timings are logged; images and coordinates stay in memory and are dropped when the challenge ends.
