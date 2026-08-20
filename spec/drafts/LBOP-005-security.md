# LBOP-005 — Security

**Document:** LBOP-005  
**Status:** Working Draft  
**See also:** [LBOP-002](./LBOP-002-package.md), [LBOP-000](./LBOP-000.md)

## 1. Cryptographic suite

| Purpose | Algorithm |
|---------|-----------|
| Payload integrity | SHA-256 (`payload_hash` over encoded bytes) |
| Manifest authentication | Ed25519 |
| Password KDF (when encrypting) | Argon2id |
| Payload AEAD (when encrypting) | XChaCha20-Poly1305 |

AES-256-GCM is **reserved** for a future revision.

## 2. Signing

1. Build manifest with `signature` = null.
2. Encode deterministic CBOR of that map.
3. Ed25519-sign the CBOR bytes with the publisher private key.
4. Store Base64 signature in `signature`.
5. `publisher_key_id` = first 16 hex chars of SHA-256(public key bytes) (Phase 1 convention).

## 3. Trust states (receivers)

| State | Meaning |
|-------|---------|
| Verified | Hash matches and Ed25519 verifies against an embedded trusted key |
| Unknown publisher | Hash OK, key not in allowlist |
| Verification failed | Hash or signature failure |
| Encrypted | Password required after integrity OK |

## 4. Phase 1 policy

- **Demo mode:** hash required; signature present from encoder; unknown publisher **MAY** warn rather than hard-fail.
- **Production mode:** unsigned packages **MUST** be rejected; unknown publisher **MUST** fail closed unless operator pins keys.

Encryption is optional. When `encryption` is `none`, Argon2/XChaCha fields are null.
