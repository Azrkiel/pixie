import { clamp, type Rect, type Size, type Vec } from "../shared/geometry";
import { PILL_FONT, PILL_MAX_TEXT_WIDTH, drawPill, fitText, pillRect } from "./bubble";

/** A drawing in overlay-local CSS px (already converted from screenshot pixels). */
export type Shape =
  | { kind: "circle"; center: Vec; r: number }
  | { kind: "box"; rect: Rect }
  | { kind: "arrow"; from: Vec; to: Vec }
  | { kind: "underline"; from: Vec; to: Vec }
  | { kind: "note"; at: Vec; text: string };

export interface Annotation {
  id: number;
  shape: Shape;
  /** Hand-drawn polyline in overlay-local px; empty for notes. */
  path: Vec[];
  createdAt: number;
  ttlMs: number;
  clearedAt: number | null;
}

export const DRAW_MS = 400;
export const TTL_MS = 8000;
export const FADE_MS = 400;
export const CLEAR_FADE_MS = 250;

export const ANNOTATION_STYLE = {
  color: "#7c5cff",
  halo: "rgba(255, 255, 255, 0.85)",
  width: 3.5,
  haloWidth: 8,
  fill: "rgba(124, 92, 255, 0.14)",
};

/** Deterministic PRNG (mulberry32): same seed, same wobble, so hand-drawn shapes are testable. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function circlePath(center: Vec, r: number, rand: () => number): Vec[] {
  const n = 56;
  const turns = 1.08; // overshoot the start a little, like a real pen
  const start = rand() * Math.PI * 2;
  const wobblePhase = rand() * Math.PI * 2;
  const wobbleFreq = 2 + Math.floor(rand() * 2);
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const a = start + t * turns * Math.PI * 2;
    const rr = r * (1 + 0.035 * Math.sin(wobbleFreq * a + wobblePhase) + 0.05 * (t - 0.5));
    pts.push({ x: center.x + rr * Math.cos(a), y: center.y + rr * Math.sin(a) });
  }
  return pts;
}

export function boxPath(rect: Rect, rand: () => number): Vec[] {
  const jitter = () => (rand() - 0.5) * 3; // +-1.5 px per corner
  const corners: Vec[] = [
    { x: rect.x + jitter(), y: rect.y + jitter() },
    { x: rect.x + rect.width + jitter(), y: rect.y + jitter() },
    { x: rect.x + rect.width + jitter(), y: rect.y + rect.height + jitter() },
    { x: rect.x + jitter(), y: rect.y + rect.height + jitter() },
  ];
  const overshoot = { x: corners[0].x + Math.min(12, rect.width * 0.1), y: corners[0].y };
  return [...corners, corners[0], overshoot];
}

export function arrowPath(from: Vec, to: Vec, rand: () => number): Vec[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  if (len < 1) return [from, to];
  const bend = (rand() < 0.5 ? -1 : 1) * 0.06 * len;
  const ctrl = { x: (from.x + to.x) / 2 + (-dy / len) * bend, y: (from.y + to.y) / 2 + (dx / len) * bend };
  const pts: Vec[] = [];
  const n = 20;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push({ x: u * u * from.x + 2 * u * t * ctrl.x + t * t * to.x, y: u * u * from.y + 2 * u * t * ctrl.y + t * t * to.y });
  }
  // Head: two short strokes back from the tip, along the shaft's final direction.
  const ex = to.x - ctrl.x;
  const ey = to.y - ctrl.y;
  const el = Math.hypot(ex, ey);
  const ux = ex / el;
  const uy = ey / el;
  const head = clamp(len * 0.18, 10, 18);
  const spread = (28 * Math.PI) / 180;
  const wing = (s: number): Vec => ({
    x: to.x - head * (ux * Math.cos(s) - uy * Math.sin(s)),
    y: to.y - head * (ux * Math.sin(s) + uy * Math.cos(s)),
  });
  pts.push(wing(spread), { ...to }, wing(-spread));
  return pts;
}

export function underlinePath(from: Vec, to: Vec, rand: () => number): Vec[] {
  const n = 16;
  const phase = rand() * Math.PI * 2;
  const pts: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const wave = i === 0 || i === n ? 0 : 1.5 * Math.sin(phase + t * Math.PI * 3);
    pts.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t + wave });
  }
  return pts;
}

export function pathFor(shape: Shape, rand: () => number): Vec[] {
  switch (shape.kind) {
    case "circle":
      return circlePath(shape.center, shape.r, rand);
    case "box":
      return boxPath(shape.rect, rand);
    case "arrow":
      return arrowPath(shape.from, shape.to, rand);
    case "underline":
      return underlinePath(shape.from, shape.to, rand);
    case "note":
      return [];
  }
}

export function createAnnotation(id: number, shape: Shape, now: number, ttlMs = TTL_MS): Annotation {
  return { id, shape, path: pathFor(shape, mulberry32(id)), createdAt: now, ttlMs, clearedAt: null };
}

export interface AnnotationVisual {
  /** 0..1 how much of the stroke is drawn. */
  draw: number;
  /** 0..1 opacity; 0 means the annotation is gone. */
  alpha: number;
}

export function annotationVisual(a: Annotation, now: number): AnnotationVisual {
  const draw = clamp((now - a.createdAt) / DRAW_MS, 0, 1);
  const lifeAlpha = clamp((a.createdAt + a.ttlMs - now) / FADE_MS, 0, 1);
  const clearAlpha = a.clearedAt === null ? 1 : clamp(1 - (now - a.clearedAt) / CLEAR_FADE_MS, 0, 1);
  return { draw, alpha: Math.min(lifeAlpha, clearAlpha) };
}

export function clearAnnotations(list: Annotation[], now: number): Annotation[] {
  return list.map((a) => (a.clearedAt === null ? { ...a, clearedAt: now } : a));
}

export function pruneAnnotations(list: Annotation[], now: number): Annotation[] {
  return list.filter((a) => annotationVisual(a, now).alpha > 0);
}

/** The first `fraction` (by length) of a polyline, ending on an interpolated point. */
export function partialPolyline(points: Vec[], fraction: number): Vec[] {
  if (points.length < 2 || fraction >= 1) return points;
  if (fraction <= 0) return points.slice(0, 1);
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const d = Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
    lengths.push(d);
    total += d;
  }
  let remaining = total * fraction;
  const out: Vec[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const d = lengths[i - 1];
    if (remaining >= d) {
      out.push(points[i]);
      remaining -= d;
      continue;
    }
    const t = d === 0 ? 0 : remaining / d;
    out.push({ x: points[i - 1].x + (points[i].x - points[i - 1].x) * t, y: points[i - 1].y + (points[i].y - points[i - 1].y) * t });
    break;
  }
  return out;
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: Vec[], color: string, width: number): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function drawAnnotation(ctx: CanvasRenderingContext2D, a: Annotation, now: number, viewport: Size): void {
  const { draw, alpha } = annotationVisual(a, now);
  if (alpha <= 0) return;
  ctx.save();
  if (a.shape.kind === "note") {
    ctx.font = PILL_FONT;
    const measure = (s: string) => ctx.measureText(s).width;
    const text = fitText(a.shape.text, PILL_MAX_TEXT_WIDTH, measure);
    ctx.globalAlpha = alpha * draw; // notes fade in instead of stroking on
    drawPill(ctx, pillRect(a.shape.at, measure(text), viewport), text);
    ctx.restore();
    return;
  }
  if (a.shape.kind === "box") {
    const { x, y, width, height } = a.shape.rect;
    ctx.globalAlpha = alpha * draw;
    ctx.fillStyle = ANNOTATION_STYLE.fill;
    ctx.fillRect(x, y, width, height);
  }
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // White halo under a coloured stroke: readable on both light and dark apps.
  const pts = partialPolyline(a.path, 1 - Math.pow(1 - draw, 3));
  strokePolyline(ctx, pts, ANNOTATION_STYLE.halo, ANNOTATION_STYLE.haloWidth);
  strokePolyline(ctx, pts, ANNOTATION_STYLE.color, ANNOTATION_STYLE.width);
  ctx.restore();
}
