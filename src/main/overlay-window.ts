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
