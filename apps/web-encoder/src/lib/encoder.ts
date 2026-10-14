/** Encode session: package file → LBOP frames → QR. */
import { encode as cborEncode } from "cbor-x";
import { getPublicKeyAsync, hashes, signAsync } from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { LtEncoder, DEFAULT_BLOCK_SIZE, LT_OVERHEAD_FACTOR } from "./fec";
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
import { selectCompression, type CompressionAlg } from "./ace";
import { canonicalCborEncode } from "./canonicalCbor";
import QRCode from "qrcode";

hashes.sha512 = sha512;

/** Profile code ids + letter aliases (LBOP-004). */
export type ProfileId = "studio" | "satellite_safe" | "lab" | "archive";

export interface BroadcastProfile {
  id: ProfileId;
  letter: "A" | "B" | "C" | "D";
  label: string;
  fps: number;
  holdFrames: number;
  blockSize: number;
  redundancy: number;
  qrEcc: "L" | "M" | "Q" | "H";
  maxFileMb: number;
  /** Independent QR codes per video frame (Decimen-style spatial multiplex). */
  tiles: 1 | 2 | 4;
  description: string;
}

export const PROFILES: Record<ProfileId, BroadcastProfile> = {
  lab: {
    id: "lab",
    letter: "A",
    label: "A — Ultra Fast (Lab)",
    fps: 60,
    holdFrames: 2,
    blockSize: 768,
    redundancy: 0.25,
    qrEcc: "L",
    maxFileMb: 25,
    tiles: 4,
    description: "Four binary QRs per frame × 30 unique ticks/s — Decimen-style multiplex",
  },
  studio: {
    id: "studio",
    letter: "B",
    label: "B — Balanced (Studio)",
    fps: 30,
    holdFrames: 2,
    blockSize: 256,
    redundancy: 0.5,
    qrEcc: "M",
    maxFileMb: 2,
    tiles: 1,
    description: "One large code, high margin, up to 2 MB",
  },
  satellite_safe: {
    id: "satellite_safe",
    letter: "C",
    label: "C — Satellite Safe",
    fps: 30,
    holdFrames: 3,
    blockSize: 192,
    redundancy: 0.85,
    qrEcc: "M",
    maxFileMb: 5,
    tiles: 1,
    description: "Lower density, extra redundancy for broadcast chains",
  },
  archive: {
    id: "archive",
    letter: "D",
    label: "D — Archive",
    fps: 25,
    holdFrames: 4,
    blockSize: 160,
    redundancy: 1.0,
    qrEcc: "M",
    maxFileMb: 5,
    tiles: 1,
    description: "Conservative rate and higher redundancy for difficult channels",
  },
};

const PROFILE_ALIASES: Record<string, ProfileId> = {
  A: "lab",
  a: "lab",
  ultra_fast: "lab",
  lab: "lab",
  B: "studio",
  b: "studio",
  balanced: "studio",
  studio: "studio",
  C: "satellite_safe",
  c: "satellite_safe",
  satellite_safe: "satellite_safe",
  D: "archive",
  d: "archive",
  archive: "archive",
};

export function resolveProfileId(input: string): ProfileId {
  return PROFILE_ALIASES[input.trim()] ?? "satellite_safe";
}

export interface EncodeOptions {
  title: string;
  publisherName: string;
  filename: string;
  mimeType: string;
  language: string;
  description?: string;
  compress: boolean;
  password?: string;
  profile: ProfileId | string;
  /** Explicit signing seed. Required in production; demo seed only when allowDemoSeed. */
  signingSeed?: Uint8Array;
  /** Allow hard-coded demo seed when signingSeed is omitted (dev / demos only). */
  allowDemoSeed?: boolean;
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
  /**
   * Control pair (beacon+manifest) every N *display ticks*, using the first
   * two tiles of that tick. With tiles=4 and interval=16 → 2/(16*4) ≈ 3%.
   */
  private controlEveryTicks = 16;
  private displayTick = 0;
  profile: BroadcastProfile;

  private constructor(profile: BroadcastProfile) {
    this.profile = profile;
  }

  static async create(fileBytes: Uint8Array, opts: EncodeOptions): Promise<EncodeSession> {
    const profile = PROFILES[resolveProfileId(opts.profile)];
    const session = new EncodeSession(profile);
    const mimeType = resolveMimeType(opts.filename, opts.mimeType);
    const filename = ensureFilenameExtension(sanitizeFilename(opts.filename), mimeType);

    const selected = await selectCompression(fileBytes, {
      filename,
      mimeType,
      enabled: opts.compress,
    });
    const payload = selected.bytes;
    const compression: CompressionAlg = selected.algorithm;

    const seed =
      opts.signingSeed ??
      (() => {
        if (!opts.allowDemoSeed) {
          throw new Error(
            "signingSeed is required (or set allowDemoSeed: true for local demos only)",
          );
        }
        const s = new Uint8Array(32);
        new TextEncoder().encodeInto("LightBeamDemoSeed_v1", s);
        return s;
      })();
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

    // Sign over deterministic CBOR without signature (sorted keys)
    const unsignedCbor = canonicalCborEncode(manifest);
    const signature = await signAsync(unsignedCbor, privateKey);
    manifest.signature = bytesToBase64(signature);
    const manifestCbor = cborEncode(manifest);

    const beacon = {
      title: opts.title,
      profile: profile.id,
      profile_letter: profile.letter,
      block_count: blockCount,
      block_size: blockSize,
      original_len: fileBytes.length,
      /** Fountain payload length (post-compression). Receivers must use this for LT, not original_len. */
      encoded_len: payload.length,
      payload_hash: payloadHash,
      short_code: sessionShortCode(sessionId),
    };

    // Use fixed LT overhead (~1.25×) rather than profile.redundancy which was
    // calibrated against the broken degree distribution.
    const estimatedSymbols = Math.ceil(blockCount * LT_OVERHEAD_FACTOR);
    const tiles = profile.tiles;
    const symbolsPerSec = (profile.fps / profile.holdFrames) * tiles;
    const controlShare = Math.min(0.1, 2 / (session.controlEveryTicks * tiles));
    const dataRatio = 1 - controlShare;
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
   *
   * Prefer `paintBroadcastTick` for live/export — it schedules beacon+manifest
   * as the first tiles of every Nth display tick (~3% overhead).
   * Single-stream callers (tests) still get a sparse control pair every
   * `controlEveryTicks` symbols when forceType is omitted.
   */
  nextFrameBytes(opts?: { looping?: boolean; forceType?: "beacon" | "manifest" | "data" }): Uint8Array {
    const looping = opts?.looping ?? false;
    const tick =
      looping && this.loopFrameCount > 0
        ? this.emitCount % this.loopFrameCount
        : this.emitCount;
    let force = opts?.forceType;
    if (!force) {
      // Sparse control for single-QR / test callers (~3%: 2 of every ~64).
      const period = this.controlEveryTicks * 4;
      if (tick % period === 0) force = "beacon";
      else if (tick % period === 1) force = "manifest";
      else force = "data";
    }

    if (force === "beacon") {
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
    if (force === "manifest") {
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
    if (typeof document === "undefined") {
      const bytes = this.nextFrameBytes(opts);
      return QRCode.toDataURL(lbopQrSegments(bytes), {
        errorCorrectionLevel: this.profile.qrEcc,
        margin: 2,
        width: 720,
        color: { dark: "#000000", light: "#ffffff" },
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = 1920;
    canvas.height = 1080;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d context");
    this.paintBroadcastTick(ctx, this.loopProgress(), opts);
    return canvas.toDataURL("image/png");
  }

  /**
   * Paint one video frame: `tiles` independent LBOP QRs (1 or 2×2).
   * Live path should call this directly — no PNG round-trip.
   * Every `controlEveryTicks` display ticks, tile 0=beacon and tile 1=manifest
   * (when tiles≥2); remaining tiles are fountain data.
   */
  paintBroadcastTick(
    ctx: CanvasRenderingContext2D,
    loopProgress: number,
    opts?: { looping?: boolean },
  ) {
    const qrs = this.prepareNextTickQrs(opts);
    this.paintBroadcastLayout(ctx, qrs, loopProgress);
  }

  /** Precompute next tick's QR matrices (for vsync playout without encode stalls). */
  prepareNextTickQrs(opts?: { looping?: boolean }): ReturnType<typeof QRCode.create>[] {
    const tiles = this.profile.tiles;
    const tickIndex = this.displayTick;
    const sendControl = tickIndex % this.controlEveryTicks === 0;
    this.displayTick++;
    const qrs: ReturnType<typeof QRCode.create>[] = [];
    for (let i = 0; i < tiles; i++) {
      // Always set forceType so single-stream sparse control does not fire inside a tiled tick.
      let forceType: "beacon" | "manifest" | "data" = "data";
      if (sendControl && tiles >= 2) {
        if (i === 0) forceType = "beacon";
        else if (i === 1) forceType = "manifest";
      } else if (sendControl && tiles === 1) {
        const controlOrdinal = Math.floor(tickIndex / this.controlEveryTicks);
        forceType = controlOrdinal % 2 === 0 ? "beacon" : "manifest";
      }
      const bytes = this.nextFrameBytes({ ...opts, forceType });
      qrs.push(createLbopQr(bytes, this.profile.qrEcc));
    }
    return qrs;
  }

  paintPreparedTick(
    ctx: CanvasRenderingContext2D,
    qrs: ReturnType<typeof QRCode.create>[],
    loopProgress: number,
  ) {
    this.paintBroadcastLayout(ctx, qrs, loopProgress);
  }

  private paintBroadcastLayout(
    ctx: CanvasRenderingContext2D,
    qrs: ReturnType<typeof QRCode.create>[],
    loopProgress: number,
  ) {
    const W = ctx.canvas.width || 1920;
    const H = ctx.canvas.height || 1080;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#0b1220";
    ctx.fillRect(0, 0, W, H);

    const mx = Math.floor(W * 0.025);
    const my = Math.floor(H * 0.02);

    ctx.fillStyle = "#e8eef7";
    ctx.font = "600 22px 'Segoe UI', system-ui, sans-serif";
    ctx.fillText(this.info.shortCode ? `LightBeam  ·  ${this.info.shortCode}` : "LightBeam", mx, my + 16);
    ctx.font = "16px 'Segoe UI', system-ui, sans-serif";
    ctx.fillStyle = "#a8b7cc";
    const title = JSON.parse(this.info.manifestJson).title as string;
    const tileHint = qrs.length > 1 ? `  ·  ${qrs.length} codes/frame — fill the camera with all of them` : "";
    ctx.fillText(`${title}${tileHint}`, mx, my + 40);

    const cols = qrs.length >= 4 ? 2 : qrs.length === 2 ? 2 : 1;
    const rows = Math.ceil(qrs.length / cols);
    const topBand = my + 52;
    const bottomBand = 28;
    const regionW = W - 2 * mx;
    const regionH = H - topBand - my - bottomBand;
    // Size tiles from the region, then pack them as a tight cluster (don't
    // stretch 2×2 cells across 16:9 or the codes sit far apart horizontally).
    const gap = qrs.length > 1 ? 12 : 0;
    const cellW = (regionW - gap * (cols - 1)) / cols;
    const cellH = (regionH - gap * (rows - 1)) / rows;
    const avail = Math.min(cellW, cellH);
    const quiet = Math.max(10, Math.floor(avail * 0.03));
    const qrSize = Math.max(64, Math.floor(avail - 2 * quiet));
    const tile = qrSize + 2 * quiet;
    const clusterW = cols * tile + (cols - 1) * gap;
    const clusterH = rows * tile + (rows - 1) * gap;
    const originX = mx + (regionW - clusterW) / 2;
    const originY = topBand + (regionH - clusterH) / 2;

    for (let i = 0; i < qrs.length; i++) {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const padX = originX + col * (tile + gap);
      const padY = originY + row * (tile + gap);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(padX, padY, tile, tile);
      paintQrModules(ctx, qrs[i], padX + quiet, padY + quiet, qrSize);
    }

    ctx.fillStyle = "#1e293b";
    ctx.fillRect(mx, H - my - 16, W - 2 * mx, 10);
    ctx.fillStyle = "#38bdf8";
    ctx.fillRect(mx, H - my - 16, (W - 2 * mx) * Math.min(1, loopProgress), 10);
  }
}

function paintQrModules(
  ctx: CanvasRenderingContext2D,
  qr: ReturnType<typeof QRCode.create>,
  x: number,
  y: number,
  dim: number,
) {
  const n = qr.modules.size;
  // Integer pixels per module — fractional cells blur edges and kill decode rate.
  const cell = Math.max(1, Math.floor(dim / n));
  const drawn = cell * n;
  const ox = Math.floor(x + (dim - drawn) / 2);
  const oy = Math.floor(y + (dim - drawn) / 2);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(ox, oy, drawn, drawn);
  ctx.fillStyle = "#000000";
  // qrcode BitMatrix.get(row, col) — swapping args transposes the symbol and tanks decode rate.
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (qr.modules.get(r, c)) {
        ctx.fillRect(ox + c * cell, oy + r * cell, cell, cell);
      }
    }
  }
}

/** Byte-mode QR of raw LBOP frame bytes (no Base64). Types only list string segments. */
export function lbopQrSegments(bytes: Uint8Array) {
  return [{ data: bytes, mode: "byte" as const }] as unknown as string;
}

function createLbopQr(bytes: Uint8Array, ecc: BroadcastProfile["qrEcc"]) {
  return QRCode.create(lbopQrSegments(bytes), {
    errorCorrectionLevel: ecc,
    // Fixed mask — avoids per-frame mask evaluation cost on encode path.
    maskPattern: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
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
