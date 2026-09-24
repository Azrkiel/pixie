import type { Vec } from "./geometry";

export interface SpringState {
  pos: Vec;
  vel: Vec;
}

export interface SpringConfig {
  stiffness: number;
  damping: number;
}

/** Near-critically damped (2*sqrt(170) ~= 26.08): quick, smooth, no visible overshoot. */
export const FOLLOW_SPRING: SpringConfig = { stiffness: 170, damping: 26 };

const MAX_STEP_SEC = 1 / 120;
const MAX_FRAME_SEC = 0.1;

/** Advance a 2D spring toward `target` by `dtSec` (semi-implicit Euler, sub-stepped for stability). */
export function stepSpring(s: SpringState, target: Vec, dtSec: number, cfg: SpringConfig): SpringState {
  let { pos, vel } = s;
  // A stalled frame (sleep, debugger, GPU hiccup) must not fling Pixie across the screen.
  let remaining = Math.min(dtSec, MAX_FRAME_SEC);
  while (remaining > 0) {
    const h = Math.min(remaining, MAX_STEP_SEC);
    const ax = cfg.stiffness * (target.x - pos.x) - cfg.damping * vel.x;
    const ay = cfg.stiffness * (target.y - pos.y) - cfg.damping * vel.y;
    vel = { x: vel.x + ax * h, y: vel.y + ay * h };
    pos = { x: pos.x + vel.x * h, y: pos.y + vel.y * h };
    remaining -= h;
  }
  return { pos, vel };
}
