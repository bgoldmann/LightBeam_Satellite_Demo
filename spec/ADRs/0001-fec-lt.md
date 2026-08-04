# ADR 0001 — FEC: Luby Transform fountain codes

**Status:** Accepted  
**Date:** 2026-08-04  
**Context:** PRD §12.6 / §28 open decision #3

## Decision

Phase 1 uses **Luby Transform (LT) codes** with a **robust-soliton** degree distribution for erasure coding over the optical channel.

## Rationale

- Midstream join and unordered delivery are mandatory for TV loops.
- Dropped camera frames are erasures, not bit errors (QR ECC handles local corruption).
- Open algorithm with no RaptorQ licensing risk.
- Proven in Decimen optical transfer and TXQR prior art.
- Peel decoder is fast enough for mobile at Phase 1 block counts.

## Consequences

- Overhead targets: lab 15–25%, demo 30–50%, satellite-safe 60–100%.
- Neighbors are carried on the wire in Phase 1 for cross-runtime PRNG independence; id-seeded neighbor regeneration remains available.
- Future phases may evaluate RaptorQ-compatible codecs if license and mobile ports allow.

## Measured (M0 lab)

- Exact byte recovery of 8–100 KB payloads in Rust unit tests with 33% simulated loss.
- Midstream join from symbol index ≥50 succeeds.
- Decoder must not reset on repeated Manifest frames (fixed in core).
