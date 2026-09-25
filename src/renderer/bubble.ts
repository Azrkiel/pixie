import { clamp, intersects, type Rect, type Size, type Vec } from "../shared/geometry";

export const BUBBLE_FONT = "500 15px 'Segoe UI', system-ui, sans-serif";
export const BUBBLE_LINE_HEIGHT = 21;
export const BUBBLE_PADDING = { x: 14, y: 10 };
export const BUBBLE_MAX_TEXT_WIDTH = 280;
/** Long answers show only their latest lines, so a bubble can never outgrow the screen. */
export const BUBBLE_MAX_LINES = 6;
/** Horizontal distance from Pixie's tip to the bubble: clears her 22 px body and glow. */
export const BUBBLE_GAP = 34;
/** Minimum distance between any bubble or pill and the screen edge. */
export const EDGE_MARGIN = 8;
export const BUBBLE_FADE_IN_MS = 150;
const FADE_OUT_MS = 250;

export const PILL_FONT = "600 13px 'Segoe UI', system-ui, sans-serif";
const PILL_PADDING_X = 9;
export const PILL_HEIGHT = 24;
/** Labels and notes longer than this are cut with an ellipsis. */
export const PILL_MAX_TEXT_WIDTH = 320;

export interface BubbleLayout {
  rect: Rect;
  /** Point on the bubble's edge where the tail attaches, facing Pixie. */
  tail: Vec;
  side: "right" | "left";
  vertical: "down" | "up";
}

/** Place a bubble next to Pixie's tip: to her right by default, flipping left / up near edges, always fully on screen. */
export function layoutBubble(anchor: Vec, size: Size, viewport: Size, gap = BUBBLE_GAP, margin = EDGE_MARGIN): BubbleLayout {
  const side = anchor.x + gap + size.width + margin <= viewport.width ? "right" : "left";
  const vertical = anchor.y + size.height + margin <= viewport.height ? "down" : "up";
  const x = clamp(side === "right" ? anchor.x + gap : anchor.x - gap - size.width, margin, viewport.width - margin - size.width);
  const y = clamp(vertical === "down" ? anchor.y : anchor.y - size.height, margin, viewport.height - margin - size.height);
  const tail = { x: side === "right" ? x : x + size.width, y: clamp(anchor.y, y + 12, y + size.height - 12) };
  return { rect: { x, y, width: size.width, height: size.height }, tail, side, vertical };
}

/** Break a word wider than `maxWidth` (a URL, a file path) into pieces that each fit. */
function splitLongWord(word: string, maxWidth: number, measure: (s: string) => number): string[] {
  if (measure(word) <= maxWidth) return [word];
  const pieces: string[] = [];
  let piece = "";
  for (const ch of word) {
    if (piece && measure(piece + ch) > maxWidth) {
      pieces.push(piece);
      piece = ch;
    } else {
      piece += ch;
    }
  }
  if (piece) pieces.push(piece);
  return pieces;
}

/** Greedy word wrap; words wider than `maxWidth` are split so no line overflows. */
export function wrapText(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/).filter(Boolean)) {
    for (const piece of splitLongWord(word, maxWidth, measure)) {
      const candidate = line ? `${line} ${piece}` : piece;
      if (!line || measure(candidate) <= maxWidth) {
        line = candidate;
      } else {
        lines.push(line);
        line = piece;
      }
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Keep only the last `max` lines (the newest words of a streamed answer), marking the cut with an ellipsis. */
export function limitLines(lines: string[], max = BUBBLE_MAX_LINES): string[] {
  if (lines.length <= max) return lines;
  const kept = lines.slice(-max);
  return [`…${kept[0]}`, ...kept.slice(1)];
}

/** `text`, or as much of it as fits in `maxWidth` followed by an ellipsis. */
export function fitText(text: string, maxWidth: number, measure: (s: string) => number): string {
  if (measure(text) <= maxWidth) return text;
  let end = text.length;
  while (end > 0 && measure(`${text.slice(0, end)}…`) > maxWidth) end--;
  return `${text.slice(0, end).trimEnd()}…`;
}

export function measureBubble(lines: string[], measure: (s: string) => number): Size {
  const textWidth = lines.reduce((w, line) => Math.max(w, measure(line)), 0);
  return {
    width: Math.ceil(textWidth) + 2 * BUBBLE_PADDING.x,
    height: lines.length * BUBBLE_LINE_HEIGHT + 2 * BUBBLE_PADDING.y,
  };
}

/** How long a bubble stays up: long enough to read, within sane bounds. */
export function bubbleVisibleMs(text: string): number {
  return clamp(1500 + 55 * text.length, 2500, 9000);
}

/** 0..1 opacity: quick fade-in, hold, fade-out at the end of its reading time. */
export function bubbleAlpha(shownAt: number, text: string, now: number): number {
  const t = now - shownAt;
  const total = bubbleVisibleMs(text);
  if (t < 0 || t >= total) return 0;
  return Math.min(1, t / BUBBLE_FADE_IN_MS, (total - t) / FADE_OUT_MS);
}

/** Rect for a label pill whose top-left wants to be at `topLeft`, nudged fully on screen. */
export function pillRect(topLeft: Vec, textWidth: number, viewport: Size, margin = EDGE_MARGIN): Rect {
  const width = Math.ceil(textWidth) + 2 * PILL_PADDING_X;
  return {
    x: clamp(topLeft.x, margin, viewport.width - margin - width),
    y: clamp(topLeft.y, margin, viewport.height - margin - PILL_HEIGHT),
    width,
    height: PILL_HEIGHT,
  };
}

/** Screen area Pixie's sprite (22 px arrowhead + glow) covers, given her tip. */
export function pixieBodyRect(tip: Vec): Rect {
  return { x: tip.x - 3, y: tip.y - 3, width: 30, height: 30 };
}

/**
 * Where the target label goes: the first candidate spot that is on screen and clear of everything in `avoid`
 * (Pixie's body, the speech bubble). Prefers just below Pixie; falls back to the first candidate if all collide.
 */
export function placeLabel(tip: Vec, textWidth: number, viewport: Size, avoid: Rect[]): Rect {
  const width = Math.ceil(textWidth) + 2 * PILL_PADDING_X;
  const below = tip.y + 30;
  const above = tip.y - 12 - PILL_HEIGHT;
  const belowAll = Math.max(...avoid.map((a) => a.y + a.height)) + 6;
  const aboveAll = Math.min(...avoid.map((a) => a.y)) - 6 - PILL_HEIGHT;
  const candidates: Vec[] = [
    { x: tip.x - 4, y: below },
    { x: tip.x + 26 - width, y: below },
    { x: tip.x - 4, y: above },
    { x: tip.x + 26 - width, y: above },
    { x: tip.x - 10 - width, y: tip.y + 4 },
    { x: tip.x + 34, y: tip.y + 4 },
    // Corners: clear the whole cluster of Pixie + bubble.
    { x: tip.x - 4, y: belowAll },
    { x: tip.x - 4, y: aboveAll },
  ];
  const rects = candidates.map((c) => pillRect(c, textWidth, viewport));
  return rects.find((r) => !avoid.some((a) => intersects(r, a))) ?? rects[0];
}

export function drawBubble(ctx: CanvasRenderingContext2D, layout: BubbleLayout, lines: string[], alpha: number): void {
  const { rect, tail, side } = layout;
  const dir = side === "right" ? -1 : 1;
  const shape = () => {
    ctx.beginPath();
    ctx.roundRect(rect.x, rect.y, rect.width, rect.height, 12);
    ctx.moveTo(tail.x, tail.y - 7);
    ctx.lineTo(tail.x + dir * 10, tail.y);
    ctx.lineTo(tail.x, tail.y + 7);
    ctx.closePath();
  };
  ctx.save();
  ctx.globalAlpha = alpha;
  // 1) body + soft shadow, 2) outline, 3) body again without shadow: hides the seam where tail meets bubble.
  shape();
  ctx.shadowColor = "rgba(20, 10, 60, 0.25)";
  ctx.shadowBlur = 16;
  ctx.shadowOffsetY = 4;
  ctx.fillStyle = "rgba(255, 255, 255, 0.97)";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#7c5cff";
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = "#1b1530";
  ctx.font = BUBBLE_FONT;
  ctx.textBaseline = "top";
  lines.forEach((line, i) => {
    ctx.fillText(line, rect.x + BUBBLE_PADDING.x, rect.y + BUBBLE_PADDING.y + i * BUBBLE_LINE_HEIGHT + 2);
  });
  ctx.restore();
}

export function drawPill(ctx: CanvasRenderingContext2D, rect: Rect, text: string): void {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(rect.x, rect.y, rect.width, rect.height, rect.height / 2);
  ctx.fillStyle = "#7c5cff";
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.font = PILL_FONT;
  ctx.textBaseline = "middle";
  ctx.fillText(text, rect.x + PILL_PADDING_X, rect.y + rect.height / 2 + 0.5);
  ctx.restore();
}
