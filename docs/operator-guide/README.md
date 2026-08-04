# Operator Guide — Web Encoder

## Quick path

1. Open the LightBeam web encoder (local `npm run dev` or static deploy).
2. Select a file (stays on device — nothing is uploaded).
3. Enter title, publisher, optional description.
4. Choose **Satellite Safe** for on-air tests.
5. Review estimate (runtime, blocks, session short code).
6. Preview on screen; scan with a test phone in airplane mode.
7. Export video + manifest + verification report + checksum.
8. Hand off to playout per [broadcast guide](../broadcast-guide/README.md).

## Profiles

| Profile | Use |
|---------|-----|
| Studio Demo | Lab / room demos, max reliability, ≤2 MB |
| Satellite Safe | First on-air candidate, ≤5 MB |
| Lab High Speed | Experimental; not for first broadcast |

## Privacy

The encoder processes files in the browser. Phase 1 has no cloud mode.
