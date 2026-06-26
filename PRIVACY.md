# Privacy Policy — iCloud Album Downloader

**Last updated:** June 27, 2026

## Overview

iCloud Album Downloader is a browser extension that downloads photos and videos from publicly shared iCloud albums. It is designed with privacy in mind and does not collect, store, or transmit any user data.

## Data Collection

This extension does **not** collect any of the following:

- Personally identifiable information
- Health, financial, or authentication information
- Personal communications
- Location data
- Browsing or web history
- User activity (clicks, keystrokes, etc.)
- Website content

## Network Communication

The extension communicates **only** with Apple's iCloud servers (`*.icloud.com` and `*.icloud-content.com`) to:

1. Retrieve metadata for publicly shared photo albums
2. Download photo and video files

When error reporting is enabled by the developer, failure details are sent to a Cloudflare Worker endpoint configured in the extension build. The worker forwards each error report to Slack. Error reports may include the album URL, browser user-agent, and error metadata. No data is sent to any analytics service.

When error reporting is enabled, the extension also sends lightweight success pings (`scan_ok`, `download_ok`) with no album URL. The worker aggregates these server-side and posts one daily Slack summary per UTC day when any count is non-zero.

## Local Storage

Download job progress may be stored in the browser session for the duration of a download. User preferences (filename pattern, concurrency) are stored in browser sync storage. Downloaded files are saved directly to your device's Downloads folder via the browser's built-in download manager. The extension does not maintain a server-side database of user data.

## Third Parties

This extension does not sell, transfer, or share any user data with third parties for any purpose, including advertising, analytics, or creditworthiness determination.

## Changes to This Policy

If this policy changes, the updated version will be posted here with a revised date.

## Contact

If you have questions about this privacy policy, please open an issue on the [GitHub repository](https://github.com/rsalim/icloud-downloader-extension/issues).
