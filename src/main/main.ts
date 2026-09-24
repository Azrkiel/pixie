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
