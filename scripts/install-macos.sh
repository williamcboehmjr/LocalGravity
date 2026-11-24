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

INSTALL_TRAY="${LOCALGRAVITY_INSTALL_TRAY:-}"
if [[ -z "${INSTALL_TRAY}" ]]; then
  for arg in "$@"; do
    [[ "${arg}" == "--with-tray" ]] && INSTALL_TRAY="1"
    [[ "${arg}" == "--no-tray" ]] && INSTALL_TRAY="0"
  done
fi
if [[ -z "${INSTALL_TRAY}" ]] && [[ -t 0 ]]; then
  read -r -p "Optional: Install & enable Central Brain startup supervisor (LaunchAgent)? [y/N] " REPLY || true
  if [[ "${REPLY}" =~ ^[Yy]$ ]]; then
    INSTALL_TRAY="1"
  fi
fi

if [[ "${INSTALL_TRAY}" == "1" ]]; then
  SERVER_ENTRY=""
  for candidate in "${HOME}/LocalGravity/server/dist/index.js" "${HOME}/.localgravity/server/dist/index.js"; do
    if [[ -f "${candidate}" ]]; then
      SERVER_ENTRY="${candidate}"
      break
    fi
  done
  if [[ -n "${SERVER_ENTRY}" ]] && command -v node >/dev/null 2>&1; then
    mkdir -p "${HOME}/Library/LaunchAgents"
    PLIST="${HOME}/Library/LaunchAgents/com.localgravity.brain.plist"
    cat > "${PLIST}" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.localgravity.brain</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>node</string>
    <string>${SERVER_ENTRY}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
</dict>
</plist>
EOF
    launchctl unload "${PLIST}" >/dev/null 2>&1 || true
    launchctl load -w "${PLIST}"
    echo "Optional Central Brain LaunchAgent installed and started (${PLIST})."
  else
    echo "Note: Local server not found at ~/LocalGravity/server/dist/index.js; skipping LaunchAgent (you can still enable it later in Settings)."
  fi
fi
