/** Continuous looping QR playout for live TV / phone capture. */
import type { EncodeSession } from "./encoder";

export type PlayoutStatus = {
  phase: "preparing" | "playing" | "stopped" | "error";
  prepareCurrent: number;
  prepareTotal: number;
  loopIndex: number;
  loopPct: number;
  message?: string;
};

/**
 * Pre-renders one full QR cycle, then plays it forever with chained timeouts
 * (never uses setInterval — avoids mid-stream stalls when QR encode is slow).
 * Also holds a Screen Wake Lock when the browser supports it.
 */
export class LoopingQrPlayout {
  private frames: string[] = [];
  private timer: number | null = null;
  private running = false;
  private index = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private session: EncodeSession;
  private onStatus: (s: PlayoutStatus) => void;
  private onFrame: (dataUrl: string, loopIndex: number, loopPct: number) => void;

  constructor(
    session: EncodeSession,
    handlers: {
      onStatus: (s: PlayoutStatus) => void;
      onFrame: (dataUrl: string, loopIndex: number, loopPct: number) => void;
    },
  ) {
    this.session = session;
    this.onStatus = handlers.onStatus;
    this.onFrame = handlers.onFrame;
  }

  async start(): Promise<void> {
    await this.stop();
    this.running = true;
    this.index = 0;
    this.frames = [];

    const total = Math.max(1, this.session.loopFrameCount || this.session.info.loopFrameCount);
    this.onStatus({
      phase: "preparing",
      prepareCurrent: 0,
      prepareTotal: total,
      loopIndex: 0,
      loopPct: 0,
      message: "Building looping QR cycle…",
    });

    try {
      for (let i = 0; i < total; i++) {
        if (!this.running) return;
        const url = await this.session.nextQrDataUrl({ looping: true });
        this.frames.push(url);
        if (i % 2 === 0 || i === total - 1) {
          this.onStatus({
            phase: "preparing",
            prepareCurrent: i + 1,
            prepareTotal: total,
            loopIndex: 0,
            loopPct: Math.round(((i + 1) / total) * 100),
            message: `Building looping QR cycle… ${i + 1}/${total}`,
          });
        }
      }
    } catch (e) {
      this.running = false;
      this.onStatus({
        phase: "error",
        prepareCurrent: this.frames.length,
        prepareTotal: total,
        loopIndex: 0,
        loopPct: 0,
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (!this.running || this.frames.length === 0) return;

    await this.acquireWakeLock();
    this.onStatus({
      phase: "playing",
      prepareCurrent: this.frames.length,
      prepareTotal: this.frames.length,
      loopIndex: 1,
      loopPct: 0,
      message: "Looping — missed codes recover on the next pass",
    });
    this.scheduleNext(0);
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.timer != null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    await this.releaseWakeLock();
    this.onStatus({
      phase: "stopped",
      prepareCurrent: this.frames.length,
      prepareTotal: this.frames.length,
      loopIndex: Math.floor(this.index / Math.max(this.frames.length, 1)) + 1,
      loopPct: 0,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = window.setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running || this.frames.length === 0) return;

    const n = this.frames.length;
    const frameIdx = this.index % n;
    const url = this.frames[frameIdx];
    const loopIndex = Math.floor(this.index / n) + 1;
    const loopPct = Math.round(((frameIdx + 1) / n) * 100);

    try {
      this.onFrame(url, loopIndex, loopPct);
      this.onStatus({
        phase: "playing",
        prepareCurrent: n,
        prepareTotal: n,
        loopIndex,
        loopPct,
        message: "Looping — missed codes recover on the next pass",
      });
    } catch (e) {
      console.warn("playout frame draw failed", e);
      // continue — never stop mid-play for a draw glitch
    }

    this.index++;
    // Re-assert wake lock periodically (browsers release it on visibility changes)
    if (this.index % 30 === 0) {
      void this.acquireWakeLock();
    }

    const holdMs =
      (1000 / Math.max(1, this.session.profile.fps)) * Math.max(1, this.session.profile.holdFrames);
    this.scheduleNext(Math.max(100, holdMs));
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
      /* unsupported / denied — ignore */
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
