/**
 * Universal LightBeam video decode — any ffmpeg-readable container/codec.
 *
 * Usage:
 *   node --import tsx scripts/decode-video.ts <video|frames-dir>
 *
 * Exit codes:
 *   0 verified
 *   2 no_optical_signal
 *   3 unsupported_format / ffmpeg fail
 *   4 incomplete / hash_failed
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, resolve, dirname, extname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import sharp from "sharp";
import jsQR from "jsqr";
import { BrowserDecodeSession } from "../src/lib/decoder";

const __dirname = dirname(fileURLToPath(import.meta.url));

export type DecodeOutcome =
  | "verified"
  | "no_optical_signal"
  | "unsupported_format"
  | "incomplete"
  | "hash_failed";

export interface DecodeReport {
  input: string;
  container?: string;
  codec?: string;
  width?: number;
  height?: number;
  fps?: number;
  durationSec?: number;
  framesScanned: number;
  qrHits: number;
  lbopUseful: number;
  sampleFps: number;
  outcome: DecodeOutcome;
  filename?: string;
  bytes?: number;
  hashOk?: boolean;
  message: string;
}

const VIDEO_EXT = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".m4v",
  ".avi",
  ".mpeg",
  ".mpg",
  ".ts",
  ".m2ts",
]);

function isVideoFile(path: string): boolean {
  return VIDEO_EXT.has(extname(path).toLowerCase());
}

function probeVideo(path: string): Partial<DecodeReport> {
  const r = spawnSync(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=codec_name,width,height,r_frame_rate,duration:format=format_name,duration",
      "-of",
      "json",
      path,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) {
    throw new Error(r.stderr || "ffprobe failed");
  }
  const j = JSON.parse(r.stdout || "{}");
  const stream = j.streams?.[0] ?? {};
  const format = j.format ?? {};
  let fps = 30;
  if (typeof stream.r_frame_rate === "string" && stream.r_frame_rate.includes("/")) {
    const [a, b] = stream.r_frame_rate.split("/").map(Number);
    if (b) fps = a / b;
  }
  const durationSec = Number(stream.duration || format.duration || 0) || undefined;
  return {
    container: format.format_name,
    codec: stream.codec_name,
    width: stream.width,
    height: stream.height,
    fps,
    durationSec,
  };
}

function extractFrames(
  videoPath: string,
  outDir: string,
  fps: number,
  options?: { durationSec?: number },
): void {
  mkdirSync(outDir, { recursive: true });
  const args = ["-y", "-i", videoPath];
  if (options?.durationSec && options.durationSec > 0) {
    args.push("-t", String(options.durationSec));
  }
  args.push("-vf", `fps=${fps}`, "-q:v", "3", join(outDir, "f%05d.jpg"));
  execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
}

async function decodeQrFromImage(path: string): Promise<Uint8Array | null> {
  let img = sharp(path);
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  // Upscale small frames for QR robustness
  if (Math.min(w, h) > 0 && Math.min(w, h) < 720) {
    const scale = 720 / Math.min(w, h);
    img = img.resize({
      width: Math.round(w * scale),
      height: Math.round(h * scale),
      kernel: "lanczos3",
    });
  }
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const code = jsQR(
    new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength),
    info.width,
    info.height,
    { inversionAttempts: "attemptBoth" },
  );
  if (!code) return null;
  if (code.binaryData && code.binaryData.length > 0) {
    return Uint8Array.from(code.binaryData);
  }
  return new TextEncoder().encode(code.data);
}

async function scanFrameDir(
  dir: string,
  report: DecodeReport,
): Promise<{ session: BrowserDecodeSession; complete: boolean }> {
  const files = readdirSync(dir)
    .filter((f) => /\.(jpe?g|png|webp)$/i.test(f))
    .sort();
  const session = new BrowserDecodeSession();
  let lastQrAt = -1;

  for (let i = 0; i < files.length; i++) {
    report.framesScanned++;
    let payload: Uint8Array | null = null;
    try {
      payload = await decodeQrFromImage(join(dir, files[i]));
    } catch {
      continue;
    }
    if (!payload) continue;
    report.qrHits++;
    lastQrAt = i;
    try {
      const ok = session.ingestQrPayload(payload);
      if (ok) report.lbopUseful++;
    } catch {
      /* ignore non-LBOP */
    }
    if (session.isComplete) {
      return { session, complete: true };
    }
    // Early exit: scanned >3s of frames at sample rate with zero QR
    const secondsScanned = report.framesScanned / Math.max(report.sampleFps, 1);
    if (secondsScanned >= 3 && report.qrHits === 0 && files.length > report.sampleFps * 3) {
      // continue full scan only if short; for long videos stop early after 8s no QR
      if (secondsScanned >= 8) break;
    }
    void lastQrAt;
  }
  return { session, complete: session.isComplete };
}

async function decodeVideoFile(videoPath: string): Promise<DecodeReport> {
  const report: DecodeReport = {
    input: videoPath,
    framesScanned: 0,
    qrHits: 0,
    lbopUseful: 0,
    sampleFps: 10,
    outcome: "incomplete",
    message: "",
  };

  let meta: Partial<DecodeReport>;
  try {
    meta = probeVideo(videoPath);
    Object.assign(report, meta);
  } catch (e) {
    report.outcome = "unsupported_format";
    report.message = `Cannot open video: ${e instanceof Error ? e.message : String(e)}`;
    return report;
  }

  const tmp = mkdtempSync(join(tmpdir(), "lb-decode-"));
  try {
    const probeWindow = Math.min(8, report.durationSec || 8);

    // Pass 1: 10 fps over first ~8s (fast no-signal path for news clips)
    report.sampleFps = 10;
    try {
      extractFrames(videoPath, join(tmp, "p10"), 10, { durationSec: probeWindow });
    } catch (e) {
      report.outcome = "unsupported_format";
      report.message = `ffmpeg extract failed: ${e instanceof Error ? e.message : String(e)}`;
      return report;
    }

    let { session, complete } = await scanFrameDir(join(tmp, "p10"), report);

    // Escalate to 30 fps on the same window if no QR after ~3s, or denser if QR but incomplete
    if (!complete && report.qrHits === 0 && report.framesScanned < 40) {
      report.sampleFps = 30;
      extractFrames(videoPath, join(tmp, "p30"), 30, { durationSec: Math.min(3, probeWindow) });
      const pass2 = await scanFrameDir(join(tmp, "p30"), report);
      session = pass2.session;
      complete = pass2.complete;
    }

    // If we found LBOP but incomplete, scan the full file at 10 then 30 fps
    if (!complete && report.lbopUseful > 0) {
      report.sampleFps = 10;
      extractFrames(videoPath, join(tmp, "full10"), 10);
      const full = await scanFrameDir(join(tmp, "full10"), report);
      session = full.session;
      complete = full.complete;
      if (!complete) {
        report.sampleFps = 30;
        extractFrames(videoPath, join(tmp, "full30"), 30);
        const denser = await scanFrameDir(join(tmp, "full30"), report);
        session = denser.session;
        complete = denser.complete;
      }
    }

    if (!complete) {
      if (report.qrHits === 0) {
        report.outcome = "no_optical_signal";
        report.message =
          "Video opened successfully, but it is not a LightBeam transmission (no optical codes).";
      } else {
        report.outcome = "incomplete";
        report.message =
          "Found optical codes but could not finish reconstruction. Need more of the loop or higher quality.";
      }
      return report;
    }

    try {
      const result = await session.finish();
      const outPath = resolve(__dirname, "../../../testdata/decoded-from-video.bin");
      writeFileSync(outPath, Buffer.from(result.bytes));
      report.filename = result.filename;
      report.bytes = result.bytes.length;
      report.hashOk = result.hashOk;
      if (!result.hashOk) {
        report.outcome = "hash_failed";
        report.message = "Reconstructed payload failed hash verification.";
        return report;
      }
      report.outcome = "verified";
      report.message = `Recovered ${result.filename} (${result.bytes.length} bytes). Wrote ${outPath}`;
      return report;
    } catch (e) {
      report.outcome = "hash_failed";
      report.message = e instanceof Error ? e.message : String(e);
      return report;
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

async function decodeFramesDir(dir: string): Promise<DecodeReport> {
  const report: DecodeReport = {
    input: dir,
    framesScanned: 0,
    qrHits: 0,
    lbopUseful: 0,
    sampleFps: 0,
    outcome: "incomplete",
    message: "",
  };
  const { session, complete } = await scanFrameDir(dir, report);
  if (!complete) {
    report.outcome = report.qrHits === 0 ? "no_optical_signal" : "incomplete";
    report.message =
      report.qrHits === 0
        ? "No LightBeam optical codes found in frames."
        : "Incomplete reconstruction from frame folder.";
    return report;
  }
  try {
    const result = await session.finish();
    const outPath = resolve(__dirname, "../../../testdata/decoded-from-video.bin");
    writeFileSync(outPath, Buffer.from(result.bytes));
    report.filename = result.filename;
    report.bytes = result.bytes.length;
    report.hashOk = result.hashOk;
    report.outcome = result.hashOk ? "verified" : "hash_failed";
    report.message = result.hashOk
      ? `Recovered ${result.filename} (${result.bytes.length} bytes).`
      : "Hash verification failed.";
  } catch (e) {
    report.outcome = "hash_failed";
    report.message = e instanceof Error ? e.message : String(e);
  }
  return report;
}

function exitCode(outcome: DecodeOutcome): number {
  switch (outcome) {
    case "verified":
      return 0;
    case "no_optical_signal":
      return 2;
    case "unsupported_format":
      return 3;
    default:
      return 4;
  }
}

async function main() {
  const input = resolve(process.argv[2] || "");
  if (!input || !existsSync(input)) {
    console.error("Usage: decode-video.ts <video-file|frames-dir>");
    process.exit(3);
  }

  const report = statSync(input).isDirectory()
    ? await decodeFramesDir(input)
    : await decodeVideoFile(input);

  console.log(JSON.stringify(report, null, 2));
  process.exitCode = exitCode(report.outcome);
}

main().catch((e) => {
  const report: DecodeReport = {
    input: process.argv[2] || "",
    framesScanned: 0,
    qrHits: 0,
    lbopUseful: 0,
    sampleFps: 0,
    outcome: "unsupported_format",
    message: e instanceof Error ? e.message : String(e),
  };
  console.log(JSON.stringify(report, null, 2));
  process.exit(3);
});
