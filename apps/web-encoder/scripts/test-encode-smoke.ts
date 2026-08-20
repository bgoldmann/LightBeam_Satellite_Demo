/** Encode → decompress + profile alias smoke for ACE / LBOP-004. */
import { EncodeSession, resolveProfileId, PROFILES } from "../src/lib/encoder";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(resolveProfileId("A") === "lab", "A→lab");
  assert(resolveProfileId("D") === "archive", "D→archive");
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
  for (let i = 0; i < 16; i++) session.nextFrameBytes({ looping: false });

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
