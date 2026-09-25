import type { Size, Vec } from "../shared/geometry";
import { drawAnnotation, pruneAnnotations } from "./annotations";
import { initialState, next, pixiePose } from "./behavior";
import {
  BUBBLE_FONT,
  BUBBLE_MAX_TEXT_WIDTH,
  PILL_FONT,
  PILL_MAX_TEXT_WIDTH,
  bubbleAlpha,
  drawBubble,
  drawPill,
  fitText,
  layoutBubble,
  limitLines,
  measureBubble,
  pixieBodyRect,
  placeLabel,
  wrapText,
  type BubbleLayout,
} from "./bubble";
import { FrameStats } from "./frame-stats";
import { drawPixie } from "./pixie-sprite";
import { applyStage, type StageEnv, type StageState } from "./stage";

const debug = new URLSearchParams(location.search).get("debug") === "1";

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

// The first text draw builds glyph caches (a ~100 ms hitch). Pay it now, off screen, instead of mid-animation.
for (const font of [BUBBLE_FONT, PILL_FONT]) {
  ctx.font = font;
  ctx.fillText("Pixie warm-up 0123456789", -1000, -1000);
}

const viewport = (): Size => ({ width: window.innerWidth, height: window.innerHeight });
/** Screenshots map onto the display (`window.screen`), not onto the overlay, which is 1 px shorter. */
const env = (): StageEnv => ({ viewport: viewport(), display: { width: window.screen.width, height: window.screen.height } });

let stage: StageState = {
  behavior: initialState({ x: window.innerWidth / 2, y: window.innerHeight / 2 }, performance.now()),
  annotations: [],
  nextAnnotationId: 1,
  bubble: null,
};

window.pixie.onCursor((s) => {
  stage = { ...stage, behavior: next(stage.behavior, { type: "cursor", at: { x: s.x, y: s.y } }, performance.now(), viewport()) };
});
window.pixie.onStage((c) => {
  stage = applyStage(stage, c, performance.now(), env());
});

const measureWith = (font: string) => (s: string) => {
  ctx.font = font;
  return ctx.measureText(s).width;
};

interface Speech {
  layout: BubbleLayout;
  lines: string[];
  alpha: number;
}

function speechLayout(tip: Vec, now: number): Speech | null {
  const { bubble } = stage;
  if (!bubble) return null;
  const alpha = bubbleAlpha(bubble.shownAt, bubble.text, now);
  if (alpha <= 0) {
    if (now > bubble.shownAt) stage = { ...stage, bubble: null }; // its reading time is over
    return null;
  }
  const measure = measureWith(BUBBLE_FONT);
  const lines = limitLines(wrapText(bubble.text, BUBBLE_MAX_TEXT_WIDTH, measure));
  return { layout: layoutBubble(tip, measureBubble(lines, measure), viewport()), lines, alpha };
}

function drawLabel(tip: Vec, speech: Speech | null): void {
  const { mode, label } = stage.behavior;
  if (mode !== "pointing" || !label) return;
  const measure = measureWith(PILL_FONT);
  const text = fitText(label, PILL_MAX_TEXT_WIDTH, measure);
  const avoid = speech ? [pixieBodyRect(tip), speech.layout.rect] : [pixieBodyRect(tip)];
  drawPill(ctx, placeLabel(tip, measure(text), viewport(), avoid), text);
}

const stats = debug ? new FrameStats((line) => console.log(line)) : null;
if (debug) {
  // Main-thread tasks over 50 ms (ours or Chromium's): with [pixie:slow] lines, this shows who stalled a frame.
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) console.log(`[pixie:longtask] ${e.duration.toFixed(0)}ms`);
  }).observe({ type: "longtask", buffered: true });
}
let prev = performance.now();
let prevWorkMs = 0;

function frame(): void {
  // One clock for everything: the IPC handlers above also stamp events with performance.now().
  const now = performance.now();
  const dt = (now - prev) / 1000;
  prev = now;
  stage = {
    ...stage,
    behavior: next(stage.behavior, { type: "tick", dtSec: dt }, now, viewport()),
    annotations: pruneAnnotations(stage.annotations, now),
  };

  const { mode } = stage.behavior;
  const pose = pixiePose(stage.behavior, now);
  const idle = mode === "idle";
  const tip = { x: pose.tip.x, y: pose.tip.y + (idle ? Math.sin(now / 450) * 3 : 0) }; // hover gently while resting
  const breathe = idle ? 1 + Math.sin(now / 700) * 0.04 : 1;
  const speech = speechLayout(tip, now);

  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  for (const a of stage.annotations) drawAnnotation(ctx, a, now, viewport());
  drawPixie(ctx, tip, pose.angle, breathe);
  drawLabel(tip, speech);
  if (speech) drawBubble(ctx, speech.layout, speech.lines, speech.alpha);

  stats?.record(dt * 1000, mode === "flying" || mode === "returning" || stage.annotations.length > 0, prevWorkMs);
  prevWorkMs = performance.now() - now;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
