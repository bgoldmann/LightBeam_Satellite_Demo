# ADR 0002 — Shared Rust protocol core

**Status:** Accepted  
**Date:** 2026-08-04  
**Context:** PRD §7.4 / §20 / §28 open decision #4

## Decision

Implement LBOP/1 in a **Rust workspace** (`lightbeam-protocol`, `lightbeam-fec`, `lightbeam-crypto`, `lightbeam-qr`, `lightbeam-core`) with:

- Native consumers via the core facade (UniFFI planned for Android/iOS bindings).
- WASM feature flag (`wasm-bindgen`) for browser.
- Temporary **TypeScript / Kotlin / Swift ports** of the wire format for Milestone 0–4 velocity, locked by golden test vectors.

## Rationale

- One canonical encoder/decoder reduces compatibility drift.
- Crypto (Ed25519, Argon2id, XChaCha20-Poly1305) has mature Rust crates.
- Mobile teams can ship UI while UniFFI packaging lands.

## Consequences

- Interop gate: `spec/test-vectors/v0.1-golden.json` must pass on every platform.
- Platform ports are transitional; Rust remains source of truth for frozen LBOP/1.
- Web encoder currently uses a TS implementation validated against the same frame layout; migrate to WASM core in a follow-up milestone.
