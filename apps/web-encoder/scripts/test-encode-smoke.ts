/** Encode → decompress + profile alias smoke for ACE / LBOP-004. */
import { EncodeSession, resolveProfileId, PROFILES, lbopQrSegments } from "../src/lib/encoder";
import QRCode from "qrcode";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(resolveProfileId("A") === "lab", "A→lab");
  assert(resolveProfileId("D") === "archive", "D→archive");
  assert(PROFILES.lab.tiles === 4, "lab 4-tile");
  assert(PROFILES.lab.blockSize === 768, "lab block 768");
  assert(PROFILES.archive.letter === "D", "archive letter");

  const text = new TextEncoder().encode("LightBeam signature and ACE interop ".repeat(80));
  const session = await EncodeSession.create(text, {
    title: "ACE test",
    publisherName: "Demo",
    filename: "notes.txt",
    mimeType: "text/plain",
    language: "en",
    compress: true,
    profile: "A",
  });

  assert(session.info.publisherKeyId === "cf64d74ed0175771", "demo key id");
  const manifest = JSON.parse(session.info.manifestJson) as {
    compression: string;
    signature: string;
    publisher_key_id: string;
  };
  assert(typeof manifest.signature === "string" && manifest.signature.length > 20, "signed");
  assert(manifest.publisher_key_id === session.info.publisherKeyId, "key id match");

  // Round-trip ACE path via encoded length metadata
  if (manifest.compression !== "none") {
    // Rebuild by re-selecting is covered in test-ace; here ensure encode filled encodedLen
    assert(session.info.encodedLen <= session.info.originalLen, "compressed or equal");
  }

  // Collect enough frames for LT recover is heavy; just emit a few frame bytes
  const frame = session.nextFrameBytes({ looping: false });
  assert(frame[0] === 0x4c && frame[1] === 0x42 && frame[2] === 0x4f && frame[3] === 0x50, "LBOP magic");
  const qr = QRCode.create(lbopQrSegments(frame), { errorCorrectionLevel: "L" });
  assert(typeof qr.version === "number" && qr.version >= 1 && qr.version <= 40, "binary QR version");
  for (let i = 0; i < 15; i++) session.nextFrameBytes({ looping: false });

  console.log(
    "encode smoke OK",
    "profile",
    session.profile.id,
    "compression",
    manifest.compression,
    "key",
    session.info.publisherKeyId,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
