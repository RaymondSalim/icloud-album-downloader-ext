const { describe, test } = require("node:test");
const assert = require("node:assert/strict");

const {
  buildDiagnosticReportPayload,
  sanitizeDiagnosticDetails,
} = require("../reporting.js");

describe("sanitizeDiagnosticDetails", () => {
  test("keeps failed filenames and errors but strips raw asset URLs", () => {
    const details = sanitizeDiagnosticDetails({
      failedItems: [
        {
          filename: "IMG_1001.JPG",
          error: "Download interrupted",
          item: {
            url: "https://cvws.icloud-content.com/B/raw-signed-url",
            filename: "IMG_1001.JPG",
          },
        },
      ],
      errors: [
        {
          filename: "IMG_1002.JPG",
          error: "File system error",
          item: {
            url: "https://cvws.icloud-content.com/B/another-signed-url",
          },
        },
      ],
    });

    assert.deepEqual(details.failedItems, [
      { filename: "IMG_1001.JPG", error: "Download interrupted" },
    ]);
    assert.deepEqual(details.errors, [
      { filename: "IMG_1002.JPG", error: "File system error" },
    ]);
    assert.equal(JSON.stringify(details).includes("icloud-content.com"), false);
  });
});

describe("buildDiagnosticReportPayload", () => {
  test("omits albumUrl when includeAlbumUrl is false", () => {
    const payload = buildDiagnosticReportPayload({
      operation: "download",
      message: "3 files failed",
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      includeAlbumUrl: false,
      userAgent: "test browser",
      version: "1.7.0",
    });

    assert.equal(payload.kind, "diagnostic");
    assert.equal(payload.albumUrl, "");
    assert.equal(payload.userIncludedAlbumUrl, false);
  });

  test("includes albumUrl when includeAlbumUrl is true", () => {
    const payload = buildDiagnosticReportPayload({
      operation: "scan",
      message: "Scan failed",
      albumUrl: "https://www.icloud.com/sharedalbum/#SECRET",
      includeAlbumUrl: true,
      userAgent: "test browser",
      version: "1.7.0",
    });

    assert.equal(payload.albumUrl, "https://www.icloud.com/sharedalbum/#SECRET");
    assert.equal(payload.userIncludedAlbumUrl, true);
  });
});
