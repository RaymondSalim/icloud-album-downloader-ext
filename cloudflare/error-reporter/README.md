# Error Reporter (Cloudflare Worker)

Proxies error reports from the browser extension to Slack. The Slack webhook URL never ships in the extension.

## Deploy

```bash
cd cloudflare/error-reporter
npm install -g wrangler   # or: npx wrangler
wrangler login

# Required: Slack incoming webhooks (one per channel)
wrangler secret put SLACK_ERROR_WEBHOOK_URL
wrangler secret put SLACK_SUMMARY_WEBHOOK_URL

# Recommended: shared secret the extension sends as Authorization: Bearer <secret>
wrangler secret put REPORT_SECRET

# Required for daily success/error summaries (KV counters)
npx wrangler kv namespace create icloud-extension-telemetry
# Add the returned id to wrangler.toml under [[kv_namespaces]] binding = "icloud_extension_telemetry"

wrangler deploy
```

After deploy, wrangler prints your worker URL, e.g. `https://icloud-album-error-reporter.<account>.workers.dev`.

The report endpoint is: `https://<your-worker>/report`

A cron trigger runs daily at **00:05 UTC** and posts one Slack summary for the previous UTC day when any counter is non-zero.

## Configure the extension

Copy the root `config.example.js` to `config.js`:

```js
self.REPORTING_CONFIG = {
  enabled: true,
  reportEndpoint: "https://icloud-album-error-reporter.<account>.workers.dev/report",
  reportSecret: "same value as REPORT_SECRET above",
};
```

Or build with env vars:

```bash
REPORT_ENDPOINT="https://..." REPORT_SECRET="..." ./build.sh
```

Add the worker origin to `host_permissions` in both manifests if you use a custom domain (the default `https://*.workers.dev/*` covers `*.workers.dev`).

## API

`POST /report`

Headers:
- `Content-Type: application/json`
- `Authorization: Bearer <REPORT_SECRET>` (if configured)

Body (error — posts to Slack immediately and increments daily error counter):

```json
{
  "kind": "error",
  "operation": "scan",
  "message": "HTTP 403 from ...",
  "stack": "...",
  "albumUrl": "https://www.icloud.com/sharedalbum/#B0aGWZGq...",
  "version": "1.5.0",
  "userAgent": "...",
  "filter": "",
  "failedCount": null,
  "details": {}
}
```

Body (success ping — no Slack; worker increments daily counter only):

```json
{
  "kind": "count",
  "metric": "scan_ok",
  "version": "1.5.0"
}
```

`metric` is `scan_ok` or `download_ok`.

Daily Slack summary (posted by cron, not by the extension):

```
Date (UTC): 2026-06-27
Scan successes: 12
Download successes: 8
Errors: 2
```

If all counts are zero for a UTC day, no summary is posted.

Error reports are rate limited to 20 per IP per hour. Success pings are not rate limited.
