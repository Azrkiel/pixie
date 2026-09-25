import { describe, expect, it } from "vitest";
import {
  BUBBLE_GAP,
  BUBBLE_MAX_TEXT_WIDTH,
  EDGE_MARGIN,
  PILL_HEIGHT,
  bubbleAlpha,
  bubbleVisibleMs,
  fitText,
  layoutBubble,
  limitLines,
  measureBubble,
  pillRect,
  pixieBodyRect,
  placeLabel,
  wrapText,
} from "../src/renderer/bubble";
import { intersects } from "../src/shared/geometry";

const VIEW = { width: 1536, height: 863 };
const SIZE = { width: 240, height: 80 };

function expectOnScreen(rect: { x: number; y: number; width: number; height: number }) {
  expect(rect.x).toBeGreaterThanOrEqual(EDGE_MARGIN);
  expect(rect.y).toBeGreaterThanOrEqual(EDGE_MARGIN);
  expect(rect.x + rect.width).toBeLessThanOrEqual(VIEW.width - EDGE_MARGIN);
  expect(rect.y + rect.height).toBeLessThanOrEqual(VIEW.height - EDGE_MARGIN);
}

describe("layoutBubble", () => {
  it("sits to the right of Pixie, level with her tip, when there is room", () => {
    const l = layoutBubble({ x: 700, y: 400 }, SIZE, VIEW);
    expect(l.side).toBe("right");
    expect(l.vertical).toBe("down");
    expect(l.rect).toEqual({ x: 700 + BUBBLE_GAP, y: 400, width: 240, height: 80 });
  });

  it("flips to the left near the right edge", () => {
    const l = layoutBubble({ x: 1450, y: 400 }, SIZE, VIEW);
    expect(l.side).toBe("left");
    expect(l.rect.x).toBe(1450 - BUBBLE_GAP - 240);
    expect(l.tail.x).toBe(l.rect.x + l.rect.width);
  });

  it("flips above near the bottom edge", () => {
    const l = layoutBubble({ x: 700, y: 820 }, SIZE, VIEW);
    expect(l.vertical).toBe("up");
    expect(l.rect.y).toBe(740);
  });

  it("never clips in any corner", () => {
    const corners = [
      { x: 0, y: 0 },
      { x: VIEW.width, y: 0 },
      { x: 0, y: VIEW.height },
      { x: VIEW.width, y: VIEW.height },
    ];
    for (const c of corners) expectOnScreen(layoutBubble(c, SIZE, VIEW).rect);
  });

  it("keeps the tail on the bubble's edge, within its height", () => {
    const l = layoutBubble({ x: 700, y: 400 }, SIZE, VIEW);
    expect(l.tail.x).toBe(l.rect.x);
    expect(l.tail.y).toBeGreaterThanOrEqual(l.rect.y);
    expect(l.tail.y).toBeLessThanOrEqual(l.rect.y + l.rect.height);
  });
});

describe("wrapText", () => {
  const measure = (s: string) => s.length * 10; // 10 px per character

  it("wraps at word boundaries within the width", () => {
    expect(wrapText("hello world foo", 110, measure)).toEqual(["hello world", "foo"]);
  });

  it("splits a word wider than the bubble (a URL, a path) so no line overflows", () => {
    expect(wrapText("a supercalifragilistic b", 100, measure)).toEqual(["a", "supercalif", "ragilistic", "b"]);
  });

  it("returns no lines for empty text", () => {
    expect(wrapText("   ", 100, measure)).toEqual([]);
  });
});

describe("text limits", () => {
  const measure = (s: string) => s.length * 10;

  it("keeps only the newest lines of a long answer", () => {
    expect(limitLines(["one", "two", "three", "four"], 2)).toEqual(["…three", "four"]);
    expect(limitLines(["one", "two"], 2)).toEqual(["one", "two"]);
  });

  it("cuts a long label with an ellipsis", () => {
    expect(fitText("hello world", 50, measure)).toBe("hell…");
    expect(fitText("hi", 50, measure)).toBe("hi");
  });

  it("keeps a bubble of any text on screen, even in a corner", () => {
    const text = `${"word ".repeat(400)}https://example.com/${"x".repeat(300)}`;
    const size = measureBubble(limitLines(wrapText(text, BUBBLE_MAX_TEXT_WIDTH, measure)), measure);
    expectOnScreen(layoutBubble({ x: VIEW.width, y: VIEW.height }, size, VIEW).rect);
  });
});

describe("measureBubble", () => {
  it("fits the widest line plus padding", () => {
    expect(measureBubble(["abc", "abcdef"], (s) => s.length * 10)).toEqual({ width: 60 + 28, height: 2 * 21 + 20 });
  });
});

describe("bubble timing", () => {
  it("shows short text for at least 2.5 s and long text for at most 9 s", () => {
    expect(bubbleVisibleMs("hi")).toBe(2500);
    expect(bubbleVisibleMs("x".repeat(60))).toBe(4800);
    expect(bubbleVisibleMs("x".repeat(500))).toBe(9000);
  });

  it("fades in, holds, and fades out", () => {
    const text = "hi"; // visible for 2500 ms
    expect(bubbleAlpha(1000, text, 1000)).toBe(0);
    expect(bubbleAlpha(1000, text, 1075)).toBeCloseTo(0.5, 9);
    expect(bubbleAlpha(1000, text, 2000)).toBe(1);
    expect(bubbleAlpha(1000, text, 1000 + 2500 - 125)).toBeCloseTo(0.5, 9);
    expect(bubbleAlpha(1000, text, 1000 + 2500)).toBe(0);
  });
});

describe("placeLabel", () => {
  const LABEL_TEXT_WIDTH = 80;

  it("sits just below Pixie when there is room", () => {
    const tip = { x: 700, y: 400 };
    expect(placeLabel(tip, LABEL_TEXT_WIDTH, VIEW, [pixieBodyRect(tip)])).toEqual({ x: 696, y: 430, width: 98, height: PILL_HEIGHT });
  });

  it("never covers Pixie or her speech bubble, anywhere on screen", () => {
    for (let x = 0; x <= VIEW.width; x += 48) {
      for (let y = 0; y <= VIEW.height; y += 48) {
        const tip = { x, y };
        const avoid = [pixieBodyRect(tip), layoutBubble(tip, SIZE, VIEW).rect];
        const label = placeLabel(tip, LABEL_TEXT_WIDTH, VIEW, avoid);
        expectOnScreen(label);
        for (const a of avoid) expect(intersects(label, a), `tip (${x}, ${y})`).toBe(false);
      }
    }
  });
});

describe("pillRect", () => {
  it("is pushed back on screen at the edges", () => {
    const r = pillRect({ x: 1520, y: 850 }, 80, VIEW);
    expect(r.height).toBe(PILL_HEIGHT);
    expectOnScreen(r);
  });
});
