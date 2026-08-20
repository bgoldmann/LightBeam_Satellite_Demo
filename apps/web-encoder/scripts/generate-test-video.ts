/**
 * Generate a LightBeam QR test video (JPEG frames + H.264 MP4).
 * Usage: node --import tsx scripts/generate-test-video.ts
 */
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";
import sharp from "sharp";
import QRCode from "qrcode";
import { EncodeSession, lbopQrSegments } from "../src/lib/encoder";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../../..");
const outDir = resolve(root, "testdata/lightbeam-test-video");
const framesDir = resolve(outDir, "frames");

async function main() {
  rmSync(framesDir, { recursive: true, force: true });
  mkdirSync(framesDir, { recursive: true });

  const payload = new TextEncoder().encode(
    [
      "LightBeam video decode test",
      "If you can read this, offline optical reconstruction worked.",
      "زمان: " + new Date().toISOString(),
      "pad:" + "A".repeat(12_000),
    ].join("\n"),
  );
  writeFileSync(resolve(outDir, "original.txt"), payload);

  const session = await EncodeSession.create(payload, {
    title: "Video Decode Test",
    publisherName: "Goldmann LLC Demo",
    filename: "original.txt",
    mimeType: "text/plain",
    language: "en",
    compress: false,
    profile: "satellite_safe",
  });

  writeFileSync(resolve(outDir, "manifest.json"), session.info.manifestJson);
  console.log(
    "session",
    session.info.shortCode,
    "blocks",
    session.info.blockCount,
    "estSymbols",
    session.info.estimatedSymbols,
  );

  const need = Math.max(Math.ceil(session.info.estimatedSymbols * 1.6), 40);
  const hold = Math.max(session.profile.holdFrames, 2);
  let frameIdx = 0;

  for (let tick = 0; tick < need; tick++) {
    const frameBytes = session.nextFrameBytes();
    const png = await QRCode.toBuffer(lbopQrSegments(frameBytes), {
      errorCorrectionLevel: session.profile.qrEcc,
      type: "png",
      margin: 2,
      width: 720,
      color: { dark: "#000000", light: "#ffffff" },
    });

    for (let h = 0; h < hold; h++) {
      frameIdx++;
      const composed = await sharp({
        create: {
          width: 1080,
          height: 1080,
          channels: 3,
          background: { r: 11, g: 18, b: 32 },
        },
      })
        .composite([{ input: png, gravity: "centre" }])
        .jpeg({ quality: 92 })
        .toBuffer();
      writeFileSync(resolve(framesDir, `f${String(frameIdx).padStart(5, "0")}.jpg`), composed);
    }
    if (tick % 20 === 0) console.log(`encoded tick ${tick}/${need}`);
  }

  console.log(`Wrote ${frameIdx} frames to ${framesDir}`);

  const mp4 = resolve(root, "testdata/lightbeam-test-video.mp4");
  execSync(
    `ffmpeg -y -framerate 30 -i "${framesDir}/f%05d.jpg" -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart "${mp4}"`,
    { stdio: "inherit" },
  );
  console.log("Wrote", mp4);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
