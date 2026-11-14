#!/usr/bin/env bash
set -euo pipefail

REPO="williamcboehmjr/LocalGravity"
APP_NAME="LocalGravity.app"
TARGET_APP="/Applications/${APP_NAME}"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"

echo "Checking latest ${REPO} macOS release..."
DMG_URL="$(curl -fsSL "${API_URL}" | grep -oE '"browser_download_url":[[:space:]]*"[^"]+\.dmg"' | head -n 1 | cut -d '"' -f 4)"

if [[ -z "${DMG_URL}" ]]; then
  echo "Error: Could not find a .dmg asset in the latest GitHub release." >&2
  exit 1
fi

TMP_DIR="$(mktemp -d)"
MOUNT_DIR="${TMP_DIR}/mount"
DMG_PATH="${TMP_DIR}/LocalGravity.dmg"
mkdir -p "${MOUNT_DIR}"

cleanup() {
  if mount | grep -q "${MOUNT_DIR}"; then
    hdiutil detach "${MOUNT_DIR}" -force >/dev/null 2>&1 || true
  fi
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

echo "Downloading $(basename "${DMG_URL}")..."
curl -fL --progress-bar "${DMG_URL}" -o "${DMG_PATH}"

echo "Mounting DMG..."
hdiutil attach "${DMG_PATH}" -mountpoint "${MOUNT_DIR}" -nobrowse -readonly >/dev/null

SOURCE_APP="$(find "${MOUNT_DIR}" -maxdepth 2 -name "*.app" | head -n 1)"
if [[ -z "${SOURCE_APP}" ]]; then
  echo "Error: No .app bundle found inside the mounted DMG." >&2
  exit 1
fi

run_priv() {
  if [[ -w "/Applications" ]] && { [[ ! -e "${TARGET_APP}" ]] || [[ -w "${TARGET_APP}" ]]; }; then
    "$@"
  else
    sudo "$@"
  fi
}

echo "Installing ${APP_NAME} to /Applications (without quarantine attributes)..."
if [[ -e "${TARGET_APP}" ]]; then
  run_priv rm -rf "${TARGET_APP}"
fi
run_priv ditto --norsrc --noextattr "${SOURCE_APP}" "${TARGET_APP}"
run_priv xattr -cr "${TARGET_APP}" >/dev/null 2>&1 || true
run_priv codesign --force --deep --sign - "${TARGET_APP}"

echo "Installed ${TARGET_APP}. Launching LocalGravity..."
open "${TARGET_APP}"
