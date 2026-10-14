#!/usr/bin/env bash
# Patch SPM checkouts that emit noise or break under Xcode 16+/26.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PATCH_MAP="$ROOT/patches/zxing-cpp-module.modulemap"

# Prefer DerivedData used by this machine's Xcode builds.
CANDIDATES=(
  "$HOME/Library/Developer/Xcode/DerivedData/LightBeam-dbziahkttpqqzhgxaqawpsoqjjdd/SourcePackages/checkouts/zxing-cpp"
  "$HOME/Library/Developer/Xcode/DerivedData/LightBeam-device/SourcePackages/checkouts/zxing-cpp"
)

# Also scan any LightBeam DerivedData folders.
while IFS= read -r dir; do
  CANDIDATES+=("$dir")
done < <(find "$HOME/Library/Developer/Xcode/DerivedData" -maxdepth 3 -type d -path '*/SourcePackages/checkouts/zxing-cpp' 2>/dev/null || true)

patched=0
seen=()
for checkout in "${CANDIDATES[@]}"; do
  [[ -d "$checkout" ]] || continue
  # De-dupe
  skip=0
  for s in "${seen[@]:-}"; do
    [[ "$s" == "$checkout" ]] && skip=1 && break
  done
  (( skip )) && continue
  seen+=("$checkout")

  map="$checkout/wrappers/ios/Sources/Wrapper/module.modulemap"
  if [[ -f "$map" ]]; then
    if grep -q 'umbrella header' "$map" 2>/dev/null; then
      chmod u+w "$map" 2>/dev/null || true
      cp "$PATCH_MAP" "$map"
      echo "Patched zxing module.modulemap → $map"
      patched=1
    else
      echo "Already patched: $map"
    fi
  fi

  # Do not patch Package.swift with unsafeFlags — SPM then refuses the product
  # as a dependency of the app target. The module.modulemap override is enough.
done

if (( patched == 0 )); then
  echo "No zxing-cpp checkout found to patch (resolve packages in Xcode first, then re-run)."
fi
