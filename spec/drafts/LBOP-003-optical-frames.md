# LBOP-003 — Optical Frame Layer

**Document:** LBOP-003  
**Status:** Working Draft  
**Normative for:** QR mapping and symbol hold timing  
**See also:** [ADR 0003](../ADRs/0003-qr-and-frame-timing.md), [LBOP-004](./LBOP-004-profiles.md)

## 1. Decisions (Phase 1)

- **Standard QR** only (no custom optical symbols).
- **One large QR per video frame**, centered in broadcast-safe margins.
- QR content = **Base64(LBOP frame bytes)** for scanner compatibility.
- Hard cuts only — no fades between symbols.

## 2. ECC

- Satellite Safe / Studio: QR ECC **Medium**
- Lab / Ultra Fast: QR ECC **Low** (fountain handles erasures)
- Archive: QR ECC **Medium** or **Quartile** (implementation choice documented in LBOP-004)

## 3. Timing

Default playout **30 fps** unless profile says otherwise. Each logical LBOP symbol is held for `holdFrames` video frames.

| Profile | FPS | Hold | Approx symbol rate |
|---------|-----|------|--------------------|
| Studio (B) | 30 | 2 | 15 Hz |
| Satellite Safe (C) | 30 (25 playout variant) | 3 | 10 Hz |
| Lab (A) | 60 | 1 | 60 Hz |
| Archive (D) | 25 | 4 | ~6.25 Hz |

## 4. Decode libraries

Platform choice (zxing / ML Kit / Vision / BarcodeDetector) is OK if recovered payload bytes match LBOP-001.
