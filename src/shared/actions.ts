/** The screenshot an action's coordinates refer to. Every action coordinate is in this image's pixels. */
export interface Frame {
  imageWidth: number;
  imageHeight: number;
}

/** Everything Pixie can do on screen. Mirrors the inline tag grammar in PLAN.md section 6. */
export type PixieAction =
  | { type: "point"; x: number; y: number; label?: string }
  | { type: "circle"; x: number; y: number; r: number }
  | { type: "box"; x: number; y: number; w: number; h: number }
  | { type: "arrow"; x1: number; y1: number; x2: number; y2: number }
  | { type: "underline"; x: number; y: number; w: number }
  | { type: "note"; x: number; y: number; text: string }
  | { type: "clear" };
