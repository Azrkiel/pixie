import { planFlight, sampleFlight, type Flight } from "../shared/flight";
import { clamp, type Size, type Vec } from "../shared/geometry";
import { FOLLOW_SPRING, stepSpring, type SpringState } from "../shared/spring";

/** PLAN.md section 5.2, the Phase 2 subset. Later phases add listening / thinking / speaking / wander / sleep. */
export type Mode = "follow" | "idle" | "flying" | "pointing" | "returning";

export interface BehaviorState {
  mode: Mode;
  /** When the current mode began (ms, same clock as `now`). */
  since: number;
  /** Latest cursor position, overlay-local px. */
  cursor: Vec;
  lastInputAt: number;
  /** Drives follow / idle. */
  spring: SpringState;
  /** Set while flying / returning. */
  flight: Flight | null;
  /** Set while flying / pointing. */
  target: Vec | null;
  label: string | null;
  /** Sprite rotation when the current flight began; Pixie turns from it into the travel direction. */
  departAngle: number;
  /** Sprite rotation at the last landing; decays to 0 over SETTLE_MS from `settleAt`. */
  settleFrom: number;
  settleAt: number;
}

export type BehaviorEvent =
  | { type: "cursor"; at: Vec }
  | { type: "point"; target: Vec; label?: string }
  | { type: "release" }
  | { type: "tick"; dtSec: number };

export interface Pose {
  tip: Vec;
  angle: number;
}

/** Pixie sits just below-right of the real cursor. */
export const FOLLOW_OFFSET: Vec = { x: 18, y: 22 };
export const IDLE_AFTER_MS = 2000;
/** Without a new point or a release, Pixie flies home after pointing this long. */
export const POINT_HOLD_MS = 6000;
/** How long the sprite takes to turn into a flight, and to rotate back to rest after landing. */
export const TURN_MS = 180;
export const SETTLE_MS = 300;
/** The arrowhead's resting tip faces up-left (-135 degrees); adding this makes the tip lead the flight. */
const TIP_LEAD = (3 * Math.PI) / 4;

const home = (s: BehaviorState): Vec => ({ x: s.cursor.x + FOLLOW_OFFSET.x, y: s.cursor.y + FOLLOW_OFFSET.y });
/** Gentle S-curve (peak speed 1.5x): rotations use it so no single frame turns more than ~20 degrees. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Interpolate along the shorter way round. */
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
const flightLength = (f: Flight): number => Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);

export function initialState(cursor: Vec, now: number): BehaviorState {
  const start = { x: cursor.x + FOLLOW_OFFSET.x, y: cursor.y + FOLLOW_OFFSET.y };
  return {
    mode: "follow",
    since: now,
    cursor,
    lastInputAt: now,
    spring: { pos: start, vel: { x: 0, y: 0 } },
    flight: null,
    target: null,
    label: null,
    departAngle: 0,
    settleFrom: 0,
    settleAt: now,
  };
}

/** Where Pixie's tip is and how she's rotated, at `now`. Rotation never jumps: it turns and settles over time. */
export function pixiePose(s: BehaviorState, now: number): Pose {
  if ((s.mode === "flying" || s.mode === "returning") && s.flight) {
    const f = sampleFlight(s.flight, now);
    const travel = flightLength(s.flight) < 1 ? s.departAngle : wrapAngle(f.angle + TIP_LEAD);
    const turn = smoothstep(clamp((now - s.since) / TURN_MS, 0, 1));
    return { tip: f.pos, angle: lerpAngle(s.departAngle, travel, turn) };
  }
  const settle = s.settleFrom * (1 - smoothstep(clamp((now - s.settleAt) / SETTLE_MS, 0, 1)));
  if (s.mode === "pointing" && s.target) return { tip: s.target, angle: settle };
  return { tip: s.spring.pos, angle: clamp(s.spring.vel.x * 0.0006, -0.35, 0.35) + settle };
}

function startFlight(s: BehaviorState, to: Vec, now: number, viewport: Size): Pick<BehaviorState, "since" | "flight" | "departAngle"> {
  const pose = pixiePose(s, now);
  return { since: now, flight: planFlight(pose.tip, to, now, viewport), departAngle: pose.angle };
}

function flyHome(s: BehaviorState, now: number, viewport: Size): BehaviorState {
  return { ...s, ...startFlight(s, home(s), now, viewport), mode: "returning", target: null, label: null };
}

function tick(s: BehaviorState, dtSec: number, now: number, viewport: Size): BehaviorState {
  switch (s.mode) {
    case "follow":
    case "idle": {
      const spring = stepSpring(s.spring, home(s), dtSec, FOLLOW_SPRING);
      const goIdle = s.mode === "follow" && now - s.lastInputAt > IDLE_AFTER_MS;
      return { ...s, spring, mode: goIdle ? "idle" : s.mode, since: goIdle ? now : s.since };
    }
    case "flying":
    case "returning": {
      if (!s.flight) return s;
      const f = sampleFlight(s.flight, now);
      if (!f.done) return s;
      const landed = { spring: { pos: f.pos, vel: { x: 0, y: 0 } }, settleFrom: pixiePose(s, now).angle, settleAt: now, since: now };
      return s.mode === "flying" ? { ...s, ...landed, mode: "pointing" } : { ...s, ...landed, mode: "follow", flight: null };
    }
    case "pointing":
      return now - s.since > POINT_HOLD_MS ? flyHome(s, now, viewport) : s;
  }
}

/** The whole behaviour as a pure reducer: (state, event, clock) -> state. */
export function next(s: BehaviorState, e: BehaviorEvent, now: number, viewport: Size): BehaviorState {
  switch (e.type) {
    case "cursor": {
      const wake = s.mode === "idle";
      return { ...s, cursor: e.at, lastInputAt: now, mode: wake ? "follow" : s.mode, since: wake ? now : s.since };
    }
    case "point":
      return { ...s, ...startFlight(s, e.target, now, viewport), mode: "flying", target: e.target, label: e.label ?? null };
    case "release":
      return s.mode === "flying" || s.mode === "pointing" ? flyHome(s, now, viewport) : s;
    case "tick":
      return tick(s, e.dtSec, now, viewport);
  }
}
