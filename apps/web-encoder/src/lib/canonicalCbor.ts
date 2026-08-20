/** Deterministic CBOR for LBOP manifest signing (sorted string keys). */
export function canonicalCborEncode(value: unknown): Uint8Array {
  const chunks: number[] = [];
  writeValue(chunks, value);
  return Uint8Array.from(chunks);
}

function writeValue(out: number[], value: unknown): void {
  if (value === null || value === undefined) {
    out.push(0xf6); // null
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? 0xf5 : 0xf4);
    return;
  }
  if (typeof value === "number") {
    writeInt(out, Math.trunc(value));
    return;
  }
  if (typeof value === "string") {
    const bytes = new TextEncoder().encode(value);
    writeTypeLen(out, 3, bytes.length);
    for (const b of bytes) out.push(b);
    return;
  }
  if (Array.isArray(value)) {
    writeTypeLen(out, 4, value.length);
    for (const item of value) writeValue(out, item);
    return;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    writeTypeLen(out, 5, keys.length);
    for (const k of keys) {
      writeValue(out, k);
      writeValue(out, obj[k]);
    }
    return;
  }
  throw new Error(`Unsupported CBOR value: ${typeof value}`);
}

function writeInt(out: number[], n: number): void {
  if (n >= 0) writeTypeLen(out, 0, n);
  else writeTypeLen(out, 1, -1 - n);
}

function writeTypeLen(out: number[], major: number, len: number): void {
  const mt = major << 5;
  if (len < 24) {
    out.push(mt | len);
  } else if (len < 0x100) {
    out.push(mt | 24, len);
  } else if (len < 0x10000) {
    out.push(mt | 25, (len >> 8) & 0xff, len & 0xff);
  } else {
    out.push(
      mt | 26,
      (len >>> 24) & 0xff,
      (len >>> 16) & 0xff,
      (len >>> 8) & 0xff,
      len & 0xff,
    );
  }
}
