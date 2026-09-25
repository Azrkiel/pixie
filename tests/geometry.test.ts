import { describe, expect, it } from "vitest";
import { clamp, intersects } from "../src/shared/geometry";

describe("intersects", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };

  it("detects overlapping rects", () => {
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it("treats touching or separate rects as not overlapping", () => {
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 50, y: 50, width: 5, height: 5 })).toBe(false);
  });
});

describe("clamp", () => {
  it("keeps values that are already inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clips to the nearest bound", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it("prefers the lower bound when the range is empty", () => {
    expect(clamp(5, 8, 2)).toBe(8);
  });
});
