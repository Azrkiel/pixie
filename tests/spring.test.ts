import { describe, expect, it } from "vitest";
import { FOLLOW_SPRING, stepSpring, type SpringState } from "../src/shared/spring";

const REST: SpringState = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
const TARGET = { x: 100, y: 50 };

function simulate(seconds: number, dt = 1 / 60) {
  let s = REST;
  let maxX = -Infinity;
  for (let t = 0; t < seconds; t += dt) {
    s = stepSpring(s, TARGET, dt, FOLLOW_SPRING);
    maxX = Math.max(maxX, s.pos.x);
  }
  return { s, maxX };
}

describe("stepSpring", () => {
  it("settles on the target", () => {
    const { s } = simulate(2);
    expect(s.pos.x).toBeCloseTo(100, 1);
    expect(s.pos.y).toBeCloseTo(50, 1);
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeLessThan(1);
  });

  it("does not visibly overshoot", () => {
    expect(simulate(2).maxX).toBeLessThan(101);
  });

  it("clamps huge frame gaps so a stalled frame cannot fling Pixie", () => {
    const stalled = stepSpring(REST, TARGET, 5, FOLLOW_SPRING);
    const normal = stepSpring(REST, TARGET, 0.1, FOLLOW_SPRING);
    expect(stalled).toEqual(normal);
  });
});
