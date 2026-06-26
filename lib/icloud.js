// iCloud shared-album helpers (importScripts + Node testable).
(function (root) {
  const DEFAULT_HOST = "p23-sharedstreams.icloud.com";

  let httpFetch = typeof fetch === "function" ? fetch.bind(globalThis) : null;

  function setFetchForTests(fn) {
    httpFetch = fn;
  }

  function extractToken(url) {
    const match = url.match(/#(.+)$/);
    return match ? match[1] : null;
  }

  function icloudErrorMessage(status, operation) {
    if (status === 404) {
      return "Album not found. Double-check the shared album URL and make sure the album is still publicly shared.";
    }
    if (status === 403) {
      return "Access denied. This album may no longer be publicly shared.";
    }
    if (status === 429) {
      return "iCloud is rate-limiting requests. Wait a minute and try again.";
    }
    if (status >= 500) {
      return "iCloud's servers returned an error. Try again in a few minutes.";
    }
    const label = operation === "webasseturls" ? "photo URLs" : "album";
    return `Could not load ${label} from iCloud (HTTP ${status}). Try again later.`;
  }

  function classifyByExtension(urlPath) {
    const lower = urlPath.toLowerCase();
    if (/\.(mov|mp4|m4v|avi|wmv|webm|hevc)(\?|$)/.test(lower)) return "video";
    return "photo";
  }

  const DERIVATIVE_SKIP_KEY = /thumb|square|poster|preview/i;
  const LIVE_COMPANION_KEY = /video|hevc|mov|live|companion/i;

  function derivativeFileSize(d) {
    return parseInt(d.fileSize, 10) || 0;
  }

  function isVideoPhoto(photo) {
    const mediaType = (photo.mediaAssetType || "").toLowerCase();
    return mediaType === "video" || mediaType === "movie";
  }

  function findLiveCompanionDerivative(derivs) {
    let best = null;
    for (const [key, d] of Object.entries(derivs)) {
      if (!LIVE_COMPANION_KEY.test(key)) continue;
      const size = derivativeFileSize(d);
      if (!best || size > best.size) {
        best = { checksum: d.checksum, size, key };
      }
    }
    return best;
  }

  function pickBestDerivative(derivs, { forVideo = false } = {}) {
    let best = null;
    for (const [key, d] of Object.entries(derivs)) {
      if (DERIVATIVE_SKIP_KEY.test(key)) continue;
      if (forVideo && /^posterframe$/i.test(key)) continue;
      if (!forVideo && LIVE_COMPANION_KEY.test(key)) continue;

      const size = derivativeFileSize(d);
      if (!best || size > best.size) {
        best = { checksum: d.checksum, size, key };
      }
    }
    return best;
  }

  function classifyPhotoMedia(photo) {
    if (isVideoPhoto(photo)) return "video";
    const derivs = photo.derivatives || {};
    if (findLiveCompanionDerivative(derivs)) return "live-photo";
    return "photo";
  }

  function resolveItemType(parsed, urlPath) {
    if (parsed.mediaType === "video") return "video";
    if (classifyByExtension(urlPath) === "video") return "video";
    return "photo";
  }

  function extractFilename(urlPath) {
    const pathPart = urlPath.split("?")[0];
    const segments = pathPart.split("/");
    return segments[segments.length - 1] || "unknown";
  }

  function parsePhotos(stream) {
    const photos = stream.photos || [];
    return photos.map((photo) => {
      const derivs = photo.derivatives || {};
      const mediaType = classifyPhotoMedia(photo);
      const best = pickBestDerivative(derivs, { forVideo: mediaType === "video" });
      const companion =
        mediaType === "live-photo" ? findLiveCompanionDerivative(derivs) : null;

      return {
        photoGuid: photo.photoGuid,
        checksum: best ? best.checksum : null,
        fileSize: best ? best.size : 0,
        mediaType,
        companionChecksum: companion ? companion.checksum : null,
        companionFileSize: companion ? companion.size : 0,
        dateCreated: photo.dateCreated,
        caption: photo.caption,
        batchGuid: photo.batchGuid,
      };
    });
  }

  function buildFilename(item, options = {}) {
    const folderPrefix = options.prefix || "";
    let name = item.filename || (item.url ? extractFilename(new URL(item.url).pathname) : "unknown");

    if (options.pattern === "date-prefix" && item.dateCreated) {
      const d = new Date(item.dateCreated);
      if (!Number.isNaN(d.getTime())) {
        name = `${d.toISOString().slice(0, 10)}_${name}`;
      }
    }

    return folderPrefix ? `${folderPrefix}/${name}` : name;
  }

  function buildBaseURL(host, token) {
    return `https://${host}/${token}/sharedstreams`;
  }

  function chunkGuids(guids, chunkSize) {
    const chunks = [];
    for (let i = 0; i < guids.length; i += chunkSize) {
      chunks.push(guids.slice(i, i + chunkSize));
    }
    return chunks;
  }

  function mergeAssetItems(urlMap, data) {
    const items = data.items || {};
    for (const [checksum, info] of Object.entries(items)) {
      urlMap.set(checksum, `https://${info.url_location}${info.url_path}`);
    }
  }

  async function postJSON(url, body, operation = "webstream", options = {}) {
    const maxRetries = options.retries ?? 3;
    const sleep = options.sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const doFetch = options.fetch || httpFetch;
    if (!doFetch) {
      throw new Error("fetch is not available");
    }

    let attempt = 0;
    while (true) {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (res.ok || res.status === 330) {
        return res.json();
      }

      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable || attempt >= maxRetries) {
        const err = new Error(icloudErrorMessage(res.status, operation));
        err.name = "ICloudAPIError";
        err.status = res.status;
        err.url = url;
        err.operation = operation;
        throw err;
      }

      const delay = Math.min(1000 * 2 ** attempt, 30000);
      await sleep(delay);
      attempt++;
    }
  }

  async function fetchStream(token, options = {}) {
    let host = DEFAULT_HOST;
    let baseURL = buildBaseURL(host, token);

    let stream = await postJSON(`${baseURL}/webstream`, { streamCtag: null }, "webstream", options);

    const newHost = stream["X-Apple-MMe-Host"];
    if (newHost) {
      host = newHost;
      baseURL = buildBaseURL(host, token);
      stream = await postJSON(`${baseURL}/webstream`, { streamCtag: null }, "webstream", options);
    }

    return { stream, baseURL };
  }

  async function fetchAssetURLs(baseURL, photoGuids, options = {}) {
    const chunkSize = options.chunkSize ?? 100;
    const chunks = chunkGuids(photoGuids, chunkSize);
    const urlMap = new Map();
    let done = 0;
    const total = photoGuids.length;

    for (const chunk of chunks) {
      const data = await postJSON(
        `${baseURL}/webasseturls`,
        { photoGuids: chunk },
        "webasseturls",
        options
      );
      mergeAssetItems(urlMap, data);
      done += chunk.length;
      if (options.onProgress) {
        options.onProgress(done, total);
      }
    }

    return urlMap;
  }

  const api = {
    DEFAULT_HOST,
    extractToken,
    icloudErrorMessage,
    parsePhotos,
    classifyByExtension,
    classifyPhotoMedia,
    pickBestDerivative,
    findLiveCompanionDerivative,
    isVideoPhoto,
    resolveItemType,
    extractFilename,
    buildFilename,
    buildBaseURL,
    chunkGuids,
    postJSON,
    fetchStream,
    fetchAssetURLs,
  };

  root.ICloud = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { ...api, setFetchForTests };
  }
})(typeof globalThis !== "undefined" ? globalThis : typeof self !== "undefined" ? self : this);
