const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { fileURLToPath } = require("node:url");
const path = require("node:path");

function register({ app, ipcMain }) {
  const sessions = new Map();
  const watchedOwners = new WeakSet();
  const allowedPage = path.resolve(__dirname, "../renderer/index.html");
  function owner(event) {
    let page;
    try { page = fileURLToPath(event.senderFrame.url); } catch {}
    if (!page || path.resolve(page) !== allowedPage || event.senderFrame !== event.sender.mainFrame) throw new Error("Terminal access denied");
    return event.sender;
  }
  function session(event, id) {
    const sender = owner(event);
    const value = sessions.get(id);
    if (!value || value.owner !== sender) throw new Error("Terminal session has closed");
    return value;
  }
  function close(id) {
    const value = sessions.get(id);
    if (!value) return;
    sessions.delete(id);
    try { value.pty.kill(); } catch {}
  }
  ipcMain.handle("terminal:create", (event, cwd) => {
    const sender = owner(event);
    if (!watchedOwners.has(sender)) {
      watchedOwners.add(sender);
      const cleanup = () => { for (const [id, value] of sessions) if (value.owner === sender) close(id); };
      sender.once("destroyed", cleanup);
      sender.on("did-start-navigation", (_event, _url, isInPlace, isMainFrame) => { if (isMainFrame && !isInPlace) cleanup(); });
    }
    if ([...sessions.values()].filter(s => s.owner === sender).length >= 12) throw new Error("Close a terminal before opening another");
    const shell = process.platform === "win32" ? "powershell.exe" : process.env.SHELL || "/bin/bash";
    const pty = require("node-pty").spawn(shell, process.platform === "win32" ? ["-NoLogo"] : [], {
      name: "xterm-256color", cols: 80, rows: 24,
      cwd: cwd || os.homedir(), env: { ...process.env, TERM: "xterm-256color" },
    });
    const id = randomUUID();
    sessions.set(id, { pty, owner: sender });
    const send = (data) => { if (!sender.isDestroyed()) sender.send("terminal:event", { id, ...data }); };
    pty.onData(data => send({ data }));
    pty.onExit(({ exitCode }) => { sessions.delete(id); send({ exitCode }); });
    return { id, shell: path.basename(shell), cwd: cwd || os.homedir() };
  });
  ipcMain.handle("terminal:write", (event, id, data) => {
    if (typeof data !== "string" || data.length > 1048576) throw new Error("Invalid terminal input");
    session(event, id).pty.write(data);
  });
  ipcMain.handle("terminal:resize", (event, id, cols, rows) => {
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 2 || rows < 1 || cols > 1000 || rows > 1000) return;
    session(event, id).pty.resize(cols, rows);
  });
  ipcMain.handle("terminal:close", (event, id) => { session(event, id); close(id); });
  app.on("before-quit", () => { for (const id of sessions.keys()) close(id); });
}
module.exports = { register };
