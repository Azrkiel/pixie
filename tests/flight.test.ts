import { describe, expect, it } from "vitest";
import { FLIGHT_MAX_MS, FLIGHT_MIN_MS, flightDuration, planFlight, sampleFlight } from "../src/shared/flight";

const VIEW = { width: 1536, height: 863 };

describe("flightDuration", () => {
  it("grows with distance, clamped between the min and max", () => {
    expect(flightDuration(0)).toBe(FLIGHT_MIN_MS);
    expect(flightDuration(1000)).toBe(850);
    expect(flightDuration(5000)).toBe(FLIGHT_MAX_MS);
  });
});

describe("planFlight + sampleFlight", () => {
  const from = { x: 200, y: 400 };
  const to = { x: 1200, y: 400 };
  const f = planFlight(from, to, 1000, VIEW);

  it("starts at `from` and lands exactly on `to`", () => {
    expect(sampleFlight(f, 1000).pos).toEqual(from);
    const end = sampleFlight(f, 1000 + f.durationMs);
    expect(end.pos).toEqual(to);
    expect(end.done).toBe(true);
    expect(sampleFlight(f, 1000 + f.durationMs / 2).done).toBe(false);
  });

  it("stays on the target after the flight is over", () => {
    expect(sampleFlight(f, 99_999).pos).toEqual(to);
  });

  it("points along the direction of travel", () => {
    // Left-to-right: the tangent at the midpoint of the symmetric arc is horizontal.
    expect(sampleFlight(f, 1000 + f.durationMs / 2).angle).toBeCloseTo(0, 9);
  });

  it("bows toward the middle of the screen and never leaves it", () => {
    const top = planFlight({ x: 100, y: 20 }, { x: 1400, y: 20 }, 0, VIEW);
    expect(sampleFlight(top, top.durationMs / 2).pos.y).toBeGreaterThan(20);
    for (let i = 0; i <= 50; i++) {
      const p = sampleFlight(top, (top.durationMs * i) / 50).pos;
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW.width);
    }
  });

  it("handles a zero-length flight without NaN", () => {
    const z = planFlight({ x: 50, y: 50 }, { x: 50, y: 50 }, 0, VIEW);
    const s = sampleFlight(z, z.durationMs / 2);
    expect(s.pos.x).toBeCloseTo(50, 9);
    expect(s.pos.y).toBeCloseTo(50, 9);
    expect(s.angle).toBe(0);
  });
});
