# Android Receiver Guide

## Install

- Prefer Play Store when available.
- Strict demo: install signed APK offline. Verify SHA-256 and certificate fingerprint on the About screen.
- Never install modified APKs.

## Offline use

1. Enable airplane mode (confirm no Wi‑Fi / cellular / Bluetooth as required by demo script).
2. Open LightBeam → **Scan TV**.
3. Grant camera permission.
4. Align the TV code in the guide frame.
5. Wait through: Searching → Session found → Reading manifest → Collecting data → Reconstructing → Verifying → Complete.
6. Save via the system document picker only after **Verified**.

## Decode Video

Use **Decode Video** to import a recorded MP4/WebM of the broadcast and decode faster than real time when the device allows. Prefer **H.264 MP4 (phone-safe)** from the encoder; WebM/VP9 is best-effort.

Only videos that contain flashing LightBeam QR frames can be recovered; ordinary clips report **no LightBeam signal**.

## Build

```bash
cd apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew :app:assembleDebug
```

Manifest must **not** include `INTERNET` for the strict demo flavor.
