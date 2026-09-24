import { contextBridge, ipcRenderer } from "electron";
import { IPC, type CursorSample, type PixieBridge } from "../shared/ipc";

const bridge: PixieBridge = {
  onCursor(cb) {
    ipcRenderer.on(IPC.cursor, (_event, s: CursorSample) => cb(s));
  },
};

contextBridge.exposeInMainWorld("pixie", bridge);
