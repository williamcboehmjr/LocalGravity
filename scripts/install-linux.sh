#!/usr/bin/env bash
set -euo pipefail

REPO="williamcboehmjr/LocalGravity"
API_URL="https://api.github.com/repos/${REPO}/releases/latest"
ARCH="$(uname -m)"

case "${ARCH}" in
  aarch64|arm64)
    TARGET_ARCH="arm64"
    ;;
  x86_64|amd64)
    TARGET_ARCH="amd64"
    ;;
  *)
    echo "Unsupported Linux CPU architecture: ${ARCH}" >&2
    exit 1
    ;;
esac

echo "Checking latest ${REPO} Linux (${TARGET_ARCH}) release..."
RELEASE_JSON="$(curl -fsSL "${API_URL}")"

pick_url() {
  local pattern="$1"
  printf '%s' "${RELEASE_JSON}" | grep -oE '"browser_download_url":[[:space:]]*"[^"]+"' | cut -d '"' -f 4 | grep -E "${pattern}" | head -n 1 || true
}

TMP_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

run_priv() {
  if [[ "$(id -u)" -eq 0 ]]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    "$@"
  fi
}

DEB_PATTERN="_${TARGET_ARCH}\\.deb$"
RPM_PATTERN="\\.$( [[ "${TARGET_ARCH}" == "arm64" ]] && echo "aarch64" || echo "x86_64" )\\.rpm$"
TAR_PATTERN="_linux_${TARGET_ARCH}\\.tar\\.gz$"
APPIMAGE_PATTERN="_${TARGET_ARCH}\\.AppImage$"

INSTALL_KIND=""
ASSET_URL=""

if command -v dpkg >/dev/null 2>&1; then
  ASSET_URL="$(pick_url "${DEB_PATTERN}")"
  [[ -n "${ASSET_URL}" ]] && INSTALL_KIND="deb"
fi

if [[ -z "${ASSET_URL}" ]] && command -v rpm >/dev/null 2>&1; then
  ASSET_URL="$(pick_url "${RPM_PATTERN}")"
  [[ -n "${ASSET_URL}" ]] && INSTALL_KIND="rpm"
fi

if [[ -z "${ASSET_URL}" ]]; then
  ASSET_URL="$(pick_url "${TAR_PATTERN}")"
  [[ -n "${ASSET_URL}" ]] && INSTALL_KIND="tar"
fi

if [[ -z "${ASSET_URL}" ]] && [[ "${TARGET_ARCH}" == "amd64" ]]; then
  ASSET_URL="$(pick_url "${APPIMAGE_PATTERN}")"
  [[ -n "${ASSET_URL}" ]] && INSTALL_KIND="appimage"
fi

if [[ -z "${ASSET_URL}" ]]; then
  echo "Error: Could not find a Linux ${TARGET_ARCH} installer asset in the latest GitHub release." >&2
  exit 1
fi

ASSET_NAME="$(basename "${ASSET_URL}")"
ASSET_PATH="${TMP_DIR}/${ASSET_NAME}"
echo "Downloading ${ASSET_NAME}..."
curl -fL --progress-bar "${ASSET_URL}" -o "${ASSET_PATH}"

case "${INSTALL_KIND}" in
  deb)
    echo "Installing Debian/Ubuntu package..."
    if command -v apt-get >/dev/null 2>&1; then
      run_priv apt-get install -y "${ASSET_PATH}" || {
        run_priv dpkg -i "${ASSET_PATH}" || true
        run_priv apt-get install -f -y
      }
    else
      run_priv dpkg -i "${ASSET_PATH}"
    fi
    ;;
  rpm)
    echo "Installing RPM package..."
    if command -v dnf >/dev/null 2>&1; then
      run_priv dnf install -y "${ASSET_PATH}"
    else
      run_priv rpm -Uvh --replacepkgs "${ASSET_PATH}"
    fi
    ;;
  tar)
    echo "Installing binary to /usr/local/bin/localgravity-edge..."
    tar -xzf "${ASSET_PATH}" -C "${TMP_DIR}"
    run_priv install -m 0755 "${TMP_DIR}/localgravity-edge" /usr/local/bin/localgravity-edge
    ;;
  appimage)
    echo "Installing AppImage to /usr/local/bin/localgravity-edge..."
    run_priv install -m 0755 "${ASSET_PATH}" /usr/local/bin/localgravity-edge
    ;;
esac

echo "LocalGravity Linux (${TARGET_ARCH}) installed. Launching localgravity-edge..."
if command -v localgravity-edge >/dev/null 2>&1; then
  nohup localgravity-edge >/dev/null 2>&1 &
fi

INSTALL_TRAY="${LOCALGRAVITY_INSTALL_TRAY:-}"
if [[ -z "${INSTALL_TRAY}" ]]; then
  for arg in "$@"; do
    [[ "${arg}" == "--with-tray" ]] && INSTALL_TRAY="1"
    [[ "${arg}" == "--no-tray" ]] && INSTALL_TRAY="0"
  done
fi
if [[ -z "${INSTALL_TRAY}" ]] && [[ -t 0 ]]; then
  read -r -p "Optional: Install & enable Central Brain startup supervisor (systemd user service)? [y/N] " REPLY || true
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
  if [[ -n "${SERVER_ENTRY}" ]] && command -v node >/dev/null 2>&1 && command -v systemctl >/dev/null 2>&1; then
    mkdir -p "${HOME}/.config/systemd/user"
    UNIT="${HOME}/.config/systemd/user/localgravity-brain.service"
    cat > "${UNIT}" <<EOF
[Unit]
Description=LocalGravity Central Brain Supervisor
After=network.target

[Service]
ExecStart=/usr/bin/env node ${SERVER_ENTRY}
Restart=always
RestartSec=3

[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now localgravity-brain.service
    echo "Optional Central Brain systemd service enabled and started (${UNIT})."
  else
    echo "Note: Local server not found at ~/LocalGravity/server/dist/index.js; skipping background service (you can enable it later in Settings)."
  fi
fi
