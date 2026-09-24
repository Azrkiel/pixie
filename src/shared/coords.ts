import type { Rect, Vec } from "./geometry";

/** Global DIP point (Electron `screen` API) -> overlay-window-local CSS px. */
export function screenToLocal(p: Vec, displayBounds: Rect): Vec {
  return { x: p.x - displayBounds.x, y: p.y - displayBounds.y };
}
