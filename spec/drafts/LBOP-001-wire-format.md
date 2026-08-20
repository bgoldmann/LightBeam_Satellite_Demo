# LBOP-001 — Wire Format

**Document:** LBOP-001  
**Status:** Working Draft (aligned with LBOP/1 Phase 1 freeze)  
**Normative for:** Binary frame envelope, frame types, DataPayload  
**See also:** [LBOP-000](./LBOP-000.md), [LBOP-1 freeze](../LBOP-1.md)

## 1. Session identity

| Field | Size | Notes |
|-------|------|-------|
| Session ID | 16 bytes | CSPRNG |
| Short code | 8 chars | Derived from first 8 bytes, alphabet `A–Z` without `I/O` + `2–9` |
| Package ID | string | `pkg_` + first 16 hex of payload hash |
| Protocol version | 1 | `PROTOCOL_VERSION = 1` |

## 2. Frame envelope (binary, big-endian)

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
| symbol bytes | remainder (`block_size`) |

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

`profile` MAY be a code id (`satellite_safe`) or letter alias (`C`). See LBOP-004.

## 3. Fountain coding

- Block size profile-dependent (default Satellite Safe: 192).
- Degree ~ robust soliton; neighbors listed on wire.
- Receiver peels when enough unique data symbols arrive; loop boundaries irrelevant.
- Interleave: every 8 ticks emit Beacon, then Manifest, then 6 Data.

## 4. Test vectors

See [`../test-vectors/v0.1-golden.json`](../test-vectors/v0.1-golden.json).

## 5. Versioning

Breaking wire changes require `protocol_version` bump and a new ADR.
