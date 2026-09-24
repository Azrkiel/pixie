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
