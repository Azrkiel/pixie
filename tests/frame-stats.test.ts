import { describe, expect, it } from "vitest";
import { summarizeFrames } from "../src/renderer/frame-stats";

describe("summarizeFrames", () => {
  it("reports fps, p95, max and slow frames", () => {
    const frames = [...Array(19).fill(16), 40];
    // average 17.2 ms -> 58 fps
    expect(summarizeFrames(frames)).toEqual({ count: 20, fps: 58, p95Ms: 40, maxMs: 40, slow: 1 });
  });

  it("returns null when there are no frames", () => {
    expect(summarizeFrames([])).toBeNull();
  });
});
