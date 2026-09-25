import { clamp, type Size, type Vec } from "./geometry";

/** A cubic Bézier arc from `from` to `to`, flown with ease-in-out. */
export interface Flight {
  from: Vec;
  c1: Vec;
  c2: Vec;
  to: Vec;
  startMs: number;
  durationMs: number;
}

export interface FlightSample {
  pos: Vec;
  /** Direction of travel in radians (canvas coordinates: 0 = right, +PI/2 = down). */
  angle: number;
  done: boolean;
}

export const FLIGHT_MIN_MS = 350;
export const FLIGHT_MAX_MS = 1100;
const MAX_LIFT_PX = 160;

/** Longer trips take longer, within bounds. */
export function flightDuration(distance: number): number {
  return clamp(250 + 0.6 * distance, FLIGHT_MIN_MS, FLIGHT_MAX_MS);
}

export function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** Plan an arc that bows toward the middle of the screen (away from the nearest edges) and never leaves it. */
export function planFlight(from: Vec, to: Vec, startMs: number, viewport: Size): Flight {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const lift = Math.min(MAX_LIFT_PX, dist * 0.2);
  let nx = dist > 0 ? -dy / dist : 0;
  let ny = dist > 0 ? dx / dist : 0;
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  if (nx * (viewport.width / 2 - midX) + ny * (viewport.height / 2 - midY) < 0) {
    nx = -nx;
    ny = -ny;
  }
  // A Bézier stays inside its control points' hull, so clamping them keeps the whole arc on screen.
  const inside = (p: Vec): Vec => ({ x: clamp(p.x, 0, viewport.width), y: clamp(p.y, 0, viewport.height) });
  return {
    from,
    c1: inside({ x: from.x + dx / 3 + nx * lift, y: from.y + dy / 3 + ny * lift }),
    c2: inside({ x: from.x + (2 * dx) / 3 + nx * lift, y: from.y + (2 * dy) / 3 + ny * lift }),
    to,
    startMs,
    durationMs: flightDuration(dist),
  };
}

function bezier(f: Flight, t: number): Vec {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return { x: a * f.from.x + b * f.c1.x + c * f.c2.x + d * f.to.x, y: a * f.from.y + b * f.c1.y + c * f.c2.y + d * f.to.y };
}

function bezierTangent(f: Flight, t: number): Vec {
  const u = 1 - t;
  const a = 3 * u * u;
  const b = 6 * u * t;
  const c = 3 * t * t;
  return {
    x: a * (f.c1.x - f.from.x) + b * (f.c2.x - f.c1.x) + c * (f.to.x - f.c2.x),
    y: a * (f.c1.y - f.from.y) + b * (f.c2.y - f.c1.y) + c * (f.to.y - f.c2.y),
  };
}

export function sampleFlight(f: Flight, nowMs: number): FlightSample {
  const t = clamp((nowMs - f.startMs) / f.durationMs, 0, 1);
  const e = easeInOutCubic(t);
  const tan = bezierTangent(f, e);
  return {
    pos: t >= 1 ? { ...f.to } : bezier(f, e),
    angle: Math.hypot(tan.x, tan.y) < 1e-9 ? 0 : Math.atan2(tan.y, tan.x),
    done: t >= 1,
  };
}
