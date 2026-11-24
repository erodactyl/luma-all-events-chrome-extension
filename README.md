# Luma: All Events

Luma's city pages (e.g. luma.com/sf) show a short curated list. The same API, asked
for an area instead of a city, returns every public event there (≈650 vs 39 for SF).
This browser extension adds a full-screen list of all of them to luma.com.

## Install (Brave, Chrome, Edge, Arc — any Chromium browser)

1. Open `brave://extensions` (or `chrome://extensions`).
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose the `extension` folder.
4. Pin the orange icon from the puzzle-piece menu if you like.

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
