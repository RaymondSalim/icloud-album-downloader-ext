#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

PROD_BUILD=0
KEEP_STAGING=0

for arg in "$@"; do
  case "$arg" in
    --prod) PROD_BUILD=1 ;;
    --keep-staging) KEEP_STAGING=1 ;;
  esac
done

# ── Meta ──────────────────────────────────────────────────────────────
VERSION=$(jq -r .version manifest.json)
NAME="icloud-album-downloader"

echo "Building $NAME v$VERSION"
if [ "$PROD_BUILD" -eq 1 ]; then
  echo "Mode: production (local config.js ignored)"
  if [ -z "${REPORT_ENDPOINT:-}" ]; then
    echo "WARNING: REPORT_ENDPOINT not set — error reporting will be disabled in this build."
  fi
else
  echo "Mode: development"
fi

# ── Config / reporting ────────────────────────────────────────────────

write_config() {
  local dest="$1"
  local enabled="$2"
  local endpoint="$3"
  local secret="$4"

  cat > "$dest/config.js" <<EOF
self.REPORTING_CONFIG = {
  enabled: ${enabled},
  reportEndpoint: "${endpoint}",
  reportSecret: "${secret}",
};
EOF
}

get_report_endpoint() {
  if [ -n "${REPORT_ENDPOINT:-}" ]; then
    echo "$REPORT_ENDPOINT"
  elif [ "$PROD_BUILD" -eq 0 ] && [ -f config.js ]; then
    grep -oE 'reportEndpoint:\s*"[^"]*"' config.js | head -1 | sed -E 's/reportEndpoint:\s*"([^"]*)"/\1/' || true
  fi
}

stage_config() {
  local dest="$1"

  if [ -n "${REPORT_ENDPOINT:-}" ]; then
    write_config "$dest" true "$REPORT_ENDPOINT" "${REPORT_SECRET:-}"
  elif [ "$PROD_BUILD" -eq 1 ]; then
    write_config "$dest" false "" ""
  elif [ -f config.js ]; then
    cp config.js "$dest/"
  else
    write_config "$dest" false "" ""
  fi

  cp reporting.js "$dest/"
}

patch_host_permissions() {
  local manifest="$1"
  local endpoint
  endpoint="$(get_report_endpoint)"

  if [ -n "$endpoint" ]; then
    local origin
    origin=$(python3 -c "from urllib.parse import urlparse; u=urlparse('${endpoint}'); print(f'{u.scheme}://{u.netloc}/*')")
    jq --arg perm "$origin" \
      '.host_permissions = ((.host_permissions // []) | map(select(test("workers\\.dev") | not)) + [$perm] | unique)' \
      "$manifest" > "${manifest}.tmp"
  else
    jq '.host_permissions = ((.host_permissions // []) | map(select(test("workers\\.dev") | not)))' \
      "$manifest" > "${manifest}.tmp"
  fi
  mv "${manifest}.tmp" "$manifest"
}

stage_manifest() {
  local src="$1"
  local dest="$2"
  cp "$src" "$dest"
  patch_host_permissions "$dest"
}

# ── Clean ─────────────────────────────────────────────────────────────
rm -rf dist
if [ "$KEEP_STAGING" -eq 0 ]; then
  rm -rf staging
fi
mkdir -p dist staging

# ── Chrome ────────────────────────────────────────────────────────────
echo ""
echo "==> Staging Chrome files..."
mkdir -p staging/chrome
stage_manifest manifest.json staging/chrome/manifest.json
cp background.js staging/chrome/
stage_config staging/chrome
cp -r popup icons staging/chrome/

echo "==> Packing Chrome zip..."
(cd staging/chrome && zip -r "../../dist/${NAME}-chrome-${VERSION}.zip" . -x "*.DS_Store")

# ── Firefox ───────────────────────────────────────────────────────────
echo ""
echo "==> Staging Firefox files..."
mkdir -p staging/firefox
stage_manifest manifest_firefox.json staging/firefox/manifest.json
cp background.js staging/firefox/
stage_config staging/firefox
cp -r popup icons staging/firefox/

echo "==> Packing Firefox xpi..."
(cd staging/firefox && zip -r "../../dist/${NAME}-firefox-${VERSION}.xpi" . -x "*.DS_Store")

# ── Cleanup ───────────────────────────────────────────────────────────
if [ "$KEEP_STAGING" -eq 0 ]; then
  rm -rf staging
fi

# ── Summary ───────────────────────────────────────────────────────────
echo ""
echo "==> Build complete. Artifacts in dist/:"
ls -lh dist/

if [ "$PROD_BUILD" -eq 1 ]; then
  endpoint="$(get_report_endpoint)"
  if [ -n "$endpoint" ]; then
    echo ""
    echo "Error reporting: enabled → ${endpoint}"
  else
    echo ""
    echo "Error reporting: disabled"
  fi
fi
