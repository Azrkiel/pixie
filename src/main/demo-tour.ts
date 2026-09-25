import type { Frame, PixieAction } from "../shared/actions";
import type { StageCommand } from "../shared/ipc";
import type { TourStep } from "./demo";

/** Tour coordinates are written for a 1920x1080 screenshot; the renderer maps them onto any display. */
export const TOUR_FRAME: Frame = { imageWidth: 1920, imageHeight: 1080 };

const act = (action: PixieAction): StageCommand => ({ kind: "action", frame: TOUR_FRAME, action });
const say = (text: string): StageCommand => ({ kind: "say", text });

/** Played before the tour so a restart doesn't pile new drawings and speech on top of the old ones. */
export const TOUR_RESET: TourStep[] = [
  { afterMs: 0, command: act({ type: "clear" }) },
  { afterMs: 0, command: say("") },
];

/** Ctrl+Alt+D (debug builds): every drawing primitive, every screen corner, the taskbar, then home. */
export const TOUR: TourStep[] = [
  { afterMs: 0, command: say("Hi, I'm Pixie! Here's what I can do.") },
  { afterMs: 1800, command: act({ type: "point", x: 960, y: 540, label: "center" }) },
  { afterMs: 1200, command: act({ type: "circle", x: 960, y: 540, r: 70 }) },
  { afterMs: 300, command: say("I can circle things,") },
  { afterMs: 1800, command: act({ type: "arrow", x1: 560, y1: 260, x2: 900, y2: 500 }) },
  { afterMs: 300, command: say("draw arrows,") },
  { afterMs: 1600, command: act({ type: "point", x: 1860, y: 60, label: "top-right" }) },
  { afterMs: 300, command: say("fly into corners without my bubble falling off the screen,") },
  { afterMs: 2600, command: act({ type: "point", x: 1780, y: 1050, label: "taskbar" }) },
  { afterMs: 900, command: act({ type: "box", x: 1580, y: 1022, w: 320, h: 52 }) },
  { afterMs: 300, command: say("highlight the taskbar,") },
  { afterMs: 2200, command: act({ type: "point", x: 80, y: 1000, label: "bottom-left" }) },
  { afterMs: 900, command: act({ type: "underline", x: 60, y: 1040, w: 360 }) },
  { afterMs: 300, command: say("underline things,") },
  { afterMs: 2000, command: act({ type: "point", x: 90, y: 90, label: "top-left" }) },
  { afterMs: 900, command: act({ type: "note", x: 130, y: 230, text: "and leave notes!" }) },
  { afterMs: 300, command: say("and leave notes. That's the tour!") },
  { afterMs: 2500, command: act({ type: "clear" }) },
  { afterMs: 300, command: { kind: "release" } },
];
