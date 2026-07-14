// Retry helper for chrome.runtime.sendMessage — works around the MV3 background
// wake-up race where the background page/worker hasn't finished restarting yet
// (affects both Chrome's service worker and Firefox's event page).
(function (root) {
  const CONNECTION_ERROR_PATTERN = /Could not establish connection|Receiving end does not exist/i;

  function isConnectionError(err) {
    return !!(err && CONNECTION_ERROR_PATTERN.test(err.message || ""));
  }

  async function sendMessageWithRetry(sendMessage, message, options = {}) {
    const retries = options.retries ?? 1;
    const delay = options.delay ?? 300;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await sendMessage(message);
      } catch (err) {
        lastErr = err;
        if (!isConnectionError(err) || attempt === retries) break;
        await sleep(delay);
      }
    }

    if (isConnectionError(lastErr)) {
      const err = new Error(
        "Couldn't reach the extension's background process. Try again — if it keeps happening, reload the extension."
      );
      err.name = "ExtensionConnectionError";
      err.cause = lastErr;
      throw err;
    }

    throw lastErr;
  }

  const api = { isConnectionError, sendMessageWithRetry };

  root.Messaging = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
