// ── Error reporting (via Cloudflare Worker proxy) ─────────────────────────────

const REPORT_DEDUP_MS = 60_000;
const recentReports = new Map();

const { extractTokenPrefix, sanitizeUserAgent } = self.ReportingUtils;

function getReportingConfig() {
  return self.REPORTING_CONFIG || { enabled: false, reportEndpoint: "", reportSecret: "" };
}

function dedupKey(payload) {
  if (payload.kind === "event") {
    return ["event", payload.event, payload.itemCount, payload.failedCount].join("|");
  }
  return [payload.operation, payload.message, payload.tokenPrefix || ""].join("|");
}

function shouldReport(key) {
  const now = Date.now();
  const last = recentReports.get(key);
  if (last && now - last < REPORT_DEDUP_MS) return false;
  recentReports.set(key, now);
  return true;
}

async function postReport(payload) {
  const config = getReportingConfig();
  if (!config.enabled) return { sent: false, reason: "disabled" };
  if (!config.reportEndpoint) return { sent: false, reason: "no_endpoint" };

  const key = dedupKey(payload);
  if (!shouldReport(key)) return { sent: false, reason: "deduplicated" };

  const headers = { "Content-Type": "application/json" };
  if (config.reportSecret) {
    headers.Authorization = `Bearer ${config.reportSecret}`;
  }

  try {
    const res = await fetch(config.reportEndpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      console.warn("[reporting] Worker returned:", res.status);
      return { sent: false, reason: `http-${res.status}` };
    }

    return { sent: true };
  } catch (err) {
    console.warn("[reporting] Failed to send report:", err.message);
    return { sent: false, reason: err.message };
  }
}

async function reportError(report) {
  const payload = {
    kind: "error",
    operation: report.operation || "unknown",
    message: report.message || "Unknown error",
    stack: report.stack || "",
    tokenPrefix: extractTokenPrefix(report.albumUrl || ""),
    filter: report.filter || "",
    failedCount: report.failedCount,
    userAgent: sanitizeUserAgent(report.userAgent || navigator.userAgent),
    details: report.details || null,
    version: chrome.runtime.getManifest().version,
  };

  return postReport(payload);
}

async function reportEvent(event) {
  const payload = {
    kind: "event",
    event: event.event,
    version: chrome.runtime.getManifest().version,
    itemCount: event.itemCount ?? 0,
    failedCount: event.failedCount ?? 0,
  };

  return postReport(payload);
}
