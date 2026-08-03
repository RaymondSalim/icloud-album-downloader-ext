# Feedback after download design

## Context

The extension currently reports some scan and download failures automatically through the background worker and Cloudflare Worker, which forwards errors to Slack. The popup has no success rating prompt. Failure UI only shows the error, retry controls in some cases, and a passive "reported automatically" hint when reporting succeeds.

The requested change is user-facing feedback after success and failure:

- On successful download completion, ask the user to rate the extension.
- On failure, let the user send the full error log to the maintainer through Slack.
- Add an option to include the album URL, with copy that explains it makes troubleshooting much easier.

## Assumptions

- Slack remains behind the existing Cloudflare Worker. The extension must not ship a Slack webhook.
- A new Slack webhook will be created for user-submitted diagnostic reports.
- The rating prompt should appear only after a fully successful download, meaning `failed === 0`.
- The diagnostic report should be sent only after the user clicks a send button.
- Album URL sharing is optional and unchecked by default. The UI should say that including it makes troubleshooting much easier.
- Automatic error reporting remains separate from user-submitted diagnostic reporting.

## Confirmed facts

- `popup/popup.js` owns the success and failure states.
- `background.js` already accepts `report-error` messages and emits automatic download failure reports.
- `reporting.js` posts reports to the configured Cloudflare Worker endpoint.
- `cloudflare/error-reporter/src/index.js` currently routes error reports to the configured error Slack webhook and daily counts to a summary webhook.
- The release build injects `REPORT_ENDPOINT` and `REPORT_SECRET`, while Slack webhooks live only in Cloudflare Worker secrets.

## Proposed design

The popup complete state will include a compact rating prompt under successful downloads:

- Title: `Please rate this extension`
- Supporting copy: `Ratings help other people find it.`
- Button: `Rate extension`

The rating button opens the browser-specific listing URL in a new tab. If a store URL is not configured yet, the implementation should keep the button hidden rather than linking to a placeholder.

Failure states will include an explicit diagnostic panel:

- It appears when a scan, download start, retry, cancel, or completed download has a real failure.
- It shows that the report includes browser details, extension version, operation, message, stack when available, and failed item details when available.
- It has a checkbox labeled `Include album URL` with helper copy stating that sharing it makes troubleshooting much easier.
- It has a `Send to developer` button that sends the diagnostic payload through the background worker.
- The button should show sent, failed, and sending states so the user gets immediate feedback.

Download completion with partial failures keeps the existing `Retry failed` control and adds the diagnostic panel below the error summary. A fully successful download shows the rating prompt and no diagnostic panel.

## Reporting architecture

Add a new report kind for explicit user diagnostics, separate from automatic errors:

- Popup sends a new background message: `send-diagnostic-report`.
- Background builds a report using popup-provided context plus extension version and browser data.
- `reporting.js` posts the payload to the existing Cloudflare Worker endpoint with `kind: "diagnostic"`.
- The Cloudflare Worker routes `kind: "diagnostic"` to a new webhook secret, for example `SLACK_DIAGNOSTIC_WEBHOOK_URL`.
- If the diagnostic webhook is missing, the Worker can fall back to the existing error webhook only if that behavior is documented.

This keeps automatic errors, daily counts, and user-submitted diagnostics operationally distinct.

## Privacy and security

The album URL must not be included in user-submitted diagnostics unless the user checks the box. The UI can strongly recommend sharing it, but default inclusion is a poor privacy tradeoff.

The diagnostic payload should avoid raw album item URLs. Failed item filenames and browser download errors are useful. Full asset URLs can include long signed iCloud content URLs and should be excluded unless a later design explicitly justifies them.

The Cloudflare Worker should continue rate limiting diagnostics. It should also truncate large fields before posting to Slack, consistent with the existing error report truncation.

## Failure modes

- Slack webhook missing: the UI should show that sending failed and suggest trying again later.
- Worker unavailable or rate-limited: the UI should show a failure state without clearing the original error.
- Popup closes while sending: no special recovery is required, since reports are convenience diagnostics.
- Duplicate clicks: disable the send button while a report is in flight.
- Automatic report and user diagnostic both fire for the same failure: this is acceptable because the diagnostic has explicit consent and fuller context, but Slack messages should be visibly labeled.

## Tests

Add narrow automated tests for pure report-shaping behavior where practical:

- Diagnostic payload excludes `albumUrl` when URL sharing is disabled.
- Diagnostic payload includes `albumUrl` when URL sharing is enabled.
- Diagnostic payload includes failed filenames and error messages without raw asset URLs.
- Worker routes `kind: "diagnostic"` to the diagnostic webhook.
- Worker rejects unsupported report kinds.

Add manual verification for popup UI because the repo currently has no browser UI test harness:

- Full success shows rating prompt.
- Partial failure shows retry plus diagnostic panel.
- Scan/download errors show diagnostic panel.
- Sending succeeds, fails, and disables duplicate clicks while pending.

## Recommendation

Implement Option B with the success rating prompt from Option A, but keep album URL sharing unchecked by default. This is the best balance across correctness, privacy, maintainability, and store compatibility.

Evidence that would falsify this recommendation: a store policy or user-support requirement that mandates explicit reports include album URLs by default, or existing support workflows proving URL-free diagnostics are usually useless.
