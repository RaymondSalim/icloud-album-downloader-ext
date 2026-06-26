// ── DOM References ───────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const albumURLInput    = $("#album-url");
const btnScan          = $("#btn-scan");
const autoDetectHint   = $("#auto-detect-hint");

const errorSection     = $("#error-section");
const errorText        = $("#error-text");
const errorReportHint  = $("#error-report-hint");

const loadingSection   = $("#loading-section");
const loadingStatus    = $("#loading-status");
const loadingSizeHint  = $("#loading-size-hint");
const albumInfo        = $("#album-info");
const albumTitle       = $("#album-title");
const downloadDestination = $("#download-destination");
const albumWarning     = $("#album-warning");

const statTotal        = $("#stat-total");
const statPhotos       = $("#stat-photos");
const statVideos       = $("#stat-videos");
const statSize         = $("#stat-size");

const folderInput      = $("#folder-name");
const btnDownloadAll   = $("#btn-download-all");
const btnDownloadPhotos = $("#btn-download-photos");
const btnDownloadVideos = $("#btn-download-videos");

const progressSection  = $("#progress-section");
const progressBar      = $("#progress-bar");
const progressCount    = $("#progress-count");
const progressTotal    = $("#progress-total");
const progressFailed   = $("#progress-failed");
const failedCount      = $("#failed-count");
const btnCancel        = $("#btn-cancel");

const completeSection  = $("#complete-section");
const completeSummary  = $("#complete-summary");
const completeErrors   = $("#complete-errors");
const completeErrorsText = $("#complete-errors-text");
const btnRetryFailed     = $("#btn-retry-failed");
const btnReset         = $("#btn-reset");

// ── State ────────────────────────────────────────────────────────────────────

let scannedData = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function showError(msg, { report = false, context = {} } = {}) {
  errorText.textContent = msg;
  errorSection.style.display = "block";
  errorReportHint.style.display = "none";

  if (report) {
    reportErrorToBackground({
      message: msg,
      ...context,
    }).then((result) => {
      if (result?.sent) errorReportHint.style.display = "block";
    });
  }
}

function hideError() {
  errorSection.style.display = "none";
  errorReportHint.style.display = "none";
}

async function reportErrorToBackground(context) {
  try {
    const response = await chrome.runtime.sendMessage({
      type: "report-error",
      userAgent: navigator.userAgent,
      ...context,
    });
    return response || { sent: false, reason: "no_response" };
  } catch {
    return { sent: false, reason: "message_failed" };
  }
}

function showSection(section) {
  // Hide all dynamic sections
  [loadingSection, albumInfo, progressSection, completeSection].forEach(
    (s) => (s.style.display = "none")
  );
  if (section) section.style.display = "block";
}

function isICloudAlbumURL(url) {
  return /^https?:\/\/(www\.)?icloud\.com\/sharedalbum\/#.+/.test(url);
}

// ── Auto-detect URL from current tab ─────────────────────────────────────────

async function tryAutoDetect() {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.url && isICloudAlbumURL(tab.url)) {
      albumURLInput.value = tab.url;
      autoDetectHint.style.display = "block";
    }
  } catch {
    // Not critical — user can paste manually
  }
}

// ── Scan ─────────────────────────────────────────────────────────────────────

async function handleScan() {
  hideError();
  const url = albumURLInput.value.trim();

  if (!url) {
    showError("Please enter an iCloud shared album URL.");
    return;
  }
  if (!isICloudAlbumURL(url)) {
    showError("URL doesn't look like an iCloud shared album. Expected format: https://www.icloud.com/sharedalbum/#...");
    return;
  }

  showSection(loadingSection);
  loadingStatus.textContent = "Scanning album...";
  loadingSizeHint.style.display = "none";
  btnScan.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: "scan", url });
    btnScan.disabled = false;

    if (!response.ok) {
      showSection(null);
      showError(response.error || "Failed to scan album.", {
        report: false,
        context: {
          operation: "scan",
          albumUrl: url,
        },
      });
      return;
    }

    scannedData = response.data;
    renderAlbumInfo(scannedData);
  } catch (err) {
    btnScan.disabled = false;
    showSection(null);
    showError(`Scan failed: ${err.message}`, {
      report: true,
      context: {
        operation: "scan",
        albumUrl: url,
        stack: err.stack,
      },
    });
  }
}

function renderAlbumInfo(data) {
  showSection(albumInfo);

  albumTitle.textContent = data.albumTitle || "Album Contents";

  statTotal.textContent = data.totalItems;
  statPhotos.textContent = data.photos;
  statVideos.textContent = data.videos;
  statSize.textContent = formatBytes(data.totalSize);

  const folder = folderInput.value.trim() || "iCloud Album";
  downloadDestination.style.display = "block";
  downloadDestination.textContent = `Will download to Downloads/${folder}/`;

  const warnings = [];
  if (data.totalSize > 1024 ** 3) warnings.push("Album is over 1 GB");
  if (data.totalItems > 500) warnings.push("Album has more than 500 items");
  if (data.heicCount > 0) {
    warnings.push(`${data.heicCount} HEIC photo(s) download as-is (no conversion)`);
  }
  if (data.livePhotoCount > 0) {
    warnings.push(`${data.livePhotoCount} Live Photo(s) — enable companion videos in extension options if needed`);
  }
  if (warnings.length > 0) {
    albumWarning.style.display = "block";
    albumWarning.textContent = `${warnings.join(" · ")} — download may take a while.`;
  } else {
    albumWarning.style.display = "none";
  }

  // Show/hide type-specific download buttons
  btnDownloadPhotos.style.display = data.photos > 0 && data.videos > 0 ? "inline-flex" : "none";
  btnDownloadVideos.style.display = data.videos > 0 && data.photos > 0 ? "inline-flex" : "none";

  // Pre-fill folder name from URL token
  if (data.token && !folderInput.value) {
    folderInput.value = `iCloud Album ${data.token.substring(0, 8)}`;
    downloadDestination.textContent = `Will download to Downloads/${folderInput.value}/`;
  }
}

folderInput.addEventListener("input", () => {
  if (!scannedData) return;
  const folder = folderInput.value.trim() || "iCloud Album";
  downloadDestination.textContent = `Will download to Downloads/${folder}/`;
});

// ── Download ─────────────────────────────────────────────────────────────────

async function handleDownload(filter) {
  if (!scannedData || !scannedData.items.length) return;

  hideError();
  showSection(progressSection);

  const folder = folderInput.value.trim() || "iCloud Album";

  // Reset progress UI
  const total = filter === "photos"
    ? scannedData.photos
    : filter === "videos"
      ? scannedData.videos
      : scannedData.totalItems;

  progressCount.textContent = "0";
  progressTotal.textContent = total;
  progressBar.style.width = "0%";
  progressFailed.style.display = "none";

  try {
    // This returns immediately — progress tracked via onMessage listener
    const response = await chrome.runtime.sendMessage({
      type: "download",
      items: scannedData.items,
      filter,
      folder,
      albumUrl: albumURLInput.value.trim(),
    });

    if (!response.ok) {
      showError(response.error || "Download failed to start.", {
        report: true,
        context: {
          operation: "download",
          albumUrl: albumURLInput.value.trim(),
          filter,
        },
      });
      showSection(albumInfo);
    }
    // Completion is handled by the progress listener below
  } catch (err) {
    showError(`Download error: ${err.message}`, {
      report: true,
      context: {
        operation: "download",
        albumUrl: albumURLInput.value.trim(),
        filter,
        stack: err.stack,
      },
    });
    showSection(albumInfo);
  }
}

function showComplete(state) {
  showSection(completeSection);
  completeSummary.textContent = `${state.completed} of ${state.total} files downloaded successfully.`;

  if (state.failed > 0) {
    completeErrors.style.display = "block";
    completeErrorsText.textContent = `${state.failed} file(s) failed: ${state.errors.map((e) => e.filename).join(", ")}`;
    btnRetryFailed.style.display = "block";
    btnRetryFailed.textContent = `Retry failed (${state.failed})`;
  } else {
    completeErrors.style.display = "none";
    btnRetryFailed.style.display = "none";
  }
}

async function handleRetryFailed() {
  hideError();
  showSection(progressSection);
  progressCount.textContent = "0";
  progressTotal.textContent = "…";
  progressBar.style.width = "0%";
  progressFailed.style.display = "none";
  btnRetryFailed.style.display = "none";

  try {
    const response = await chrome.runtime.sendMessage({ type: "retry-failed" });
    if (!response?.ok) {
      showError(response?.error || "Retry failed to start.", {
        report: true,
        context: { operation: "download", albumUrl: albumURLInput.value.trim() },
      });
      showSection(completeSection);
    }
  } catch (err) {
    showError(`Retry error: ${err.message}`, {
      report: true,
      context: {
        operation: "download",
        albumUrl: albumURLInput.value.trim(),
        stack: err.stack,
      },
    });
    showSection(completeSection);
  }
}

function applyProgressUI(s) {
  const done = s.completed + s.failed;
  const pct = s.total > 0 ? Math.round((done / s.total) * 100) : 0;

  progressCount.textContent = done;
  progressTotal.textContent = s.total;
  progressBar.style.width = `${pct}%`;

  if (s.failed > 0) {
    progressFailed.style.display = "inline";
    failedCount.textContent = s.failed;
  } else {
    progressFailed.style.display = "none";
  }
}

// ── Progress Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "scan-progress") {
    if (msg.phase === "resolving" && msg.total > 0) {
      loadingStatus.textContent = `Resolving URLs… ${msg.done} / ${msg.total}`;
      if (msg.estimatedSize) {
        loadingSizeHint.style.display = "block";
        loadingSizeHint.textContent = `Estimated size: ${formatBytes(msg.estimatedSize)}`;
      }
    }
    return;
  }

  if (msg.type === "download-progress") {
    const s = msg.state;
    applyProgressUI(s);

    // Download finished (active turned false by background worker)
    if (!s.active && s.total > 0) {
      showComplete(s);
    }
  }
});

// ── Cancel ───────────────────────────────────────────────────────────────────

async function handleCancel() {
  await chrome.runtime.sendMessage({ type: "cancel" });
  showSection(albumInfo);
}

// ── Reset ────────────────────────────────────────────────────────────────────

function handleReset() {
  scannedData = null;
  albumURLInput.value = "";
  folderInput.value = "";
  autoDetectHint.style.display = "none";
  hideError();
  showSection(null);
}

// ── Event Bindings ───────────────────────────────────────────────────────────

btnScan.addEventListener("click", handleScan);
albumURLInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleScan();
});

btnDownloadAll.addEventListener("click", () => handleDownload("all"));
btnDownloadPhotos.addEventListener("click", () => handleDownload("photos"));
btnDownloadVideos.addEventListener("click", () => handleDownload("videos"));
btnCancel.addEventListener("click", handleCancel);
btnRetryFailed.addEventListener("click", handleRetryFailed);
btnReset.addEventListener("click", handleReset);

// ── Init ─────────────────────────────────────────────────────────────────────

// Restore progress view if a download is already running
async function checkExistingDownload() {
  try {
    let state = null;
    const response = await chrome.runtime.sendMessage({ type: "get-progress" });
    if (response?.ok) state = response.state;

    if (!state || (!state.active && state.total === 0)) {
      try {
        const stored = await chrome.storage.session.get("downloadJob");
        if (stored.downloadJob) state = stored.downloadJob;
      } catch {
        // session storage unavailable in this context
      }
    }

    if (!state || state.total === 0) return;

    if (state.active) {
      showSection(progressSection);
      applyProgressUI(state);
    } else {
      showComplete(state);
    }
  } catch {
    // Service worker not ready yet — fine
  }
}

tryAutoDetect();
checkExistingDownload();
