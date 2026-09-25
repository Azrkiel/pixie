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
