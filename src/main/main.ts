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
