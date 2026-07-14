const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const { isConnectionError, sendMessageWithRetry } = require("../lib/messaging.js");

function connectionError() {
  return new Error("Could not establish connection. Receiving end does not exist.");
}

describe("isConnectionError", () => {
  test("matches Chrome's receiving-end error", () => {
    assert.equal(isConnectionError(connectionError()), true);
  });

  test("does not match unrelated errors", () => {
    assert.equal(isConnectionError(new Error("Album not found")), false);
  });

  test("handles null/undefined safely", () => {
    assert.equal(isConnectionError(null), false);
    assert.equal(isConnectionError(undefined), false);
  });
});

describe("sendMessageWithRetry", () => {
  test("returns the result on first success, no retry", async () => {
    let calls = 0;
    const sendMessage = async (msg) => {
      calls++;
      return { ok: true, msg };
    };

    const result = await sendMessageWithRetry(sendMessage, { type: "scan" }, { sleep: async () => {} });

    assert.deepEqual(result, { ok: true, msg: { type: "scan" } });
    assert.equal(calls, 1);
  });

  test("retries once after a connection error, then succeeds", async () => {
    let calls = 0;
    const sendMessage = async () => {
      calls++;
      if (calls === 1) throw connectionError();
      return { ok: true };
    };

    const result = await sendMessageWithRetry(sendMessage, { type: "scan" }, { sleep: async () => {} });

    assert.deepEqual(result, { ok: true });
    assert.equal(calls, 2);
  });

  test("throws a friendly ExtensionConnectionError when retries exhausted", async () => {
    let calls = 0;
    const sendMessage = async () => {
      calls++;
      throw connectionError();
    };

    await assert.rejects(
      () => sendMessageWithRetry(sendMessage, { type: "scan" }, { sleep: async () => {} }),
      (err) => {
        assert.equal(err.name, "ExtensionConnectionError");
        assert.match(err.message, /background process/i);
        return true;
      }
    );
    assert.equal(calls, 2); // initial attempt + 1 retry
  });

  test("does not retry non-connection errors", async () => {
    let calls = 0;
    const sendMessage = async () => {
      calls++;
      throw new Error("Album not found");
    };

    await assert.rejects(
      () => sendMessageWithRetry(sendMessage, { type: "scan" }, { sleep: async () => {} }),
      /Album not found/
    );
    assert.equal(calls, 1);
  });

  test("respects a custom retries count", async () => {
    let calls = 0;
    const sendMessage = async () => {
      calls++;
      throw connectionError();
    };

    await assert.rejects(() =>
      sendMessageWithRetry(sendMessage, { type: "scan" }, { retries: 3, sleep: async () => {} })
    );
    assert.equal(calls, 4); // initial attempt + 3 retries
  });
});
