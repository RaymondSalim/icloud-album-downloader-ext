// ── DOM References ───────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const albumURLInput    = $("#album-url");
const btnScan          = $("#btn-scan");
const autoDetectHint   = $("#auto-detect-hint");

const errorSection     = $("#error-section");
const errorText        = $("#error-text");

const loadingSection   = $("#loading-section");
const albumInfo        = $("#album-info");

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

function showError(msg) {
  errorText.textContent = msg;
  errorSection.style.display = "block";
}

function hideError() {
  errorSection.style.display = "none";
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
  btnScan.disabled = true;

  try {
    const response = await chrome.runtime.sendMessage({ type: "scan", url });
    btnScan.disabled = false;

    if (!response.ok) {
      showSection(null);
      showError(response.error || "Failed to scan album.");
      return;
    }

    scannedData = response.data;
    renderAlbumInfo(scannedData);
  } catch (err) {
    btnScan.disabled = false;
    showSection(null);
    showError(`Scan failed: ${err.message}`);
  }
}

function renderAlbumInfo(data) {
  showSection(albumInfo);

  statTotal.textContent = data.totalItems;
  statPhotos.textContent = data.photos;
  statVideos.textContent = data.videos;
  statSize.textContent = formatBytes(data.totalSize);

  // Show/hide type-specific download buttons
  btnDownloadPhotos.style.display = data.photos > 0 && data.videos > 0 ? "inline-flex" : "none";
  btnDownloadVideos.style.display = data.videos > 0 && data.photos > 0 ? "inline-flex" : "none";

  // Pre-fill folder name from URL token
  if (data.token && !folderInput.value) {
    folderInput.value = `iCloud Album ${data.token.substring(0, 8)}`;
  }
}

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
    });

    if (!response.ok) {
      showError(response.error || "Download failed to start.");
      showSection(albumInfo);
    }
    // Completion is handled by the progress listener below
  } catch (err) {
    showError(`Download error: ${err.message}`);
    showSection(albumInfo);
  }
}

function showComplete(state) {
  showSection(completeSection);
  completeSummary.textContent = `${state.completed} of ${state.total} files downloaded successfully.`;

  if (state.failed > 0) {
    completeErrors.style.display = "block";
    completeErrorsText.textContent = `${state.failed} file(s) failed: ${state.errors.map((e) => e.filename).join(", ")}`;
  } else {
    completeErrors.style.display = "none";
  }
}

// ── Progress Listener ────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "download-progress") {
    const s = msg.state;
    const done = s.completed + s.failed;
    const pct = s.total > 0 ? Math.round((done / s.total) * 100) : 0;

    progressCount.textContent = done;
    progressTotal.textContent = s.total;
    progressBar.style.width = `${pct}%`;

    if (s.failed > 0) {
      progressFailed.style.display = "inline";
      failedCount.textContent = s.failed;
    }

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
btnReset.addEventListener("click", handleReset);

// ── Init ─────────────────────────────────────────────────────────────────────

// Restore progress view if a download is already running
async function checkExistingDownload() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "get-progress" });
    if (response.ok && response.state.active && response.state.total > 0) {
      showSection(progressSection);
      const s = response.state;
      const done = s.completed + s.failed;
      const pct = s.total > 0 ? Math.round((done / s.total) * 100) : 0;
      progressCount.textContent = done;
      progressTotal.textContent = s.total;
      progressBar.style.width = `${pct}%`;
      if (s.failed > 0) {
        progressFailed.style.display = "inline";
        failedCount.textContent = s.failed;
      }
    }
  } catch {
    // Service worker not ready yet — fine
  }
}

tryAutoDetect();
checkExistingDownload();
