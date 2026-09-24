import { app, session } from "electron";

/** Deny-by-default hardening from Electron's security checklist: permissions, navigation, new windows. */
export function hardenElectron(): void {
  // Phase 4 re-allows `media` (microphone) for Pixie's own pages only.
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);

  app.on("web-contents-created", (_event, contents) => {
    // Pages are loaded programmatically (loadFile), which doesn't fire will-navigate; any page-initiated navigation is foreign.
    contents.on("will-navigate", (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: "deny" }));
  });
}
