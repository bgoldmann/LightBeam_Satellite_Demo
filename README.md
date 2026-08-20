# LightBeam Optical Transfer — Phase 1

Offline optical file delivery for satellite television. The television picture is the transport.

See [LightBeam_Phase_1_Satellite_Demo_PRD.md](./LightBeam_Phase_1_Satellite_Demo_PRD.md), [spec/LBOP-1.md](./spec/LBOP-1.md) (Phase 1 freeze), and architecture draft [spec/drafts/LBOP-000.md](./spec/drafts/LBOP-000.md).

## Workspace

```text
apps/web-encoder   Vite + React encoder (local-only processing)
apps/android       Kotlin + Compose receiver (no INTERNET permission)
apps/ios           Swift + SwiftUI receiver
crates/            Shared Rust LBOP/1 core + FEC + crypto
spec/              Protocol freeze, drafts (LBOP-000…006), ADRs, golden vectors
tools/             Test vector generator, broadcast validator
docs/              Operator, broadcast, Android, iOS guides
```

## Quick start

### Rust core

```bash
cargo test --workspace
cargo run -p test-vector-generator
```

### Web encoder

```bash
cd apps/web-encoder
npm install
cp .env.example .env.local   # optional Supabase catalog
npm run dev      # http://localhost:5173
npm run build    # static dist/
```

**Live:** https://lightbeam-web-encoder.vercel.app  
**Supabase:** project `lightbeam-satellite-demo` (metadata catalog only; receivers stay offline).

### Android

```bash
cd apps/android
echo "sdk.dir=$HOME/Library/Android/sdk" > local.properties
./gradlew :app:assembleDebug
```

### iOS

```bash
cd apps/ios
./generate.sh
open LightBeam.xcodeproj
```

## Protocol decisions (frozen)

| Topic | Choice |
|-------|--------|
| FEC | Luby Transform (robust soliton) — [ADR 0001](spec/ADRs/0001-fec-lt.md) |
| Core | Rust source of truth + platform ports — [ADR 0002](spec/ADRs/0002-shared-rust-core.md) |
| Optical | Standard QR, multi-frame hold — [ADR 0003](spec/ADRs/0003-qr-and-frame-timing.md) |
| Crypto | Ed25519, Argon2id, XChaCha20-Poly1305, SHA-256 |
| Profiles | Studio / Satellite Safe / Lab |

## Offline guarantee

Receivers decode with zero network. Strict Android demo builds omit `INTERNET`. iOS apps must be preinstalled through Apple-approved channels before outages.

## Milestone map

| M | Status in repo |
|---|----------------|
| M0 Feasibility | Rust LT + frames + golden vectors + mobile shells |
| M1 Protocol alpha | `spec/LBOP-1.md` + test vectors |
| M2 Web encoder MVP | Full UI A–E, profiles, preview, video export |
| M3 Android MVP | CameraX + ML Kit + LT receive + SAF |
| M4 iOS MVP | AVFoundation + Vision + LT + Share |
| M5 Broadcast | Satellite Safe template + playout ladder docs |
| M6 Demo | EN/FA UI, demo package, acceptance checklist |

## Acceptance

Follow [docs/acceptance-checklist.md](docs/acceptance-checklist.md) before public satellite claims. No reliability claims until broadcast ladder stages 1–8 pass.
