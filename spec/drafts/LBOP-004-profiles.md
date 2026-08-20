# LBOP-004 — Broadcast Profiles

**Document:** LBOP-004  
**Status:** Working Draft  
**See also:** [LBOP-000](./LBOP-000.md), [LBOP-003](./LBOP-003-optical-frames.md)

## 1. Profile identifiers

| Letter | Display name | Code id | Aliases |
|--------|--------------|---------|---------|
| A | Ultra Fast | `lab` | `A`, `ultra_fast` |
| B | Balanced | `studio` | `B`, `balanced` |
| C | Satellite Safe | `satellite_safe` | `C` |
| D | Archive | `archive` | `D` |

Encoders **SHOULD** emit the code id in Beacon `profile`. Receivers **MUST** accept letter aliases.

## 2. Parameter table (Phase 1)

| Profile | FPS | Hold | Tiles | Block size | Redundancy | QR ECC | Max file (demo) |
|---------|-----|------|-------|------------|------------|--------|-----------------|
| A `lab` | 60 | 2 | 4 | 768 | 0.25 | L | 25 MB |
| B `studio` | 30 | 2 | 1 | 256 | 0.50 | M | 2 MB |
| C `satellite_safe` | 30 | 3 | 1 | 192 | 0.85 | M | 5 MB |
| D `archive` | 25 | 4 | 1 | 160 | 1.00 | M | 5 MB |

Block size and count in the **Manifest** are authoritative for decode.

## 3. Selection guidance

- First on-air demos: **C**
- Room / studio demos: **A** (four QRs × 30 unique display ticks/s) or **B**
- Lab speed experiments: **A**. If codes fail at distance, drop to **B** (one larger code).
- Long-lived archival loops / difficult channels: **D**
