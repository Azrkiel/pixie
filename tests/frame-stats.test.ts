import { describe, expect, it } from "vitest";
import { describeSlowFrame, summarizeFrames } from "../src/renderer/frame-stats";

describe("describeSlowFrame", () => {
  it("blames Pixie when her own frame work filled the gap", () => {
    expect(describeSlowFrame(120, 95)).toBe("[pixie:slow] gap=120ms pixie-work=95.0ms -> pixie");
  });

  it("blames the system when Pixie's work was small", () => {
    expect(describeSlowFrame(175, 1.4)).toBe("[pixie:slow] gap=175ms pixie-work=1.4ms -> outside pixie (system / GPU / compositor)");
  });
});

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
