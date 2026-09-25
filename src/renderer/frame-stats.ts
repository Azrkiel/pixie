export interface FrameSummary {
  count: number;
  fps: number;
  p95Ms: number;
  maxMs: number;
  /** Frames slower than 20 ms: visible stutter at 60 Hz. */
  slow: number;
}

export function summarizeFrames(frameMs: number[]): FrameSummary | null {
  if (frameMs.length === 0) return null;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    count: sorted.length,
    fps: Math.round(1000 / avg),
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted[sorted.length - 1],
    slow: sorted.filter((x) => x > 20).length,
  };
}

const fmt = (name: string, s: FrameSummary | null) =>
  s ? `${name} n=${s.count} fps=${s.fps} p95=${s.p95Ms.toFixed(1)}ms max=${s.maxMs.toFixed(1)}ms slow=${s.slow}` : `${name} n=0`;

/** Debug builds only: logs a frame-time summary every `windowMs`, split into all frames and animating frames. */
export class FrameStats {
  private all: number[] = [];
  private animating: number[] = [];
  private windowStart = performance.now();

  constructor(
    private readonly log: (line: string) => void,
    private readonly windowMs = 5000,
  ) {}

  record(frameMs: number, isAnimating: boolean): void {
    this.all.push(frameMs);
    if (isAnimating) this.animating.push(frameMs);
    const now = performance.now();
    if (now - this.windowStart < this.windowMs) return;
    this.log(`[pixie:frames] ${fmt("all", summarizeFrames(this.all))} | ${fmt("animating", summarizeFrames(this.animating))}`);
    this.all = [];
    this.animating = [];
    this.windowStart = now;
  }
}
