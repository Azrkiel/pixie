import { Menu, Tray, nativeImage, type NativeImage } from "electron";

/** 32x32 purple dot drawn in code, so the repo needs no binary icon until Phase 6. */
function makeDotIcon(): NativeImage {
  const size = 32;
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const r = size / 2 - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const a = Math.max(0, Math.min(1, r - Math.hypot(x - c, y - c) + 0.5)); // 1px anti-aliased edge
      const i = (y * size + x) * 4;
      // Windows bitmaps are premultiplied BGRA. Colour #7c5cff.
      buf[i] = Math.round(0xff * a);
      buf[i + 1] = Math.round(0x5c * a);
      buf[i + 2] = Math.round(0x7c * a);
      buf[i + 3] = Math.round(0xff * a);
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size });
}

export function createTray(handlers: { toggle: () => void; quit: () => void }): Tray {
  const tray = new Tray(makeDotIcon());
  tray.setToolTip("Pixie");
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: "Show / hide Pixie   (Ctrl+Alt+P)", click: handlers.toggle },
      { type: "separator" },
      { label: "Quit Pixie", click: handlers.quit },
    ]),
  );
  tray.on("click", handlers.toggle);
  return tray;
}
