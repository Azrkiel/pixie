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
