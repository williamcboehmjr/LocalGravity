#!/usr/bin/env bash
set -euo pipefail

# Ensure Rust / Cargo and local bins are on PATH in non-interactive WSL shells
if [ -f "$HOME/.cargo/env" ]; then
  # shellcheck disable=SC1091
  source "$HOME/.cargo/env"
fi
export PATH="$HOME/.local/bin:/usr/local/bin:$PATH"

# Allow AppImage / linuxdeploy tools to run cleanly inside WSL2 without requiring FUSE mounts
export APPIMAGE_EXTRACT_AND_RUN=1

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WIN_REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
BUILD_ROOT="$HOME/localgravity-linux-build"
OUT_DIR="$WIN_REPO_ROOT/dist-release/linux-x64"

echo "=== LocalGravity Linux x64 WSL2 Builder ==="
echo "Repo source : $WIN_REPO_ROOT"
echo "Build dir   : $BUILD_ROOT"
echo "Output dir  : $OUT_DIR"

mkdir -p "$BUILD_ROOT/client" "$BUILD_ROOT/shared" "$OUT_DIR"

# Sync client and shared onto native Linux ext4 filesystem for fast Cargo/Vite builds
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude 'dist' \
  --exclude 'src-tauri/target' \
  --exclude 'src-tauri/gen/android' \
  "$WIN_REPO_ROOT/client/" "$BUILD_ROOT/client/"

rsync -a --delete "$WIN_REPO_ROOT/shared/" "$BUILD_ROOT/shared/"

KEY_PATH="$BUILD_ROOT/client/src-tauri/localgravity-updater.key"
if [ ! -f "$KEY_PATH" ]; then
  echo "ERROR: Signing key missing at $KEY_PATH" >&2
  exit 1
fi

export TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY="$(tr -d '\r\n' < "$KEY_PATH")"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""

cd "$BUILD_ROOT/client"

if [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi

BUNDLE_DIR="$BUILD_ROOT/client/src-tauri/target/release/bundle"
rm -f "$BUNDLE_DIR/deb/"*.deb "$BUNDLE_DIR/deb/"*.sig "$BUNDLE_DIR/appimage/"*.AppImage* "$BUNDLE_DIR/appimage/"*.sig 2>/dev/null || true

npx tauri build --bundles deb,appimage

rm -f "$OUT_DIR"/*.deb "$OUT_DIR"/*.AppImage "$OUT_DIR"/*.AppImage.sig "$OUT_DIR"/*.tar.gz "$OUT_DIR"/*.tar.gz.sig 2>/dev/null || true

shopt -s nullglob
DEB_FILES=("$BUNDLE_DIR"/deb/*.deb)
APPIMAGE_FILES=("$BUNDLE_DIR"/appimage/*.AppImage)

if [ ${#DEB_FILES[@]} -eq 0 ] && [ ${#APPIMAGE_FILES[@]} -eq 0 ]; then
  echo "ERROR: No .deb or .AppImage bundles found under $BUNDLE_DIR" >&2
  exit 1
fi

for f in "${DEB_FILES[@]}"; do
  cp -f "$f" "$OUT_DIR/"
done

for f in "${APPIMAGE_FILES[@]}"; do
  base="$(basename "$f")"
  cp -f "$f" "$OUT_DIR/$base"
  if [ -f "${f}.sig" ]; then
    cp -f "${f}.sig" "$OUT_DIR/${base}.sig"
  elif [ -f "${f}.tar.gz.sig" ]; then
    cp -f "${f}.tar.gz.sig" "$OUT_DIR/${base}.sig"
  else
    echo "Generating updater signature for $base..."
    npx tauri signer sign -f "$KEY_PATH" --password "" "$OUT_DIR/$base"
  fi
done

echo "=== Built Linux x64 artifacts ==="
ls -lh "$OUT_DIR"
