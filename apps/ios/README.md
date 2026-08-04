# LightBeam iOS Receiver

Offline optical file receiver for **LBOP/1** (LightBeam Optical Protocol). Scans QR codes from live TV/screen broadcasts or decodes exported video — no network required.

## Requirements

- macOS with **Xcode 15+** (iOS 16 SDK)
- [XcodeGen](https://github.com/yonaskolb/XcodeGen) (`brew install xcodegen`)
- Physical iPhone/iPad for camera scanning (Simulator can run video decode tests)

## Open & build

```bash
cd apps/ios
chmod +x generate.sh
./generate.sh
open LightBeam.xcodeproj
```

Or one-shot CLI build (Simulator):

```bash
cd apps/ios
./generate.sh
xcodebuild \
  -project LightBeam.xcodeproj \
  -scheme LightBeam \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  -quiet \
  build
```

Run unit tests (includes golden vector from `spec/test-vectors/v0.1-golden.json`):

```bash
xcodebuild \
  -project LightBeam.xcodeproj \
  -scheme LightBeam \
  -destination 'platform=iOS Simulator,name=iPhone 16' \
  test
```

## App structure

| Path | Purpose |
|------|---------|
| `LightBeam/Protocol/` | LBOP frame parse, data payload, LT peel decoder, minimal CBOR manifest decoder |
| `LightBeam/Services/` | Camera scanner (AVFoundation + Vision), video frame sampler, file store |
| `LightBeam/Views/` | Home, live scanner, video decode, completion/share, info screens |
| `LightBeam/en.lproj`, `fa.lproj` | English + Persian UI strings |

## Features

- **Bundle ID:** `com.goldmannllc.LightBeam`
- **Minimum iOS:** 16
- **Camera:** `NSCameraUsageDescription` for offline QR reception
- **No network calls** in app code
- **QR format:** base64-encoded LBOP frame bytes (matches web encoder)
- **Progress stages:** Searching → Session found → Reading manifest → Collecting data → Reconstructing → Verifying → Complete
- **Verified files** saved under Documents and shared via `ShareLink`

## Protocol notes

- **Beacon:** JSON (`block_count`, `block_size`, `original_len`, `payload_hash`, …)
- **Manifest:** CBOR map decoded for `block_count`, `block_size`, `encoded_byte_length`, `original_byte_length`, `payload_hash`, `filename`, `title`, `publisher_name`, `mime_type`, `compression`
- **Data frames:** LT fountain symbols with neighbor list + XOR payload
- **Verification:** SHA-256 of reconstructed encoded payload vs manifest/beacon hash; optional deflate decompression

## Testing with web encoder

1. Run `apps/web-encoder` and export a broadcast video or display QR on screen.
2. In LightBeam: **Scan TV** (live) or **Decode Video** (import recording).
3. Check **Recovered Files** and share the verified output.

## Regenerate project

After adding/removing Swift files, re-run `./generate.sh` so XcodeGen updates `project.pbxproj`.
