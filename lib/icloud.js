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
    if (/\.(mov|mp4|m4v|avi|wmv|webm)(\?|$)/.test(lower)) return "video";
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
      let best = null;
      for (const key of Object.keys(derivs)) {
        const d = derivs[key];
        const size = parseInt(d.fileSize, 10) || 0;
        if (!best || size > best.size) {
          best = { checksum: d.checksum, size, key };
        }
      }
      return {
        photoGuid: photo.photoGuid,
        checksum: best ? best.checksum : null,
        fileSize: best ? best.size : 0,
        dateCreated: photo.dateCreated,
        caption: photo.caption,
        batchGuid: photo.batchGuid,
      };
    });
  }

  function buildFilename(item, options = {}) {
    const prefix = options.prefix || "";
    const name = item.filename || (item.url ? extractFilename(new URL(item.url).pathname) : "unknown");
    return prefix ? `${prefix}/${name}` : name;
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
