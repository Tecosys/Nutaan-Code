(() => {
  const body = document.getElementById("terminalBody");
  const tasks = body.querySelector(".term-layout");
  tasks.hidden = true;
  const toolbar = document.createElement("div");
  toolbar.className = "shell-toolbar";
  toolbar.innerHTML = '<select aria-label="Terminal session"></select><button type="button" title="New terminal">+</button><button type="button" title="Close terminal">Close session</button><button type="button" aria-pressed="false">Tasks</button><button type="button" title="Expand terminal" aria-pressed="false">⤢</button>';
  const host = document.createElement("div");
  host.className = "shell-host";
  body.prepend(toolbar, host);
  const [add, close, taskToggle, expand] = toolbar.querySelectorAll("button");
  const select = toolbar.querySelector("select");
  const sessions = new Map();
  let selected = null, cwd = null, creating = false, sequence = 0;
  function fit() {
    const s = sessions.get(selected);
    if (!s || body.hidden || host.hidden || !host.clientWidth) return;
    s.fit.fit();
    if (!s.exited) window.nutaan.terminal.resize(selected, s.term.cols, s.term.rows).catch(() => {});
  }
  function choose(id) {
    selected = id;
    select.value = id || "";
    for (const [key, s] of sessions) s.element.hidden = key !== id;
    fit();
    sessions.get(id)?.term.focus();
  }
  async function create() {
    if (creating) return;
    creating = true;
    try {
      const info = await window.nutaan.terminal.create(cwd);
      const element = document.createElement("div");
      element.className = "shell-session";
      host.appendChild(element);
      const term = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: 'Consolas, monospace', scrollback: 10000, theme: { background: "#0b0c10", foreground: "#e2e4eb" } });
      const fitAddon = new FitAddon.FitAddon();
      term.loadAddon(fitAddon);
      term.open(element);
      sessions.set(info.id, { term, fit: fitAddon, element, exited: false });
      const option = new Option(`${info.shell} · ${++sequence}`, info.id);
      option.title = info.cwd;
      select.add(option);
      term.onData(data => window.nutaan.terminal.write(info.id, data).catch(() => {}));
      taskToggle.setAttribute("aria-pressed", "false");
      tasks.hidden = true; host.hidden = false;
      choose(info.id);
    } catch (error) {
      const message = document.createElement("div");
      message.className = "term-empty";
      message.textContent = `Cannot start terminal: ${error.message}`;
      host.appendChild(message);
    } finally { creating = false; }
  }
  window.nutaan.terminal.onEvent(event => {
    const s = sessions.get(event.id);
    if (!s) return;
    if (event.data) s.term.write(event.data);
    if (event.exitCode !== undefined) { s.exited = true; s.term.writeln(`\r\n[Shell exited: ${event.exitCode}. Use + to open a new terminal.]`); }
  });
  window.addEventListener("terminal:open", event => {
    cwd = event.detail.cwd;
    if (!sessions.size) create();
    else requestAnimationFrame(fit);
  });
  add.addEventListener("click", create);
  select.addEventListener("change", () => choose(select.value));
  close.addEventListener("click", async () => {
    const id = selected, s = sessions.get(id);
    if (!s) return;
    if (!s.exited) await window.nutaan.terminal.close(id).catch(() => {});
    s.term.dispose(); s.element.remove(); sessions.delete(id);
    [...select.options].find(o => o.value === id)?.remove();
    choose(sessions.keys().next().value || null);
  });
  taskToggle.addEventListener("click", () => {
    tasks.hidden = !tasks.hidden; host.hidden = !tasks.hidden;
    taskToggle.setAttribute("aria-pressed", String(!tasks.hidden));
    fit();
  });
  expand.addEventListener("click", () => {
    const expanded = body.closest("section").classList.toggle("terminal-expanded");
    expand.setAttribute("aria-pressed", String(expanded)); fit();
  });
  new ResizeObserver(fit).observe(host);
})();
