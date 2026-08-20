# LightBeam — Decimen Optical Transfer Study Notes

Reference: https://github.com/bashalarmistalt/decimen-optical-transfer

## Key takeaways for Milestone 0

1. **Fountain codes (Luby Transform)** solve the one-way channel problem: receiver needs any ~K·1.15 distinct symbols; order and drops do not matter.
2. **QR + fountain layering**: in-frame ECC handles corruption; fountain handles erasures. Prefer Low/Medium QR ECC for capacity; rely on FEC for misses.
3. **Safari lacks BarcodeDetector** — use zxing-cpp (WASM or native) for decode parity.
4. **Multiple codes per frame** is the largest QR-compatible speedup (~4×). Decimen measured ~199 KB/s phone→phone and ~418 KB/s desktop→phone with 4 binary QR v27 codes. LightBeam Lab now uses 4 binary QRs (768-byte blocks) decoded with zxing-cpp; Base64 remains accepted for older videos.
5. **Backpressure**: busy decode workers drop frames; fountain absorbs drops.
6. **Header must be self-describing**: session id, symbol id, block count, length, hash so midstream join works.
7. **Broadcast differs from phone-to-phone**: LightBeam must use larger modules, multi-frame hold, and higher redundancy for satellite chains.

## LightBeam deltas vs Decimen

| Area | Decimen | LightBeam Phase 1 |
|------|---------|-------------------|
| Transport | Browser screen | Broadcast-safe H.264 MP4 on satellite TV |
| Crypto | None (public optical) | Ed25519 + optional password AEAD |
| Manifest | Minimal header | Canonical CBOR signed manifest |
| Receivers | Browser | Native Android + iOS apps (offline) |
| Profile | High density, 4 binary QR/frame | Lab: 4 binary QR/frame (zxing-cpp); C: one conservative code |

## Measured targets (to fill during M0 device tests)

- Laptop → phone FPS analyzed: _TBD_
- Useful symbol rate: _TBD_
- Symbols to complete K blocks: _TBD_
- Loss rate at 1.5 m / 3 m: _TBD_
