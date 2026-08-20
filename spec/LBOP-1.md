# LBOP/1 — LightBeam Optical Protocol Version 1

**Status:** Alpha freeze for Phase 1 demo  
**Date:** 2026-08-04

This file is the **Phase 1 freeze pointer**. Normative content is maintained in the LBOP-00x drafts (split from this document). Implementations MUST remain interoperable with the rules summarized below and detailed in the drafts.

## Document map

| Topic | Draft |
|-------|-------|
| Architecture | [drafts/LBOP-000.md](./drafts/LBOP-000.md) |
| Wire format / frames / fountain | [drafts/LBOP-001-wire-format.md](./drafts/LBOP-001-wire-format.md) |
| LBPK package / manifest / ACE labels | [drafts/LBOP-002-package.md](./drafts/LBOP-002-package.md) |
| QR & optical timing | [drafts/LBOP-003-optical-frames.md](./drafts/LBOP-003-optical-frames.md) |
| Broadcast profiles A–D | [drafts/LBOP-004-profiles.md](./drafts/LBOP-004-profiles.md) |
| Security & trust | [drafts/LBOP-005-security.md](./drafts/LBOP-005-security.md) |
| SDK outline | [drafts/LBOP-006-sdk.md](./drafts/LBOP-006-sdk.md) |

## 1. Package layers

```text
Original file
  → ACE: none | zstd | deflate
  → optional Argon2id + XChaCha20-Poly1305
  → SHA-256 payload hash
  → canonical CBOR manifest + Ed25519 signature
  → fixed source blocks
  → LT fountain symbols
  → LBOP frame envelope
  → QR (Base64 of frame bytes)
  → broadcast video
```

## 2–7. Normative details

See LBOP-001 (wire), LBOP-002 (manifest), LBOP-003 (QR), LBOP-004 (profiles), LBOP-005 (trust).

### Quick reference — frame envelope

Magic `LBOP`; version; type; flags; 16-byte session; u64 symbol id; u16 payload length; header CRC32; payload; frame CRC32. Types: Beacon `0x01`, Manifest `0x02`, Data `0x03`, EndLoop `0x04`.

### Quick reference — compression

`compression`: `none` | `deflate` | `zstd`.

### Quick reference — profiles

`lab` (A), `studio` (B), `satellite_safe` (C), `archive` (D).

## 8. Test vectors

See [`test-vectors/v0.1-golden.json`](./test-vectors/v0.1-golden.json). Regenerate:

```bash
cargo run -p test-vector-generator
```

## 9. Versioning

Breaking wire changes require `protocol_version` bump and new ADR.
