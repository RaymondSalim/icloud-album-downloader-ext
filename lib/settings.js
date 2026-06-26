// ── iCloud Album Downloader – Settings ───────────────────────────────────────

const DEFAULT_SETTINGS = {
  filenamePattern: "original",
  maxConcurrent: 3,
};

async function loadSettings() {
  try {
    const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
    const maxConcurrent = Number(data.maxConcurrent);
    return {
      filenamePattern: data.filenamePattern === "date-prefix" ? "date-prefix" : "original",
      maxConcurrent: Number.isFinite(maxConcurrent)
        ? Math.min(5, Math.max(1, Math.round(maxConcurrent)))
        : DEFAULT_SETTINGS.maxConcurrent,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}
