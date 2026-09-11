const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nutaan", {
  getSettings: () => ipcRenderer.invoke("store:get"),
  setSettings: (data) => ipcRenderer.invoke("store:set", data),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listModels: (baseUrl, apiKey) => ipcRenderer.invoke("ai:list-models", { baseUrl, apiKey }),
  listDir: (root, relPath) => ipcRenderer.invoke("fs:list-dir", root, relPath),
  readFile: (root, relPath) => ipcRenderer.invoke("fs:read-file", root, relPath),
  writeFile: (root, relPath, content) => ipcRenderer.invoke("fs:write-file", root, relPath, content),
  editFile: (root, relPath, oldString, newString) =>
    ipcRenderer.invoke("fs:edit-file", root, relPath, oldString, newString),
  runCommand: (root, command) => ipcRenderer.invoke("proc:run-command", root, command),

  sendAgentMessage: (payload) => ipcRenderer.send("agent:send", payload),
  stopAgent: () => ipcRenderer.send("agent:stop"),
  respondToPermission: (id, approved) => ipcRenderer.send("agent:permission-response", { id, approved }),
  onAgentEvent: (channel, callback) => {
    const valid = [
      "agent:assistant-message",
      "agent:tool-start",
      "agent:tool-result",
      "agent:permission-request",
      "agent:done",
      "agent:error",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
