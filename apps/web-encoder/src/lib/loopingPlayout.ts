/** Continuous QR playout for live TV / phone capture. */
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
 * Live playout paints **new fountain symbols forever** (never reuses symbol IDs).
 * Lab profile may emit several QR tiles per video frame (spatial multiplex).
 */
export class LoopingQrPlayout {
  private timer: number | null = null;
  private running = false;
  private index = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private session: EncodeSession;
  private onStatus: (s: PlayoutStatus) => void;
  private onPaint: (loopIndex: number, loopPct: number) => void;
  private cycleLen = 1;
  private nextDueAt = 0;

  constructor(
    session: EncodeSession,
    handlers: {
      onStatus: (s: PlayoutStatus) => void;
      onPaint: (loopIndex: number, loopPct: number) => void;
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
    this.nextDueAt = 0;
    const tiles = Math.max(1, this.session.profile.tiles);
    this.cycleLen = Math.max(
      1,
      Math.ceil((this.session.loopFrameCount || this.session.info.loopFrameCount || 64) / tiles),
    );

    await this.acquireWakeLock();
    this.onStatus({
      phase: "playing",
      prepareCurrent: 0,
      prepareTotal: 0,
      loopIndex: 1,
      loopPct: 0,
      message: "Streaming unique QR symbols — keep scanning until 100%",
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
      prepareCurrent: 0,
      prepareTotal: 0,
      loopIndex: Math.floor(this.index / this.cycleLen) + 1,
      loopPct: 0,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = window.setTimeout(() => {
      this.tick();
    }, delayMs);
  }

  private tick(): void {
    if (!this.running) return;

    const loopIndex = Math.floor(this.index / this.cycleLen) + 1;
    const loopPct = Math.round((((this.index % this.cycleLen) + 1) / this.cycleLen) * 100);

    try {
      this.onPaint(loopIndex, loopPct);
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

    this.index++;
    if (this.index % 30 === 0) {
      void this.acquireWakeLock();
    }

    const holdMs =
      (1000 / Math.max(1, this.session.profile.fps)) * Math.max(1, this.session.profile.holdFrames);
    const now = performance.now();
    if (this.nextDueAt === 0) this.nextDueAt = now + holdMs;
    else this.nextDueAt += holdMs;
    if (this.nextDueAt < now - holdMs) this.nextDueAt = now;
    this.scheduleNext(Math.max(0, this.nextDueAt - now));
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
