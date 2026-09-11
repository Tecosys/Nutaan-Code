(function () {
  const DEFAULT_BASE_URL = "http://localhost:20128/v1";

  const el = (id) => document.getElementById(id);
  const thread = el("thread");
  const emptyState = el("emptyState");
  const emptyHint = el("emptyHint");
  const input = el("input");
  const sendBtn = el("sendBtn");
  const statusDot = el("statusDot");
  const statusText = el("statusText");
  const modelSelect = el("modelSelect");
  const settingsBtn = el("settingsBtn");
  const settingsOverlay = el("settingsOverlay");
  const baseUrlInput = el("baseUrlInput");
  const apiKeyInput = el("apiKeyInput");
  const settingsSave = el("settingsSave");
  const settingsCancel = el("settingsCancel");
  const newChatBtn = el("newChatBtn");
  const openFolderBtn = el("openFolderBtn");
  const projectPathEl = el("projectPath");
  const fileTreeEl = el("fileTree");
  const dashboardLink = el("dashboardLink");

  let settings = { baseUrl: DEFAULT_BASE_URL, apiKey: "", model: "auto", projectPath: null };
  let apiMessages = [];
  let running = false;
  const toolCards = new Map();

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function scrollToBottom() {
    thread.parentElement.scrollTop = thread.parentElement.scrollHeight;
  }

  function renderEmptyVisibility() {
    const hasContent = thread.querySelectorAll(".row, .tool-card, .permission-card").length > 0;
    emptyState.hidden = hasContent;
  }

  function renderMarkdownLite(text) {
    const parts = String(text).split(/```(\w*)\n?([\s\S]*?)```/g);
    let html = "";
    for (let i = 0; i < parts.length; i += 3) {
      html += escapeHtml(parts[i] || "");
      const lang = parts[i + 1];
      const code = parts[i + 2];
      if (code !== undefined) {
        html += `<pre class="code-block">${lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : ""}<code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
      }
    }
    return html.replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function appendBubble(role, content) {
    const row = document.createElement("div");
    row.className = "row " + role;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = role === "assistant" ? renderMarkdownLite(content) : escapeHtml(content);
    row.appendChild(bubble);
    thread.appendChild(row);
    renderEmptyVisibility();
    scrollToBottom();
    return bubble;
  }

  function appendToolCard(id, name, args) {
    const wrap = document.createElement("div");
    wrap.className = "tool-card pending";
    wrap.innerHTML = `<div class="tool-title">${toolLabel(name, args)}</div>`;
    thread.appendChild(wrap);
    toolCards.set(id, wrap);
    renderEmptyVisibility();
    scrollToBottom();
  }

  function toolLabel(name, args) {
    if (name === "list_dir") return `Listing <code>${escapeHtml(args.path || ".")}</code>`;
    if (name === "read_file") return `Reading <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "search_files") return `Searching for <code>${escapeHtml(args.pattern || "")}</code>`;
    if (name === "write_file") return `Writing <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "edit_file") return `Editing <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "run_command") return `Running command`;
    return escapeHtml(name);
  }

  function diffHtml(diff) {
    const oldLines = String(diff.oldString || "").split("\n").map((l) => `<div class="diff-line diff-del">- ${escapeHtml(l)}</div>`);
    const newLines = String(diff.newString || "").split("\n").map((l) => `<div class="diff-line diff-add">+ ${escapeHtml(l)}</div>`);
    return `<pre class="diff">${oldLines.join("")}${newLines.join("")}</pre>`;
  }

  function appendPermissionCard(req) {
    const wrap = document.createElement("div");
    wrap.className = "permission-card";
    const body = req.diff ? diffHtml(req.diff) : `<pre>${escapeHtml(req.detail || "")}</pre>`;
    wrap.innerHTML = `
      <div class="perm-title">${toolLabel(req.name, req.args)} — needs your approval</div>
      ${body}
      <div class="permission-actions">
        <button class="btn-approve">Approve</button>
        <button class="btn-deny">Deny</button>
      </div>
    `;
    wrap.querySelector(".btn-approve").addEventListener("click", () => {
      window.nutaan.respondToPermission(req.id, true);
      wrap.classList.add("resolved");
      wrap.querySelector(".permission-actions").insertAdjacentHTML("afterend", '<div class="perm-result">Approved</div>');
    });
    wrap.querySelector(".btn-deny").addEventListener("click", () => {
      window.nutaan.respondToPermission(req.id, false);
      wrap.classList.add("resolved");
      wrap.querySelector(".permission-actions").insertAdjacentHTML("afterend", '<div class="perm-result">Denied</div>');
    });
    thread.appendChild(wrap);
    toolCards.set(req.id, wrap);
    renderEmptyVisibility();
    scrollToBottom();
  }

  function resolveToolCard(id, name, result) {
    const cardEl = toolCards.get(id);
    if (!cardEl) return;
    const isError = result && result.error;
    if (cardEl.classList.contains("permission-card")) {
      const resultLine = cardEl.querySelector(".perm-result");
      if (resultLine && isError) resultLine.textContent += ` — ${result.error}`;
      return;
    }
    cardEl.classList.remove("pending");
    cardEl.classList.add(isError ? "err" : "ok");
    if (isError) {
      cardEl.innerHTML += `<pre>${escapeHtml(result.error)}</pre>`;
    } else if (name === "read_file" && result.content) {
      const preview = result.content.length > 600 ? result.content.slice(0, 600) + "\n…" : result.content;
      cardEl.innerHTML += `<pre>${escapeHtml(preview)}</pre>`;
    } else if (name === "run_command") {
      const out = (result.stdout || "") + (result.stderr ? "\n" + result.stderr : "");
      if (out.trim()) cardEl.innerHTML += `<pre>${escapeHtml(out.slice(0, 800))}</pre>`;
    } else if (name === "search_files" && result.matches) {
      const lines = result.matches.slice(0, 30).map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
      cardEl.innerHTML += `<pre>${escapeHtml(lines || "No matches")}${result.truncated ? "\n…" : ""}</pre>`;
    }
    scrollToBottom();
  }

  function setStatus(ok, text) {
    statusDot.className = "dot " + (ok === null ? "" : ok ? "online" : "offline");
    statusText.textContent = text;
  }

  async function refreshModels() {
    const res = await window.nutaan.listModels(settings.baseUrl, settings.apiKey);
    if (!res.ok) {
      setStatus(false, settings.apiKey ? "Connection failed" : "No API key set");
      return;
    }
    setStatus(true, "Connected");
    const current = modelSelect.value;
    modelSelect.innerHTML = "";
    const auto = document.createElement("option");
    auto.value = "auto";
    auto.textContent = "auto (let OmniRoute pick)";
    modelSelect.appendChild(auto);
    for (const id of res.models) {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = id;
      modelSelect.appendChild(opt);
    }
    modelSelect.value = [...modelSelect.options].some((o) => o.value === settings.model) ? settings.model : "auto";
  }

  function updateEmptyHint() {
    if (!settings.projectPath) {
      emptyHint.textContent = "Open a project folder to get started.";
    } else {
      emptyHint.textContent = "Ask Nutaan Code to build, fix, or explain something in " + settings.projectPath;
    }
  }

  // ---------- File tree ----------
  async function buildTreeNode(container, relPath, depth) {
    let entries;
    try {
      entries = await window.nutaan.listDir(settings.projectPath, relPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = 8 + depth * 14 + "px";
      row.innerHTML = `<span class="chev">${entry.isDir ? "▸" : ""}</span><span>${entry.isDir ? "📁" : "📄"} ${escapeHtml(entry.name)}</span>`;
      container.appendChild(row);

      if (entry.isDir) {
        const childWrap = document.createElement("div");
        childWrap.className = "tree-children";
        childWrap.hidden = true;
        container.appendChild(childWrap);
        let loaded = false;
        row.addEventListener("click", async () => {
          childWrap.hidden = !childWrap.hidden;
          row.querySelector(".chev").textContent = childWrap.hidden ? "▸" : "▾";
          if (!loaded) {
            loaded = true;
            const childPath = relPath === "." ? entry.name : relPath + "/" + entry.name;
            await buildTreeNode(childWrap, childPath, depth + 1);
          }
        });
      } else {
        row.addEventListener("click", () => {
          const filePath = relPath === "." ? entry.name : relPath + "/" + entry.name;
          input.value = (input.value ? input.value + " " : "") + filePath;
          input.focus();
        });
      }
    }
  }

  async function refreshTree() {
    fileTreeEl.innerHTML = "";
    if (!settings.projectPath) return;
    await buildTreeNode(fileTreeEl, ".", 0);
  }

  // ---------- Agent conversation ----------
  function systemPrompt() {
    return [
      "You are Nutaan Code, a careful personal coding assistant running as a desktop app on the user's own machine.",
      `The current project root is: ${settings.projectPath}`,
      "You have tools to list directories, read files, write files, edit files (exact string replace), and run shell commands, all scoped to the project root.",
      "Prefer edit_file over write_file for existing files, and only change what's needed.",
      "write_file, edit_file, and run_command require the user's explicit approval before they execute — expect some to be denied, and adapt.",
      "Explain briefly what you're about to do before taking actions that change files or run commands.",
    ].join("\n");
  }

  function resetConversation() {
    apiMessages = [{ role: "system", content: systemPrompt() }];
    thread.innerHTML = "";
    thread.appendChild(emptyState);
    toolCards.clear();
    renderEmptyVisibility();
    updateEmptyHint();
  }

  function setRunning(value) {
    running = value;
    sendBtn.textContent = value ? "Stop" : "Send";
    sendBtn.classList.toggle("stop", value);
  }

  function sendMessage() {
    const text = input.value.trim();
    if (running) {
      window.nutaan.stopAgent();
      return;
    }
    if (!text) return;
    if (!settings.projectPath) {
      appendBubble("error", "Open a project folder first (top-left button).");
      return;
    }
    if (apiMessages.length === 0) apiMessages = [{ role: "system", content: systemPrompt() }];

    apiMessages.push({ role: "user", content: text });
    appendBubble("user", text);
    input.value = "";
    input.style.height = "auto";
    setRunning(true);

    window.nutaan.sendAgentMessage({
      root: settings.projectPath,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      messages: apiMessages,
    });
  }

  window.nutaan.onAgentEvent("agent:assistant-message", ({ content }) => {
    appendBubble("assistant", content);
  });

  window.nutaan.onAgentEvent("agent:tool-start", ({ id, name, args }) => {
    if (name === "list_dir" || name === "read_file" || name === "search_files") appendToolCard(id, name, args);
  });

  window.nutaan.onAgentEvent("agent:permission-request", (req) => {
    appendPermissionCard(req);
  });

  window.nutaan.onAgentEvent("agent:tool-result", ({ id, name, result }) => {
    resolveToolCard(id, name, result);
  });

  window.nutaan.onAgentEvent("agent:done", ({ messages }) => {
    if (messages) apiMessages = messages;
    setRunning(false);
  });

  window.nutaan.onAgentEvent("agent:error", ({ message }) => {
    appendBubble("error", message);
    setRunning(false);
  });

  // ---------- Wiring ----------
  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", () => {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 160) + "px";
  });

  modelSelect.addEventListener("change", async () => {
    settings.model = modelSelect.value;
    await window.nutaan.setSettings(settings);
  });

  newChatBtn.addEventListener("click", resetConversation);

  openFolderBtn.addEventListener("click", async () => {
    const picked = await window.nutaan.pickFolder();
    if (!picked) return;
    settings.projectPath = picked;
    await window.nutaan.setSettings(settings);
    projectPathEl.textContent = picked;
    projectPathEl.title = picked;
    await refreshTree();
    resetConversation();
  });

  settingsBtn.addEventListener("click", () => {
    baseUrlInput.value = settings.baseUrl;
    apiKeyInput.value = settings.apiKey;
    settingsOverlay.hidden = false;
  });
  settingsCancel.addEventListener("click", () => { settingsOverlay.hidden = true; });
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.hidden = true;
  });
  settingsSave.addEventListener("click", async () => {
    settings.baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL;
    settings.apiKey = apiKeyInput.value.trim();
    await window.nutaan.setSettings(settings);
    settingsOverlay.hidden = true;
    refreshModels();
  });
  dashboardLink.addEventListener("click", (e) => {
    e.preventDefault();
    const dashboardUrl = settings.baseUrl.replace(/\/v1\/?$/, "");
    window.nutaan.openExternal(dashboardUrl);
  });

  // ---------- Init ----------
  (async function init() {
    const saved = await window.nutaan.getSettings();
    settings = { ...settings, ...saved };
    if (settings.projectPath) {
      projectPathEl.textContent = settings.projectPath;
      projectPathEl.title = settings.projectPath;
      await refreshTree();
    }
    resetConversation();
    if (modelSelect) modelSelect.value = settings.model || "auto";
    await refreshModels();
  })();
})();
