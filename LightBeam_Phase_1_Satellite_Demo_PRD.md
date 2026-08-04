# Optical Broadcast File Transfer — Phase 1 Product Requirements Document

**Working product name:** LightBeam Optical Transfer  
**Document version:** 1.0  
**Date:** 3 August 2026  
**Owner:** Goldmann LLC  
**Phase:** Satellite TV demonstration MVP  
**Primary products:** Web Encoder, Android Receiver, iOS Receiver  
**Core constraint:** The receiving device must work with **zero Internet, zero Wi‑Fi, zero Bluetooth, zero cellular data, and no cable** during reception.

---

## 1. Executive Summary

LightBeam is an offline optical file-delivery platform that converts an arbitrary digital file into a video made of rapidly changing machine-readable visual frames. A satellite TV channel can play that video as ordinary television content. An Android or iOS device points its camera at the TV, collects enough frames, reconstructs the original file, verifies its integrity and saves or opens it locally.

Phase 1 is a controlled demonstration product, not yet a universal broadcast standard. It will prove the complete path:

1. A broadcaster opens a web application.
2. The broadcaster selects a file.
3. The web application packages, signs, encodes and exports a broadcast-safe MP4.
4. The MP4 is inserted into the TV channel’s normal playout workflow.
5. An Android or iOS receiver app scans the television.
6. The app may begin at any point in the repeating broadcast.
7. The app reconstructs the file without any network access.
8. The app verifies the file hash and publisher signature.
9. The user saves, previews, shares or opens the recovered file using permitted operating-system actions.

The initial demo should prioritize reliability over maximum speed. The first public demonstration target is a small PDF, image, configuration file or compressed package of approximately 100 KB to 5 MB.

---

## 2. Product Vision

Turn any screen into a one-way offline data transmitter and any supported phone camera into a receiver.

### Long-term vision

LightBeam can become an open optical broadcast protocol for:

- Satellite television
- Terrestrial television
- Cable television
- Projectors
- Digital signage
- Public displays
- Phone-to-phone transfer
- Emergency communications
- Offline educational delivery
- Software/configuration distribution
- Air-gapped environments

### Phase 1 vision

Deliver a credible, repeatable satellite-TV demonstration using:

- One browser-based encoder
- One Android APK
- One iOS application
- A fixed, documented optical frame format
- Broadcast-safe MP4 export
- Fully offline mobile decoding

---

## 3. Problem Statement

During Internet shutdowns, censorship events, disasters or connectivity failures, users may still receive satellite television but cannot download files from websites or app stores.

A television broadcast can carry digital data visually, but normal QR codes are unsuitable for larger files because:

- One QR code has limited capacity.
- Television compression may blur edges or combine frames.
- Viewers may start watching after the transmission begins.
- Camera frames may be dropped.
- Screens may flicker, reflect light or be viewed at an angle.
- Phones vary greatly in camera quality and processing speed.

LightBeam solves these issues through repeated, self-identifying data frames plus forward error correction. The receiver does not need every frame and does not need to start at the beginning.

---

## 4. Phase 1 Goals

### 4.1 Primary goals

- Accept any single input file through a web browser.
- Produce a downloadable broadcast-safe MP4.
- Preserve filename, MIME type, size and integrity hash.
- Allow optional compression.
- Allow optional password-based encryption.
- Digitally sign every transmission package.
- Decode live from a television using Android and iOS cameras.
- Decode with no Internet access.
- Support late joining and missed frames.
- Display trustworthy progress based on unique useful symbols collected.
- Reconstruct and verify the exact original file.
- Save or open the recovered file using platform-approved mechanisms.
- Demonstrate repeated playout on a satellite TV channel.

### 4.2 Secondary goals

- Decode from a prerecorded video selected on the phone.
- Provide multiple broadcast profiles.
- Produce an accompanying technical manifest and test report.
- Support English and Persian user interfaces.
- Preserve right-to-left layout where required.
- Record only local, privacy-preserving diagnostic information.

### 4.3 Non-goals for Phase 1

- Real-time two-way acknowledgement from receiver to broadcaster.
- Internet-based file hosting.
- User accounts.
- Cloud processing.
- Multiple files without packaging them into one archive.
- Very large files above 25 MB.
- Custom non-QR optical symbols.
- 4K/8K high-density production profiles.
- Broadcast DRM integration.
- Dynamic per-viewer encryption.
- App installation over the optical channel on iOS.
- Executing received files automatically.
- Circumventing platform security controls.
- Replacing emergency alert systems.

---

## 5. Critical Operating Assumptions

1. The Android or iOS receiver app is already installed before the user loses Internet access.
2. Android users may also receive the APK through lawful offline distribution or sideloading.
3. iOS users generally need the app installed through an Apple-approved distribution method before going offline.
4. The satellite channel can play a standard MP4 or convert it into its normal playout format.
5. The visual data area remains visible and is not covered by channel logos, tickers or captions.
6. The broadcaster may loop the same transmission multiple times.
7. The receiving phone can maintain camera access for the duration of decoding.
8. The receiver has enough free local storage for the recovered file plus temporary decoding data.
9. Phase 1 targets one-way public broadcast, so confidentiality requires payload encryption before broadcasting.
10. A publicly broadcast password is not meaningful encryption; passwords or keys must be delivered separately when confidentiality matters.

---

## 6. Target Users

### 6.1 Broadcaster operator

A TV station employee or technical producer who:

- Selects the file
- Chooses a profile
- Adds title/instructions
- Generates the MP4
- Tests the video
- Places it into playout

### 6.2 Publisher/security administrator

A trusted person who:

- Controls signing keys
- Approves files
- Reviews hashes
- Defines encryption policy
- Revokes compromised signing keys in future app releases

### 6.3 End user

A viewer who:

- Already has the receiver app
- Opens the app offline
- Points the camera at the TV
- Waits until collection reaches completion
- Verifies the publisher identity
- Saves or opens the file

### 6.4 QA/broadcast engineer

A technician who:

- Tests encoding profiles
- Measures decode success
- Evaluates satellite-chain degradation
- Confirms safe-area placement
- Produces a compatibility report

---

## 7. Phase 1 Product Components

### 7.1 Web Encoder

A browser application that:

- Runs on desktop Chrome, Edge and Safari
- Processes files locally where practical
- Requires no upload to a server
- Packages and signs the file
- Generates visual frames
- Exports an MP4
- Exports a JSON manifest
- Provides a preview and test mode

### 7.2 Android Receiver

A native Android app distributed as:

- Play Store build, when applicable
- Signed release APK for controlled demo and offline installation
- Optional Android App Bundle for store publication

The app must decode:

- Live camera input
- Imported local video
- Demo sample bundled in the app

### 7.3 iOS Receiver

A native Swift/SwiftUI application distributed for testing through an Apple-approved channel and later through the App Store where appropriate.

The app must decode:

- Live camera input
- Imported local video
- Demo sample bundled in the app

### 7.4 Shared Protocol Core

A deterministic library implementing:

- Package manifest
- Compression
- Encryption
- Hashing
- Signature verification
- Chunking
- Fountain/erasure coding
- Frame serialization
- Session identification
- Reassembly

Recommended implementation: Rust core compiled to WebAssembly for the web and exposed through native bindings for Android/iOS, or a rigorously shared protocol specification with platform-native implementations. A single shared core reduces compatibility drift.

---

## 8. End-to-End User Journeys

## 8.1 Broadcaster creates a transmission

1. Operator opens the encoder.
2. Operator selects a file.
3. Encoder displays:
   - Filename
   - File type
   - Size
   - SHA-256 hash
4. Operator enters:
   - Public title
   - Publisher name
   - Optional description
   - Optional expiration date
5. Operator chooses:
   - Broadcast profile
   - Loop duration or repeat count
   - Compression
   - Encryption
6. Encoder estimates:
   - Number of source blocks
   - Redundancy
   - Runtime
   - Expected decoding range
7. Operator generates a preview.
8. Operator scans the preview with a test phone.
9. Encoder exports:
   - MP4
   - Manifest JSON
   - Human-readable verification sheet
10. Operator places MP4 into playout.

## 8.2 Viewer receives from satellite TV

1. Viewer opens LightBeam while fully offline.
2. Viewer taps **Scan TV**.
3. App asks for camera permission if not previously granted.
4. App shows a camera guide and alignment box.
5. App detects the session automatically.
6. App displays:
   - Publisher
   - File title
   - File type
   - Approximate size
   - Signal quality
   - Useful-symbol progress
7. Viewer may start in the middle of a loop.
8. App continues collecting useful frames.
9. App reconstructs the package.
10. App verifies:
    - Manifest consistency
    - Payload authentication
    - SHA-256 hash
    - Publisher signature
11. App clearly reports one of:
    - Verified
    - Verified but encrypted; password/key required
    - Untrusted publisher
    - Damaged/incomplete
    - Expired
12. Viewer saves or previews the file.

## 8.3 Viewer decodes a recorded broadcast

1. Viewer records the TV transmission or receives a video file offline.
2. Viewer opens LightBeam.
3. Viewer taps **Decode Video**.
4. Viewer selects the local video.
5. App scans video frames faster than real time where possible.
6. App reconstructs and verifies the file.

---

## 9. Functional Requirements — Web Encoder

### 9.1 File input

**WEB-FILE-001**  
The encoder shall accept one local file using drag-and-drop or a file picker.

**WEB-FILE-002**  
The encoder shall treat the input as opaque bytes and support any extension.

**WEB-FILE-003**  
The Phase 1 default maximum shall be 25 MB, configurable for laboratory builds.

**WEB-FILE-004**  
The encoder shall warn when a file type may not be openable on the target mobile platform.

**WEB-FILE-005**  
The browser shall not upload the file unless the operator explicitly chooses an optional future cloud mode. Phase 1 has no cloud mode.

### 9.2 Metadata

Required metadata:

- Protocol version
- Session ID
- Package ID
- Filename
- MIME type
- Original byte length
- Encoded byte length
- Creation timestamp
- Optional expiration timestamp
- Compression algorithm
- Encryption algorithm
- Hash algorithm
- Publisher key ID
- Payload hash
- Manifest signature
- Human-readable title
- Language
- Content classification label

### 9.3 Compression

Phase 1 options:

- None
- Zstandard, preferred
- Deflate fallback if required by web runtime

Compression shall occur before encryption.

Already-compressed formats such as MP4, JPEG, ZIP and APK may not shrink. The UI shall show actual savings and automatically recommend **None** when compression increases size.

### 9.4 Encryption

Phase 1 modes:

- None
- Password-based authenticated encryption

Recommended construction:

- Argon2id password derivation
- XChaCha20-Poly1305 or AES-256-GCM authenticated encryption
- Random salt
- Random nonce
- Parameters embedded in the signed manifest

The system must never implement unauthenticated encryption.

### 9.5 Digital signatures

Every package shall be signed, even if not encrypted.

Recommended signature:

- Ed25519
- Publisher public keys embedded in receiver apps for the controlled demo
- Key ID stored in manifest
- Signature covers canonical manifest plus encrypted/compressed payload hash

The receiver must distinguish:

- Valid signature from trusted publisher
- Valid signature from unknown publisher
- Invalid signature
- Unsigned package, rejected in production mode

### 9.6 Frame generation

The encoder shall:

- Split the packaged payload into fixed source blocks.
- Generate repair symbols through a fountain or robust erasure-code scheme.
- Create self-identifying visual frames.
- Repeat manifest/header frames at a higher frequency than payload frames.
- Include frame-level error detection.
- Randomize or interleave symbols to survive burst loss.
- avoid dependence on frame order.

### 9.7 MP4 export

The browser shall export H.264 MP4 for maximum broadcast compatibility.

Required baseline profile:

- Resolution: 1920×1080
- Frame rate: 30 fps
- Pixel format: 4:2:0
- Progressive scan
- Square pixels
- Constant frame rate
- H.264 High or Main profile, broadcaster-compatible
- AAC audio optional
- Data region inside title/action safe area
- No transparency
- Limited flashing risk through controlled visual design

The encoder may use WebCodecs where supported and FFmpeg/WebAssembly as fallback.

### 9.8 Operator overlay

The generated broadcast video shall include:

- File title
- Publisher
- “Open LightBeam and point your camera at this code”
- Estimated remaining loop time
- Visual alignment border
- Session short code
- Optional Persian and English instructions
- Progress indicator for the current transmission cycle
- Reserved areas for channel logo and ticker

The visual data frame must remain the highest-contrast element.

### 9.9 Broadcast profiles

#### Profile A — Studio Demo / Maximum Reliability

- 1920×1080
- 30 fps
- One large code per frame
- Conservative QR density
- High visual margin
- High redundancy
- Target file size: up to 2 MB
- Target TV viewing distance: 1–3 meters

#### Profile B — Satellite Safe

- 1920×1080
- 25 or 30 fps
- Lower data density
- Longer symbol duration if field testing shows frame blending
- Extra redundancy
- Strong quiet zone
- Avoid fine modules
- Target file size: up to 5 MB

#### Profile C — Lab High Speed

- 1920×1080
- 60 fps
- Higher density
- Stationary receiver expected
- Not approved for first on-air demo until validated

### 9.10 Export artifacts

Each job shall produce:

1. `transmission.mp4`
2. `transmission-manifest.json`
3. `verification-report.txt` or PDF
4. Optional `poster-frame.png`
5. Optional `checksum.sha256`

---

## 10. Functional Requirements — Android App

### 10.1 Platform

- Kotlin
- Jetpack Compose
- CameraX Preview + ImageAnalysis
- Minimum Android version initially Android 8.0/API 26, subject to device testing
- Target current Play policy/API level at release time
- 64-bit ARM support required

### 10.2 Offline guarantee

The app shall perform all scanning, decoding, verification and saving on-device.

It shall not require:

- Account creation
- Network permission for core operation
- Remote API
- Cloud key lookup
- Online license validation
- Analytics connection

For the strict demo build, omit the Android Internet permission entirely unless a later optional feature requires it.

### 10.3 Camera scanner

The scanner shall provide:

- Rear camera default
- Continuous autofocus
- Exposure compensation
- Torch control
- Zoom control
- 30 fps analysis target
- Frame throttling under load
- Visible alignment guide
- Blur warning
- Glare warning
- Too-far/too-close warning
- Landscape and portrait support
- Screen-wake lock during reception

### 10.4 Decode engine

The app shall:

- Detect and lock onto a session.
- Reject frames from unrelated sessions while locked.
- Allow user to reset and switch session.
- De-duplicate symbols.
- Track useful versus duplicate/corrupt frames.
- Persist partial session state locally.
- Resume after accidental app closure where safe.
- Reconstruct only after sufficient symbols exist.
- Avoid keeping full uncompressed payload in memory where possible.
- Stream blocks to encrypted temporary storage.

### 10.5 Video-file decoding

The user shall be able to choose a video through the Android Storage Access Framework.

The decoder shall:

- Read frames through MediaExtractor/MediaCodec or an approved decoding layer.
- Scan at maximum safe speed.
- Fall back to real-time decoding for unsupported codecs.
- Display progress and detected sessions.
- Avoid requesting broad “all files” permission.

### 10.6 Output handling

Recovered files shall be written using:

- MediaStore for common media
- Storage Access Framework for arbitrary documents
- App-private storage before verification

The app shall never expose a partially reconstructed or unverified file as complete.

### 10.7 APK distribution

Deliverables:

- Signed release APK
- SHA-256 checksum
- Signing certificate fingerprint
- Version code/version name
- Reproducible build instructions where practical
- Offline installation guide
- QR/static short code containing checksum only, not the APK itself
- Optional F-Droid-compatible source packaging in a later phase

The app shall warn users never to install modified APKs and shall display its signing certificate fingerprint in the About screen.

---

## 11. Functional Requirements — iOS App

### 11.1 Platform

- Swift
- SwiftUI
- AVFoundation camera capture
- Core Image, Vision or a native QR decoder selected after benchmarking
- Minimum iOS version initially iOS 16 or later, subject to device testing

### 11.2 Offline guarantee

All core work shall occur on-device.

The app shall not depend on:

- User accounts
- Internet connection
- Remote API
- Cloud decoding
- Online signing-key retrieval
- Online entitlement checks beyond Apple’s normal platform behavior

### 11.3 Camera scanner

The iOS scanner shall use AVFoundation video frames with:

- Appropriate capture preset
- Fixed processing queue
- Backpressure handling
- Continuous autofocus
- Exposure controls where supported
- Torch control
- Zoom control
- Orientation correction
- Region-of-interest cropping
- Async decoding to avoid blocking capture

### 11.4 Video-file decoding

The app shall allow the user to select a local video using the system picker.

The decoder shall:

- Use AVAssetReader or an appropriate AVFoundation pipeline.
- Read frames without sending media anywhere.
- Decode faster than real time where device performance allows.
- Handle standard H.264 MP4 at minimum.
- Report unsupported codec or protected-file errors clearly.

### 11.5 Output handling

Recovered files shall remain in the app sandbox until verified.

After verification, the app may provide:

- Quick Look preview for supported documents
- Save to Files
- Share sheet
- Open in another compatible app

The application shall not automatically execute code or install received software.

### 11.6 iOS distribution limitation

The project must not promise that an iPhone can receive and install the LightBeam iOS app itself through the television signal. The receiver app must already be installed through an Apple-approved method. The optical channel can deliver documents, media, configurations and other files, but iOS controls what may be opened or installed.

---

## 12. Protocol Design — Phase 1

### 12.1 Protocol name

Working protocol name:

**LBOP/1 — LightBeam Optical Protocol Version 1**

### 12.2 Package layers

```text
Original file
    ↓
Optional compression
    ↓
Optional authenticated encryption
    ↓
Canonical manifest
    ↓
Publisher signature
    ↓
Source block segmentation
    ↓
Fountain/erasure symbols
    ↓
Frame envelope
    ↓
QR or machine-readable visual symbol
    ↓
Broadcast video
```

### 12.3 Session identifier

Each transmission shall have:

- 128-bit random session ID
- Short human-readable session code derived from the ID
- Package ID based on manifest/payload hash
- Protocol version

Session IDs must not be derived from filenames or timestamps alone.

### 12.4 Frame classes

1. **Beacon frame**
   - Protocol identification
   - Session ID
   - Short title
   - Profile
   - Manifest fragment references

2. **Manifest frame**
   - Signed metadata fragments
   - Repeated frequently

3. **Data frame**
   - Fountain symbol seed/index
   - Symbol payload
   - Frame checksum

4. **End/loop marker**
   - Indicates completion of one transmission cycle
   - Not required for decoding

### 12.5 Illustrative frame envelope

```text
Magic               4 bytes
Protocol version    1 byte
Frame type          1 byte
Flags               2 bytes
Session ID         16 bytes
Symbol ID/seed      4–8 bytes
Payload length      2 bytes
Header CRC          4 bytes
Payload             variable
Frame CRC/MAC       4–16 bytes
```

Final sizes shall be determined through benchmarking.

### 12.6 Error correction

Phase 1 shall evaluate:

- LT-style fountain coding
- RaptorQ-compatible implementation if licensing and implementation are suitable
- Reed-Solomon at package or frame grouping level
- Existing Decimen-style approach as a reference implementation

Selection criteria:

- Deterministic interoperability
- Mobile decoding speed
- Memory usage
- Overhead
- Ability to begin midstream
- Tolerance of burst frame loss
- License compatibility
- Availability in Rust/mobile ecosystems

A decision record must be completed before protocol freeze.

### 12.7 Redundancy

The encoder shall expose a simple reliability control while internally mapping it to coding overhead.

Initial targets:

- Lab: 15–25% overhead
- Direct-screen demo: 30–50%
- Satellite-safe: 60–100%, subject to measured loss

The receiver should complete once it has enough independent useful symbols, regardless of loop boundary.

### 12.8 Integrity

At minimum:

- Frame-level CRC for fast corruption rejection
- Package SHA-256
- Authenticated-encryption tag when encrypted
- Ed25519 publisher signature

A file must not be marked **Verified** unless all applicable checks pass.

### 12.9 Canonical manifest

The manifest must use deterministic canonical serialization, such as canonical CBOR, to prevent signature ambiguity.

JSON may be exported for operators, but the signed wire representation should be canonical binary data.

---

## 13. Broadcast Engineering Requirements

### 13.1 Why broadcast needs a special profile

A satellite chain may introduce:

- Scaling
- Cropping
- H.264/H.265 recompression
- Chroma subsampling
- Interlacing or deinterlacing
- Frame-rate conversion
- Logo overlays
- Tickers
- Noise reduction
- Sharpening
- Motion interpolation in consumer TVs
- Overscan
- Camera moiré
- Screen refresh/camera shutter mismatch

Therefore, a video that works phone-to-phone may fail after broadcast.

### 13.2 Safe visual layout

- Data symbol centered inside broadcast-safe margins.
- Minimum quiet zone around symbol.
- No channel graphics over data region.
- No animated background behind data.
- Neutral high-contrast background.
- Static alignment markers.
- Instructions outside the data quiet zone.
- Test both full-screen and picture-in-picture playout.

### 13.3 Motion and frame rules

- Each logical symbol may be held for one or more encoded video frames.
- Do not assume every displayed video frame creates one distinct camera frame.
- Avoid transitions, fades and motion blur between symbols.
- Use hard cuts at frame boundaries.
- Consider inserting a short neutral separator frame only if testing proves beneficial.
- Avoid excessive luminance flashing and assess applicable photosensitive-epilepsy guidance before public broadcast.

### 13.4 Audio

The visual channel carries the payload. Audio may contain:

- Spoken instructions
- A gentle synchronization cue
- Session identification

Audio must not be required for decoding in Phase 1.

### 13.5 Looping

Recommended demo structure:

```text
10 seconds — human instructions
2 seconds  — calibration target
N seconds  — data transmission cycle
3 seconds  — cycle complete message
Repeat 3–10 times
```

A viewer who joins during any cycle should still complete after collecting enough symbols across one or more cycles.

### 13.6 Playout deliverable

The first broadcast demo master shall be:

- 1920×1080 progressive
- 25 fps or 30 fps based on channel standard
- H.264 high-bitrate mezzanine MP4 for handoff
- Optional ProRes master if requested by the broadcaster
- Stereo AAC or PCM audio according to station requirements
- Color space documented
- Legal/full-range levels validated

### 13.7 Satellite test ladder

Testing must proceed in stages:

1. Browser preview to phone
2. MP4 played on laptop to phone
3. MP4 played on consumer TV through HDMI
4. MP4 imported into station playout
5. Internal studio distribution chain
6. Encoded uplink preview
7. Satellite downlink recording
8. Consumer satellite receiver and TV
9. Multiple phone models at multiple distances
10. Public controlled demonstration

No public claim of satellite reliability should be made before stages 1–8 pass.

---

## 14. User Interface Requirements

## 14.1 Web Encoder screens

### Screen A — New Transmission

- Drag-and-drop area
- Select File
- File details
- Privacy statement: “Your file stays on this device”
- Continue button

### Screen B — Package Settings

- Title
- Publisher
- Description
- Language
- Expiration
- Compression
- Encryption
- Broadcast profile

### Screen C — Estimate

- Original size
- Encoded size
- Estimated runtime
- Redundancy
- Expected loops
- Warnings

### Screen D — Preview and Test

- Live frame preview
- Pause
- Full screen
- Calibration target
- Test scan instructions
- Signal simulator options

### Screen E — Export

- Generate MP4
- Progress
- Download MP4
- Download manifest
- Download verification report
- New transmission

## 14.2 Mobile app home

Buttons:

- **Scan TV**
- **Decode Video**
- **Recovered Files**
- **How It Works**
- **Safety & Verification**
- **Settings**

The home screen must clearly show:

> No Internet connection is required.

## 14.3 Live scanner UI

- Full camera preview
- Alignment frame
- Session title
- Trusted publisher badge
- Signal status
- Useful data progress
- Estimated remaining time
- Pause/cancel
- Torch
- Zoom
- Help

Progress labels should avoid false precision. Use stages:

- Searching
- Session found
- Reading manifest
- Collecting data
- Reconstructing
- Verifying
- Complete

## 14.4 Completion screen

Display:

- File title
- Filename
- Type
- Size
- Publisher
- Signature status
- Hash status
- Expiration status
- Encryption status
- Save/Open actions

Use strong visual distinction between:

- **Verified**
- **Unknown publisher**
- **Verification failed**

---

## 15. Persian Localization

Phase 1 shall support English and Persian.

Requirements:

- Full RTL layout
- Persian instructional copy written in natural language
- Persian numerals optional in settings
- File metadata remains exact and must not be transliterated
- Security terms translated consistently
- Mixed English filenames rendered correctly
- Camera alignment UI mirrored only where appropriate
- Test on devices using Persian locale

Suggested core Persian message:

> برای دریافت فایل به اینترنت، وای‌فای یا بلوتوث نیاز ندارید. دوربین را روبه‌روی تصویر تلویزیون ثابت نگه دارید.

---

## 16. Security and Abuse Controls

### 16.1 Threat model

Threats include:

- Malicious broadcast pretending to be trusted
- Modified payload
- Corrupted frames
- Replay of old transmission
- Weak passwords
- Dangerous file types
- Fake APK distribution
- Compromised publisher signing key
- Denial of service through oversized manifests
- Parser vulnerabilities
- Decompression bombs
- Path traversal filenames
- Memory exhaustion
- Malformed QR frames
- User confusion between verified and safe

### 16.2 Required controls

- Signed packages
- Trusted-key allowlist for demo
- Strict size limits
- Strict parser bounds
- Canonical manifest
- Filename sanitization
- No arbitrary output paths
- Temporary-file isolation
- Authenticated encryption
- Hash verification
- Expiration display
- Duplicate/replay warning
- Decompression-ratio limit
- MIME/extension mismatch warning
- Never auto-open executable content
- Never auto-install APKs
- Never claim a signature proves content is harmless; it proves publisher/authenticity only

### 16.3 Key management

For Phase 1:

- Create offline root signing key.
- Create separate demo publisher signing key.
- Store root private key offline.
- Store demo key in a hardware-backed or encrypted operator environment.
- Embed trusted public keys in mobile apps.
- Document key rotation.
- Include key ID in every manifest.
- Keep an emergency revocation plan for later app updates.

---

## 17. Privacy Requirements

- No account required.
- No file upload.
- No camera recording saved by default.
- No facial recognition.
- No contact access.
- No location permission.
- No microphone permission required.
- No advertising SDKs.
- No cross-app tracking.
- Diagnostics off by default in strict offline build.
- Local logs shall exclude payload bytes and passwords.
- Users can delete partial sessions and recovered files.

---

## 18. Performance Targets

### 18.1 Demo target

- File: 500 KB PDF
- Broadcast profile: Satellite Safe
- Distance: 1.5–3 meters from a 40–65 inch TV
- Decode completion: under 90 seconds after session lock
- Success rate: at least 95% across approved test devices under controlled conditions

### 18.2 Stretch target

- File: 2 MB
- Completion: under 3 minutes
- Success after joining mid-loop
- Success through recorded satellite downlink

### 18.3 Resource limits

- Mobile app should not exceed 500 MB peak memory for Phase 1 maximum file size.
- App should remain responsive during decode.
- Thermal throttling warning after extended use.
- Battery consumption measured and documented.
- Web encoder shall show memory and compatibility warnings before large jobs.

---

## 19. Compatibility Matrix

Minimum test set should include:

### Android

- Low-cost Android device
- Mid-range Samsung
- Google Pixel
- Older device near minimum OS
- Device with 30 fps camera limitation
- Device with aggressive battery management

### iOS

- Minimum supported iPhone
- Current standard iPhone
- Current Pro model
- Device with 60/120 Hz display differences
- At least one iPad for optional testing

### Displays

- OLED TV
- LCD TV
- Projector
- Laptop display
- Satellite set-top box output
- Interlaced or converted broadcast chain where applicable

---

## 20. Technical Architecture

### 20.1 Monorepo

```text
/lightbeam
  /apps
    /web-encoder
    /android
    /ios
  /core
    /protocol
    /fec
    /crypto
    /qr
    /wasm
  /tools
    /broadcast-validator
    /test-vector-generator
    /video-analyzer
  /spec
    LBOP-1.md
    test-vectors/
  /docs
    operator-guide/
    android-guide/
    ios-guide/
    broadcast-guide/
```

### 20.2 Web stack

- Next.js or Vite/React
- TypeScript
- Tailwind CSS or equivalent
- Rust/WASM protocol core
- Web Workers
- IndexedDB for temporary jobs
- WebCodecs
- FFmpeg/WASM fallback
- No backend required for core operation
- Static deployment on Vercel is acceptable, but app must cache required assets for local operation once loaded

For broadcaster reliability, also provide a packaged offline desktop build or downloadable static bundle in a later milestone, because a web app hosted online is unavailable if the broadcaster’s workstation itself loses connectivity.

### 20.3 Android stack

- Kotlin
- Jetpack Compose
- CameraX
- Coroutines
- Room or simple local persistence for partial sessions
- Android Keystore for sensitive settings
- Native Rust core through JNI if shared core selected

### 20.4 iOS stack

- Swift
- SwiftUI
- AVFoundation
- AVAssetReader
- Quick Look
- CryptoKit where compatible with selected protocol, or audited shared core
- Local persistence using files/SQLite
- Native Rust core through UniFFI/C bindings if selected

---

## 21. Development Milestones

### Milestone 0 — Feasibility spike

Duration: 1–2 weeks

Deliverables:

- Fork or study Decimen reference
- Encode 100 KB file
- Export MP4
- Decode from laptop screen on Android
- Decode from laptop screen on iOS
- Compare QR libraries
- Compare FEC libraries
- Protocol decision record

Exit criteria:

- Exact byte recovery on both platforms
- Measured frame-loss statistics
- No Internet used during decode

### Milestone 1 — Protocol alpha

Duration: 2 weeks

Deliverables:

- LBOP/1 draft
- Canonical manifest
- Session/frame envelopes
- Hashing
- Test vectors
- Cross-platform parser

Exit criteria:

- Web, Android and iOS produce identical hashes and parse identical test vectors

### Milestone 2 — Web Encoder MVP

Duration: 3–4 weeks

Deliverables:

- File selection
- Packaging
- Compression
- Signing
- Frame generation
- Preview
- H.264 MP4 export
- Manifest/report export

Exit criteria:

- 500 KB file exported and decoded from local MP4

### Milestone 3 — Android MVP

Duration: 3–4 weeks

Deliverables:

- Live scanning
- Video import
- Reconstruction
- Verification
- Save/open
- Signed APK

Exit criteria:

- Controlled 95% success on approved Android test set

### Milestone 4 — iOS MVP

Duration: 3–4 weeks

Deliverables:

- Live scanning
- Video import
- Reconstruction
- Verification
- Save/open
- Test distribution build

Exit criteria:

- Controlled 95% success on approved iPhone test set

### Milestone 5 — Broadcast profile

Duration: 2–4 weeks

Deliverables:

- Station-safe visual template
- Satellite Safe profile
- Playout master
- Operator instructions
- Satellite chain test report

Exit criteria:

- Successful recovery from recorded downlink on Android and iOS

### Milestone 6 — Public demo release

Duration: 1–2 weeks

Deliverables:

- Final demo file
- English/Persian instructions
- APK/checksum
- iOS test/public build as approved
- Troubleshooting guide
- Video of successful end-to-end test

---

## 22. QA Plan

### 22.1 Unit tests

- Manifest canonicalization
- Hash calculation
- Signature verification
- Encryption/decryption
- Chunking
- FEC reconstruction
- Duplicate symbol handling
- Corrupt frame rejection
- Filename sanitization
- Expiration handling

### 22.2 Interoperability tests

- Web encoder → Android camera
- Web encoder → iOS camera
- Web MP4 → Android video import
- Web MP4 → iOS video import
- Same package decoded on both platforms
- Same test vectors across all implementations

### 22.3 Adverse-condition tests

- Join at 25%, 50%, 75% of loop
- Miss 10%, 30%, 50%, 70% of frames
- TV brightness low/high
- Viewing angle
- Camera movement
- Glare
- Logo/ticker near safe area
- Resolution downscale
- Bitrate reduction
- H.264 re-encode
- H.265 re-encode then display
- 25↔30 fps conversion
- Interlacing/deinterlacing
- Frame duplication
- Frame blending
- TV motion smoothing on/off
- Video recording of screen then decode

### 22.4 Security tests

- Fuzz manifest and frame parser
- Oversized fields
- Invalid Unicode filenames
- Path traversal
- Zip/decompression bomb
- Invalid signature
- Unknown key
- Wrong password
- Modified ciphertext
- Truncated video
- Mixed sessions
- Replay/expired package
- Malformed QR payload

---

## 23. Acceptance Criteria for Satellite Demo

The Phase 1 demo is accepted only when all are true:

1. Web encoder accepts a selected file without uploading it.
2. Encoder exports a standards-compatible MP4.
3. MP4 plays through the station’s test playout chain.
4. Android and iOS apps operate in airplane mode.
5. Both apps identify the same session and publisher.
6. Both apps can join after the transmission begins.
7. Both apps recover an exact byte-for-byte copy.
8. SHA-256 matches the original.
9. Publisher signature verifies.
10. A damaged or modified transmission does not produce a false “Verified” result.
11. The file can be saved/opened according to platform rules.
12. The process is repeated successfully on at least three Android and three iOS devices.
13. At least one successful test uses a recorded satellite downlink or complete broadcast-chain recording.
14. The operator guide can be followed by a station technician who did not build the system.

---

## 24. Demo Content Recommendation

Use a harmless, visually verifiable package:

- A 300–700 KB bilingual PDF
- One small image
- A text checksum
- A public-key certificate
- A readme file

Package these into one ZIP if multiple files are required.

For the first on-air test, do not transmit:

- APKs
- Executables
- Sensitive identities
- Secret keys
- Personal data
- Unreviewed political or emergency claims
- Large video files

The technical demonstration should prove transport reliability before testing higher-risk content.

---

## 25. Risks and Mitigations

### Risk: Satellite compression destroys dense codes

Mitigation:

- Conservative module size
- Extra redundancy
- Station-chain testing
- Longer frame holds
- High-bitrate playout master
- QR region protected from overlays

### Risk: Mobile camera misses changing frames

Mitigation:

- Adaptive frame duration
- Backpressure-aware processing
- Large code
- FEC
- Duplicate tolerance
- Device-specific tuning

### Risk: iOS distribution unavailable to target users

Mitigation:

- Publish early through approved channels
- Encourage installation before outages
- Maintain Android APK and desktop alternatives
- Never promise offline iOS installation

### Risk: Users trust malicious content

Mitigation:

- Publisher signatures
- Clear trust state
- No auto-open/auto-install
- Education screen
- Key fingerprint display

### Risk: Browser video export is slow or crashes

Mitigation:

- Web Workers
- Chunked encoding
- File-size limits
- WebCodecs
- Desktop encoder fallback roadmap

### Risk: Photosensitive flashing concerns

Mitigation:

- Assess frame design
- Reduce full-screen luminance changes
- Keep background stable
- Limit code region
- Obtain broadcast safety review

### Risk: Protocol forks before stability

Mitigation:

- Freeze LBOP/1 after test vectors
- Version every frame
- Publish compatibility suite
- Require decision records

---

## 26. Analytics and Diagnostics

Because the receiver may be permanently offline, analytics cannot be required.

Local diagnostic page may show:

- App version
- Protocol version
- Device model
- OS version
- Camera resolution/FPS
- Frames analyzed
- Valid frames
- Corrupt frames
- Duplicate frames
- Useful symbols
- Session changes
- Decode duration
- Verification result

Users may export a redacted diagnostic text file manually. It must exclude payload content, passwords and personal files.

---

## 27. Deployment Requirements

### Web

- Static deployment
- HTTPS for normal browser camera APIs
- Service worker caching
- Versioned assets
- Subresource integrity where practical
- Privacy page
- Terms
- Open-source notices
- Offline-capable broadcaster package in later milestone

### Android

- Signed release APK
- Protected signing key
- Reproducible version metadata
- Play Store policy review if submitted
- Privacy disclosure
- Camera permission only
- Storage through system pickers
- No Internet permission in strict demo build

### iOS

- App identifier and provisioning
- Camera usage description
- Files/document picker integration
- Privacy nutrition label based on actual data use
- TestFlight or other Apple-approved testing path
- App Review notes explaining offline optical file reception
- No claim that the app bypasses iOS installation controls

---

## 28. Open Technical Decisions

These must be resolved during Milestone 0:

1. Standard QR versus a custom symbol in later phases
2. QR library per platform
3. Exact FEC algorithm
4. Shared Rust core versus native implementations
5. Canonical CBOR library
6. XChaCha20-Poly1305 versus AES-256-GCM
7. Web MP4 encoder path
8. Default frame rate for the target satellite channel
9. One QR per frame versus tiled/stacked codes
10. Frame hold duration
11. Maximum Phase 1 file size
12. Minimum iOS/Android versions
13. Trusted-key update strategy
14. Partial-session persistence format
15. Photosensitive-content safety profile

---

## 29. Recommended First Build Order

1. Freeze a minimal package format.
2. Generate deterministic test vectors.
3. Build web frame generator without video export.
4. Build Android live decoder.
5. Build iOS live decoder.
6. Prove exact recovery from a laptop screen.
7. Add MP4 export.
8. Decode imported MP4 on both mobile apps.
9. Build conservative TV template.
10. Test through HDMI and consumer TV.
11. Test through station playout.
12. Test through satellite chain.
13. Tune redundancy and frame timing.
14. Prepare controlled public demo.

---

## 30. Definition of Phase 1 Done

Phase 1 is complete when a satellite television channel can play an MP4 generated by the LightBeam web encoder and previously installed Android and iOS applications, operating in airplane mode with no network access, can independently reconstruct and cryptographically verify the original file from the television screen.

---

## 31. Research References

Primary technical references to use during implementation:

- Decimen Optical Transfer repository:  
  https://github.com/bashalarmistalt/decimen-optical-transfer

- Apple AVFoundation capture setup:  
  https://developer.apple.com/documentation/avfoundation/capture-setup

- Apple machine-readable object types:  
  https://developer.apple.com/documentation/avfoundation/machine-readable-object-types

- Apple AVCam barcode sample:  
  https://developer.apple.com/documentation/avfoundation/avcambarcode-detecting-barcodes-and-faces

- Apple document picker:  
  https://developer.apple.com/documentation/uikit/uidocumentpickerviewcontroller

- Apple AVFoundation overview:  
  https://developer.apple.com/av-foundation/

- Android CameraX architecture:  
  https://developer.android.com/media/camera/camerax/architecture

- Android CameraX ImageAnalysis:  
  https://developer.android.com/reference/androidx/camera/core/ImageAnalysis

- Android Storage Access Framework:  
  https://developer.android.com/training/data-storage/shared/documents-files

- Android shared media storage:  
  https://developer.android.com/training/data-storage/shared/media

---

## 32. Final Product Positioning for the Demo

**LightBeam does not download files from the Internet. The television picture is the transport.**

Recommended demonstration statement:

> This phone is in airplane mode. It has no Wi‑Fi, no cellular data and no Bluetooth connection. The satellite television broadcast itself is carrying the file visually. The LightBeam app collects enough authenticated frames, reconstructs the file and verifies that it came from the trusted publisher without contacting any server.
