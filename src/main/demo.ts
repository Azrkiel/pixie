import type { BrowserWindow } from "electron";
import { IPC, type StageCommand } from "../shared/ipc";

export interface TourStep {
  /** Delay after the previous step, in ms. */
  afterMs: number;
  command: StageCommand;
}

/** The slice of BrowserWindow the player needs, so it can be unit-tested with a fake. */
export interface StageTarget {
  isDestroyed(): boolean;
  webContents: Pick<BrowserWindow["webContents"], "send">;
}

/** Send each step's command to the overlay on schedule. Returns a function that cancels the remaining steps. */
export function playTour(target: StageTarget, steps: TourStep[]): () => void {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let at = 0;
  for (const step of steps) {
    at += step.afterMs;
    timers.push(
      setTimeout(() => {
        if (!target.isDestroyed()) target.webContents.send(IPC.stage, step.command);
      }, at),
    );
  }
  return () => timers.forEach((t) => clearTimeout(t));
}
