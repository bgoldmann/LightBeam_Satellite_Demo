# LBOP-000 — LightBeam Optical Broadcast Protocol
## Internet Draft (Architecture)

**Document:** LBOP-000  
**Version:** 0.2  
**Status:** Internet Draft (Working Document) — **non-normative architecture**  
**Intended status:** Informational  
**Date:** 2026-08-04  
**Compatibility:** The first interoperable on-wire profile is **LBOP/1** (Phase 1 demo). Normative wire and package rules live in LBOP-001–005. This document describes the overall architecture and design goals.

## Abstract

LBOP is an open protocol for transporting digital data over optical media (screens, televisions, projectors, and recorded video). It enables offline receivers to reconstruct authenticated files using only a camera.

## Design Goals

- No Internet required during reception
- No Wi-Fi or Bluetooth required
- Support live and prerecorded broadcasts
- Late-join capable
- Recover from dropped frames
- Cryptographic integrity verification
- Extensible protocol family (LBOP-001 … LBOP-006)

## Architecture

```text
Application
    ↓
LBPK Package (logical)          ← LBOP-002
    ↓
Adaptive Compression Engine     ← LBOP-002 / ACE
    ↓
Optional Encryption             ← LBOP-005
    ↓
Digital Signature (manifest)    ← LBOP-005
    ↓
Forward Error Correction (LT)   ← LBOP-001 / ADR 0001
    ↓
Optical Frames (LBOP envelope)  ← LBOP-001
    ↓
QR / Video Encoder              ← LBOP-003
    ↓
Display / Broadcast
    ↓
Camera
    ↓
Decoder → Verification → Recovered File
```

Document map:

| Document | Role |
|----------|------|
| [LBOP-000](./LBOP-000.md) | Architecture (this document) |
| [LBOP-001](./LBOP-001-wire-format.md) | Binary frame envelope & fountain data payload |
| [LBOP-002](./LBOP-002-package.md) | LBPK logical package & CBOR manifest |
| [LBOP-003](./LBOP-003-optical-frames.md) | QR mapping & playout timing |
| [LBOP-004](./LBOP-004-profiles.md) | Broadcast profiles A–D |
| [LBOP-005](./LBOP-005-security.md) | Crypto suite & trust states |
| [LBOP-006](./LBOP-006-sdk.md) | SDK / implementation outline |

Phase 1 freeze pointer: [`../LBOP-1.md`](../LBOP-1.md).

## Adaptive Compression Engine (ACE)

The encoder SHALL inspect MIME type / filename extension (and MAY inspect entropy) before selecting compression.

Preferred algorithms (suite):

1. `none`
2. `zstd` (Zstandard)
3. `deflate` (zlib-wrapped Deflate)
4. `brotli` — **deferred**; not required for LBOP/1 Phase 1

Selection rules for Phase 1 MVP:

- Already-compressed formats (JPEG, PNG, MP4, WebM, ZIP, APK, MP3, AAC, …) **SHOULD** bypass compression (`none`).
- Otherwise the encoder **SHOULD** try Zstd and Deflate and choose the smallest result that is strictly smaller than the original; else `none`.
- Manifest field `compression` carries the chosen algorithm (see LBOP-002).

## LBPK Package

The protocol transports **logical packages** (LBPK), not bare unstructured blobs.

An LBPK consists of:

1. A CBOR **manifest** (metadata + signature)
2. An **encoded payload** (optionally compressed / encrypted bytes that are fountain-coded)

Phase 1 does **not** require a distinct on-disk `.lbpk` file container; the package is assembled in memory and emitted as optical frames.

Manifest fields (conceptual):

- Protocol Version
- Session ID
- Package ID
- Publisher Key ID (publisher identity)
- Filename, MIME Type
- SHA-256 of the encoded (post-compress / post-encrypt) payload
- Compression Algorithm, Encryption Algorithm
- Timestamps, block parameters, title / language / classification
- Ed25519 signature over the unsigned manifest

Normative key names: LBOP-002.

## Session Model

Every transmission has:

- 128-bit Session ID
- Package ID
- Broadcast Profile
- Publisher Key ID

Receivers **MAY** join at any point. Beacon + Manifest frames are interleaved so late joiners can lock a session without restarting the broadcast.

## Broadcast Profiles

| Letter | Name | Code id | Intent |
|--------|------|---------|--------|
| A | Ultra Fast | `lab` | High symbol rate, lab / experimental |
| B | Balanced | `studio` | Demo reliability |
| C | Satellite Safe | `satellite_safe` | Broadcast chain survival |
| D | Archive | `archive` | Conservative rate, higher redundancy |

Beacon `profile` **MAY** use either the letter (`C`) or the code id (`satellite_safe`). Receivers derive block parameters from the Manifest, not from the profile name alone.

Normative timing and sizes: LBOP-004.

## Security

### Suite (algorithms defined by the protocol family)

- Ed25519 signatures
- SHA-256 integrity
- Argon2id (password KDF when encryption is used)
- XChaCha20-Poly1305 (AEAD when encryption is used)
- AES-256-GCM is reserved for a future revision; not required for LBOP/1

### Phase 1 demo policy

| Requirement | Phase 1 demo | Production mode |
|-------------|--------------|-----------------|
| SHA-256 payload hash | Required | Required |
| Ed25519 signature present | Required on encoder | Required |
| Signature verifies against allowlist | Recommended; surface trust state | Required |
| Encryption | Optional (`none` typical) | Operator choice |

A valid signature authenticates the publisher binding and manifest integrity. It does **not** guarantee the content is safe.

Normative details: LBOP-005.

## Receiver States

Decode pipeline:

```text
Idle → Searching → Session Found → Manifest → Collecting
    → Reconstructing → Verifying → Complete
```

(Failed may be entered from Verifying or Collecting on unrecoverable error.)

Trust sub-states after hash verification (LBOP-005 / LBOP-1 §7):

- **Verified** — hash OK and Ed25519 verifies against a trusted key
- **Unknown publisher** — hash OK, key not in allowlist
- **Verification failed** — hash or signature failure
- **Encrypted** — password required after integrity OK

## Future Documents

See the document map above. LBOP-006 covers SDK surfaces (Rust core, web encoder, Android/iOS receivers).

## Notes

This document is the architectural foundation for the LBOP protocol family and will evolve into the informational overview after interoperability testing. Breaking on-wire changes require a `protocol_version` bump and a new ADR.
