import { contextBridge, ipcRenderer } from "electron";
import { IPC, type CursorSample, type PixieBridge, type StageCommand } from "../shared/ipc";

const bridge: PixieBridge = {
  onCursor(cb) {
    ipcRenderer.on(IPC.cursor, (_event, s: CursorSample) => cb(s));
  },
  onStage(cb) {
    ipcRenderer.on(IPC.stage, (_event, c: StageCommand) => cb(c));
  },
};

contextBridge.exposeInMainWorld("pixie", bridge);
