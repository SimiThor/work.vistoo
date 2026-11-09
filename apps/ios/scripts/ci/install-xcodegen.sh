#!/bin/bash
# Installs a pinned XcodeGen release (checksum-verified) for CI and puts it on PATH.
# Bump both values together: https://github.com/yonaskolb/XcodeGen/releases
set -euo pipefail
VERSION="2.46.0"
SHA256="4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806"

DEST="${RUNNER_TEMP:-/tmp}/xcodegen-$VERSION"
if [ ! -x "$DEST/xcodegen/bin/xcodegen" ]; then
  mkdir -p "$DEST"
  curl -fsSL --retry 3 -o "$DEST/xcodegen.zip" \
    "https://github.com/yonaskolb/XcodeGen/releases/download/$VERSION/xcodegen.zip"
  echo "$SHA256  $DEST/xcodegen.zip" | shasum -a 256 -c -
  unzip -q -o "$DEST/xcodegen.zip" -d "$DEST"
fi
# The binary finds its setting presets in ../share relative to itself.
if [ -n "${GITHUB_PATH:-}" ]; then echo "$DEST/xcodegen/bin" >> "$GITHUB_PATH"; fi
"$DEST/xcodegen/bin/xcodegen" --version
