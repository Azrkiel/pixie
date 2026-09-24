import { describe, expect, it } from "vitest";
import { screenToLocal } from "../src/shared/coords";

describe("screenToLocal", () => {
  it("is identity on a primary display at the origin", () => {
    expect(screenToLocal({ x: 300, y: 200 }, { x: 0, y: 0, width: 1536, height: 864 })).toEqual({ x: 300, y: 200 });
  });

  it("handles a monitor left of the primary (negative origin)", () => {
    expect(screenToLocal({ x: -1800, y: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 120, y: 100 });
  });
});
