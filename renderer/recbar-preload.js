// Preload for the floating recording controller. It gets exactly three verbs and one event —
// nothing else, because this window sits on top of whatever the user is recording.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("recbar", {
  act: (action) => ipcRenderer.send("studio:recbar-action", action),
  onState: (callback) => {
    ipcRenderer.on("studio:recbar-state", (_e, data) => callback(data));
  },
});
