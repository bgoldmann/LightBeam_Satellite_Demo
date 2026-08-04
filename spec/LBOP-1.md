# LBOP/1 — LightBeam Optical Protocol Version 1

**Status:** Alpha freeze for Phase 1 demo  
**Date:** 2026-08-04

## 1. Package layers

```text
Original file
  → optional Deflate (Phase 1) / Zstd (Rust path)
  → optional Argon2id + XChaCha20-Poly1305
  → SHA-256 payload hash
  → canonical CBOR manifest + Ed25519 signature
  → fixed source blocks
  → LT fountain symbols
  → LBOP frame envelope
  → QR (Base64 of frame bytes)
  → broadcast video
```

## 2. Session identity

| Field | Size | Notes |
|-------|------|-------|
| Session ID | 16 bytes | CSPRNG |
| Short code | 8 chars | Derived from first 8 bytes, alphabet `A–Z` without `I/O` + `2–9` |
| Package ID | string | `pkg_` + first 16 hex of payload hash |
| Protocol version | 1 | `PROTOCOL_VERSION = 1` |

## 3. Frame envelope (binary, big-endian)

| Offset | Size | Field |
|--------|------|-------|
| 0 | 4 | Magic `LBOP` |
| 4 | 1 | Protocol version |
| 5 | 1 | Frame type |
| 6 | 2 | Flags |
| 8 | 16 | Session ID |
| 24 | 8 | Symbol / tick ID |
| 32 | 2 | Payload length |
| 34 | 4 | Header CRC-32 (IEEE) over bytes 0–33 |
| 38 | N | Payload |
| 38+N | 4 | Frame CRC-32 over bytes 0..(38+N-1) |

### Frame types

| Value | Name | Payload |
|-------|------|---------|
| 0x01 | Beacon | UTF-8 JSON (`BeaconPayload`) |
| 0x02 | Manifest | CBOR `Manifest` (includes signature field) |
| 0x03 | Data | `DataPayload` binary |
| 0x04 | EndLoop | optional marker |

### DataPayload

| Field | Size |
|-------|------|
| degree | u16 BE |
| neighbor count | u16 BE |
| neighbors | u16 BE × count |
| symbol bytes | remainder (block_size) |

### Beacon JSON

```json
{
  "title": "string",
  "profile": "satellite_safe",
  "block_count": 1,
  "block_size": 192,
  "original_len": 1,
  "payload_hash": "hex",
  "short_code": "ABCD2345"
}
```

## 4. Manifest (CBOR map)

Required keys (snake_case):

- `protocol_version`, `session_id`, `package_id`
- `filename`, `mime_type`
- `original_byte_length`, `encoded_byte_length`
- `creation_timestamp`, `expiration_timestamp` (nullable)
- `compression` (`none` | `deflate` | `zstd`)
- `encryption` (`none` | `xchacha20_poly1305`)
- `hash_algorithm` (`sha256`)
- `payload_hash`, `publisher_key_id`
- `title`, `language`, `content_classification`
- `block_size`, `block_count`
- `description`, `publisher_name`
- `signature` (Base64 Ed25519 over canonical CBOR with `signature` null)
- encryption params when used: `salt_hex` (`salt:nonce` hex), Argon2 params

**Signing:** serialize unsigned manifest (signature = null) with deterministic CBOR; Ed25519-sign those bytes; store Base64 signature in `signature`.

## 5. Fountain coding

- Block size profile-dependent (default Satellite Safe: 192).
- Degree ~ robust soliton; neighbors listed on wire.
- Receiver peels when enough unique data symbols arrive; loop boundaries irrelevant.
- Interleave: every 8 ticks emit Beacon, then Manifest, then 6 Data.

## 6. QR mapping

- Encode frame bytes as Base64 (standard alphabet).
- One QR per logical symbol; ECC Medium for satellite-safe.
- Hold duration per profile (see ADR 0003).

## 7. Trust states (receivers)

| State | Meaning |
|-------|---------|
| Verified | Hash matches and Ed25519 verifies against embedded trusted key |
| Unknown publisher | Hash OK, key not in allowlist |
| Verification failed | Hash or signature failure |
| Encrypted | Password required after integrity OK |

Unsigned packages are rejected in production mode.

## 8. Test vectors

See [`test-vectors/v0.1-golden.json`](./test-vectors/v0.1-golden.json). Regenerate:

```bash
cargo run -p test-vector-generator
```

## 9. Versioning

Breaking wire changes require `protocol_version` bump and new ADR.
