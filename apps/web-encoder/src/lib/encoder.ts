/** Encode session: package file → LBOP frames → QR. */
import { deflate } from "pako";
import { encode as cborEncode } from "cbor-x";
import { getPublicKeyAsync, hashes, signAsync } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { LtEncoder, DEFAULT_BLOCK_SIZE } from "./fec";
import {
  encodeDataPayload,
  encodeFrame,
  FrameType,
  PROTOCOL_VERSION,
  randomSessionId,
  sanitizeFilename,
  sessionShortCode,
  sha256Hex,
  toHex,
} from "./protocol";
import { ensureFilenameExtension, resolveMimeType } from "./mediaTypes";
import QRCode from "qrcode";

hashes.sha512 = sha512;

export type ProfileId = "studio" | "satellite_safe" | "lab";

export interface BroadcastProfile {
  id: ProfileId;
  label: string;
  fps: number;
  holdFrames: number;
  blockSize: number;
  redundancy: number;
  qrEcc: "L" | "M" | "Q" | "H";
  maxFileMb: number;
  description: string;
}

export const PROFILES: Record<ProfileId, BroadcastProfile> = {
  studio: {
    id: "studio",
    label: "Studio Demo / Maximum Reliability",
    fps: 30,
    holdFrames: 2,
    blockSize: 256,
    redundancy: 0.5,
    qrEcc: "M",
    maxFileMb: 2,
    description: "One large code, high margin, up to 2 MB",
  },
  satellite_safe: {
    id: "satellite_safe",
    label: "Satellite Safe",
    fps: 30,
    holdFrames: 3,
    blockSize: 192,
    redundancy: 0.85,
    qrEcc: "M",
    maxFileMb: 5,
    description: "Lower density, extra redundancy for broadcast chains",
  },
  lab: {
    id: "lab",
    label: "Lab High Speed",
    fps: 60,
    holdFrames: 1,
    blockSize: 512,
    redundancy: 0.25,
    qrEcc: "L",
    maxFileMb: 25,
    description: "Not for first on-air demo until validated",
  },
};

export interface EncodeOptions {
  title: string;
  publisherName: string;
  filename: string;
  mimeType: string;
  language: string;
  description?: string;
  compress: boolean;
  password?: string;
  profile: ProfileId;
  signingSeed?: Uint8Array;
}

export interface SessionInfo {
  sessionId: string;
  shortCode: string;
  packageId: string;
  payloadHash: string;
  originalLen: number;
  encodedLen: number;
  blockCount: number;
  blockSize: number;
  manifestJson: string;
  publisherKeyId: string;
  publicKeyHex: string;
  estimatedRuntimeSec: number;
  estimatedSymbols: number;
  /** QR frames per continuous broadcast loop (wraps for missed-code recovery). */
  loopFrameCount: number;
}

function bytesToBase64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

export class EncodeSession {
  info!: SessionInfo;
  private sessionId!: Uint8Array;
  private encoder!: LtEncoder;
  private manifestCbor!: Uint8Array;
  private beaconJson!: Uint8Array;
  private beaconInterval = 8;
  profile: BroadcastProfile;

  private constructor(profile: BroadcastProfile) {
    this.profile = profile;
  }

  static async create(fileBytes: Uint8Array, opts: EncodeOptions): Promise<EncodeSession> {
    const profile = PROFILES[opts.profile];
    const session = new EncodeSession(profile);
    const mimeType = resolveMimeType(opts.filename, opts.mimeType);
    const filename = ensureFilenameExtension(sanitizeFilename(opts.filename), mimeType);
    let payload = fileBytes;
    let compression: "none" | "deflate" = "none";
    if (opts.compress) {
      const compressed = deflate(fileBytes);
      if (compressed.length < fileBytes.length) {
        payload = compressed;
        compression = "deflate";
      }
    }

    const seed = opts.signingSeed ?? crypto.getRandomValues(new Uint8Array(32));
    const privateKey = seed;
    const publicKey = await getPublicKeyAsync(privateKey);
    const publisherKeyId = (await sha256Hex(publicKey)).slice(0, 16);

    const payloadHash = await sha256Hex(payload);
    const sessionId = randomSessionId();
    const blockSize = profile.blockSize || DEFAULT_BLOCK_SIZE;
    const encoder = new LtEncoder(payload, blockSize);
    const blockCount = encoder.k;

    const manifest: Record<string, unknown> = {
      protocol_version: PROTOCOL_VERSION,
      session_id: toHex(sessionId),
      package_id: `pkg_${payloadHash.slice(0, 16)}`,
      filename,
      mime_type: mimeType,
      original_byte_length: fileBytes.length,
      encoded_byte_length: payload.length,
      creation_timestamp: Math.floor(Date.now() / 1000),
      expiration_timestamp: null,
      compression,
      encryption: "none",
      hash_algorithm: "sha256",
      payload_hash: payloadHash,
      publisher_key_id: publisherKeyId,
      title: opts.title,
      language: opts.language,
      content_classification: "demo",
      block_size: blockSize,
      block_count: blockCount,
      description: opts.description ?? null,
      publisher_name: opts.publisherName,
      signature: null,
      salt_hex: null,
      argon2_memory_kib: null,
      argon2_iterations: null,
      argon2_parallelism: null,
    };

    // Sign over CBOR without signature (cbor-x encode of unsigned)
    const unsignedCbor = cborEncode(manifest);
    const signature = await signAsync(unsignedCbor, privateKey);
    manifest.signature = bytesToBase64(signature);
    const manifestCbor = cborEncode(manifest);

    const beacon = {
      title: opts.title,
      profile: opts.profile,
      block_count: blockCount,
      block_size: blockSize,
      original_len: fileBytes.length,
      payload_hash: payloadHash,
      short_code: sessionShortCode(sessionId),
    };

    const estimatedSymbols = Math.ceil(blockCount * (1 + profile.redundancy));
    const symbolsPerSec = profile.fps / profile.holdFrames;
    // ~75% of frames are data
    const dataRatio = 6 / 8;
    const estimatedRuntimeSec = Math.ceil(estimatedSymbols / (symbolsPerSec * dataRatio));
    // One broadcast loop = enough fountain symbols for recovery (+10% headroom)
    const loopFrameCount = Math.max(Math.ceil(estimatedSymbols * 1.1), blockCount + 16);

    session.sessionId = sessionId;
    session.encoder = encoder;
    session.manifestCbor = manifestCbor;
    session.beaconJson = new TextEncoder().encode(JSON.stringify(beacon));
    session.loopFrameCount = loopFrameCount;
    session.info = {
      sessionId: toHex(sessionId),
      shortCode: sessionShortCode(sessionId),
      packageId: manifest.package_id as string,
      payloadHash,
      originalLen: fileBytes.length,
      encodedLen: payload.length,
      blockCount,
      blockSize,
      manifestJson: JSON.stringify(manifest, null, 2),
      publisherKeyId,
      publicKeyHex: toHex(publicKey),
      estimatedRuntimeSec,
      estimatedSymbols,
      loopFrameCount,
    };
    return session;
  }

  /** Frames in one complete broadcast cycle (beacon/manifest/data). */
  loopFrameCount = 0;
  private emitCount = 0;

  /** Progress within the current loop, 0..1 (after the last emitted frame). */
  loopProgress(): number {
    if (this.loopFrameCount <= 0) return 0;
    if (this.emitCount === 0) return 0;
    const pos = ((this.emitCount - 1) % this.loopFrameCount) + 1;
    return pos / this.loopFrameCount;
  }

  /** 0-based index of the loop that contains the last emitted frame. */
  loopIndex(): number {
    if (this.loopFrameCount <= 0 || this.emitCount === 0) return 0;
    return Math.floor((this.emitCount - 1) / this.loopFrameCount);
  }

  /**
   * Next LBOP frame.
   * `looping: true` wraps symbol IDs (finite export video that repeats).
   * Live TV playout must use `looping: false` so phones keep getting new
   * fountain IDs and cannot stall mid-decode on duplicates.
   */
  nextFrameBytes(opts?: { looping?: boolean }): Uint8Array {
    const looping = opts?.looping ?? false;
    const tick =
      looping && this.loopFrameCount > 0
        ? this.emitCount % this.loopFrameCount
        : this.emitCount;
    if (tick % this.beaconInterval === 0) {
      const frame = encodeFrame({
        version: PROTOCOL_VERSION,
        frameType: FrameType.Beacon,
        flags: 0,
        sessionId: this.sessionId,
        symbolId: tick,
        payload: this.beaconJson,
      });
      this.emitCount++;
      return frame;
    }
    if (tick % this.beaconInterval === 1) {
      const frame = encodeFrame({
        version: PROTOCOL_VERSION,
        frameType: FrameType.Manifest,
        flags: 0,
        sessionId: this.sessionId,
        symbolId: tick,
        payload: this.manifestCbor,
      });
      this.emitCount++;
      return frame;
    }
    const sym = this.encoder.symbolAt(tick);
    const payload = encodeDataPayload(sym.degree, sym.neighbors, sym.payload);
    const frame = encodeFrame({
      version: PROTOCOL_VERSION,
      frameType: FrameType.Data,
      flags: 0,
      sessionId: this.sessionId,
      symbolId: tick,
      payload,
    });
    this.emitCount++;
    return frame;
  }

  async nextQrDataUrl(opts?: { looping?: boolean }): Promise<string> {
    const bytes = this.nextFrameBytes(opts);
    // QR byte mode via binary as base64 string for scanner compatibility
    const b64 = bytesToBase64(bytes);
    return QRCode.toDataURL(b64, {
      errorCorrectionLevel: this.profile.qrEcc,
      margin: 2,
      width: 720,
      color: { dark: "#000000", light: "#ffffff" },
    });
  }

  /** Draw broadcast-safe frame onto canvas (1920x1080). */
  drawBroadcastFrame(
    ctx: CanvasRenderingContext2D,
    qrImage: HTMLImageElement | HTMLCanvasElement,
    loopProgress: number,
  ) {
    const W = 1920;
    const H = 1080;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);

    // Safe area margins ~5%
    const mx = Math.floor(W * 0.08);
    const my = Math.floor(H * 0.08);

    // Instruction band
    ctx.fillStyle = "#e8eef7";
    ctx.font = "600 36px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(this.info.shortCode ? `LightBeam  ·  ${this.info.shortCode}` : "LightBeam", mx, my + 20);
    ctx.font = "28px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#a8b7cc";
    const title = JSON.parse(this.info.manifestJson).title as string;
    const publisher = JSON.parse(this.info.manifestJson).publisher_name as string;
    ctx.fillText(title, mx, my + 70);
    ctx.font = "22px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(`Publisher: ${publisher}`, mx, my + 110);
    ctx.fillText("Open LightBeam and point your camera at this code", mx, my + 150);
    ctx.font = "20px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText("برای دریافت فایل، دوربین را روبه‌روی تصویر نگه دارید", mx, my + 190);

    // Alignment border + QR in center safe zone
    const qrSize = Math.min(W, H) * 0.55;
    const qx = (W - qrSize) / 2;
    const qy = (H - qrSize) / 2 + 40;
    ctx.strokeStyle = "#5eead4";
    ctx.lineWidth = 6;
    ctx.strokeRect(qx - 24, qy - 24, qrSize + 48, qrSize + 48);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(qx - 12, qy - 12, qrSize + 24, qrSize + 24);
    ctx.drawImage(qrImage, qx, qy, qrSize, qrSize);

    // Loop progress bar
    ctx.fillStyle = "#1e293b";
    ctx.fillRect(mx, H - my - 20, W - 2 * mx, 12);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(mx, H - my - 20, (W - 2 * mx) * Math.min(1, loopProgress), 12);

    // Reserved logo corner (top-right empty)
    ctx.strokeStyle = "#334155";
    ctx.strokeRect(W - mx - 160, my - 10, 160, 80);
    ctx.fillStyle = "#64748b";
    ctx.font = "16px sans-serif";
    ctx.fillText("LOGO SAFE", W - mx - 140, my + 35);
  }
}

export function verificationReport(info: SessionInfo): string {
  return [
    "LightBeam Transmission Verification Report",
    "==========================================",
    `Protocol: LBOP/1`,
    `Session: ${info.sessionId}`,
    `Short code: ${info.shortCode}`,
    `Package: ${info.packageId}`,
    `Payload SHA-256: ${info.payloadHash}`,
    `Original size: ${info.originalLen} bytes`,
    `Encoded size: ${info.encodedLen} bytes`,
    `Blocks: ${info.blockCount} × ${info.blockSize}`,
    `Publisher key ID: ${info.publisherKeyId}`,
    `Public key: ${info.publicKeyHex}`,
    `Estimated runtime: ~${info.estimatedRuntimeSec}s per cycle`,
    "",
    "Verify the recovered file SHA-256 matches payload_hash after decrypt/decompress,",
    "and that the Ed25519 signature verifies against the publisher public key.",
  ].join("\n");
}
