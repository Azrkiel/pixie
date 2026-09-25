import type { Frame, PixieAction } from "../shared/actions";
import { imageLengthToLocal, imageToLocal } from "../shared/coords";
import { clamp, type Size } from "../shared/geometry";
import type { StageCommand } from "../shared/ipc";
import { clearAnnotations, createAnnotation, pruneAnnotations, type Annotation, type Shape } from "./annotations";
import { next, type BehaviorState } from "./behavior";
import { BUBBLE_FADE_IN_MS, bubbleAlpha, bubbleVisibleMs } from "./bubble";

/** The oldest drawings are dropped beyond this, so a runaway answer can't pile up hundreds of strokes. */
export const MAX_ANNOTATIONS = 24;

/** Everything the overlay shows, apart from the pixels. */
export interface StageState {
  behavior: BehaviorState;
  annotations: Annotation[];
  nextAnnotationId: number;
  bubble: { text: string; shownAt: number } | null;
}

export interface StageEnv {
  /** Overlay size in CSS px: flights and layout stay inside it. */
  viewport: Size;
  /** Display size in CSS px: screenshots map onto it. The overlay is 1 px shorter. */
  display: Size;
}

type DrawAction = Exclude<PixieAction, { type: "point" } | { type: "clear" }>;

/** Screenshot-pixel drawing -> overlay-px shape. */
export function toShape(action: DrawAction, frame: Frame, display: Size): Shape {
  const p = (x: number, y: number) => imageToLocal({ x, y }, frame, display);
  switch (action.type) {
    case "circle":
      return { kind: "circle", center: p(action.x, action.y), r: imageLengthToLocal(action.r, frame, display) };
    case "box": {
      const tl = p(action.x, action.y);
      const br = p(action.x + action.w, action.y + action.h);
      return { kind: "box", rect: { x: tl.x, y: tl.y, width: br.x - tl.x, height: br.y - tl.y } };
    }
    case "arrow":
      return { kind: "arrow", from: p(action.x1, action.y1), to: p(action.x2, action.y2) };
    case "underline":
      return { kind: "underline", from: p(action.x, action.y), to: p(action.x + action.w, action.y) };
    case "note":
      return { kind: "note", at: p(action.x, action.y), text: action.text };
  }
}

/**
 * Advance everything that changes with time alone: motion, drawing lifetimes, and the bubble's reading time.
 * Pure, like `applyStage`. Together they are the only ways the stage state changes, so painting stays read-only.
 */
export function tickStage(s: StageState, dtSec: number, now: number, env: StageEnv): StageState {
  const bubbleOver = s.bubble !== null && now - s.bubble.shownAt >= bubbleVisibleMs(s.bubble.text);
  return {
    ...s,
    behavior: next(s.behavior, { type: "tick", dtSec }, now, env.viewport),
    annotations: pruneAnnotations(s.annotations, now),
    bubble: bubbleOver ? null : s.bubble,
  };
}

/** Apply one stage command. Pure: the renderer keeps the returned state and paints it each frame. */
export function applyStage(s: StageState, c: StageCommand, now: number, env: StageEnv): StageState {
  switch (c.kind) {
    case "say": {
      const text = c.text.trim();
      if (!text) return { ...s, bubble: null };
      // Already showing: swap the text without re-running the fade-in, so streamed updates never blink.
      const showing = s.bubble !== null && bubbleAlpha(s.bubble.shownAt, s.bubble.text, now) > 0;
      return { ...s, bubble: { text, shownAt: showing ? now - BUBBLE_FADE_IN_MS : now } };
    }
    case "release":
      return { ...s, behavior: next(s.behavior, { type: "release" }, now, env.viewport) };
    case "action": {
      const { action, frame } = c;
      if (action.type === "clear") return { ...s, annotations: clearAnnotations(s.annotations, now) };
      if (action.type === "point") {
        const p = imageToLocal({ x: action.x, y: action.y }, frame, env.display);
        // The screenshot's last row/column maps just past the overlay (1 px shorter than the display): keep the tip on it.
        const target = { x: clamp(p.x, 0, env.viewport.width - 1), y: clamp(p.y, 0, env.viewport.height - 1) };
        return { ...s, behavior: next(s.behavior, { type: "point", target, label: action.label }, now, env.viewport) };
      }
      const added = createAnnotation(s.nextAnnotationId, toShape(action, frame, env.display), now);
      return { ...s, annotations: [...s.annotations, added].slice(-MAX_ANNOTATIONS), nextAnnotationId: s.nextAnnotationId + 1 };
    }
  }
}
