const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_SEC = 3600;

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

function buildSlackPayload(report) {
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

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/report" || request.method !== "POST") {
      return jsonResponse({ ok: false, error: "not_found" }, 404);
    }

    if (!env.SLACK_WEBHOOK_URL) {
      return jsonResponse({ ok: false, error: "server_misconfigured" }, 500);
    }

    if (env.REPORT_SECRET) {
      const auth = request.headers.get("Authorization") || "";
      if (auth !== `Bearer ${env.REPORT_SECRET}`) {
        return jsonResponse({ ok: false, error: "unauthorized" }, 401);
      }
    }

    if (await isRateLimited(request)) {
      return jsonResponse({ ok: false, error: "rate_limited" }, 429);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ ok: false, error: "invalid_json" }, 400);
    }

    if (!body.operation || !body.message) {
      return jsonResponse({ ok: false, error: "missing_fields" }, 400);
    }

    try {
      const slackRes = await fetch(env.SLACK_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildSlackPayload(body)),
      });

      if (!slackRes.ok) {
        return jsonResponse({ ok: false, error: "slack_failed", status: slackRes.status }, 502);
      }

      return jsonResponse({ ok: true });
    } catch (err) {
      return jsonResponse({ ok: false, error: err.message }, 502);
    }
  },
};
