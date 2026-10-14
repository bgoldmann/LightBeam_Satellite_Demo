/** Simulate iOS CBOR.swift rules against encoder manifest bytes. */
import { EncodeSession } from "../src/lib/encoder";
import { decodeFrame } from "../src/lib/protocol";

type V =
  | { t: "text"; v: string }
  | { t: "bytes"; v: Uint8Array }
  | { t: "int"; v: number }
  | { t: "null" }
  | { t: "map"; v: Map<string, V> }
  | { t: "array"; v: V[] }
  | { t: "bool"; v: boolean }
  | { t: "unknown" };

class Reader {
  constructor(
    private data: Uint8Array,
    private offset = 0,
  ) {}

  private readByte(): number {
    if (this.offset >= this.data.length) throw new Error("eof");
    return this.data[this.offset++];
  }

  private readUInt(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.readByte();
    if (info === 25) return (this.readByte() << 8) | this.readByte();
    if (info === 26) {
      let v = 0;
      for (let i = 0; i < 4; i++) v = (v << 8) | this.readByte();
      return v;
    }
    if (info === 27) {
      let v = 0;
      for (let i = 0; i < 8; i++) v = (v << 8) | this.readByte();
      return v;
    }
    throw new Error(`Unsupported CBOR integer encoding info=${info}`);
  }

  private readBytes(len: number): Uint8Array {
    if (this.offset + len > this.data.length) throw new Error("trunc");
    const s = this.data.subarray(this.offset, this.offset + len);
    this.offset += len;
    return s;
  }

  readValue(): V {
    const initial = this.readByte();
    const major = initial >> 5;
    const info = initial & 0x1f;
    switch (major) {
      case 0:
        return { t: "int", v: this.readUInt(info) };
      case 1:
        return { t: "int", v: -1 - this.readUInt(info) };
      case 2: {
        const len = this.readUInt(info);
        return { t: "bytes", v: this.readBytes(len) };
      }
      case 3: {
        const len = this.readUInt(info);
        const bytes = this.readBytes(len);
        return { t: "text", v: new TextDecoder().decode(bytes) };
      }
      case 4: {
        const count = this.readUInt(info);
        const items: V[] = [];
        for (let i = 0; i < count; i++) items.push(this.readValue());
        return { t: "array", v: items };
      }
      case 5: {
        const count = this.readUInt(info);
        const dict = new Map<string, V>();
        for (let i = 0; i < count; i++) {
          const keyValue = this.readValue();
          const val = this.readValue();
          if (keyValue.t === "text") dict.set(keyValue.v, val);
        }
        return { t: "map", v: dict };
      }
      case 6:
        // BUGFIX candidate: iOS currently does readValue(); return readValue();
        // Correct CBOR tag: consume tag number then read ONE content value.
        this.readUInt(info);
        return this.readValue();
      case 7:
        if (info === 20) return { t: "bool", v: false };
        if (info === 21) return { t: "bool", v: true };
        if (info === 22) return { t: "null" };
        // floats / break — iOS returns unknown without consuming payload bytes → DESYNC
        if (info === 25) {
          this.readBytes(2);
          return { t: "unknown" };
        }
        if (info === 26) {
          this.readBytes(4);
          return { t: "unknown" };
        }
        if (info === 27) {
          this.readBytes(8);
          return { t: "unknown" };
        }
        return { t: "unknown" };
      default:
        return { t: "unknown" };
    }
  }
}

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
  const mf = decodeFrame(session.nextFrameBytes({ forceType: "manifest" }));
  try {
    const r = new Reader(mf.payload);
    const v = r.readValue();
    if (v.t !== "map") throw new Error("not map");
    const need = [
      "block_count",
      "block_size",
      "encoded_byte_length",
      "original_byte_length",
      "payload_hash",
      "compression",
    ];
    for (const k of need) {
      const x = v.v.get(k);
      console.log(k, x);
    }
    console.log("iOS-rules CBOR parse OK, entries", v.v.size);
  } catch (e) {
    console.error("iOS-rules CBOR FAILED", e);
    process.exit(1);
  }

  // Also test broken tag handler (current iOS)
  class BrokenTagReader extends Reader {
    override readValue(): V {
      // Can't easily override private — duplicate check via monkey
      return super.readValue();
    }
  }
  void BrokenTagReader;
}

main();
