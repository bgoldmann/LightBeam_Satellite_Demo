# LBOP-002 — Package Format (LBPK)

**Document:** LBOP-002  
**Status:** Working Draft (aligned with LBOP/1 Phase 1 freeze)  
**Normative for:** Logical LBPK package, CBOR manifest, ACE compression labels  
**See also:** [LBOP-000](./LBOP-000.md), [LBOP-005](./LBOP-005-security.md)

## 1. Logical package

An LBPK is a **logical** package:

1. CBOR **manifest** (metadata + Ed25519 signature)
2. **Encoded payload** bytes that are fountain-coded into Data frames

Phase 1 does not define a separate on-disk `.lbpk` container file.

## 2. Package layers

```text
Original file
  → Adaptive Compression Engine (none | zstd | deflate)
  → optional Argon2id + XChaCha20-Poly1305
  → SHA-256 payload hash (over encoded bytes)
  → canonical CBOR manifest + Ed25519 signature
  → fixed source blocks
  → LT fountain symbols
  → LBOP frame envelope (LBOP-001)
```

## 3. Manifest (CBOR map)

Required keys (snake_case):

- `protocol_version`, `session_id`, `package_id`
- `filename`, `mime_type`
- `original_byte_length`, `encoded_byte_length`
- `creation_timestamp`, `expiration_timestamp` (nullable)
- `compression` (`none` | `deflate` | `zstd`) — `brotli` reserved
- `encryption` (`none` | `xchacha20_poly1305`)
- `hash_algorithm` (`sha256`)
- `payload_hash`, `publisher_key_id`
- `title`, `language`, `content_classification`
- `block_size`, `block_count`
- `description`, `publisher_name`
- `signature` (Base64 Ed25519 over canonical CBOR with `signature` null)
- encryption params when used: `salt_hex` (`salt:nonce` hex), Argon2 params

**Signing:** serialize unsigned manifest (`signature` = null) with deterministic CBOR; Ed25519-sign those bytes; store Base64 signature in `signature`.

## 4. ACE (normative labels)

| Label | Algorithm |
|-------|-----------|
| `none` | Identity |
| `zstd` | Zstandard frame |
| `deflate` | zlib-wrapped Deflate (e.g. pako.deflate / flate2) |

Already-compressed media **SHOULD** use `none` (LBOP-000).
