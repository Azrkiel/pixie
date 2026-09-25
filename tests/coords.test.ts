import { describe, expect, it } from "vitest";
import { imageLengthToLocal, imageToLocal, localToImage, screenToLocal } from "../src/shared/coords";

describe("screenToLocal", () => {
  it("is identity on a primary display at the origin", () => {
    expect(screenToLocal({ x: 300, y: 200 }, { x: 0, y: 0, width: 1536, height: 864 })).toEqual({ x: 300, y: 200 });
  });

  it("handles a monitor left of the primary (negative origin)", () => {
    expect(screenToLocal({ x: -1800, y: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 120, y: 100 });
  });
});

const FRAME = { imageWidth: 1920, imageHeight: 1080 };
const DISPLAY = { width: 1536, height: 864 };

describe("imageToLocal", () => {
  it("maps screenshot pixels to CSS px at 125 % scaling", () => {
    expect(imageToLocal({ x: 960, y: 540 }, FRAME, DISPLAY)).toEqual({ x: 768, y: 432 });
    expect(imageToLocal({ x: 1920, y: 1080 }, FRAME, DISPLAY)).toEqual({ x: 1536, y: 864 });
  });

  it("handles a 4K screenshot that was downsized to 2576 px", () => {
    // 3840x2160 physical at 150 % = 2560x1440 CSS px; sent to Claude as 2576x1449.
    expect(imageToLocal({ x: 1288, y: 724.5 }, { imageWidth: 2576, imageHeight: 1449 }, { width: 2560, height: 1440 })).toEqual({
      x: 1280,
      y: 720,
    });
  });

  it("round-trips through localToImage", () => {
    const p = { x: 1234, y: 567 };
    const back = localToImage(imageToLocal(p, FRAME, DISPLAY), FRAME, DISPLAY);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe("imageLengthToLocal", () => {
  it("scales radii and widths by the display factor", () => {
    expect(imageLengthToLocal(100, FRAME, DISPLAY)).toBe(80);
  });
});
