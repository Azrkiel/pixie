import { describe, expect, it } from "vitest";
import { initialState } from "../src/renderer/behavior";
import { bubbleAlpha } from "../src/renderer/bubble";
import { TTL_MS } from "../src/renderer/annotations";
import { MAX_ANNOTATIONS, applyStage, tickStage, type StageState } from "../src/renderer/stage";
import type { PixieAction } from "../src/shared/actions";
import type { StageCommand } from "../src/shared/ipc";

const ENV = { viewport: { width: 1536, height: 863 }, display: { width: 1536, height: 864 } };
const FRAME = { imageWidth: 1920, imageHeight: 1080 };
const fresh = (): StageState => ({ behavior: initialState({ x: 100, y: 100 }, 0), annotations: [], nextAnnotationId: 1, bubble: null });
const act = (action: PixieAction): StageCommand => ({ kind: "action", frame: FRAME, action });

describe("applyStage", () => {
  it("maps a point from screenshot pixels onto the display, not the 1 px-shorter overlay", () => {
    const s = applyStage(fresh(), act({ type: "point", x: 960, y: 540, label: "Save" }), 0, ENV);
    expect(s.behavior.mode).toBe("flying");
    expect(s.behavior.target).toEqual({ x: 768, y: 432 });
    expect(s.behavior.label).toBe("Save");
  });

  it("converts drawings to overlay px, radii included", () => {
    const s = applyStage(fresh(), act({ type: "circle", x: 960, y: 540, r: 70 }), 0, ENV);
    expect(s.annotations[0].shape).toEqual({ kind: "circle", center: { x: 768, y: 432 }, r: 56 });
  });

  it("keeps at most MAX_ANNOTATIONS drawings, dropping the oldest", () => {
    let s = fresh();
    for (let i = 0; i < MAX_ANNOTATIONS + 5; i++) s = applyStage(s, act({ type: "underline", x: 0, y: i, w: 10 }), 0, ENV);
    expect(s.annotations).toHaveLength(MAX_ANNOTATIONS);
    expect(s.annotations[0].id).toBe(6);
  });

  it("clear fades out every drawing", () => {
    const drawn = applyStage(fresh(), act({ type: "box", x: 0, y: 0, w: 50, h: 50 }), 0, ENV);
    expect(applyStage(drawn, act({ type: "clear" }), 500, ENV).annotations[0].clearedAt).toBe(500);
  });

  it("fades speech in, and hides it on blank text", () => {
    const shown = applyStage(fresh(), { kind: "say", text: "  hello  " }, 1000, ENV);
    expect(shown.bubble).toEqual({ text: "hello", shownAt: 1000 });
    expect(bubbleAlpha(1000, "hello", 1000)).toBe(0);
    expect(applyStage(shown, { kind: "say", text: "   " }, 1100, ENV).bubble).toBeNull();
  });

  it("updates a visible bubble without restarting its fade-in (streamed text must not blink)", () => {
    const shown = applyStage(fresh(), { kind: "say", text: "hello" }, 1000, ENV);
    const updated = applyStage(shown, { kind: "say", text: "hello there" }, 2000, ENV);
    expect(bubbleAlpha(updated.bubble!.shownAt, updated.bubble!.text, 2000)).toBe(1);
  });

  it("release sends Pixie home while she is pointing or flying", () => {
    const flying = applyStage(fresh(), act({ type: "point", x: 960, y: 540 }), 0, ENV);
    expect(applyStage(flying, { kind: "release" }, 100, ENV).behavior.mode).toBe("returning");
  });
});

describe("tickStage", () => {
  it("drops the bubble exactly when its reading time is over", () => {
    const shown = applyStage(fresh(), { kind: "say", text: "hi" }, 1000, ENV); // visible for 2500 ms
    expect(tickStage(shown, 0.016, 1000 + 2499, ENV).bubble).not.toBeNull();
    expect(tickStage(shown, 0.016, 1000 + 2500, ENV).bubble).toBeNull();
  });

  it("prunes drawings whose time is up", () => {
    const drawn = applyStage(fresh(), act({ type: "underline", x: 0, y: 0, w: 10 }), 0, ENV);
    expect(tickStage(drawn, 0.016, 1000, ENV).annotations).toHaveLength(1);
    expect(tickStage(drawn, 0.016, TTL_MS, ENV).annotations).toHaveLength(0);
  });

  it("advances motion: a flight lands and Pixie starts pointing", () => {
    let s = applyStage(fresh(), act({ type: "point", x: 960, y: 540 }), 0, ENV);
    for (let now = 16; now <= 1200; now += 16) s = tickStage(s, 0.016, now, ENV);
    expect(s.behavior.mode).toBe("pointing");
  });
});
