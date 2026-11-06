#!/bin/sh
# Archives the Release build (server: https://workvistoo.vercel.app) and uploads it to
# App Store Connect / TestFlight. Requires Xcode with your Apple account signed in
# (Xcode → Settings → Accounts) and DEVELOPMENT_TEAM in Config/Signing.local.xcconfig.
#   sh apps/ios/scripts/testflight.sh
set -eu
cd "$(dirname "$0")/.."
export DEVELOPER_DIR="${DEVELOPER_DIR:-/Applications/Xcode.app/Contents/Developer}"
BUILD="$(date -u +%Y%m%d%H%M)"   # unique, increasing build number per upload
ARCHIVE="build/VistooWork-$BUILD.xcarchive"
xcodegen generate
xcodebuild archive \
  -project VistooWork.xcodeproj -scheme VistooWork -configuration Release \
  -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
  -allowProvisioningUpdates CURRENT_PROJECT_VERSION="$BUILD"
xcodebuild -exportArchive -archivePath "$ARCHIVE" \
  -exportOptionsPlist scripts/ExportOptions.plist -exportPath "build/export-$BUILD" \
  -allowProvisioningUpdates
echo "✓ Build $BUILD hochgeladen. In App Store Connect → TestFlight erscheint er nach der Verarbeitung (meist 10–30 min)."
