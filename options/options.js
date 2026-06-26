const DEFAULT_SETTINGS = {
  filenamePattern: "original",
  maxConcurrent: 3,
  includeLivePhotoVideos: false,
};

const form = document.getElementById("options-form");
const filenamePattern = document.getElementById("filename-pattern");
const maxConcurrent = document.getElementById("max-concurrent");
const includeLivePhotoVideos = document.getElementById("include-live-photo-videos");
const saveStatus = document.getElementById("save-status");

async function loadOptions() {
  const data = await chrome.storage.sync.get(DEFAULT_SETTINGS);
  filenamePattern.value = data.filenamePattern === "date-prefix" ? "date-prefix" : "original";
  maxConcurrent.value = String(
    Math.min(5, Math.max(1, Number(data.maxConcurrent) || DEFAULT_SETTINGS.maxConcurrent))
  );
  includeLivePhotoVideos.checked = Boolean(data.includeLivePhotoVideos);
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  const max = Math.min(5, Math.max(1, parseInt(maxConcurrent.value, 10) || 3));
  await chrome.storage.sync.set({
    filenamePattern: filenamePattern.value,
    maxConcurrent: max,
    includeLivePhotoVideos: includeLivePhotoVideos.checked,
  });
  maxConcurrent.value = String(max);
  saveStatus.textContent = "Saved";
  setTimeout(() => {
    saveStatus.textContent = "";
  }, 2000);
});

loadOptions();
