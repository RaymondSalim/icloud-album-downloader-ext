const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { extractTokenPrefix, sanitizeUserAgent, UA_MAX_LEN } = require("../lib/reporting-utils.js");

describe("extractTokenPrefix", () => {
  test("returns first 8 chars of album token", () => {
    assert.equal(
      extractTokenPrefix("https://www.icloud.com/sharedalbum/#B0aGWZGqDGHAhDX"),
      "B0aGWZGq"
    );
  });

  test("returns empty string when no hash", () => {
    assert.equal(extractTokenPrefix("https://www.icloud.com/sharedalbum/"), "");
  });
});

describe("sanitizeUserAgent", () => {
  test("truncates long user agents", () => {
    const long = "Mozilla/5.0 " + "x".repeat(200);
    const out = sanitizeUserAgent(long);
    assert.equal(out.length, UA_MAX_LEN + 1);
    assert.ok(out.endsWith("…"));
  });

  test("leaves short user agents unchanged", () => {
    const ua = "Mozilla/5.0 Test";
    assert.equal(sanitizeUserAgent(ua), ua);
  });
});
