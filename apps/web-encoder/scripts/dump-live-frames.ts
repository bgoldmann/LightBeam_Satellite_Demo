/**
 * Dump LBOP frames in live-playout order (prepareNextTickQrs tile layout) so
 * native receivers can be fed the exact byte stream a camera would read.
 *
 * Usage: tsx scripts/dump-live-frames.ts <out.bin> [sizeBytes] [ticks] [keepRate]
 * Format: repeated [u32be length][frame bytes].
 */
import { writeFileSync } from "node:fs";
import { EncodeSession } from "../src/lib/encoder";

async function main() {
  const out = process.argv[2] ?? "/tmp/lbop-frames.bin";
  const size = Number(process.argv[3] ?? 200_000);
  const ticks = Number(process.argv[4] ?? 400);
  const keep = Number(process.argv[5] ?? 1);

  const bytes = new Uint8Array(size);
  for (let i = 0; i < size; i++) bytes[i] = (Math.random() * 256) | 0;
  const session = await EncodeSession.create(bytes, {
    title: "Dump",
    publisherName: "Test",
    filename: "dump.bin",
    mimeType: "application/octet-stream",
    language: "en",
    compress: false,
    profile: "lab",
    allowDemoSeed: true,
  });

  // Mirror prepareNextTickQrs exactly, but keep the raw bytes.
  const tiles = session.profile.tiles;
  const controlEvery = (session as unknown as { controlEveryTicks: number }).controlEveryTicks;
  const chunks: Buffer[] = [];
  let kept = 0;
  for (let t = 0; t < ticks; t++) {
    const sendControl = t % controlEvery === 0;
    for (let i = 0; i < tiles; i++) {
      let forceType: "beacon" | "manifest" | "data" = "data";
      if (sendControl && tiles >= 2) {
        if (i === 0) forceType = "beacon";
        else if (i === 1) forceType = "manifest";
      }
      const raw = session.nextFrameBytes({ looping: false, forceType });
      if (Math.random() > keep) continue;
      // Camera sees each held tick 1–3 times.
      const repeats = 1 + ((Math.random() * 3) | 0);
      for (let r = 0; r < repeats; r++) {
        const len = Buffer.alloc(4);
        len.writeUInt32BE(raw.length);
        chunks.push(len, Buffer.from(raw));
        kept++;
      }
    }
  }
  writeFileSync(out, Buffer.concat(chunks));
  console.log(
    JSON.stringify({
      out,
      k: session.info.blockCount,
      blockSize: session.info.blockSize,
      controlEvery,
      ticks,
      qrReads: kept,
    }),
  );
}

main();
