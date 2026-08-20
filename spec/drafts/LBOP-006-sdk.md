# LBOP-006 — SDK Outline

**Document:** LBOP-006  
**Status:** Working Outline  
**See also:** [ADR 0002 — Shared Rust core](../ADRs/0002-shared-rust-core.md)

## 1. Implementation surfaces

| Surface | Location | Role |
|---------|----------|------|
| Rust core | `crates/lightbeam-*` | Encode/decode, FEC, crypto, golden vectors |
| Web encoder | `apps/web-encoder` | Browser packaging, QR playout, video export |
| Android receiver | `apps/android` | Offline camera / video decode |
| iOS receiver | `apps/ios` | Offline camera / video decode |

## 2. Phase 1 SDK goals

- Interop via shared test vectors (`spec/test-vectors/`).
- Web TypeScript mirrors Rust wire format for demo speed.
- Mobile apps implement LBOP-001/002 decode paths natively.
- Future: UniFFI / WASM bindings from the Rust core (ADR 0002).

## 3. Minimum receiver API (conceptual)

```text
reset()
ingestQRString(base64OrText) → progress
tryFinalize() → RecoveredFile | TrustState | Error
```

Trust state reporting follows LBOP-005.
