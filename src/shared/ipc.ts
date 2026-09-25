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
