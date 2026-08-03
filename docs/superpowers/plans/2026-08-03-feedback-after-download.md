# Feedback After Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add success rating feedback and explicit user-submitted diagnostic reports routed to a separate Slack webhook.

**Architecture:** Keep UI state in `popup/popup.js`, keep popup markup in `popup/popup.html`, and keep Slack routing in the existing Cloudflare Worker. Add small pure helpers for diagnostic payload shaping so privacy behavior can be tested without a browser.

**Tech Stack:** Vanilla JavaScript, Chrome/Firefox MV3 APIs, Node `node:test`, Cloudflare Worker fetch handler.

---

## File Structure

- Modify `popup/popup.html`: add success rating UI and a reusable diagnostic report panel.
- Modify `popup/popup.css`: style the new panels, status text, checkbox row, and secondary muted text.
- Modify `popup/popup.js`: store current diagnostic context, render the rating prompt only after fully successful downloads, render/send diagnostics after failures, and open store URLs.
- Modify `reporting.js`: add diagnostic payload construction helpers and `sendDiagnosticReport`.
- Modify `background.js`: add `send-diagnostic-report` message handling.
- Modify `cloudflare/error-reporter/src/index.js`: route `kind: "diagnostic"` reports to `SLACK_DIAGNOSTIC_WEBHOOK_URL`.
- Modify `cloudflare/error-reporter/README.md` and `cloudflare/error-reporter/wrangler.toml`: document the new webhook secret.
- Create `tests/reporting.test.js`: test diagnostic payload privacy and asset URL stripping.
- Create `tests/error-reporter-worker.test.js`: test Worker routing for diagnostic reports.

## Task 1: Reporting Helpers

**Files:**
- Modify: `reporting.js`
- Create: `tests/reporting.test.js`

- [ ] **Step 1: Write failing tests for diagnostic payload shaping**

```js
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDiagnosticReportPayload,
  sanitizeDiagnosticDetails,
} = require("../reporting.js");

describe("sanitizeDiagnosticDetails", () => {
  test("keeps failed filenames and errors but strips raw asset URLs", () => {
    const details = sanitizeDiagnosticDetails({
      failedItems: [
        {
          filename: "IMG_1001.JPG",
          error: "Download interrupted",
          item: {
            url: "https://cvws.icloud-content.com/B/raw-signed-url",
            filename: "IMG_1001.JPG",
          },
        },
      ],
      errors: [
        {
          filename: "IMG_1002.JPG",
          error: "File system error",
          item: {
            url: "https://cvws.icloud-content.com/B/another-signed-url",
          },
        },
      ],
    });

    assert.deepEqual(details.failedItems, [
      { filename: "IMG_1001.JPG", error: "Download interrupted" },
    ]);
    assert.deepEqual(details.errors, [
      { filename: "IMG_1002.JPG", error: "File system error" },
    ]);
    assert.equal(JSON.stringify(details).includes("icloud-content.com"), false);
  });
});

describe("buildDiagnosticReportPayload", () => {
  test("omits albumUrl when includeAlbumUrl is false", () => {
    const payload = buildDiagnosticReportPayload({
      operation: "download",
      message: "3 files failed",
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      includeAlbumUrl: false,
      userAgent: "test browser",
      version: "1.6.0",
    });

    assert.equal(payload.kind, "diagnostic");
    assert.equal(payload.albumUrl, "");
    assert.equal(payload.userIncludedAlbumUrl, false);
  });

  test("includes albumUrl when includeAlbumUrl is true", () => {
    const payload = buildDiagnosticReportPayload({
      operation: "scan",
      message: "Scan failed",
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      includeAlbumUrl: true,
      userAgent: "test browser",
      version: "1.6.0",
    });

    assert.equal(payload.albumUrl, "https://www.icloud.com/sharedalbum/#SECRET");
    assert.equal(payload.userIncludedAlbumUrl, true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/reporting.test.js`

Expected: FAIL because `buildDiagnosticReportPayload` and `sanitizeDiagnosticDetails` are not exported from `reporting.js`.

- [ ] **Step 3: Implement minimal reporting helpers**

Add these helpers to `reporting.js` before `reportError`:

```js
function sanitizeDiagnosticEntries(entries) {
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 50).map((entry) => ({
    filename: entry?.filename || entry?.item?.filename || "(unknown)",
    error: entry?.error || entry?.message || "Unknown error",
  }));
}

function sanitizeDiagnosticDetails(details = {}) {
  return {
    completed: Number.isFinite(details.completed) ? details.completed : undefined,
    failed: Number.isFinite(details.failed) ? details.failed : undefined,
    total: Number.isFinite(details.total) ? details.total : undefined,
    filter: details.filter || "",
    failedItems: sanitizeDiagnosticEntries(details.failedItems),
    errors: sanitizeDiagnosticEntries(details.errors),
  };
}

function buildDiagnosticReportPayload(report) {
  const includeAlbumUrl = Boolean(report.includeAlbumUrl);
  return {
    kind: "diagnostic",
    operation: report.operation || "unknown",
    message: report.message || "Unknown error",
    stack: report.stack || "",
    albumUrl: includeAlbumUrl ? report.albumUrl || "" : "",
    userIncludedAlbumUrl: includeAlbumUrl,
    filter: report.filter || "",
    failedCount: report.failedCount,
    userAgent: report.userAgent || navigator.userAgent,
    details: sanitizeDiagnosticDetails(report.details || {}),
    version: report.version || chrome.runtime.getManifest().version,
  };
}

async function sendDiagnosticReport(report) {
  return postReport(buildDiagnosticReportPayload(report));
}
```

Export helpers for Node tests at the bottom of `reporting.js`:

```js
if (typeof module !== "undefined") {
  module.exports = {
    sanitizeDiagnosticDetails,
    buildDiagnosticReportPayload,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/reporting.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add reporting.js tests/reporting.test.js
git commit -m "feat: shape diagnostic reports"
```

## Task 2: Worker Diagnostic Slack Routing

**Files:**
- Modify: `cloudflare/error-reporter/src/index.js`
- Create: `tests/error-reporter-worker.test.js`

- [ ] **Step 1: Write failing Worker routing tests**

```js
const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("error reporter worker diagnostics", () => {
  let originalFetch;
  let posts;

  beforeEach(() => {
    originalFetch = global.fetch;
    posts = [];
    global.fetch = async (url, init) => {
      posts.push({ url, body: JSON.parse(init.body) });
      return new Response("ok", { status: 200 });
    };
    global.caches = {
      default: {
        match: async () => null,
        put: async () => {},
      },
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("routes diagnostic reports to the diagnostic webhook", async () => {
    const worker = (await import("../cloudflare/error-reporter/src/index.js")).default;
    const request = new Request("https://worker.test/report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret",
      },
      body: JSON.stringify({
        kind: "diagnostic",
        operation: "download",
        message: "3 files failed",
        albumUrl: "",
        userIncludedAlbumUrl: false,
        version: "1.6.0",
        userAgent: "test browser",
        details: { failed: 3 },
      }),
    });

    const response = await worker.fetch(request, {
      REPORT_SECRET: "secret",
      SLACK_ERROR_WEBHOOK_URL: "https://hooks.slack.test/error",
      SLACK_DIAGNOSTIC_WEBHOOK_URL: "https://hooks.slack.test/diagnostic",
    });

    assert.equal(response.status, 200);
    assert.equal(posts.length, 1);
    assert.equal(posts[0].url, "https://hooks.slack.test/diagnostic");
    assert.match(posts[0].body.text, /diagnostic/i);
  });

  test("rejects unsupported report kinds", async () => {
    const worker = (await import("../cloudflare/error-reporter/src/index.js")).default;
    const request = new Request("https://worker.test/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "unexpected",
        operation: "download",
        message: "bad kind",
      }),
    });

    const response = await worker.fetch(request, {
      SLACK_ERROR_WEBHOOK_URL: "https://hooks.slack.test/error",
      SLACK_DIAGNOSTIC_WEBHOOK_URL: "https://hooks.slack.test/diagnostic",
    });

    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { ok: false, error: "invalid_kind" });
    assert.equal(posts.length, 0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/error-reporter-worker.test.js`

Expected: FAIL because diagnostics still route through the error handler and unsupported kinds are not rejected.

- [ ] **Step 3: Implement diagnostic Worker routing**

In `cloudflare/error-reporter/src/index.js`:

```js
function diagnosticSlackWebhook(env) {
  return env.SLACK_DIAGNOSTIC_WEBHOOK_URL || errorSlackWebhook(env);
}

function buildDiagnosticSlackPayload(report) {
  const lines = [
    `*Operation:* ${report.operation}`,
    `*Version:* ${report.version || "unknown"}`,
    `*Browser:* ${truncate(report.userAgent, 200)}`,
    `*Album URL included:* ${report.userIncludedAlbumUrl ? "yes" : "no"}`,
  ];

  if (report.albumUrl) lines.push(`*Album URL:* ${report.albumUrl}`);
  if (report.filter) lines.push(`*Download filter:* ${report.filter}`);
  if (report.failedCount != null) lines.push(`*Failed files:* ${report.failedCount}`);

  lines.push("", `*Message:*\n${truncate(report.message, 1500)}`);

  if (report.stack) {
    lines.push("", `*Stack:*\n\`\`\`${truncate(report.stack, 1200)}\`\`\``);
  }

  if (report.details) {
    lines.push("", `*Details:*\n\`\`\`${truncate(JSON.stringify(report.details, null, 2), 1600)}\`\`\``);
  }

  return {
    text: `iCloud Album Downloader diagnostic: ${report.operation}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "iCloud Album Downloader - Diagnostic Report", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
    ],
  };
}

async function handleDiagnostic(body, env) {
  const webhookUrl = diagnosticSlackWebhook(env);
  if (!webhookUrl) {
    return jsonResponse({ ok: false, error: "server_misconfigured" }, 500);
  }

  await postToSlack(webhookUrl, buildDiagnosticSlackPayload(body));
  return jsonResponse({ ok: true });
}
```

Update `handleReport` so only `kind: "error"` and missing legacy `kind` route to `handleError`, `kind: "diagnostic"` routes to `handleDiagnostic`, and unsupported kinds return `invalid_kind`.

- [ ] **Step 4: Run Worker test to verify it passes**

Run: `node --test tests/error-reporter-worker.test.js`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add cloudflare/error-reporter/src/index.js tests/error-reporter-worker.test.js
git commit -m "feat: route diagnostic reports"
```

## Task 3: Popup UI and Background Message

**Files:**
- Modify: `popup/popup.html`
- Modify: `popup/popup.css`
- Modify: `popup/popup.js`
- Modify: `background.js`

- [ ] **Step 1: Add markup for rating and diagnostics**

In `popup/popup.html`, add a rating panel inside `#complete-section` after `#complete-errors`:

```html
<div id="rating-prompt" class="feedback-panel" style="display:none">
  <h3>Please rate this extension</h3>
  <p>Ratings help other people find it.</p>
  <button id="btn-rate-extension" class="btn btn-primary btn-block">Rate extension</button>
</div>
```

Add this diagnostic panel before the reset button:

```html
<div id="diagnostic-panel" class="feedback-panel diagnostic-panel" style="display:none">
  <h3>Send diagnostic report</h3>
  <p>The report includes browser details, extension version, and the full error log.</p>
  <label class="checkbox-row" for="include-album-url">
    <input type="checkbox" id="include-album-url" />
    <span>
      Include album URL
      <small>This makes troubleshooting much easier.</small>
    </span>
  </label>
  <button id="btn-send-diagnostic" class="btn btn-primary btn-block">Send to developer</button>
  <p id="diagnostic-status" class="hint diagnostic-status" style="display:none"></p>
</div>
```

Add one copy of the same diagnostic panel after `#btn-error-retry` in `#error-section`, or keep one global panel and move it with CSS-free DOM placement. Prefer a single global panel if the code stays simple.

- [ ] **Step 2: Add CSS**

In `popup/popup.css`, add:

```css
.feedback-panel {
  padding: 10px 12px;
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  background: var(--surface);
  margin-top: 10px;
}

.feedback-panel h3 {
  font-size: 13px;
  font-weight: 600;
  margin-bottom: 3px;
}

.feedback-panel p {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.4;
}

.checkbox-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 9px 0;
  font-size: 12px;
  color: var(--text);
}

.checkbox-row input {
  margin-top: 2px;
}

.checkbox-row small {
  display: block;
  color: var(--text-secondary);
  font-size: 11px;
  line-height: 1.35;
}

.diagnostic-status {
  color: var(--text-secondary);
}

.diagnostic-status.success {
  color: var(--success);
}

.diagnostic-status.error {
  color: var(--danger);
}
```

- [ ] **Step 3: Add background diagnostic message**

In `background.js`, add a message branch:

```js
if (msg.type === "send-diagnostic-report") {
  sendDiagnosticReport({
    operation: msg.operation || "popup",
    message: msg.message,
    stack: msg.stack,
    albumUrl: msg.albumUrl || "",
    includeAlbumUrl: Boolean(msg.includeAlbumUrl),
    filter: msg.filter || "",
    failedCount: msg.failedCount,
    details: msg.details || null,
    userAgent: msg.userAgent,
  })
    .then((result) => sendResponse({ ok: true, ...result }))
    .catch((err) => sendResponse({ ok: false, error: err.message }));
  return true;
}
```

- [ ] **Step 4: Add popup state and handlers**

In `popup/popup.js`, add DOM references for the rating and diagnostic controls. Add a `currentDiagnosticContext` variable. Add `showDiagnosticPanel(context)`, `hideDiagnosticPanel()`, `sendDiagnostic()`, `showRatingPrompt(show)`, and `openRatingPage()`.

Use this behavior:

```js
function showComplete(state) {
  showSection(completeSection);
  completeSummary.textContent = `${state.completed} of ${state.total} files downloaded successfully.`;

  if (state.failed > 0) {
    completeErrors.style.display = "block";
    completeErrorsText.textContent = `${state.failed} file(s) failed: ${state.errors.map((e) => e.filename).join(", ")}`;
    btnRetryFailed.style.display = "block";
    btnRetryFailed.textContent = `Retry failed (${state.failed})`;
    showRatingPrompt(false);
    showDiagnosticPanel({
      operation: "download",
      message: `${state.failed} of ${state.total} downloads failed`,
      albumUrl: state.albumUrl || albumURLInput.value.trim(),
      filter: state.filter || "",
      failedCount: state.failed,
      details: state,
    });
  } else {
    completeErrors.style.display = "none";
    btnRetryFailed.style.display = "none";
    hideDiagnosticPanel();
    showRatingPrompt(true);
  }
}
```

Use `showDiagnosticPanel` in real `showError` calls that pass report context. Do not show it for empty URL or malformed URL validation errors.

- [ ] **Step 5: Manual UI check**

Open `popup/popup.html` in a browser or load the unpacked extension. Manually verify:

- Success state has the rating prompt.
- Partial failure has retry plus diagnostic panel.
- The album URL checkbox starts unchecked.
- Send button disables while pending and displays sent or failed status.

- [ ] **Step 6: Commit**

```bash
git add popup/popup.html popup/popup.css popup/popup.js background.js
git commit -m "feat: add feedback prompts"
```

## Task 4: Docs and Full Verification

**Files:**
- Modify: `cloudflare/error-reporter/README.md`
- Modify: `cloudflare/error-reporter/wrangler.toml`

- [ ] **Step 1: Update Worker docs**

In `cloudflare/error-reporter/README.md`, add `SLACK_DIAGNOSTIC_WEBHOOK_URL` to the deploy instructions and add a diagnostic body example:

```json
{
  "kind": "diagnostic",
  "operation": "download",
  "message": "3 of 42 downloads failed",
  "albumUrl": "",
  "userIncludedAlbumUrl": false,
  "version": "1.6.0",
  "userAgent": "...",
  "filter": "all",
  "failedCount": 3,
  "details": {
    "completed": 39,
    "failed": 3,
    "errors": [
      { "filename": "IMG_1001.JPG", "error": "Download interrupted" }
    ]
  }
}
```

In `wrangler.toml`, add the secret setup comment:

```toml
#   npx wrangler secret put SLACK_DIAGNOSTIC_WEBHOOK_URL # user-submitted diagnostic reports
```

- [ ] **Step 2: Run all tests**

Run: `npm test`

Expected: all Node tests pass.

- [ ] **Step 3: Run build**

Run: `./build.sh`

Expected: Chrome and Firefox staging builds complete without errors.

- [ ] **Step 4: Commit docs**

```bash
git add cloudflare/error-reporter/README.md cloudflare/error-reporter/wrangler.toml
git commit -m "docs: document diagnostic webhook"
```

## Self-Review

- Spec coverage: success rating prompt is in Task 3, explicit Slack diagnostics are in Tasks 1 through 3, separate webhook is in Task 2, docs are in Task 4, and privacy behavior is tested in Task 1.
- Placeholder scan: no unresolved placeholders or missing implementation details are intentionally left in the plan.
- Type consistency: the message type is `send-diagnostic-report`, the report kind is `diagnostic`, and the Worker secret is `SLACK_DIAGNOSTIC_WEBHOOK_URL`.
