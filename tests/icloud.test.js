const { readFileSync } = require("fs");
const { join } = require("path");
const { test, describe } = require("node:test");
const assert = require("node:assert/strict");

const ICloud = require("../lib/icloud.js");

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/webstream-sample.json"), "utf8")
);
const mediaFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/webstream-video-live.json"), "utf8")
);

describe("extractToken", () => {
  test("parses hash URL", () => {
    assert.equal(
      ICloud.extractToken("https://www.icloud.com/sharedalbum/#B0aGWZGqDGHAhDX"),
      "B0aGWZGqDGHAhDX"
    );
  });

  test("returns null when no hash", () => {
    assert.equal(ICloud.extractToken("https://www.icloud.com/sharedalbum/"), null);
  });
});

describe("icloudErrorMessage", () => {
  test("maps 404", () => {
    assert.match(ICloud.icloudErrorMessage(404, "webstream"), /not found/i);
  });

  test("maps 429", () => {
    assert.match(ICloud.icloudErrorMessage(429, "webstream"), /rate-limit/i);
  });

  test("uses photo URLs label for webasseturls", () => {
    assert.match(ICloud.icloudErrorMessage(400, "webasseturls"), /photo URLs/);
  });
});

describe("parsePhotos", () => {
  test("picks largest derivative", () => {
    const parsed = ICloud.parsePhotos(fixture);
    assert.equal(parsed.length, 3);
    assert.equal(parsed[0].checksum, "full-checksum-aaa");
    assert.equal(parsed[0].fileSize, 3200000);
    assert.equal(parsed[1].checksum, "orig-checksum-bbb");
    assert.equal(parsed[1].fileSize, 5100000);
  });

  test("handles missing derivatives", () => {
    const parsed = ICloud.parsePhotos(fixture);
    assert.equal(parsed[2].checksum, null);
    assert.equal(parsed[2].fileSize, 0);
  });
});

describe("parsePhotos media metadata", () => {
  test("detects video from mediaAssetType and skips poster frame", () => {
    const parsed = ICloud.parsePhotos(mediaFixture);
    const video = parsed.find((p) => p.photoGuid.startsWith("1111"));
    assert.equal(video.mediaType, "video");
    assert.equal(video.checksum, "video-720-checksum");
    assert.equal(video.fileSize, 5400000);
  });

  test("detects live photo companion derivative", () => {
    const parsed = ICloud.parsePhotos(mediaFixture);
    const live = parsed.find((p) => p.photoGuid.startsWith("2222"));
    assert.equal(live.mediaType, "live-photo");
    assert.equal(live.checksum, "live-still-checksum");
    assert.equal(live.companionChecksum, "live-video-checksum");
  });

  test("resolveItemType prefers stream metadata over extension", () => {
    const parsed = ICloud.parsePhotos(mediaFixture);
    const video = parsed.find((p) => p.mediaType === "video");
    assert.equal(ICloud.resolveItemType(video, "/path/file.jpg"), "video");
  });
});

describe("classifyByExtension", () => {
  test("detects video extensions", () => {
    assert.equal(ICloud.classifyByExtension("/path/clip.MOV?o=1"), "video");
    assert.equal(ICloud.classifyByExtension("/path/clip.mp4"), "video");
  });

  test("defaults to photo", () => {
    assert.equal(ICloud.classifyByExtension("/path/IMG_1234.JPG"), "photo");
  });
});

describe("extractFilename", () => {
  test("strips query string", () => {
    assert.equal(
      ICloud.extractFilename("/B/Ab/xyz/IMG_1234.JPG?o=abc"),
      "IMG_1234.JPG"
    );
  });
});

describe("buildFilename", () => {
  test("uses item filename with optional prefix", () => {
    assert.equal(
      ICloud.buildFilename({ filename: "photo.jpg" }, { prefix: "Album" }),
      "Album/photo.jpg"
    );
  });

  test("derives name from url when filename missing", () => {
    assert.equal(
      ICloud.buildFilename({
        url: "https://cvws.icloud-content.com/B/Ab/xyz/IMG_9999.HEIC?o=1",
      }),
      "IMG_9999.HEIC"
    );
  });

  test("applies date-prefix pattern", () => {
    assert.equal(
      ICloud.buildFilename(
        { filename: "photo.jpg", dateCreated: "2024-03-15T12:00:00Z" },
        { pattern: "date-prefix" }
      ),
      "2024-03-15_photo.jpg"
    );
  });
});
