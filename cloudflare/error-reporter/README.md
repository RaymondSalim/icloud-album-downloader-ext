# Error Reporter (Cloudflare Worker)

Proxies error reports from the browser extension to Slack. The Slack webhook URL never ships in the extension.

## Deploy

```bash
cd cloudflare/error-reporter
npm install -g wrangler   # or: npx wrangler
wrangler login

# Required: your Slack incoming webhook URL
wrangler secret put SLACK_WEBHOOK_URL

# Recommended: shared secret the extension sends as Authorization: Bearer <secret>
wrangler secret put REPORT_SECRET

wrangler deploy
```

After deploy, wrangler prints your worker URL, e.g. `https://icloud-album-error-reporter.<account>.workers.dev`.

The report endpoint is: `https://<your-worker>/report`

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

Body (error):
```json
{
  "kind": "error",
  "operation": "scan",
  "message": "HTTP 403 from ...",
  "stack": "...",
  "tokenPrefix": "B0aGWZGq",
  "version": "1.5.0",
  "userAgent": "...",
  "filter": "",
  "failedCount": null,
  "details": {}
}
```

Success event (no album URL or token):
```json
{
  "kind": "event",
  "event": "scan_ok",
  "version": "1.5.0",
  "itemCount": 42,
  "failedCount": 0
}
```

Slack messages for events are prefixed with `[success]`.

Rate limit: 20 reports per IP per hour.
