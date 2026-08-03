const { readFileSync } = require("node:fs");
const { join } = require("node:path");
const vm = require("node:vm");
const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

function createElement(id) {
  return {
    id,
    checked: false,
    disabled: false,
    listeners: {},
    style: { display: "none", width: "" },
    textContent: "",
    value: "",
    addEventListener(event, handler) {
      this.listeners[event] = handler;
    },
  };
}

function loadPopup() {
  const elements = new Map();
  const ids = [
    "album-url",
    "btn-scan",
    "auto-detect-hint",
    "error-section",
    "error-text",
    "error-report-hint",
    "btn-error-retry",
    "loading-section",
    "loading-status",
    "loading-size-hint",
    "album-info",
    "album-title",
    "download-destination",
    "album-warning",
    "stat-total",
    "stat-photos",
    "stat-videos",
    "stat-size",
    "folder-name",
    "btn-download-all",
    "btn-download-photos",
    "btn-download-videos",
    "progress-section",
    "progress-bar",
    "progress-count",
    "progress-total",
    "progress-failed",
    "failed-count",
    "btn-cancel",
    "complete-section",
    "complete-icon",
    "complete-icon-symbol",
    "complete-heading",
    "complete-summary",
    "complete-errors",
    "complete-errors-text",
    "btn-retry-failed",
    "rating-prompt",
    "btn-rate-extension",
    "diagnostic-panel",
    "include-album-url",
    "btn-send-diagnostic",
    "diagnostic-status",
    "btn-reset",
  ];

  for (const id of ids) elements.set(`#${id}`, createElement(id));

  const context = {
    console,
    navigator: { userAgent: "test browser" },
    document: {
      querySelector(selector) {
        if (!elements.has(selector)) elements.set(selector, createElement(selector));
        return elements.get(selector);
      },
    },
    chrome: {
      runtime: {
        id: "abcdefghijklmnopqrstuvwxyabcdefghijkl",
        getManifest: () => ({ version: "1.6.0" }),
        onMessage: { addListener() {} },
        sendMessage: async () => ({ ok: true, state: { active: false, total: 0 } }),
      },
      tabs: {
        query: async () => [],
        create: async () => ({}),
      },
      storage: {
        session: {
          get: async () => ({}),
        },
      },
    },
    Messaging: {
      sendMessageWithRetry: async (send, message) => send(message),
    },
  };

  vm.createContext(context);
  vm.runInContext(
    readFileSync(join(__dirname, "../popup/popup.js"), "utf8"),
    context,
    { filename: "popup/popup.js" }
  );

  return { context, elements };
}

describe("popup feedback rendering", () => {
  test("shows rating prompt after a fully successful download", () => {
    const { context, elements } = loadPopup();

    context.showComplete({
      active: false,
      total: 4,
      completed: 4,
      failed: 0,
      errors: [],
      failedItems: [],
    });

    assert.equal(elements.get("#rating-prompt").style.display, "block");
    assert.equal(elements.get("#diagnostic-panel").style.display, "none");
    assert.equal(elements.get("#complete-heading").textContent, "Download Complete");
    assert.equal(elements.get("#complete-icon").className, "complete-icon success");
  });

  test("shows caution state, diagnostic panel, and leaves album URL unchecked after partial failure", () => {
    const { context, elements } = loadPopup();
    elements.get("#album-url").value = "https://www.icloud.com/sharedalbum/#SECRET";

    context.showComplete({
      active: false,
      total: 4,
      completed: 2,
      failed: 2,
      errors: [{ filename: "IMG_1001.JPG", error: "Download interrupted" }],
      failedItems: [],
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      filter: "all",
    });

    assert.equal(elements.get("#rating-prompt").style.display, "none");
    assert.equal(elements.get("#diagnostic-panel").style.display, "block");
    assert.equal(elements.get("#include-album-url").checked, false);
    assert.equal(elements.get("#complete-heading").textContent, "Download Finished with Issues");
    assert.equal(elements.get("#complete-icon").className, "complete-icon warning");
  });

  test("shows failure state when every download failed", () => {
    const { context, elements } = loadPopup();
    elements.get("#album-url").value = "https://www.icloud.com/sharedalbum/#SECRET";

    context.showComplete({
      active: false,
      total: 4,
      completed: 0,
      failed: 4,
      errors: [{ filename: "IMG_1001.JPG", error: "Download interrupted" }],
      failedItems: [],
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      filter: "all",
    });

    assert.equal(elements.get("#rating-prompt").style.display, "none");
    assert.equal(elements.get("#diagnostic-panel").style.display, "block");
    assert.equal(elements.get("#complete-heading").textContent, "Download Failed");
    assert.equal(elements.get("#complete-icon").className, "complete-icon danger");
  });
});
