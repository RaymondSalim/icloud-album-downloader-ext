// ── iCloud Shared Album Downloader – Service Worker ──────────────────────────

// config.js may already be loaded (Firefox manifest). Chrome loads it via importScripts below.
if (!self.REPORTING_CONFIG) {
  self.REPORTING_CONFIG = { enabled: false, reportEndpoint: "", reportSecret: "" };
}
try {
  importScripts("config.js");
} catch {
  // Firefox loads config.js via manifest background.scripts when importScripts is unavailable.
}
try {
  importScripts("reporting.js");
} catch {
  // Firefox loads reporting.js via manifest background.scripts
}
try {
  importScripts("lib/icloud.js");
} catch {
  // Firefox loads lib/icloud.js via manifest background.scripts
}
try {
  importScripts("lib/settings.js");
} catch {
  // Firefox loads lib/settings.js via manifest background.scripts
}

const {
  extractToken,
  parsePhotos,
  extractFilename,
  fetchStream,
  fetchAssetURLs,
  buildFilename,
  resolveItemType,
} = self.ICloud;

const DOWNLOAD_JOB_KEY = "downloadJob";
const NOTIFICATION_ID = "download-complete";

let stateRestored = false;

function isUserFacingAPIError(err) {
  return err && err.name === "ICloudAPIError" && err.status === 404;
}

function broadcastScanProgress(done, total, extra = {}) {
  chrome.runtime.sendMessage({
    type: "scan-progress",
    phase: extra.phase || "resolving",
    done,
    total,
    estimatedSize: extra.estimatedSize,
  }).catch(() => {
    // Popup might be closed
  });
}

// ── Scan Album ───────────────────────────────────────────────────────────────

async function scanAlbum(albumURL) {
  const token = extractToken(albumURL);
  if (!token) throw new Error("Invalid iCloud shared album URL. Expected a URL with a # token.");

  const { stream, baseURL } = await fetchStream(token);
  const parsed = parsePhotos(stream);
  const albumTitle = stream.streamName || stream.albumName || stream.title || null;

  if (parsed.length === 0) {
    return {
      totalItems: 0,
      photos: 0,
      videos: 0,
      heicCount: 0,
      livePhotoCount: 0,
      totalSize: 0,
      items: [],
      albumTitle,
    };
  }

  const estimatedSize = parsed.reduce((sum, p) => sum + p.fileSize, 0);
  broadcastScanProgress(0, parsed.length, { phase: "resolving", estimatedSize });

  // Fetch asset URLs for all items (chunked for large albums)
  const guids = parsed.map((p) => p.photoGuid);
  const urlMap = await fetchAssetURLs(baseURL, guids, {
    onProgress: (done, total) => {
      broadcastScanProgress(done, total, { phase: "resolving", estimatedSize });
    },
  });

  // Build final item list with classification
  const items = [];
  let photoCount = 0;
  let videoCount = 0;
  let heicCount = 0;
  let livePhotoCount = 0;
  let totalSize = 0;

  for (const p of parsed) {
    const url = urlMap.get(p.checksum);
    if (!url) continue;

    const filename = extractFilename(url);
    const type = resolveItemType(p, url);

    if (type === "video") videoCount++;
    else photoCount++;
    if (p.mediaType === "live-photo") livePhotoCount++;
    if (/\.heic$/i.test(filename)) heicCount++;
    totalSize += p.fileSize;

    let liveCompanion = null;
    if (p.companionChecksum) {
      const companionUrl = urlMap.get(p.companionChecksum);
      if (companionUrl) {
        liveCompanion = {
          url: companionUrl,
          filename: extractFilename(companionUrl),
          fileSize: p.companionFileSize,
          checksum: p.companionChecksum,
        };
      }
    }

    items.push({
      photoGuid: p.photoGuid,
      checksum: p.checksum,
      url,
      filename,
      type,
      mediaType: p.mediaType,
      fileSize: p.fileSize,
      dateCreated: p.dateCreated,
      liveCompanion,
    });
  }

  return {
    totalItems: items.length,
    photos: photoCount,
    videos: videoCount,
    heicCount,
    livePhotoCount,
    totalSize,
    items,
    baseURL,
    token,
    albumTitle,
  };
}

function expandDownloadItems(items, includeLivePhotoVideos) {
  if (!includeLivePhotoVideos) return items;

  const expanded = [];
  for (const item of items) {
    expanded.push(item);
    if (!item.liveCompanion?.url) continue;

    expanded.push({
      photoGuid: `${item.photoGuid}:live`,
      checksum: item.liveCompanion.checksum,
      url: item.liveCompanion.url,
      filename: item.liveCompanion.filename,
      type: "video",
      fileSize: item.liveCompanion.fileSize,
      dateCreated: item.dateCreated,
      isLiveCompanion: true,
    });
  }
  return expanded;
}

function createEmptyDownloadState() {
  return {
    active: false,
    total: 0,
    completed: 0,
    failed: 0,
    skipped: 0,
    currentItems: [],
    errors: [],
    failedItems: [],
    albumUrl: "",
    folderPrefix: "",
    filter: "all",
  };
}

// ── Download Manager ─────────────────────────────────────────────────────────

let downloadState = createEmptyDownloadState();

async function persistDownloadState() {
  if (!chrome.storage?.session) return;
  try {
    await chrome.storage.session.set({ [DOWNLOAD_JOB_KEY]: downloadState });
  } catch {
    // Session storage unavailable or quota exceeded
  }
}

async function restoreDownloadState() {
  if (!chrome.storage?.session) return;
  try {
    const data = await chrome.storage.session.get(DOWNLOAD_JOB_KEY);
    if (data[DOWNLOAD_JOB_KEY]) {
      downloadState = { ...createEmptyDownloadState(), ...data[DOWNLOAD_JOB_KEY] };
    }
    stateRestored = true;
  } catch {
    stateRestored = true;
  }
}

async function clearPersistedDownloadState() {
  if (!chrome.storage?.session) return;
  try {
    await chrome.storage.session.remove(DOWNLOAD_JOB_KEY);
  } catch {
    // ignore
  }
}

function resetDownloadState() {
  downloadState = createEmptyDownloadState();
  clearPersistedDownloadState();
}

function notifyDownloadComplete(state) {
  if (state.total === 0 || !chrome.notifications?.create) return;

  const { completed, failed } = state;
  const body = failed > 0
    ? `${completed} saved, ${failed} failed — open extension to retry`
    : `${completed} file${completed === 1 ? "" : "s"} saved`;

  chrome.notifications.create(NOTIFICATION_ID, {
    type: "basic",
    title: "iCloud Album download complete",
    message: body,
  });
}

async function downloadFile(item, folderPrefix, filenamePattern) {
  const filename = buildFilename(item, { prefix: folderPrefix, pattern: filenamePattern });
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

async function runDownloadQueue(toDownload, folderPrefix, { filter = "all", albumUrl = "", reportFailures = true } = {}) {
  const settings = await loadSettings();
  const expanded = expandDownloadItems(toDownload, settings.includeLivePhotoVideos);

  downloadState.active = true;
  downloadState.total = expanded.length;
  downloadState.completed = 0;
  downloadState.failed = 0;
  downloadState.errors = [];
  downloadState.failedItems = [];
  broadcastProgress();

  const queue = [...expanded];
  const inFlight = new Set();

  while ((queue.length > 0 || inFlight.size > 0) && downloadState.active) {
    while (inFlight.size < settings.maxConcurrent && queue.length > 0 && downloadState.active) {
      const item = queue.shift();
      const promise = downloadFile(item, folderPrefix, settings.filenamePattern)
        .then((result) => {
          inFlight.delete(promise);
          if (result.success) {
            downloadState.completed++;
          } else {
            downloadState.failed++;
            downloadState.failedItems.push(result.item);
            downloadState.errors.push({
              filename: result.item.filename,
              error: result.error,
              item: result.item,
            });
          }
          broadcastProgress();
        })
        .catch((err) => {
          inFlight.delete(promise);
          downloadState.failed++;
          downloadState.failedItems.push(item);
          downloadState.errors.push({ filename: item.filename, error: err.message, item });
          broadcastProgress();
        });
      inFlight.add(promise);
    }
    if (inFlight.size > 0) {
      await Promise.race(inFlight);
    }
  }

  downloadState.active = false;
  broadcastProgress();
  notifyDownloadComplete(downloadState);

  if (reportFailures && downloadState.failed > 0) {
    reportError({
      operation: "download",
      message: `${downloadState.failed} of ${downloadState.total} downloads failed`,
      albumUrl: albumUrl || downloadState.albumUrl || "",
      filter,
      failedCount: downloadState.failed,
      details: {
        completed: downloadState.completed,
        failed: downloadState.failed,
        errors: downloadState.errors.slice(0, 20),
      },
    });
  }
}

async function downloadAll(items, filter, folderPrefix, albumUrl = "") {
  resetDownloadState();
  downloadState.albumUrl = albumUrl;
  downloadState.folderPrefix = folderPrefix;
  downloadState.filter = filter;

  let toDownload = items;
  if (filter === "photos") toDownload = items.filter((i) => i.type === "photo");
  else if (filter === "videos") toDownload = items.filter((i) => i.type === "video");

  await runDownloadQueue(toDownload, folderPrefix, { filter, albumUrl });
}

async function retryFailed() {
  const items = [...downloadState.failedItems];
  if (items.length === 0) return;

  await runDownloadQueue(items, downloadState.folderPrefix, {
    filter: downloadState.filter,
    albumUrl: downloadState.albumUrl,
    reportFailures: true,
  });
}

function broadcastProgress() {
  persistDownloadState();
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
      .catch((err) => {
        if (!isUserFacingAPIError(err)) {
          reportError({
            operation: "scan",
            message: err.message,
            stack: err.stack,
            albumUrl: msg.url,
            details: err.status
              ? { httpStatus: err.status, apiUrl: err.url, apiOperation: err.operation }
              : null,
          });
        }
        sendResponse({ ok: false, error: err.message });
      });
    return true; // async response
  }

  if (msg.type === "download") {
    // Start downloads in background — don't await.
    // Progress is reported via broadcastProgress().
    downloadAll(msg.items, msg.filter, msg.folder, msg.albumUrl || "").catch((err) => {
      downloadState.active = false;
      downloadState.errors.push({ filename: "(global)", error: err.message });
      broadcastProgress();
      reportError({
        operation: "download",
        message: err.message,
        stack: err.stack,
        albumUrl: msg.albumUrl || "",
        filter: msg.filter,
      });
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === "report-error") {
    reportError({
      operation: msg.operation || "popup",
      message: msg.message,
      stack: msg.stack,
      albumUrl: msg.albumUrl || "",
      filter: msg.filter || "",
      details: msg.details || null,
      userAgent: msg.userAgent,
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "test-report") {
    reportError({
      operation: "test",
      message: "Test report from extension console (dev)",
      albumUrl: msg.albumUrl || "https://www.icloud.com/sharedalbum/#TEST",
      details: { source: "console test-report message" },
    })
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (msg.type === "retry-failed") {
    retryFailed().catch((err) => {
      downloadState.active = false;
      downloadState.errors.push({ filename: "(global)", error: err.message });
      broadcastProgress();
      reportError({
        operation: "download",
        message: err.message,
        stack: err.stack,
        albumUrl: downloadState.albumUrl || "",
        filter: downloadState.filter,
      });
    });
    sendResponse({ ok: true, started: true });
    return false;
  }

  if (msg.type === "get-progress") {
    (async () => {
      if (!stateRestored) await restoreDownloadState();
      sendResponse({ ok: true, state: { ...downloadState } });
    })();
    return true;
  }

  if (msg.type === "cancel") {
    // Clear the queue by marking inactive — in-flight downloads will complete
    downloadState.active = false;
    persistDownloadState();
    sendResponse({ ok: true });
    return false;
  }
});

restoreDownloadState();

self.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  reportError({
    operation: "background",
    message: reason?.message || String(reason),
    stack: reason?.stack,
  });
});
