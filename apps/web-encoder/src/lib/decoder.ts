import { inflate } from "pako";
import { decode as cborDecode } from "cbor-x";
import { LtDecoder } from "./fec";
import {
  decodeDataPayload,
  decodeFrame,
  FrameType,
  sha256Hex,
} from "./protocol";

export type DecodeStage =
  | "Searching"
  | "SessionFound"
  | "ReadingManifest"
  | "CollectingData"
  | "Reconstructing"
  | "Verifying"
  | "Complete";

export class BrowserDecodeSession {
  stage: DecodeStage = "Searching";
  lockedSession: string | null = null;
  title: string | null = null;
  shortCode: string | null = null;
  decoder: LtDecoder | null = null;
  manifest: Record<string, unknown> | null = null;
  useful = 0;

  ingestBase64(b64: string): boolean {
    const bin = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
    return this.ingestFrame(bin);
  }

  ingestFrame(data: Uint8Array): boolean {
    const frame = decodeFrame(data);
    const sid = [...frame.sessionId].map((b) => b.toString(16).padStart(2, "0")).join("");
    if (this.lockedSession && this.lockedSession !== sid) return false;

    if (frame.frameType === FrameType.Beacon) {
      const beacon = JSON.parse(new TextDecoder().decode(frame.payload));
      this.lockedSession = sid;
      this.title = beacon.title;
      this.shortCode = beacon.short_code;
      if (this.stage === "Searching") this.stage = "SessionFound";
      return true;
    }
    if (frame.frameType === FrameType.Manifest) {
      const manifest = cborDecode(frame.payload) as Record<string, unknown>;
      this.lockedSession = sid;
      this.manifest = manifest;
      if (!this.decoder) {
        this.decoder = new LtDecoder(
          Number(manifest.block_count),
          Number(manifest.block_size),
          Number(manifest.encoded_byte_length),
        );
        this.stage = "ReadingManifest";
      }
      return true;
    }
    if (frame.frameType === FrameType.Data) {
      if (!this.decoder) return false;
      this.stage = "CollectingData";
      const dp = decodeDataPayload(frame.payload);
      const useful = this.decoder.ingest({
        id: frame.symbolId,
        degree: dp.degree,
        neighbors: dp.neighbors,
        payload: dp.symbolBytes,
      });
      if (useful) this.useful++;
      if (this.decoder.isComplete) this.stage = "Reconstructing";
      return useful;
    }
    return false;
  }

  get isComplete() {
    return this.decoder?.isComplete ?? false;
  }

  async finish(): Promise<{ bytes: Uint8Array; filename: string; hashOk: boolean }> {
    if (!this.decoder?.isComplete || !this.manifest) throw new Error("not ready");
    this.stage = "Verifying";
    let payload = this.decoder.reconstruct();
    // payload_hash covers the encoded (possibly compressed) fountain payload
    const hash = await sha256Hex(payload);
    const hashOk = hash === this.manifest.payload_hash;
    if (!hashOk) {
      throw new Error(`payload hash mismatch: got ${hash}, expected ${this.manifest.payload_hash}`);
    }
    if (this.manifest.compression === "deflate") {
      // zlib-wrapped — matches encoder pako.deflate() and Rust flate2
      payload = inflate(payload);
    }
    const expectedLen = Number(this.manifest.original_byte_length);
    if (Number.isFinite(expectedLen) && payload.length !== expectedLen) {
      throw new Error(`length mismatch after decode: ${payload.length} vs ${expectedLen}`);
    }
    this.stage = "Complete";
    return {
      bytes: payload,
      filename: String(this.manifest.filename || "file.bin"),
      hashOk,
    };
  }
}
