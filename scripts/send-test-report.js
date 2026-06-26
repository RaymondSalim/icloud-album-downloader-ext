#!/usr/bin/env node
/**
 * Sends a test error report using config.js at the repo root.
 * Usage: node scripts/send-test-report.js
 */

const fs = require("fs");
const path = require("path");

const configPath = path.join(__dirname, "..", "config.js");
if (!fs.existsSync(configPath)) {
  console.error("Missing config.js — copy config.example.js and fill it in.");
  process.exit(1);
}

const text = fs.readFileSync(configPath, "utf8");
const endpoint = text.match(/reportEndpoint:\s*"([^"]+)"/)?.[1];
const secret = text.match(/reportSecret:\s*"([^"]+)"/)?.[1];
const enabled = /enabled:\s*true/.test(text);

if (!enabled || !endpoint) {
  console.error("config.js must have enabled: true and a reportEndpoint.");
  process.exit(1);
}

const headers = { "Content-Type": "application/json" };
if (secret) headers.Authorization = `Bearer ${secret}`;

fetch(endpoint, {
  method: "POST",
  headers,
  body: JSON.stringify({
    operation: "test",
    message: "Test report — error reporting setup looks good",
    albumUrl: "https://www.icloud.com/sharedalbum/#TEST_TOKEN",
    version: "1.0.2",
    userAgent: "scripts/send-test-report.js",
    details: { source: "developer setup verification" },
  }),
})
  .then(async (res) => {
    const body = await res.text();
    console.log(`Status: ${res.status}`);
    console.log(`Body: ${body}`);
    if (!res.ok) process.exit(1);
  })
  .catch((err) => {
    console.error("Request failed:", err.message);
    process.exit(1);
  });
