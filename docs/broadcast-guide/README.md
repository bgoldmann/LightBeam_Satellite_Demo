# Broadcast / Operator Guide — LightBeam Phase 1

## Deliverables from the web encoder

1. Prefer **`transmission-phone-safe.mp4`** (H.264) from the web encoder’s **Export H.264 MP4 (phone-safe)** button — required for reliable iOS Decode Video; recommended for Android.
2. `transmission.webm` is fine for preview / station handoff source; Android WebM is best-effort. Station may also transcode WebM→H.264:
   `ffmpeg -y -i transmission.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart transmission-phone-safe.mp4`
3. `transmission-manifest.json`
4. `verification-report.txt`
5. `checksum.sha256`

## Satellite Safe visual template

- Canvas: **1920×1080** progressive
- Background: dark solid `#0b1220` (no animated backdrop)
- Data QR: centered, ~55% of min(width,height), white pad + teal alignment border
- Title-safe margins ≥8%
- Top-right **logo safe** rectangle reserved for channel bug
- Bottom ticker safe: keep empty or station-controlled outside QR quiet zone
- Instruction copy EN + FA outside quiet zone
- Session short code visible
- Hard cuts only between symbols; hold **3 frames @ 30 fps** (or 25 fps playout variant)

## Playout ladder (required before public claims)

1. Browser preview → phone  
2. Laptop MP4/WebM → phone  
3. HDMI consumer TV → phone  
4. Station playout import  
5. Internal studio distribution  
6. Uplink preview  
7. Satellite downlink recording  
8. Consumer STB + TV  
9. Multi-device matrix  
10. Controlled public demo  

Do **not** claim satellite reliability before stages 1–8 pass.

## Station handoff notes

- Prefer high-bitrate H.264 High/Main mezzanine after WebM export.
- Disable consumer motion smoothing / frame interpolation on test TVs.
- Confirm logos/tickers never cover the QR region.
- Loop the same transmission 3–10 times.

## Photosensitivity

Keep background luminance stable; confine high-contrast changes to the QR region. Obtain broadcast safety review before public air.
