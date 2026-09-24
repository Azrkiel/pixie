import { app, globalShortcut, screen, type BrowserWindow, type Tray } from "electron";
import { saveDebugScreenshot } from "./capture-check";
import { startCursorFeed } from "./cursor-feed";
import { hardenElectron } from "./harden";
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
    hardenElectron();
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    overlay = createOverlayWindow(display);
    stopFeed = startCursorFeed(overlay, display);
    tray = createTray({ toggle: toggleOverlay, quit: () => app.quit() });

    registerShortcut("Control+Alt+P", toggleOverlay);
    // Dev-only: writes a full-resolution screenshot to disk, so it must never be registered by default.
    if (process.env.PIXIE_DEBUG === "1") {
      registerShortcut("Control+Alt+S", () => {
        saveDebugScreenshot(display)
          .then((file) => console.log(`[pixie] capture check saved -> ${file}`))
          .catch((err) => console.error("[pixie] capture check failed:", err));
      });
    }
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
