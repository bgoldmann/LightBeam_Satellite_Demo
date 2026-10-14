/** Diagnose Lab 4-tile encode → decode transfer; verify encoded_len beacon fix. */
import { EncodeSession } from "../src/lib/encoder";
import { decodeFrame, FrameType, decodeDataPayload, sha256Hex } from "../src/lib/protocol";
import { BrowserDecodeSession } from "../src/lib/decoder";
import { LtDecoder } from "../src/lib/fec";
import { decompressPayloadAsync } from "../src/lib/ace";

async function main() {
  const bytes = new TextEncoder().encode("Hello LightBeam transfer test ".repeat(80));
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
  console.log("session", {
    k: session.info.blockCount,
    blockSize: session.info.blockSize,
    encoded: session.info.encodedLen,
    original: session.info.originalLen,
    est: session.info.estimatedSymbols,
    tiles: session.profile.tiles,
  });

  const tiles = session.profile.tiles;
  const controlEvery = 16;
  let displayTick = 0;
  const allRaw: Uint8Array[] = [];
  const decodedMeta: { tick: number; tile: number; type: number; sid: number; plen: number }[] = [];

  for (let t = 0; t < 300; t++) {
    const sendControl = displayTick % controlEvery === 0;
    displayTick++;
    for (let i = 0; i < tiles; i++) {
      let forceType: "beacon" | "manifest" | "data" = "data";
      if (sendControl && tiles >= 2) {
        if (i === 0) forceType = "beacon";
        else if (i === 1) forceType = "manifest";
      }
      const raw = session.nextFrameBytes({ looping: false, forceType });
      allRaw.push(raw);
      const f = decodeFrame(raw);
      decodedMeta.push({ tick: t, tile: i, type: f.frameType, sid: f.symbolId, plen: f.payload.length });
    }
  }

  const counts: Record<number, number> = {};
  for (const f of decodedMeta) counts[f.type] = (counts[f.type] || 0) + 1;
  console.log("type counts", {
    beacon: counts[FrameType.Beacon] || 0,
    manifest: counts[FrameType.Manifest] || 0,
    data: counts[FrameType.Data] || 0,
  });

  // Beacon must carry encoded_len for eager LT
  const firstBeacon = allRaw.map(decodeFrame).find((f) => f.frameType === FrameType.Beacon);
  if (!firstBeacon) throw new Error("no beacon");
  const beaconJson = JSON.parse(new TextDecoder().decode(firstBeacon.payload));
  console.log("beacon fields", {
    original_len: beaconJson.original_len,
    encoded_len: beaconJson.encoded_len,
    block_count: beaconJson.block_count,
    payload_hash: String(beaconJson.payload_hash).slice(0, 16) + "…",
  });
  if (!beaconJson.encoded_len || beaconJson.encoded_len !== session.info.encodedLen) {
    throw new Error(
      `beacon encoded_len mismatch: got ${beaconJson.encoded_len}, want ${session.info.encodedLen}`,
    );
  }
  if (beaconJson.original_len === beaconJson.encoded_len && session.info.originalLen !== session.info.encodedLen) {
    console.warn("unexpected: original_len == encoded_len despite compression");
  }

  // Path A: browser decode (manifest-based LT) + finish with hash/decompress
  const dec = new BrowserDecodeSession();
  for (const raw of allRaw) {
    try {
      dec.ingestFrame(raw);
    } catch {
      /* ignore corrupt */
    }
    if (dec.isComplete) break;
  }
  if (!dec.isComplete) throw new Error("browser decode did not complete");
  const finished = await dec.finish();
  console.log("browser finish", {
    hashOk: finished.hashOk,
    len: finished.bytes.length,
    expected: bytes.length,
    match: finished.bytes.length === bytes.length,
  });
  if (!finished.hashOk || finished.bytes.length !== bytes.length) {
    throw new Error("browser finish failed hash or length");
  }

  // Path B: eager LT from beacon.encoded_len (app fix path) → hash must match
  const ltGood = new LtDecoder(
    beaconJson.block_count,
    beaconJson.block_size,
    beaconJson.encoded_len,
  );
  let n = 0;
  for (const raw of allRaw) {
    const f = decodeFrame(raw);
    if (f.frameType !== FrameType.Data) continue;
    const p = decodeDataPayload(f.payload);
    ltGood.ingest({
      id: f.symbolId,
      degree: p.degree,
      neighbors: p.neighbors,
      payload: p.symbolBytes,
    });
    n++;
    if (ltGood.isComplete) break;
  }
  if (!ltGood.isComplete) throw new Error("eager-encoded_len LT did not complete");
  const outGood = ltGood.reconstruct();
  const hashGood = await sha256Hex(outGood);
  console.log("eager encoded_len LT", {
    complete: true,
    outLen: outGood.length,
    hashOk: hashGood === beaconJson.payload_hash,
    symbols: n,
  });
  if (hashGood !== beaconJson.payload_hash) {
    throw new Error("eager encoded_len path: payload hash mismatch");
  }
  const decompressed = await decompressPayloadAsync(outGood, "zstd");
  if (decompressed.length !== bytes.length) {
    throw new Error(`decompress len ${decompressed.length} vs ${bytes.length}`);
  }

  // Path C: regression — old bug using original_len must FAIL hash when compressed
  if (beaconJson.original_len !== beaconJson.encoded_len) {
    const ltBad = new LtDecoder(
      beaconJson.block_count,
      beaconJson.block_size,
      beaconJson.original_len,
    );
    for (const raw of allRaw) {
      const f = decodeFrame(raw);
      if (f.frameType !== FrameType.Data) continue;
      const p = decodeDataPayload(f.payload);
      ltBad.ingest({
        id: f.symbolId,
        degree: p.degree,
        neighbors: p.neighbors,
        payload: p.symbolBytes,
      });
      if (ltBad.isComplete) break;
    }
    if (ltBad.isComplete) {
      const outBad = ltBad.reconstruct();
      const hashBad = await sha256Hex(outBad);
      const wouldFail = hashBad !== beaconJson.payload_hash;
      console.log("regression original_len LT", {
        outLen: outBad.length,
        hashWouldFail: wouldFail,
      });
      if (!wouldFail) {
        throw new Error("expected original_len path to fail hash under compression");
      }
    }
  }

  console.log("PASS: compressed Lab transfer roundtrip OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
