# ADR 0003 — QR symbols and frame timing

**Status:** Accepted  
**Date:** 2026-08-04  
**Updated:** 2026-10-14  
**Context:** PRD §28 decisions #1, #2, #8, #9, #10

## Decision

- **Standard QR** only in Phase 1 (no custom optical symbols).
- QR content = **raw LBOP bytes** (QR byte mode). Legacy Base64 payloads remain valid.
- **One QR per video frame** for Studio / Satellite Safe / Archive. **Lab (A) uses 4 tiles** (Decimen-style spatial multiplex) because room demos are not satellite-recompressed.
- Default playout **30 fps**; Satellite Safe holds each logical symbol for **3 video frames**.
- QR ECC **Medium** for satellite-safe; **Low** for lab profile (fountain handles erasures).
- Decode libraries: zxing-cpp on iOS and Android (binary multi-symbol). Receivers must ingest **all** QRs in a frame.
- Fountain degree distribution uses the **correct robust soliton** (`S = c·ln(k/δ)·√k`, spike at `round(k/S)`). Expected peel overhead ≈ 1.25×k.
- Beacon+manifest share ≈ **3%** of tiles (control pair every 16 Lab display ticks).

## Rationale

- Satellite recompression destroys fine modules; large quiet zones and multi-frame hold improve survival.
- Custom symbols are a Phase 1 non-goal.
- Hard cuts only — no fades between symbols.
- The previous robust-soliton implementation put ~80% of symbols at degree 1 and needed ~3.3×k airtime; the corrected distribution cuts transfer time by ~2.5× with no wire-format change (neighbors travel on the wire).

## Timing table

| Profile | FPS | Hold | Tiles | Approx symbol rate | Notes |
|---------|-----|------|-------|--------------------|-------|
| Studio | 30 | 2 | 1 | 15 Hz | Single large code |
| Satellite Safe | 30 (25 playout variant) | 3 | 1 | 10 Hz | Extra hold for re-encode |
| Lab | 60 | 2 | 4 | 120 Hz (30 display ticks/s × 4) | Room HDMI / laptop |
| Archive | 25 | 4 | 1 | 6.25 Hz | Conservative |

## Measured targets to fill in field tests

- Laptop → phone useful-symbol rate: measure during device matrix
- HDMI TV loss rate at 1.5 m / 3 m: measure
- After H.264 re-encode: measure
- Lab theoretical goodput after LT fix: ~65–70 KB/s (30 ticks/s × 4 × 768 B × 0.97 data share ÷ 1.25 overhead)
