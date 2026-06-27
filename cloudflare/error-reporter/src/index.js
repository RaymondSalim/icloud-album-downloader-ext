const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SEC = 3600;
const KV_TTL_SEC = 60 * 60 * 24 * 4;

const COUNT_METRICS = {
  scan_ok: "scanOk",
  download_ok: "downloadOk",
};

const STAT_FIELDS = ["scanOk", "downloadOk", "errors"];

function truncate(text, max = 2800) {
  if (!text) return "";
  const s = String(text);
  return s.length <= max ? s : `${s.slice(0, max - 20)}\n…(truncated)`;
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function utcDateString(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function kvKey(date, field) {
  return `agg:${date}:${field}`;
}

function buildErrorSlackPayload(report) {
  const lines = [
    `*Operation:* ${report.operation}`,
    `*Version:* ${report.version || "unknown"}`,
    `*Browser:* ${truncate(report.userAgent, 200)}`,
  ];

  if (report.albumUrl) lines.push(`*Album URL:* ${report.albumUrl}`);
  if (report.filter) lines.push(`*Download filter:* ${report.filter}`);
  if (report.failedCount != null) lines.push(`*Failed files:* ${report.failedCount}`);

  lines.push("", `*Error:*\n${truncate(report.message, 1500)}`);

  if (report.stack) {
    lines.push("", `*Stack:*\n\`\`\`${truncate(report.stack, 1200)}\`\`\``);
  }

  if (report.details) {
    lines.push("", `*Details:*\n\`\`\`${truncate(JSON.stringify(report.details, null, 2), 1200)}\`\`\``);
  }

  return {
    text: `iCloud Album Downloader error: ${report.operation}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "iCloud Album Downloader — Error Report", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
    ],
  };
}

function buildDailyAggregateSlackPayload(stats) {
  const lines = [
    `*Date (UTC):* ${stats.date}`,
    `*Scan successes:* ${stats.scanOk ?? 0}`,
    `*Download successes:* ${stats.downloadOk ?? 0}`,
    `*Errors:* ${stats.errors ?? 0}`,
  ];

  return {
    text: `iCloud Album Downloader daily summary: ${stats.date}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "iCloud Album Downloader — Daily Summary", emoji: true },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: lines.join("\n") },
      },
    ],
  };
}

function isCountPayload(body) {
  return body.kind === "count";
}

function errorSlackWebhook(env) {
  return env.SLACK_ERROR_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
}

function summarySlackWebhook(env) {
  return env.SLACK_SUMMARY_WEBHOOK_URL || env.SLACK_WEBHOOK_URL;
}

async function postToSlack(webhookUrl, payload) {
  const slackRes = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!slackRes.ok) {
    throw new Error(`slack_failed:${slackRes.status}`);
  }
}

function telemetryKv(env) {
  return env.icloud_extension_telemetry;
}

async function incrementStat(env, date, field) {
  const kv = telemetryKv(env);
  if (!kv) return;

  const key = kvKey(date, field);
  const current = parseInt((await kv.get(key)) || "0", 10);
  await kv.put(key, String(current + 1), { expirationTtl: KV_TTL_SEC });
}

async function readDayStats(env, date) {
  const stats = { date, scanOk: 0, downloadOk: 0, errors: 0 };
  const kv = telemetryKv(env);
  if (!kv) return stats;

  for (const field of STAT_FIELDS) {
    const value = await kv.get(kvKey(date, field));
    stats[field] = parseInt(value || "0", 10);
  }

  return stats;
}

async function deleteDayStats(env, date) {
  const kv = telemetryKv(env);
  if (!kv) return;

  await Promise.all(
    STAT_FIELDS.map((field) => kv.delete(kvKey(date, field)))
  );
}

async function flushDayStats(env, date) {
  const webhookUrl = summarySlackWebhook(env);
  if (!webhookUrl) return;

  const stats = await readDayStats(env, date);
  const total = stats.scanOk + stats.downloadOk + stats.errors;
  if (total === 0) {
    await deleteDayStats(env, date);
    return;
  }

  await postToSlack(webhookUrl, buildDailyAggregateSlackPayload(stats));
  await deleteDayStats(env, date);
}

async function isRateLimited(request) {
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const hour = Math.floor(Date.now() / (RATE_LIMIT_WINDOW_SEC * 1000));
  const cacheKey = `https://rate-limit.local/${ip}/${hour}`;
  const cache = caches.default;

  const cached = await cache.match(cacheKey);
  const count = cached ? parseInt(await cached.text(), 10) + 1 : 1;

  if (count > RATE_LIMIT_MAX) return true;

  await cache.put(
    cacheKey,
    new Response(String(count), {
      headers: { "Cache-Control": `max-age=${RATE_LIMIT_WINDOW_SEC}` },
    })
  );

  return false;
}

async function authorize(request, env) {
  if (!env.REPORT_SECRET) return null;

  const auth = request.headers.get("Authorization") || "";
  if (auth !== `Bearer ${env.REPORT_SECRET}`) {
    return jsonResponse({ ok: false, error: "unauthorized" }, 401);
  }

  return null;
}

async function handleCount(body, env) {
  const field = COUNT_METRICS[body.metric];
  if (!field) {
    return jsonResponse({ ok: false, error: "invalid_metric" }, 400);
  }

  await incrementStat(env, utcDateString(), field);
  return jsonResponse({ ok: true });
}

async function handleError(body, env) {
  const webhookUrl = errorSlackWebhook(env);
  if (!webhookUrl) {
    return jsonResponse({ ok: false, error: "server_misconfigured" }, 500);
  }

  await incrementStat(env, utcDateString(), "errors");
  await postToSlack(webhookUrl, buildErrorSlackPayload(body));
  return jsonResponse({ ok: true });
}

async function handleReport(request, env) {
  const authError = await authorize(request, env);
  if (authError) return authError;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ ok: false, error: "invalid_json" }, 400);
  }

  if (isCountPayload(body)) {
    return handleCount(body, env);
  }

  if (!body.operation || !body.message) {
    return jsonResponse({ ok: false, error: "missing_fields" }, 400);
  }

  if (await isRateLimited(request)) {
    return jsonResponse({ ok: false, error: "rate_limited" }, 429);
  }

  try {
    return await handleError(body, env);
  } catch (err) {
    return jsonResponse({ ok: false, error: err.message }, 502);
  }
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/report" || request.method !== "POST") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    return handleReport(request, env);
  },

  async scheduled(_event, env) {
    if (!summarySlackWebhook(env)) return;

    const yesterday = utcDateString(-1);
    try {
      await flushDayStats(env, yesterday);
    } catch (err) {
      console.error("daily aggregate flush failed:", err.message);
    }
  },
};
