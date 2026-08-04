# Test media

## `videoplayback.mp4` / `videoplayback.webm` (repo root)

User-supplied clips for pipeline testing. These are **normal news/interview videos**, not LightBeam optical transmissions. Scanning finds **0 QR codes** — expected.

## `testdata/lightbeam-test-video.mp4` / `.webm`

Generated LightBeam QR streams for real decode tests:

```bash
cd apps/web-encoder
npm run generate:test-video
# optional WebM:
ffmpeg -y -i ../../testdata/lightbeam-test-video.mp4 -c:v libvpx-vp9 -b:v 2M -an ../../testdata/lightbeam-test-video.webm

# decode any container (ffmpeg)
npm run test:video -- ../../videoplayback.webm          # → no_optical_signal (exit 2)
npm run test:video -- ../../testdata/lightbeam-test-video.mp4   # → verified (exit 0)
npm run test:video -- ../../testdata/lightbeam-test-video.webm  # → verified (exit 0)
```

On phone apps: **Decode Video** → prefer `testdata/lightbeam-test-video.mp4` (H.264 phone-safe). WebM is best-effort on Android; iOS typically reports unsupported for WebM.
