import { describe, expect, it } from "vitest";
import {
  CLEAR_FADE_MS,
  DRAW_MS,
  TTL_MS,
  annotationVisual,
  arrowPath,
  boxPath,
  circlePath,
  clearAnnotations,
  createAnnotation,
  mulberry32,
  partialPolyline,
  pruneAnnotations,
  underlinePath,
  type Shape,
} from "../src/renderer/annotations";

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hand-drawn paths", () => {
  it("circle stays within 8 % of its radius and sweeps past a full turn", () => {
    const c = { x: 500, y: 300 };
    const r = 60;
    const pts = circlePath(c, r, mulberry32(1));
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThanOrEqual(r * 0.08);
    let swept = 0;
    for (let i = 1; i < pts.length; i++) {
      let d = Math.atan2(pts[i].y - c.y, pts[i].x - c.x) - Math.atan2(pts[i - 1].y - c.y, pts[i - 1].x - c.x);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      swept += d;
    }
    expect(swept).toBeGreaterThan(2 * Math.PI);
  });

  it("box passes within 4 px of every corner", () => {
    const pts = boxPath({ x: 100, y: 200, width: 300, height: 40 }, mulberry32(2));
    for (const [cx, cy] of [
      [100, 200],
      [400, 200],
      [400, 240],
      [100, 240],
    ]) {
      expect(Math.min(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)))).toBeLessThanOrEqual(4);
    }
  });

  it("arrow starts exactly at `from`, reaches `to`, and ends with a head", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 400, y: 250 };
    const pts = arrowPath(from, to, mulberry32(3));
    expect(pts[0]).toEqual(from);
    expect(pts).toContainEqual(to);
    for (const wing of [pts[pts.length - 3], pts[pts.length - 1]]) {
      const d = Math.hypot(wing.x - to.x, wing.y - to.y);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(d).toBeLessThanOrEqual(18 + 1e-9);
    }
  });

  it("underline starts and ends exactly on its endpoints", () => {
    const pts = underlinePath({ x: 10, y: 50 }, { x: 310, y: 50 }, mulberry32(4));
    expect(pts[0]).toEqual({ x: 10, y: 50 });
    expect(pts[pts.length - 1]).toEqual({ x: 310, y: 50 });
  });

  it("the same id always produces the same shape", () => {
    const shape: Shape = { kind: "circle", center: { x: 10, y: 10 }, r: 30 };
    expect(createAnnotation(7, shape, 0).path).toEqual(createAnnotation(7, shape, 999).path);
  });
});

describe("annotation lifecycle", () => {
  const shape: Shape = { kind: "underline", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };

  it("strokes on over DRAW_MS", () => {
    const a = createAnnotation(1, shape, 1000);
    expect(annotationVisual(a, 1000).draw).toBe(0);
    expect(annotationVisual(a, 1000 + DRAW_MS / 2).draw).toBeCloseTo(0.5, 9);
    expect(annotationVisual(a, 1000 + DRAW_MS).draw).toBe(1);
  });

  it("stays opaque, then is gone by its time-to-live", () => {
    const a = createAnnotation(1, shape, 0);
    expect(annotationVisual(a, 1000).alpha).toBe(1);
    expect(annotationVisual(a, TTL_MS).alpha).toBe(0);
    expect(pruneAnnotations([a], 1000)).toEqual([a]);
    expect(pruneAnnotations([a], TTL_MS)).toEqual([]);
  });

  it("clear fades everything out quickly", () => {
    const [a] = clearAnnotations([createAnnotation(1, shape, 0)], 2000);
    expect(annotationVisual(a, 2000).alpha).toBe(1);
    expect(annotationVisual(a, 2000 + CLEAR_FADE_MS).alpha).toBe(0);
  });
});

describe("partialPolyline", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("returns the first fraction of the path by length", () => {
    expect(partialPolyline(line, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(partialPolyline(line, 0.75)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("returns just the start at 0 and everything at 1", () => {
    expect(partialPolyline(line, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(partialPolyline(line, 1)).toEqual(line);
  });
});
