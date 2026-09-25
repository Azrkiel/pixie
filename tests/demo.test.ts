import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playTour, type StageTarget, type TourStep } from "../src/main/demo";
import { TOUR, TOUR_FRAME, TOUR_RESET } from "../src/main/demo-tour";
import { IPC } from "../src/shared/ipc";

function fakeWindow(destroyed = false) {
  const sent: Array<[string, unknown]> = [];
  const target: StageTarget = {
    isDestroyed: () => destroyed,
    webContents: { send: (channel: string, payload: unknown) => void sent.push([channel, payload]) },
  };
  return { sent, target };
}

const STEPS: TourStep[] = [
  { afterMs: 0, command: { kind: "say", text: "hi" } },
  { afterMs: 500, command: { kind: "release" } },
  { afterMs: 250, command: { kind: "say", text: "bye" } },
];

describe("playTour", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("sends each command on the stage channel at its cumulative time", () => {
    const { sent, target } = fakeWindow();
    playTour(target, STEPS);
    vi.advanceTimersByTime(1);
    expect(sent).toEqual([[IPC.stage, STEPS[0].command]]);
    vi.advanceTimersByTime(498); // t = 499
    expect(sent).toHaveLength(1);
    vi.advanceTimersByTime(1); // t = 500
    expect(sent).toHaveLength(2);
    vi.advanceTimersByTime(250); // t = 750
    expect(sent.map(([, command]) => command)).toEqual(STEPS.map((s) => s.command));
  });

  it("stops the remaining steps when cancelled", () => {
    const { sent, target } = fakeWindow();
    const cancel = playTour(target, STEPS);
    vi.advanceTimersByTime(100);
    cancel();
    vi.advanceTimersByTime(10_000);
    expect(sent).toHaveLength(1);
  });

  it("sends nothing once the window is destroyed", () => {
    const { sent, target } = fakeWindow(true);
    playTour(target, STEPS);
    vi.advanceTimersByTime(10_000);
    expect(sent).toEqual([]);
  });
});

describe("TOUR", () => {
  it("keeps every coordinate on the 1920x1080 frame and ends by flying home", () => {
    const inFrame = (x: number, y: number) => x >= 0 && x <= TOUR_FRAME.imageWidth && y >= 0 && y <= TOUR_FRAME.imageHeight;
    for (const { afterMs, command } of TOUR) {
      expect(afterMs).toBeGreaterThanOrEqual(0);
      if (command.kind !== "action") continue;
      const a = command.action;
      if (a.type === "arrow") expect(inFrame(a.x1, a.y1) && inFrame(a.x2, a.y2)).toBe(true);
      else if (a.type === "box") expect(inFrame(a.x, a.y) && inFrame(a.x + a.w, a.y + a.h)).toBe(true);
      else if (a.type === "underline") expect(inFrame(a.x, a.y) && inFrame(a.x + a.w, a.y)).toBe(true);
      else if (a.type !== "clear") expect(inFrame(a.x, a.y)).toBe(true);
    }
    expect(TOUR[TOUR.length - 1].command).toEqual({ kind: "release" });
  });

  it("is preceded on restart by a reset that clears drawings and hides the bubble at once", () => {
    expect(TOUR_RESET).toEqual([
      { afterMs: 0, command: { kind: "action", frame: TOUR_FRAME, action: { type: "clear" } } },
      { afterMs: 0, command: { kind: "say", text: "" } },
    ]);
  });
});
