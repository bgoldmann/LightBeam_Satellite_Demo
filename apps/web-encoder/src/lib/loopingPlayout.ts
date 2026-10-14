/** Continuous QR playout for live TV / phone capture — vsync-aligned. */
import type { EncodeSession } from "./encoder";
import QRCode from "qrcode";

export type PlayoutStatus = {
  phase: "preparing" | "playing" | "stopped" | "error";
  prepareCurrent: number;
  prepareTotal: number;
  loopIndex: number;
  loopPct: number;
  message?: string;
};

/**
 * Live playout paints **new fountain symbols forever** (never reuses symbol IDs).
 * Lab profile may emit several QR tiles per video frame (spatial multiplex).
 *
 * Timing uses requestAnimationFrame + vsync frame counting so each QR tick
 * stays up for exactly `holdFrames` refreshes without setTimeout drift.
 */
export class LoopingQrPlayout {
  private raf: number | null = null;
  private running = false;
  private index = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private session: EncodeSession;
  private onStatus: (s: PlayoutStatus) => void;
  private onPaint: (
    loopIndex: number,
    loopPct: number,
    prepared?: ReturnType<typeof QRCode.create>[],
  ) => void;
  private cycleLen = 1;
  private framesUntilNext = 0;
  private prepared: ReturnType<typeof QRCode.create>[] | null = null;

  constructor(
    session: EncodeSession,
    handlers: {
      onStatus: (s: PlayoutStatus) => void;
      onPaint: (
        loopIndex: number,
        loopPct: number,
        prepared?: ReturnType<typeof QRCode.create>[],
      ) => void;
    },
  ) {
    this.session = session;
    this.onStatus = handlers.onStatus;
    this.onPaint = handlers.onPaint;
  }

  async start(): Promise<void> {
    await this.stop();
    this.running = true;
    this.index = 0;
    this.framesUntilNext = 0;
    const tiles = Math.max(1, this.session.profile.tiles);
    this.cycleLen = Math.max(
      1,
      Math.ceil((this.session.loopFrameCount || this.session.info.loopFrameCount || 64) / tiles),
    );

    // Prefetch first tick so paint never stalls on QR encode.
    this.prepared = this.session.prepareNextTickQrs({ looping: false });

    await this.acquireWakeLock();
    this.onStatus({
      phase: "playing",
      prepareCurrent: 0,
      prepareTotal: 0,
      loopIndex: 1,
      loopPct: 0,
      message: "Streaming unique QR symbols — keep scanning until 100%",
    });
    this.raf = requestAnimationFrame((t) => this.onFrame(t));
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.raf != null) {
      cancelAnimationFrame(this.raf);
      this.raf = null;
    }
    this.prepared = null;
    await this.releaseWakeLock();
    this.onStatus({
      phase: "stopped",
      prepareCurrent: 0,
      prepareTotal: 0,
      loopIndex: Math.floor(this.index / this.cycleLen) + 1,
      loopPct: 0,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  private onFrame(_now: number): void {
    if (!this.running) return;

    if (this.framesUntilNext <= 0) {
      const loopIndex = Math.floor(this.index / this.cycleLen) + 1;
      const loopPct = Math.round((((this.index % this.cycleLen) + 1) / this.cycleLen) * 100);
      const qrs = this.prepared;
      try {
        this.onPaint(loopIndex, loopPct, qrs ?? undefined);
        this.onStatus({
          phase: "playing",
          prepareCurrent: 0,
          prepareTotal: 0,
          loopIndex,
          loopPct,
          message: "Streaming unique QR symbols — keep scanning until 100%",
        });
      } catch (e) {
        console.warn("playout frame draw failed", e);
      }

      // Prepare next tick while current is held on screen.
      try {
        this.prepared = this.session.prepareNextTickQrs({ looping: false });
      } catch (e) {
        console.warn("QR prepare failed", e);
        this.prepared = null;
      }

      this.index++;
      if (this.index % 30 === 0) {
        void this.acquireWakeLock();
      }

      // Hold for exactly holdFrames vsync refreshes at the profile fps.
      // On a 60 Hz display with fps=60 holdFrames=2 → switch every 2 frames.
      this.framesUntilNext = Math.max(1, this.session.profile.holdFrames);
    }

    this.framesUntilNext--;
    this.raf = requestAnimationFrame((t) => this.onFrame(t));
  }

  private async acquireWakeLock(): Promise<void> {
    try {
      if (!("wakeLock" in navigator)) return;
      if (document.visibilityState !== "visible") return;
      if (this.wakeLock && !this.wakeLock.released) return;
      this.wakeLock = await navigator.wakeLock.request("screen");
      this.wakeLock.addEventListener("release", () => {
        this.wakeLock = null;
      });
    } catch {
      /* ignore */
    }
  }

  private async releaseWakeLock(): Promise<void> {
    try {
      await this.wakeLock?.release();
    } catch {
      /* ignore */
    }
    this.wakeLock = null;
  }
}
