import { EncodeSession } from "../src/lib/encoder";
import { decodeFrame, FrameType } from "../src/lib/protocol";
import { decode as cborDecode } from "cbor-x";

async function main() {
  const bytes = new TextEncoder().encode("Hello LightBeam ".repeat(100));
  const session = await EncodeSession.create(bytes, {
    title: "Diag",
    publisherName: "Test",
    filename: "diag.txt",
    mimeType: "text/plain",
    language: "en",
    compress: true,
    profile: "lab",
    allowDemoSeed: true,
  });

  const beaconRaw = session.nextFrameBytes({ forceType: "beacon" });
  const manifestRaw = session.nextFrameBytes({ forceType: "manifest" });
  const dataRaw = session.nextFrameBytes({ forceType: "data" });

  const bf = decodeFrame(beaconRaw);
  const mf = decodeFrame(manifestRaw);
  const df = decodeFrame(dataRaw);

  console.log("beacon json", JSON.parse(new TextDecoder().decode(bf.payload)));
  const mm = cborDecode(mf.payload) as Record<string, unknown>;
  console.log("manifest decoded ok", {
    block_count: mm.block_count,
    block_size: mm.block_size,
    encoded_byte_length: mm.encoded_byte_length,
    compression: mm.compression,
  });
  console.log("cbor bytes", mf.payload.length, "first16", [...mf.payload.slice(0, 16)]);
  console.log("frame sizes", {
    beacon: beaconRaw.length,
    manifest: manifestRaw.length,
    data: dataRaw.length,
  });

  // Dump CBOR major types sequentially for iOS decoder compatibility check
  let i = 0;
  const d = mf.payload;
  const majors: string[] = [];
  while (i < d.length && majors.length < 80) {
    const b = d[i];
    const major = b >> 5;
    const info = b & 0x1f;
    majors.push(`${i}:mt${major}/info${info}`);
    i++;
    // crude skip — enough to see floats/tags
    if (major === 7 && info === 26) i += 4;
    else if (major === 7 && info === 27) i += 8;
    else if (major === 7 && info === 25) i += 2;
    else if (info === 24) i += 1;
    else if (info === 25) i += 2;
    else if (info === 26) i += 4;
    else if (info === 27) i += 8;
  }
  console.log("cbor scan", majors.slice(0, 40).join(" | "));

  // Simulate Lab paint: control tick emits beacon+manifest+2 data
  const s2 = await EncodeSession.create(bytes, {
    title: "Diag",
    publisherName: "Test",
    filename: "diag.txt",
    mimeType: "text/plain",
    language: "en",
    compress: true,
    profile: "lab",
    allowDemoSeed: true,
  });
  const types: number[] = [];
  for (let t = 0; t < 20; t++) {
    const qrs = s2.prepareNextTickQrs({ looping: false });
    for (const _q of qrs) {
      // prepareNextTickQrs already advanced — re-decode via nextFrame is wrong.
      void _q;
    }
  }
  // Fresh capture via nextFrameBytes mirroring prepareNextTickQrs
  const s3 = await EncodeSession.create(bytes, {
    title: "Diag",
    publisherName: "Test",
    filename: "diag.txt",
    mimeType: "text/plain",
    language: "en",
    compress: true,
    profile: "lab",
    allowDemoSeed: true,
  });
  let displayTick = 0;
  const controlEvery = 16;
  for (let t = 0; t < 5; t++) {
    const sendControl = displayTick % controlEvery === 0;
    displayTick++;
    for (let i = 0; i < 4; i++) {
      let forceType: "beacon" | "manifest" | "data" = "data";
      if (sendControl) {
        if (i === 0) forceType = "beacon";
        else if (i === 1) forceType = "manifest";
      }
      const raw = s3.nextFrameBytes({ looping: false, forceType });
      types.push(decodeFrame(raw).frameType);
    }
  }
  console.log("first 5 ticks types", types);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
