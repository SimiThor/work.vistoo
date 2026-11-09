#!/bin/bash
# CI only: archives the Release build with the signing from setup-signing.sh, verifies the
# result and uploads it to App Store Connect (TestFlight). Never submits for App Store review.
#
#   archive-and-upload.sh archive   → build/ci/VistooWork.xcarchive
#   archive-and-upload.sh upload    → export with destination=upload (App Store Connect API key)
#
# Environment: BUILD_NUMBER (required), APPLE_TEAM_ID, VISTOO_PROFILE_UUID, VISTOO_BUNDLE_ID
# (from setup-signing.sh); for upload also ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY.
set -euo pipefail
fail() { echo "::error title=$1::$2"; exit 1; }

cd "$(dirname "$0")/../.."
OUT="build/ci"
ARCHIVE="$OUT/VistooWork.xcarchive"
: "${BUILD_NUMBER:?BUILD_NUMBER is required}"
[[ "$BUILD_NUMBER" =~ ^[0-9]+$ ]] || fail "Build number" "BUILD_NUMBER must be an integer (got '$BUILD_NUMBER')."

case "${1:-}" in
archive)
  mkdir -p "$OUT"
  xcodegen generate --quiet
  echo "Archiving build $BUILD_NUMBER (Release) …"
  # -quiet keeps the log readable: warnings and errors only.
  if ! xcodebuild archive -quiet \
      -project VistooWork.xcodeproj -scheme VistooWork -configuration Release \
      -destination 'generic/platform=iOS' -archivePath "$ARCHIVE" \
      -clonedSourcePackagesDirPath "$OUT/SourcePackages" \
      CURRENT_PROJECT_VERSION="$BUILD_NUMBER"; then
    fail "Archive failed" "xcodebuild archive failed, see the errors above (signing problems mention 'provisioning profile' or 'certificate')."
  fi

  # Verify what we are about to upload.
  APP="$ARCHIVE/Products/Applications/VistooWork.app"
  [ -d "$APP" ] || fail "Archive" "No VistooWork.app in the archive."
  plist() { /usr/libexec/PlistBuddy -c "Print :$1" "$APP/Info.plist"; }
  [ "$(plist CFBundleVersion)" = "$BUILD_NUMBER" ] || fail "Build number" "CFBundleVersion is $(plist CFBundleVersion), expected $BUILD_NUMBER."
  [ "$(plist CFBundleIdentifier)" = "$VISTOO_BUNDLE_ID" ] || fail "Bundle id" "Bundle id is $(plist CFBundleIdentifier), expected $VISTOO_BUNDLE_ID."
  [ "$(plist VistooServerURL)" = "https://workvistoo.vercel.app" ] || fail "Server URL" "Release build points to $(plist VistooServerURL)."
  AUTHORITY=$(codesign -dvv "$APP" 2>&1 | grep -m1 '^Authority=' | cut -d= -f2-)
  [[ "$AUTHORITY" == "Apple Distribution:"* ]] || fail "Signing" "App is signed by '$AUTHORITY', expected an Apple Distribution certificate."
  ENTITLEMENTS=$(codesign -d --entitlements - --xml "$APP" 2>/dev/null)
  grep -q '<string>production</string>' <<< "$ENTITLEMENTS" || fail "Entitlements" "aps-environment is not 'production'."
  grep -q 'applinks:' <<< "$ENTITLEMENTS" || fail "Entitlements" "Associated Domains (applinks) missing."
  if grep -q 'get-task-allow</key>[[:space:]]*<true/>' <<< "$ENTITLEMENTS"; then fail "Entitlements" "get-task-allow is true (development signing)."; fi
  echo "✓ Archive OK: $(plist CFBundleShortVersionString) ($BUILD_NUMBER), $AUTHORITY"
  ;;

upload)
  [ -d "$ARCHIVE" ] || fail "Upload" "No archive at $ARCHIVE. Run 'archive' first."
  for v in ASC_KEY_ID ASC_ISSUER_ID ASC_PRIVATE_KEY; do
    [ -n "${!v:-}" ] || fail "Upload" "$v is not set. Add it to the GitHub environment 'testflight' (see docs/setup/ios-testflight.md)."
  done
  KEY_DIR="$RUNNER_TEMP/asc"
  mkdir -p "$KEY_DIR"
  KEY="$KEY_DIR/AuthKey_$ASC_KEY_ID.p8"
  printf '%s\n' "$ASC_PRIVATE_KEY" > "$KEY"
  chmod 600 "$KEY"
  trap 'rm -f "$KEY"' EXIT

  EXPORT_OPTIONS="$OUT/ExportOptions.plist"
  cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>method</key><string>app-store-connect</string>
	<key>destination</key><string>upload</string>
	<key>teamID</key><string>$APPLE_TEAM_ID</string>
	<key>signingStyle</key><string>manual</string>
	<key>signingCertificate</key><string>Apple Distribution</string>
	<key>provisioningProfiles</key>
	<dict><key>$VISTOO_BUNDLE_ID</key><string>$VISTOO_PROFILE_UUID</string></dict>
	<key>manageAppVersionAndBuildNumber</key><false/>
	<key>uploadSymbols</key><true/>
</dict>
</plist>
EOF
  echo "Uploading build $BUILD_NUMBER to App Store Connect …"
  LOG="$OUT/upload.log"
  set +e
  xcodebuild -exportArchive -archivePath "$ARCHIVE" \
    -exportOptionsPlist "$EXPORT_OPTIONS" -exportPath "$OUT/export" \
    -authenticationKeyPath "$KEY" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID" \
    2>&1 | tee "$LOG"
  STATUS=${PIPESTATUS[0]}
  set -e
  if [ "$STATUS" != 0 ] || ! grep -q "EXPORT SUCCEEDED" "$LOG"; then
    HINT="see the log above."
    grep -qi "bundle version must be higher\|has already been used\|redundant binary" "$LOG" && HINT="this build number already exists in App Store Connect. Re-run the workflow (a new number is generated)."
    grep -qi "401\|not authorized\|authentication" "$LOG" && HINT="App Store Connect rejected the API key (ASC_KEY_ID / ASC_ISSUER_ID / ASC_PRIVATE_KEY, role 'App Manager' or higher)."
    grep -qi "No suitable application records\|app record" "$LOG" && HINT="no app with bundle id $VISTOO_BUNDLE_ID exists in App Store Connect."
    fail "Upload failed" "Upload to App Store Connect failed: $HINT"
  fi
  echo "✓ Build $BUILD_NUMBER uploaded. Apple processes it now (usually 5–30 min)."
  ;;

*)
  echo "usage: $0 archive|upload" >&2
  exit 2
  ;;
esac
