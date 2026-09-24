import type { Vec } from "../shared/geometry";

export interface SpriteStyle {
  color: string;
  glow: string;
  size: number;
}

export const DEFAULT_STYLE: SpriteStyle = { color: "#7c5cff", glow: "rgba(124, 92, 255, 0.6)", size: 22 };

/** Draw Pixie: a glowing arrowhead whose tip sits exactly at `tip`, rotated by `angle` radians. */
export function drawPixie(ctx: CanvasRenderingContext2D, tip: Vec, angle: number, scale: number, style = DEFAULT_STYLE): void {
  const s = style.size * scale;
  ctx.save();
  ctx.translate(tip.x, tip.y);
  ctx.rotate(angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(s, s * 0.4);
  ctx.lineTo(s * 0.45, s * 0.45); // notch makes it read as a pointer, not a triangle
  ctx.lineTo(s * 0.4, s);
  ctx.closePath();
  ctx.shadowColor = style.glow;
  ctx.shadowBlur = 18;
  ctx.fillStyle = style.color;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineJoin = "round";
  ctx.lineWidth = 2;
  ctx.strokeStyle = "rgba(255, 255, 255, 0.9)";
  ctx.stroke();
  ctx.restore();
}
