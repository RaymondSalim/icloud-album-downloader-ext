// Privacy helpers for error/success reporting (importScripts + Node testable).
(function (root) {
  const UA_MAX_LEN = 120;

  function extractTokenPrefix(albumUrl) {
    if (!albumUrl || typeof albumUrl !== "string") return "";
    const match = albumUrl.match(/#(.+)$/);
    if (!match) return "";
    return match[1].substring(0, 8);
  }

  function sanitizeUserAgent(userAgent, maxLen = UA_MAX_LEN) {
    if (!userAgent || typeof userAgent !== "string") return "";
    if (userAgent.length <= maxLen) return userAgent;
    return `${userAgent.slice(0, maxLen)}…`;
  }

  const api = {
    extractTokenPrefix,
    sanitizeUserAgent,
    UA_MAX_LEN,
  };

  root.ReportingUtils = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
