# iOS Receiver Guide

## Distribution

The LightBeam iOS app must be installed through an Apple-approved channel (TestFlight / App Store / enterprise) **before** the user goes offline. The optical channel cannot install iOS apps.

## Offline use

1. Airplane mode.
2. Open LightBeam → **Scan TV**.
3. Point the camera at the television code.
4. On completion, preview with Quick Look, save to Files, or Share.

## Decode Video

Use **Decode Video** to import a recorded **H.264 MP4** of the broadcast (phone-safe export from the web encoder). WebM often fails with a clear **unsupported format** message — re-export as H.264 MP4.

Only videos that contain flashing LightBeam QR frames can be recovered; ordinary news/YouTube clips will report **no optical signal**.
Import a local recording via the system picker; decoding uses AVAssetReader and never uploads media.

## Build

```bash
cd apps/ios
./generate.sh   # requires xcodegen
open LightBeam.xcodeproj
# or:
xcodebuild -project LightBeam.xcodeproj -scheme LightBeam \
  -destination 'platform=iOS Simulator,name=iPhone 16' build
```
