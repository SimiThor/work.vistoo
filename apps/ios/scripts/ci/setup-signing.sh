#!/bin/bash
# CI only: installs the App Store distribution certificate and provisioning profile from
# GitHub secrets into a temporary keychain and writes Config/Signing.local.xcconfig so the
# Release archive is signed manually for App Store Connect. Nothing is written to the repo.
#
# Required environment (GitHub environment "testflight"):
#   APPLE_TEAM_ID                  variable, e.g. W5A4L2PF28
#   IOS_DIST_CERT_P12_BASE64       secret, base64 of the "Apple Distribution" .p12
#   IOS_DIST_CERT_PASSWORD         secret, password of that .p12
#   IOS_APPSTORE_PROFILE_BASE64    secret, base64 of the App Store .mobileprovision
# Optional: VISTOO_BUNDLE_ID (default de.vistoo.work, must match Config/Shared.xcconfig)
set -euo pipefail

fail() { echo "::error title=Signing::$1"; exit 1; }

[ "${GITHUB_ACTIONS:-}" = "true" ] || fail "setup-signing.sh only runs in GitHub Actions (it changes keychains and Config/Signing.local.xcconfig)."
for v in APPLE_TEAM_ID IOS_DIST_CERT_P12_BASE64 IOS_DIST_CERT_PASSWORD IOS_APPSTORE_PROFILE_BASE64; do
  [ -n "${!v:-}" ] || fail "$v is not set. Add it to the GitHub environment 'testflight' (see docs/setup/ios-testflight.md)."
done
BUNDLE_ID="${VISTOO_BUNDLE_ID:-de.vistoo.work}"
IOS_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
WORK="$RUNNER_TEMP/signing"
mkdir -p "$WORK"

# --- Certificate → temporary keychain -------------------------------------------------------
KEYCHAIN="$WORK/vistoo-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -hex 24)"
echo "::add-mask::$KEYCHAIN_PASSWORD"
security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"
security set-keychain-settings -lut 21600 "$KEYCHAIN"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN"

P12="$WORK/dist.p12"
printf '%s' "$IOS_DIST_CERT_P12_BASE64" | base64 --decode > "$P12" 2>/dev/null \
  || fail "IOS_DIST_CERT_P12_BASE64 is not valid base64."
security import "$P12" -k "$KEYCHAIN" -f pkcs12 -P "$IOS_DIST_CERT_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >/dev/null \
  || { rm -f "$P12"; fail "Could not import the .p12 (wrong IOS_DIST_CERT_PASSWORD or not a PKCS#12 file)."; }
rm -f "$P12"
security set-key-partition-list -S apple-tool:,apple: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN" >/dev/null
# Prepend the keychain to the search list (keep the existing ones).
EXISTING=$(security list-keychains -d user | sed -e 's/^[[:space:]]*"//' -e 's/"$//')
# shellcheck disable=SC2086
security list-keychains -d user -s "$KEYCHAIN" $EXISTING

IDENTITY_LINE=$(security find-identity -v -p codesigning "$KEYCHAIN" | grep "Apple Distribution" | grep "($APPLE_TEAM_ID)" | head -1 || true)
[ -n "$IDENTITY_LINE" ] || fail "The .p12 contains no valid 'Apple Distribution' identity for team $APPLE_TEAM_ID (expired, revoked, or a development certificate?)."
CERT_SHA1=$(echo "$IDENTITY_LINE" | awk '{print $2}')
echo "Signing identity: $(echo "$IDENTITY_LINE" | sed -E 's/.*"(.*)"/\1/')"

# Warn 30 days before the certificate expires.
CERT_PEM="$WORK/cert.pem"
security find-certificate -a -Z -p "$KEYCHAIN" | awk -v sha="$CERT_SHA1" '
  /^SHA-1 hash:/ { keep = ($3 == sha) } keep && /BEGIN CERTIFICATE/,/END CERTIFICATE/ { print }' > "$CERT_PEM"
if ! openssl x509 -in "$CERT_PEM" -noout -checkend $((30 * 86400)) >/dev/null 2>&1; then
  echo "::warning title=Signing::Distribution certificate expires within 30 days ($(openssl x509 -in "$CERT_PEM" -noout -enddate | cut -d= -f2)). Renew it (docs/setup/ios-testflight.md)."
fi
rm -f "$CERT_PEM"

# --- Provisioning profile ---------------------------------------------------------------------
PROFILE="$WORK/appstore.mobileprovision"
printf '%s' "$IOS_APPSTORE_PROFILE_BASE64" | base64 --decode > "$PROFILE" 2>/dev/null \
  || fail "IOS_APPSTORE_PROFILE_BASE64 is not valid base64."
PLIST="$WORK/profile.plist"
security cms -D -i "$PROFILE" > "$PLIST" 2>/dev/null || fail "IOS_APPSTORE_PROFILE_BASE64 is not a provisioning profile."
# Read the fields we check (plistlib handles <data>/<date> reliably).
PROFILE_INFO=$(python3 -I - "$PLIST" <<'PY'
import hashlib, plistlib, sys
from datetime import datetime, timezone
p = plistlib.load(open(sys.argv[1], "rb"))
e = p.get("Entitlements", {})
days = (p["ExpirationDate"].replace(tzinfo=timezone.utc) - datetime.now(timezone.utc)).days
print("\t".join([
    p["UUID"], p["Name"], e.get("application-identifier", ""), e.get("aps-environment", ""),
    "1" if e.get("com.apple.developer.associated-domains") else "0",
    "1" if p.get("ProvisionedDevices") else "0",
    ",".join(hashlib.sha1(c).hexdigest().upper() for c in p.get("DeveloperCertificates", [])),
    p["ExpirationDate"].strftime("%Y-%m-%d"), str(days),
]))
PY
) || fail "Could not read the provisioning profile."
IFS=$'\t' read -r PROFILE_UUID PROFILE_NAME APP_ID APS HAS_DOMAINS HAS_DEVICES PROFILE_CERTS EXPIRY DAYS_LEFT <<< "$PROFILE_INFO"

[ "$APP_ID" = "$APPLE_TEAM_ID.$BUNDLE_ID" ] || fail "Profile '$PROFILE_NAME' is for '$APP_ID', expected '$APPLE_TEAM_ID.$BUNDLE_ID'."
[ "$HAS_DEVICES" = 0 ] || fail "Profile '$PROFILE_NAME' lists devices: it is a development/ad-hoc profile. Create an 'App Store Connect' distribution profile."
[ "$APS" = "production" ] || fail "Profile '$PROFILE_NAME' has no Push capability (aps-environment='$APS'). Enable Push Notifications on the App ID and regenerate the profile."
[ "$HAS_DOMAINS" = 1 ] || fail "Profile '$PROFILE_NAME' lacks Associated Domains. Enable the capability on the App ID and regenerate the profile."
case ",$PROFILE_CERTS," in
  *",$CERT_SHA1,"*) ;;
  *) fail "Profile '$PROFILE_NAME' does not include the distribution certificate from IOS_DIST_CERT_P12_BASE64. Regenerate the profile and select this certificate." ;;
esac
[ "$DAYS_LEFT" -ge 0 ] || fail "Profile '$PROFILE_NAME' expired on $EXPIRY."
if [ "$DAYS_LEFT" -lt 30 ]; then
  echo "::warning title=Signing::Provisioning profile '$PROFILE_NAME' expires on $EXPIRY. Renew it (docs/setup/ios-testflight.md)."
fi

for dir in "$HOME/Library/MobileDevice/Provisioning Profiles" "$HOME/Library/Developer/Xcode/UserData/Provisioning Profiles"; do
  mkdir -p "$dir"
  cp "$PROFILE" "$dir/$PROFILE_UUID.mobileprovision"
done
echo "Provisioning profile: $PROFILE_NAME ($PROFILE_UUID), expires $EXPIRY"

# --- Build settings for this run (git-ignored file, included by Config/Shared.xcconfig) ------
SIGNING_XCCONFIG="$IOS_DIR/Config/Signing.local.xcconfig"
[ ! -e "$SIGNING_XCCONFIG" ] || fail "$SIGNING_XCCONFIG already exists in the checkout; refusing to overwrite it."
cat > "$SIGNING_XCCONFIG" <<EOF
// Generated by scripts/ci/setup-signing.sh for this CI run only.
DEVELOPMENT_TEAM = $APPLE_TEAM_ID
VISTOO_CODE_SIGN_STYLE = Manual
VISTOO_CODE_SIGN_IDENTITY = Apple Distribution
VISTOO_PROVISIONING_PROFILE = $PROFILE_UUID
VISTOO_APS_ENVIRONMENT = production
EOF

{
  echo "VISTOO_KEYCHAIN=$KEYCHAIN"
  echo "VISTOO_PROFILE_UUID=$PROFILE_UUID"
  echo "VISTOO_BUNDLE_ID=$BUNDLE_ID"
} >> "$GITHUB_ENV"
echo "✓ Signing ready"
