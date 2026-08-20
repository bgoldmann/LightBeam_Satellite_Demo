/** ACE unit checks for LBOP-000. */
import {
  selectCompression,
  shouldSkipCompression,
  decompressPayloadAsync,
  ensureZstd,
} from "../src/lib/ace";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function main() {
  assert(shouldSkipCompression("clip.mp4", "video/mp4"), "mp4 should skip");
  assert(shouldSkipCompression("photo.jpg", ""), "jpg should skip");
  assert(!shouldSkipCompression("notes.txt", "text/plain"), "txt should not skip");

  const text = new TextEncoder().encode("LightBeam ACE test ".repeat(200));
  const picked = await selectCompression(text, {
    filename: "notes.txt",
    mimeType: "text/plain",
    enabled: true,
  });
  assert(picked.algorithm !== "none", `expected compression, got ${picked.algorithm}`);
  assert(picked.bytes.length < text.length, "compressed should be smaller");

  const round = await decompressPayloadAsync(picked.bytes, picked.algorithm);
  assert(round.length === text.length, "roundtrip length");
  assert([...round].every((b, i) => b === text[i]), "roundtrip bytes");

  const skipped = await selectCompression(text, {
    filename: "x.mp4",
    mimeType: "video/mp4",
    enabled: true,
  });
  assert(skipped.algorithm === "none", "mp4 bypass");

  await ensureZstd();
  console.log("ACE tests OK", picked.algorithm, text.length, "->", picked.bytes.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
