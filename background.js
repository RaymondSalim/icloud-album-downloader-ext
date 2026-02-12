// ── iCloud Shared Album Downloader – Service Worker ──────────────────────────

const DEFAULT_HOST = "p23-sharedstreams.icloud.com";
const MAX_CONCURRENT_DOWNLOADS = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function extractToken(url) {
  // URLs look like: https://www.icloud.com/sharedalbum/#B0aGWZGqDGHAhDX
  const match = url.match(/#(.+)$/);
  return match ? match[1] : null;
}

async function postJSON(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  // iCloud uses HTTP 330 as a custom "use this host instead" redirect.
  // The response body still contains valid JSON with the redirect host.
  // Only reject on truly unexpected status codes.
  if (!res.ok && res.status !== 330) {
    throw new Error(`HTTP ${res.status} from ${url}`);
  }
  return res.json();
}

function buildBaseURL(host, token) {
  return `https://${host}/${token}/sharedstreams`;
}

function classifyByExtension(urlPath) {
  const lower = urlPath.toLowerCase();
  if (/\.(mov|mp4|m4v|avi|wmv|webm)(\?|$)/.test(lower)) return "video";
  return "photo";
}

function extractFilename(urlPath) {
  // URL path looks like: /B/Ab/.../IMG_1234.JPG?o=...
  const pathPart = urlPath.split("?")[0];
  const segments = pathPart.split("/");
  return segments[segments.length - 1] || "unknown";
}

// ── Core API ─────────────────────────────────────────────────────────────────

async function fetchStream(token) {
  let host = DEFAULT_HOST;
  let baseURL = buildBaseURL(host, token);

  let stream = await postJSON(`${baseURL}/webstream`, { streamCtag: null });

  // Handle host redirect
  const newHost = stream["X-Apple-MMe-Host"];
  if (newHost) {
    host = newHost;
    baseURL = buildBaseURL(host, token);
    stream = await postJSON(`${baseURL}/webstream`, { streamCtag: null });
  }

  return { stream, baseURL };
}

function parsePhotos(stream) {
  const photos = stream.photos || [];
  return photos.map((photo) => {
    const derivs = photo.derivatives || {};
    // Find the largest derivative (highest resolution original)
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

async function fetchAssetURLs(baseURL, photoGuids) {
  const data = await postJSON(`${baseURL}/webasseturls`, { photoGuids });
  const items = data.items || {};
  // items is keyed by checksum → { url_location, url_path }
  const urlMap = {};
  for (const [checksum, info] of Object.entries(items)) {
    urlMap[checksum] = `https://${info.url_location}${info.url_path}`;
  }
  return urlMap;
}

// ── Scan Album ───────────────────────────────────────────────────────────────

async function scanAlbum(albumURL) {
  const token = extractToken(albumURL);
  if (!token) throw new Error("Invalid iCloud shared album URL. Expected a URL with a # token.");

  const { stream, baseURL } = await fetchStream(token);
  const parsed = parsePhotos(stream);

  if (parsed.length === 0) {
    return { totalItems: 0, photos: 0, videos: 0, totalSize: 0, items: [] };
  }

  // Fetch asset URLs for all items
  const guids = parsed.map((p) => p.photoGuid);
  const urlMap = await fetchAssetURLs(baseURL, guids);

  // Build final item list with classification
  const items = [];
  let photoCount = 0;
  let videoCount = 0;
  let totalSize = 0;

  for (const p of parsed) {
    const url = urlMap[p.checksum];
    if (!url) continue; // thumbnail or unresolvable

    const filename = extractFilename(url);
    const type = classifyByExtension(url);

    if (type === "video") videoCount++;
    else photoCount++;
    totalSize += p.fileSize;

    items.push({
      photoGuid: p.photoGuid,
      checksum: p.checksum,
      url,
      filename,
      type,
      fileSize: p.fileSize,
      dateCreated: p.dateCreated,
    });
  }

  return {
    totalItems: items.length,
    photos: photoCount,
    videos: videoCount,
    totalSize,
    items,
    baseURL,
    token,
  };
}

// ── Download Manager ─────────────────────────────────────────────────────────

let downloadState = {
  active: false,
  total: 0,
  completed: 0,
  failed: 0,
  skipped: 0,
  currentItems: [],
  errors: [],
};

function resetDownloadState() {
  downloadState = {
    active: false,
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    currentItems: [],
    errors: [],
  };
}

async function downloadFile(item, folderPrefix) {
  const filename = folderPrefix ? `${folderPrefix}/${item.filename}` : item.filename;
  return new Promise((resolve) => {
    chrome.downloads.download(
      {
        url: item.url,
        filename,
        conflictAction: "uniquify",
        saveAs: false,
      },
      (downloadId) => {
        if (chrome.runtime.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message, item });
        } else {
          resolve({ success: true, downloadId, item });
        }
      }
    );
  });
}

async function downloadAll(items, filter, folderPrefix) {
  resetDownloadState();

  // Filter items by type
  let toDownload = items;
  if (filter === "photos") toDownload = items.filter((i) => i.type === "photo");
  else if (filter === "videos") toDownload = items.filter((i) => i.type === "video");

  downloadState.active = true;
  downloadState.total = toDownload.length;
  broadcastProgress();

  // Download in batches with concurrency control
  const queue = [...toDownload];
  const inFlight = new Set();

  while ((queue.length > 0 || inFlight.size > 0) && downloadState.active) {
    while (inFlight.size < MAX_CONCURRENT_DOWNLOADS && queue.length > 0 && downloadState.active) {
      const item = queue.shift();
      const promise = downloadFile(item, folderPrefix)
        .then((result) => {
          inFlight.delete(promise);
          if (result.success) {
            downloadState.completed++;
          } else {
            downloadState.failed++;
            downloadState.errors.push({ filename: result.item.filename, error: result.error });
          }
          broadcastProgress();
        })
        .catch((err) => {
          inFlight.delete(promise);
          downloadState.failed++;
          downloadState.errors.push({ filename: item.filename, error: err.message });
          broadcastProgress();
        });
      inFlight.add(promise);
    }
    // Wait for at least one to finish
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  downloadState.active = false;
  broadcastProgress();
}

function broadcastProgress() {
  chrome.runtime.sendMessage({
    type: "download-progress",
    state: { ...downloadState },
  }).catch(() => {
    // Popup might be closed — ignore
  });
}

// ── Message Router ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "scan") {
    scanAlbum(msg.url)
      .then((result) => sendResponse({ ok: true, data: result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true; // async response
  }

  if (msg.type === "download") {
    // Start downloads in background — don't await.
    // Progress is reported via broadcastProgress().
    downloadAll(msg.items, msg.filter, msg.folder).catch((err) => {
      downloadState.active = false;
      downloadState.errors.push({ filename: "(global)", error: err.message });
      broadcastProgress();
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === "get-progress") {
    sendResponse({ ok: true, state: { ...downloadState } });
    return false;
  }

  if (msg.type === "cancel") {
    // Clear the queue by marking inactive — in-flight downloads will complete
    downloadState.active = false;
    sendResponse({ ok: true });
    return false;
  }
});
