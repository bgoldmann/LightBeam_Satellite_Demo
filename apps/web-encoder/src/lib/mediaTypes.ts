/** Filename / MIME helpers for optical transfer packaging. */

const EXT_TO_MIME: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  mov: "video/quicktime",
  webm: "video/webm",
  mkv: "video/x-matroska",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  wav: "audio/wav",
  aac: "audio/aac",
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  txt: "text/plain",
  json: "application/json",
  zip: "application/zip",
  bin: "application/octet-stream",
};

const MIME_TO_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/x-m4v": "m4v",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/aac": "aac",
  "application/pdf": "pdf",
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/heic": "heic",
  "text/plain": "txt",
  "application/json": "json",
  "application/zip": "zip",
};

export function extensionOf(filename: string): string {
  const base = filename.split(/[/\\]/).pop() ?? filename;
  const i = base.lastIndexOf(".");
  if (i <= 0 || i === base.length - 1) return "";
  return base.slice(i + 1).toLowerCase();
}

export function mimeFromFilename(filename: string): string | null {
  const ext = extensionOf(filename);
  return ext ? EXT_TO_MIME[ext] ?? null : null;
}

export function extensionFromMime(mime: string): string | null {
  const key = mime.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (!key || key === "application/octet-stream") return null;
  return MIME_TO_EXT[key] ?? null;
}

/** Prefer browser MIME; fall back to extension; never leave empty. */
export function resolveMimeType(filename: string, mimeHint?: string | null): string {
  const hint = (mimeHint ?? "").trim().toLowerCase();
  if (hint && hint !== "application/octet-stream") return hint.split(";")[0]!.trim();
  return mimeFromFilename(filename) ?? "application/octet-stream";
}

/** Ensure the filename carries an extension matching the MIME when missing. */
export function ensureFilenameExtension(filename: string, mime: string): string {
  const base = filename.split(/[/\\]/).pop()?.trim() || "file";
  if (extensionOf(base)) return base;
  const ext = extensionFromMime(mime);
  return ext ? `${base}.${ext}` : base;
}
