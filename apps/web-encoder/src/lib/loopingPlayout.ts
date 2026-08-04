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
 * Live playout streams **new fountain symbols forever** (never reuses symbol IDs).
 * That way the phone cannot stall mid-decode after one cycle of duplicates.
 * A visual "loop" meter still wraps for UX; recovery comes from fresh redundancy.
 *
 * Prefetches a small buffer of QR data-URLs so encode latency doesn't freeze the screen.
 */
export class LoopingQrPlayout {
  private timer: number | null = null;
  private running = false;
  private index = 0;
  private wakeLock: WakeLockSentinel | null = null;
  private session: EncodeSession;
  private onStatus: (s: PlayoutStatus) => void;
  private onFrame: (dataUrl: string, loopIndex: number, loopPct: number) => void;
  private buffer: string[] = [];
  private producing = false;
  private cycleLen = 1;
  private prefetchTarget = 12;

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
    this.buffer = [];
    this.cycleLen = Math.max(
      1,
      this.session.loopFrameCount || this.session.info.loopFrameCount || 64,
    );

    this.onStatus({
      phase: "preparing",
      prepareCurrent: 0,
      prepareTotal: this.prefetchTarget,
      loopIndex: 0,
      loopPct: 0,
      message: "Warming up continuous QR stream…",
    });

    try {
      await this.fillBuffer(this.prefetchTarget);
    } catch (e) {
      this.running = false;
      this.onStatus({
        phase: "error",
        prepareCurrent: this.buffer.length,
        prepareTotal: this.prefetchTarget,
        loopIndex: 0,
        loopPct: 0,
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }

    if (!this.running) return;

    await this.acquireWakeLock();
    this.onStatus({
      phase: "playing",
      prepareCurrent: this.buffer.length,
      prepareTotal: this.prefetchTarget,
      loopIndex: 1,
      loopPct: 0,
      message: "Streaming unique QR symbols — keep scanning until 100%",
    });
    this.scheduleNext(0);
    void this.producerLoop();
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
      prepareTotal: this.prefetchTarget,
      loopIndex: Math.floor(this.index / this.cycleLen) + 1,
      loopPct: 0,
    });
  }

  get isRunning(): boolean {
    return this.running;
  }

  private async fillBuffer(count: number): Promise<void> {
    for (let i = 0; i < count; i++) {
      if (!this.running) return;
      // IMPORTANT: looping:false → new symbol IDs every frame (no mid-decode stall)
      const url = await this.session.nextQrDataUrl({ looping: false });
      this.buffer.push(url);
      this.onStatus({
        phase: "preparing",
        prepareCurrent: this.buffer.length,
        prepareTotal: count,
        loopIndex: 0,
        loopPct: Math.round((this.buffer.length / count) * 100),
        message: `Warming up continuous QR stream… ${this.buffer.length}/${count}`,
      });
    }
  }

  private async producerLoop(): Promise<void> {
    if (this.producing) return;
    this.producing = true;
    try {
      while (this.running) {
        while (this.running && this.buffer.length < this.prefetchTarget) {
          try {
            const url = await this.session.nextQrDataUrl({ looping: false });
            this.buffer.push(url);
          } catch (e) {
            console.warn("QR encode failed, retrying", e);
            await new Promise((r) => setTimeout(r, 50));
          }
        }
        await new Promise((r) => setTimeout(r, 16));
      }
    } finally {
      this.producing = false;
    }
  }

  private scheduleNext(delayMs: number): void {
    if (!this.running) return;
    this.timer = window.setTimeout(() => {
      void this.tick();
    }, delayMs);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;

    let url = this.buffer.shift();
    if (!url) {
      // Buffer underrun — generate one immediately, never stop
      try {
        url = await this.session.nextQrDataUrl({ looping: false });
      } catch (e) {
        console.warn("playout underrun encode failed", e);
        this.scheduleNext(50);
        return;
      }
    }

    const loopIndex = Math.floor(this.index / this.cycleLen) + 1;
    const loopPct = Math.round(((this.index % this.cycleLen) + 1) / this.cycleLen * 100);

    try {
      this.onFrame(url, loopIndex, loopPct);
      this.onStatus({
        phase: "playing",
        prepareCurrent: this.buffer.length,
        prepareTotal: this.prefetchTarget,
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
    this.scheduleNext(Math.max(120, holdMs));
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
