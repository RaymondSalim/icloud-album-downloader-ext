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
reporting.js               Error reporting client (posts to Cloudflare Worker)
config.example.js          Reporting config template (copy to config.js)
cloudflare/error-reporter/ Cloudflare Worker proxy → Slack
popup/
  popup.html               Extension popup UI
  popup.css                Styles
  popup.js                 Popup logic
icons/
  icon.svg                 Extension icon (SVG source)
```

## Error reporting (developer)

When users hit real failures (scan errors, download failures), the extension posts a report to a Cloudflare Worker you deploy. The worker forwards it to Slack. Your Slack webhook URL never ships in the extension.

**1. Deploy the worker**

See [`cloudflare/error-reporter/README.md`](cloudflare/error-reporter/README.md). Quick version:

```bash
cd cloudflare/error-reporter
wrangler login
wrangler secret put SLACK_WEBHOOK_URL    # Slack incoming webhook
wrangler secret put REPORT_SECRET        # shared secret for the extension
wrangler deploy
```

**2. Configure the extension**

Copy `config.example.js` to `config.js` and set your worker URL + secret:

```js
self.REPORTING_CONFIG = {
  enabled: true,
  reportEndpoint: "https://icloud-album-error-reporter.<account>.workers.dev/report",
  reportSecret: "same value as REPORT_SECRET above",
};
```

Reload the extension (or build with `REPORT_ENDPOINT` / `REPORT_SECRET` env vars).

**Release builds (GitHub → stores)**

Store uploads use artifacts from GitHub Releases. See [`RELEASE.md`](RELEASE.md).

1. Set `REPORT_ENDPOINT`, `REPORT_SECRET`, `AMO_API_KEY`, and `AMO_API_SECRET` as GitHub Actions secrets.
2. Bump version in both manifests, commit, then tag: `git tag v1.1.0 && git push origin v1.1.0`
3. CI builds artifacts, auto-submits Firefox **listed** to AMO, and signs a **self** XPI (manifest version `<version>.1`, e.g. `1.1.1.1`).
4. Download the Chrome `.zip` from the release page and upload to Chrome Web Store manually.

**3. Test it**

From the extension console (popup or background inspect):

```js
chrome.runtime.sendMessage({ type: "test-report" }).then(console.log)
// Firefox: browser.runtime.sendMessage({ type: "test-report" }).then(console.log)
```

From the terminal:

```bash
node scripts/send-test-report.js
```

Reports include: operation type, error message, stack trace, album URL, extension version, browser info, and (for download failures) a sample of failed filenames. Validation mistakes (empty URL, wrong format) are not reported. Duplicate identical errors within 60 seconds are deduplicated. The worker rate-limits to 20 reports per IP per hour.

## FAQ

**HEIC photos** — iCloud serves shared albums in Apple's formats when available. HEIC files are downloaded as-is; the extension does not convert them to JPEG. Open them with Photos, Preview, or another HEIC-capable app.

**Live Photos** — A Live Photo is a still image plus a short video clip. By default only the still is downloaded. Turn on **Download Live Photo videos** in extension options to also save the companion video (separate `.mov`/`.mp4` next to the still).

**Videos** — Pure videos are detected from iCloud stream metadata (`mediaAssetType: video`), not only from the file extension. Shared albums may cap video resolution (often 720p).

## Limitations

- Only works with **shared** iCloud albums (public links with `#token`)
- Very large albums may take time; the iCloud API may throttle requests
- HEIC files are not converted to JPEG
- Live Photo videos are optional and download as separate files (not a single `.livephoto` bundle)
- Apple could change the undocumented API at any time
