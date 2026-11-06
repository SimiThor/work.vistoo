#!/bin/sh
# Builds and unit-tests VistooKit (VistooCore + VistooUI) with SwiftPM.
#
# With Xcode installed this is just `swift test`. With only the Command Line
# Tools, Swift Testing lives in a separate framework folder; pass its path.
# Note: this compiles the package for macOS. The iOS build and UI tests run in
# Xcode / CI (xcodebuild), see apps/ios/README.md.
set -eu
cd "$(dirname "$0")/../Packages/VistooKit"
CLT=/Library/Developer/CommandLineTools/Library/Developer
if xcode-select -p 2>/dev/null | grep -q CommandLineTools && [ -d "$CLT/Frameworks/Testing.framework" ]; then
  F="$CLT/Frameworks"
  exec swift test -Xswiftc -F -Xswiftc "$F" -Xlinker -F -Xlinker "$F" \
    -Xlinker -rpath -Xlinker "$F" -Xlinker -rpath -Xlinker "$CLT/usr/lib" "$@"
fi
exec swift test "$@"
