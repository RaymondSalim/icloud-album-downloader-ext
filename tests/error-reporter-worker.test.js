const { describe, test, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert/strict");

describe("error reporter worker diagnostics", () => {
  let originalFetch;
  let originalCaches;
  let posts;

  beforeEach(() => {
    originalFetch = global.fetch;
    originalCaches = global.caches;
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
    global.caches = originalCaches;
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
