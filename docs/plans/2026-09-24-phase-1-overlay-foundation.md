# Phase 1 — Overlay Foundation: Implementation Plan

> **For the implementer:** assume zero context. Work top to bottom and tick each box. Every task ends with a commit.
> Run commands in **PowerShell** from `C:\Users\jiang\Downloads\xvant\Pixie` unless a step says otherwise.
> Roadmap and background: [`../../PLAN.md`](../../PLAN.md).

**Goal:** Pixie, a glowing purple arrow, floats above every window and glides after the mouse. She never blocks a click, never steals focus, and is invisible to screen capture.

**Architecture:** One Electron main process creates a single transparent, click-through, always-on-top, non-focusable
window covering the display under the cursor. Main polls the global cursor at 60 Hz and pushes window-local
coordinates over one typed IPC channel. The renderer runs a spring simulation and draws Pixie on a full-window canvas.

**Tech stack:** Electron 44 · TypeScript 7 (type-check only) · esbuild 0.28 (bundling) · Vitest 5 · Node 22.

**Pre-verified:** on 2026-09-24 this exact code was type-checked (`tsc`), unit-tested (5/5 passing) and bundled
(esbuild) on this machine. Runtime behaviour is what Task 8's checklist verifies.

**Build mode:** single session, no parallel lanes. The phase is too small for lane overhead to pay off
(PLAN.md §9.3 rule 8). After Task 8, run the light review: `xvant-review-correctness` + `xvant-review-security` on the
phase diff, verifier-confirmed findings only. The Conductor and agent team (PLAN.md §7) start in Phase 3; nothing here
depends on them.

---

## Flow (Phase 1 scope, with failure branches)

```
[npm start] --> [esbuild bundles main / preload / renderer] --> [Electron main starts]
                                                                     |
                                    another Pixie already running? --yes--> [quit silently]
                                                                     |
                                                                     v
                    [create overlay on display under cursor] --screen goes black/grey--> [restart with PIXIE_NO_GPU=1]
                                                                     |
            +--------------------------+-----------------------------+---------------------------+
            v                          v                             v                           v
     [tray icon: Show/Hide,      [Ctrl+Alt+P: toggle]        [Ctrl+Alt+S: capture check]   [cursor feed 60 Hz]
      Quit Pixie]                 |-- key taken by another    |-- capture fails -->          |-- mouse still -->
                                  |   app --> console warning |   console error              |   send nothing
                                  v   (tray still works)      v                              v
                              [hide / show]              [PNG in %APPDATA%\pixie\debug]  IPC "pixie:cursor" {x,y,t}
                                                          (Pixie must NOT be in it)          |
                                                                                             v
                                                              [renderer: spring step --> draw Pixie at 60 fps]
                                                                     |-- no input for 2 s --> [idle: bob + breathe]
```

## File map

| File | Responsibility |
|---|---|
| `package.json` | scripts: `build`, `start`, `typecheck`, `test`; `main` points at the bundled entry |
| `tsconfig.json` | strict type-checking only (`noEmit`); esbuild does the bundling |
| `build.mjs` | esbuild: main + preload → CommonJS for Node; renderer → IIFE for the browser; copies `index.html` |
| `.gitignore` | ignore `node_modules/`, `dist/` |
| `src/shared/geometry.ts` | `Vec`, `Rect` types shared everywhere |
| `src/shared/spring.ts` | spring physics for smooth follow (pure, tested) |
| `src/shared/coords.ts` | coordinate conversions (pure, tested); grows in Phase 2 |
| `src/shared/ipc.ts` | IPC channel names, payload types, the `window.pixie` bridge interface |
| `src/preload/preload.ts` | exposes `window.pixie` through `contextBridge` |
| `src/renderer/index.html` | transparent page with one full-window canvas |
| `src/renderer/global.d.ts` | types `window.pixie` for the renderer |
| `src/renderer/pixie-sprite.ts` | draws Pixie (glowing arrowhead) |
| `src/renderer/main.ts` | render loop: spring follow, idle bob, lean into motion |
| `src/main/overlay-window.ts` | creates the transparent / click-through / top-most / capture-hidden window |
| `src/main/cursor-feed.ts` | polls the global cursor at 60 Hz and sends window-local coordinates |
| `src/main/tray.ts` | tray icon (generated in code) and menu |
| `src/main/capture-check.ts` | dev check: saves a screenshot to prove Pixie is excluded from capture |
| `src/main/main.ts` | entry: single-instance lock, lifecycle, tray, global shortcuts |
| `tests/spring.test.ts`, `tests/coords.test.ts` | unit tests |

---

## Task 1: Project skeleton

**Files:** create `package.json`, `tsconfig.json`, `build.mjs`, `.gitignore`

- [ ] **Step 1: Initialise git** (the folder already holds `PLAN.md` and `docs/`)

```powershell
cd C:\Users\jiang\Downloads\xvant\Pixie
git init
```
Expected: `Initialized empty Git repository in C:/Users/jiang/Downloads/xvant/Pixie/.git/`

- [ ] **Step 2: Create `package.json`**

```json
{
  "name": "pixie",
  "version": "0.1.0",
  "private": true,
  "description": "Pixie - an AI cursor companion that lives on your screen",
  "main": "dist/main/main.js",
  "scripts": {
    "build": "node build.mjs",
    "start": "npm run build && electron .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run"
  }
}
```

- [ ] **Step 3: Install dev dependencies**

```powershell
npm install --save-dev electron@44 esbuild@0.28 typescript@7 vitest@5 @types/node@22
```
Expected: the output ends with `found 0 vulnerabilities`. A warning block
`npm warn install-scripts ... esbuild@0.28.x (postinstall: node install.js)` is **expected and harmless**: npm 12
blocks install scripts by default, and esbuild ships its Windows binary as an optional dependency anyway. Electron's
~100 MB binary is **not** downloaded yet. That happens automatically on the first `npm start`.

- [ ] **Step 4: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src", "tests"]
}
```

- [ ] **Step 5: Create `build.mjs`**

```js
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const common = { bundle: true, sourcemap: true, target: "es2022", logLevel: "info" };

await Promise.all([
  build({ ...common, entryPoints: ["src/main/main.ts"], outfile: "dist/main/main.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/preload/preload.ts"], outfile: "dist/preload/preload.js", platform: "node", format: "cjs", external: ["electron"] }),
  build({ ...common, entryPoints: ["src/renderer/main.ts"], outfile: "dist/renderer/main.js", platform: "browser", format: "iife" }),
]);

mkdirSync("dist/renderer", { recursive: true });
cpSync("src/renderer/index.html", "dist/renderer/index.html");
```

- [ ] **Step 6: Create `.gitignore`**

```
node_modules/
dist/
*.log
```

- [ ] **Step 7: Verify the toolchain**

```powershell
npx tsc --version
```
Expected: `Version 7.0.2` (any `7.x` is fine).

- [ ] **Step 8: Commit**

```powershell
git add -A
git commit -m "chore: scaffold Pixie (electron 44, esbuild, typescript 7, vitest)"
```

---

## Task 2: Spring physics (test first)

**Files:** create `tests/spring.test.ts`, `src/shared/geometry.ts`, `src/shared/spring.ts`

- [ ] **Step 1: Write the failing test** `tests/spring.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { FOLLOW_SPRING, stepSpring, type SpringState } from "../src/shared/spring";

const REST: SpringState = { pos: { x: 0, y: 0 }, vel: { x: 0, y: 0 } };
const TARGET = { x: 100, y: 50 };

function simulate(seconds: number, dt = 1 / 60) {
  let s = REST;
  let maxX = -Infinity;
  for (let t = 0; t < seconds; t += dt) {
    s = stepSpring(s, TARGET, dt, FOLLOW_SPRING);
    maxX = Math.max(maxX, s.pos.x);
  }
  return { s, maxX };
}

describe("stepSpring", () => {
  it("settles on the target", () => {
    const { s } = simulate(2);
    expect(s.pos.x).toBeCloseTo(100, 1);
    expect(s.pos.y).toBeCloseTo(50, 1);
    expect(Math.hypot(s.vel.x, s.vel.y)).toBeLessThan(1);
  });

  it("does not visibly overshoot", () => {
    expect(simulate(2).maxX).toBeLessThan(101);
  });

  it("clamps huge frame gaps so a stalled frame cannot fling Pixie", () => {
    const stalled = stepSpring(REST, TARGET, 5, FOLLOW_SPRING);
    const normal = stepSpring(REST, TARGET, 0.1, FOLLOW_SPRING);
    expect(stalled).toEqual(normal);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
npx vitest run tests/spring.test.ts
```
Expected: `FAIL  tests/spring.test.ts` with `Error: Cannot find module '../src/shared/spring'`. The module doesn't exist yet.

- [ ] **Step 3: Create `src/shared/geometry.ts`**

```ts
export interface Vec {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}
```

- [ ] **Step 4: Create `src/shared/spring.ts`**

```ts
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
```

- [ ] **Step 5: Run it and watch it pass**

```powershell
npx vitest run tests/spring.test.ts
```
Expected: `Test Files  1 passed (1)` and `Tests  3 passed (3)`.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(shared): spring physics for smooth cursor follow"
```

---

## Task 3: Coordinate conversion (test first)

**Files:** create `tests/coords.test.ts`, `src/shared/coords.ts`

- [ ] **Step 1: Write the failing test** `tests/coords.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { screenToLocal } from "../src/shared/coords";

describe("screenToLocal", () => {
  it("is identity on a primary display at the origin", () => {
    expect(screenToLocal({ x: 300, y: 200 }, { x: 0, y: 0, width: 1536, height: 864 })).toEqual({ x: 300, y: 200 });
  });

  it("handles a monitor left of the primary (negative origin)", () => {
    expect(screenToLocal({ x: -1800, y: 100 }, { x: -1920, y: 0, width: 1920, height: 1080 })).toEqual({ x: 120, y: 100 });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

```powershell
npx vitest run tests/coords.test.ts
```
Expected: `FAIL  tests/coords.test.ts` with `Error: Cannot find module '../src/shared/coords'`.

- [ ] **Step 3: Create `src/shared/coords.ts`**

```ts
import type { Rect, Vec } from "./geometry";

/** Global DIP point (Electron `screen` API) -> overlay-window-local CSS px. */
export function screenToLocal(p: Vec, displayBounds: Rect): Vec {
  return { x: p.x - displayBounds.x, y: p.y - displayBounds.y };
}
```

- [ ] **Step 4: Run the whole suite**

```powershell
npm test
```
Expected: `Test Files  2 passed (2)` and `Tests  5 passed (5)`.

- [ ] **Step 5: Commit**

```powershell
git add -A
git commit -m "feat(shared): screen-to-overlay coordinate conversion"
```

---

## Task 4: IPC contract and preload bridge

**Files:** create `src/shared/ipc.ts`, `src/preload/preload.ts`

- [ ] **Step 1: Create `src/shared/ipc.ts`**

```ts
export const IPC = {
  cursor: "pixie:cursor",
} as const;

/** Cursor position in overlay-window-local CSS px. */
export interface CursorSample {
  x: number;
  y: number;
  t: number;
}

/** What the preload exposes to the overlay renderer as `window.pixie`. */
export interface PixieBridge {
  onCursor(cb: (s: CursorSample) => void): void;
}
```

- [ ] **Step 2: Create `src/preload/preload.ts`**

```ts
import { contextBridge, ipcRenderer } from "electron";
import { IPC, type CursorSample, type PixieBridge } from "../shared/ipc";

const bridge: PixieBridge = {
  onCursor(cb) {
    ipcRenderer.on(IPC.cursor, (_event, s: CursorSample) => cb(s));
  },
};

contextBridge.exposeInMainWorld("pixie", bridge);
```

- [ ] **Step 3: Type-check**

```powershell
npm run typecheck
```
Expected: no errors (the command prints only its own `> tsc --noEmit` header).

- [ ] **Step 4: Commit**

```powershell
git add -A
git commit -m "feat(ipc): typed cursor channel and preload bridge"
```

---

## Task 5: Renderer: draw Pixie and follow

**Files:** create `src/renderer/index.html`, `src/renderer/global.d.ts`, `src/renderer/pixie-sprite.ts`, `src/renderer/main.ts`

- [ ] **Step 1: Create `src/renderer/index.html`**

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'" />
    <title>Pixie</title>
    <style>
      html, body { margin: 0; height: 100%; overflow: hidden; background: transparent; }
      canvas { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; }
    </style>
  </head>
  <body>
    <canvas id="stage"></canvas>
    <script src="main.js"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `src/renderer/global.d.ts`**

```ts
import type { PixieBridge } from "../shared/ipc";

declare global {
  interface Window {
    pixie: PixieBridge;
  }
}
```

- [ ] **Step 3: Create `src/renderer/pixie-sprite.ts`**

```ts
import type { Vec } from "../shared/geometry";

export interface SpriteStyle {
  color: string;
  glow: string;
  size: number;
}

export const DEFAULT_STYLE: SpriteStyle = { color: "#7c5cff", glow: "rgba(124, 92, 255, 0.6)", size: 22 };

/** Draw Pixie: a glowing arrowhead whose tip sits exactly at `tip`, rotated by `angle` radians. */
export function drawPixie(ctx: CanvasRenderingContext2D, tip: Vec, angle: number, scale: number, style = DEFAULT_STYLE): void {
  const s = style.size * scale;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s, s * 0.4);
  ctx.lineTo(s * 0.45, s * 0.45); // notch makes it read as a pointer, not a triangle
  ctx.lineTo(s * 0.4, s);
  ctx.closePath();
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 18;
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
  ctx.restore();
}
```

- [ ] **Step 4: Create `src/renderer/main.ts`**

```ts
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
```

- [ ] **Step 5: Type-check**

```powershell
npm run typecheck
```
Expected: no errors.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(renderer): canvas sprite with spring follow and idle bob"
```

---

## Task 6: Main process: the overlay window (first run)

**Files:** create `src/main/overlay-window.ts`, `src/main/cursor-feed.ts`, `src/main/main.ts`

- [ ] **Step 1: Create `src/main/overlay-window.ts`**

```ts
import { BrowserWindow, type Display } from "electron";
import path from "node:path";

/** Full-display transparent layer: always on top, click-through, invisible to screen capture. */
export function createOverlayWindow(display: Display): BrowserWindow {
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

  win.setAlwaysOnTop(true, "screen-saver"); // above the taskbar too
  win.setIgnoreMouseEvents(true); // clicks fall through to the apps underneath
  win.setContentProtection(true); // WDA_EXCLUDEFROMCAPTURE: Pixie never shows up in its own screenshots
  win.loadFile(path.join(__dirname, "../renderer/index.html"));
  win.once("ready-to-show", () => win.showInactive());
  return win;
}
```

- [ ] **Step 2: Create `src/main/cursor-feed.ts`**

```ts
import { screen, type BrowserWindow, type Display } from "electron";
import { screenToLocal } from "../shared/coords";
import type { Vec } from "../shared/geometry";
import { IPC, type CursorSample } from "../shared/ipc";

/** Push the global cursor position to the overlay at ~60 Hz. Returns a stop function. */
export function startCursorFeed(win: BrowserWindow, display: Display): () => void {
  let last: Vec = { x: Number.NaN, y: Number.NaN };
  const timer = setInterval(() => {
    if (win.isDestroyed()) return;
    const p = screen.getCursorScreenPoint();
    if (p.x === last.x && p.y === last.y) return; // mouse is still: no IPC spam
    last = p;
    const local = screenToLocal(p, display.bounds);
    const sample: CursorSample = { x: local.x, y: local.y, t: Date.now() };
    win.webContents.send(IPC.cursor, sample);
  }, 16);
  return () => clearInterval(timer);
}
```

- [ ] **Step 3: Create `src/main/main.ts` (first version; Task 7 replaces it)**

```ts
import { app, screen, type BrowserWindow } from "electron";
import { startCursorFeed } from "./cursor-feed";
import { createOverlayWindow } from "./overlay-window";

// Escape hatch for GPUs that render transparent windows black (hybrid Intel/NVIDIA laptops).
if (process.env.PIXIE_NO_GPU === "1") app.disableHardwareAcceleration();

let overlay: BrowserWindow | null = null;
let stopFeed: (() => void) | null = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay = createOverlayWindow(display);
    stopFeed = startCursorFeed(overlay, display);
    const { width, height } = display.bounds;
    console.log(`[pixie] overlay on display ${display.id}: ${width}x${height} DIP @ ${display.scaleFactor}x`);
  });

  app.on("will-quit", () => stopFeed?.());

  // Overlay app: closing windows must not quit. (Task 7 adds a tray "Quit"; for now stop with Ctrl+C.)
  app.on("window-all-closed", () => {});
}
```

- [ ] **Step 4: Type-check, then run**

```powershell
npm run typecheck
npm start
```
Expected:
1. esbuild prints three `⚡ Done` blocks listing `dist\main\main.js`, `dist\preload\preload.js`, `dist\renderer\main.js`.
2. First run only: `Downloading Electron binary...` (~100 MB, one time).
3. `[pixie] overlay on display <some id>: 1536x864 DIP @ 1.25x`
4. A purple glowing arrow appears and glides after your mouse, sitting just below-right of the cursor.

**If the whole screen goes black or grey:** press `Ctrl+C` in the terminal, then run
`$env:PIXIE_NO_GPU="1"; npm start`. Write down that the flag was needed (Task 8 results table).

- [ ] **Step 5: Quick sanity check.** Click a desktop icon and select some text in a browser, both through Pixie. Both must work. Then stop with `Ctrl+C` in the terminal.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(main): transparent click-through overlay with 60 Hz cursor feed"
```

---

## Task 7: Tray, shortcuts, capture check

**Files:** create `src/main/tray.ts`, `src/main/capture-check.ts`; replace `src/main/main.ts`

- [ ] **Step 1: Create `src/main/tray.ts`**

```ts
import { Menu, Tray, nativeImage, type NativeImage } from "electron";

/** 32x32 purple dot drawn in code, so the repo needs no binary icon until Phase 6. */
function makeDotIcon(): NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - c, y - c) + 0.5)); // 1px anti-aliased edge
      const i = (y * size + x) * 4;
      // Windows bitmaps are premultiplied BGRA. Colour #7c5cff.
      buf[i] = Math.round(0xff * a);
      buf[i + 1] = Math.round(0x5c * a);
      buf[i + 2] = Math.round(0x7c * a);
      buf[i + 3] = Math.round(0xff * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(handlers: { toggle: () => void; quit: () => void }): Tray {
  const tray = new Tray(makeDotIcon());
  tray.setToolTip("Pixie");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show / hide Pixie   (Ctrl+Alt+P)", click: handlers.toggle },
      { type: "separator" },
      { label: "Quit Pixie", click: handlers.quit },
    ]),
  );
  tray.on("click", handlers.toggle);
  return tray;
}
```

- [ ] **Step 2: Create `src/main/capture-check.ts`**

```ts
import { app, desktopCapturer, type Display } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Dev check: grab the display at physical resolution and save a PNG. Pixie must NOT appear in it. */
export async function saveDebugScreenshot(display: Display): Promise<string> {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error("no screen source available");
  const dir = path.join(app.getPath("userData"), "debug");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `capture-${Date.now()}.png`);
  writeFileSync(file, source.thumbnail.toPNG());
  const size = source.thumbnail.getSize();
  return `${file} (${size.width}x${size.height})`;
}
```

- [ ] **Step 3: Replace `src/main/main.ts` with the final version**

```ts
import { app, globalShortcut, screen, type BrowserWindow, type Tray } from "electron";
import { saveDebugScreenshot } from "./capture-check";
import { startCursorFeed } from "./cursor-feed";
import { createOverlayWindow } from "./overlay-window";
import { createTray } from "./tray";

// Escape hatch for GPUs that render transparent windows black (hybrid Intel/NVIDIA laptops).
if (process.env.PIXIE_NO_GPU === "1") app.disableHardwareAcceleration();

let overlay: BrowserWindow | null = null;
let tray: Tray | null = null;
let stopFeed: (() => void) | null = null;

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.whenReady().then(() => {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay = createOverlayWindow(display);
    stopFeed = startCursorFeed(overlay, display);
    tray = createTray({ toggle: toggleOverlay, quit: () => app.quit() });

    registerShortcut("Control+Alt+P", toggleOverlay);
    registerShortcut("Control+Alt+S", () => {
      saveDebugScreenshot(display)
        .then((file) => console.log(`[pixie] capture check saved -> ${file}`))
        .catch((err) => console.error("[pixie] capture check failed:", err));
    });
    const { width, height } = display.bounds;
    console.log(`[pixie] overlay on display ${display.id}: ${width}x${height} DIP @ ${display.scaleFactor}x`);
  });

  app.on("will-quit", () => {
    globalShortcut.unregisterAll();
    stopFeed?.();
    tray?.destroy();
  });

  // Overlay app: closing windows must not quit. Only the tray's "Quit Pixie" does.
  app.on("window-all-closed", () => {});
}
```

- [ ] **Step 4: Type-check, test, run**

```powershell
npm run typecheck
npm test
npm start
```
Expected: typecheck clean; `Tests  5 passed (5)`; Pixie appears. A purple dot is in the system tray (it may be under the `^` overflow arrow).

- [ ] **Step 5: Try the controls**
  - `Ctrl+Alt+P` hides Pixie; pressing it again shows her.
  - Clicking the tray dot also toggles her.
  - `Ctrl+Alt+S` prints `[pixie] capture check saved -> C:\Users\jiang\AppData\Roaming\pixie\debug\capture-<n>.png (1920x1080)`.
  - Tray → **Quit Pixie** exits, and the terminal returns to the prompt.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m "feat(main): tray menu, show/hide shortcut, capture-exclusion check"
```

---

## Task 8: Acceptance checks (manual). These retire the stack risks.

Run `npm start`, go through each check, and fill in the **Results** table below.

- [ ] **1. Follow.** Move the mouse in fast circles, then stop. Pixie trails smoothly, settles with no bounce, and her edges are crisp (not blurry) at 125 % scaling.
- [ ] **2. Idle.** Keep the mouse still for 3 s. Pixie hovers gently (bob + breathe).
- [ ] **3. Click-through.** With Pixie over them, double-click a desktop icon, drag a window by its title bar, and select text in a browser. All work.
- [ ] **4. Focus.** Open Notepad and type continuously while moving the mouse around. Typing is never interrupted, and Notepad stays the active window.
- [ ] **5. Z-order.** Pixie stays above normal windows and above the taskbar. Click the taskbar, then check again. *If Pixie drops behind the taskbar after that click, note it; Phase 6 re-asserts top-most.*
- [ ] **6. Hidden.** Pixie is not on the taskbar and not in Alt+Tab.
- [ ] **7. Capture exclusion.** Press `Ctrl+Alt+S`, then open the PNG:
  ```powershell
  ii (Get-ChildItem "$env:APPDATA\pixie\debug" | Sort-Object LastWriteTime | Select-Object -Last 1).FullName
  ```
  The image is 1920×1080 and sharp, and **Pixie is not in it**.
- [ ] **8. No "fullscreen app" side effects.** While Pixie runs, run this in a second PowerShell window:
  ```powershell
  Add-Type -Namespace Pixie -Name Shell -MemberDefinition '[DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int state);'
  $state = 0; [void][Pixie.Shell]::SHQueryUserNotificationState([ref]$state); $state
  ```
  Expected: `5` (accepts notifications). If it prints `2` or `3`, Windows treats Pixie as a fullscreen app. Fix it in `overlay-window.ts` by changing `height,` to `height: height - 1,`, then re-run the check.
- [ ] **9. Performance.** Task Manager → Details, sort by name, and add up CPU for all `electron.exe` processes. Take one reading while you wiggle the mouse and one after 10 s idle. Target: under 5 % moving and under 3 % idle. Record the numbers either way. Phase 6 does render-on-demand.
- [ ] **10. Single instance.** With Pixie running, open a second terminal and run `npm start`. The second copy exits immediately, and only one Pixie is visible.
- [ ] **11. Commit results and tag**

```powershell
git add -A
git commit -m "docs: phase 1 acceptance results"
git tag phase-1
```

### Results

| # | Check | Pass? | Notes / numbers |
|---|---|---|---|
| 1 | Follow smooth, crisp | [ ] | |
| 2 | Idle bob | [ ] | |
| 3 | Click-through | [ ] | |
| 4 | Never steals focus | [ ] | |
| 5 | Above windows + taskbar | [ ] | |
| 6 | Not in taskbar / Alt+Tab | [ ] | |
| 7 | Excluded from capture (1920×1080) | [ ] | |
| 8 | Notification state = 5 | [ ] | |
| 9 | CPU moving / idle | [ ] | moving: __ % · idle: __ % |
| 10 | Single instance | [ ] | |
| — | Needed `PIXIE_NO_GPU=1`? | yes / no | |

### Troubleshooting

| Symptom | Fix |
|---|---|
| Black or grey full-screen rectangle | GPU transparency issue. Run `$env:PIXIE_NO_GPU="1"; npm start`. Also try Settings → System → Display → Graphics → add `node_modules\electron\dist\electron.exe` → "High performance". |
| Pixie appears in the capture PNG | Content protection isn't honoured by this capture path. Record it; Phase 3 then hides the overlay for one frame while capturing. |
| Clicks are blocked | `setIgnoreMouseEvents(true)` didn't apply. Check it is in `overlay-window.ts` and that no DevTools window is open on the overlay. |
| Pixie stutters | Check GPU preference (above). Confirm that nothing else is pegging the CPU. |
| `Ctrl+Alt+P is taken by another app` | Another app owns the shortcut. Use the tray icon for now; Phase 6 makes shortcuts configurable. |
| `Electron failed to install correctly` | Delete `node_modules\electron`, run `npm install`, then `npm start` again. |

---

## Self-review (done while writing this plan)

- **Coverage of Phase 1 "Done when" in PLAN.md:**
  - smooth follow → Tasks 2, 5 + check 1
  - click-through / focus / hidden → Task 6 + checks 3, 4, 6
  - capture exclusion → Task 7 + check 7
  - fullscreen side effects → check 8
  - tests pass → Tasks 2, 3
  - CPU recorded → check 9
- **Placeholder scan:** every code step has full file contents, and every command has expected output.
- **Name consistency:** `Vec`, `Rect` (geometry.ts); `SpringState`, `SpringConfig`, `FOLLOW_SPRING`, `stepSpring` (spring.ts); `screenToLocal` (coords.ts); `IPC.cursor`, `CursorSample`, `PixieBridge` (ipc.ts); `window.pixie.onCursor` (preload ↔ renderer); `createOverlayWindow`, `startCursorFeed`, `createTray`, `saveDebugScreenshot` (main). All match across tasks.
- **Pre-verified on this machine:** type-check, 5/5 tests, and the esbuild bundle all pass with Electron 44.4.5, TypeScript 7.0.2, Vitest 5.0.1 and esbuild 0.28.2.

**Next:** when all Results rows pass, ask Claude to write `docs/plans/<date>-phase-2-motion-drawing.md` from PLAN.md §8 Phase 2.
It will be built with parallel lanes (PLAN.md §9.4: contracts first, then lanes A/B/C).
