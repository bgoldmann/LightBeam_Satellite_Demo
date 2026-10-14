/** Fountain recovery under random symbol loss (what a camera really sees). */
import { EncodeSession } from "../src/lib/encoder";
import { decodeFrame, FrameType, decodeDataPayload } from "../src/lib/protocol";
import { LtDecoder } from "../src/lib/fec";

async function run(sizeBytes: number, keepRate: number) {
  const bytes = new Uint8Array(sizeBytes);
  for (let i = 0; i < bytes.length; i++) bytes[i] = (Math.random() * 256) | 0;
  const session = await EncodeSession.create(bytes, {
    title: "Loss",
    publisherName: "T",
    filename: "r.bin",
    mimeType: "application/octet-stream",
    language: "en",
    compress: false,
    profile: "lab",
    allowDemoSeed: true,
  });
  const k = session.info.blockCount;
  const lt = new LtDecoder(k, session.info.blockSize, session.info.encodedLen);
  let emitted = 0;
  let received = 0;
  while (!lt.isComplete && emitted < k * 40) {
    const raw = session.nextFrameBytes({ looping: false, forceType: "data" });
    emitted++;
    if (Math.random() > keepRate) continue;
    const f = decodeFrame(raw);
    if (f.frameType !== FrameType.Data) continue;
    const p = decodeDataPayload(f.payload);
    lt.ingest({ id: f.symbolId, degree: p.degree, neighbors: p.neighbors, payload: p.symbolBytes });
    received++;
  }
  console.log(
    `${(sizeBytes / 1024).toFixed(0)}KB k=${k} keep=${keepRate}: complete=${lt.isComplete}`,
    `received=${received} (${(received / k).toFixed(2)}×k) emitted=${emitted}`,
  );
}

async function main() {
  for (const size of [20_000, 200_000, 1_000_000]) {
    for (const keep of [1, 0.3]) await run(size, keep);
  }
}

main();
