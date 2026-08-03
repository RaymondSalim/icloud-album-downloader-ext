// ── DOM References ───────────────────────────────────────────────────────────

const $ = (sel) => document.querySelector(sel);

const albumURLInput    = $("#album-url");
const btnScan          = $("#btn-scan");
const autoDetectHint   = $("#auto-detect-hint");

const errorSection     = $("#error-section");
const errorText        = $("#error-text");
const errorReportHint  = $("#error-report-hint");
const btnErrorRetry    = $("#btn-error-retry");
const errorDiagnosticPanel = $("#error-diagnostic-panel");
const errorIncludeAlbumUrl = $("#error-include-album-url");
const btnErrorSendDiagnostic = $("#btn-error-send-diagnostic");
const errorDiagnosticStatus = $("#error-diagnostic-status");

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
const completeIcon     = $("#complete-icon");
const completeIconSymbol = $("#complete-icon-symbol");
const completeHeading  = $("#complete-heading");
const completeSummary  = $("#complete-summary");
const completeErrors   = $("#complete-errors");
const completeErrorsText = $("#complete-errors-text");
const ratingPrompt     = $("#rating-prompt");
const btnRateExtension = $("#btn-rate-extension");
const btnRetryFailed     = $("#btn-retry-failed");
const diagnosticPanel  = $("#diagnostic-panel");
const diagnosticToggle = $("#diagnostic-toggle");
const diagnosticContent = $("#diagnostic-content");
const includeAlbumUrl  = $("#include-album-url");
const btnSendDiagnostic = $("#btn-send-diagnostic");
const diagnosticStatus = $("#diagnostic-status");
const btnReset         = $("#btn-reset");
const DIAGNOSTIC_BUTTON_LABEL = "Send diagnostic report";

// ── State ────────────────────────────────────────────────────────────────────

let scannedData = null;
let currentDiagnosticContext = null;
let activeDiagnosticControls = null;

const FIREFOX_AMO_REVIEW_URL =
  "https://addons.mozilla.org/en-US/firefox/addon/icloud-album-downloader/reviews/";

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i > 1 ? 1 : 0)} ${units[i]}`;
}

function getRatingURL() {
  const manifest = chrome.runtime.getManifest?.() || {};
  if (manifest.browser_specific_settings?.gecko) return FIREFOX_AMO_REVIEW_URL;
  if (!chrome.runtime.id) return "";
  return `https://chromewebstore.google.com/detail/${chrome.runtime.id}/reviews`;
}

function showRatingPrompt(show) {
  const ratingURL = getRatingURL();
  ratingPrompt.style.display = show && ratingURL ? "block" : "none";
  btnRateExtension.style.display = ratingURL ? "inline-flex" : "none";
}

async function openRatingPage() {
  const ratingURL = getRatingURL();
  if (!ratingURL) return;
  await chrome.tabs.create({ url: ratingURL });
}

function setDiagnosticStatus(controls, message, className = "") {
  controls.status.textContent = message;
  controls.status.className = `hint diagnostic-status${className ? ` ${className}` : ""}`;
  controls.status.style.display = message ? "block" : "none";
}

function hideDiagnosticPanel() {
  currentDiagnosticContext = null;
  activeDiagnosticControls = null;
  [errorDiagnosticPanel, diagnosticPanel].forEach((panel) => {
    panel.style.display = "none";
  });
  diagnosticPanel.className = "diagnostic-dropdown";
  diagnosticContent.style.display = "none";
  [errorDiagnosticStatus, diagnosticStatus].forEach((status) => {
    status.textContent = "";
    status.className = "hint diagnostic-status";
    status.style.display = "none";
  });
  btnErrorSendDiagnostic.disabled = false;
  btnSendDiagnostic.disabled = false;
  btnErrorSendDiagnostic.textContent = DIAGNOSTIC_BUTTON_LABEL;
  btnSendDiagnostic.textContent = DIAGNOSTIC_BUTTON_LABEL;
}

function setDiagnosticDropdown(open) {
  diagnosticPanel.className = open ? "diagnostic-dropdown open" : "diagnostic-dropdown";
  diagnosticContent.style.display = open ? "block" : "none";
}

function showDiagnosticPanel(context, location = "error") {
  currentDiagnosticContext = context;

  const controls = location === "complete"
    ? {
        panel: diagnosticPanel,
        checkbox: includeAlbumUrl,
        button: btnSendDiagnostic,
        status: diagnosticStatus,
      }
    : {
        panel: errorDiagnosticPanel,
        checkbox: errorIncludeAlbumUrl,
        button: btnErrorSendDiagnostic,
        status: errorDiagnosticStatus,
      };

  activeDiagnosticControls = controls;
  controls.panel.style.display = "block";
  if (location === "complete") setDiagnosticDropdown(false);
  controls.checkbox.checked = false;
  controls.button.disabled = false;
  controls.button.textContent = DIAGNOSTIC_BUTTON_LABEL;
  setDiagnosticStatus(controls, "");

  const inactivePanel = location === "complete" ? errorDiagnosticPanel : diagnosticPanel;
  inactivePanel.style.display = "none";
}

async function sendDiagnostic() {
  if (!currentDiagnosticContext || !activeDiagnosticControls) return;

  const controls = activeDiagnosticControls;
  controls.button.disabled = true;
  controls.button.textContent = "Sending";
  setDiagnosticStatus(controls, "Sending diagnostic report.");

  try {
    const response = await sendMessage({
      type: "send-diagnostic-report",
      userAgent: navigator.userAgent,
      includeAlbumUrl: controls.checkbox.checked,
      ...currentDiagnosticContext,
    });

    if (response?.sent) {
      controls.button.textContent = "Sent";
      setDiagnosticStatus(controls, "Diagnostic report sent.", "success");
    } else {
      controls.button.disabled = false;
      controls.button.textContent = DIAGNOSTIC_BUTTON_LABEL;
      setDiagnosticStatus(controls, "Could not send report. Try again later.", "error");
    }
  } catch {
    controls.button.disabled = false;
    controls.button.textContent = DIAGNOSTIC_BUTTON_LABEL;
    setDiagnosticStatus(controls, "Could not send report. Try again later.", "error");
  }
}

const COMPLETE_ICONS = {
  success: `
    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
    <polyline points="22 4 12 14.01 9 11.01"/>
  `,
  warning: `
    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
    <line x1="12" y1="9" x2="12" y2="13"/>
    <line x1="12" y1="17" x2="12.01" y2="17"/>
  `,
  danger: `
    <circle cx="12" cy="12" r="10"/>
    <line x1="15" y1="9" x2="9" y2="15"/>
    <line x1="9" y1="9" x2="15" y2="15"/>
  `,
};

function setCompleteTone(tone, heading) {
  completeIcon.className = `complete-icon ${tone}`;
  completeIconSymbol.innerHTML = COMPLETE_ICONS[tone];
  completeHeading.textContent = heading;
}

function showError(msg, { report = false, context = {}, retry = null, diagnostic = false } = {}) {
  errorText.textContent = msg;
  errorSection.style.display = "block";
  errorReportHint.style.display = "none";
  hideDiagnosticPanel();

  if (retry) {
    btnErrorRetry.style.display = "block";
    btnErrorRetry.onclick = retry;
  } else {
    btnErrorRetry.style.display = "none";
    btnErrorRetry.onclick = null;
  }

  if (report) {
    reportErrorToBackground({
      message: msg,
      ...context,
    }).then((result) => {
      if (result?.sent) errorReportHint.style.display = "block";
    });
  }

  if (diagnostic) {
    showDiagnosticPanel({
      message: msg,
      ...context,
    });
  }
}

function hideError() {
  errorSection.style.display = "none";
  errorReportHint.style.display = "none";
  btnErrorRetry.style.display = "none";
  btnErrorRetry.onclick = null;
  hideDiagnosticPanel();
}

// Wraps chrome.runtime.sendMessage with one retry for the MV3 service-worker
// wake-up race ("Could not establish connection. Receiving end does not exist.").
function sendMessage(message) {
  return Messaging.sendMessageWithRetry(
    (msg) => chrome.runtime.sendMessage(msg),
    message
  );
}

async function reportErrorToBackground(context) {
  try {
    const response = await sendMessage({
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
      pokeBackgroundScript();
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
    const response = await sendMessage({ type: "scan", url });
    btnScan.disabled = false;

    if (!response.ok) {
      showSection(null);
      showError(response.error || "Failed to scan album.", {
        report: false,
        diagnostic: true,
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
      report: err.name !== "ExtensionConnectionError",
      diagnostic: true,
      context: {
        operation: "scan",
        albumUrl: url,
        stack: err.stack,
      },
      retry: err.name === "ExtensionConnectionError" ? handleScan : null,
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
    const response = await sendMessage({
      type: "download",
      items: scannedData.items,
      filter,
      folder,
      albumUrl: albumURLInput.value.trim(),
    });

    if (!response.ok) {
      showError(response.error || "Download failed to start.", {
        report: true,
        diagnostic: true,
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
      report: err.name !== "ExtensionConnectionError",
      diagnostic: true,
      context: {
        operation: "download",
        albumUrl: albumURLInput.value.trim(),
        filter,
        stack: err.stack,
      },
      retry: err.name === "ExtensionConnectionError" ? () => handleDownload(filter) : null,
    });
    showSection(albumInfo);
  }
}

function showComplete(state) {
  showSection(completeSection);
  completeSummary.textContent = `${state.completed} of ${state.total} files downloaded successfully.`;

  if (state.failed > 0) {
    if (state.completed === 0) {
      setCompleteTone("danger", "Download Failed");
    } else {
      setCompleteTone("warning", "Download Finished with Issues");
    }
    completeErrors.style.display = "block";
    completeErrorsText.textContent = `${state.failed} file(s) failed: ${state.errors.map((e) => e.filename).join(", ")}`;
    btnRetryFailed.style.display = "block";
    btnRetryFailed.textContent = `Retry failed (${state.failed})`;
    showRatingPrompt(false);
    showDiagnosticPanel({
      operation: "download",
      message: `${state.failed} of ${state.total} downloads failed`,
      albumUrl: state.albumUrl || albumURLInput.value.trim(),
      filter: state.filter || "",
      failedCount: state.failed,
      details: state,
    }, "complete");
  } else {
    setCompleteTone("success", "Download Complete");
    completeErrors.style.display = "none";
    btnRetryFailed.style.display = "none";
    hideDiagnosticPanel();
    showRatingPrompt(true);
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
    const response = await sendMessage({ type: "retry-failed" });
    if (!response?.ok) {
      showError(response?.error || "Retry failed to start.", {
        report: true,
        diagnostic: true,
        context: { operation: "download", albumUrl: albumURLInput.value.trim() },
      });
      showSection(completeSection);
    }
  } catch (err) {
    showError(`Retry error: ${err.message}`, {
      report: err.name !== "ExtensionConnectionError",
      diagnostic: true,
      context: {
        operation: "download",
        albumUrl: albumURLInput.value.trim(),
        stack: err.stack,
      },
      retry: err.name === "ExtensionConnectionError" ? handleRetryFailed : null,
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
  try {
    await sendMessage({ type: "cancel" });
  } catch (err) {
    showError(`Cancel failed: ${err.message}`, {
      report: err.name !== "ExtensionConnectionError",
      diagnostic: true,
      context: {
        operation: "cancel",
        albumUrl: albumURLInput.value.trim(),
        stack: err.stack,
      },
      retry: err.name === "ExtensionConnectionError" ? handleCancel : null,
    });
  }
  showSection(albumInfo);
}

// ── Reset ────────────────────────────────────────────────────────────────────

function handleReset() {
  scannedData = null;
  albumURLInput.value = "";
  folderInput.value = "";
  autoDetectHint.style.display = "none";
  hideError();
  showRatingPrompt(false);
  showSection(null);
}

// ── Event Bindings ───────────────────────────────────────────────────────────

// Wake the background script as soon as the user focuses the URL field, so
// it's warm by the time they click Scan — reduces (but doesn't eliminate)
// the MV3 wake-up race that ExtensionConnectionError guards against.
let backgroundPoked = false;
function pokeBackgroundScript() {
  if (backgroundPoked) return;
  backgroundPoked = true;
  chrome.runtime.sendMessage({ type: "ping" }).catch(() => {
    // Best-effort — sendMessage() retry logic still covers a cold background.
  });
}

btnScan.addEventListener("click", handleScan);
albumURLInput.addEventListener("focus", pokeBackgroundScript);
albumURLInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") handleScan();
});

btnDownloadAll.addEventListener("click", () => handleDownload("all"));
btnDownloadPhotos.addEventListener("click", () => handleDownload("photos"));
btnDownloadVideos.addEventListener("click", () => handleDownload("videos"));
btnCancel.addEventListener("click", handleCancel);
btnRetryFailed.addEventListener("click", handleRetryFailed);
btnRateExtension.addEventListener("click", openRatingPage);
btnErrorSendDiagnostic.addEventListener("click", sendDiagnostic);
btnSendDiagnostic.addEventListener("click", sendDiagnostic);
diagnosticToggle.addEventListener("click", () => {
  setDiagnosticDropdown(diagnosticContent.style.display === "none");
});
btnReset.addEventListener("click", handleReset);

// ── Init ─────────────────────────────────────────────────────────────────────

// Restore progress view if a download is already running
async function checkExistingDownload() {
  try {
    let state = null;
    const response = await sendMessage({ type: "get-progress" });
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
