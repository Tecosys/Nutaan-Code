const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("nutaan", {
  terminal: {
    create: (cwd) => ipcRenderer.invoke("terminal:create", cwd),
    write: (id, data) => ipcRenderer.invoke("terminal:write", id, data),
    resize: (id, cols, rows) => ipcRenderer.invoke("terminal:resize", id, cols, rows),
    close: (id) => ipcRenderer.invoke("terminal:close", id),
    onEvent: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("terminal:event", listener);
      return () => ipcRenderer.removeListener("terminal:event", listener);
    },
  },
  getSettings: () => ipcRenderer.invoke("store:get"),
  setSettings: (data) => ipcRenderer.invoke("store:set", data),
  pickFolder: () => ipcRenderer.invoke("dialog:pick-folder"),
  pickFile: () => ipcRenderer.invoke("dialog:pick-file"),
  prepareAttachment: (payload) => ipcRenderer.invoke("attach:prepare", payload),
  openExternal: (url) => ipcRenderer.invoke("shell:open-external", url),
  listModels: (baseUrl, apiKey, nutaanKey) => ipcRenderer.invoke("ai:list-models", { baseUrl, apiKey, nutaanKey }),
  providerListModels: (baseUrl, apiKey, type) => ipcRenderer.invoke("provider:list-models", { baseUrl, apiKey, type }),
  testModels: (payload) => ipcRenderer.invoke("ai:test-models", payload),
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
  bgTasks: {
    start: (root, command) => ipcRenderer.invoke("bgtask:start", root, command),
    list: () => ipcRenderer.invoke("bgtask:list"),
    get: (id) => ipcRenderer.invoke("bgtask:get", id),
    stop: (id) => ipcRenderer.invoke("bgtask:stop", id),
  },
  tools: {
    status: () => ipcRenderer.invoke("tools:status"),
    catalog: () => ipcRenderer.invoke("tools:catalog"),
    setEnabled: (id, enabled) => ipcRenderer.invoke("tools:set-enabled", id, enabled),
    saveConfig: (id, config) => ipcRenderer.invoke("tools:save-config", id, config),
    connect: (id) => ipcRenderer.invoke("tools:connect", id),
    authorize: (id) => ipcRenderer.invoke("tools:authorize", id),
    signOut: (id) => ipcRenderer.invoke("tools:sign-out", id),
    addCustom: (spec) => ipcRenderer.invoke("tools:add-custom", spec),
    removeCustom: (id) => ipcRenderer.invoke("tools:remove-custom", id),
    onStatus: (callback) => {
      const listener = (_e, data) => callback(data);
      ipcRenderer.on("tools:status", listener);
      return () => ipcRenderer.removeListener("tools:status", listener);
    },
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
  gitBranches: (root) => ipcRenderer.invoke("git:branches", root),
  gitSwitchBranch: (root, name) => ipcRenderer.invoke("git:switch-branch", root, name),
  gitDiffFile: (root, relPath) => ipcRenderer.invoke("git:diff-file", root, relPath),
  gitPush: (root) => ipcRenderer.invoke("git:push", root),
  gitChanges: (root) => ipcRenderer.invoke("git:changes", root),
  gitCommit: (payload) => ipcRenderer.invoke("git:commit", payload),
  getPaths: () => ipcRenderer.invoke("app:paths"),
  getVersion: () => ipcRenderer.invoke("app:get-version"),
  checkForUpdates: () => ipcRenderer.invoke("app:check-for-updates"),
  openReleases: () => ipcRenderer.invoke("app:open-releases"),
  onUpdateStatus: (callback) => {
    const listener = (_e, data) => callback(data);
    ipcRenderer.on("app:update-status", listener);
    return () => ipcRenderer.removeListener("app:update-status", listener);
  },

  // AgentBridge MITM proxy
  mitm: {
    status: () => ipcRenderer.invoke("mitm:status"),
    start: (payload) => ipcRenderer.invoke("mitm:start", payload),
    stop: () => ipcRenderer.invoke("mitm:stop"),
    detectAgents: () => ipcRenderer.invoke("mitm:detect-agents"),
  },

  // Nutaan OmniRoute Universal AI Gateway
  gateway: {
    status: () => ipcRenderer.invoke("gateway:status"),
    start: (options) => ipcRenderer.invoke("gateway:start", options),
    stop: () => ipcRenderer.invoke("gateway:stop"),
    getModels: () => ipcRenderer.invoke("gateway:get-models"),
    saveConfig: (cfg) => ipcRenderer.invoke("gateway:save-config", cfg),
    authIntercept: (provider) => ipcRenderer.invoke("gateway:auth-intercept", provider),
  },

  // Import setup from other AI coding tools on this device (Claude Code, Codex, Antigravity…)
  import: {
    detect: () => ipcRenderer.invoke("import:detect"),
    apply: (payload) => ipcRenderer.invoke("import:apply", payload),
  },

  // ---- autonomous layer ----
  workers: {
    list: () => ipcRenderer.invoke("workers:list"),
    create: (spec) => ipcRenderer.invoke("workers:create", spec),
    update: (id, patch) => ipcRenderer.invoke("workers:update", id, patch),
    remove: (id) => ipcRenderer.invoke("workers:remove", id),
    runNow: (id) => ipcRenderer.invoke("workers:run-now", id),
    stop: (id) => ipcRenderer.invoke("workers:stop", id),
    updates: (limit) => ipcRenderer.invoke("workers:updates", limit),
    markRead: (ids) => ipcRenderer.invoke("workers:mark-read", ids),
    clearUpdates: () => ipcRenderer.invoke("workers:clear-updates"),
  },
  swarm: {
    start: (payload) => ipcRenderer.invoke("swarm:start", payload),
    stop: (runId) => ipcRenderer.invoke("swarm:stop", runId),
    list: () => ipcRenderer.invoke("swarm:list"),
    get: (runId) => ipcRenderer.invoke("swarm:get", runId),
  },
  healer: {
    view: (root) => ipcRenderer.invoke("healer:view", root),
    setMode: (mode) => ipcRenderer.invoke("healer:set-mode", mode),
    configure: (root, patch) => ipcRenderer.invoke("healer:configure", root, patch),
    scan: (root) => ipcRenderer.invoke("healer:scan", root),
    repair: (id) => ipcRenderer.invoke("healer:repair", id),
    stopRepair: (id) => ipcRenderer.invoke("healer:stop-repair", id),
    ignore: (id) => ipcRenderer.invoke("healer:ignore", id),
    clear: () => ipcRenderer.invoke("healer:clear"),
    signal: (sig) => ipcRenderer.send("healer:signal", sig),
  },
  monitor: {
    view: (opts) => ipcRenderer.invoke("monitor:view", opts),
    addSite: (payload) => ipcRenderer.invoke("monitor:add-site", payload),
    removeSite: (id) => ipcRenderer.invoke("monitor:remove-site", id),
    updateSite: (id, patch) => ipcRenderer.invoke("monitor:update-site", id, patch),
    checkSite: (id) => ipcRenderer.invoke("monitor:check-site", id),
    scanNow: () => ipcRenderer.invoke("monitor:scan-now"),
    setEnabled: (on) => ipcRenderer.invoke("monitor:set-enabled", on),
    markRead: () => ipcRenderer.invoke("monitor:mark-read"),
    clearEvents: () => ipcRenderer.invoke("monitor:clear-events"),
    cleanup: (opts) => ipcRenderer.invoke("storage:cleanup", opts),
  },
  reclaim: {
    scan: (opts) => ipcRenderer.invoke("reclaim:scan", opts),
    plan: (paths) => ipcRenderer.invoke("reclaim:plan", paths),
    authorize: (paths) => ipcRenderer.invoke("reclaim:authorize", paths),
    apply: (paths, token) => ipcRenderer.invoke("reclaim:apply", { paths, token }),
    uninstall: (id) => ipcRenderer.invoke("reclaim:uninstall", id),
    onProgress: (callback) => {
      const listener = (_e, data) => callback(data);
      ipcRenderer.on("reclaim:progress", listener);
      return () => ipcRenderer.removeListener("reclaim:progress", listener);
    },
    // The agent cannot delete anything; it can only ask for this sheet to be opened.
    onReview: (callback) => {
      const listener = (_e, data) => callback(data);
      ipcRenderer.on("reclaim:review", listener);
      return () => ipcRenderer.removeListener("reclaim:review", listener);
    },
  },
  // Motion export: the main process renders the frames, this window encodes them.
  motion: {
    onEncode: (cb) => ipcRenderer.on("motion:encode", (_e, job) => cb(job)),
    encoded: (payload) => ipcRenderer.invoke("motion:encoded", payload),
  },
  skills: {
    list: (root) => ipcRenderer.invoke("skills:list", root),
    openFolder: (dir) => ipcRenderer.invoke("skills:open-folder", dir),
  },
  design: {
    list: () => ipcRenderer.invoke("design:list"),
    presets: () => ipcRenderer.invoke("design:presets"),
    takes: () => ipcRenderer.invoke("design:takes"),
    create: (spec) => ipcRenderer.invoke("design:create", spec),
    read: (id) => ipcRenderer.invoke("design:read", id),
    remove: (id) => ipcRenderer.invoke("design:remove", id),
    rename: (id, name) => ipcRenderer.invoke("design:rename", id, name),
    addArtboard: (id, spec) => ipcRenderer.invoke("design:add-artboard", id, spec),
    setArtboard: (id, boardId, patch) => ipcRenderer.invoke("design:set-artboard", id, boardId, patch),
    removeArtboard: (id, boardId) => ipcRenderer.invoke("design:remove-artboard", id, boardId),
    setCanvas: (id, canvas) => ipcRenderer.invoke("design:set-canvas", id, canvas),
    verifyBoard: (payload) => ipcRenderer.invoke("design:verify", payload),
    setBrand: (id, patch) => ipcRenderer.invoke("design:set-brand", id, patch),
    pickLogo: (id) => ipcRenderer.invoke("design:pick-logo", id),
    export: (payload) => ipcRenderer.invoke("design:export", payload),
    onChanged: (callback) => {
      const listener = (_e, data) => callback(data);
      ipcRenderer.on("design:changed", listener);
      return () => ipcRenderer.removeListener("design:changed", listener);
    },
  },
  today: (payload) => ipcRenderer.invoke("today:build", payload),
  projectOpened: (root) => ipcRenderer.send("project:opened", root),
  onAutonomousEvent: (channel, callback) => {
    const valid = ["workers:changed", "workers:update", "workers:run", "swarm:event", "swarm:launched", "healer:changed", "healer:incident", "healer:activity", "healer:health", "healer:repair-done", "monitor:changed", "design:opened", "design:changed"];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  // ---- Demo Studio ----
  studio: {
    sources: () => ipcRenderer.invoke("studio:sources"),
    cursorStart: (payload) => ipcRenderer.invoke("studio:cursor-start", payload),
    cursorStop: (session) => ipcRenderer.invoke("studio:cursor-stop", session),
    hotkeys: (on) => ipcRenderer.invoke("studio:hotkeys", on),
    window: (action) => ipcRenderer.invoke("studio:window", action),
    recBar: (show) => ipcRenderer.invoke("studio:recbar", { show }),
    recBarState: (state) => ipcRenderer.send("studio:recbar-state", state),
    saveTake: (payload) => ipcRenderer.invoke("studio:save-take", payload),
    saveProject: (project) => ipcRenderer.invoke("studio:save-project", project),
    listProjects: () => ipcRenderer.invoke("studio:list-projects"),
    loadProject: (id) => ipcRenderer.invoke("studio:load-project", id),
    deleteProject: (id) => ipcRenderer.invoke("studio:delete-project", id),
    export: (payload) => ipcRenderer.invoke("studio:export", payload),
    reveal: (target) => ipcRenderer.invoke("studio:reveal", target),
    onHotkey: (callback) => {
      const listener = (_e, data) => callback(data);
      ipcRenderer.on("studio:hotkey", listener);
      return () => ipcRenderer.removeListener("studio:hotkey", listener);
    },
  },

  sendAgentMessage: (payload) => ipcRenderer.send("agent:send", payload),
  stopAgent: (chatId) => ipcRenderer.send("agent:stop", chatId || null),
  respondToPermission: (id, approved) => ipcRenderer.send("agent:permission-response", { id, approved }),
  outreachDecision: (payload) => ipcRenderer.send("outreach:decision", payload),
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
      "agent:outreach-review",
      "agent:file-delivered",
      "agent:browser-action",
      "agent:compacting",
      "agent:retrying",
      "agent:model-switched",
      "agent:tool-arg-stream",
      "motion:progress",
      "motion:done",
      "agent:done",
      "agent:error",
      "bgtask:update",
    ];
    if (!valid.includes(channel)) return () => {};
    const listener = (_e, data) => callback(data);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
