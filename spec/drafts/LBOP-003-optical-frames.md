# LBOP-003 — Optical Frame Layer

**Document:** LBOP-003  
**Status:** Working Draft  
**Normative for:** QR mapping and symbol hold timing  
**See also:** [ADR 0003](../ADRs/0003-qr-and-frame-timing.md), [LBOP-004](./LBOP-004-profiles.md)

## 1. Decisions (Phase 1)

- **Standard QR** only (no custom optical symbols).
- QR content = **raw LBOP frame bytes** in QR byte mode. Receivers **MUST** also accept legacy **Base64(LBOP)** payloads from older transmissions.
- **Spatial multiplex:** Lab (A) paints **4 independent QRs per video frame** (2×2). Other profiles paint 1. Receivers MUST ingest every decoded QR in a camera/video frame, not only the largest.
- Hard cuts only — no fades between symbols.

## 2. ECC

- Satellite Safe / Studio: QR ECC **Medium**
- Lab / Ultra Fast: QR ECC **Low** (fountain handles erasures)
- Archive: QR ECC **Medium** or **Quartile** (implementation choice documented in LBOP-004)

## 3. Timing

Default playout **30 fps** unless profile says otherwise. Each logical LBOP symbol is held for `holdFrames` video frames.

| Profile | FPS | Hold | Tiles | Approx symbol rate |
|---------|-----|------|-------|--------------------|
| Studio (B) | 30 | 2 | 1 | 15 Hz |
| Satellite Safe (C) | 30 (25 playout variant) | 3 | 1 | 10 Hz |
| Lab (A) | 60 | 2 | 4 | 120 Hz (30 unique display ticks/s × 4 codes) |
| Archive (D) | 25 | 4 | 1 | ~6.25 Hz |

## 4. Decode libraries

Platform choice (zxing / ML Kit / Vision / BarcodeDetector) is OK if recovered payload bytes match LBOP-001.
