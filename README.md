# Luma: All Events

Luma's city pages (e.g. luma.com/sf) show a short curated list. The same API, asked
for an area instead of a city, returns every public event there (≈650 vs 39 for SF).
This browser extension adds a full-screen list of all of them to luma.com.

## Install in Brave

Works the same in Chrome, Edge, Arc and other Chromium browsers on desktop.
Mobile browsers (including Brave on Android) don't support extensions.

1. **Get the code.** On this repo's GitHub page click **Code → Download ZIP** and unzip it,
   or clone it:
   ```bash
   git clone https://github.com/erodactyl/luma-all-events-chrome-extension.git
   ```
   Keep the folder somewhere permanent: the browser loads the extension from it.
2. Open `brave://extensions` in the address bar.
3. Turn on **Developer mode** (toggle, top right).
4. Click **Load unpacked** and choose the `extension` folder inside the download
   (the one containing `manifest.json`).
5. Optional: click the puzzle-piece icon in the toolbar and pin **Luma: All Events**.

Brave may occasionally remind you that developer-mode extensions are enabled; that's expected.

**Updating:** download or `git pull` the latest version, then click the reload ↻ icon on the
extension's card in `brave://extensions` and refresh any open Luma tabs.

## Use

- Click the toolbar icon, or the orange **All events** button on any luma.com page.
- Pick a city or **Near me**, a radius, and optionally a category. Then filter by text,
  free, open-only or minimum guests, and sort by date or popularity.
- Open `luma.com/discover#all-events` to jump straight to the list.

## How it works

`extension/content.js` runs on luma.com in your normal session and calls
`api.lu.ma/discover/get-paginated-events` with a `north/south/east/west` bounding box,
which is the query the site's map view uses. It pages through results with a short delay.
It relies on Luma's undocumented API, so it may break if they change it.

`luma-all-events.user.js` is the same tool as a userscript (Tampermonkey) or console paste.
