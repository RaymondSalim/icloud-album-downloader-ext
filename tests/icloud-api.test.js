const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const ICloud = require("../lib/icloud.js");
const { setFetchForTests } = require("../lib/icloud.js");

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function makeGuids(count) {
  return Array.from({ length: count }, (_, i) => `guid-${String(i).padStart(3, "0")}`);
}

describe("chunkGuids", () => {
  test("splits 250 GUIDs into 3 chunks of 100, 100, 50", () => {
    const guids = makeGuids(250);
    const chunks = ICloud.chunkGuids(guids, 100);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].length, 100);
    assert.equal(chunks[1].length, 100);
    assert.equal(chunks[2].length, 50);
  });
});

describe("fetchAssetURLs", () => {
  test("issues one POST per chunk", async () => {
    const guids = makeGuids(250);
    const bodies = [];
    const baseURL = "https://p23-sharedstreams.icloud.com/TOKEN/sharedstreams";

    setFetchForTests(async (_url, init) => {
      bodies.push(JSON.parse(init.body));
      const checksum = `cs-${bodies.length}`;
      return mockResponse(200, {
        items: {
          [checksum]: { url_location: "cvws.icloud-content.com", url_path: `/path/${checksum}.jpg` },
        },
      });
    });

    const progress = [];
    const urlMap = await ICloud.fetchAssetURLs(baseURL, guids, {
      chunkSize: 100,
      onProgress: (done, total) => progress.push({ done, total }),
    });

    assert.equal(bodies.length, 3);
    assert.equal(bodies[0].photoGuids.length, 100);
    assert.equal(bodies[1].photoGuids.length, 100);
    assert.equal(bodies[2].photoGuids.length, 50);
    assert.equal(urlMap.size, 3);
    assert.deepEqual(progress, [
      { done: 100, total: 250 },
      { done: 200, total: 250 },
      { done: 250, total: 250 },
    ]);
  });
});

describe("postJSON", () => {
  test("retries on 429 with exponential backoff", async () => {
    let calls = 0;
    const delays = [];
    const sleep = async (ms) => {
      delays.push(ms);
    };

    setFetchForTests(async () => {
      calls++;
      if (calls < 3) {
        return mockResponse(429, {});
      }
      return mockResponse(200, { ok: true });
    });

    const result = await ICloud.postJSON(
      "https://example.com/webstream",
      { streamCtag: null },
      "webstream",
      { sleep, retries: 3 }
    );

    assert.equal(calls, 3);
    assert.deepEqual(delays, [1000, 2000]);
    assert.deepEqual(result, { ok: true });
  });

  test("retries on 5xx up to retries limit", async () => {
    let calls = 0;
    setFetchForTests(async () => {
      calls++;
      return mockResponse(503, {});
    });

    await assert.rejects(
      () =>
        ICloud.postJSON(
          "https://example.com/webstream",
          {},
          "webstream",
          { sleep: async () => {}, retries: 3 }
        ),
      (err) => err.name === "ICloudAPIError" && err.status === 503
    );

    assert.equal(calls, 4);
  });

  test("does not retry 404", async () => {
    let calls = 0;
    setFetchForTests(async () => {
      calls++;
      return mockResponse(404, {});
    });

    await assert.rejects(
      () =>
        ICloud.postJSON("https://example.com/webstream", {}, "webstream", {
          sleep: async () => {},
        }),
      (err) => err.status === 404
    );

    assert.equal(calls, 1);
  });
});
