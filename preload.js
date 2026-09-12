const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nutaan", {
  getSettings: () => ipcRenderer.invoke("store:get"),
  setSettings: (data) => ipcRenderer.invoke("store:set", data),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
  pickFile: () => ipcRenderer.invoke("dialog:pick-file"),
  prepareAttachment: (payload) => ipcRenderer.invoke("attach:prepare", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listModels: (baseUrl, apiKey, nutaanKey) => ipcRenderer.invoke("ai:list-models", { baseUrl, apiKey, nutaanKey }),
  validateNutaanKey: (key) => ipcRenderer.invoke("nutaan:validate-key", key),
  listDir: (root, relPath) => ipcRenderer.invoke("fs:list-dir", root, relPath),
  readFile: (root, relPath) => ipcRenderer.invoke("fs:read-file", root, relPath),
  writeFile: (root, relPath, content) => ipcRenderer.invoke("fs:write-file", root, relPath, content),
  editFile: (root, relPath, oldString, newString) =>
    ipcRenderer.invoke("fs:edit-file", root, relPath, oldString, newString),
  runCommand: (root, command) => ipcRenderer.invoke("proc:run-command", root, command),
  arsenal: {
    search: (options) => ipcRenderer.invoke("arsenal:search", options),
    getCategories: () => ipcRenderer.invoke("arsenal:get-categories"),
    getTool: (id) => ipcRenderer.invoke("arsenal:get-tool", id),
    quickRecon: (target, type) => ipcRenderer.invoke("arsenal:quick-recon", target, type),
  },
  osSearch: (payload) => ipcRenderer.invoke("os:search", payload),
  osOpen: (target) => ipcRenderer.invoke("os:open", target),
  osRead: (payload) => ipcRenderer.invoke("os:read", payload),
  onOsSearchProgress: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("os:search-progress", listener);
    return () => ipcRenderer.removeListener("os:search-progress", listener);
  },
  kbList: () => ipcRenderer.invoke("kb:list"),
  kbAdd: (payload) => ipcRenderer.invoke("kb:add", payload),
  kbRemove: (id) => ipcRenderer.invoke("kb:remove", id),
  kbSearch: (payload) => ipcRenderer.invoke("kb:search", payload),
  onKbProgress: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("kb:progress", listener);
    return () => ipcRenderer.removeListener("kb:progress", listener);
  },
  gitStatus: (root) => ipcRenderer.invoke("git:status", root),
  gitPush: (root) => ipcRenderer.invoke("git:push", root),
  gitChanges: (root) => ipcRenderer.invoke("git:changes", root),
  gitCommit: (payload) => ipcRenderer.invoke("git:commit", payload),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  onUpdateStatus: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },

  sendAgentMessage: (payload) => ipcRenderer.send("agent:send", payload),
  stopAgent: () => ipcRenderer.send("agent:stop"),
  respondToPermission: (id, approved) => ipcRenderer.send("agent:permission-response", { id, approved }),
  respondToBrowserAction: (id, result) => ipcRenderer.send("agent:browser-action-response", { id, result }),
  onAgentEvent: (channel, callback) => {
    const valid = [
      "agent:assistant-delta",
      "agent:reasoning-delta",
      "agent:tool-pending",
      "agent:usage",
      "agent:tasks",
      "agent:tasks-update",
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
});
