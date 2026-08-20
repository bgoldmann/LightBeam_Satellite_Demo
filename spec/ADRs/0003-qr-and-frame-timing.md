# ADR 0003 — QR symbols and frame timing

**Status:** Accepted  
**Date:** 2026-08-04  
**Context:** PRD §28 decisions #1, #2, #8, #9, #10

## Decision

- **Standard QR** only in Phase 1 (no custom optical symbols).
- QR content = **raw LBOP bytes** (QR byte mode). Legacy Base64 payloads remain valid.
- **One QR per video frame** for Studio / Satellite Safe / Archive. **Lab (A) uses 4 tiles** (Decimen-style spatial multiplex) because room demos are not satellite-recompressed.
- Default playout **30 fps**; Satellite Safe holds each logical symbol for **3 video frames**.
- QR ECC **Medium** for satellite-safe; **Low** for lab profile (fountain handles erasures).
- Decode libraries: zxing / ML Kit / Vision — platform choice OK if payload bytes match. Receivers must ingest **all** QRs in a frame.

## Rationale

- Satellite recompression destroys fine modules; large quiet zones and multi-frame hold improve survival.
- Custom symbols are a Phase 1 non-goal.
- Hard cuts only — no fades between symbols.

## Timing table

| Profile | FPS | Hold | Tiles | Approx symbol rate |
|---------|-----|------|-------|--------------------|
| Studio | 30 | 2 | 1 | 15 Hz |
| Satellite Safe | 30 (25 playout variant) | 3 | 1 | 10 Hz |
| Lab | 60 | 2 | 4 | 120 Hz (30 display ticks/s × 4) |

## Measured targets to fill in field tests

- Laptop → phone useful-symbol rate: measure during device matrix
- HDMI TV loss rate at 1.5 m / 3 m: measure
- After H.264 re-encode: measure
