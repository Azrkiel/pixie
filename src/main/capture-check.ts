import { app, desktopCapturer, type Display } from "electron";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Dev check: grab the display at physical resolution and save a PNG. Pixie must NOT appear in it. */
export async function saveDebugScreenshot(display: Display): Promise<string> {
  const width = Math.round(display.bounds.width * display.scaleFactor);
  const height = Math.round(display.bounds.height * display.scaleFactor);
  const sources = await desktopCapturer.getSources({ types: ["screen"], thumbnailSize: { width, height } });
  const source = sources.find((s) => s.display_id === String(display.id)) ?? sources[0];
  if (!source) throw new Error("no screen source available");
  const dir = path.join(app.getPath("userData"), "debug");
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `capture-${Date.now()}.png`);
  writeFileSync(file, source.thumbnail.toPNG());
  const size = source.thumbnail.getSize();
  return `${file} (${size.width}x${size.height})`;
}
