/** Adaptive Compression Engine (ACE) — LBOP-000 / LBOP-002. */
import { deflate, inflate } from "pako";
import { ZstdInit } from "@oneidentity/zstd-js";
import { decompress as fzstdDecompress } from "fzstd";

export type CompressionAlg = "none" | "deflate" | "zstd";

type ZstdSimpleApi = {
  compress: (payload: Uint8Array, level?: number) => Uint8Array;
  decompress: (payload: Uint8Array) => Uint8Array;
};

let zstdSimple: ZstdSimpleApi | null = null;
let zstdInitPromise: Promise<void> | null = null;

export async function ensureZstd(): Promise<void> {
  if (zstdSimple) return;
  if (!zstdInitPromise) {
    zstdInitPromise = ZstdInit().then((api) => {
      zstdSimple = api.ZstdSimple as ZstdSimpleApi;
    });
  }
  await zstdInitPromise;
}

/** MIME / extensions that SHOULD skip compression (already compressed). */
const SKIP_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heic",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  "video/x-m4v",
  "audio/mpeg",
  "audio/mp4",
  "audio/aac",
  "audio/wav",
  "application/zip",
  "application/x-zip-compressed",
  "application/vnd.android.package-archive",
  "application/gzip",
  "application/x-gzip",
  "application/x-7z-compressed",
  "application/x-rar-compressed",
]);

const SKIP_EXT = new Set([
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "heic",
  "mp4",
  "m4v",
  "mov",
  "webm",
  "mkv",
  "mp3",
  "m4a",
  "aac",
  "wav",
  "zip",
  "apk",
  "gz",
  "7z",
  "rar",
  "br",
  "zst",
]);

function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

export function shouldSkipCompression(filename: string, mimeType: string): boolean {
  const mime = mimeType.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (mime && SKIP_MIME.has(mime)) return true;
  const ext = extensionOf(filename);
  return Boolean(ext && SKIP_EXT.has(ext));
}

/**
 * Select compression for a payload.
 * When `enabled` is false → always none.
 * Already-compressed media → none.
 * Else pick smallest among none / zstd / deflate (must be strictly smaller).
 */
export async function selectCompression(
  input: Uint8Array,
  opts: { filename: string; mimeType: string; enabled: boolean },
): Promise<{ algorithm: CompressionAlg; bytes: Uint8Array }> {
  if (!opts.enabled || shouldSkipCompression(opts.filename, opts.mimeType)) {
    return { algorithm: "none", bytes: input };
  }

  let bestAlg: CompressionAlg = "none";
  let best = input;

  try {
    await ensureZstd();
    if (zstdSimple) {
      const z = zstdSimple.compress(input, 3);
      if (z.length < best.length) {
        best = z;
        bestAlg = "zstd";
      }
    }
  } catch {
    /* zstd optional at runtime */
  }

  try {
    const d = deflate(input);
    if (d.length < best.length) {
      best = d;
      bestAlg = "deflate";
    }
  } catch {
    /* ignore */
  }

  return { algorithm: bestAlg, bytes: best };
}

export function decompressPayload(data: Uint8Array, algorithm: string): Uint8Array {
  switch (algorithm) {
    case "none":
    case "":
      return data;
    case "deflate":
      return inflate(data);
    case "zstd": {
      try {
        if (zstdSimple) return zstdSimple.decompress(data);
      } catch {
        /* fall through */
      }
      return fzstdDecompress(data);
    }
    default:
      throw new Error(`Unsupported compression: ${algorithm}`);
  }
}

export async function decompressPayloadAsync(
  data: Uint8Array,
  algorithm: string,
): Promise<Uint8Array> {
  if (algorithm === "zstd") await ensureZstd();
  return decompressPayload(data, algorithm);
}
