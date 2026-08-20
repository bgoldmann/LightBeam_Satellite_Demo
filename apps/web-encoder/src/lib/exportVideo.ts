/** Broadcast video export: WebM (preview) and phone-safe H.264 MP4 when WebCodecs is available. */
import { Muxer, ArrayBufferTarget } from "mp4-muxer";
import type { EncodeSession } from "./encoder";

export interface ExportProgress {
  phase: string;
  current: number;
  total: number;
}

export type ExportFormat = "webm" | "phonesafe";

export interface ExportResult {
  blob: Blob;
  mime: string;
  frameCount: number;
  format: ExportFormat;
  note?: string;
}

function pickWebmMime(): string {
  const mimeCandidates = [
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  return mimeCandidates.find((m) => MediaRecorder.isTypeSupported(m)) || "video/webm";
}

function pickMp4RecorderMime(): string | null {
  const candidates = [
    "video/mp4;codecs=avc1.42E01E",
    "video/mp4;codecs=avc1.4D401E",
    "video/mp4",
  ];
  return candidates.find((m) => MediaRecorder.isTypeSupported(m)) ?? null;
}

async function exportViaMediaRecorder(
  session: EncodeSession,
  loops: number,
  mime: string,
  onProgress?: (p: ExportProgress) => void,
): Promise<{ blob: Blob; mime: string; frameCount: number }> {
  const profile = session.profile;
  const canvas = document.createElement("canvas");
  canvas.width = 1920;
  canvas.height = 1080;
  const ctx = canvas.getContext("2d")!;

  const symbolsNeeded = session.loopFrameCount || Math.ceil(session.info.estimatedSymbols * 1.1);
  const tiles = Math.max(1, profile.tiles);
  const displayTicks = Math.ceil(symbolsNeeded / tiles) * Math.max(1, loops);
  const frameCount = displayTicks * profile.holdFrames;

  const stream = canvas.captureStream(profile.fps);
  const chunks: Blob[] = [];
  const recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12_000_000 });
  recorder.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };

  const stopped = new Promise<void>((resolve) => {
    recorder.onstop = () => resolve();
  });
  recorder.start(100);

  let tick = 0;
  let videoFrame = 0;
  const hold = profile.holdFrames;
  const frameDurationMs = 1000 / profile.fps;

  while (tick < displayTicks) {
    onProgress?.({
      phase: "Encoding frames",
      current: videoFrame,
      total: frameCount,
    });
    session.paintBroadcastTick(ctx, session.loopProgress(), { looping: true });
    for (let h = 0; h < hold; h++) {
      videoFrame++;
      await new Promise((r) => setTimeout(r, frameDurationMs * 0.85));
    }
    tick++;
  }

  recorder.stop();
  await stopped;
  stream.getTracks().forEach((t) => t.stop());

  const blob = new Blob(chunks, { type: mime });
  onProgress?.({ phase: "Done", current: frameCount, total: frameCount });
  return { blob, mime, frameCount };
}

async function exportPhoneSafeMp4WebCodecs(
  session: EncodeSession,
  loops: number,
  onProgress?: (p: ExportProgress) => void,
): Promise<{ blob: Blob; mime: string; frameCount: number }> {
  if (typeof VideoEncoder === "undefined" || typeof VideoFrame === "undefined") {
    throw new Error("WebCodecs unavailable");
  }

  const profile = session.profile;
  const width = 1920;
  const height = 1080;
  const fps = profile.fps;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: {
      codec: "avc",
      width,
      height,
    },
    fastStart: "in-memory",
  });

  let encoderError: Error | null = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta);
    },
    error: (e) => {
      encoderError = e instanceof Error ? e : new Error(String(e));
    },
  });

  encoder.configure({
    codec: "avc1.42001f",
    width,
    height,
    bitrate: 8_000_000,
    framerate: fps,
  });

  const symbolsNeeded = session.loopFrameCount || Math.ceil(session.info.estimatedSymbols * 1.1);
  const tiles = Math.max(1, profile.tiles);
  const displayTicks = Math.ceil(symbolsNeeded / tiles) * Math.max(1, loops);
  const frameCount = displayTicks * profile.holdFrames;
  let tick = 0;
  let videoFrame = 0;
  const hold = profile.holdFrames;
  const frameDurationUs = Math.round(1_000_000 / fps);

  while (tick < displayTicks) {
    onProgress?.({
      phase: "Encoding H.264 MP4 (phone-safe)",
      current: videoFrame,
      total: frameCount,
    });
    if (encoderError) throw encoderError;

    session.paintBroadcastTick(ctx, session.loopProgress(), { looping: true });
    for (let h = 0; h < hold; h++) {
      const frame = new VideoFrame(canvas, {
        timestamp: videoFrame * frameDurationUs,
        duration: frameDurationUs,
      });
      const keyFrame = videoFrame % (fps * 2) === 0;
      encoder.encode(frame, { keyFrame });
      frame.close();
      videoFrame++;
      if (videoFrame % 8 === 0) {
        await encoder.flush();
      }
    }
    tick++;
  }

  await encoder.flush();
  encoder.close();
  muxer.finalize();

  const blob = new Blob([target.buffer], { type: "video/mp4" });
  onProgress?.({ phase: "Done", current: frameCount, total: frameCount });
  return { blob, mime: "video/mp4", frameCount };
}

/**
 * Export broadcast video.
 * - `webm`: browser MediaRecorder (preview / station handoff source)
 * - `phonesafe`: H.264 MP4 via WebCodecs+mp4-muxer, else MediaRecorder mp4, else WebM with note
 */
export async function exportBroadcastVideo(
  session: EncodeSession,
  loops: number,
  onProgress?: (p: ExportProgress) => void,
  format: ExportFormat = "webm",
): Promise<ExportResult> {
  if (format === "phonesafe") {
    try {
      const r = await exportPhoneSafeMp4WebCodecs(session, loops, onProgress);
      return {
        ...r,
        format: "phonesafe",
        note: "Phone-safe H.264 MP4 — preferred for Android/iOS Decode Video.",
      };
    } catch (webCodecsErr) {
      const mp4Mime = pickMp4RecorderMime();
      if (mp4Mime) {
        const r = await exportViaMediaRecorder(session, loops, mp4Mime, onProgress);
        return {
          ...r,
          format: "phonesafe",
          note: "MP4 via MediaRecorder. Prefer this file for phone Decode Video.",
        };
      }
      const webm = await exportViaMediaRecorder(session, loops, pickWebmMime(), onProgress);
      return {
        ...webm,
        format: "webm",
        note:
          `Phone-safe H.264 MP4 unavailable in this browser (${String(webCodecsErr)}). ` +
          "Exported WebM instead — convert with: ffmpeg -i transmission.webm -c:v libx264 -pix_fmt yuv420p transmission.mp4",
      };
    }
  }

  const r = await exportViaMediaRecorder(session, loops, pickWebmMime(), onProgress);
  return {
    ...r,
    format: "webm",
    note: "WebM preview. For phones, also export H.264 MP4 (phone-safe).",
  };
}

/** Download helper. */
export function downloadBlob(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadText(text: string, filename: string) {
  downloadBlob(new Blob([text], { type: "text/plain" }), filename);
}

/** CLI / docs helper: ffmpeg one-liner for station mezzanine. */
export const PHONE_SAFE_FFMPEG =
  "ffmpeg -y -i transmission.webm -c:v libx264 -pix_fmt yuv420p -movflags +faststart transmission-phone-safe.mp4";
