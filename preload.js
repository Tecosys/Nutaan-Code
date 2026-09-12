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
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  onUpdateStatus: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },

  setupOmniroute: (existingApiKey) => ipcRenderer.send("omniroute:setup", { existingApiKey }),
  reconnectOmniroute: (existingApiKey) => ipcRenderer.invoke("omniroute:reconnect", { existingApiKey }),
  onOmnirouteSetupLog: (callback) => {
    const listener = (_e, line) => callback(line);
    ipcRenderer.on("omniroute:setup-log", listener);
    return () => ipcRenderer.removeListener("omniroute:setup-log", listener);
  },
  onOmnirouteSetupDone: (callback) => {
    const listener = (_e, result) => callback(result);
    ipcRenderer.on("omniroute:setup-done", listener);
    return () => ipcRenderer.removeListener("omniroute:setup-done", listener);
  },

  sendAgentMessage: (payload) => ipcRenderer.send("agent:send", payload),
  stopAgent: () => ipcRenderer.send("agent:stop"),
  respondToPermission: (id, approved) => ipcRenderer.send("agent:permission-response", { id, approved }),
  respondToBrowserAction: (id, result) => ipcRenderer.send("agent:browser-action-response", { id, result }),
  onAgentEvent: (channel, callback) => {
    const valid = [
      "agent:assistant-delta",
      "agent:tool-start",
      "agent:tool-result",
      "agent:permission-request",
      "agent:browser-action",
      "agent:compacting",
      "agent:retrying",
      "agent:model-switched",
      "agent:tool-arg-stream",
      "agent:done",
      "agent:error",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  arsenal: {
    search: (options) => ipcRenderer.invoke("arsenal:search", options),
    getCategories: () => ipcRenderer.invoke("arsenal:get-categories"),
    getTool: (id) => ipcRenderer.invoke("arsenal:get-tool", id),
    quickRecon: (target, type) => ipcRenderer.invoke("arsenal:quick-recon", target, type),
  },
});
