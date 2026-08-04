/**
 * Decode LightBeam LBOP frames from a folder of JPEG/PNG video frames.
 * Usage: node --import tsx scripts/decode-video-frames.ts /tmp/lb-video-frames
 */
import { readdirSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import jsQR from "jsqr";
import { BrowserDecodeSession } from "../src/lib/decoder";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function decodeQrFromImage(path: string): Promise<string | null> {
  const img = sharp(path);
  const { data, info } = await img
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    { inversionAttempts: "attemptBoth" },
  );
  return code?.data ?? null;
}

async function main() {
  const dir = resolve(process.argv[2] || "/tmp/lb-video-frames");
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  console.log(`Scanning ${files.length} frames in ${dir}`);

  const session = new BrowserDecodeSession();
  let qrHits = 0;
  let lbopHits = 0;
  const samples: string[] = [];

  for (let i = 0; i < files.length; i++) {
    const path = join(dir, files[i]);
    let text: string | null = null;
    try {
      text = await decodeQrFromImage(path);
    } catch (e) {
      console.error("image error", files[i], e);
      continue;
    }
    if (!text) continue;
    qrHits++;
    if (samples.length < 5) samples.push(text.slice(0, 80));
    try {
      const ok = session.ingestBase64(text);
      if (ok) lbopHits++;
    } catch {
      // not LBOP base64
    }
    if (i % 25 === 0 || session.isComplete) {
      console.log(
        `[${i + 1}/${files.length}] qr=${qrHits} lbop=${lbopHits} stage=${session.stage} useful=${session.useful} complete=${session.isComplete}`,
      );
    }
    if (session.isComplete) break;
  }

  console.log("\n--- Summary ---");
  console.log("QR detections:", qrHits);
  console.log("LBOP ingest successes:", lbopHits);
  console.log("Final stage:", session.stage);
  console.log("Complete:", session.isComplete);
  if (samples.length) {
    console.log("Sample QR payloads (truncated):");
    for (const s of samples) console.log(" ", JSON.stringify(s));
  }

  if (session.isComplete) {
    const result = await session.finish();
    const outPath = resolve(__dirname, "../../../testdata/decoded-from-video.bin");
    writeFileSync(outPath, Buffer.from(result.bytes));
    console.log("Recovered file:", result.filename, "bytes:", result.bytes.length, "hashOk:", result.hashOk);
    console.log("Wrote", outPath);
    try {
      const text = new TextDecoder().decode(result.bytes.slice(0, 200));
      console.log("Preview:", JSON.stringify(text));
    } catch {
      /* binary */
    }
  } else {
    console.log("Could not reconstruct a LightBeam package from this video.");
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
