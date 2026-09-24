import type { Vec } from "../shared/geometry";
import { FOLLOW_SPRING, stepSpring, type SpringState } from "../shared/spring";
import { drawPixie } from "./pixie-sprite";

const FOLLOW_OFFSET: Vec = { x: 18, y: 22 }; // sit just below-right of the real cursor
const IDLE_AFTER_MS = 2000;

const canvas = document.getElementById("stage") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;

function resize(): void {
  const dpr = window.devicePixelRatio;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS px; stay sharp at 125%/150% scaling
}
window.addEventListener("resize", resize);
resize();

let target: Vec = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let spring: SpringState = { pos: { ...target }, vel: { x: 0, y: 0 } };
let lastMoveAt = performance.now();

window.pixie.onCursor((s) => {
  target = { x: s.x + FOLLOW_OFFSET.x, y: s.y + FOLLOW_OFFSET.y };
  lastMoveAt = performance.now();
});

let prev = performance.now();
function frame(now: number): void {
  const dt = (now - prev) / 1000;
  prev = now;
  spring = stepSpring(spring, target, dt, FOLLOW_SPRING);

  const idle = now - lastMoveAt > IDLE_AFTER_MS;
  const bob = idle ? Math.sin(now / 450) * 3 : 0; // hover gently while resting
  const breathe = idle ? 1 + Math.sin(now / 700) * 0.04 : 1;
  const lean = Math.max(-0.35, Math.min(0.35, spring.vel.x * 0.0006)); // tilt into motion

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  drawPixie(ctx, { x: spring.pos.x, y: spring.pos.y + bob }, lean, breathe);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
