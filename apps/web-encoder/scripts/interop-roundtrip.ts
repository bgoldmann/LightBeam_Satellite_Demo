/**
 * Node interop smoke test: encode → decode roundtrip with/without compression.
 * Run: npx tsx scripts/interop-roundtrip.ts
 */
import { EncodeSession } from "../src/lib/encoder";
import { BrowserDecodeSession } from "../src/lib/decoder";
import { decodeFrame, encodeFrame, FrameType, sha256Hex } from "../src/lib/protocol";
import { crc32 } from "../src/lib/crc32";
import { LtEncoder, LtDecoder } from "../src/lib/fec";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
let failed = 0;

function assert(cond: boolean, msg: string) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("OK:", msg);
  }
}

async function testCrc() {
  // CRC32("") = 0, CRC32("123456789") = 0xCBF43926
  assert(crc32(new Uint8Array()) === 0, "crc32 empty");
  const digits = new TextEncoder().encode("123456789");
  assert((crc32(digits) >>> 0) === 0xcbf43926, "crc32 123456789 golden");
}

async function testFrameRoundtrip() {
  const sid = new Uint8Array(16).fill(0xab);
  const payload = new TextEncoder().encode('{"title":"t"}');
  const encoded = encodeFrame({
    version: 1,
    frameType: FrameType.Beacon,
    flags: 0,
    sessionId: sid,
    symbolId: 42,
    payload,
  });
  const decoded = decodeFrame(encoded);
  assert(decoded.symbolId === 42, "frame symbolId");
  assert(decoded.frameType === FrameType.Beacon, "frame type");
  assert(new TextDecoder().decode(decoded.payload) === '{"title":"t"}', "frame payload");
  const corrupt = new Uint8Array(encoded);
  corrupt[40] ^= 0xff;
  let threw = false;
  try {
    decodeFrame(corrupt);
  } catch {
    threw = true;
  }
  assert(threw, "corrupt frame rejected");
}

async function testLt() {
  const data = new Uint8Array(4096);
  crypto.getRandomValues(data);
  const enc = new LtEncoder(data, 128);
  const dec = new LtDecoder(enc.k, 128, data.length);
  let id = 0;
  while (!dec.isComplete && id < 400) {
    if (id % 3 !== 0) dec.ingest(enc.symbolAt(id)); // ~33% loss
    id++;
  }
  assert(dec.isComplete, `LT completes with loss (k=${enc.k}, symbols=${id}, resolved=${dec.resolvedCount})`);
  if (!dec.isComplete) return;
  const out = dec.reconstruct();
  assert(out.length === data.length && out.every((b, i) => b === data[i]), "LT reconstruct exact");
}

async function testEncodeDecode(compress: boolean) {
  const text = "LightBeam interop " + "x".repeat(2000) + ` compress=${compress}`;
  const bytes = new TextEncoder().encode(text);
  const session = await EncodeSession.create(bytes, {
    title: "Interop",
    publisherName: "Test",
    filename: "interop.txt",
    mimeType: "text/plain",
    language: "en",
    compress,
    profile: "lab",
  });
  const dec = new BrowserDecodeSession();
  let frames = 0;
  while (!dec.isComplete && frames < 2000) {
    const frame = session.nextFrameBytes();
    dec.ingestFrame(frame);
    frames++;
  }
  assert(dec.isComplete, `session complete compress=${compress} after ${frames} frames`);
  const result = await dec.finish();
  assert(result.hashOk, `hashOk compress=${compress}`);
  assert(new TextDecoder().decode(result.bytes) === text, `bytes match compress=${compress}`);
  assert(result.filename === "interop.txt", "filename preserved");
}

async function testGoldenVector() {
  const path = resolve(__dirname, "../../../spec/test-vectors/v0.1-golden.json");
  const golden = JSON.parse(readFileSync(path, "utf8"));
  const dec = new BrowserDecodeSession();
  for (const hex of golden.frames_hex as string[]) {
    const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
    try {
      dec.ingestFrame(bytes);
    } catch {
      // skip undecodable control if any
    }
    if (dec.isComplete) break;
  }
  assert(dec.isComplete, "golden vector reconstructs");
  const result = await dec.finish();
  assert(result.hashOk, "golden hash ok");
  assert(result.bytes.length > 0, "golden bytes nonempty");
  const expected = new TextEncoder().encode(golden.payload_utf8);
  assert(
    result.bytes.length === expected.length && result.bytes.every((b, i) => b === expected[i]),
    "golden payload utf8 exact",
  );
  const h = await sha256Hex(result.bytes);
  assert(h === golden.payload_sha256, "golden payload sha256");
}

async function main() {
  await testCrc();
  await testFrameRoundtrip();
  await testLt();
  await testEncodeDecode(false);
  await testEncodeDecode(true);
  await testGoldenVector();
  if (failed) {
    console.error(`\n${failed} failure(s)`);
    process.exit(1);
  }
  console.log("\nAll interop checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
