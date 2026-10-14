#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v xcodegen >/dev/null 2>&1; then
  echo "xcodegen is required. Install: brew install xcodegen" >&2
  exit 1
fi

xcodegen generate
echo "Generated LightBeam.xcodeproj"

# Resolve SPM (non-fatal if Xcode/signing env is incomplete) then patch known upstream noise.
if command -v xcodebuild >/dev/null 2>&1; then
  xcodebuild -resolvePackageDependencies -project LightBeam.xcodeproj -scheme LightBeam >/dev/null 2>&1 || true
fi
bash scripts/patch-spm-checkouts.sh
