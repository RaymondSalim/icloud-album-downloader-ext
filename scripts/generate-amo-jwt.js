#!/usr/bin/env node
const crypto = require("crypto");

const { AMO_API_KEY, AMO_API_SECRET } = process.env;
if (!AMO_API_KEY || !AMO_API_SECRET) {
  console.error("AMO_API_KEY and AMO_API_SECRET are required");
  process.exit(1);
}

const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
const now = Math.floor(Date.now() / 1000);
const payload = Buffer.from(
  JSON.stringify({
    iss: AMO_API_KEY,
    jti: crypto.randomUUID(),
    iat: now,
    exp: now + 300,
  })
).toString("base64url");

const sig = crypto
  .createHmac("sha256", AMO_API_SECRET)
  .update(`${header}.${payload}`)
  .digest("base64url");

process.stdout.write(`${header}.${payload}.${sig}`);
