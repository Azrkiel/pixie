import { describe, expect, it } from "vitest";
import {
  IDLE_AFTER_MS,
  POINT_HOLD_MS,
  SETTLE_MS,
  initialState,
  next,
  pixiePose,
  type BehaviorState,
} from "../src/renderer/behavior";

const VIEW = { width: 1536, height: 863 };
const at = (x: number, y: number) => ({ x, y });

/** Tick the reducer forward like a 60 fps render loop. */
function run(s: BehaviorState, from: number, ms: number, stepMs = 16) {
  let now = from;
  let state = s;
  while (now < from + ms) {
    now += stepMs;
    state = next(state, { type: "tick", dtSec: stepMs / 1000 }, now, VIEW);
  }
  return { s: state, now };
}

/** Point at `target` from a fresh state and tick until Pixie has landed. */
function landedAt(target = at(900, 500)) {
  const s = next(initialState(at(100, 100), 0), { type: "point", target, label: "Save" }, 0, VIEW);
  return run(s, 0, 1200);
}

describe("behavior reducer", () => {
  it("starts following just below-right of the cursor", () => {
    const s = initialState(at(100, 100), 0);
    expect(s.mode).toBe("follow");
    expect(pixiePose(s, 0).tip).toEqual(at(118, 122));
  });

  it("goes idle without input and wakes on the next cursor move", () => {
    const idle = run(initialState(at(100, 100), 0), 0, IDLE_AFTER_MS + 100);
    expect(idle.s.mode).toBe("idle");
    expect(next(idle.s, { type: "cursor", at: at(300, 300) }, idle.now, VIEW).mode).toBe("follow");
  });

  it("flies to a point and lands with the tip exactly on the target", () => {
    const { s, now } = landedAt();
    expect(s.mode).toBe("pointing");
    expect(s.label).toBe("Save");
    expect(pixiePose(s, now).tip).toEqual(at(900, 500));
  });

  it("rotates back to rest within SETTLE_MS of landing", () => {
    const { s } = landedAt();
    expect(pixiePose(s, s.since + SETTLE_MS).angle).toBeCloseTo(0, 9);
  });

  it("flies home on release and lands back beside the cursor", () => {
    const landed = landedAt();
    const released = next(landed.s, { type: "release" }, landed.now, VIEW);
    expect(released.mode).toBe("returning");
    expect(released.label).toBeNull();
    const back = run(released, landed.now, 1200);
    // Follow, or already idle: the mouse hasn't moved for over IDLE_AFTER_MS.
    expect(["follow", "idle"]).toContain(back.s.mode);
    expect(pixiePose(back.s, back.now).tip).toEqual(at(118, 122));
  });

  it("flies home by itself after POINT_HOLD_MS", () => {
    const landed = landedAt();
    expect(run(landed.s, landed.now, POINT_HOLD_MS + 50).s.mode).toBe("returning");
  });

  it("re-plans from where it is when a new point arrives mid-flight (no teleport)", () => {
    let s = next(initialState(at(100, 100), 0), { type: "point", target: at(1400, 700) }, 0, VIEW);
    const midFlight = pixiePose(s, 300).tip;
    s = next(s, { type: "point", target: at(200, 700) }, 300, VIEW);
    expect(pixiePose(s, 300).tip).toEqual(midFlight);
  });

  it("never snaps its rotation: out to a target, settling, and back home", () => {
    let s = initialState(at(100, 100), 0);
    let now = 0;
    let prev = pixiePose(s, now).angle;
    let maxJump = 0;
    const observe = () => {
      const a = pixiePose(s, now).angle;
      maxJump = Math.max(maxJump, Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev))));
      prev = a;
    };
    const frames = (ms: number) => {
      for (let end = now + ms; now < end; ) {
        now += 16;
        s = next(s, { type: "tick", dtSec: 0.016 }, now, VIEW);
        observe();
      }
    };
    s = next(s, { type: "point", target: at(1400, 200) }, now, VIEW); // take off heading right: tip must turn ~135 degrees
    observe();
    frames(1500);
    s = next(s, { type: "release" }, now, VIEW); // head home down-left
    observe();
    frames(1500);
    expect(s.mode === "follow" || s.mode === "idle").toBe(true);
    expect(maxJump).toBeLessThan(0.6); // a snap would be ~2.4 rad in one frame
  });

  it("ignores release when not pointing", () => {
    const s = initialState(at(100, 100), 0);
    expect(next(s, { type: "release" }, 10, VIEW)).toBe(s);
  });
});
