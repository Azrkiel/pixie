import type { PixieBridge } from "../shared/ipc";

declare global {
  interface Window {
    pixie: PixieBridge;
  }
}
