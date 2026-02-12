# iCloud Album Downloader — Browser Extension

A Chrome/Firefox extension to download entire **shared** iCloud photo albums in one click.

## Features

- Paste any iCloud shared album URL and scan its contents
- See a breakdown: total items, photo count, video count, estimated total size
- Download everything, or only photos / only videos
- Concurrent downloads (3 at a time) with real-time progress
- Auto-detects the album URL if you're already on an iCloud shared album page
- Files saved into a named folder in your Downloads directory

## Install (Chrome — developer mode)

1. Open `chrome://extensions`
2. Enable **Developer mode** (toggle in the top-right)
3. Click **Load unpacked** and select this project folder
4. The extension icon appears in the toolbar

## Install (Firefox — temporary)

Firefox MV3 requires `background.scripts` instead of `service_worker`. A Firefox-specific manifest is provided.

1. Copy `manifest_firefox.json` over `manifest.json` (or rename it)
2. Open `about:debugging#/runtime/this-firefox`
3. Click **Load Temporary Add-on**
4. Select the `manifest.json` file in this project folder

> Firefox temporary add-ons are removed when the browser closes.
> For permanent install, the extension must be signed via [addons.mozilla.org](https://addons.mozilla.org/).

## Usage

1. Copy a shared iCloud album URL (e.g. `https://www.icloud.com/sharedalbum/#B0aGWZGqDGHAhDX`)
2. Click the extension icon
3. Paste the URL (or let it auto-detect if you're on the page)
4. Click **Scan** to fetch album metadata
5. Review the item counts, then click **Download All** (or Photos/Videos Only)
6. Files are saved to `Downloads/<folder name>/`

## How it works

The extension uses Apple's undocumented shared-streams API:

1. `POST /webstream` — retrieves album metadata (photo list, derivatives, checksums)
2. `POST /webasseturls` — exchanges photo GUIDs for direct download URLs
3. Downloads each file via the `chrome.downloads` API

Only **publicly shared** albums are supported — no Apple ID login required.

## Project structure

```
manifest.json              Chrome manifest (Manifest V3, service_worker)
manifest_firefox.json      Firefox manifest (Manifest V3, background scripts)
background.js              API calls & download manager
popup/
  popup.html               Extension popup UI
  popup.css                Styles
  popup.js                 Popup logic
icons/
  icon.svg                 Extension icon (SVG source)
```

## Limitations

- Only works with **shared** iCloud albums (public links with `#token`)
- Very large albums may take time; the iCloud API may throttle requests
- Video detection relies on file extension in the download URL
- Apple could change the undocumented API at any time
