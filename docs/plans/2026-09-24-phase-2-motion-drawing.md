# Phase 2 — Motion & Drawing Engine: Implementation Plan

> **For the implementer:** assume zero context. This phase is built by **parallel lanes** (PLAN.md §9).
> The Lead does Task 0, sets up worktrees, and dispatches Lanes A, B and C at the same time. Each lane agent works
> **only** in its own worktree and **only** on the files its lane owns. When all three are green, the Lead merges and
> does Tasks L1–L4. Run commands in **PowerShell**. Roadmap: [`../../PLAN.md`](../../PLAN.md) §8 Phase 2.

**Goal:** Pixie can fly to any point in smooth arcs, point with her tip exactly on target, draw hand-drawn circles, boxes, arrows, underlines and notes, and talk in speech bubbles that never leave the screen. A scripted tour (`Ctrl+Alt+D`, debug builds) shows it all at 60 fps, with no AI yet.

**Architecture:**
- The overlay receives an ordered stream of `StageCommand`s (`action` / `say` / `release`) on one IPC channel.
- A **pure behaviour reducer** owns Pixie's motion (spring follow, Bézier flights, pointing, returning).
- Pure geometry modules lay out annotations, bubbles and labels.
- The renderer only wires these together and paints a canvas.
- Every coordinate in a command is in *screenshot pixels* and is mapped once, in `coords.ts`.

**Tech stack:** unchanged from Phase 1: Electron 44 · TypeScript 7 · esbuild · Vitest 5.

**Pre-verified (2026-09-24):**
- This exact code was type-checked, unit-tested (**71/71**) and bundled in a scratch clone.
- Every intermediate state was simulated and gated: contracts-only, each lane alone, and merged.
- The tour ran on this machine at **60 fps with 0 slow frames** while animating.
- Screenshots confirmed that the tip lands on target at 125 % scaling, bubbles and labels stay on screen, and labels never cover Pixie or her bubble.
- That run found and fixed three bugs: labels covered Pixie at the bottom edge, labels overlapped bubbles near the right edge, and there was a 100 ms first-text hitch.
- A **plan-reviewer agent** then found five more issues, fixed here:
  - rotation snapped up to 180° at take-off and landing (now blended, with a continuity test)
  - long text could overflow bubbles and pills (now split, capped at 6 lines, ellipsized)
  - streamed `say` updates re-ran the fade-in and blinked (now a pure, tested `stage.ts`)
  - a restarted tour piled up drawings (now `TOUR_RESET`)
  - the capturable flag leaked into later runs (now removed after L3)

---

## Flows

### Stage command → pixels (with failure branches)

```
main process (Phase 2: demo tour; Phase 3: the Conductor)
      |  IPC "pixie:stage"  StageCommand, in order
      v
renderer applyStage(state, command)       (pure, src/renderer/stage.ts)
      |-- say "text" ------> bubble = {text (trimmed), shownAt}   (blank text hides it; reading time 2.5-9 s, then fades;
      |                      already showing -> text swaps with NO fade-in restart, so streamed updates don't blink)
      |-- release ---------> behaviour: pointing/flying -> returning   (ignored in any other mode)
      |-- action clear ----> every annotation fades out over 250 ms
      |-- action point ----> imageToLocal(x, y) -> behaviour "point" -> planFlight(from = current tip)
      |-- action circle/box/arrow/underline/note
      |                  --> imageToLocal (+ imageLengthToLocal for r) -> Shape -> createAnnotation (seeded wobble)
      |                      (at most 24 drawings; the oldest are dropped)
      v
every frame (performance.now clock):
  behaviour tick ---> follow/idle: spring toward cursor+offset (idle after 2 s still)
                 ---> flying: when the flight is done -> pointing (tip == target exactly)
                 ---> pointing: after 6 s with no new point/release -> returning
                 ---> returning: when done -> follow (or idle if the mouse is still)
  prune annotations whose alpha hit 0
  paint: annotations -> Pixie -> label (placeLabel avoids Pixie + bubble) -> bubble (layoutBubble flips at edges)

Failure / edge branches:
  - a new point arrives mid-flight -> re-plan from the CURRENT tip (no teleport)
  - take-off / landing -> rotation turns over 180 ms and settles over 300 ms (never more than ~20 degrees in one frame)
  - long text / a URL -> words split to fit, the bubble keeps its last 6 lines, labels and notes cut at 320 px with "..."
  - Ctrl+Alt+D pressed again -> cancel the old tour, clear drawings, hide the bubble, start over
  - a zero-length flight -> no NaN, no spin
  - a frame stalls (sleep, debugger) -> the spring clamps dt at 0.1 s
  - a target near an edge -> the arc's control points are clamped on screen; the bubble flips left/up; the label tries 8 spots
  - a screenshot taken at a different size (e.g. 4K downsized to 2576 px) -> imageToLocal scales by Frame size
```

### Build orchestration for this phase

```
[Lead] Task 0: contracts (geometry, actions, ipc, preload) --> commit on master
   |
   +--> worktree phase2/lane-a: coords.ts + demo player + tour ---------+
   +--> worktree phase2/lane-b: bubble.ts + annotations.ts -------------+  (parallel, no shared files,
   +--> worktree phase2/lane-c: flight.ts + behavior.ts ----------------+   no cross-lane imports)
                                                                        |
   each lane: typecheck + tests green, else 3 fix attempts, then STOP and report
                                                                        v
[Lead] L1 merge A, B, C (gate after each) -> L2 integration (stage.ts, frame stats, overlay flags, main wiring, renderer)
       -> L3 scripted acceptance (Lead drives the tour + captures) -> review swarm -> L4 your eyes -> tag phase-2
```

## File map

| File | Owner | Responsibility |
|---|---|---|
| `src/shared/geometry.ts` | **Lead (contract)** | + `Size`, `clamp`, `intersects` |
| `src/shared/actions.ts` | **Lead (contract)** | `Frame`, `PixieAction` union (PLAN §6 tags) |
| `src/shared/ipc.ts` | **Lead (contract)** | + `stage` channel, `StageCommand`, `onStage` |
| `src/preload/preload.ts` | **Lead (contract)** | exposes `onStage` |
| `tests/geometry.test.ts` | Lead | clamp, intersects |
| `src/shared/coords.ts` | Lane A | + `imageToLocal`, `localToImage`, `imageLengthToLocal` |
| `src/main/demo.ts` | Lane A | `playTour`: schedules stage commands, cancellable |
| `src/main/demo-tour.ts` | Lane A | the scripted tour (typed, not JSON, so the compiler checks it) |
| `tests/coords.test.ts`, `tests/demo.test.ts` | Lane A | |
| `src/renderer/bubble.ts` | Lane B | speech bubble + label layout (pure) and drawing |
| `src/renderer/annotations.ts` | Lane B | hand-drawn shapes (seeded), lifecycle, drawing |
| `tests/bubble.test.ts`, `tests/annotations.test.ts` | Lane B | |
| `src/shared/flight.ts` | Lane C | Bézier flight planning and sampling |
| `src/renderer/behavior.ts` | Lane C | the behaviour reducer (PLAN §5.2, Phase 2 subset) |
| `tests/flight.test.ts`, `tests/behavior.test.ts` | Lane C | |
| `src/renderer/stage.ts` + test | Lead (L2) | pure `applyStage`: command → state (the seam Phase 3's Conductor drives) |
| `src/renderer/frame-stats.ts` + test | Lead (L2) | debug frame-time summary |
| `src/main/overlay-window.ts`, `src/main/main.ts` | Lead (L2) | debug/capturable flags, `Ctrl+Alt+D`, renderer console → terminal |
| `src/renderer/main.ts` | Lead (L2) | wires everything; paints the frame |

**Deviations from PLAN.md §8/§9.4, decided while planning:**
- `flight.ts` moved from Lane A to Lane C, because `behavior.ts` imports it and lanes must not depend on each other. The demo player moved to Lane A to balance the load.
- The tour is `src/main/demo-tour.ts`, not `demos/tour.json`, so it is type-checked.
- `Frame.displayId` is deferred to Phase 6 (multi-monitor routing happens in main).
- `clampToRect` is dropped (YAGNI).
- New dev flags: `PIXIE_CAPTURABLE=1` and debug frame stats. Without seeing your screen, Claude needs these to verify drawing.

---

## Task 0 (Lead): contracts, then worktrees

- [ ] **Step 0: Commit the plan docs on their own**, so the contracts commit holds only code

```powershell
git add PLAN.md docs/plans/2026-09-24-phase-2-motion-drawing.md
git commit -m "docs: phase 2 plan (reviewed)"
```

- [ ] **Step 1: Replace `src/shared/geometry.ts`**

```ts
export interface Vec {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** True when two rects overlap by any area (touching edges don't count). */
export function intersects(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/** Clamp `v` into [lo, hi]. If the range is empty (lo > hi), `lo` wins. */
export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(v, hi));
}
```

- [ ] **Step 2: Create `tests/geometry.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { clamp, intersects } from "../src/shared/geometry";

describe("intersects", () => {
  const a = { x: 0, y: 0, width: 10, height: 10 };

  it("detects overlapping rects", () => {
    expect(intersects(a, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it("treats touching or separate rects as not overlapping", () => {
    expect(intersects(a, { x: 10, y: 0, width: 5, height: 5 })).toBe(false);
    expect(intersects(a, { x: 50, y: 50, width: 5, height: 5 })).toBe(false);
  });
});

describe("clamp", () => {
  it("keeps values that are already inside the range", () => {
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it("clips to the nearest bound", () => {
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });

  it("prefers the lower bound when the range is empty", () => {
    expect(clamp(5, 8, 2)).toBe(8);
  });
});
```

- [ ] **Step 3: Create `src/shared/actions.ts`**

```ts
/** The screenshot an action's coordinates refer to. Every action coordinate is in this image's pixels. */
export interface Frame {
  imageWidth: number;
  imageHeight: number;
}

/** Everything Pixie can do on screen. Mirrors the inline tag grammar in PLAN.md section 6. */
export type PixieAction =
  | { type: "point"; x: number; y: number; label?: string }
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "box"; x: number; y: number; w: number; h: number }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "underline"; x: number; y: number; w: number }
  | { type: "note"; x: number; y: number; text: string }
  | { type: "clear" };
```

- [ ] **Step 4: Replace `src/shared/ipc.ts`**

```ts
import type { Frame, PixieAction } from "./actions";

export const IPC = {
  cursor: "pixie:cursor",
  stage: "pixie:stage",
} as const;

/** Cursor position in overlay-window-local CSS px. */
export interface CursorSample {
  x: number;
  y: number;
  t: number;
}

/** One ordered instruction for the overlay: do an action, show speech, or fly back to the cursor. */
export type StageCommand =
  | { kind: "action"; frame: Frame; action: PixieAction }
  | { kind: "say"; text: string }
  | { kind: "release" };

/** What the preload exposes to the overlay renderer as `window.pixie`. */
export interface PixieBridge {
  onCursor(cb: (s: CursorSample) => void): void;
  onStage(cb: (c: StageCommand) => void): void;
}
```

- [ ] **Step 5: Replace `src/preload/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type CursorSample, type PixieBridge, type StageCommand } from "../shared/ipc";

const bridge: PixieBridge = {
  onCursor(cb) {
    ipcRenderer.on(IPC.cursor, (_event, s: CursorSample) => cb(s));
  },
  onStage(cb) {
    ipcRenderer.on(IPC.stage, (_event, c: StageCommand) => cb(c));
  },
};

contextBridge.exposeInMainWorld("pixie", bridge);
```

- [ ] **Step 6: Gate, then commit**

```powershell
npm run typecheck
npm test
```
Expected: typecheck clean. `Test Files  3 passed (3)`, `Tests  10 passed (10)` (spring 3, coords 2, geometry 5).
The renderer still compiles because it only uses `onCursor`.

```powershell
git add src/shared/geometry.ts tests/geometry.test.ts src/shared/actions.ts src/shared/ipc.ts src/preload/preload.ts
git commit -m "feat(contracts): phase 2 stage commands, actions, geometry helpers"
```

- [ ] **Step 7: Create one worktree per lane, each with its own `node_modules`**

```powershell
foreach ($lane in "a", "b", "c") {
  $wt = "$env:TEMP\pixie-lanes\phase2-lane-$lane"
  git worktree add $wt -b "phase2/lane-$lane"
  if ($LASTEXITCODE -ne 0) { throw "worktree for lane $lane failed" }
  Push-Location $wt; npm ci --no-audit --no-fund; $code = $LASTEXITCODE; Pop-Location
  if ($code -ne 0) { throw "npm ci failed in lane $lane" }
}
git worktree list
```
Expected: three extra worktrees on branches `phase2/lane-a`, `-b`, `-c`, all at the contracts commit.

- [ ] **Step 8: Dispatch the three lane agents in parallel.** Give each: this plan's path, its lane section, its worktree
  path, the owned-file list from the File map, and the rules in PLAN.md §9.3. Rules: TDD every step, commit on the lane
  branch, touch nothing else, 3 fix attempts per failure then STOP and report.

---

## Lane A: coordinates + demo player (worktree `phase2-lane-a`)

**Owns:** `src/shared/coords.ts`, `tests/coords.test.ts`, `src/main/demo.ts`, `src/main/demo-tour.ts`, `tests/demo.test.ts`.

### Task A1: screenshot ↔ overlay mapping

- [ ] **Step 1: Replace `tests/coords.test.ts`** (the Phase 1 tests are kept; new ones are added)

```ts
import { describe, expect, it } from "vitest";
import { imageLengthToLocal, imageToLocal, localToImage, screenToLocal } from "../src/shared/coords";

describe("screenToLocal", () => {
  it("is identity on a primary display at the origin", () => {
    expect(screenToLocal({ x: 300, y: 200 }, { x: 0, y: 0, width: 1536, height: 864 })).toEqual({ x: 300, y: 200 });
  });

  it("handles a monitor left of the primary (negative origin)", () => {
    expect(screenToLocal({ x: -1800, y: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 120, y: 100 });
  });
});

const FRAME = { imageWidth: 1920, imageHeight: 1080 };
const DISPLAY = { width: 1536, height: 864 };

describe("imageToLocal", () => {
  it("maps screenshot pixels to CSS px at 125 % scaling", () => {
    expect(imageToLocal({ x: 960, y: 540 }, FRAME, DISPLAY)).toEqual({ x: 768, y: 432 });
    expect(imageToLocal({ x: 1920, y: 1080 }, FRAME, DISPLAY)).toEqual({ x: 1536, y: 864 });
  });

  it("handles a 4K screenshot that was downsized to 2576 px", () => {
    // 3840x2160 physical at 150 % = 2560x1440 CSS px; sent to Claude as 2576x1449.
    expect(imageToLocal({ x: 1288, y: 724.5 }, { imageWidth: 2576, imageHeight: 1449 }, { width: 2560, height: 1440 })).toEqual({
      x: 1280,
      y: 720,
    });
  });

  it("round-trips through localToImage", () => {
    const p = { x: 1234, y: 567 };
    const back = localToImage(imageToLocal(p, FRAME, DISPLAY), FRAME, DISPLAY);
    expect(back.x).toBeCloseTo(p.x, 9);
    expect(back.y).toBeCloseTo(p.y, 9);
  });
});

describe("imageLengthToLocal", () => {
  it("scales radii and widths by the display factor", () => {
    expect(imageLengthToLocal(100, FRAME, DISPLAY)).toBe(80);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/coords.test.ts`
  Expected: FAIL. `imageToLocal`, `localToImage` and `imageLengthToLocal` are not exported yet (a `TypeError ... is not a function`, or the import fails).

- [ ] **Step 3: Replace `src/shared/coords.ts`**

```ts
import type { Frame } from "./actions";
import type { Rect, Size, Vec } from "./geometry";

/** Global DIP point (Electron `screen` API) -> overlay-window-local CSS px. */
export function screenToLocal(p: Vec, displayBounds: Rect): Vec {
  return { x: p.x - displayBounds.x, y: p.y - displayBounds.y };
}

/**
 * Screenshot pixel (what Claude sees) -> overlay-local CSS px.
 * `display` is the display's size in CSS px (`window.screen`), NOT the overlay's: the overlay is 1 px shorter.
 */
export function imageToLocal(p: Vec, frame: Frame, display: Size): Vec {
  return { x: (p.x * display.width) / frame.imageWidth, y: (p.y * display.height) / frame.imageHeight };
}

/** Overlay-local CSS px -> screenshot pixel (inverse of `imageToLocal`). */
export function localToImage(p: Vec, frame: Frame, display: Size): Vec {
  return { x: (p.x * frame.imageWidth) / display.width, y: (p.y * frame.imageHeight) / display.height };
}

/** Screenshot-pixel length (radius, width) -> CSS px. Displays scale uniformly, so the x factor is used. */
export function imageLengthToLocal(length: number, frame: Frame, display: Size): number {
  return (length * display.width) / frame.imageWidth;
}
```

- [ ] **Step 4: Run it**: `npx vitest run tests/coords.test.ts`. Expected: `Tests  6 passed (6)`.
- [ ] **Step 5: Commit**: `git add -A; git commit -m "feat(coords): map screenshot pixels to overlay CSS px"`

### Task A2: tour player + the tour

- [ ] **Step 1: Create `tests/demo.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/demo.test.ts`
  Expected: FAIL with `Cannot find module '../src/main/demo'`.

- [ ] **Step 3: Create `src/main/demo.ts`**

```ts
import type { BrowserWindow } from "electron";
import { IPC, type StageCommand } from "../shared/ipc";

export interface TourStep {
  /** Delay after the previous step, in ms. */
  afterMs: number;
  command: StageCommand;
}

/** The slice of BrowserWindow the player needs, so it can be unit-tested with a fake. */
export interface StageTarget {
  isDestroyed(): boolean;
  webContents: Pick<BrowserWindow["webContents"], "send">;
}

/** Send each step's command to the overlay on schedule. Returns a function that cancels the remaining steps. */
export function playTour(target: StageTarget, steps: TourStep[]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let at = 0;
  for (const step of steps) {
    at += step.afterMs;
    timers.push(
      setTimeout(() => {
        if (!target.isDestroyed()) target.webContents.send(IPC.stage, step.command);
      }, at),
    );
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
```

- [ ] **Step 4: Create `src/main/demo-tour.ts`**

```ts
import type { Frame, PixieAction } from "../shared/actions";
import type { StageCommand } from "../shared/ipc";
import type { TourStep } from "./demo";

/** Tour coordinates are written for a 1920x1080 screenshot; the renderer maps them onto any display. */
export const TOUR_FRAME: Frame = { imageWidth: 1920, imageHeight: 1080 };

const act = (action: PixieAction): StageCommand => ({ kind: "action", frame: TOUR_FRAME, action });
const say = (text: string): StageCommand => ({ kind: "say", text });

/** Played before the tour so a restart doesn't pile new drawings and speech on top of the old ones. */
export const TOUR_RESET: TourStep[] = [
  { afterMs: 0, command: act({ type: "clear" }) },
  { afterMs: 0, command: say("") },
];

/** Ctrl+Alt+D (debug builds): every drawing primitive, every screen corner, the taskbar, then home. */
export const TOUR: TourStep[] = [
  { afterMs: 0, command: say("Hi, I'm Pixie! Here's what I can do.") },
  { afterMs: 1800, command: act({ type: "point", x: 960, y: 540, label: "center" }) },
  { afterMs: 1200, command: act({ type: "circle", x: 960, y: 540, r: 70 }) },
  { afterMs: 300, command: say("I can circle things,") },
  { afterMs: 1800, command: act({ type: "arrow", x1: 560, y1: 260, x2: 900, y2: 500 }) },
  { afterMs: 300, command: say("draw arrows,") },
  { afterMs: 1600, command: act({ type: "point", x: 1860, y: 60, label: "top-right" }) },
  { afterMs: 300, command: say("fly into corners without my bubble falling off the screen,") },
  { afterMs: 2600, command: act({ type: "point", x: 1780, y: 1050, label: "taskbar" }) },
  { afterMs: 900, command: act({ type: "box", x: 1580, y: 1022, w: 320, h: 52 }) },
  { afterMs: 300, command: say("highlight the taskbar,") },
  { afterMs: 2200, command: act({ type: "point", x: 80, y: 1000, label: "bottom-left" }) },
  { afterMs: 900, command: act({ type: "underline", x: 60, y: 1040, w: 360 }) },
  { afterMs: 300, command: say("underline things,") },
  { afterMs: 2000, command: act({ type: "point", x: 90, y: 90, label: "top-left" }) },
  { afterMs: 900, command: act({ type: "note", x: 130, y: 230, text: "and leave notes!" }) },
  { afterMs: 300, command: say("and leave notes. That's the tour!") },
  { afterMs: 2500, command: act({ type: "clear" }) },
  { afterMs: 300, command: { kind: "release" } },
];
```

- [ ] **Step 5: Run the lane gate**

```powershell
npm run typecheck
npm test
```
Expected: typecheck clean. `Test Files  4 passed (4)`, `Tests  19 passed (19)`.

- [ ] **Step 6: Commit**: `git add -A; git commit -m "feat(demo): scheduled stage-command tour player and scripted tour"`

---

## Lane B: speech bubble, labels, annotations (worktree `phase2-lane-b`)

**Owns:** `src/renderer/bubble.ts`, `tests/bubble.test.ts`, `src/renderer/annotations.ts`, `tests/annotations.test.ts`.

### Task B1: bubble + label layout

- [ ] **Step 1: Create `tests/bubble.test.ts`**

```ts
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
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/bubble.test.ts`
  Expected: FAIL with `Cannot find module '../src/renderer/bubble'`.

- [ ] **Step 3: Create `src/renderer/bubble.ts`**

```ts
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
```

- [ ] **Step 4: Run it**: `npx vitest run tests/bubble.test.ts`. Expected: `Tests  17 passed (17)`. That includes the
  screen sweep proving labels never cover Pixie or her bubble at ~630 tip positions, and the test that any text,
  even 400 words plus a 300-character URL, keeps the bubble on screen.
- [ ] **Step 5: Commit**: `git add -A; git commit -m "feat(bubble): edge-aware speech bubble and collision-free labels"`

### Task B2: hand-drawn annotations

- [ ] **Step 1: Create `tests/annotations.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  CLEAR_FADE_MS,
  DRAW_MS,
  TTL_MS,
  annotationVisual,
  arrowPath,
  boxPath,
  circlePath,
  clearAnnotations,
  createAnnotation,
  mulberry32,
  partialPolyline,
  pruneAnnotations,
  underlinePath,
  type Shape,
} from "../src/renderer/annotations";

describe("mulberry32", () => {
  it("is deterministic and stays in [0, 1)", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    for (let i = 0; i < 100; i++) {
      const v = a();
      expect(v).toBe(b());
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe("hand-drawn paths", () => {
  it("circle stays within 8 % of its radius and sweeps past a full turn", () => {
    const c = { x: 500, y: 300 };
    const r = 60;
    const pts = circlePath(c, r, mulberry32(1));
    for (const p of pts) expect(Math.abs(Math.hypot(p.x - c.x, p.y - c.y) - r)).toBeLessThanOrEqual(r * 0.08);
    let swept = 0;
    for (let i = 1; i < pts.length; i++) {
      let d = Math.atan2(pts[i].y - c.y, pts[i].x - c.x) - Math.atan2(pts[i - 1].y - c.y, pts[i - 1].x - c.x);
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      swept += d;
    }
    expect(swept).toBeGreaterThan(2 * Math.PI);
  });

  it("box passes within 4 px of every corner", () => {
    const pts = boxPath({ x: 100, y: 200, width: 300, height: 40 }, mulberry32(2));
    for (const [cx, cy] of [
      [100, 200],
      [400, 200],
      [400, 240],
      [100, 240],
    ]) {
      expect(Math.min(...pts.map((p) => Math.hypot(p.x - cx, p.y - cy)))).toBeLessThanOrEqual(4);
    }
  });

  it("arrow starts exactly at `from`, reaches `to`, and ends with a head", () => {
    const from = { x: 100, y: 100 };
    const to = { x: 400, y: 250 };
    const pts = arrowPath(from, to, mulberry32(3));
    expect(pts[0]).toEqual(from);
    expect(pts).toContainEqual(to);
    for (const wing of [pts[pts.length - 3], pts[pts.length - 1]]) {
      const d = Math.hypot(wing.x - to.x, wing.y - to.y);
      expect(d).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(d).toBeLessThanOrEqual(18 + 1e-9);
    }
  });

  it("underline starts and ends exactly on its endpoints", () => {
    const pts = underlinePath({ x: 10, y: 50 }, { x: 310, y: 50 }, mulberry32(4));
    expect(pts[0]).toEqual({ x: 10, y: 50 });
    expect(pts[pts.length - 1]).toEqual({ x: 310, y: 50 });
  });

  it("the same id always produces the same shape", () => {
    const shape: Shape = { kind: "circle", center: { x: 10, y: 10 }, r: 30 };
    expect(createAnnotation(7, shape, 0).path).toEqual(createAnnotation(7, shape, 999).path);
  });
});

describe("annotation lifecycle", () => {
  const shape: Shape = { kind: "underline", from: { x: 0, y: 0 }, to: { x: 100, y: 0 } };

  it("strokes on over DRAW_MS", () => {
    const a = createAnnotation(1, shape, 1000);
    expect(annotationVisual(a, 1000).draw).toBe(0);
    expect(annotationVisual(a, 1000 + DRAW_MS / 2).draw).toBeCloseTo(0.5, 9);
    expect(annotationVisual(a, 1000 + DRAW_MS).draw).toBe(1);
  });

  it("stays opaque, then is gone by its time-to-live", () => {
    const a = createAnnotation(1, shape, 0);
    expect(annotationVisual(a, 1000).alpha).toBe(1);
    expect(annotationVisual(a, TTL_MS).alpha).toBe(0);
    expect(pruneAnnotations([a], 1000)).toEqual([a]);
    expect(pruneAnnotations([a], TTL_MS)).toEqual([]);
  });

  it("clear fades everything out quickly", () => {
    const [a] = clearAnnotations([createAnnotation(1, shape, 0)], 2000);
    expect(annotationVisual(a, 2000).alpha).toBe(1);
    expect(annotationVisual(a, 2000 + CLEAR_FADE_MS).alpha).toBe(0);
  });
});

describe("partialPolyline", () => {
  const line = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];

  it("returns the first fraction of the path by length", () => {
    expect(partialPolyline(line, 0.25)).toEqual([
      { x: 0, y: 0 },
      { x: 5, y: 0 },
    ]);
    expect(partialPolyline(line, 0.75)).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 5 },
    ]);
  });

  it("returns just the start at 0 and everything at 1", () => {
    expect(partialPolyline(line, 0)).toEqual([{ x: 0, y: 0 }]);
    expect(partialPolyline(line, 1)).toEqual(line);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/annotations.test.ts`
  Expected: FAIL with `Cannot find module '../src/renderer/annotations'`.

- [ ] **Step 3: Create `src/renderer/annotations.ts`**

```ts
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
```

- [ ] **Step 4: Run the lane gate**

```powershell
npm run typecheck
npm test
```
Expected: typecheck clean. `Test Files  5 passed (5)`, `Tests  38 passed (38)`.

- [ ] **Step 5: Commit**: `git add -A; git commit -m "feat(annotations): seeded hand-drawn shapes with stroke-on and fade"`

---

## Lane C: flights + behaviour (worktree `phase2-lane-c`)

**Owns:** `src/shared/flight.ts`, `tests/flight.test.ts`, `src/renderer/behavior.ts`, `tests/behavior.test.ts`.

### Task C1: Bézier flights

- [ ] **Step 1: Create `tests/flight.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import { FLIGHT_MAX_MS, FLIGHT_MIN_MS, flightDuration, planFlight, sampleFlight } from "../src/shared/flight";

const VIEW = { width: 1536, height: 863 };

describe("flightDuration", () => {
  it("grows with distance, clamped between the min and max", () => {
    expect(flightDuration(0)).toBe(FLIGHT_MIN_MS);
    expect(flightDuration(1000)).toBe(850);
    expect(flightDuration(5000)).toBe(FLIGHT_MAX_MS);
  });
});

describe("planFlight + sampleFlight", () => {
  const from = { x: 200, y: 400 };
  const to = { x: 1200, y: 400 };
  const f = planFlight(from, to, 1000, VIEW);

  it("starts at `from` and lands exactly on `to`", () => {
    expect(sampleFlight(f, 1000).pos).toEqual(from);
    const end = sampleFlight(f, 1000 + f.durationMs);
    expect(end.pos).toEqual(to);
    expect(end.done).toBe(true);
    expect(sampleFlight(f, 1000 + f.durationMs / 2).done).toBe(false);
  });

  it("stays on the target after the flight is over", () => {
    expect(sampleFlight(f, 99_999).pos).toEqual(to);
  });

  it("points along the direction of travel", () => {
    // Left-to-right: the tangent at the midpoint of the symmetric arc is horizontal.
    expect(sampleFlight(f, 1000 + f.durationMs / 2).angle).toBeCloseTo(0, 9);
  });

  it("bows toward the middle of the screen and never leaves it", () => {
    const top = planFlight({ x: 100, y: 20 }, { x: 1400, y: 20 }, 0, VIEW);
    expect(sampleFlight(top, top.durationMs / 2).pos.y).toBeGreaterThan(20);
    for (let i = 0; i <= 50; i++) {
      const p = sampleFlight(top, (top.durationMs * i) / 50).pos;
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(VIEW.width);
    }
  });

  it("handles a zero-length flight without NaN", () => {
    const z = planFlight({ x: 50, y: 50 }, { x: 50, y: 50 }, 0, VIEW);
    const s = sampleFlight(z, z.durationMs / 2);
    expect(s.pos.x).toBeCloseTo(50, 9);
    expect(s.pos.y).toBeCloseTo(50, 9);
    expect(s.angle).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/flight.test.ts`
  Expected: FAIL with `Cannot find module '../src/shared/flight'`.

- [ ] **Step 3: Create `src/shared/flight.ts`**

```ts
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
```

- [ ] **Step 4: Run it**: `npx vitest run tests/flight.test.ts`. Expected: `Tests  6 passed (6)`.
- [ ] **Step 5: Commit**: `git add -A; git commit -m "feat(flight): arced Bezier flights that stay on screen"`

### Task C2: the behaviour reducer

- [ ] **Step 1: Create `tests/behavior.test.ts`**

```ts
import { describe, expect, it } from "vitest";
import {
  IDLE_AFTER_MS,
  POINT_HOLD_MS,
  SETTLE_MS,
  initialState,
  next,
  pixiePose,
  type BehaviorState,
} from "../src/renderer/behavior";

const VIEW = { width: 1536, height: 863 };
const at = (x: number, y: number) => ({ x, y });

/** Tick the reducer forward like a 60 fps render loop. */
function run(s: BehaviorState, from: number, ms: number, stepMs = 16) {
  let now = from;
  let state = s;
  while (now < from + ms) {
    now += stepMs;
    state = next(state, { type: "tick", dtSec: stepMs / 1000 }, now, VIEW);
  }
  return { s: state, now };
}

/** Point at `target` from a fresh state and tick until Pixie has landed. */
function landedAt(target = at(900, 500)) {
  const s = next(initialState(at(100, 100), 0), { type: "point", target, label: "Save" }, 0, VIEW);
  return run(s, 0, 1200);
}

describe("behavior reducer", () => {
  it("starts following just below-right of the cursor", () => {
    const s = initialState(at(100, 100), 0);
    expect(s.mode).toBe("follow");
    expect(pixiePose(s, 0).tip).toEqual(at(118, 122));
  });

  it("goes idle without input and wakes on the next cursor move", () => {
    const idle = run(initialState(at(100, 100), 0), 0, IDLE_AFTER_MS + 100);
    expect(idle.s.mode).toBe("idle");
    expect(next(idle.s, { type: "cursor", at: at(300, 300) }, idle.now, VIEW).mode).toBe("follow");
  });

  it("flies to a point and lands with the tip exactly on the target", () => {
    const { s, now } = landedAt();
    expect(s.mode).toBe("pointing");
    expect(s.label).toBe("Save");
    expect(pixiePose(s, now).tip).toEqual(at(900, 500));
  });

  it("rotates back to rest within SETTLE_MS of landing", () => {
    const { s } = landedAt();
    expect(pixiePose(s, s.since + SETTLE_MS).angle).toBeCloseTo(0, 9);
  });

  it("flies home on release and lands back beside the cursor", () => {
    const landed = landedAt();
    const released = next(landed.s, { type: "release" }, landed.now, VIEW);
    expect(released.mode).toBe("returning");
    expect(released.label).toBeNull();
    const back = run(released, landed.now, 1200);
    // Follow, or already idle: the mouse hasn't moved for over IDLE_AFTER_MS.
    expect(["follow", "idle"]).toContain(back.s.mode);
    expect(pixiePose(back.s, back.now).tip).toEqual(at(118, 122));
  });

  it("flies home by itself after POINT_HOLD_MS", () => {
    const landed = landedAt();
    expect(run(landed.s, landed.now, POINT_HOLD_MS + 50).s.mode).toBe("returning");
  });

  it("re-plans from where it is when a new point arrives mid-flight (no teleport)", () => {
    let s = next(initialState(at(100, 100), 0), { type: "point", target: at(1400, 700) }, 0, VIEW);
    const midFlight = pixiePose(s, 300).tip;
    s = next(s, { type: "point", target: at(200, 700) }, 300, VIEW);
    expect(pixiePose(s, 300).tip).toEqual(midFlight);
  });

  it("never snaps its rotation: out to a target, settling, and back home", () => {
    let s = initialState(at(100, 100), 0);
    let now = 0;
    let prev = pixiePose(s, now).angle;
    let maxJump = 0;
    const observe = () => {
      const a = pixiePose(s, now).angle;
      maxJump = Math.max(maxJump, Math.abs(Math.atan2(Math.sin(a - prev), Math.cos(a - prev))));
      prev = a;
    };
    const frames = (ms: number) => {
      for (let end = now + ms; now < end; ) {
        now += 16;
        s = next(s, { type: "tick", dtSec: 0.016 }, now, VIEW);
        observe();
      }
    };
    s = next(s, { type: "point", target: at(1400, 200) }, now, VIEW); // take off heading right: tip must turn ~135 degrees
    observe();
    frames(1500);
    s = next(s, { type: "release" }, now, VIEW); // head home down-left
    observe();
    frames(1500);
    expect(s.mode === "follow" || s.mode === "idle").toBe(true);
    expect(maxJump).toBeLessThan(0.6); // a snap would be ~2.4 rad in one frame
  });

  it("ignores release when not pointing", () => {
    const s = initialState(at(100, 100), 0);
    expect(next(s, { type: "release" }, 10, VIEW)).toBe(s);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**: `npx vitest run tests/behavior.test.ts`
  Expected: FAIL with `Cannot find module '../src/renderer/behavior'`.

- [ ] **Step 3: Create `src/renderer/behavior.ts`**

```ts
import { planFlight, sampleFlight, type Flight } from "../shared/flight";
import { clamp, type Size, type Vec } from "../shared/geometry";
import { FOLLOW_SPRING, stepSpring, type SpringState } from "../shared/spring";

/** PLAN.md section 5.2, the Phase 2 subset. Later phases add listening / thinking / speaking / wander / sleep. */
export type Mode = "follow" | "idle" | "flying" | "pointing" | "returning";

export interface BehaviorState {
  mode: Mode;
  /** When the current mode began (ms, same clock as `now`). */
  since: number;
  /** Latest cursor position, overlay-local px. */
  cursor: Vec;
  lastInputAt: number;
  /** Drives follow / idle. */
  spring: SpringState;
  /** Set while flying / returning. */
  flight: Flight | null;
  /** Set while flying / pointing. */
  target: Vec | null;
  label: string | null;
  /** Sprite rotation when the current flight began; Pixie turns from it into the travel direction. */
  departAngle: number;
  /** Sprite rotation at the last landing; decays to 0 over SETTLE_MS from `settleAt`. */
  settleFrom: number;
  settleAt: number;
}

export type BehaviorEvent =
  | { type: "cursor"; at: Vec }
  | { type: "point"; target: Vec; label?: string }
  | { type: "release" }
  | { type: "tick"; dtSec: number };

export interface Pose {
  tip: Vec;
  angle: number;
}

/** Pixie sits just below-right of the real cursor. */
export const FOLLOW_OFFSET: Vec = { x: 18, y: 22 };
export const IDLE_AFTER_MS = 2000;
/** Without a new point or a release, Pixie flies home after pointing this long. */
export const POINT_HOLD_MS = 6000;
/** How long the sprite takes to turn into a flight, and to rotate back to rest after landing. */
export const TURN_MS = 180;
export const SETTLE_MS = 300;
/** The arrowhead's resting tip faces up-left (-135 degrees); adding this makes the tip lead the flight. */
const TIP_LEAD = (3 * Math.PI) / 4;

const home = (s: BehaviorState): Vec => ({ x: s.cursor.x + FOLLOW_OFFSET.x, y: s.cursor.y + FOLLOW_OFFSET.y });
/** Gentle S-curve (peak speed 1.5x): rotations use it so no single frame turns more than ~20 degrees. */
const smoothstep = (t: number): number => t * t * (3 - 2 * t);
const wrapAngle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** Interpolate along the shorter way round. */
const lerpAngle = (a: number, b: number, t: number): number => a + wrapAngle(b - a) * t;
const flightLength = (f: Flight): number => Math.hypot(f.to.x - f.from.x, f.to.y - f.from.y);

export function initialState(cursor: Vec, now: number): BehaviorState {
  const start = { x: cursor.x + FOLLOW_OFFSET.x, y: cursor.y + FOLLOW_OFFSET.y };
  return {
    mode: "follow",
    since: now,
    cursor,
    lastInputAt: now,
    spring: { pos: start, vel: { x: 0, y: 0 } },
    flight: null,
    target: null,
    label: null,
    departAngle: 0,
    settleFrom: 0,
    settleAt: now,
  };
}

/** Where Pixie's tip is and how she's rotated, at `now`. Rotation never jumps: it turns and settles over time. */
export function pixiePose(s: BehaviorState, now: number): Pose {
  if ((s.mode === "flying" || s.mode === "returning") && s.flight) {
    const f = sampleFlight(s.flight, now);
    const travel = flightLength(s.flight) < 1 ? s.departAngle : wrapAngle(f.angle + TIP_LEAD);
    const turn = smoothstep(clamp((now - s.since) / TURN_MS, 0, 1));
    return { tip: f.pos, angle: lerpAngle(s.departAngle, travel, turn) };
  }
  const settle = s.settleFrom * (1 - smoothstep(clamp((now - s.settleAt) / SETTLE_MS, 0, 1)));
  if (s.mode === "pointing" && s.target) return { tip: s.target, angle: settle };
  return { tip: s.spring.pos, angle: clamp(s.spring.vel.x * 0.0006, -0.35, 0.35) + settle };
}

function startFlight(s: BehaviorState, to: Vec, now: number, viewport: Size): Pick<BehaviorState, "since" | "flight" | "departAngle"> {
  const pose = pixiePose(s, now);
  return { since: now, flight: planFlight(pose.tip, to, now, viewport), departAngle: pose.angle };
}

function flyHome(s: BehaviorState, now: number, viewport: Size): BehaviorState {
  return { ...s, ...startFlight(s, home(s), now, viewport), mode: "returning", target: null, label: null };
}

function tick(s: BehaviorState, dtSec: number, now: number, viewport: Size): BehaviorState {
  switch (s.mode) {
    case "follow":
    case "idle": {
      const spring = stepSpring(s.spring, home(s), dtSec, FOLLOW_SPRING);
      const goIdle = s.mode === "follow" && now - s.lastInputAt > IDLE_AFTER_MS;
      return { ...s, spring, mode: goIdle ? "idle" : s.mode, since: goIdle ? now : s.since };
    }
    case "flying":
    case "returning": {
      if (!s.flight) return s;
      const f = sampleFlight(s.flight, now);
      if (!f.done) return s;
      const landed = { spring: { pos: f.pos, vel: { x: 0, y: 0 } }, settleFrom: pixiePose(s, now).angle, settleAt: now, since: now };
      return s.mode === "flying" ? { ...s, ...landed, mode: "pointing" } : { ...s, ...landed, mode: "follow", flight: null };
    }
    case "pointing":
      return now - s.since > POINT_HOLD_MS ? flyHome(s, now, viewport) : s;
  }
}

/** The whole behaviour as a pure reducer: (state, event, clock) -> state. */
export function next(s: BehaviorState, e: BehaviorEvent, now: number, viewport: Size): BehaviorState {
  switch (e.type) {
    case "cursor": {
      const wake = s.mode === "idle";
      return { ...s, cursor: e.at, lastInputAt: now, mode: wake ? "follow" : s.mode, since: wake ? now : s.since };
    }
    case "point":
      return { ...s, ...startFlight(s, e.target, now, viewport), mode: "flying", target: e.target, label: e.label ?? null };
    case "release":
      return s.mode === "flying" || s.mode === "pointing" ? flyHome(s, now, viewport) : s;
    case "tick":
      return tick(s, e.dtSec, now, viewport);
  }
}
```

- [ ] **Step 4: Run the lane gate**

```powershell
npm run typecheck
npm test
```
Expected: typecheck clean. `Test Files  5 passed (5)`, `Tests  25 passed (25)`.

- [ ] **Step 5: Commit**: `git add -A; git commit -m "feat(behavior): pure reducer for follow, idle, fly, point, return"`

---

## Task L1 (Lead): merge the lanes

- [ ] **Step 1: Merge in order A → B → C, running the gate after each merge**

```powershell
foreach ($lane in "a", "b", "c") {
  git merge --no-ff "phase2/lane-$lane" -m "merge: phase 2 lane $lane"
  if ($LASTEXITCODE -ne 0) { throw "merge conflict with lane $lane: a lane touched a file it does not own" }
  npm run typecheck; if ($LASTEXITCODE -ne 0) { throw "typecheck failed after lane $lane" }
  npm test;          if ($LASTEXITCODE -ne 0) { throw "tests failed after lane $lane" }
}
```
Expected: no conflicts (lanes own disjoint files). After the last merge: `Test Files  8 passed (8)`, `Tests  62 passed (62)`.
**If a merge conflicts:** a lane touched a file it doesn't own. Resolve it in favour of the owner lane, then re-run that lane's tests.

- [ ] **Step 2: Remove the worktrees**

```powershell
foreach ($lane in "a", "b", "c") { git worktree remove "$env:TEMP\pixie-lanes\phase2-lane-$lane" --force; git branch -d "phase2/lane-$lane" }
```

## Task L2 (Lead): integration

- [ ] **Step 1: Create `tests/stage.test.ts`, watch it fail, then create `src/renderer/stage.ts`**. This is the pure
  command → state step that Phase 3's Conductor will drive.

```ts
import { describe, expect, it } from "vitest";
import { initialState } from "../src/renderer/behavior";
import { bubbleAlpha } from "../src/renderer/bubble";
import { MAX_ANNOTATIONS, applyStage, type StageState } from "../src/renderer/stage";
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
```

```ts
import type { Frame, PixieAction } from "../shared/actions";
import { imageLengthToLocal, imageToLocal } from "../shared/coords";
import type { Size } from "../shared/geometry";
import type { StageCommand } from "../shared/ipc";
import { clearAnnotations, createAnnotation, type Annotation, type Shape } from "./annotations";
import { next, type BehaviorState } from "./behavior";
import { BUBBLE_FADE_IN_MS, bubbleAlpha } from "./bubble";

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
        const target = imageToLocal({ x: action.x, y: action.y }, frame, env.display);
        return { ...s, behavior: next(s.behavior, { type: "point", target, label: action.label }, now, env.viewport) };
      }
      const added = createAnnotation(s.nextAnnotationId, toShape(action, frame, env.display), now);
      return { ...s, annotations: [...s.annotations, added].slice(-MAX_ANNOTATIONS), nextAnnotationId: s.nextAnnotationId + 1 };
    }
  }
}
```
Run `npx vitest run tests/stage.test.ts`. Expected: FAIL (module missing) before the file exists, then `Tests  7 passed (7)`.

- [ ] **Step 1b: Create `tests/frame-stats.test.ts`, watch it fail, then create `src/renderer/frame-stats.ts`**

```ts
import { describe, expect, it } from "vitest";
import { summarizeFrames } from "../src/renderer/frame-stats";

describe("summarizeFrames", () => {
  it("reports fps, p95, max and slow frames", () => {
    const frames = [...Array(19).fill(16), 40];
    // average 17.2 ms -> 58 fps
    expect(summarizeFrames(frames)).toEqual({ count: 20, fps: 58, p95Ms: 40, maxMs: 40, slow: 1 });
  });

  it("returns null when there are no frames", () => {
    expect(summarizeFrames([])).toBeNull();
  });
});
```

```ts
export interface FrameSummary {
  count: number;
  fps: number;
  p95Ms: number;
  maxMs: number;
  /** Frames slower than 20 ms: visible stutter at 60 Hz. */
  slow: number;
}

export function summarizeFrames(frameMs: number[]): FrameSummary | null {
  if (frameMs.length === 0) return null;
  const sorted = [...frameMs].sort((a, b) => a - b);
  const avg = sorted.reduce((s, x) => s + x, 0) / sorted.length;
  return {
    count: sorted.length,
    fps: Math.round(1000 / avg),
    p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))],
    maxMs: sorted[sorted.length - 1],
    slow: sorted.filter((x) => x > 20).length,
  };
}

const fmt = (name: string, s: FrameSummary | null) =>
  s ? `${name} n=${s.count} fps=${s.fps} p95=${s.p95Ms.toFixed(1)}ms max=${s.maxMs.toFixed(1)}ms slow=${s.slow}` : `${name} n=0`;

/** Debug builds only: logs a frame-time summary every `windowMs`, split into all frames and animating frames. */
export class FrameStats {
  private all: number[] = [];
  private animating: number[] = [];
  private windowStart = performance.now();

  constructor(
    private readonly log: (line: string) => void,
    private readonly windowMs = 5000,
  ) {}

  record(frameMs: number, isAnimating: boolean): void {
    this.all.push(frameMs);
    if (isAnimating) this.animating.push(frameMs);
    const now = performance.now();
    if (now - this.windowStart < this.windowMs) return;
    this.log(`[pixie:frames] ${fmt("all", summarizeFrames(this.all))} | ${fmt("animating", summarizeFrames(this.animating))}`);
    this.all = [];
    this.animating = [];
    this.windowStart = now;
  }
}
```
Run `npx vitest run tests/frame-stats.test.ts`. Expected: FAIL (module missing) before the file exists, then `Tests  2 passed (2)`.

- [ ] **Step 2: Replace `src/main/overlay-window.ts`** (adds the `debug` / `capturable` options)

```ts
import { BrowserWindow, type Display } from "electron";
import path from "node:path";

export interface OverlayOptions {
  /** Renderer logs frame stats (`?debug=1`). */
  debug: boolean;
  /** Skip capture exclusion so screenshots can verify drawing. Dev-only: Pixie then appears in every screenshot. */
  capturable: boolean;
}

/** Full-display transparent layer: always on top, click-through, invisible to screen capture. */
export function createOverlayWindow(display: Display, opts: OverlayOptions): BrowserWindow {
  const { x, y, width, height } = display.bounds;
  const win = new BrowserWindow({
    x,
    y,
    width,
    height,
    show: false,
    transparent: true,
    backgroundColor: "#00000000",
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false, // never steals keyboard focus from the app you're using
    alwaysOnTop: true,
    type: "toolbar", // WS_EX_TOOLWINDOW: hidden from Alt+Tab
    webPreferences: {
      preload: path.join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });

  // The constructor clamps the size to the work area (screen minus taskbar); re-apply so Pixie can cover the taskbar.
  // 1 px short of the full monitor: an exact-fit top-most window makes Windows treat Pixie as a fullscreen app
  // (SHQueryUserNotificationState -> QUNS_BUSY), which mutes notifications.
  win.setBounds({ x, y, width, height: height - 1 });
  win.setAlwaysOnTop(true, "screen-saver"); // above the taskbar too
  win.setIgnoreMouseEvents(true); // clicks fall through to the apps underneath
  if (!opts.capturable) win.setContentProtection(true); // WDA_EXCLUDEFROMCAPTURE: Pixie never shows up in its own screenshots
  win.loadFile(path.join(__dirname, "../renderer/index.html"), { query: opts.debug ? { debug: "1" } : {} });
  win.once("ready-to-show", () => win.showInactive());
  return win;
}
```

- [ ] **Step 3: Replace `src/main/main.ts`** (`Ctrl+Alt+D` tour, renderer console → terminal, all under `PIXIE_DEBUG`)

```ts
import { app, globalShortcut, screen, type BrowserWindow, type Display, type Tray } from "electron";
import { saveDebugScreenshot } from "./capture-check";
import { startCursorFeed } from "./cursor-feed";
import { playTour } from "./demo";
import { TOUR, TOUR_RESET } from "./demo-tour";
import { hardenElectron } from "./harden";
import { createOverlayWindow } from "./overlay-window";
import { createTray } from "./tray";

// Escape hatch for GPUs that render transparent windows black (hybrid Intel/NVIDIA laptops).
if (process.env.PIXIE_NO_GPU === "1") app.disableHardwareAcceleration();

// Dev-only switches. PIXIE_CAPTURABLE puts Pixie into screenshots, so it only works together with PIXIE_DEBUG.
const debug = process.env.PIXIE_DEBUG === "1";
const capturable = debug && process.env.PIXIE_CAPTURABLE === "1";

let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let stopFeed: (() => void) | null = null;
let stopTour: (() => void) | null = null;

function toggleOverlay(): void {
  if (!overlay) return;
  if (overlay.isVisible()) overlay.hide();
  else overlay.showInactive();
}

function registerShortcut(accelerator: string, fn: () => void): void {
  if (!globalShortcut.register(accelerator, fn)) {
    console.warn(`[pixie] ${accelerator} is taken by another app; shortcut disabled`);
  }
}

function registerDebugTools(win: BrowserWindow, display: Display): void {
  // Writes a full-resolution screenshot to disk, so it must never be registered by default.
  registerShortcut("Control+Alt+S", () => {
    saveDebugScreenshot(display)
      .then((file) => console.log(`[pixie] capture check saved -> ${file}`))
      .catch((err) => console.error("[pixie] capture check failed:", err));
  });
  registerShortcut("Control+Alt+D", () => {
    stopTour?.();
    stopTour = playTour(win, [...TOUR_RESET, ...TOUR]);
    console.log("[pixie] demo tour started");
  });
  // Renderer console (frame stats, errors) -> this terminal.
  win.webContents.on("console-message", (details) => console.log(`[renderer] ${details.message}`));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    hardenElectron();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const win = createOverlayWindow(display, { debug, capturable });
    overlay = win;
    stopFeed = startCursorFeed(win, display);
    tray = createTray({ toggle: toggleOverlay, quit: () => app.quit() });

    registerShortcut("Control+Alt+P", toggleOverlay);
    if (debug) registerDebugTools(win, display);
    const { width, height } = display.bounds;
    const flags = [debug && "debug", capturable && "capturable"].filter(Boolean).join(", ");
    console.log(`[pixie] overlay on display ${display.id}: ${width}x${height} DIP @ ${display.scaleFactor}x${flags ? ` (${flags})` : ""}`);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopFeed?.();
    stopTour?.();
    tray?.destroy();
  });

  // Overlay app: closing windows must not quit. Only the tray's "Quit Pixie" does.
  app.on("window-all-closed", () => {});
}
```

- [ ] **Step 4: Replace `src/renderer/main.ts`** (wires `applyStage`, behaviour ticks, annotations, bubble, label and frame stats)

```ts
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
let prev = performance.now();

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

  stats?.record(dt * 1000, mode === "flying" || mode === "returning" || stage.annotations.length > 0);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 5: Gate + build, then commit**

```powershell
npm run typecheck
npm test
npm run build
```
Expected: typecheck clean; `Test Files  10 passed (10)`, `Tests  71 passed (71)`; three `⚡ Done` blocks.

```powershell
git add -A
git commit -m "feat(overlay): wire stage commands, behaviour, drawing and debug telemetry"
```

## Task L3 (Lead): scripted acceptance (the Lead drives the keys)

> **Before this task, tell the user:** Pixie will run the tour and the Lead will take 4 screenshots and look at them.
> Close anything sensitive (passwords, banking, private chats) first. The screenshots are deleted in Step 3.

- [ ] **Step 1: Start Pixie in debug + capturable mode** (only in this mode does Pixie appear in screenshots). Run this in the background:

```powershell
$env:PIXIE_DEBUG = "1"; $env:PIXIE_CAPTURABLE = "1"; npm start
```

- [ ] **Step 2: Drive the tour and check the pixels.** This script presses `Ctrl+Alt+D` and then `Ctrl+Alt+S` at 3.9 s,
  8.6 s, 11.9 s and 18.4 s (synthesized keypresses). It reports where Pixie's tip landed in each capture.

```powershell
Add-Type -Namespace K -Name Kb -MemberDefinition '[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);'
function Chord([byte]$vk) { foreach ($k in 0x11, 0x12, $vk) { [K.Kb]::keybd_event($k, 0, 0, [UIntPtr]::Zero) }; foreach ($k in $vk, 0x12, 0x11) { [K.Kb]::keybd_event($k, 0, 2, [UIntPtr]::Zero) } }
$sw = [Diagnostics.Stopwatch]::StartNew(); Chord 0x44                      # Ctrl+Alt+D: start the tour
foreach ($t in 3900, 8600, 11900, 18400) { while ($sw.ElapsedMilliseconds -lt $t) { Start-Sleep -Milliseconds 20 }; Chord 0x53 }  # Ctrl+Alt+S
Start-Sleep -Seconds 8
Add-Type -AssemblyName System.Drawing
$caps = Get-ChildItem "$env:APPDATA\pixie\debug" -Filter *.png | Sort-Object LastWriteTime | Select-Object -Last 4
$targets = @(@(960, 540), @(1860, 60), @(1780, 1050), @(90, 90))            # the tour's point targets (1920x1080 px)
for ($i = 0; $i -lt 4; $i++) {
  $bmp = [System.Drawing.Bitmap]::FromFile($caps[$i].FullName); $tx = $targets[$i][0]; $ty = $targets[$i][1]; $best = $null
  for ($y = $ty; $y -le [Math]::Min(1079, $ty + 30); $y++) { for ($x = $tx; $x -le [Math]::Min(1919, $tx + 30); $x++) {
    $c = $bmp.GetPixel($x, $y); if ([Math]::Abs($c.R - 124) -le 6 -and [Math]::Abs($c.G - 92) -le 6 -and $c.B -ge 249 -and ($null -eq $best -or $x + $y -lt $best[0] + $best[1])) { $best = @($x, $y) } } }
  $bmp.Dispose(); "target ($tx,$ty) -> first fill pixel ($($best -join ','))"
}
```
Expected:
- The first three lines show the fill pixel at **target + (3, 3)**. The white outline and anti-aliasing account for the offset; the geometric tip is on target.
- At the taskbar target, the fill pixel may be exactly the target, because the "taskbar" label pill is purple too. Check that one by eye.
- In the terminal running Pixie, every `[renderer] [pixie:frames]` line shows `animating ... slow=0`, with a max under 20 ms.
- Open the 4 captures and check that bubbles are fully on screen (flipped left at top-right, up and left at the taskbar), and that labels touch neither Pixie nor the bubble.

- [ ] **Step 3: Clean up: stop Pixie, drop the capturable flag, delete the captures** (they contain the user's screen)

```powershell
Get-Process electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -like '*xvant\Pixie*' } | Stop-Process -Force
Remove-Item Env:PIXIE_CAPTURABLE -ErrorAction SilentlyContinue
Get-ChildItem "$env:APPDATA\pixie\debug" -Filter *.png | ForEach-Object { Remove-Item -LiteralPath $_.FullName }
```

- [ ] **Step 4: Re-check Phase 1's capture exclusion** with only the debug flag. Start `$env:PIXIE_DEBUG = "1"; npm start`,
  press `Ctrl+Alt+S`, and check that the capture contains **no** Pixie: no `#7c5cff` pixels near the cursor. Delete the capture afterwards.

## Task L4: review swarm, your eyes, tag

- [ ] **Step 1: Review swarm.** Run `xvant-review-correctness`, `-concurrency`, `-architecture` and `-security` in parallel over `git diff phase-1..HEAD`. Then `xvant-review-verifier` repro-tests each suspected finding. Fix only confirmed findings, each with a regression test.
- [ ] **Step 2: You watch the tour.** In a **new** terminal (so no leftover `PIXIE_CAPTURABLE`), run `$env:PIXIE_DEBUG = "1"; npm start`, press `Ctrl+Alt+D`, and check each row of the Results table below. Press `Ctrl+Alt+D` again mid-tour: it should restart cleanly.
- [ ] **Step 3: Tag**: `git tag -a phase-2 -m "Phase 2: motion & drawing engine"`

### Results

| # | Check | How | Pass? | Notes |
|---|---|---|---|---|
| 1 | 71 unit tests | `npm test` | [ ] | |
| 2 | 60 fps while animating | debug frame stats | [ ] | |
| 3 | Tip on target (±3 px incl. outline) | L3 script | [ ] | |
| 4 | Bubbles never clip, labels never overlap | L3 captures + sweep tests | [ ] | |
| 5 | Pixie still excluded from captures without `PIXIE_CAPTURABLE` | L3 Step 4 | [ ] | |
| 6 | Flights arc smoothly, the tip leads, turns and settles without snapping | your eyes | [ ] | |
| 7 | Circle, arrow, box, underline and note look hand-drawn, stroke on, and fade | your eyes | [ ] | |
| 8 | Returns to the cursor after the tour; a mid-tour restart is clean | your eyes | [ ] | |
| 9 | Review swarm: confirmed findings fixed | swarm + verifier | [ ] | |

### Recorded for later phases (from the plan review)

- **Phase 3: an answer's pointer, drawings and bubble should end when the *answer* ends, not on timers.**
  - Today: pointing holds 6 s, drawings fade 8 s after creation, bubbles last at most 9 s.
  - Phase 3: `release` starts the fade timers, and pointing holds until `release`, with a ~30 s safety timeout.
- **Phase 3–4: speech-synced actions.** These add to the `StageCommand` union without rewriting anything:
  - a `speechOffset` field on actions, plus a renderer-side queue
  - a `reset` command for barge-in (today: `say ""` + `clear` + `release` on the one ordered channel)
  - a renderer → main channel for word boundaries and the idle state
- **Phase 3:** wait for the overlay's `did-finish-load` before sending stage commands; earlier ones are dropped.
- **Phase 3 until Phase 6:** capture the overlay's own display, because `Frame` has no display id yet.
- **Phase 6:** rebuild the cursor feed's display bounds on `display-metrics-changed`, since a DPI change mid-run desyncs main and renderer. Also check `requestAnimationFrame` behaviour while the overlay is hidden.
