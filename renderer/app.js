(function () {
  const el = (id) => document.getElementById(id);

  // Windows draws the min/max/close overlay on the frameless window; the topbar keeps its
  // interactive children clear of that strip via this class.
  if (/Win/i.test(navigator.userAgent || "")) document.documentElement.classList.add("platform-win");

  // ---------- Elements ----------
  const appEl = el("app");
  const thread = el("thread");
  const threadScroll = el("threadScroll");
  const emptyState = el("emptyState");
  const coworkerHero = el("coworkerHero");
  const quickGrid = el("quickGrid");
  const openProjectLink = el("openProjectLink");
  const openProjectLinkLabel = el("openProjectLinkLabel");
  const input = el("input");
  const sendBtn = el("sendBtn");
  const attachRow = el("attachRow");

  const projectBtn = el("projectBtn");
  const projectBtnLabel = el("projectBtnLabel");
  const projectMenu = el("projectMenu");
  const branchChip = el("branchChip");
  const branchName = el("branchName");
  const syncDot = el("syncDot");
  const syncLabel = el("syncLabel");
  const pushBtn = el("pushBtn");
  const pushLabel = el("pushLabel");

  const autoApproveBtn = el("autoApproveBtn");
  const sidebarToggleBtn = el("sidebarToggleBtn");
  const panelToggleBtn = el("panelToggleBtn");
  const settingsBtn = el("settingsBtn");

  const navList = el("navList");
  const explorerLabel = el("explorerLabel");
  const refreshTreeBtn = el("refreshTreeBtn");
  const refreshIcon = el("refreshIcon");
  const filesView = el("filesView");
  const chatsView = el("chatsView");
  const treeProjectRow = el("treeProjectRow");
  const treeProjectName = el("treeProjectName");
  const newChatBtn = el("newChatBtn");
  const fileTreeEl = el("fileTree");
  const recentList = el("recentList");
  const statusDot = el("statusDot");
  const statusText = el("statusText");

  const attachBtn = el("attachBtn");
  const contextBtn = el("contextBtn");
  const contextMenu = el("contextMenu");
  const slashBtn = el("slashBtn");
  const slashMenu = el("slashMenu");
  const modelBadge = el("modelBadge");
  const modelBadgeLabel = el("modelBadgeLabel");
  const modelMenu = el("modelMenu");

  const workspace = el("workspace");
  const resizer = el("resizer");
  const panel = el("panel");
  const fileTabs = el("fileTabs");
  const browserTabsEl = el("browserTabs");
  const segCode = el("segCode");
  const segBrowser = el("segBrowser");
  const segTerminal = el("segTerminal");
  const segTerminalBadge = el("segTerminalBadge");
  const terminalBody = el("terminalBody");
  const termTaskList = el("termTaskList");
  const termOutput = el("termOutput");
  const termTitle = el("termTitle");
  const termStatus = el("termStatus");
  const termStopBtn = el("termStopBtn");
  const panelCloseBtn = el("panelCloseBtn");
  const codeBody = el("codeBody");
  const browserBody = el("browserBody");
  const codeBreadcrumb = el("codeBreadcrumb");
  const codeScroll = el("codeScroll");
  const codeEmpty = el("codeEmpty");
  const codeGrid = el("codeGrid");
  const codeGutter = el("codeGutter");
  const codeViewContent = el("codeViewContent");
  const codeViewToggle = el("codeViewToggle");
  const cvtDiff = el("cvtDiff");
  const cvtFile = el("cvtFile");
  const langBadge = el("langBadge");
  const langName = el("langName");
  const codeLineCount = el("codeLineCount");
  const codeCopyBtn = el("codeCopyBtn");
  const panelBranch = el("panelBranch");

  const loadbar = el("loadbar");
  const browserAddress = el("browserAddress");
  const browserBack = el("browserBack");
  const browserForward = el("browserForward");
  const browserReload = el("browserReload");
  const browserViewport = el("browserViewport");
  const deviceBtn = el("deviceBtn");
  const deviceMenu = el("deviceMenu");
  const bookmarksEl = el("bookmarks");
  const agentActivity = el("agentActivity");
  const agentActivityText = el("agentActivityText");
  const runStatus = el("runStatus");
  const runElapsed = el("runElapsed");
  const runTokens = el("runTokens");
  const runTasks = el("runTasks");
  const runTasksSep = el("runTasksSep");
  const runActivity = el("runActivity");

  const activationOverlay = el("activationOverlay");
  const activationError = el("activationError");
  const nutaanKeyInput = el("nutaanKeyInput");
  const activateBtn = el("activateBtn");
  const getKeyLink = el("getKeyLink");

  const settingsOverlay = el("settingsOverlay");
  const accountEmail = el("accountEmail");
  const changeKeyBtn = el("changeKeyBtn");
  const modelSelectSettings = el("modelSelectSettings");
  const baseUrlInput = el("baseUrlInput");
  const apiKeyInput = el("apiKeyInput");
  const imageModelInput = el("imageModelInput");
  const settingsSave = el("settingsSave");
  const settingsCancel = el("settingsCancel");
  const appVersionText = el("appVersionText");
  const checkUpdatesBtn = el("checkUpdatesBtn");

  // ---------- State ----------
  let settings = {
    baseUrl: "",
    apiKey: "",
    model: "",
    modelProviderId: "",
    imageModel: "",
    autoApprove: false,
    nutaanKey: "",
    nutaanEmail: "",
    customProviders: [], // [{ id, type, name, baseUrl, apiKey, models: [id,...] }]
  };
  let projects = [];
  let activePath = null;
  // `running` means the chat on screen is running. Other chats can be running too — a design
  // that takes five minutes keeps going while you start something else — and those live in
  // `runs`, keyed by chat id, with the last thing they did for the sidebar.
  let running = false;
  const runs = new Map(); // chatId -> { activity }
  let threadChatId = null; // the chat the thread on screen was built for
  let sidebarView = "files"; // files | chats | recent

  // Every agent event carries the chat it belongs to. Events for the chat on screen go to the
  // handlers below, which draw the thread. Events for any other chat are handled here: the run's
  // finish lands in that chat's history, and the sidebar shows what it is doing meanwhile.
  function chatById(id) {
    for (const p of projects) for (const c of p.chats) if (c.id === id) return { proj: p, chat: c };
    return null;
  }
  function backgroundEvent(channel, data) {
    const found = chatById(data.chatId);
    if (channel === "agent:done" || channel === "agent:error") {
      runs.delete(data.chatId);
      if (found) {
        if (channel === "agent:done" && data.messages) found.chat.messages = data.messages;
        if (channel === "agent:error" && data.message) found.chat.lastError = data.message;
        found.chat.updatedAt = new Date().toISOString();
        found.chat.unread = true;
        persistProjects();
      }
      renderExplorer();
      return;
    }
    const run = runs.get(data.chatId);
    if (!run) return;
    if (channel === "agent:tool-start" || channel === "agent:tool-pending") run.activity = toolLabel(data.name, data.args).replace(/<[^>]+>/g, "");
    if (channel === "agent:retrying") run.activity = "Retrying…";
    if (channel === "agent:compacting") run.activity = "Compacting…";
    renderExplorer();
  }
  const onAgentEvent = (channel, handler) =>
    window.nutaan.onAgentEvent(channel, (data) => {
      const mine = !data || !data.chatId || !activeChat() || data.chatId === activeChat().id;
      if (!mine) return backgroundEvent(channel, data);
      handler(data);
    });

  let availableModels = []; // nutaan catalog ids (legacy checks)
  let nutaanModels = [];
  let aggregatedModels = []; // [{ id, providerId, providerName }] nutaan + user-managed
  let openFiles = []; // [{ path, content }]
  let activeFilePath = null;
  let browserTabs = [];
  let activeBrowserTabId = null;
  let panelMode = "code";
  let contextFiles = null; // cached flat file list for the Add Context menu
  let contextFilesForPath = null;
  let updateButtonOpensReleases = false;
  // Autonomous layer state (workers, swarm, self-healing, today). Declared up here because
  // renderNav reads the badges.
  const autonomous = { unread: 0, openIncidents: 0, workers: [], templates: [], updates: [], health: null, swarmRoles: {}, swarmRuns: new Map(), today: null };
  let composerMode = "chat"; // chat | outcome

  const toolCards = new Map();
  const toolArgsById = new Map();
  const liveWriteCards = new Map();
  let idCounter = 0;

  const genId = () => "id" + Date.now().toString(36) + (idCounter++).toString(36);

  // Bump when the shipped backend changes in a way that makes previously-saved connection
  // settings wrong rather than merely stale.
  const BACKEND_REVISION = 3;

  // ---------- Small helpers ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  function basename(p) {
    return String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  }

  function relTime(iso) {
    if (!iso) return "";
    const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
    if (min < 1) return "Just now";
    if (min < 60) return min + "m ago";
    const hr = Math.floor(min / 60);
    if (hr < 24) return hr + "h ago";
    const day = Math.floor(hr / 24);
    if (day === 1) return "Yesterday";
    if (day < 7) return day + "d ago";
    return new Date(iso).toLocaleDateString();
  }

  function deriveChatTitle(text) {
    const t = String(text || "").trim().replace(/\s+/g, " ");
    return t.length > 48 ? t.slice(0, 48) + "…" : t || "New chat";
  }

  const activeProject = () => projects.find((p) => p.path === activePath) || null;

  function activeChat() {
    const proj = activeProject();
    if (!proj) return null;
    return proj.chats.find((c) => c.id === proj.activeChatId) || proj.chats[0] || null;
  }

  function makeChat(root, title) {
    return {
      id: genId(),
      title: title || "New chat",
      updatedAt: new Date().toISOString(),
      messages: [{ role: "system", content: systemPrompt(root) }],
    };
  }

  function scrollToBottom() {
    threadScroll.scrollTop = threadScroll.scrollHeight;
  }

  function closeAllMenus(except) {
    const plusMenu = el("plusMenu");
    for (const m of [projectMenu, contextMenu, slashMenu, modelMenu, deviceMenu, plusMenu]) {
      if (m && m !== except) m.hidden = true;
    }
  }

  // ---------- Markdown ----------
  function inlineFormat(escaped) {
    return escaped
      // [text](url) → a real link. Runs first so ** and ` inside the label still format. The URL
      // sat in the text as raw "[Edit design](https://…)" before this existed.
      .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => `<a href="${url}" target="_blank" rel="noopener" class="md-link">${label}</a>`)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "<em>$1</em>")
      .replace(/`([^`]+)`/g, "<code>$1</code>");
  }

  function isTableSeparatorLine(line) {
    return /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(line) && line.includes("-");
  }

  function parseTableRow(line) {
    let s = line.trim();
    if (s.startsWith("|")) s = s.slice(1);
    if (s.endsWith("|")) s = s.slice(0, -1);
    return s.split("|").map((c) => c.trim());
  }

  function renderMarkdownBlock(text) {
    const lines = text.split("\n");
    let html = "";
    let para = [];
    const flush = () => {
      if (para.length) {
        html += `<p>${inlineFormat(escapeHtml(para.join(" ")))}</p>`;
        para = [];
      }
    };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      const h = line.match(/^(#{1,6})\s+(.*)/);
      if (h) {
        flush();
        html += `<h${h[1].length}>${inlineFormat(escapeHtml(h[2]))}</h${h[1].length}>`;
        i++;
        continue;
      }
      if (line.includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1])) {
        flush();
        const header = parseTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
          rows.push(parseTableRow(lines[i]));
          i++;
        }
        // Wrapped so a wide table scrolls sideways instead of crushing its columns down to one
        // character per line, which is what a 6-column review table did inside the chat width.
        html +=
          '<div class="table-wrap"><table><thead><tr>' +
          header.map((c) => `<th>${inlineFormat(escapeHtml(c))}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows.map((r) => "<tr>" + r.map((c) => `<td>${inlineFormat(escapeHtml(c))}</td>`).join("") + "</tr>").join("") +
          "</tbody></table></div>";
        continue;
      }
      const ulMatch = line.match(/^\s*[-*]\s+(.*)/);
      if (ulMatch) {
        flush();
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^\s*[-*]\s+(.*)/);
          if (!m) break;
          items.push(m[1]);
          i++;
        }
        html += "<ul>" + items.map((it) => `<li>${inlineFormat(escapeHtml(it))}</li>`).join("") + "</ul>";
        continue;
      }
      const olMatch = line.match(/^\s*\d+\.\s+(.*)/);
      if (olMatch) {
        flush();
        const items = [];
        while (i < lines.length) {
          const m = lines[i].match(/^\s*\d+\.\s+(.*)/);
          if (!m) break;
          items.push(m[1]);
          i++;
        }
        html += "<ol>" + items.map((it) => `<li>${inlineFormat(escapeHtml(it))}</li>`).join("") + "</ol>";
        continue;
      }
      if (line.trim() === "") {
        flush();
        i++;
        continue;
      }
      para.push(line.trim());
      i++;
    }
    flush();
    return html;
  }

  function renderMarkdownLite(text) {
    const parts = String(text).split(/```(\w*)\n?([\s\S]*?)```/g);
    let html = "";
    for (let i = 0; i < parts.length; i += 3) {
      html += renderMarkdownBlock(parts[i] || "");
      const lang = parts[i + 1];
      const code = parts[i + 2];
      if (code !== undefined) {
        html +=
          `<pre class="code-block">` +
          `<div class="code-bar">${lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : "<span></span>"}` +
          `<button class="code-copy" type="button">Copy</button></div>` +
          `<code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
      }
    }
    return html;
  }

  // Lightweight, language-agnostic-ish highlighter for the Code tab — good enough for
  // JS/TS/JSON/CSS at a glance, not a real tokenizer.
  function highlightCode(code) {
    const escaped = escapeHtml(code);
    const placeholders = [];
    const stash = (html) => {
      const token = `STASH${placeholders.length}STASH`;
      placeholders.push(html);
      return token;
    };
    // Pass 1: pull out comments/strings first so nothing inside them gets treated as a keyword.
    const protectedText = escaped
      .replace(/(\/\/[^\n]*|#[^\n]*)/g, (m) => stash(`<span class="hl-comment">${m}</span>`))
      .replace(/("(?:[^"\\]|\\.)*?"|'(?:[^'\\]|\\.)*?'|`(?:[^`\\]|\\.)*?`)/g, (m) => stash(`<span class="hl-string">${m}</span>`));
    // Pass 2: ONE combined regex over what's left — separate sequential passes previously
    // collided with their own generated markup and corrupted the output.
    const KEYWORDS = /^(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|async|await|try|catch|default|interface|type|public|private)$/;
    const combined = /(&lt;\/?)([\w.]+)|([\w-]+)(=)(?=["])|\b(\d+\.?\d*)\b|\b([A-Za-z_]\w*)\b/g;
    const highlighted = protectedText.replace(combined, (m, tagOpen, tagName, attrName, eq, num, word) => {
      if (tagOpen) return `${tagOpen}<span class="hl-tag">${tagName}</span>`;
      if (attrName) return `<span class="hl-attr">${attrName}</span>${eq}`;
      if (num) return `<span class="hl-num">${num}</span>`;
      if (word && KEYWORDS.test(word)) return `<span class="hl-keyword">${word}</span>`;
      return m;
    });
    return highlighted.replace(/STASH(\d+)STASH/g, (_, i) => placeholders[Number(i)]);
  }

  // ---------- Activation ----------
  function showActivation(message) {
    activationError.hidden = !message;
    if (message) activationError.textContent = message;
    nutaanKeyInput.value = settings.nutaanKey || "";
    activationOverlay.hidden = false;
    setTimeout(() => nutaanKeyInput.focus(), 30);
  }

  async function activate() {
    const key = nutaanKeyInput.value.trim();
    activateBtn.disabled = true;
    activateBtn.textContent = "Checking…";
    const res = await window.nutaan.validateNutaanKey(key);
    activateBtn.disabled = false;
    activateBtn.textContent = "Activate";
    if (!res.ok) {
      activationError.hidden = false;
      activationError.textContent = res.error;
      return;
    }
    settings.nutaanKey = key;
    settings.nutaanEmail = res.email || "";
    await window.nutaan.setSettings(settings);
    activationOverlay.hidden = true;
    activationError.hidden = true;
    renderAccountRow();
    // The first time a key is accepted, ask who this is for before the app opens.
    if (!settings.onboarded) showOnboarding();
    await refreshModels();
  }

  // ---------- First run ----------
  // Two answers, both of which change the app: the role is written into every new chat's system
  // prompt so the agent explains things at the right level and picks the right defaults, and the
  // mode decides whether the code panel is on screen at all.
  const ROLES = [
    { id: "software", label: "Software / Data / AI", icon: "‹/›", mode: "coding" },
    { id: "founder", label: "Entrepreneurship / Freelancing / OPC", icon: "▲", mode: "office" },
    { id: "qa", label: "QA / Operations / Security", icon: "◈", mode: "coding" },
    { id: "product", label: "Product / Project / Solutions", icon: "▦", mode: "coding" },
    { id: "design", label: "UI / UX / Visual Design", icon: "✎", mode: "office" },
    { id: "student", label: "Students / Teaching / Research", icon: "≡", mode: "office" },
    { id: "finance", label: "Finance / Accounting / Consulting", icon: "₹", mode: "office" },
    { id: "media", label: "Media / Content Creation", icon: "▶", mode: "office" },
    { id: "ops", label: "Operations / Commerce / Customer Service", icon: "◧", mode: "office" },
    { id: "marketing", label: "Marketing / Brand / PR", icon: "◎", mode: "office" },
    { id: "legal", label: "Legal / Administration / HR", icon: "§", mode: "office" },
    { id: "other", label: "Other professions", icon: "…", mode: "office" },
  ];
  const obOverlay = el("obOverlay");
  const obNext = el("obNext");
  const obBack = el("obBack");
  let obStep = 0;
  let obRole = null;
  let obMode = "coding";

  function showOnboarding() {
    const grid = el("obRoles");
    grid.innerHTML = ROLES.map((r) =>
      `<button type="button" class="ob-role${r.id === settings.role ? " selected" : ""}" data-role="${r.id}">
         <span class="ob-role-icon">${r.icon}</span><span class="ob-role-name">${escapeHtml(r.label)}</span><span class="ob-role-radio"></span>
       </button>`).join("");
    obRole = ROLES.find((r) => r.id === settings.role) || null;
    obMode = settings.uiMode || "coding";
    obShow(0);
    obOverlay.hidden = false;
  }

  function obShow(i) {
    obStep = i;
    obOverlay.querySelectorAll(".ob-step").forEach((s) => { s.hidden = Number(s.dataset.step) !== i; });
    obOverlay.querySelectorAll(".ob-seg").forEach((s) => s.classList.toggle("on", Number(s.dataset.seg) <= i));
    obBack.hidden = i === 0;
    obNext.textContent = i === 2 ? "Finish" : "Next";
    el("obSkip").hidden = i !== 2;
    if (i === 1) obOverlay.querySelectorAll(".ob-mode").forEach((m) => m.classList.toggle("selected", m.dataset.uimode === obMode));
    el("obRightTitle").textContent = i === 0
      ? "Build, design, and get work done — with the model you already pay for."
      : i === 2
        ? "Your setup from Claude Code, Codex and Antigravity — one click, on every device."
        : obMode === "office" ? "Chat first. Code only when you ask for it." : "The whole workshop, beside the chat.";
    if (i === 2 && !obImportData) fillObImport();
  }

  // Step 2 of first run: scan the device for other AI tools and list everything importable —
  // MCP servers, global memory, project context files, and the codebases themselves.
  async function fillObImport() {
    const list = el("obImportList");
    if (!list) return;
    list.innerHTML = `<div class="import-empty">Scanning this device…</div>`;
    try { obImportData = (await window.nutaan.import.detect()) || {}; } catch { obImportData = {}; }
    if (!(obImportData.found || []).length && !(obImportData.codebases || []).length) {
      list.innerHTML = `<div class="import-empty">Nothing to bring over — no other AI coding tools were found on this device. You can always import later from Settings → Tools.</div>`;
      return;
    }
    renderImportRows(list, obImportData);
  }

  obOverlay.addEventListener("click", (e) => {
    const role = e.target.closest(".ob-role");
    if (role) {
      obRole = ROLES.find((r) => r.id === role.dataset.role) || null;
      obMode = obRole ? obRole.mode : obMode;
      obOverlay.querySelectorAll(".ob-role").forEach((b) => b.classList.toggle("selected", b === role));
      return;
    }
    const mode = e.target.closest(".ob-mode");
    if (mode) {
      obMode = mode.dataset.uimode;
      obOverlay.querySelectorAll(".ob-mode").forEach((b) => b.classList.toggle("selected", b === mode));
      el("obRightTitle").textContent = obMode === "office" ? "Chat first. Code only when you ask for it." : "The whole workshop, beside the chat.";
    }
  });
  obBack.addEventListener("click", () => obShow(obStep === 2 ? 1 : 0));
  let obImportData = null; // detect result cached when the import step opens
  obNext.addEventListener("click", async () => {
    if (obStep === 0) {
      if (!obRole) { el("obRoles").classList.add("shake"); setTimeout(() => el("obRoles").classList.remove("shake"), 400); return; }
      obShow(1);
      return;
    }
    if (obStep === 1) { obShow(2); return; }
    // Step 3 — import: bring over what is checked (and only that), then finish.
    let codebases = [];
    if (obImportData && (obImportData.found || []).length + (obImportData.codebases || []).length) {
      obNext.disabled = true; obNext.textContent = "Importing…";
      try { const res = await applyFromList(el("obImportList"), obImportData, { silent: true }); codebases = (res && res.codebases) || []; }
      catch (err) { console.warn("import failed", err); }
      obNext.disabled = false;
    }
    await finishOnboarding(codebases);
  });

  el("obSkip").addEventListener("click", () => finishOnboarding([]));

  async function finishOnboarding(codebases) {
    for (const p of codebases) {
      if (projects.some((x) => x.path.toLowerCase() === String(p).toLowerCase())) continue;
      const chat = makeChat(p);
      projects.push({ path: p, activeChatId: chat.id, chats: [chat] });
    }
    if (codebases.length) { persistProjects(); renderNav(); renderExplorer(); renderRecent(); }
    settings.role = obRole.id;
    settings.roleLabel = obRole.label;
    settings.uiMode = obMode;
    settings.onboarded = true;
    settings.importDone = true; // the offer was made here; it is not made again on launch
    await window.nutaan.setSettings(settings);
    obOverlay.hidden = true;
    applyUiMode();
    // The system prompt of the chat that is already open predates the answer; refresh it.
    const chat = activeChat();
    if (chat && chat.messages.length <= 1 && activePath) chat.messages = [{ role: "system", content: systemPrompt(activePath) }];
  }

  // ---------- Import from other AI coding tools ----------
  // Claude Code, Codex, Antigravity / Gemini CLI and Cursor keep MCP servers + memory files on
  // this machine; one dialog brings them in so the setup follows the person to every device.

  // Shared import rendering/apply — used by the standalone dialog AND the onboarding step.
  function renderImportRows(container, data) {
    const tools = (data && data.found) || [];
    const codebases = (data && data.codebases) || [];
    const projCtx = (data && data.projectContext) || [];
    if (!tools.length && !codebases.length && !projCtx.length) {
      container.innerHTML = `<div class="import-empty">Nothing found on this device yet. Install Claude Code, Codex, Antigravity or Cursor and their setup can be imported here in one click.</div>`;
      return;
    }
    let html = tools.map((tool, ti) => `
      <div class="import-tool">
        <div class="import-tool-head"><b>${escapeHtml(tool.name)}</b><span>${escapeHtml(tool.detail || "")}</span></div>
        ${tool.instructions ? `
        <label class="import-row"><input type="checkbox" checked data-imp="instr" data-tool="${ti}" />
          <span>Memory <code>${escapeHtml(tool.instructions.file)}</code><small>${escapeHtml(tool.instructions.text.slice(0, 90).replace(/\s+/g, " "))}…</small></span></label>` : ""}
        ${(tool.mcp || []).map((s, si) => `
        <label class="import-row"><input type="checkbox" checked data-imp="mcp" data-tool="${ti}" data-srv="${si}" />
          <span>MCP server <code>${escapeHtml(s.name)}</code><small>${escapeHtml(s.transport === "http" ? String(s.url) : [s.command, ...(s.args || [])].join(" "))}</small></span></label>`).join("")}
      </div>`).join("");
    if (codebases.length) {
      html += `<div class="import-tool"><div class="import-tool-head"><b>Codebases</b><span>${codebases.length} found — added as projects automatically</span></div>
        ${codebases.map((p) => `<label class="import-row"><input type="checkbox" checked data-imp="code" value="${escapeHtml(p)}" /><span>Codebase <code>${escapeHtml(basename(p))}</code><small>${escapeHtml(p)}</small></span></label>`).join("")}</div>`;
    }
    if (projCtx.length) {
      html += `<div class="import-tool"><div class="import-tool-head"><b>Project context</b><span>instructions from your repos</span></div>
        ${projCtx.map((p, pi) => `<label class="import-row"><input type="checkbox" checked data-imp="proj" data-pi="${pi}" /><span><code>${escapeHtml(p.file)}</code><small>${escapeHtml(basename(p.path))} — ${escapeHtml(p.text.slice(0, 70).replace(/\s+/g, " "))}…</small></span></label>`).join("")}</div>`;
    }
    container.innerHTML = html;
  }

  async function applyFromList(listEl, data, { silent = false } = {}) {
    const mcp = [];
    const instructions = [];
    const codebases = [];
    const projCtx = [];
    for (const box of listEl.querySelectorAll("input[data-imp]:checked")) {
      const tool = (data.found || [])[Number(box.dataset.tool)];
      if (box.dataset.imp === "instr" && tool && tool.instructions) {
        instructions.push({ source: tool.name, file: tool.instructions.file, text: tool.instructions.text });
      } else if (box.dataset.imp === "mcp" && tool && Array.isArray(tool.mcp)) {
        const s = tool.mcp[Number(box.dataset.srv)];
        if (s) mcp.push(s);
      } else if (box.dataset.imp === "code") {
        codebases.push(box.value);
      } else if (box.dataset.imp === "proj") {
        const p = (data.projectContext || [])[Number(box.dataset.pi)];
        if (p) projCtx.push(p);
      }
    }
    if (!mcp.length && !instructions.length && !projCtx.length) return { added: 0, codebases: [] };
    const res = await window.nutaan.import.apply({ mcp, instructions, projectContext: projCtx });
    if (!silent) {
      appendBubble("assistant", `Imported your setup: ${res.added || 0} MCP server${(res.added || 0) === 1 ? "" : "s"}${instructions.length ? `, ${instructions.length} memory file${instructions.length === 1 ? "" : "s"}` : ""}${projCtx.length ? `, ${projCtx.length} project context file${projCtx.length === 1 ? "" : "s"}` : ""}.${codebases.length ? ` ${codebases.length} codebase${codebases.length === 1 ? "" : "s"} added as projects.` : ""}`);
    }
    return { ...res, codebases };
  }


  // Co-worker mode keeps the code panel out of the way until something opens it, and greets the
  // person in their own terms. Coding mode is the app as it always was.
  // The greeting is the time of day and, in co-worker mode, the person's own line of work.
  function greeting() {
    const h = new Date().getHours();
    return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  }
  // The home greeting for the mode, written once here so nothing else on the page overwrites it.
  function renderHomeCopy() {
    const t = el("emptyTitle"), sub = el("emptySub");
    if (!t || !sub) return;
    if (settings.uiMode === "office") {
      t.textContent = `${greeting()} — what are we getting done?`;
      sub.textContent = settings.roleLabel ? `Your AI co-worker for ${settings.roleLabel.toLowerCase()}. It does the work and shows you the result.` : "Your AI co-worker. It does the work and shows you the result.";
    } else {
      t.innerHTML = `${greeting()}. <span class="grad-text">Build anything.</span>`;
      sub.textContent = "Your AI coding agent that understands your entire project.";
    }
  }
  function applyUiMode() {
    const office = settings.uiMode === "office";
    appEl.classList.toggle("office-mode", office);
    const today = el("todaySection");
    if (office) {
      panel.hidden = true;
      resizer.hidden = true;
      input.placeholder = "What can I take off your plate? @ to add a file, / for commands";
      if (today) today.hidden = true; // git and test cards are a coding-mode thing
    } else {
      input.placeholder = "Ask Nutaan Code anything, @ to add context, / for commands";
    }
    renderHomeCopy();
    renderQuickActions();
    placeComposer();
  }

  function renderAccountRow() {
    accountEmail.textContent = settings.nutaanEmail || (settings.nutaanKey ? "Activated" : "Not activated");
    const dot = el("accountDot");
    if (dot) dot.className = "status-dot " + (settings.nutaanKey ? "online" : "offline");
    renderProviders();
  }

  (function wireSettingsExtras() {
    const closeX = el("settingsCloseX");
    if (closeX) closeX.addEventListener("click", () => { settingsOverlay.hidden = true; });
    const reset = el("usageResetBtn");
    if (reset) reset.addEventListener("click", () => {
      settings.usageInTokens = 0;
      settings.usageOutTokens = 0;
      settings.usageRequests = 0;
      window.nutaan.setSettings(settings);
      renderUsagePanel();
    });
    // Keep the provider list / gate live as the user types a custom endpoint.
    baseUrlInput.addEventListener("input", () => renderProviders());
  })();

  activateBtn.addEventListener("click", activate);
  nutaanKeyInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") activate();
  });
  // Straight to the page that has the button, not the marketing homepage — the whole point is
  // that someone stuck on this screen should not have to go hunting for it.
  getKeyLink.addEventListener("click", () => window.nutaan.openExternal("https://nutaan.com/dev-console"));
  el("openNutaanLink").addEventListener("click", () => window.nutaan.openExternal("https://nutaan.com"));
  changeKeyBtn.addEventListener("click", () => {
    settingsOverlay.hidden = true;
    showActivation("");
  });

  // ---------- Sidebar nav ----------
  const ICONS = {
    chat: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M20 12.5a7.5 7.5 0 0 1-7.5 7.5H8l-4 3v-3.6A7.5 7.5 0 0 1 12.5 5h0A7.5 7.5 0 0 1 20 12.5z"/></svg>',
    folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    clock: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
    gear: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"><circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.2M12 18.3v2.2M3.5 12h2.2M18.3 12h2.2M6 6l1.6 1.6M16.4 16.4L18 18M18 6l-1.6 1.6M7.6 16.4L6 18" stroke-linecap="round"/></svg>',
    coworker: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="9" cy="8" r="3.2"/><path d="M3.5 19a5.5 5.5 0 0 1 11 0"/><circle cx="17.5" cy="10" r="2.2"/><path d="M15 19a4 4 0 0 1 5.8-3.6"/></svg>',
    workers: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/><path d="M4 4l2 2M20 4l-2 2"/></svg>',
    health: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3l2.5 6 5-13 2.5 7H21"/></svg>',
    design: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 5.4 5.6.6-4.2 3.9 1.2 5.6L12 15.6 6.9 18.5l1.2-5.6L4 9l5.6-.6z"/></svg>',
    studio: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5.5" width="14" height="13" rx="2.5"/><path d="M16.5 10.5l5-3v9l-5-3z"/></svg>',
  };

  function renderNav() {
    const proj = activeProject();
    const chatCount = proj ? proj.chats.length : 0;
    const defs = [
      { id: "chats", label: "Chats", icon: "chat", badge: chatCount ? String(chatCount) : "" },
      { id: "files", label: "Projects", icon: "folder", badge: projects.length ? String(projects.length) : "" },
      { id: "coworker", label: "Co-worker", icon: "coworker", badge: "" },
      { id: "workers", label: "Workers", icon: "workers", badge: autonomous.unread ? String(autonomous.unread) : "", hot: autonomous.unread > 0 },
      { id: "health", label: "Health", icon: "health", badge: autonomous.openIncidents ? String(autonomous.openIncidents) : "", hot: autonomous.openIncidents > 0, warn: true },
      { id: "design", label: "Design", icon: "design", badge: "" },
      { id: "studio", label: "Demo Studio", icon: "studio", badge: "" },
      { id: "settings", label: "Settings", icon: "gear", badge: "" },
    ];
    navList.innerHTML = "";
    const more = document.createElement("details");
    more.className = "nav-more";
    more.open = !!settings.navMoreExpanded;
    const summary = document.createElement("summary");
    summary.innerHTML =
      `<span class="nav-more-caret"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>` +
      `<span class="nav-more-label">Workspace</span>`;
    more.appendChild(summary);
    more.addEventListener("toggle", () => {
      if (!more.isConnected) return;
      if (!!settings.navMoreExpanded === more.open) return;
      settings.navMoreExpanded = more.open;
      window.nutaan.setSettings(settings).catch(console.error);
    });
    for (const d of defs) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "nav-row" + (d.id === sidebarView ? " active" : "");
      row.innerHTML =
        `<span class="nav-icon">${ICONS[d.icon]}</span>` +
        `<span class="nav-label">${d.label}</span>` +
        (d.badge ? `<span class="nav-badge${d.hot ? (d.warn ? " warn" : " hot") : ""}">${escapeHtml(d.badge)}</span>` : "");
      row.addEventListener("click", () => {
        if (d.id === "settings") {
          openSettings();
          return;
        }
        sidebarView = d.id;
        renderNav();
        renderExplorer();
        renderEmptyVisibility();
        if (d.id === "workers") loadWorkers();
        if (d.id === "health") loadHealth();
      });
      if (["chats", "files"].includes(d.id)) navList.appendChild(row);
      else more.appendChild(row);
    }
    navList.appendChild(more);
  }

  function renderExplorer() {
    const isFiles = sidebarView === "files";
    const isStudio = sidebarView === "studio";
    const isDesign = sidebarView === "design";
    filesView.hidden = !isFiles;
    chatsView.hidden = isFiles || isStudio || isDesign;
    explorerLabel.textContent = isFiles ? "Explorer" : sidebarView === "chats" ? "Chats" : sidebarView === "workers" ? "Workers" : sidebarView === "health" ? "Health" : isStudio ? "Demo Studio" : isDesign ? "Design" : "Co-worker";
    if (sidebarView === "chats") renderChatsView();
    if (sidebarView === "coworker") renderCoWorkerView();
    if (sidebarView === "workers") renderWorkersSidebar();
    if (sidebarView === "health") renderHealthSidebar();
    renderPages();
  }

  // Works on the whole machine rather than the open project: find a document, open an app,
  // tidy a folder. The quick actions hand the job to the agent (which has the os_* tools);
  // the search box answers directly, because waiting on a model to list files you can already
  // see would be slower than just showing them.
  const CO_WORKER_ACTIONS = [
    { label: "Organise a folder", prompt: "Organise my Downloads folder — group the files by type into subfolders, and tell me what you moved before you move it." },
    { label: "Find and summarise a document", prompt: "Find the document on my computer about " },
    { label: "Open an app", prompt: "Open the app " },
    { label: "Clean up old files", prompt: "Look through my Downloads folder and tell me which files are old or duplicated and safe to delete. Don't delete anything yet." },
  ];

  // Grouped so a search can be narrowed to what you're actually after — "report" across a
  // Downloads folder otherwise returns the same name as a doc, an image and an archive.
  const CO_WORKER_FILTERS = [
    { id: "all", label: "All", test: () => true },
    { id: "docs", label: "Docs", ext: /\.(pdf|docx?|txt|md|rtf|odt|pptx?|xlsx?|csv)$/i },
    { id: "images", label: "Images", ext: /\.(png|jpe?g|gif|webp|svg|heic|bmp)$/i },
    { id: "code", label: "Code", ext: /\.(js|ts|jsx|tsx|py|rb|go|rs|java|c|h|cpp|cs|php|html|css|scss|json|ya?ml|sh|sql)$/i },
    { id: "media", label: "Media", ext: /\.(mp4|mov|avi|mkv|mp3|wav|flac|m4a|webm)$/i },
  ];
  let coWorkerFilter = "all";

  function renderCoWorkerView() {
    chatsView.innerHTML = "";

    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Search files on this computer…";
    search.className = "coworker-search";
    chatsView.appendChild(search);

    const filters = document.createElement("div");
    filters.className = "coworker-filters";
    filters.hidden = true;
    chatsView.appendChild(filters);

    // Walking a disk takes long enough that a static "Searching…" reads as a hang, and it hides
    // the one thing worth knowing: how much ground it has actually covered.
    const progress = document.createElement("div");
    progress.className = "coworker-progress";
    progress.hidden = true;
    chatsView.appendChild(progress);

    const results = document.createElement("div");
    chatsView.appendChild(results);

    let lastHits = [];
    let searching = false;

    window.nutaan.onOsSearchProgress((p) => {
      if (!searching) return;
      if (p.done) {
        progress.textContent = `Scanned ${p.scanned.toLocaleString()} items · ${p.found} match${p.found === 1 ? "" : "es"}`;
        return;
      }
      const where = p.current ? p.current.replace(/^.*[\\/]([^\\/]+[\\/][^\\/]+)$/, "$1") : "";
      progress.innerHTML =
        `<span class="coworker-progress-dot"></span>` +
        `Scanning ${escapeHtml(where)} · ${p.scanned.toLocaleString()} items · ${p.found} found`;
    });

    function paintFilters() {
      filters.innerHTML = "";
      for (const f of CO_WORKER_FILTERS) {
        const b = document.createElement("button");
        b.className = "coworker-filter" + (coWorkerFilter === f.id ? " on" : "");
        b.textContent = f.label;
        b.addEventListener("click", () => {
          coWorkerFilter = f.id;
          paintFilters();
          paintHits();
        });
        filters.appendChild(b);
      }
    }

    function paintHits() {
      const f = CO_WORKER_FILTERS.find((x) => x.id === coWorkerFilter);
      const shown = lastHits.filter((h) => h.isDir || !f.ext || f.ext.test(h.name));
      results.innerHTML = "";
      if (!shown.length) {
        results.innerHTML = `<div class="menu-empty">Nothing matches that filter.</div>`;
        return;
      }
      for (const h of shown.slice(0, 40)) {
        const row = document.createElement("div");
        row.className = "coworker-hit";
        row.title = h.path;
        row.innerHTML =
          `<span class="hit-icon">${h.isDir ? "📁" : fileIcon(h.name)}</span>` +
          `<span class="hit-meta"><span class="hit-name">${escapeHtml(h.name)}</span>` +
          `<span class="hit-path">${escapeHtml(h.path)}</span></span>` +
          `<button class="hit-ext" title="Open in the system app">↗</button>`;
        row.addEventListener("click", (e) => {
          if (e.target.classList.contains("hit-ext")) return;
          if (h.isDir) window.nutaan.osOpen(h.path);
          else openDeviceFileInPanel(h.path);
        });
        row.querySelector(".hit-ext").addEventListener("click", (e) => {
          e.stopPropagation();
          window.nutaan.osOpen(h.path);
        });
        results.appendChild(row);
      }
    }
    paintFilters();

    const actions = document.createElement("div");
    actions.className = "coworker-actions";
    actions.innerHTML = `<div class="coworker-heading">Ask the co-worker</div>`;
    for (const a of CO_WORKER_ACTIONS) {
      const b = document.createElement("button");
      b.className = "coworker-action";
      b.textContent = a.label;
      b.addEventListener("click", () => {
        input.value = a.prompt;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        autoGrowInput();
      });
      actions.appendChild(b);
    }
    chatsView.appendChild(actions);

    let timer = null;
    search.addEventListener("input", () => {
      clearTimeout(timer);
      const q = search.value.trim();
      if (q.length < 2) {
        results.innerHTML = "";
        actions.hidden = false;
        filters.hidden = true;
        progress.hidden = true;
        searching = false;
        return;
      }
      // Debounced: this walks real directories, so firing on every keystroke would have it
      // re-scanning the disk while the user is still typing.
      timer = setTimeout(async () => {
        actions.hidden = true;
        filters.hidden = false;
        progress.hidden = false;
        progress.innerHTML = `<span class="coworker-progress-dot"></span>Starting…`;
        results.innerHTML = "";
        searching = true;
        const res = await window.nutaan.osSearch({ query: q });
        searching = false;
        if (!res.ok || !res.hits.length) {
          lastHits = [];
          results.innerHTML = `<div class="menu-empty">${res.ok ? "Nothing found." : escapeHtml(res.error)}</div>`;
          return;
        }
        lastHits = res.hits;
        paintHits();
      }, 280);
    });
    setTimeout(() => search.focus(), 20);
  }

  function renderChatsView() {
    chatsView.innerHTML = "";
    // A tree: each project, then its chats with a relative time — one glance shows
    // every codebase and where the live work is.
    if (!projects.length) {
      chatsView.innerHTML = `<div class="menu-empty">No projects yet — open one to start.</div>`;
      return;
    }
    for (const proj of projects) {
      const isCurrent = proj.path === activePath;
      const shown = proj.chats.filter((c) => isCurrent || c.messages.some((m) => m.role === "user") || runs.has(c.id));
      if (!shown.length) continue;
      const head = document.createElement("div");
      head.className = "chats-proj-head";
      head.innerHTML =
        `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>` +
        `<span>${escapeHtml(basename(proj.path))}</span>`;
      chatsView.appendChild(head);
      for (const c of shown) {
        const row = document.createElement("div");
        const run = runs.get(c.id);
        row.className = "chat-row" + (isCurrent && c.id === proj.activeChatId ? " active" : "") + (run ? " running" : "") + (c.unread ? " unread" : "");
        row.innerHTML =
          `<span class="chat-title">${run ? `<span class="chat-run-dot"></span>` : ""}${escapeHtml(c.title)}</span>` +
          `<span class="chat-meta">${run ? escapeHtml(run.activity || "Working…") : escapeHtml(relTime(c.updatedAt))}</span>` +
          `<button class="row-close" title="Delete chat">✕</button>`;
        row.addEventListener("click", (e) => {
          if (e.target.classList.contains("row-close")) return;
          selectChat(proj.path, c.id);
        });
        row.querySelector(".row-close").addEventListener("click", (e) => {
          e.stopPropagation();
          deleteChat(proj.path, c.id);
        });
        chatsView.appendChild(row);
      }
    }
  }


  function renderRecent() {
    recentList.innerHTML = "";
    for (const p of projects.slice(0, 6)) {
      const row = document.createElement("div");
      row.className = "recent-row" + (p.path === activePath ? " active" : "");
      const last = p.chats[0]?.updatedAt;
      row.innerHTML =
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>` +
        `<span class="name" title="${escapeHtml(p.path)}">${escapeHtml(basename(p.path))}</span>` +
        `<span class="time">${escapeHtml(relTime(last))}</span>` +
        `<button class="row-close" title="Remove from list">✕</button>`;
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("row-close")) return;
        switchProject(p.path);
      });
      row.querySelector(".row-close").addEventListener("click", (e) => {
        e.stopPropagation();
        removeProject(p.path);
      });
      recentList.appendChild(row);
    }
  }

  // ---------- Project menu ----------
  function renderProjectMenu() {
    projectMenu.innerHTML = "";
    for (const p of projects) {
      const row = document.createElement("div");
      row.className = "project-menu-row" + (p.path === activePath ? " active" : "");
      row.innerHTML =
        `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" style="flex-shrink:0;opacity:.7"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>` +
        `<span class="name" title="${escapeHtml(p.path)}">${escapeHtml(basename(p.path))}</span>` +
        `<span class="count">${p.chats.length}</span>`;
      row.addEventListener("click", () => {
        projectMenu.hidden = true;
        switchProject(p.path);
      });
      projectMenu.appendChild(row);
    }
    if (projects.length) projectMenu.insertAdjacentHTML("beforeend", `<div class="menu-divider"></div>`);
    const openBtn = document.createElement("button");
    openBtn.className = "menu-action";
    openBtn.innerHTML =
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>` +
      `<span>Open project…</span>`;
    openBtn.addEventListener("click", () => {
      projectMenu.hidden = true;
      pickAndOpenProject();
    });
    projectMenu.appendChild(openBtn);
  }

  projectBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = projectMenu.hidden;
    closeAllMenus(projectMenu);
    if (willOpen) renderProjectMenu();
    projectMenu.hidden = !willOpen;
  });

  function renderProjectLabel() {
    // The home-directory workspace is not a project anyone chose, so it is never shown as one.
    const personal = activePath && _paths && activePath === _paths.home;
    const label = personal ? "Your computer" : activePath ? basename(activePath) : "No project";
    projectBtnLabel.textContent = label;
    projectBtn.title = personal ? `Working across this computer (${activePath})` : activePath || "Open a project";
    treeProjectRow.hidden = !activePath;
    treeProjectName.textContent = label === "No project" ? "" : label;
    treeProjectName.title = activePath || "";
    openProjectLinkLabel.textContent = personal
      ? "Working across this computer — open a project instead"
      : activePath
        ? `Working in ${basename(activePath)} — switch project`
        : "Open a project, or just ask — no folder needed";
  }

  // ---------- Git chip ----------
  async function refreshGit() {
    if (!activePath) {
      branchChip.hidden = true;
      panelBranch.textContent = "";
      return;
    }
    let st;
    try {
      st = await window.nutaan.gitStatus(activePath);
    } catch {
      branchChip.hidden = true;
      return;
    }
    if (!st || !st.repo) {
      branchChip.hidden = true;
      panelBranch.innerHTML = "";
      return;
    }
    branchChip.hidden = false;
    branchName.textContent = st.branch;
    syncDot.classList.toggle("dirty", st.dirty > 0);
    syncLabel.textContent = st.dirty > 0 ? `${st.dirty} changed` : "Clean";
    const showPush = st.hasUpstream && st.ahead > 0;
    pushBtn.hidden = !showPush;
    if (showPush) pushLabel.textContent = `Push ${st.ahead}`;
    panelBranch.innerHTML =
      `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" style="flex-shrink:0;"><circle cx="6" cy="6" r="2.4"/><circle cx="6" cy="18" r="2.4"/><circle cx="18" cy="8" r="2.4"/><path d="M6 8.4v7.2M8.4 6H14a4 4 0 0 1 4 4"/></svg>` +
      escapeHtml(st.branch);
  }

  // ---------- Branch switcher (the top git chip) ----------
  const branchSwitch = el("branchSwitch");
  const branchMenu = el("branchMenu");

  async function openBranchMenu(menuEl) {
    if (!activePath || !menuEl) return;
    if (!menuEl.hidden) { menuEl.hidden = true; return; }
    menuEl.innerHTML = `<div class="branch-menu-loading">Loading branches…</div>`;
    menuEl.hidden = false;
    let res;
    try { res = await window.nutaan.gitBranches(activePath); } catch { res = null; }
    if (!res || !res.repo || !res.branches.length) {
      menuEl.innerHTML = `<div class="branch-menu-loading">No branches found.</div>`;
      return;
    }
    menuEl.innerHTML = "";
    for (const b of res.branches) {
      const item = document.createElement("button");
      item.type = "button";
      item.className = "branch-menu-item" + (b.current ? " current" : "");
      item.innerHTML = `<span class="bm-tick">${b.current ? "✓" : ""}</span><span class="bm-name">${escapeHtml(b.name)}</span>`;
      if (!b.current) item.addEventListener("click", (e) => { e.stopPropagation(); switchBranch(b.name); });
      menuEl.appendChild(item);
    }
  }

  async function switchBranch(name) {
    if (branchMenu) branchMenu.hidden = true;
    let res;
    try { res = await window.nutaan.gitSwitchBranch(activePath, name); } catch (e) { res = { ok: false, error: e.message }; }
    if (!res.ok) {
      appendBubble("error", `Couldn't switch to "${name}": ${res.error}`);
      return;
    }
    await refreshGit();
    refreshTree();
    contextFiles = null;
    appendBubble("assistant", `Switched to branch **${name}**.`);
  }

  branchSwitch?.addEventListener("click", (e) => { e.stopPropagation(); openBranchMenu(branchMenu); });
  document.addEventListener("click", (e) => {
    if (branchMenu && !branchMenu.hidden && !e.target.closest(".branch-chip")) branchMenu.hidden = true;
  });

  // ---------- Git commit & push ----------
  const gitOverlay = el("gitOverlay");
  const gitBranchLabel = el("gitBranchLabel");
  const gitAheadLabel = el("gitAheadLabel");
  const gitFiles = el("gitFiles");
  const gitSelectAll = el("gitSelectAll");
  const gitMessage = el("gitMessage");
  const gitResult = el("gitResult");
  const gitCancel = el("gitCancel");
  const gitCommitBtn = el("gitCommitBtn");
  const gitCommitPushBtn = el("gitCommitPushBtn");
  let gitSelected = new Set();

  function showGitResult(ok, text) {
    gitResult.hidden = false;
    gitResult.className = "git-result " + (ok ? "ok" : "err");
    gitResult.textContent = text;
  }

  function renderGitFiles(files) {
    gitFiles.innerHTML = "";
    if (!files.length) {
      gitFiles.innerHTML = `<div class="menu-empty">Nothing has changed since the last commit.</div>`;
      return;
    }
    for (const f of files) {
      const on = gitSelected.has(f.path);
      const row = document.createElement("div");
      row.className = "git-file";
      row.innerHTML =
        `<span class="kb-check" style="${on ? "background:var(--grad);border-color:transparent" : ""}">${on ? "✓" : ""}</span>` +
        `<span class="path" title="${escapeHtml(f.path)}">${escapeHtml(f.path)}</span>` +
        `<span class="tag ${f.untracked ? "untracked" : f.label}">${f.untracked ? "new" : f.label}</span>`;
      row.addEventListener("click", () => {
        if (gitSelected.has(f.path)) gitSelected.delete(f.path);
        else gitSelected.add(f.path);
        renderGitFiles(files);
      });
      gitFiles.appendChild(row);
    }
  }

  let gitFileCache = [];

  async function openGitPanel() {
    if (!activePath) return;
    gitResult.hidden = true;
    gitMessage.value = "";
    gitOverlay.hidden = false;
    gitFiles.innerHTML = `<div class="menu-empty">Loading…</div>`;

    const [status, changes] = await Promise.all([
      window.nutaan.gitStatus(activePath),
      window.nutaan.gitChanges(activePath),
    ]);
    gitBranchLabel.textContent = status?.branch || "—";
    gitAheadLabel.textContent = status?.ahead ? `${status.ahead} unpushed` : "";
    if (!changes.ok) {
      gitFiles.innerHTML = `<div class="menu-empty">${escapeHtml(changes.error)}</div>`;
      return;
    }
    gitFileCache = changes.files;
    // Everything ticked by default: the common case is committing the whole working tree, and
    // making people tick each file to get there is friction for no safety gain.
    gitSelected = new Set(changes.files.map((f) => f.path));
    renderGitFiles(gitFileCache);
  }

  gitSelectAll.addEventListener("click", () => {
    const all = gitSelected.size === gitFileCache.length;
    gitSelected = all ? new Set() : new Set(gitFileCache.map((f) => f.path));
    renderGitFiles(gitFileCache);
  });

  gitCancel.addEventListener("click", () => { gitOverlay.hidden = true; });
  gitOverlay.addEventListener("click", (e) => {
    if (e.target === gitOverlay) gitOverlay.hidden = true;
  });

  async function doCommit(alsoPush) {
    const btn = alsoPush ? gitCommitPushBtn : gitCommitBtn;
    const label = btn.textContent;
    btn.disabled = true;
    gitCommitBtn.disabled = true;
    gitCommitPushBtn.disabled = true;
    btn.textContent = "Committing…";

    const res = await window.nutaan.gitCommit({
      root: activePath,
      paths: [...gitSelected],
      message: gitMessage.value,
    });
    if (!res.ok) {
      btn.textContent = label;
      gitCommitBtn.disabled = false;
      gitCommitPushBtn.disabled = false;
      showGitResult(false, res.error);
      return;
    }
    if (!alsoPush) {
      btn.textContent = label;
      gitCommitBtn.disabled = false;
      gitCommitPushBtn.disabled = false;
      showGitResult(true, res.output || "Committed.");
      await refreshGit();
      await openGitPanel();
      return;
    }

    btn.textContent = "Pushing…";
    const push = await window.nutaan.gitPush(activePath);
    btn.textContent = label;
    gitCommitBtn.disabled = false;
    gitCommitPushBtn.disabled = false;
    showGitResult(push.ok, push.ok ? `${res.output}\n\n${push.output || "Pushed."}` : push.error);
    await refreshGit();
    if (push.ok) setTimeout(() => { gitOverlay.hidden = true; }, 1200);
  }

  gitCommitBtn.addEventListener("click", () => doCommit(false));
  gitCommitPushBtn.addEventListener("click", () => doCommit(true));
  branchChip.addEventListener("click", (e) => {
    if (e.target.closest("#pushBtn")) return;
    openGitPanel();
  });

  pushBtn.addEventListener("click", async () => {
    if (!activePath) return;
    pushBtn.disabled = true;
    const original = pushLabel.textContent;
    pushLabel.textContent = "Pushing…";
    const res = await window.nutaan.gitPush(activePath);
    pushBtn.disabled = false;
    pushLabel.textContent = original;
    if (!res.ok) appendBubble("error", `git push failed:\n${res.error}`);
    await refreshGit();
  });

  // ---------- File tree ----------
  const FILE_BADGES = {
    js: ["JS", "#f7df1e", null], jsx: ["JS", "#f7df1e", null], mjs: ["JS", "#f7df1e", null], cjs: ["JS", "#f7df1e", null],
    ts: ["TS", null, "#1f6feb"], tsx: ["TS", null, "#1f6feb"],
    css: ["#", "#c084fc", null], scss: ["#", "#c86bd0", null],
    json: ["{}", "#e0a336", null], md: ["M↓", "#8b8da0", null],
    html: ["<>", "#f97316", null], py: ["PY", "#4ade80", null],
    yml: ["Y", "#8b8da0", null], yaml: ["Y", "#8b8da0", null],
    sh: ["$", "#4ade80", null], gitignore: ["◆", "#f97316", null],
    png: ["▣", "#60a5fa", null], jpg: ["▣", "#60a5fa", null], jpeg: ["▣", "#60a5fa", null],
    gif: ["▣", "#60a5fa", null], webp: ["▣", "#60a5fa", null], svg: ["▣", "#c084fc", null],
    // The co-worker searches the whole machine, so it meets far more than source files.
    pdf: ["PDF", null, "#dc2626"], doc: ["W", null, "#2563eb"], docx: ["W", null, "#2563eb"],
    xls: ["X", null, "#16a34a"], xlsx: ["X", null, "#16a34a"], csv: ["CSV", "#4ade80", null],
    ppt: ["P", null, "#ea580c"], pptx: ["P", null, "#ea580c"],
    zip: ["ZIP", "#e0a336", null], rar: ["ZIP", "#e0a336", null], "7z": ["ZIP", "#e0a336", null],
    mp4: ["▶", "#f472b6", null], mov: ["▶", "#f472b6", null], mkv: ["▶", "#f472b6", null],
    webm: ["▶", "#f472b6", null], avi: ["▶", "#f472b6", null],
    mp3: ["♪", "#c084fc", null], wav: ["♪", "#c084fc", null], flac: ["♪", "#c084fc", null],
    m4a: ["♪", "#c084fc", null], exe: ["EXE", "#8b92a0", null], dmg: ["DMG", "#8b92a0", null],
    ttf: ["Aa", "#60a5fa", null], otf: ["Aa", "#60a5fa", null], woff2: ["Aa", "#60a5fa", null],
  };

  const REACT_ICON =
    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#61dafb" stroke-width="1.5"><circle cx="12" cy="12" r="2"/><ellipse cx="12" cy="12" rx="10" ry="4.2"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4.2" transform="rotate(120 12 12)"/></svg>';

  function fileIcon(name) {
    if (/\.(jsx|tsx)$/.test(name)) return REACT_ICON;
    const ext = name.startsWith(".") ? name.slice(1) : name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const entry = FILE_BADGES[ext];
    if (!entry) return `<span class="tree-badge" style="color:#6b7280">•</span>`;
    const [label, color, bg] = entry;
    if (bg) return `<span class="tree-badge boxed" style="background:${bg}">${label}</span>`;
    return `<span class="tree-badge" style="color:${color}">${label}</span>`;
  }

  function folderIcon(color) {
    return `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.9" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
  }

  const FOLDER_COLORS = ["#4ade80", "#e0a336", "#60a5fa", "#c084fc"];

  async function buildTreeNode(container, relPath, depth) {
    let entries;
    try {
      entries = await window.nutaan.listDir(activePath, relPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      const childPath = relPath === "." ? entry.name : relPath + "/" + entry.name;
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = 10 + depth * 13 + "px";
      row.title = entry.name;
      const icon = entry.isDir ? folderIcon(FOLDER_COLORS[depth % FOLDER_COLORS.length]) : fileIcon(entry.name);
      row.innerHTML =
        `<span class="chev">${entry.isDir ? "›" : ""}</span>` +
        `<span class="tree-icon-wrap">${icon}</span>` +
        `<span class="tree-label">${escapeHtml(entry.name)}</span>`;
      container.appendChild(row);

      if (entry.isDir) {
        const childWrap = document.createElement("div");
        childWrap.hidden = true;
        container.appendChild(childWrap);
        let loaded = false;
        row.addEventListener("click", async () => {
          childWrap.hidden = !childWrap.hidden;
          row.querySelector(".chev").textContent = childWrap.hidden ? "›" : "⌄";
          if (!loaded) {
            loaded = true;
            await buildTreeNode(childWrap, childPath, depth + 1);
          }
        });
      } else {
        row.dataset.path = childPath;
        row.addEventListener("click", () => openFileInPanel(childPath));
      }
    }
  }

  async function refreshTree() {
    fileTreeEl.innerHTML = "";
    renderProjectLabel();
    if (!activePath) return;
    await buildTreeNode(fileTreeEl, ".", 0);
  }

  refreshTreeBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    refreshIcon.classList.add("spinning");
    contextFiles = null;
    await refreshTree();
    await refreshGit();
    setTimeout(() => refreshIcon.classList.remove("spinning"), 300);
  });

  // Collapsible Explorer — remembered across sessions.
  function applyExplorerCollapsed() {
    const collapsed = !!settings.explorerCollapsed;
    const body = el("explorerBody");
    const caret = el("explorerCaret");
    if (body) body.hidden = collapsed;
    if (caret) caret.classList.toggle("collapsed", collapsed);
  }
  el("explorerToggle")?.addEventListener("click", () => {
    settings.explorerCollapsed = !settings.explorerCollapsed;
    window.nutaan.setSettings(settings).catch(() => {});
    applyExplorerCollapsed();
  });

  // ---------- Code panel ----------
  const LANGS = {
    js: ["JS", "JavaScript", "#b8a020"], jsx: ["JS", "JavaScript", "#b8a020"], mjs: ["JS", "JavaScript", "#b8a020"],
    ts: ["TS", "TypeScript", "#1f6feb"], tsx: ["TS", "TypeScript", "#1f6feb"],
    json: ["{}", "JSON", "#e0a336"], css: ["#", "CSS", "#c084fc"], scss: ["#", "SCSS", "#c86bd0"],
    html: ["<>", "HTML", "#f97316"], md: ["M↓", "Markdown", "#6b7280"], py: ["PY", "Python", "#4ade80"],
    yml: ["Y", "YAML", "#6b7280"], yaml: ["Y", "YAML", "#6b7280"], sh: ["$", "Shell", "#4ade80"],
  };

  function setPanelMode(mode) {
    panelMode = mode;
    const isCode = mode === "code";
    const isBrowser = mode === "browser";
    const isTerm = mode === "terminal";
    segCode.classList.toggle("active", isCode);
    segBrowser.classList.toggle("active", isBrowser);
    segTerminal.classList.toggle("active", isTerm);
    codeBody.hidden = !isCode;
    browserBody.hidden = !isBrowser;
    terminalBody.hidden = !isTerm;
    fileTabs.hidden = !isCode;
    browserTabsEl.hidden = !isBrowser;
    if (isBrowser && browserTabs.length === 0) addBrowserTab("about:blank");
    if (isBrowser) {
      // <webview> often paints at its intrinsic 300×150 in the top-left until a
      // reflow lands (that's why a manual resize fixed it). Nudge it once the
      // panel is actually visible so it fills the viewport immediately.
      requestAnimationFrame(() => {
        try {
          window.dispatchEvent(new Event("resize"));
          const wv = activeWebview();
          if (wv) { wv.style.height = "99.9%"; void wv.offsetHeight; wv.style.height = ""; }
        } catch {}
      });
    }
    if (isTerm) {
      refreshTerminal();
      window.dispatchEvent(new CustomEvent("terminal:open", { detail: { cwd: activePath || null } }));
    }
  }

  function openPanel(mode) {
    panel.hidden = false;
    resizer.hidden = false;
    if (mode) setPanelMode(mode);
    if (!settings.panelOpen) { settings.panelOpen = true; window.nutaan.setSettings(settings).catch(() => {}); }
  }

  // The agent never opens the panel. Files it touches, pages it visits and processes it starts
  // land in the panel's tabs in the background; if the panel is already open its tab switches to
  // follow the work, and if it is closed it stays closed until you open it. A panel that keeps
  // sliding open on its own is the single most-complained-about thing in this app.
  function autoOpenPanel(mode) {
    if (mode && !panel.hidden) setPanelMode(mode);
  }

  function renderFileTabs() {
    fileTabs.innerHTML = "";
    for (const f of openFiles) {
      const tab = document.createElement("div");
      tab.className = "file-tab" + (f.path === activeFilePath ? " active" : "");
      tab.title = f.path;
      tab.innerHTML =
        `<span style="display:flex;flex-shrink:0">${fileIcon(basename(f.path))}</span>` +
        `<span class="name">${escapeHtml(basename(f.path))}</span>` +
        `<button class="tab-close" title="Close">✕</button>`;
      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) return;
        activeFilePath = f.path;
        renderFileTabs();
        renderCodeView();
      });
      tab.querySelector(".tab-close").addEventListener("click", (e) => {
        e.stopPropagation();
        closeFileTab(f.path);
      });
      fileTabs.appendChild(tab);
    }
  }

  function closeFileTab(path) {
    const idx = openFiles.findIndex((f) => f.path === path);
    if (idx === -1) return;
    openFiles.splice(idx, 1);
    if (activeFilePath === path) {
      activeFilePath = openFiles[Math.min(idx, openFiles.length - 1)]?.path || null;
    }
    renderFileTabs();
    renderCodeView();
  }

  function renderCodeView() {
    const file = openFiles.find((f) => f.path === activeFilePath);
    codeCopyBtn.hidden = !file;
    if (!file) {
      codeGrid.hidden = true;
      codeEmpty.hidden = false;
      codeBreadcrumb.innerHTML = "";
      codeLineCount.textContent = "";
      langBadge.textContent = "TXT";
      langBadge.style.background = "#31343d";
      langName.textContent = "Plain text";
      return;
    }
    codeEmpty.hidden = true;
    codeGrid.hidden = false;

    const parts = file.path.split("/");
    codeBreadcrumb.innerHTML = parts
      .map((p, i) => `<span class="${i === parts.length - 1 ? "seg-last" : ""}">${escapeHtml(p)}</span>`)
      .join(`<span class="sep">›</span>`);

    // Diff / File toggle: available for project files (not external co-worker files).
    const canDiff = !file.external && !!activePath;
    codeViewToggle.hidden = !canDiff;
    if (!canDiff && file.viewMode === "diff") file.viewMode = "file";
    cvtDiff.classList.toggle("active", file.viewMode === "diff");
    cvtFile.classList.toggle("active", file.viewMode !== "diff");

    if (file.viewMode === "diff") {
      renderDiffView(file);
    } else {
      const body = file.content.slice(0, 200_000);
      const lines = body.split("\n");
      codeGutter.innerHTML = lines.map((_, i) => `<div>${i + 1}</div>`).join("");
      codeViewContent.innerHTML = highlightCode(body);
      codeViewContent.classList.remove("is-diff");
      codeLineCount.textContent = `${lines.length} line${lines.length === 1 ? "" : "s"}`;
    }

    const ext = basename(file.path).includes(".") ? basename(file.path).split(".").pop().toLowerCase() : "";
    const [badge, name, color] = LANGS[ext] || ["TXT", "Plain text", "#31343d"];
    langBadge.textContent = badge;
    langBadge.style.background = color;
    langName.textContent = name;
  }

  // Renders a git diff of the file in the code panel — added lines green, removed red, context
  // dimmed — so you can see exactly what the agent changed (and spot conflicts) instead of just
  // the current contents. Falls back to the file view when there's nothing to diff.
  async function renderDiffView(file) {
    let res = null;
    try { res = await window.nutaan.gitDiffFile(activePath, file.path); } catch {}
    if (!res || !res.hasChanges || !res.diff) {
      file.viewMode = "file";
      renderCodeView();
      return;
    }
    const gut = [];
    const rows = [];
    let newLn = 0;
    let inHunk = false;
    let added = 0;
    let removed = 0;
    for (const raw of res.diff.split("\n")) {
      if (raw.startsWith("diff ") || raw.startsWith("index ") || raw.startsWith("--- ") || raw.startsWith("+++ ") ||
          raw.startsWith("old mode") || raw.startsWith("new mode") || raw.startsWith("similarity") ||
          raw.startsWith("rename ") || raw.startsWith("\\ No newline")) continue;
      if (raw.startsWith("@@")) {
        const m = raw.match(/\+(\d+)/);
        newLn = m ? parseInt(m[1], 10) : newLn;
        inHunk = true;
        gut.push(`<div class="dl-meta">·</div>`);
        rows.push(`<div class="diff-line hunk">${escapeHtml(raw)}</div>`);
        continue;
      }
      if (!inHunk) continue;
      const c = raw[0];
      if (c === "+") {
        added++;
        gut.push(`<div>${newLn++}</div>`);
        rows.push(`<div class="diff-line add">${highlightCode(raw.slice(1)) || "&nbsp;"}</div>`);
      } else if (c === "-") {
        removed++;
        gut.push(`<div class="dl-del">−</div>`);
        rows.push(`<div class="diff-line del">${highlightCode(raw.slice(1)) || "&nbsp;"}</div>`);
      } else {
        gut.push(`<div>${newLn++}</div>`);
        rows.push(`<div class="diff-line ctx">${highlightCode(raw.slice(1)) || "&nbsp;"}</div>`);
      }
    }
    codeGutter.innerHTML = gut.join("");
    codeViewContent.innerHTML = rows.join("");
    codeViewContent.classList.add("is-diff");
    codeLineCount.textContent = `+${added} −${removed}` + (res.untracked ? " · new file" : "");
  }

  function setCodeViewMode(mode) {
    const file = openFiles.find((f) => f.path === activeFilePath);
    if (!file) return;
    file.viewMode = mode;
    renderCodeView();
  }
  cvtDiff.addEventListener("click", () => setCodeViewMode("diff"));
  cvtFile.addEventListener("click", () => setCodeViewMode("file"));

  // Co-worker results live outside the project, so they can't go through the project-scoped
  // read. Text opens in the editor panel the same way a project file does; anything the editor
  // can't render (a PDF, a video) is handed to the system app instead of showing binary noise.
  async function openDeviceFileInPanel(absPath) {
    const res = await window.nutaan.osRead({ path: absPath, limit: 4000 });
    if (!res.ok) {
      appendBubble("error", `Couldn't open ${absPath}: ${res.error}`);
      return;
    }
    if (res.kind !== "text") {
      await window.nutaan.osOpen(absPath);
      return;
    }
    const existing = openFiles.find((f) => f.path === absPath);
    if (existing) existing.content = res.content;
    else openFiles.push({ path: absPath, content: res.content, external: true });
    if (openFiles.length > 8) openFiles.shift();
    activeFilePath = absPath;
    autoOpenPanel("code");
    renderFileTabs();
    renderCodeView();
  }

  async function openFileInPanel(relPath, { focus = true, diff = false, fromAgent = false } = {}) {
    if (!activePath) return;
    let content;
    try {
      content = await window.nutaan.readFile(activePath, relPath);
    } catch (err) {
      appendBubble("error", `Couldn't open ${relPath}: ${err.message}`);
      return;
    }
    const existing = openFiles.find((f) => f.path === relPath);
    if (existing) {
      existing.content = content;
      if (diff) existing.viewMode = "diff";
    } else {
      openFiles.push({ path: relPath, content, viewMode: diff ? "diff" : "file" });
    }
    if (openFiles.length > 8) openFiles.shift();
    if (focus) activeFilePath = relPath;
    else if (!activeFilePath) activeFilePath = relPath;

    document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
    const treeRow = fileTreeEl.querySelector(`.tree-row[data-path="${CSS.escape(relPath)}"]`);
    if (treeRow) treeRow.classList.add("active");

    if (focus && !fromAgent) openPanel("code"); else autoOpenPanel("code");
    renderFileTabs();
    renderCodeView();
  }

  codeCopyBtn.addEventListener("click", async () => {
    const file = openFiles.find((f) => f.path === activeFilePath);
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.content);
      codeCopyBtn.textContent = "Copied";
      codeCopyBtn.classList.add("copied");
      setTimeout(() => {
        codeCopyBtn.textContent = "Copy file";
        codeCopyBtn.classList.remove("copied");
      }, 1400);
    } catch {
      codeCopyBtn.textContent = "Failed";
      setTimeout(() => { codeCopyBtn.textContent = "Copy file"; }, 1400);
    }
  });

  segCode.addEventListener("click", () => { openPanel(); setPanelMode("code"); });
  segBrowser.addEventListener("click", () => { openPanel(); setPanelMode("browser"); });
  segTerminal.addEventListener("click", () => { openPanel(); setPanelMode("terminal"); });

  // ---------- Terminal panel: live view of background tasks (anyone can open it) ----------
  let termSelectedId = null;
  let termPollTimer = null;

  async function refreshTerminal() {
    let tasks = [];
    try { tasks = (await window.nutaan.bgTasks.list()) || []; } catch {}
    // newest first
    tasks = tasks.slice().reverse();
    termTaskList.innerHTML = "";
    if (tasks.length === 0) {
      termTaskList.innerHTML = `<div class="term-empty">No tasks</div>`;
    }
    if (!termSelectedId && tasks.length) termSelectedId = tasks[0].id;
    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "term-task" + (t.id === termSelectedId ? " active" : "");
      const dot = t.status === "running" ? "run" : t.status === "exited" && t.exitCode === 0 ? "ok" : "err";
      row.innerHTML = `<span class="term-dot ${dot}"></span><span class="term-task-id">${escapeHtml(t.id)}</span><span class="term-task-cmd">${escapeHtml(t.command)}</span>`;
      row.addEventListener("click", () => { termSelectedId = t.id; refreshTerminal(); });
      termTaskList.appendChild(row);
    }
    await renderTermOutput();
    updateTerminalBadge(tasks);
    // keep polling while the selected task is running
    const sel = tasks.find((x) => x.id === termSelectedId);
    if (termPollTimer) { clearInterval(termPollTimer); termPollTimer = null; }
    if (sel && sel.status === "running" && panelMode === "terminal") {
      termPollTimer = setInterval(renderTermOutput, 1000);
    }
  }

  // Run a command the user typed straight into the terminal — it becomes a background task and
  // streams in the panel like any other. Uses the open project's folder, else the home directory.
  el("termForm")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = el("termInput");
    const cmd = input.value.trim();
    if (!cmd) return;
    input.value = "";
    try {
      const res = await window.nutaan.bgTasks.start(activePath || null, cmd);
      if (res && res.id) { termSelectedId = res.id; }
    } catch {}
    refreshTerminal();
  });

  async function renderTermOutput() {
    if (!termSelectedId) {
      termOutput.innerHTML = `<div class="term-empty">No background tasks yet. When the agent (or you) start one with run_background, it shows here live.</div>`;
      termTitle.textContent = "Background tasks";
      termStatus.textContent = "";
      termStopBtn.hidden = true;
      return;
    }
    let v = null;
    try { v = await window.nutaan.bgTasks.get(termSelectedId); } catch {}
    if (!v) return;
    termTitle.textContent = v.id + "  ·  " + v.command;
    termStatus.textContent = v.status === "running" ? "running" : v.status === "exited" ? `exited ${v.exitCode}` : v.status;
    termStatus.className = "term-status " + (v.status === "running" ? "run" : v.status === "exited" && v.exitCode === 0 ? "ok" : "err");
    termStopBtn.hidden = v.status !== "running";
    const atBottom = termOutput.scrollHeight - termOutput.scrollTop - termOutput.clientHeight < 40;
    termOutput.textContent = v.output || (v.status === "running" ? "(running — waiting for output…)" : "(no output)");
    if (atBottom) termOutput.scrollTop = termOutput.scrollHeight;
  }

  function updateTerminalBadge(tasks) {
    const running = (tasks || []).filter((t) => t.status === "running").length;
    if (running > 0) { segTerminalBadge.textContent = String(running); segTerminalBadge.hidden = false; }
    else segTerminalBadge.hidden = true;
  }

  termStopBtn.addEventListener("click", async () => {
    if (!termSelectedId) return;
    try { await window.nutaan.bgTasks.stop(termSelectedId); } catch {}
    refreshTerminal();
  });
  panelCloseBtn.addEventListener("click", () => {
    panel.hidden = true;
    resizer.hidden = true;
    settings.panelOpen = false;
    window.nutaan.setSettings(settings).catch(() => {});
  });
  panelToggleBtn.addEventListener("click", () => {
    const show = panel.hidden;
    panel.hidden = !show;
    resizer.hidden = !show;
    settings.panelOpen = show;
    window.nutaan.setSettings(settings).catch(() => {});
    if (show && panelMode === "browser" && browserTabs.length === 0) addBrowserTab("about:blank");
  });

  // ---------- Panel resize ----------
  let resizing = false;
  const resizeShield = document.createElement("div");
  resizeShield.className = "resize-shield";
  resizeShield.hidden = true;
  document.body.appendChild(resizeShield);

  function endResize() {
    if (!resizing) return;
    resizing = false;
    resizeShield.hidden = true;
    document.body.classList.remove("resizing");
  }

  resizer.addEventListener("mousedown", (e) => {
    e.preventDefault();
    resizing = true;
    resizeShield.hidden = false;
    document.body.classList.add("resizing");
  });
  // Listening on the shield rather than the window: it covers the <webview>, which would
  // otherwise capture the pointer and strand the drag in a permanently-resizing state.
  resizeShield.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const rect = workspace.getBoundingClientRect();
    const pct = ((rect.right - e.clientX) / rect.width) * 100;
    panel.style.width = Math.max(24, Math.min(62, pct)) + "%";
    applyDeviceScale();
  });
  window.addEventListener("resize", () => applyDeviceScale());
  resizeShield.addEventListener("mouseup", endResize);
  resizeShield.addEventListener("mouseleave", endResize);
  window.addEventListener("mouseup", endResize);
  window.addEventListener("blur", endResize);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") endResize();
  });

  // ---------- Browser panel ----------
  const TAB_HUES = ["#4ade80", "#60a5fa", "#c084fc", "#f472b6", "#fdba74"];

  function normalizeUrl(value) {
    const v = String(value || "").trim();
    if (!v) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;
    if (/^about:/i.test(v)) return v;
    if (/^localhost(:\d+)?/i.test(v) || /^127\.0\.0\.1/.test(v)) return "http://" + v;
    if (/^[a-zA-Z]:[\\/]/.test(v)) return "file:///" + v.replace(/\\/g, "/");
    if (/^[\w-]+(\.[\w-]+)+/.test(v)) return "https://" + v;
    return "https://www.google.com/search?q=" + encodeURIComponent(v);
  }

  function activeBrowserTab() {
    return browserTabs.find((t) => t.id === activeBrowserTabId) || null;
  }

  function activeWebview() {
    return activeBrowserTab()?.view || null;
  }

  // The Design page needs two things from here: which model gateway is configured, and a way to
  // put a URL in the browser panel so the agent's browser tools can reach it.
  window.NutaanSettings = () => ({
    baseUrl: settings.baseUrl || "",
    apiKey: settings.apiKey || "",
    nutaanKey: settings.nutaanKey || "",
    model: settings.model || "",
  });
  // How the Design page hands work back to the agent: a message in the normal chat, and a file
  // written into whatever project is open (or the personal workspace if none is).
  let pendingTitle = null; // what the chat is called when the message is a wrapped design prompt
  window.NutaanChat = {
    async send(text, { title } = {}) {
      if (!text) return;
      pendingTitle = title || null;
      await ensureWorkspace();
      sidebarView = "chats";
      renderNav();
      renderExplorer();
      input.value = text;
      autoGrowInput();
      await sendMessage();
    },
    async writeFile(relPath, content) {
      const proj = activeProject() || (await ensureWorkspace());
      if (!proj) return { error: "no workspace" };
      try {
        return await window.nutaan.writeFile(proj.path, relPath, content);
      } catch (e) {
        return { error: e.message };
      }
    },
  };

  window.NutaanBrowser = {
    open(url) {
      if (!url) return;
      if (panel.hidden) panelToggleBtn.click();
      setPanelMode("browser");
      addBrowserTab(url);
    },
  };

  function addBrowserTab(url) {
    const id = genId();
    const view = document.createElement("webview");
    view.setAttribute("src", normalizeUrl(url) || "about:blank");
    view.setAttribute("allowpopups", "");
    // Persist cookies/logins across restarts so a one-time sign-in (e.g. Gmail/Outlook for the
    // co-worker to read email, or any app under test) is remembered instead of asked every time.
    view.setAttribute("partition", "persist:nutaan-browser");
    view.style.display = "none";
    browserViewport.appendChild(view);

    const tab = { id, title: "New tab", url: url || "about:blank", view, hue: TAB_HUES[browserTabs.length % TAB_HUES.length], loading: false, ready: false };
    browserTabs.push(tab);

    // Track when the webview is actually attached & dom-ready. Driving it before this — the case
    // when the agent opens the panel and immediately navigates/screenshots — is the main reason
    // browser actions used to hang until the 20s timeout. Actions await tab.whenReady first.
    tab.whenReady = new Promise((resolve) => {
      view.addEventListener("dom-ready", () => {
        tab.ready = true;
        resolve();
      });
    });

    // Native alert()/confirm()/prompt() are OS-level modals the agent can't see in the DOM, so a
    // page that pops "Invalid username or password" would block the webview and the agent would
    // loop retrying the same thing forever. Override them to capture the message (surfaced in
    // browser_read_page) and never block. Re-injected on every load since a navigation resets it.
    view.addEventListener("dom-ready", () => {
      view.executeJavaScript(`(function(){
        if (window.__nutaanDialogHook) return;
        window.__nutaanDialogHook = true;
        window.__nutaanDialogs = [];
        var rec = function(type, msg){ try { window.__nutaanDialogs.push({type:type, message:String(msg)}); if(window.__nutaanDialogs.length>12) window.__nutaanDialogs.shift(); } catch(e){} };
        window.alert = function(m){ rec('alert', m); };
        window.confirm = function(m){ rec('confirm', m); return false; };
        window.prompt = function(m){ rec('prompt', m); return null; };
      })();`).catch(() => {});
    });

    view.addEventListener("did-start-loading", () => {
      tab.loading = true;
      if (tab.id === activeBrowserTabId) startLoadbar();
    });
    view.addEventListener("did-stop-loading", () => {
      tab.loading = false;
      tab.title = view.getTitle() || basename(tab.url) || "New tab";
      renderBrowserTabs();
    });
    const syncUrl = (e) => {
      tab.url = e.url;
      if (tab.id === activeBrowserTabId) browserAddress.value = e.url;
      renderBrowserTabs();
    };
    view.addEventListener("did-navigate", syncUrl);
    view.addEventListener("did-navigate-in-page", syncUrl);

    // The browser panel is one of the surfaces the self-healing monitor watches — but only for
    // the user's own app (localhost / a LAN address). A console error on a third-party site is
    // not an incident in this workspace.
    const isOwnApp = () => /^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test(tab.url || "");
    view.addEventListener("console-message", (e) => {
      if (e.level < 3 || !isOwnApp() || !activePath) return;
      const msg = String(e.message || "");
      if (!/error|exception|failed|cannot|undefined is not|is not a function|unhandled/i.test(msg)) return;
      window.nutaan.healer.signal({ source: "browser", root: activePath, title: msg.slice(0, 120), evidence: `Console error on ${tab.url}\n${msg}\n(${e.sourceId || ""}:${e.line || ""})`, url: tab.url });
    });
    view.addEventListener("did-fail-load", (e) => {
      if (!e.isMainFrame || !activePath) return;
      const url = e.validatedURL || tab.url || "";
      if (!/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(url) || e.errorCode === -3) return; // -3 = aborted (a redirect), not a failure
      window.nutaan.healer.signal({ source: "browser", root: activePath, title: `${url} failed to load: ${e.errorDescription || e.errorCode}`, evidence: `Navigation to ${url} failed: ${e.errorDescription} (${e.errorCode}). The dev server may have crashed or the port changed.`, url });
    });

    selectBrowserTab(id);
    return tab;
  }

  function selectBrowserTab(id) {
    activeBrowserTabId = id;
    for (const t of browserTabs) t.view.style.display = t.id === id ? "flex" : "none";
    const t = activeBrowserTab();
    if (t) browserAddress.value = t.url === "about:blank" ? "" : t.url;
    renderBrowserTabs();
    applyDeviceScale();
    // Force the freshly-shown <webview> to fill its host — without this it can
    // paint small in the top-left corner until the user manually resizes.
    if (t && t.view) requestAnimationFrame(() => {
      try { t.view.style.height = "99.9%"; void t.view.offsetHeight; t.view.style.height = ""; } catch {}
    });
  }

  function closeBrowserTab(id) {
    const idx = browserTabs.findIndex((t) => t.id === id);
    if (idx === -1) return;
    browserTabs[idx].view.remove();
    browserTabs.splice(idx, 1);
    if (activeBrowserTabId === id) {
      const next = browserTabs[Math.min(idx, browserTabs.length - 1)];
      if (next) selectBrowserTab(next.id);
      else addBrowserTab("about:blank");
    } else {
      renderBrowserTabs();
    }
  }

  function renderBrowserTabs() {
    browserTabsEl.innerHTML = "";
    for (const t of browserTabs) {
      const tab = document.createElement("div");
      tab.className = "btab" + (t.id === activeBrowserTabId ? " active" : "");
      tab.title = t.url;
      tab.innerHTML =
        `<span class="favicon" style="background:${t.hue}"></span>` +
        `<span class="name">${escapeHtml(t.title || "New tab")}</span>` +
        `<button class="tab-close" title="Close tab">✕</button>`;
      tab.addEventListener("click", (e) => {
        if (e.target.classList.contains("tab-close")) return;
        selectBrowserTab(t.id);
      });
      tab.querySelector(".tab-close").addEventListener("click", (e) => {
        e.stopPropagation();
        closeBrowserTab(t.id);
      });
      browserTabsEl.appendChild(tab);
    }
    const add = document.createElement("button");
    add.className = "icon-btn small";
    add.title = "New tab";
    add.textContent = "＋";
    add.addEventListener("click", () => addBrowserTab("about:blank"));
    browserTabsEl.appendChild(add);
  }

  function startLoadbar() {
    loadbar.classList.remove("active");
    void loadbar.offsetWidth;
    loadbar.classList.add("active");
  }

  let userDrivenNav = false;
  function navigateBrowser(value) {
    const url = normalizeUrl(value);
    if (!url) return;
    if (userDrivenNav) openPanel("browser"); else autoOpenPanel("browser");
    userDrivenNav = false;
    const tab = activeBrowserTab() || addBrowserTab(url);
    tab.url = url;
    tab.view.src = url;
  }

  browserAddress.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { userDrivenNav = true; navigateBrowser(browserAddress.value); }
  });
  browserBack.addEventListener("click", () => {
    const v = activeWebview();
    if (v && v.canGoBack()) v.goBack();
  });
  browserForward.addEventListener("click", () => {
    const v = activeWebview();
    if (v && v.canGoForward()) v.goForward();
  });
  browserReload.addEventListener("click", () => activeWebview()?.reload());

  // Each preset emulates a real device width; applyDeviceScale renders the webview at that width
  // (so the page picks the matching responsive layout) and scales it to fit the panel. "Desktop"
  // must emulate a true desktop width — using the narrow panel width made desktop mode show the
  // site's MOBILE layout, and tablet's 820px showed the desktop layout, which is backwards.
  const DEVICES = [
    { id: "desktop", label: "Desktop", width: 1280 },
    { id: "tablet", label: "Tablet", width: 768 },
    { id: "mobile", label: "Mobile", width: 390 },
  ];

  function setBrowserSize(mode) {
    browserViewport.classList.remove("device", "device-mobile", "device-tablet", "device-desktop");
    browserViewport.classList.add("device", "device-" + (DEVICES.find((d) => d.id === mode) ? mode : "desktop"));
    deviceBtn.textContent = (DEVICES.find((d) => d.id === mode)?.label || "Desktop") + " ▾";
    applyDeviceScale();
  }

  // Renders the device-preview webview at the true device width but visually scaled to fit the
  // panel, so the whole frame is always visible (never clipped) however narrow the panel is, and
  // the page picks the responsive layout for that real width (desktop/tablet/mobile).
  function applyDeviceScale() {
    const wv = activeWebview();
    if (!wv) return;
    const dev = DEVICES.find((d) => browserViewport.classList.contains("device-" + d.id));
    if (!dev) {
      wv.style.position = "";
      wv.style.transform = "";
      wv.style.transformOrigin = "";
      wv.style.width = "";
      wv.style.height = "";
      wv.style.left = "";
      wv.style.top = "";
      return;
    }
    const deviceWidth = dev.width;
    const pad = 18;
    const availW = Math.max(120, browserViewport.clientWidth - pad * 2);
    const availH = Math.max(200, browserViewport.clientHeight - pad * 2);
    const scale = Math.min(1, availW / deviceWidth);
    const scaledW = deviceWidth * scale;
    wv.style.width = deviceWidth + "px";
    wv.style.height = availH / scale + "px";
    wv.style.transform = `scale(${scale})`;
    wv.style.left = Math.round((browserViewport.clientWidth - scaledW) / 2) + "px";
  }

  deviceBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = deviceMenu.hidden;
    closeAllMenus(deviceMenu);
    if (willOpen) {
      deviceMenu.innerHTML = "";
      for (const d of DEVICES) {
        const item = document.createElement("div");
        item.className = "menu-item";
        item.textContent = d.label;
        item.addEventListener("click", () => {
          setBrowserSize(d.id);
          deviceMenu.hidden = true;
        });
        deviceMenu.appendChild(item);
      }
    }
    deviceMenu.hidden = !willOpen;
  });

  const BOOKMARKS = [
    { label: "localhost:3000", url: "http://localhost:3000", hue: "#4ade80" },
    { label: "localhost:5173", url: "http://localhost:5173", hue: "#60a5fa" },
    { label: "nutaan.com", url: "https://nutaan.com", hue: "#c084fc" },
  ];

  function renderBookmarks() {
    bookmarksEl.innerHTML = "";
    for (const b of BOOKMARKS) {
      const btn = document.createElement("button");
      btn.className = "bookmark";
      btn.innerHTML = `<span class="dot" style="background:${b.hue}"></span><span>${escapeHtml(b.label)}</span>`;
      btn.addEventListener("click", () => { userDrivenNav = true; navigateBrowser(b.url); });
      bookmarksEl.appendChild(btn);
    }
  }

  // ---------- Thread rendering ----------
  function renderEmptyVisibility() {
    const hasContent = thread.querySelectorAll(".row, .tool-card, .permission-card, .file-group-card, .swarm-card").length > 0;
    const coworker = sidebarView === "coworker";
    emptyState.hidden = hasContent || coworker;
    if (coworkerHero) coworkerHero.hidden = hasContent || !coworker;
    renderOutcomeEmpty();
    placeComposer();
    renderChatRail();
  }

  // ---------- Chat rail: a strip on the chat's left edge ----------
  // One dash per thread block; it grows as work happens, follows scroll, and jumps on click.
  const chatRail = el("chatRail");
  // A map of the conversation, not a decoration: every block is a mark at the place it actually
  // sits in the scroll, your own messages longer than the rest, and the one in view is lit. It
  // only appears once there is something to move between.
  // One dash per block, evenly down the column; the one in view lit; a preview on hover; click
  // to jump. It only appears once there is something to move between.
  let railBlocks = [];
  function railLabel(b) {
    const t = (b.textContent || "").trim().replace(/\s+/g, " ");
    if (b.classList.contains("user")) return { who: "You", text: t.slice(0, 160) };
    if (b.classList.contains("assistant")) return { who: "Nutaan", text: t.slice(0, 160) };
    if (b.classList.contains("tool-card")) return { who: (b.querySelector(".tool-title") || {}).textContent || "Tool", text: ((b.querySelector(".tool-cmd") || {}).textContent || t).slice(0, 120) };
    return { who: "", text: t.slice(0, 160) };
  }
  const railTip = document.createElement("div");
  railTip.className = "rail-tip";
  railTip.hidden = true;
  document.body.appendChild(railTip);
  function renderChatRail() {
    if (!chatRail) return;
    railBlocks = [...thread.children].filter((c) => !c.hidden && c.id !== "emptyState" && c.id !== "coworkerHero" && !c.classList.contains("thinking-row") && !c.classList.contains("sys-line"));
    if (railBlocks.length < 2) { chatRail.innerHTML = ""; return; }
    chatRail.innerHTML = railBlocks.slice(0, 80).map((b, i) =>
      `<button type="button" class="rail-dot${b.classList.contains("user") ? " you" : ""}" data-i="${i}"></button>`).join("");
    chatRail.querySelectorAll(".rail-dot").forEach((d) => {
      d.addEventListener("click", () => railBlocks[Number(d.dataset.i)]?.scrollIntoView({ behavior: "smooth", block: "center" }));
      d.addEventListener("mouseenter", () => {
        const b = railBlocks[Number(d.dataset.i)]; if (!b) return;
        const { who, text } = railLabel(b);
        railTip.innerHTML = `${who ? `<b>${escapeHtml(who)}</b>` : ""}<span>${escapeHtml(text)}</span>`;
        const r = d.getBoundingClientRect();
        railTip.style.top = Math.min(window.innerHeight - 120, Math.max(60, r.top - 12)) + "px";
        railTip.style.left = r.right + 10 + "px";
        railTip.hidden = false;
      });
      d.addEventListener("mouseleave", () => { railTip.hidden = true; });
    });
    updateRailActive();
  }
  function updateRailActive() {
    if (!chatRail || !chatRail.childElementCount) return;
    const mid = threadScroll.scrollTop + threadScroll.clientHeight / 2;
    let best = 0, bestD = Infinity;
    railBlocks.forEach((b, i) => { const d = Math.abs(b.offsetTop + b.offsetHeight / 2 - mid); if (d < bestD) { bestD = d; best = i; } });
    [...chatRail.children].forEach((d, i) => d.classList.toggle("active", i === best));
  }
  threadScroll.addEventListener("scroll", updateRailActive, { passive: true });
  new ResizeObserver(() => renderChatRail()).observe(thread);

  // Home puts the composer under the greeting, in the middle of the screen, the way a search box
  // sits on a start page; the moment the conversation has content it docks to the bottom.
  const composerSlot = el("composerSlot");
  const chatMain = document.querySelector("main.chat");
  function placeComposer() {
    const composerWrap = document.querySelector(".composer-wrap"); // declared later in this file; looked up, not captured
    if (!composerWrap || !composerSlot || !chatMain) return;
    const home = !emptyState.hidden && sidebarView !== "coworker";
    if (home) {
      if (composerWrap.parentElement !== composerSlot) composerSlot.appendChild(composerWrap);
    } else if (composerWrap.parentElement !== chatMain) {
      chatMain.appendChild(composerWrap);
    }
    chatMain.classList.toggle("home", home);
  }

  // Outcome-oriented starters for the co-worker landing — clicking one drops it into the composer,
  // which is where the actual work still happens (same editor).
  const COWORKER_CHIPS = [
    "Organise my Downloads folder by file type",
    "Find and summarise a document on this computer",
    "Audit this project for security issues and report back",
    "Draft a handover doc from this codebase",
    "Clean up old files I no longer need",
  ];

  function renderCoworkerChips() {
    const box = el("cwChips");
    if (!box) return;
    box.innerHTML = "";
    for (const text of COWORKER_CHIPS) {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "cw-chip";
      chip.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5.5v13M5.5 12h13"/></svg><span>${escapeHtml(text)}</span>`;
      chip.addEventListener("click", () => {
        input.value = text;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        autoGrowInput();
      });
      box.appendChild(chip);
    }
  }

  // Delegated: streaming rewrites a bubble's innerHTML on every delta, so per-render listeners
  // would be attached and thrown away hundreds of times per message.
  thread.addEventListener("click", async (e) => {
    const btn = e.target.closest(".code-copy");
    if (!btn) return;
    const code = btn.closest(".code-block")?.querySelector("code");
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code.textContent);
      btn.textContent = "Copied";
      btn.classList.add("copied");
      setTimeout(() => {
        btn.textContent = "Copy";
        btn.classList.remove("copied");
      }, 1400);
    } catch {
      btn.textContent = "Failed";
      setTimeout(() => { btn.textContent = "Copy"; }, 1400);
    }
  });

  // Absolute paths the agent mentions become clickable, because reading one out and then
  // hunting for it in a file manager is work the app can just do. Only real text is touched —
  // walking text nodes rather than regexing the HTML keeps code blocks and existing markup
  // intact, and skipping <code>/<pre> stops a path inside a command becoming a link.
  const PATH_PATTERN = /(?:[A-Za-z]:\\[^\s"'<>|*?]+|\/(?:Users|home|var|opt|etc|tmp)\/[^\s"'<>|*?]+)/g;

  function linkifyPaths(el) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (node.parentElement?.closest("code, pre, a, .path-link")) return NodeFilter.FILTER_REJECT;
        return PATH_PATTERN.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
      },
    });
    const targets = [];
    while (walker.nextNode()) targets.push(walker.currentNode);

    for (const node of targets) {
      const frag = document.createDocumentFragment();
      let last = 0;
      const text = node.nodeValue;
      PATH_PATTERN.lastIndex = 0;
      let m;
      while ((m = PATH_PATTERN.exec(text)) !== null) {
        // Trailing sentence punctuation is part of the prose, not the filename.
        const raw = m[0].replace(/[.,;:)\]]+$/, "");
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("span");
        a.className = "path-link";
        a.textContent = raw;
        a.title = `Open ${raw}`;
        a.dataset.path = raw;
        frag.appendChild(a);
        last = m.index + raw.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  thread.addEventListener("click", (e) => {
    const link = e.target.closest(".path-link");
    if (!link) return;
    openDeviceFileInPanel(link.dataset.path);
  });

  // A link a connected tool produced should read as a result, not a bare URL. When a service we
  // know is behind the link, its logo, name and an Open + Copy button turn it into the same card
  // the tool-result card uses — so every tool that hands back a link looks the same in the thread.
  const SERVICE_CARDS = [
    { test: (u) => /:\/\/(www\.)?canva\.com\//.test(u), name: "Canva", sub: "Created in Canva", icon: "canva.ico" },
    { test: (u) => /docs\.google\.com\/document/.test(u), name: "Google Docs", sub: "Google Docs", icon: "gdocs.png" },
    { test: (u) => /docs\.google\.com\/spreadsheets/.test(u), name: "Google Sheets", sub: "Google Sheets", icon: "gsheets.png" },
    { test: (u) => /docs\.google\.com\/presentation/.test(u), name: "Google Slides", sub: "Google Slides", icon: "gdocs.png" },
    { test: (u) => /notebooklm\.google\.com/.test(u), name: "NotebookLM", sub: "NotebookLM", icon: "notebooklm.svg" },
    { test: (u) => /\.(pdf|png|jpe?g|mp4|gif|pptx?)(\?|$)/i.test(u), name: "Download", sub: "File ready to download", icon: null, download: true },
  ];

  function serviceCardFor(url, label) {
    const svc = SERVICE_CARDS.find((s) => s.test(url));
    if (!svc) return null;
    const card = document.createElement("div");
    card.className = "link-card";
    const logo = document.createElement("div"); logo.className = "link-card-logo";
    if (svc.icon) { const img = document.createElement("img"); img.src = "../assets/tools/" + svc.icon; img.alt = ""; img.addEventListener("error", () => { img.remove(); logo.textContent = svc.name.slice(0, 1); }); logo.appendChild(img); }
    else { logo.textContent = "↓"; logo.classList.add("dl"); }
    const meta = document.createElement("div"); meta.className = "link-card-meta";
    const title = document.createElement("div"); title.className = "link-card-title"; title.textContent = (label && label !== url) ? label : svc.name;
    const sub = document.createElement("div"); sub.className = "link-card-sub"; sub.textContent = svc.sub;
    meta.appendChild(title); meta.appendChild(sub);
    const actions = document.createElement("div"); actions.className = "link-card-actions";
    const open = document.createElement("button"); open.type = "button"; open.className = "link-card-btn";
    open.textContent = svc.download ? "Download ↓" : "Open ↗";
    open.addEventListener("click", () => window.nutaan.openExternal(url));
    actions.appendChild(open);
    if (!svc.download) {
      const copy = document.createElement("button"); copy.type = "button"; copy.className = "link-card-btn ghost"; copy.title = "Copy link"; copy.textContent = "Copy";
      copy.addEventListener("click", () => { navigator.clipboard?.writeText(url).then(() => { copy.textContent = "Copied"; setTimeout(() => (copy.textContent = "Copy"), 1200); }).catch(() => {}); });
      actions.appendChild(copy);
    }
    card.appendChild(logo); card.appendChild(meta); card.appendChild(actions);
    return card;
  }

  // Canva serves the same design under different share links (edit vs view), so collapse them to
  // the design id; other services dedupe on the whole URL.
  function linkDedupeKey(url) {
    const m = /canva\.com\/(?:design|d)\/([A-Za-z0-9_-]+)/.exec(url);
    return m ? "canva:" + m[1] : url;
  }

  // Every known-service link a message mentions becomes one card, appended under the text, so a
  // tool that hands back a link always looks the same — the card the user asked for — instead of a
  // raw "[Edit design](url)". The inline link stays as quiet styled text; the card carries the
  // Open/Copy actions. Duplicate links to one design collapse into a single card.
  function enrichServiceLinks(el) {
    const seen = new Set();
    const cards = [];
    const addUrl = (url, label) => {
      if (!url || !SERVICE_CARDS.some((s) => s.test(url))) return;
      const key = linkDedupeKey(url);
      if (seen.has(key)) return;
      seen.add(key);
      const card = serviceCardFor(url, label && label !== url ? label : null);
      if (card) cards.push(card);
    };

    // Markdown links first — they carry a human label like "Edit design".
    for (const a of el.querySelectorAll("a.md-link, a[href^='http']")) {
      const url = a.getAttribute("href");
      if (url && SERVICE_CARDS.some((s) => s.test(url))) { a.classList.add("inline-service-link"); addUrl(url, a.textContent); }
    }

    // Bare URLs the model wrote as plain text ("Edit URL: https://…") never became anchors, so scan
    // the text too. Make each one clickable in place and give it a card as well.
    const BARE_URL = /https?:\/\/[^\s<>()"']+/g;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement?.closest("code, pre, a") ? NodeFilter.FILTER_REJECT : (BARE_URL.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT)),
    });
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    for (const node of textNodes) {
      const text = node.nodeValue;
      const frag = document.createDocumentFragment();
      let last = 0; let m; BARE_URL.lastIndex = 0;
      while ((m = BARE_URL.exec(text))) {
        const url = m[0].replace(/[.,;:)\]]+$/, "");
        if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
        const a = document.createElement("a");
        a.href = url; a.target = "_blank"; a.rel = "noopener"; a.textContent = url;
        a.className = "md-link" + (SERVICE_CARDS.some((s) => s.test(url)) ? " inline-service-link" : "");
        frag.appendChild(a);
        addUrl(url, null);
        last = m.index + url.length;
      }
      if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    }

    if (cards.length) {
      const holder = document.createElement("div");
      holder.className = "link-card-group";
      cards.forEach((c) => holder.appendChild(c));
      el.appendChild(holder);
    }
  }

  function appendBubble(role, content) {
    const row = document.createElement("div");
    row.className = "row " + role;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    // Swarm report lands in history as a minimized story the user can expand.
    if (role === "assistant" && typeof content === "string" && content.startsWith("[Nutaan Swarm report]")) {
      const body = content.replace(/^\[Nutaan Swarm report\]\s*/, "");
      const om = body.match(/outcome[^\n]*\n+([^\n]+)/i);
      const preview = ((om ? om[1] : body.split("\n").find((l) => l.trim())) || "").replace(/[#*`>]/g, "").trim();
      const details = document.createElement("details");
      details.className = "swarm-report";
      const summary = document.createElement("summary");
      summary.innerHTML =
        `<span class="sr-mark">◎</span>` +
        `<span class="sr-head"><span class="sr-title">Nutaan Swarm report</span>` +
        `<span class="sr-preview">${escapeHtml(preview.slice(0, 96))}</span></span>` +
        `<span class="sr-chev"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></span>`;
      const inner = document.createElement("div");
      inner.className = "swarm-report-body";
      inner.innerHTML = renderMarkdownLite(body);
      linkifyPaths(inner); enrichServiceLinks(inner);
      details.appendChild(summary);
      details.appendChild(inner);
      bubble.classList.add("swarm-report-bubble");
      bubble.appendChild(details);
      row.appendChild(bubble);
      thread.appendChild(row);
      renderEmptyVisibility();
      scrollToBottom();
      return bubble;
    }
    bubble.innerHTML = role === "assistant" ? renderMarkdownLite(content) : escapeHtml(content);
    if (role === "assistant") { linkifyPaths(bubble); enrichServiceLinks(bubble); enrichAgentListing(bubble, content); }
    row.appendChild(bubble);
    thread.appendChild(row);
    renderEmptyVisibility();
    scrollToBottom();
    return bubble;
  }

  function toolLabel(name, args) {
    if (name === "map_route") return `Mapping the route through <code>${escapeHtml((Array.isArray(args.stops) ? args.stops : []).join(" → ") || "your stops")}</code>`;
    if (name === "list_dir") return `Listing <code>${escapeHtml(args.path || ".")}</code>`;
    if (name === "read_file") return `Reading <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "search_files") return `Searching for <code>${escapeHtml(args.pattern || "")}</code>`;
    if (name === "list_skills") return `Checking available skills`;
    if (name === "use_skill") return `Using skill <code>${escapeHtml(args.id || "")}</code>`;
    if (name === "osint_search_tools") return `Searching OSINT Arsenal for <code>${escapeHtml(args.query || args.category || "tools")}</code>`;
    if (name === "osint_dns_recon") return `Running DNS reconnaissance on <code>${escapeHtml(args.domain || "")}</code>`;
    if (name === "osint_ip_lookup") return `Looking up IP intelligence for <code>${escapeHtml(args.ip || "")}</code>`;
    if (name === "osint_subdomain_enum") return `Enumerating subdomains for <code>${escapeHtml(args.domain || "")}</code>`;
    if (name === "osint_http_recon") return `Auditing HTTP security & cookies on <code>${escapeHtml(args.url || "")}</code>`;
    if (name === "osint_dork_generator") return `Generating exposure-audit dorks for <code>${escapeHtml(args.target || "")}</code>`;
    if (name === "vuln_static_scan") return `Running static vulnerability scan on <code>${escapeHtml(args.path || ".")}</code>`;
    if (name === "browser_navigate") return `Opening <code>${escapeHtml(args.url || "")}</code> in the browser panel`;
    if (name === "browser_read_page") return `Reading the browser panel's current page`;
    if (name === "browser_click") return `Clicking <code>${escapeHtml(args.selector || "")}</code> in the browser panel`;
    if (name === "browser_type") return `Typing into <code>${escapeHtml(args.selector || "")}</code> in the browser panel`;
    if (name === "browser_scroll") return `Scrolling the browser panel ${escapeHtml(args.direction || "")}`;
    if (name === "browser_screenshot") return `Taking a screenshot of the browser panel`;
    if (name === "browser_resize") return `Switching the browser panel to ${escapeHtml(args.size || "")} view`;
    if (name === "browser_execute_script") return `Running a script in the browser panel`;
    if (name === "write_file") return `Writing <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "edit_file") return `Editing <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "run_background") return `Starting background task <code>${escapeHtml((args.command || "").slice(0, 60))}</code>`;
    if (name === "check_background_task") return `Checking background task <code>${escapeHtml(args.id || "")}</code>`;
    if (name === "list_background_tasks") return `Listing background tasks`;
    if (name === "cleanup_storage") return args.dry_run ? `Checking what storage can be freed` : `Freeing up disk space`;
    if (name === "os_system_stats") return `Reading CPU, memory and disk usage`;
    if (name === "os_kill_process") return `Closing <code>${escapeHtml(args.pid != null ? "pid " + args.pid : args.name || "")}</code>`;
    if (name === "stop_background_task") return `Stopping background task <code>${escapeHtml(args.id || "")}</code>`;
    if (name === "run_command") {
      const cmd = String(args.command || "").replace(/\s+/g, " ").trim();
      if (!cmd) return `Running command`;
      return `Running <code>${escapeHtml(cmd.length > 90 ? cmd.slice(0, 90) + "…" : cmd)}</code>`;
    }
    return escapeHtml(name);
  }

  // A tool call is one row: what kind of thing it did (icon), a short label, the file or command
  // inline, and — once it has run — a stat (+11 −5, 3 matches, exit 1). The sentence that used
  // to be the title is the tooltip. Each kind has a colour, so a run reads at a glance.
  const TOOL_ICONS = {
    terminal: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M5 7l4 4-4 4M12 16h7\"/></svg>",
    edit: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 20h9M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z\"/></svg>",
    read: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z\"/><path d=\"M4 5.5v15\"/></svg>",
    search: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"11\" cy=\"11\" r=\"7\"/><path d=\"M20 20l-3.2-3.2\"/></svg>",
    files: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/></svg>",
    browser: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><circle cx=\"12\" cy=\"12\" r=\"9\"/><path d=\"M3.4 9.5h17.2M3.4 14.5h17.2M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18\"/></svg>",
    design: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z\"/></svg>",
    skill: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 19.5A2.5 2.5 0 0 1 6.5 17H20\"/><path d=\"M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z\"/></svg>",
    system: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><rect x=\"4\" y=\"4\" width=\"16\" height=\"16\" rx=\"2\"/><path d=\"M9 1.5V4M15 1.5V4M9 20v2.5M15 20v2.5M1.5 9H4M1.5 15H4M20 9h2.5M20 15h2.5\"/></svg>",
    mcp: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7\"/><path d=\"M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7\"/></svg>",
    generic: "<svg width=\"13\" height=\"13\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M14.7 6.3a4 4 0 0 0-5.4 5.4l-6 6a1.5 1.5 0 0 0 2 2l6-6a4 4 0 0 0 5.4-5.4l-2.3 2.3-2-2 2.3-2.3z\"/></svg>",
  };
  function toolKind(name) {
    if (/^(run_command|run_background|check_background_task|list_background_tasks|stop_background_task)$/.test(name)) return { kind: "terminal", label: "Terminal" };
    if (name === "edit_file") return { kind: "edit", label: "Edit" };
    if (name === "write_file") return { kind: "edit", label: "Write" };
    if (name === "read_file" || name === "view_image") return { kind: "read", label: name === "view_image" ? "View" : "Read" };
    if (name === "search_files" || name === "web_search") return { kind: "search", label: name === "web_search" ? "Web" : "Search" };
    if (name === "web_fetch") return { kind: "browser", label: "Fetch" };
    if (name === "list_dir") return { kind: "files", label: "Files" };
    if (/^browser_/.test(name)) return { kind: "browser", label: "Browser" };
    if (/^design_/.test(name)) return { kind: "design", label: { design_new: "Design", design_artboard: "Artboard", design_update: "Revise", design_verify: "Verify", design_brand: "Brand", design_read: "Design", design_list: "Designs", design_export: "Export" }[name] || "Design" };
    if (name === "use_skill" || name === "list_skills") return { kind: "skill", label: "Skill" };
    if (/^kb_|^memory_/.test(name)) return { kind: "search", label: /^kb_/.test(name) ? "Knowledge" : "Memory" };
    if (/^os_|^cleanup_storage$|^task_/.test(name)) return { kind: "system", label: /^task_/.test(name) ? "Plan" : "System" };
    if (/^mcp__/.test(name)) return { kind: "mcp", label: name.split("__")[1] || "MCP" };
    return { kind: "generic", label: name.replace(/_/g, " ") };
  }
  function toolSnippet(name, args) {
    const a = args || {};
    if (/^(run_command|run_background)/.test(name)) return String(a.command || "").replace(/\s+/g, " ").trim();
    if (name === "edit_file" || name === "write_file" || name === "read_file" || name === "view_image") return String(a.path || "");
    if (name === "search_files") return String(a.pattern || a.query || "");
    if (name === "web_search") return String(a.query || "");
    if (name === "web_fetch" || /^browser_/.test(name)) return String(a.url || a.selector || a.text || a.action || a.size || "");
    if (name === "list_dir") return String(a.path || ".") || ".";
    if (name === "use_skill") return String(a.id || "") + (a.file ? " · " + a.file : "");
    if (/^design_/.test(name)) return String(a.name || a.artboard_id || a.id || "");
    if (/^mcp__/.test(name)) return name.split("__").slice(2).join("/");
    return "";
  }
  function toolHeaderHtml(name, args) {
    const { kind, label } = toolKind(name);
    const snippet = toolSnippet(name, args);
    const shown = snippet.length > 80 ? snippet.slice(0, 80) + "…" : snippet;
    return `<span class="tool-ico">${TOOL_ICONS[kind] || TOOL_ICONS.generic}</span>` +
      `<span class="tool-title">${escapeHtml(label)}</span>` +
      (snippet ? `<code class="tool-cmd" title="${escapeHtml(snippet)}">${escapeHtml(shown)}</code>` : "") +
      `<span class="tool-chev">▸</span>`;
  }

  function appendToolCard(id, name, args) {
    const wrap = document.createElement("div");
    wrap.className = `tool-card pending kind-${toolKind(name).kind}`;
    wrap.title = toolLabel(name, args).replace(/<[^>]+>/g, "");
    wrap.innerHTML = `
      <div class="tool-header">${toolHeaderHtml(name, args)}</div>
      <div class="tool-detail" hidden></div>
    `;
    const header = wrap.querySelector(".tool-header");
    const detail = wrap.querySelector(".tool-detail");
    header.addEventListener("click", () => {
      if (!detail.innerHTML.trim()) return;
      detail.hidden = !detail.hidden;
      wrap.querySelector(".tool-chev").textContent = detail.hidden ? "▸" : "▾";
    });
    thread.appendChild(wrap);
    toolCards.set(id, wrap);
    renderEmptyVisibility();
    scrollToBottom();
  }

  // Longest-common-subsequence line diff. Printing the whole old block in red followed by the
  // whole new block in green marks every untouched line as changed, which makes a one-line edit
  // inside a 40-line replacement impossible to spot.
  function diffLines(a, b) {
    const n = a.length;
    const m = b.length;
    // Guard: the LCS table is O(n*m), so fall back to a plain replace block on huge edits.
    if (n * m > 400_000) {
      return [...a.map((l) => ({ t: "-", l })), ...b.map((l) => ({ t: "+", l }))];
    }
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const out = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
      if (a[i] === b[j]) { out.push({ t: " ", l: a[i] }); i++; j++; }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ t: "-", l: a[i] }); i++; }
      else { out.push({ t: "+", l: b[j] }); j++; }
    }
    while (i < n) out.push({ t: "-", l: a[i++] });
    while (j < m) out.push({ t: "+", l: b[j++] });
    return out;
  }

  function diffStat(diff) {
    const rows = diffLines(String(diff.oldString || "").split("\n"), String(diff.newString || "").split("\n"));
    return {
      added: rows.filter((r) => r.t === "+").length,
      removed: rows.filter((r) => r.t === "-").length,
      rows,
    };
  }

  // Old and new line numbers in two gutters, the sign in a third, the text after: the shape of
  // a change reads from the gutters alone, and a line can be found in the editor by its number.
  function diffHtml(diff) {
    const { rows } = diffStat(diff);
    let oldNo = 1, newNo = 1;
    const body = rows
      .map((r) => {
        const cls = r.t === "+" ? "diff-add" : r.t === "-" ? "diff-del" : "diff-ctx";
        const o = r.t === "+" ? "" : oldNo++;
        const nn = r.t === "-" ? "" : newNo++;
        // highlightCode escapes, so the raw line goes in untouched — same coloring the code panel uses.
        return `<div class="diff-line ${cls}"><span class="diff-no">${o}</span><span class="diff-no">${nn}</span><span class="diff-sign">${r.t === " " ? "" : r.t}</span><span class="diff-text">${highlightCode(r.l) || "&nbsp;"}</span></div>`;
      })
      .join("");
    return `<pre class="diff diff-numbered">${body}</pre>`;
  }

  function permissionStat(req) {
    if (req.name === "edit_file" && req.diff) {
      const { added, removed } = diffStat(req.diff);
      return `+${added} -${removed}`;
    }
    if (req.name === "write_file") return `+${String(req.detail || "").split("\n").length}`;
    return "";
  }

  let currentFileGroupCard = null;
  const resetFileGroup = () => { currentFileGroupCard = null; };

  function fileGroupVerb(names) {
    const hasWrite = names.includes("write_file");
    const hasEdit = names.includes("edit_file");
    if (hasWrite && !hasEdit) return "Wrote";
    if (hasEdit && !hasWrite) return "Edited";
    return "Changed";
  }

  // Consecutive auto-approved file writes/edits in the same turn collapse into one summary card
  // instead of flooding the thread with a card per file.
  function appendFileGroupRow(req) {
    const stat = permissionStat(req);
    const body = req.diff ? diffHtml(req.diff) : `<pre>${escapeHtml(req.detail || "")}</pre>`;
    const fullPath = req.args?.path || "";
    const fileName = basename(fullPath) || fullPath;

    if (!currentFileGroupCard) {
      const wrap = document.createElement("div");
      wrap.className = "file-group-card";
      wrap.innerHTML = `
        <div class="file-group-header">
          <span class="file-group-title"></span>
          <button class="file-group-toggle" type="button">View changes</button>
        </div>
        <div class="file-group-list" hidden></div>
      `;
      thread.appendChild(wrap);
      const toggle = wrap.querySelector(".file-group-toggle");
      const list = wrap.querySelector(".file-group-list");
      toggle.addEventListener("click", () => {
        list.hidden = !list.hidden;
        toggle.textContent = list.hidden ? "View changes" : "Hide changes";
      });
      currentFileGroupCard = { wrap, list, names: [], files: [], added: 0, removed: 0 };
      renderEmptyVisibility();
    }

    const group = currentFileGroupCard;
    group.names.push(req.name);
    group.files.push(fileName);
    if (req.diff) {
      const s = diffStat(req.diff);
      group.added += s.added;
      group.removed += s.removed;
    } else if (req.name === "write_file") {
      group.added += String(req.detail || "").split("\n").length;
    }

    const statHtml = stat.replace(/\+(\d+)/, '<span class="stat-add">+$1</span>').replace(/-(\d+)/, '<span class="stat-del">-$1</span>');
    const row = document.createElement("div");
    row.className = "file-group-row";
    row.innerHTML =
      `<span class="file-row-name" title="${escapeHtml(fullPath)}">${escapeHtml(fileName)}</span>` +
      (stat ? `<span class="tool-stat">${statHtml}</span>` : "") +
      `<span class="tool-chev">▸</span>`;
    const detail = document.createElement("div");
    detail.className = "file-group-detail";
    detail.hidden = true;
    detail.innerHTML = body;
    row.addEventListener("click", () => {
      detail.hidden = !detail.hidden;
      row.querySelector(".tool-chev").textContent = detail.hidden ? "▸" : "▾";
    });
    group.list.appendChild(row);
    group.list.appendChild(detail);

    const verb = fileGroupVerb(group.names);
    const n = group.files.length;
    group.wrap.querySelector(".file-group-title").innerHTML =
      escapeHtml(n === 1 ? `${verb} ${group.files[0]}` : `${verb} ${n} files`) +
      ` <span class="tool-stat"><span class="stat-add">+${group.added}</span> <span class="stat-del">−${group.removed}</span></span>`;
    scrollToBottom();
  }

  function appendPermissionCard(req) {
    const wrap = document.createElement("div");
    wrap.className = "permission-card";
    const body = req.diff ? diffHtml(req.diff) : `<pre>${escapeHtml(req.detail || "")}</pre>`;
    const stat = permissionStat(req);
    wrap.innerHTML = `
      <div class="perm-header">
        <span class="perm-title">${toolLabel(req.name, req.args)} — needs your approval</span>
        ${stat ? `<span class="tool-stat">${escapeHtml(stat)}</span>` : ""}
      </div>
      <div class="perm-detail">${body}</div>
      <div class="permission-actions">
        <button class="btn-approve">Approve</button>
        <button class="btn-deny">Deny</button>
      </div>
    `;
    const permDetail = wrap.querySelector(".perm-detail");

    function collapse(labelText) {
      wrap.classList.add("resolved");
      permDetail.hidden = true;
      wrap.querySelector(".permission-actions").insertAdjacentHTML(
        "afterend",
        `<div class="perm-result">${labelText} <span class="tool-chev">▸</span></div>`
      );
      wrap.querySelector(".perm-result").addEventListener("click", () => {
        permDetail.hidden = !permDetail.hidden;
        wrap.querySelector(".perm-result .tool-chev").textContent = permDetail.hidden ? "▸" : "▾";
      });
    }

    if (req.autoApproved) {
      // toolLabel escapes every interpolated value, so its markup is safe to keep here — and
      // keeping it is the point: the command or path is what makes the card readable.
      wrap.querySelector(".perm-title").innerHTML = toolLabel(req.name, req.args);
      collapse("Auto-approved");
    } else {
      wrap.querySelector(".btn-approve").addEventListener("click", () => {
        window.nutaan.respondToPermission(req.id, true);
        collapse("Approved");
      });
      wrap.querySelector(".btn-deny").addEventListener("click", () => {
        window.nutaan.respondToPermission(req.id, false);
        collapse("Denied");
      });
    }
    thread.appendChild(wrap);
    toolCards.set(req.id, wrap);
    renderEmptyVisibility();
    scrollToBottom();
  }

  // Open a tool card's detail so a rich result (agent cards, a Canva design) is visible at once
  // rather than hidden behind a chevron the user would have to find and click.
  function expandCard(cardEl) {
    const detail = cardEl.querySelector(".tool-detail");
    const chev = cardEl.querySelector(".tool-chev");
    if (detail) detail.hidden = false;
    if (chev) chev.textContent = "▾";
  }

  function setToolStat(cardEl, text) {
    const header = cardEl.querySelector(".tool-header");
    if (!header) return;
    const stat = document.createElement("span");
    stat.className = "tool-stat";
    stat.textContent = text;
    header.insertBefore(stat, header.querySelector(".tool-chev"));
  }

  function resolveToolCard(id, name, result) {
    const cardEl = toolCards.get(id);
    if (!cardEl) return;
    const isError = result && result.error;
    if (cardEl.classList.contains("permission-card")) {
      const resultLine = cardEl.querySelector(".perm-result");
      if (resultLine && isError) resultLine.textContent += ` — ${result.error}`;
      // run_command lives on a permission card rather than a tool card, so without this its
      // output never lands anywhere and the card just says "Auto-approved" with nothing behind it.
      const detail = cardEl.querySelector(".perm-detail");
      if (detail && !isError && name === "run_command") {
        const out = (result.stdout || "") + (result.stderr ? "\n" + result.stderr : "");
        const code = typeof result.exitCode === "number" ? result.exitCode : 0;
        detail.innerHTML = `<pre>${escapeHtml(out.trim() ? out.slice(0, 4000) : `(no output, exit code ${code})`)}</pre>`;
        if (resultLine) resultLine.firstChild.textContent = code === 0 ? "Ran — view output " : `Exit code ${code} — view output `;
      }
      return;
    }

    cardEl.classList.remove("pending");
    cardEl.classList.add(isError ? "err" : "ok");
    const detail = cardEl.querySelector(".tool-detail");

    if (isError) {
      detail.innerHTML = `<pre>${escapeHtml(result.error)}</pre>`;
    } else if (name === "list_dir" && result.entries) {
      if (result.entries.length === 0) {
        setToolStat(cardEl, "empty folder");
      } else {
        setToolStat(cardEl, `${result.entries.length} item${result.entries.length === 1 ? "" : "s"}`);
        detail.innerHTML = `<pre>${escapeHtml(result.entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n"))}</pre>`;
      }
    } else if (name === "read_file" && result.content) {
      const shown = result.shown ? `${result.shown} of ${result.totalLines}` : `${result.content.split("\n").length} lines`;
      setToolStat(cardEl, result.hasMore ? `${shown} lines — more` : `${shown} lines`);
      const preview = result.content.length > 600 ? result.content.slice(0, 600) + "\n…" : result.content;
      // The read preview carries the same syntax colors as the code panel.
      detail.innerHTML = `<pre>${highlightCode(preview)}</pre>`;
    } else if (name === "run_command") {
      const out = (result.stdout || "") + (result.stderr ? "\n" + result.stderr : "");
      if (out.trim()) detail.innerHTML = `<pre>${escapeHtml(out.slice(0, 800))}</pre>`;
      if (typeof result.exitCode === "number") setToolStat(cardEl, `exit ${result.exitCode}`);
    } else if ((name === "edit_file" || name === "write_file") && !isError) {
      if (result.diff) {
        const { added, removed } = diffStat(result.diff);
        setToolStat(cardEl, `+${added} −${removed}`);
        detail.innerHTML = diffHtml(result.diff);
      }
      else if (name === "write_file") setToolStat(cardEl, result.bytes ? `${result.bytes} bytes` : "written");
    } else if (name === "search_files" && result.matches) {
      setToolStat(cardEl, `${result.matches.length} match${result.matches.length === 1 ? "" : "es"}`);
      const lines = result.matches.slice(0, 30).map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n");
      detail.innerHTML = `<pre>${escapeHtml(lines || "No matches")}${result.truncated ? "\n…" : ""}</pre>`;
    } else if (name === "list_skills" && result.skills) {
      setToolStat(cardEl, `${result.skills.length} skill${result.skills.length === 1 ? "" : "s"}`);
      detail.innerHTML = `<pre>${escapeHtml(result.skills.map((s) => `${s.id} — ${s.description}`).join("\n") || "No skills available")}</pre>`;
    } else if ((name === "run_background" || name === "check_background_task") && (result.id || result.status)) {
      const statusTxt = result.status === "running" ? "running" : result.status === "exited" ? `exited (${result.exitCode})` : result.status;
      setToolStat(cardEl, `${result.id || ""} ${statusTxt}`.trim());
      const head = `${result.id || ""} · ${statusTxt}${result.command ? "\n$ " + result.command : ""}`;
      detail.innerHTML = `<pre>${escapeHtml(head + (result.output ? "\n\n" + result.output : (result.status === "running" ? "\n\n(running — check again for output)" : "")))}</pre>`;
    } else if (name === "cleanup_storage" && (result.items || result.scannedMB != null || result.totalMB != null)) {
      const scanned = result.scannedMB != null ? result.scannedMB : result.totalMB;
      const stat = result.dryRun
        ? `up to ${scanned} MB`
        : `freed ${result.freedMB} MB` + (result.blockedCount ? ` · ${result.blockedMB} MB locked` : "");
      setToolStat(cardEl, stat);
      // ✓ removed, ↺ freed some of it, ✗ nothing went. The reason travels with the line so a
      // locked folder can never read as a success.
      const lines = (result.items || []).map((i) => {
        const mark = result.dryRun ? "·" : i.removed ? "✓" : i.freedMB > 0 ? "↺" : "✗";
        const size = result.dryRun ? `${i.mb} MB` : `${i.freedMB} of ${i.mb} MB`;
        return `${mark} ${size}  ${i.label}${i.error ? `  — ${i.error}` : ""}`;
      });
      const head = result.dryRun
        ? `Up to ${scanned} MB across ${result.count} location(s) — some may be locked`
        : `Freed ${result.freedMB} MB` + (result.blockedCount ? `; ${result.blockedMB} MB in ${result.blockedCount} location(s) still in use` : "");
      detail.innerHTML = `<pre>${escapeHtml(head + "\n\n" + lines.join("\n"))}</pre>`;
    } else if (name === "os_system_stats" && result.cpu) {
      setToolStat(cardEl, `CPU ${result.cpu.percent}% · RAM ${result.memory.percent}%`);
      const procs = (result.topProcesses || []).map((p) => `  ${String(p.cpu).padStart(5)}%  ${String(Math.round(p.memMB)).padStart(6)} MB  ${p.name}${p.procs > 1 ? ` (${p.procs})` : ""}`);
      const disks = (result.disks || []).map((d) => `  ${d.drive}  ${d.freeGB} GB free of ${d.totalGB} GB`);
      const body = [
        result.summary,
        "",
        `CPU ${result.cpu.percent}% across ${result.cpu.cores} cores`,
        `RAM ${(result.memory.usedMB / 1024).toFixed(1)} / ${(result.memory.totalMB / 1024).toFixed(1)} GB (${result.memory.percent}%)`,
        "",
        "Busiest programs:",
        ...procs,
        ...(disks.length ? ["", "Disks:", ...disks] : []),
        ...(result.note ? ["", result.note] : []),
      ].join("\n");
      detail.innerHTML = `<pre>${escapeHtml(body)}</pre>`;
    } else if (name === "list_background_tasks" && result.tasks) {
      setToolStat(cardEl, `${result.tasks.length} task${result.tasks.length === 1 ? "" : "s"}`);
      const lines = result.tasks.map((t) => `${t.id}  [${t.status}${t.exitCode != null ? " " + t.exitCode : ""}]  ${t.command}`).join("\n");
      detail.innerHTML = `<pre>${escapeHtml(lines || "No background tasks")}</pre>`;
    } else if (name === "stop_background_task") {
      setToolStat(cardEl, result.ok ? `stopped ${result.id || ""}` : "not stopped");
      detail.innerHTML = `<pre>${escapeHtml(result.ok ? `Stopped ${result.id}` : result.error || "Could not stop")}</pre>`;
    } else if (name === "osint_search_tools" && result.tools) {
      setToolStat(cardEl, `${result.tools.length} tool${result.tools.length === 1 ? "" : "s"}`);
      const lines = result.tools.slice(0, 20).map((t) => {
        const meth = t.install && t.install.method ? ` [${t.install.method}]` : "";
        const url = t.url ? ` (${t.url})` : "";
        return `• ${t.name}${meth}: ${t.description}${url}`;
      }).join("\n");
      detail.innerHTML = `<pre>${escapeHtml(lines || "No tools found")}</pre>`;
    } else if (name === "osint_dns_recon" && result.records) {
      const recs = [];
      if (result.records.A) recs.push(`A: ${result.records.A.join(", ")}`);
      if (result.records.AAAA) recs.push(`AAAA: ${result.records.AAAA.join(", ")}`);
      if (result.records.MX) recs.push(`MX: ${result.records.MX.map((m) => `${m.exchange} (pri ${m.priority})`).join(", ")}`);
      if (result.records.NS) recs.push(`NS: ${result.records.NS.join(", ")}`);
      if (result.security) {
        recs.push(`SPF: ${result.security.hasSpf ? "Configured" : "MISSING"}`);
        recs.push(`DMARC: ${result.security.hasDmarc ? "Configured" : "MISSING"}`);
      }
      setToolStat(cardEl, `${Object.keys(result.records).filter((k) => result.records[k]).length} records`);
      detail.innerHTML = `<pre>${escapeHtml(recs.join("\n"))}</pre>`;
    } else if (name === "osint_ip_lookup" && result.ip) {
      setToolStat(cardEl, `${result.country || ""} (${result.ip})`.trim());
      const info = [
        `IP: ${result.ip}`,
        `Location: ${[result.city, result.region, result.country].filter(Boolean).join(", ")}`,
        `ISP / Org: ${[result.isp, result.org].filter(Boolean).join(" / ")}`,
        `AS: ${result.as || "N/A"}`,
        `Reverse DNS: ${result.reverseDns || "None"}`,
      ];
      detail.innerHTML = `<pre>${escapeHtml(info.join("\n"))}</pre>`;
    } else if (name === "osint_subdomain_enum" && result.subdomains) {
      setToolStat(cardEl, `${result.count} subdomains`);
      const preview = result.subdomains.slice(0, 40).join("\n") + (result.truncated ? "\n…" : "");
      detail.innerHTML = `<pre>${escapeHtml(preview)}</pre>`;
    } else if (name === "osint_http_recon" && result.status) {
      const cookieStat = result.cookies?.length ? `, ${result.cookies.length} cookies` : "";
      setToolStat(cardEl, `HTTP ${result.status} (Score: ${result.securityScore}/100${cookieStat})`);
      const lines = [
        `Target: ${result.targetUrl} [${result.status} ${result.statusText}]`,
        `Server: ${result.serverInfo.server || "Hidden"}`,
        result.serverInfo.xPoweredBy ? `X-Powered-By: ${result.serverInfo.xPoweredBy}` : null,
        `Security Score: ${result.securityScore} / 100`,
        result.cookies?.length ? `Cookies (${result.cookies.length}):\n` + result.cookies.map((c) => `  - ${c.name}: HttpOnly=${c.httpOnly}, Secure=${c.secure}, SameSite=${c.sameSite || "None"}${c.issues.length ? ` [${c.issues.length} issue(s)]` : ""}`).join("\n") : "Cookies: None set",
        result.credentialExposure?.length ? `Credential Disclosures (${result.credentialExposure.length}):\n` + result.credentialExposure.map((cr) => `  - [${cr.type}]: ${cr.count} occurrence(s) (${cr.sample})`).join("\n") : null,
        result.detectedIssues?.length ? `Issues:\n  - ${result.detectedIssues.join("\n  - ")}` : "No basic security header issues found.",
      ].filter(Boolean).join("\n\n");
      detail.innerHTML = `<pre>${escapeHtml(lines)}</pre>`;
    } else if (name === "osint_dork_generator" && result.categories) {
      const cats = Object.keys(result.categories);
      setToolStat(cardEl, `${cats.length} dork categories`);
      const lines = [];
      for (const [catName, catData] of Object.entries(result.categories)) {
        lines.push(`[${catName}] (${catData.engine})`);
        for (const q of catData.queries) {
          lines.push(`  ${q.query}`);
        }
      }
      detail.innerHTML = `<pre>${escapeHtml(lines.join("\n"))}</pre>`;
    } else if (name === "vuln_static_scan" && result.findings) {
      const b = result.severityBreakdown || {};
      setToolStat(cardEl, `${result.totalFindings} findings (${b.CRITICAL || 0} crit, ${b.HIGH || 0} high, ${result.scannedFiles} files)`);
      if (result.totalFindings === 0) {
        detail.innerHTML = `<pre>✅ No static vulnerabilities detected across ${result.scannedFiles} files.</pre>`;
      } else {
        const lines = result.findings.map((f) => `[${f.severity}] ${f.name} (${f.cwe})\n  ${f.file}:${f.line}\n  Snippet: ${f.snippet}\n  Fix: ${f.remediation}\n`).join("\n");
        detail.innerHTML = `<pre>${escapeHtml(lines)}${result.truncated ? "\n… (truncated)" : ""}</pre>`;
      }
    } else if (name === "browser_navigate" && result.url) {
      detail.innerHTML = `<pre>${escapeHtml(result.title ? `${result.title}\n${result.url}` : result.url)}</pre>`;
    } else if (name === "browser_read_page" && result.text) {
      const preview = result.text.length > 600 ? result.text.slice(0, 600) + "\n…" : result.text;
      detail.innerHTML = `<pre>${escapeHtml(preview)}</pre>`;
    } else if (name === "browser_screenshot" && result.imageDataUrl) {
      const img = document.createElement("img");
      img.src = result.imageDataUrl;
      img.className = "tool-screenshot";
      detail.appendChild(img);
    } else if (name.startsWith("mcp__canva__")) {
      renderCanvaResult(cardEl, detail, name, result);
    } else if (name === "mcp__nutaan__nutaan_list_agents") {
      renderNutaanAgents(cardEl, detail, result);
    } else if (name === "map_route" && result.ok && result.geometry) {
      renderMapRoute(cardEl, detail, result);
    } else if (name.startsWith("mcp__")) {
      // Any other MCP tool: show its text so the transcript isn't blank.
      const text = mcpResultText(result);
      if (text) detail.innerHTML = `<pre>${escapeHtml(text.slice(0, 4000))}</pre>`;
    }

    if (!detail.innerHTML.trim() && !detail.childElementCount) {
      const chev = cardEl.querySelector(".tool-chev");
      if (chev) chev.style.visibility = "hidden";
    }
  }

  // MCP results carry a text block and sometimes structured data; the text is what the server
  // wrote for a human, so it is the right thing to fall back to.
  function mcpResultText(result) {
    if (typeof result.result === "string") return result.result;
    if (result.result != null) return JSON.stringify(result.result, null, 2);
    if (result.data != null) return JSON.stringify(result.data, null, 2);
    return "";
  }

  // Leaflet is loaded on demand the first time a route needs a map — no reason to pay for it on
  // every launch. Both files come from the pinned cdnjs build the rest of the app already trusts.
  let leafletPromise = null;
  function ensureLeaflet() {
    if (window.L) return Promise.resolve(window.L);
    if (leafletPromise) return leafletPromise;
    // Bundled locally so it loads under the app's own strict CSP, with no network dependency for
    // the library itself — only the map tiles come from the network.
    leafletPromise = new Promise((resolve, reject) => {
      const css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "vendor/leaflet/leaflet.min.css";
      document.head.appendChild(css);
      const js = document.createElement("script");
      js.src = "vendor/leaflet/leaflet.min.js";
      js.onload = () => {
        // Leaflet resolves its marker images relative to the CSS by default; point it at the local
        // copies so the pins actually appear.
        try { window.L.Icon.Default.imagePath = "vendor/leaflet/images/"; } catch {}
        resolve(window.L);
      };
      js.onerror = () => reject(new Error("Could not load the map library."));
      document.head.appendChild(js);
    });
    return leafletPromise;
  }

  // A route result becomes a real map: the driving line, a numbered pin per stop, and a strip of
  // per-leg distances and times under it. This is the itinerary's backbone — the honest distances
  // the costs hang off — shown the way the user asked, not as a wall of text.
  function renderMapRoute(cardEl, detail, result) {
    setToolStat(cardEl, `${result.totalKm.toLocaleString()} km · ${result.totalHours} h`);
    const wrap = document.createElement("div");
    wrap.className = "map-route";
    const mapEl = document.createElement("div");
    mapEl.className = "map-canvas";
    wrap.appendChild(mapEl);

    const legsBar = document.createElement("div");
    legsBar.className = "map-legs";
    legsBar.innerHTML =
      `<div class="map-leg total"><b>${escapeHtml(result.stops[0].name)} → ${escapeHtml(result.stops[result.stops.length - 1].name)}</b><span>${result.totalKm.toLocaleString()} km · ${result.totalHours} h driving</span></div>` +
      (result.legs || []).map((l) => `<div class="map-leg"><b>${escapeHtml(l.from)} → ${escapeHtml(l.to)}</b><span>${l.km.toLocaleString()} km · ${l.hours} h</span></div>`).join("");
    wrap.appendChild(legsBar);
    detail.appendChild(wrap);
    expandCard(cardEl);

    ensureLeaflet().then((L) => {
      const latlngs = result.geometry.map(([lng, lat]) => [lat, lng]);
      const map = L.map(mapEl, { scrollWheelZoom: false, attributionControl: true });
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, attribution: "© OpenStreetMap" }).addTo(map);
      const line = L.polyline(latlngs, { color: "#a855f7", weight: 4, opacity: 0.9 }).addTo(map);
      result.stops.forEach((s, i) => {
        L.marker([s.lat, s.lon]).addTo(map).bindPopup(`<b>${i + 1}. ${s.name}</b>`);
      });
      map.fitBounds(line.getBounds(), { padding: [24, 24] });
      // The card starts collapsed sometimes; Leaflet needs a size recalc once it is visible.
      setTimeout(() => map.invalidateSize(), 200);
    }).catch((e) => {
      const note = document.createElement("div"); note.className = "note err"; note.textContent = e.message;
      wrap.insertBefore(note, legsBar);
    });
  }

  // nutaan_list_agents comes back as a bullet list of text, one agent per block. Parse it into a
  // grid of cards — name, what it does, its language/voice/phone, and a Use button that drops a
  // ready prompt into the composer — so picking an agent is a click, not copying an id out of text.
  function parseNutaanAgents(text) {
    const agents = [];
    for (const block of String(text).split(/\n(?=\s*[•*-]\s)/)) {
      const nameM = /[•*-]\s*(.+)/.exec(block);
      if (!nameM) continue;
      const id = (/id:\s*([A-Za-z0-9_-]+)/.exec(block) || [])[1] || null;
      if (!id) continue;
      const lang = (/language:\s*([A-Za-z-]+)/.exec(block) || [])[1] || null;
      const voice = (/voice:\s*([A-Za-z0-9-]+)/.exec(block) || [])[1] || null;
      const phone = (/(?:number|phone)(?:\s*\(if present\))?:\s*(\+?[\d][\d\s-]{6,})/i.exec(block) || [])[1] || null;
      agents.push({ raw: nameM[1].trim(), id, lang, voice, phone: phone ? phone.trim() : null });
    }
    return agents;
  }

  function renderNutaanAgents(cardEl, detail, result) {
    const text = mcpResultText(result);
    const agents = parseNutaanAgents(text);
    if (!agents.length) { detail.innerHTML = `<pre>${escapeHtml(text.slice(0, 4000))}</pre>`; return; }
    setToolStat(cardEl, `${agents.length} agent${agents.length === 1 ? "" : "s"}`);
    const grid = document.createElement("div");
    grid.className = "agent-grid";
    for (const a of agents) grid.appendChild(agentCardEl({ id: a.id, name: a.raw, lang: a.lang, voice: a.voice, phone: a.phone }));
    detail.appendChild(grid);
    expandCard(cardEl);
  }

  // Agents show up in the assistant's own text in a few shapes ("• Name — role / id: … / language:
  // …", "1) Name / • id: …", "id: … · hi · Name"). Anchor on the 24-hex agent id and gather the
  // name and language/voice/phone from the lines around it, so a card appears wherever the model
  // listed an agent — and, because it runs on the saved text at render time, in reloaded history too.
  function parseAgentsFromText(text) {
    const lines = String(text).split("\n");
    const agents = [];
    for (let i = 0; i < lines.length; i++) {
      const idM = /id:\s*([0-9a-fA-F]{24})/.exec(lines[i]) || /\b([0-9a-f]{24})\b/.exec(lines[i]);
      if (!idM) continue;
      const id = idM[1];
      if (agents.some((a) => a.id === id)) continue;
      let name = null;
      for (let j = i; j >= Math.max(0, i - 3); j--) {
        const l = lines[j].replace(/^[\s•*\-\d).]+/, "").trim();
        if (!l) continue;
        if (/^(id|language|voice|phone|engine|greeting|note|number)\b/i.test(l)) continue;
        name = l.replace(/\s*\(?id[:\s].*$/i, "").replace(/\s*[—–-]\s*$/, "").trim();
        if (name) break;
      }
      // "id: X · hi · Noida Property" — the name trails the id on the same line.
      if (!name) {
        const after = lines[i].split(/·|\|/).map((s) => s.trim()).filter(Boolean)
          .filter((s) => !/^id:/i.test(s) && !/^[a-z]{2}-[A-Z]{2}$/.test(s) && !/^[0-9a-f]{24}$/.test(s) && !/voice|engine|phone|number/i.test(s));
        if (after.length) name = after[after.length - 1].replace(/\s*\(.*$/, "").trim();
      }
      const win = [lines[i - 2], lines[i - 1], lines[i], lines[i + 1], lines[i + 2], lines[i + 3]].filter(Boolean).join(" ");
      const lang = (/\b([a-z]{2}-[A-Z]{2})\b/.exec(win) || [])[1] || null;
      const voice = (/voice:?\s*([A-Za-z0-9-]+)/i.exec(win) || [])[1] || null;
      const phoneM = /(?:phone|number):?\s*(\+?[\d][\d\s-]{6,}|none[\w\s]*)/i.exec(win);
      const phone = phoneM && !/none/i.test(phoneM[1]) ? phoneM[1].trim() : null;
      if (name) agents.push({ id, name, lang, voice, phone });
    }
    return agents;
  }

  function agentCardEl(a) {
    const dash = a.name.split(/\s+[—–-]\s+/);
    const title = dash[0].trim();
    const role = dash.slice(1).join(" — ").trim() || "Voice agent";
    const card = document.createElement("div"); card.className = "agent-card";
    const top = document.createElement("div"); top.className = "agent-top";
    const ic = document.createElement("div"); ic.className = "agent-ic"; ic.textContent = (title[0] || "A").toUpperCase();
    const meta = document.createElement("div"); meta.className = "agent-meta";
    const nm = document.createElement("div"); nm.className = "agent-name"; nm.textContent = title;
    const rl = document.createElement("div"); rl.className = "agent-role"; rl.textContent = role;
    meta.appendChild(nm); meta.appendChild(rl); top.appendChild(ic); top.appendChild(meta); card.appendChild(top);
    const chips = document.createElement("div"); chips.className = "agent-chips";
    const chip = (t) => { const c = document.createElement("span"); c.className = "agent-chip"; c.textContent = t; chips.appendChild(c); };
    if (a.lang) chip(a.lang);
    if (a.voice) chip("🔊 " + a.voice);
    chip(a.phone ? "📞 " + a.phone : "no number");
    card.appendChild(chips);
    const use = document.createElement("button"); use.type = "button"; use.className = "agent-use"; use.textContent = "Use Agent";
    use.addEventListener("click", () => {
      input.value = `Use the Nutaan agent "${title}" (id: ${a.id})${a.phone ? "" : " — note it has no caller number, so a call may need one assigned first"} to `;
      input.focus(); input.dispatchEvent(new Event("input"));
    });
    card.appendChild(use);
    return card;
  }

  // Append an agent-card grid to an assistant bubble when its text lists agents. Runs on both fresh
  // messages and reloaded ones, so cards are part of the saved history.
  function enrichAgentListing(el, rawText) {
    const agents = parseAgentsFromText(rawText);
    if (agents.length < 1) return;
    const grid = document.createElement("div"); grid.className = "agent-grid";
    agents.forEach((a) => grid.appendChild(agentCardEl(a)));
    el.appendChild(grid);
  }

  // A Canva tool that produced or exported a design gets a proper card — the Canva mark, what was
  // made, a thumbnail when the result carries an image, an Open button per design, and a Download
  // button for an export. A bare canva.com link in the transcript was the thing that looked broken.
  function renderCanvaResult(cardEl, detail, name, result) {
    const text = mcpResultText(result);
    const urls = [];
    const seen = new Set();
    // Design links (share and /design/ forms) and any export/download file links.
    const designRe = /https:\/\/www\.canva\.com\/(?:design\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?|d\/[A-Za-z0-9_-]+)(?:\/[a-z]+)?/g;
    const fileRe = /https:\/\/[^\s"')]+\.(?:pdf|png|jpg|jpeg|mp4|gif|pptx?)\b[^\s"')]*/gi;
    let m;
    while ((m = designRe.exec(text))) { if (!seen.has(m[0])) { seen.add(m[0]); urls.push({ kind: "open", url: m[0] }); } }
    while ((m = fileRe.exec(text))) { if (!seen.has(m[0])) { seen.add(m[0]); urls.push({ kind: "download", url: m[0] }); } }
    // Thumbnails/exports can also arrive in structured data.
    const dataStr = result.data ? JSON.stringify(result.data) : "";
    let thumb = null;
    const thumbM = /"(?:thumbnail|url|image|export_url)"\s*:\s*"(https:\/\/[^\"]+\.(?:png|jpg|jpeg|gif))"/i.exec(dataStr);
    if (thumbM) thumb = thumbM[1];

    const action = name.replace("mcp__canva__", "").replace(/-/g, " ");
    const wrap = document.createElement("div");
    wrap.className = "canva-result";

    const head = document.createElement("div");
    head.className = "canva-head";
    const logo = document.createElement("img"); logo.className = "canva-logo"; logo.src = "../assets/tools/canva.ico"; logo.alt = "Canva";
    const title = document.createElement("div"); title.className = "canva-title";
    const designCount = urls.filter((u) => u.kind === "open").length;
    title.innerHTML = `<strong>${escapeHtml(designCount > 1 ? `${designCount} Canva designs ready` : "Canva design ready")}</strong><span>${escapeHtml(action)}</span>`;
    head.appendChild(logo); head.appendChild(title);
    wrap.appendChild(head);

    if (thumb) {
      const img = document.createElement("img"); img.className = "canva-thumb"; img.src = thumb; img.loading = "lazy";
      img.addEventListener("error", () => img.remove());
      wrap.appendChild(img);
    }

    if (urls.length) {
      const actions = document.createElement("div"); actions.className = "canva-actions";
      for (const u of urls) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "canva-btn" + (u.kind === "download" ? " download" : "");
        b.textContent = u.kind === "download" ? "Download ↓" : "Open in Canva ↗";
        b.addEventListener("click", () => window.nutaan.openExternal(u.url));
        actions.appendChild(b);
      }
      wrap.appendChild(actions);
      setToolStat(cardEl, designCount > 1 ? `${designCount} designs` : "design ready");
    } else if (text) {
      // No link came back (e.g. an editing-transaction step) — keep the server's own words.
      const pre = document.createElement("pre"); pre.textContent = text.slice(0, 2000); wrap.appendChild(pre);
    }
    detail.appendChild(wrap);
    if (urls.length || thumb) expandCard(cardEl);
  }

  const RESTORE_VISIBLE_TOOLS = new Set([
    "list_dir", "read_file", "search_files", "list_skills", "use_skill",
    "browser_navigate", "browser_read_page", "browser_click", "browser_type",
    "browser_scroll", "browser_screenshot", "browser_resize",
    "osint_search_tools", "osint_dns_recon", "osint_ip_lookup", "osint_subdomain_enum",
    "osint_http_recon", "osint_dork_generator", "vuln_static_scan",
    "check_background_task", "list_background_tasks",
  ]);

  function messageText(content) {
    return Array.isArray(content)
      ? content.filter((p) => p.type === "text").map((p) => p.text).join("\n")
      : content || "";
  }

  // Rebuild the whole conversation — text AND the tool calls it made — from the saved messages, so
  // reopening a chat shows what the agent actually did (which files it read, searches it ran, pages
  // it opened), not a column of blank avatars. Without this the tool history was lost on reload.
  function renderThreadFromMessages(messages) {
    thread.innerHTML = "";
    thread.appendChild(emptyState);
    if (coworkerHero) thread.appendChild(coworkerHero);
    toolCards.clear();
    liveWriteCards.clear();
    toolArgsById.clear();
    resetFileGroup();
    const toolNameById = new Map();
    for (const m of messages || []) {
      if (m.role === "user") {
        const text = m.display || messageText(m.content);
        if (text && text.trim()) appendBubble("user", text);
      } else if (m.role === "assistant") {
        const text = messageText(m.content);
        if (text && text.trim()) appendBubble("assistant", text);
        for (const call of m.tool_calls || []) {
          const name = String(call.function?.name || "").split(/[<|]/)[0].trim();
          let args = {};
          try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
          toolNameById.set(call.id, name);
          toolArgsById.set(call.id, args);
          if (RESTORE_VISIBLE_TOOLS.has(name)) appendToolCard(call.id, name, args);
        }
      } else if (m.role === "tool") {
        const name = toolNameById.get(m.tool_call_id) || "";
        if (!toolCards.has(m.tool_call_id)) continue;
        let result = {};
        try { result = typeof m.content === "string" ? JSON.parse(m.content) : m.content; }
        catch { result = { text: String(m.content || "").slice(0, 4000) }; }
        try { resolveToolCard(m.tool_call_id, name, result); } catch {}
      }
    }
    renderEmptyVisibility();
    renderTasks(activeChat()?.tasks);
    scrollToBottom();
  }

  // ---------- Status ----------
  const cloudChip = el("cloudChip");
  const cloudLabel = el("cloudLabel");
  function setStatus(ok, text, title) {
    statusDot.className = "status-dot " + (ok === null ? "" : ok ? "online" : "offline");
    statusText.textContent = text;
    statusText.title = title || "";
    // The cloud chip reflects the real backend link — models run through nutaan.com, so this is
    // where the user sees whether that connection is live, not just a label.
    if (cloudChip) {
      cloudChip.classList.toggle("connected", ok === true);
      cloudChip.classList.toggle("offline", ok === false);
      if (cloudLabel) cloudLabel.textContent = ok === true ? "Nutaan Cloud" : ok === false ? "Nutaan Cloud · offline" : "Nutaan Cloud";
    }
  }
  cloudChip?.addEventListener("click", () => window.nutaan.openExternal("https://nutaan.com/dev-console"));

  // ---------- Models ----------
  async function refreshModels() {
    if (!settings.nutaanKey && !settings.baseUrl) {
      nutaanModels = [];
      await loadOmniRouteCatalog(true);
      rebuildModels();
      setStatus(_omniCatalogCache.length > 0, _omniCatalogCache.length ? "Providers connected" : "Connect a provider");
      return;
    }
    const res = await window.nutaan.listModels(settings.baseUrl, settings.apiKey, settings.nutaanKey);
    if (!res.ok) {
      const reason = String(res.error || "unknown error").slice(0, 200);
      setStatus(false, "Not connected", reason);
      appendBubble(
        "error",
        settings.baseUrl
          ? `Can't reach the model server: ${reason}\n\nSettings → Advanced has a custom Server URL set (${settings.baseUrl}) and nothing is answering there. Clear that field to go back to the built-in Nutaan backend.`
          : `Can't reach the model server: ${reason}\n\nThis is a network problem rather than a key problem — a work or school network may be blocking it. Try another connection to confirm.`
      );
      return;
    }
    setStatus(true, "Ready");
    availableModels = res.models;
    nutaanModels = res.models;

    // Keep the selected model to one that actually works without setup: a managed
    // model, the keyless nutaan gateway pool, or a provider the user connected. An
    // OmniRoute model from an unconnected provider (Kiro/Antigravity/Groq/…) is reset
    // to the managed backend so the user is never stuck on a hidden, failing model.
    const anyProviderConnected = (_omniProviders || []).some((p) => p.hasKey);
    const onUnconnectedGateway = settings.modelProviderId === "omniroute"
      && !/^nutaan\//i.test(settings.model || "") && !anyProviderConnected;
    const managedMissing = !settings.modelProviderId && !res.models.includes(settings.model);
    if (managedMissing || onUnconnectedGateway) {
      const fallback = res.defaultModel && res.models.includes(res.defaultModel) ? res.defaultModel : res.models[0];
      if (fallback) {
        settings.model = fallback;
        settings.modelProviderId = "";
        await window.nutaan.setSettings(settings);
      }
    }
    rebuildModels();
    // Probe which managed models actually respond, in the background, then hide the
    // dead ones from the picker. Cached, so it's cheap on subsequent opens.
    refreshModelHealth();
  }

  let _omniCatalogCache = [];
  let _omniCombosCache = {};
  let _omniProviders = [];
  let _omniModelsLoaded = false;

  function getProviderLogo(providerId) {
    const id = (providerId || "").toLowerCase();
    if (id.includes("anthropic") || id.includes("claude")) return "providers/anthropic.png";
    if (id.includes("deepseek")) return "providers/deepseek.png";
    if (id.includes("groq")) return "providers/groq.png";
    if (id.includes("cerebras")) return "providers/cerebras.svg";
    if (id.includes("samba")) return "providers/sambanova.svg";
    if (id.includes("gemini") || id.includes("google")) return "providers/google.png";
    if (id.includes("openrouter")) return "providers/openrouter.png";
    if (id.includes("agentrouter") || id.includes("agent-router")) return "providers/agentrouter.svg";
    if (id.includes("azure")) return "providers/azure.svg";
    if (id.includes("bedrock") || id.includes("aws")) return "providers/aws.svg";
    if (id.includes("antigravity")) return "providers/google.png";
    if (id.includes("kiro")) return "providers/anthropic.png";
    if (id.includes("mistral") || id.includes("codestral")) return "providers/mistral.png";
    if (id.includes("openai") || id.includes("gpt") || id.includes("o3") || id.includes("o1")) return "providers/openai.png";
    if (id.includes("together")) return "providers/together.png";
    if (id.includes("xai") || id.includes("grok")) return "providers/xai.png";
    if (id.includes("ollama") || id.includes("local")) return "providers/ollama.svg";
    if (id.includes("perplexity") || id.includes("sonar")) return "providers/perplexity.svg";
    return "providers/nutaan.png";
  }

  async function loadOmniRouteCatalog(force = false) {
    if ((!force && _omniModelsLoaded) || !window.nutaan || !window.nutaan.gateway) return;
    try {
      const res = await window.nutaan.gateway.getModels();
      if (res && res.models) {
        _omniCatalogCache = res.models;
        _omniCombosCache = res.combos || {};
        _omniProviders = res.providers || [];
        _omniModelsLoaded = true;
        rebuildModels();
      }
    } catch (e) {
      console.warn("OmniRoute catalog fetch:", e);
    }
  }

  // Health of managed models is probed live; a model that fails is hidden from the
  // picker so only working models are ever selectable.
  function modelHealthy(id) {
    const h = (settings.modelHealth || {})[id];
    return !h || h.ok !== false; // untested or passing → show; failed → hide
  }

  let _healthTesting = false;
  const MODEL_HEALTH_TTL = 30 * 60 * 1000;
  // Probe the managed models in the background so the picker shows only ones that
  // actually respond. Cached per model for 30 min so opening the app doesn't hammer
  // the backend every time.
  const HEALTH_PROBE_VERSION = 2; // bump when the probe logic changes, to re-test all
  async function refreshModelHealth() {
    if (_healthTesting) return;
    if (!settings.nutaanKey && !settings.baseUrl) return;
    if (!nutaanModels.length) return;
    const now = Date.now();
    // Old results from a different probe are unreliable — drop them and re-test.
    if (settings.modelHealthVersion !== HEALTH_PROBE_VERSION) {
      settings.modelHealth = {};
      settings.modelHealthVersion = HEALTH_PROBE_VERSION;
    }
    settings.modelHealth = settings.modelHealth || {};
    const toTest = nutaanModels
      .filter((id) => !/^azure\//i.test(id))
      .filter((id) => { const h = settings.modelHealth[id]; return !h || (now - (h.at || 0)) > MODEL_HEALTH_TTL; });
    if (!toTest.length) return;
    _healthTesting = true;
    try {
      // Force the managed backend (omit modelProviderId) — this pool lives on nutaan.com.
      const res = await window.nutaan.testModels({
        models: toTest,
        baseUrl: settings.baseUrl,
        apiKey: settings.apiKey,
        nutaanKey: settings.nutaanKey,
      });
      if (res && res.ok && Array.isArray(res.results)) {
        for (const r of res.results) settings.modelHealth[r.model] = { ok: !!r.ok, at: Date.now() };
        await window.nutaan.setSettings(settings);
        rebuildModels();
        // If the model in use just failed, jump to a healthy one so the next send works.
        if (!settings.modelProviderId && settings.modelHealth[settings.model] && settings.modelHealth[settings.model].ok === false) {
          const good = nutaanModels.find((id) => !/^azure\//i.test(id) && modelHealthy(id));
          if (good) { settings.model = good; await window.nutaan.setSettings(settings); updateModelBadge(); }
        }
      }
    } catch (e) {
      console.warn("model health probe:", e);
    } finally {
      _healthTesting = false;
    }
  }

  // Combine the Nutaan catalog with OmniRoute models and user-managed provider models
  function rebuildModels() {
    aggregatedModels = [];
    // Managed free pool. Hide paid azure ids and any model that failed the live health
    // test, so the dropdown only ever offers models that actually respond.
    for (const id of nutaanModels) {
      if (/^azure\//i.test(id)) continue;
      if (!modelHealthy(id)) continue;
      aggregatedModels.push({ id, providerId: "", providerName: "Nutaan", providerType: "nutaan" });
    }
    for (const p of settings.customProviders || []) {
      for (const id of p.models || []) aggregatedModels.push({ id, providerId: p.id, providerName: p.name, providerType: p.type });
    }
    // Gateway catalog: surface the keyless nutaan managed pool (works 24/7) plus any
    // provider the user has actually connected with their own key. Providers that need
    // credentials we don't have (Antigravity/Kiro/Groq/…) are not shown until connected,
    // so the picker only ever offers models that actually respond.
    const showProviders = new Set(["nutaan"]);
    for (const p of (_omniProviders || [])) if (p.hasKey) showProviders.add(p.id);
    if (_omniCatalogCache && _omniCatalogCache.length) {
      for (const m of _omniCatalogCache) {
        if (!showProviders.has(m.provider)) continue;
        if (!aggregatedModels.some((existing) => existing.id === m.id)) {
          aggregatedModels.push({
            id: m.id,
            name: m.name,
            providerId: "omniroute",
            providerName: (m.provider || "OmniRoute").toUpperCase(),
            providerType: m.provider,
            tier: m.tier,
            category: m.category,
            context_window: m.contextWindow ? (m.contextWindow >= 1000000 ? (m.contextWindow / 1000000) + "M" : Math.round(m.contextWindow / 1000) + "k") : "",
            speed: m.speed,
            description: m.description,
            capabilities: m.capabilities
          });
        }
      }
    }
    if (!modelSelectSettings) return;
    modelSelectSettings.innerHTML = "";
    const groups = new Map();
    for (const m of aggregatedModels) {
      if (!groups.has(m.providerName)) groups.set(m.providerName, []);
      groups.get(m.providerName).push(m);
    }
    for (const [gname, items] of groups) {
      const og = document.createElement("optgroup");
      og.label = gname;
      for (const m of items) {
        const opt = document.createElement("option");
        opt.value = m.providerId + "::" + m.id;
        opt.textContent = m.id;
        og.appendChild(opt);
      }
      modelSelectSettings.appendChild(og);
    }
    modelSelectSettings.value = (settings.modelProviderId || "") + "::" + settings.model;
    updateModelBadge();
  }

  function updateModelBadge() {
    modelBadgeLabel.textContent = settings.model ? basename(settings.model) : "No model";
    modelBadge.title = settings.model || "No model set";
    const logo = el("modelBadgeLogo");
    if (logo) {
      logo.src = getProviderLogo(settings.model);
      logo.onerror = () => { logo.onerror = null; logo.src = "providers/nutaan.png"; };
    }
  }

  async function selectModel(id, providerId = "") {
    settings.model = id;
    settings.modelProviderId = providerId || "";
    updateModelBadge();
    modelMenu.hidden = true;
    await window.nutaan.setSettings(settings);
    if (settingsOverlay && !settingsOverlay.hidden) renderProviders();
    if (modelSelectSettings) modelSelectSettings.value = (settings.modelProviderId || "") + "::" + settings.model;
  }

  modelBadge.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = modelMenu.hidden;
    closeAllMenus(modelMenu);
    if (willOpen) {
      modelMenu.innerHTML = "";
      if (!aggregatedModels.length) {
        modelMenu.innerHTML = `<div class="menu-empty">No models loaded yet.</div>`;
      } else {
        let lastGroup = null;
        for (const m of aggregatedModels) {
          if (m.providerName !== lastGroup) {
            lastGroup = m.providerName;
            const h = document.createElement("div");
            h.className = "menu-group";
            h.textContent = m.providerName;
            modelMenu.appendChild(h);
          }
          const active = m.id === settings.model && (m.providerId || "") === (settings.modelProviderId || "");
          const item = document.createElement("div");
          item.className = "menu-item mono model-item" + (active ? " active" : "");
          const mlogo = document.createElement("img");
          mlogo.className = "model-item-logo";
          mlogo.src = getProviderLogo(m.providerType || m.id);
          mlogo.alt = "";
          mlogo.onerror = () => { mlogo.onerror = null; mlogo.src = "providers/nutaan.png"; };
          const mname = document.createElement("div");
          mname.className = "name";
          mname.title = m.id;
          mname.textContent = m.id;
          item.appendChild(mlogo);
          item.appendChild(mname);
          item.addEventListener("click", () => selectModel(m.id, m.providerId));
          modelMenu.appendChild(item);
        }
        if (!_omniModelsLoaded) {
          const loading = document.createElement("div");
          loading.className = "menu-loading";
          loading.innerHTML = `<span class="menu-spinner"></span><span>More models loading…</span>`;
          modelMenu.appendChild(loading);
        }
      }
    }
    modelMenu.hidden = !willOpen;
  });

  // ---------- Quick actions ----------
  const QUICK_ACTIONS = [
    {
      title: "Build a feature",
      desc: "Describe what you want and let the agent write it.",
      prompt: "Build a new feature in this project: ",
      color: "rgba(168,85,247,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="#c084fc"><path d="M12 3l1.7 5.1L19 10l-5.3 1.9L12 17l-1.7-5.1L5 10l5.3-1.9z"/></svg>',
    },
    {
      title: "Fix a bug",
      desc: "Point at the broken behaviour and get a diagnosis.",
      prompt: "There's a bug in this project: ",
      color: "rgba(248,113,113,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="13" r="5"/><path d="M12 8V5M7 10L4.5 8M17 10l2.5-2M7 16l-2.5 2M17 16l2.5 2"/></svg>',
    },
    {
      title: "Explain this codebase",
      desc: "Get a tour of how the project fits together.",
      prompt: "Give me a tour of this codebase — what the main pieces are and how they fit together.",
      color: "rgba(96,165,250,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 5.5v15"/></svg>',
    },
    {
      title: "Write tests",
      desc: "Cover the code that doesn't have tests yet.",
      prompt: "Write tests for ",
      color: "rgba(74,222,128,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>',
    },
  ];

  // Co-worker mode starts from outcomes, not code tasks. Each one is real work the app can do
  // end to end: the Design canvas, documents, decks, research, files on this computer.
  const OFFICE_ACTIONS = [
    { title: "Design a website", desc: "A clickable multi-page prototype, in the Design canvas.", prompt: "Design a website for ", color: "rgba(168,85,247,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#c084fc" stroke-width="2" stroke-linecap="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/></svg>' },
    { title: "Write a document", desc: "A proposal, report or memo, typeset and exportable.", prompt: "Write a document: ", color: "rgba(96,165,250,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#60a5fa" stroke-width="2" stroke-linecap="round"><path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4M9 12h6M9 16h6"/></svg>' },
    { title: "Make a deck", desc: "Slides that carry an argument, one idea per slide.", prompt: "Make a slide deck about ", color: "rgba(244,114,182,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#f472b6" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="12" rx="2"/><path d="M12 17v4M8 21h8"/></svg>' },
    { title: "Research something", desc: "Reads the web, checks sources, reports back.", prompt: "Research and summarise: ", color: "rgba(52,211,153,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#34d399" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.2-3.2"/></svg>' },
    { title: "Sort out my files", desc: "Find, organise or summarise documents on this computer.", prompt: "On this computer, ", color: "rgba(251,191,36,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="2" stroke-linecap="round"><path d="M3 7a2 2 0 0 1 2-2h3.6l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>' },
    { title: "Draft an email", desc: "Says what you mean, in your tone, ready to send.", prompt: "Draft an email to ", color: "rgba(251,146,60,0.14)",
      icon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#fb923c" stroke-width="2" stroke-linecap="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/></svg>' },
  ];

  function renderQuickActions() {
    quickGrid.innerHTML = "";
    for (const qa of (settings.uiMode === "office" ? OFFICE_ACTIONS : QUICK_ACTIONS)) {
      const card = document.createElement("div");
      card.className = "quick-card";
      card.innerHTML =
        `<span class="quick-icon" style="background:${qa.color}">${qa.icon}</span>` +
        `<span class="title">${escapeHtml(qa.title)}</span>` +
        `<span class="desc">${escapeHtml(qa.desc)}</span>` +
        `<span class="arrow"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 12h13M13 6.5l5.5 5.5L13 17.5"/></svg></span>`;
      card.addEventListener("click", () => {
        input.value = qa.prompt;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        autoGrowInput();
      });
      quickGrid.appendChild(card);
    }
  }

  // ---------- Slash commands ----------
  const SLASH_COMMANDS = [
    { name: "/review", desc: "Review the current changes", prompt: "Use the code-review skill on the current changes." },
    { name: "/debug", desc: "Track down a bug methodically", prompt: "Use the debugging skill to help me with: " },
    { name: "/test", desc: "Write tests for some code", prompt: "Use the write-tests skill for: " },
    { name: "/refactor", desc: "Clean up without changing behaviour", prompt: "Use the refactor skill on: " },
    { name: "/security", desc: "Security review of the code", prompt: "Use the security-review skill on this project." },
    { name: "/perf", desc: "Look for performance problems", prompt: "Use the performance-review skill on this project." },
    { name: "/docs", desc: "Write or update documentation", prompt: "Use the documentation skill for: " },
    { name: "/commit", desc: "Draft a commit message", prompt: "Use the commit-message skill for the current staged changes." },
    { name: "/deps", desc: "Upgrade dependencies safely", prompt: "Use the dependency-upgrade skill on this project." },
  ];

  slashBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = slashMenu.hidden;
    closeAllMenus(slashMenu);
    if (willOpen) {
      slashMenu.innerHTML = "";
      for (const cmd of SLASH_COMMANDS) {
        const item = document.createElement("div");
        item.className = "menu-item";
        item.innerHTML = `<div class="name" style="font-family:var(--mono)">${escapeHtml(cmd.name)}</div><div class="desc">${escapeHtml(cmd.desc)}</div>`;
        item.addEventListener("click", () => {
          input.value = cmd.prompt;
          slashMenu.hidden = true;
          input.focus();
          input.setSelectionRange(input.value.length, input.value.length);
          autoGrowInput();
        });
        slashMenu.appendChild(item);
      }
    }
    slashMenu.hidden = !willOpen;
  });

  // ---------- Add Context ----------
  const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out", "vendor", "__pycache__", ".venv"]);

  async function collectFiles(relDir, depth, acc) {
    if (acc.length >= 600 || depth > 6) return;
    let entries;
    try {
      entries = await window.nutaan.listDir(activePath, relDir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (acc.length >= 600) return;
      const p = relDir === "." ? e.name : relDir + "/" + e.name;
      if (e.isDir) {
        if (SKIP_DIRS.has(e.name) || e.name.startsWith(".")) continue;
        await collectFiles(p, depth + 1, acc);
      } else {
        acc.push(p);
      }
    }
  }

  async function ensureContextFiles() {
    if (contextFiles && contextFilesForPath === activePath) return contextFiles;
    const acc = [];
    await collectFiles(".", 0, acc);
    contextFiles = acc;
    contextFilesForPath = activePath;
    return acc;
  }

  function insertMention(path) {
    const mention = "@" + path + " ";
    const start = input.selectionStart ?? input.value.length;
    input.value = input.value.slice(0, start) + mention + input.value.slice(start);
    input.focus();
    input.setSelectionRange(start + mention.length, start + mention.length);
    autoGrowInput();
  }

  let contextTab = "files";

  async function openContextMenu() {
    contextMenu.innerHTML = "";
    contextMenu.hidden = false;

    const tabs = document.createElement("div");
    tabs.className = "ctx-tabs";
    for (const [id, label] of [["files", "Project files"], ["kb", "Knowledge"]]) {
      const b = document.createElement("button");
      b.className = "ctx-tab" + (contextTab === id ? " active" : "");
      b.textContent = label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        contextTab = id;
        openContextMenu();
      });
      tabs.appendChild(b);
    }
    contextMenu.appendChild(tabs);

    const pane = document.createElement("div");
    contextMenu.appendChild(pane);
    if (contextTab === "kb") {
      await paintKbPane(pane);
      return;
    }
    await paintFilesPane(pane);
  }

  async function paintKbPane(pane) {
    pane.innerHTML = `<div class="menu-empty">Loading…</div>`;
    const entries = await window.nutaan.kbList();
    pane.innerHTML = "";

    const add = document.createElement("button");
    add.className = "menu-action";
    add.innerHTML =
      `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>` +
      `<span>Add a knowledge base…</span>`;
    add.addEventListener("click", (e) => {
      e.stopPropagation();
      contextMenu.hidden = true;
      openKbDialog();
    });
    pane.appendChild(add);

    if (!entries.length) {
      pane.insertAdjacentHTML("beforeend", `<div class="menu-empty">Nothing indexed yet. Add a docs page or paste notes, and the agent can recall it by meaning.</div>`);
      return;
    }

    pane.insertAdjacentHTML("beforeend", `<div class="menu-divider"></div>`);
    const chat = activeChat();
    const attached = chat?.kbIds || [];
    for (const entry of entries) {
      const on = attached.includes(entry.id);
      const row = document.createElement("div");
      row.className = "kb-row" + (on ? " on" : "");
      row.innerHTML =
        `<span class="kb-check">${on ? "✓" : ""}</span>` +
        `<span class="kb-meta"><span class="kb-title">${escapeHtml(entry.title)}</span>` +
        `<span class="kb-sub">${escapeHtml(entry.source)} · ${entry.chunks} passages</span></span>` +
        `<button class="kb-del" title="Delete">✕</button>`;
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("kb-del")) return;
        toggleKb(entry.id);
        paintKbPane(pane);
      });
      row.querySelector(".kb-del").addEventListener("click", async (e) => {
        e.stopPropagation();
        if (!confirm(`Delete "${entry.title}" from the knowledge base?`)) return;
        await window.nutaan.kbRemove(entry.id);
        paintKbPane(pane);
      });
      pane.appendChild(row);
    }
  }

  function toggleKb(id) {
    const chat = activeChat();
    if (!chat) return;
    if (!Array.isArray(chat.kbIds)) chat.kbIds = [];
    const i = chat.kbIds.indexOf(id);
    if (i === -1) chat.kbIds.push(id);
    else chat.kbIds.splice(i, 1);
    persistProjects();
  }

  async function paintFilesPane(pane) {
    if (!activePath) {
      pane.innerHTML = `<div class="menu-empty">Open a project to reference its files.</div>`;
      return;
    }
    pane.innerHTML = `<div class="menu-empty">Loading files…</div>`;
    const files = await ensureContextFiles();
    pane.innerHTML = "";
    const search = document.createElement("input");
    search.type = "text";
    search.placeholder = "Filter files…";
    search.style.cssText =
      "width:100%;background:var(--bg-code);border:1px solid var(--border-input);border-radius:8px;color:var(--text);padding:7px 10px;font-size:12px;outline:none;margin-bottom:6px;";
    pane.appendChild(search);
    const list = document.createElement("div");
    pane.appendChild(list);

    const paint = (filter) => {
      const q = filter.toLowerCase();
      const matches = (q ? files.filter((f) => f.toLowerCase().includes(q)) : files).slice(0, 60);
      list.innerHTML = "";
      if (!matches.length) {
        list.innerHTML = `<div class="menu-empty">No files match.</div>`;
        return;
      }
      for (const f of matches) {
        const item = document.createElement("div");
        item.className = "menu-item";
        item.innerHTML = `<div class="name" style="font-family:var(--mono);font-size:11.5px" title="${escapeHtml(f)}">${escapeHtml(f)}</div>`;
        item.addEventListener("click", () => {
          insertMention(f);
          contextMenu.hidden = true;
        });
        list.appendChild(item);
      }
    };
    paint("");
    search.addEventListener("input", () => paint(search.value));
    search.addEventListener("keydown", (e) => e.stopPropagation());
    setTimeout(() => search.focus(), 20);
  }

  // ---------- Knowledge base dialog ----------
  const kbOverlay = el("kbOverlay");
  const kbTabUrl = el("kbTabUrl");
  const kbTabText = el("kbTabText");
  const kbUrlField = el("kbUrlField");
  const kbTextField = el("kbTextField");
  const kbUrlInput = el("kbUrlInput");
  const kbTextInput = el("kbTextInput");
  const kbTitleInput = el("kbTitleInput");
  const kbProgress = el("kbProgress");
  const kbProgressText = el("kbProgressText");
  const kbProgressFill = el("kbProgressFill");
  const kbSubmit = el("kbSubmit");
  const kbCancel = el("kbCancel");
  let kbMode = "url";

  function setKbMode(mode) {
    kbMode = mode;
    kbTabUrl.classList.toggle("active", mode === "url");
    kbTabText.classList.toggle("active", mode === "text");
    kbUrlField.hidden = mode !== "url";
    kbTextField.hidden = mode !== "text";
  }
  kbTabUrl.addEventListener("click", () => setKbMode("url"));
  kbTabText.addEventListener("click", () => setKbMode("text"));

  function openKbDialog() {
    kbUrlInput.value = "";
    kbTextInput.value = "";
    kbTitleInput.value = "";
    kbProgress.hidden = true;
    kbProgressFill.style.width = "0%";
    kbSubmit.disabled = false;
    kbSubmit.textContent = "Index it";
    setKbMode("url");
    kbOverlay.hidden = false;
    setTimeout(() => kbUrlInput.focus(), 30);
  }

  kbCancel.addEventListener("click", () => { kbOverlay.hidden = true; });
  kbOverlay.addEventListener("click", (e) => {
    if (e.target === kbOverlay && !kbSubmit.disabled) kbOverlay.hidden = true;
  });

  // Indexing streams its stages back so a long page doesn't look like a frozen dialog.
  window.nutaan.onKbProgress(({ stage, url, done, total, error }) => {
    kbProgress.hidden = false;
    if (stage === "fetching") {
      kbProgressText.textContent = `Fetching ${url}…`;
      kbProgressFill.style.width = "8%";
    } else if (stage === "chunking") {
      kbProgressText.textContent = "Splitting into passages…";
      kbProgressFill.style.width = "16%";
    } else if (stage === "embedding") {
      kbProgressText.textContent = `Embedding ${done} of ${total} passages…`;
      kbProgressFill.style.width = `${16 + Math.round((done / total) * 84)}%`;
    } else if (stage === "done") {
      kbProgressText.textContent = "Indexed.";
      kbProgressFill.style.width = "100%";
    } else if (stage === "error") {
      kbProgressText.textContent = error;
      kbProgressFill.style.width = "0%";
    }
  });

  kbSubmit.addEventListener("click", async () => {
    const url = kbMode === "url" ? kbUrlInput.value.trim() : "";
    const text = kbMode === "text" ? kbTextInput.value.trim() : "";
    if (!url && !text) return;
    kbSubmit.disabled = true;
    kbSubmit.textContent = "Indexing…";
    kbProgress.hidden = false;
    const res = await window.nutaan.kbAdd({
      url,
      text,
      title: kbTitleInput.value.trim(),
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      nutaanKey: settings.nutaanKey,
    });
    kbSubmit.disabled = false;
    kbSubmit.textContent = "Index it";
    if (!res.ok) return;
    // Newly indexed material is attached to the current chat straight away — indexing it and
    // then having to go turn it on would be a pointless second step.
    const chat = activeChat();
    if (chat) {
      if (!Array.isArray(chat.kbIds)) chat.kbIds = [];
      chat.kbIds.push(res.id);
      persistProjects();
    }
    kbOverlay.hidden = true;
    appendBubble("assistant", `Indexed **${res.title}** — ${res.chunks} passages. It's attached to this chat, and I can search it any time with \`kb_search\`.`);
  });

  contextBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const willOpen = contextMenu.hidden;
    closeAllMenus(contextMenu);
    if (willOpen) openContextMenu();
    else contextMenu.hidden = true;
  });
  contextMenu.addEventListener("click", (e) => e.stopPropagation());

  // ---------- Attachments ----------
  // Distinct from Add Context: that references a file already in the project by path, this
  // pulls a file in from anywhere on disk and puts its actual content into the message.
  let attachments = [];
  // Caps silent model auto-switch+retry per user turn so it cascades through a
  // few models but never loops forever.
  let _autoSwitchCount = 0;
  let _lastTurnHadImage = false;
  const MAX_AUTO_SWITCH = 3;
  // A model that fails is put on a TEMPORARY cooldown (auto-watch), not disabled
  // forever — many failures are transient (a provider briefly down, rate limited).
  // After the cooldown it's automatically eligible again ("freed").
  const MODEL_COOLDOWN_MS = 5 * 60 * 1000;
  function modelOnCooldown(id) {
    const until = (settings.modelCooldowns || {})[id];
    return !!until && Date.now() < until;
  }
  // Skip a model only if the user disabled it OR it's on a live cooldown.
  function modelUsable(id) {
    return !!id && !(settings.disabledModels || []).includes(id) && !modelOnCooldown(id);
  }
  function putModelOnCooldown(id) {
    if (!id) return;
    settings.modelCooldowns = settings.modelCooldowns || {};
    settings.modelCooldowns[id] = Date.now() + MODEL_COOLDOWN_MS;
    // Drop any cooldowns that have already lapsed so the map stays small and
    // recovered models are freed automatically.
    const now = Date.now();
    for (const [k, v] of Object.entries(settings.modelCooldowns)) {
      if (!v || now >= v) delete settings.modelCooldowns[k];
    }
  }

  function renderAttachments() {
    attachRow.innerHTML = "";
    attachments.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "attach-chip" + (a.kind === "image" && a.dataUrl ? " attach-image" : "");
      const thumb = (a.kind === "image" && a.dataUrl) ? `<img class="attach-thumb" src="${a.dataUrl}" alt="" />` : "";
      chip.innerHTML = `${thumb}<span>${escapeHtml(a.name)}</span><button title="Remove">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        attachments.splice(i, 1);
        renderAttachments();
      });
      attachRow.appendChild(chip);
    });
  }

  // One + for everything that goes into a message. Attach opens the file picker straight away;
  // context and commands open their own menus in the same spot.
  el("plusBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const menu = el("plusMenu");
    const willOpen = menu.hidden;
    closeAllMenus(menu);
    menu.hidden = !willOpen;
  });
  el("plusMenu").addEventListener("click", (e) => {
    e.stopPropagation();
    const item = e.target.closest("[data-act]");
    if (!item) return;
    el("plusMenu").hidden = true;
    if (item.dataset.act === "attach") attachBtn.click();
    if (item.dataset.act === "context") contextBtn.click();
    if (item.dataset.act === "slash") slashBtn.click();
    if (item.dataset.act === "kb") { contextTab = "kb"; contextBtn.click(); }
  });

  attachBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    closeAllMenus();
    const filePath = await window.nutaan.pickFile();
    if (!filePath) return;
    attachBtn.disabled = true;
    const res = await window.nutaan.prepareAttachment({
      filePath,
      model: settings.model,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      nutaanKey: settings.nutaanKey,
    });
    attachBtn.disabled = false;
    if (!res.ok) {
      appendBubble("error", res.error);
      return;
    }
    attachments.push(res);
    renderAttachments();
    updateSendState();
  });

  // Heuristic: does the selected model accept images? Text-only models must not be
  // sent an image (they answer with a server error), so we gate on this instead.
  function looksMultimodal(id) {
    return /gemini|gpt-4o|gpt-4\.1|gpt-4o|gpt-5|o3|o4|claude-3|claude-opus|claude-sonnet|claude-haiku|vision|multimodal|llava|pixtral|qwen.*vl|internvl|kimi|nova-(pro|lite)|-vl\b|\bvl-/i.test(String(id || ""));
  }
  function warnIfTextOnlyForImages() {
    if (!attachments.some((a) => a.kind === "image")) return;
    if (looksMultimodal(settings.model)) return;
    appendNoticeCard(`"${settings.model}" is a text-only model and can't read images. Pick a multimodal model (e.g. a Gemini or GPT-4o model) from the model menu below, then send.`);
  }

  // Paste an image straight into the composer — a multimodal model reads it immediately.
  async function handlePastedImages(e) {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const imageItems = [...items].filter((it) => it.type && it.type.startsWith("image/"));
    if (!imageItems.length) return;
    e.preventDefault();
    for (const it of imageItems) {
      const blob = it.getAsFile();
      if (!blob) continue;
      const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = reject;
        r.readAsDataURL(blob);
      }).catch(() => null);
      if (!dataUrl) continue;
      const ext = ((blob.type.split("/")[1] || "png").split("+")[0]);
      attachments.push({ kind: "image", name: `pasted-image-${Date.now().toString(36)}.${ext}`, dataUrl });
    }
    renderAttachments();
    updateSendState();
    warnIfTextOnlyForImages();
  }
  input.addEventListener("paste", handlePastedImages);

  // ---------- Project / chat management ----------
  function systemPrompt(root) {
    return [
      "You are Nutaan Code, a careful personal coding assistant running as a desktop app on the user's own machine.",
      ...(settings.roleLabel
        ? [`The person you are working with does ${settings.roleLabel} for a living${settings.uiMode === "office" ? " and is not here to read code: explain outcomes in their terms, do the technical work yourself, and show them results (a page, a document, a design, a file) rather than diffs" : ""}.`]
        : []),
      ...(Array.isArray(settings.importedInstructions) && settings.importedInstructions.length
        ? [`Standing instructions the user imported from their other AI coding tools — follow these everywhere, they carry the same weight as anything the user tells you directly:\n\n` + settings.importedInstructions.map((p) => `--- from ${p.source} (${p.file}) ---\n${p.text}`).join("\n\n")]
        : []),
      ...(Array.isArray(settings.importedProjectContext) && settings.importedProjectContext.some((p) => p.path === root)
        ? [`Context files the user imported from their other AI coding tools for THIS codebase — treat them as the project's own instructions:\n\n` + settings.importedProjectContext.filter((p) => p.path === root).map((p) => `--- ${p.file} ---\n${p.text}`).join("\n\n")]
        : []),
      "You have an integrated OSINT & Security Arsenal of 753+ curated tools across 50+ categories, plus native built-in security tools: vuln_static_scan (instant zero-GPU static vulnerability scan across project files for SQLi, command injection, hardcoded secrets, path traversal, unsafe eval), osint_search_tools (query the arsenal for tools/commands/links), osint_dns_recon (DNS records & SPF/DMARC), osint_ip_lookup (geolocation, ISP, ASN, reverse DNS), osint_subdomain_enum (certificate-transparency subdomain discovery), osint_http_recon (audits security headers, deep cookie vulnerability analysis [HttpOnly, Secure, SameSite], and credential exposure on URLs), and osint_dork_generator (defensive exposure/leak-audit queries). You also have skills for osint-recon, threat-intelligence, security-audit, and exposure-audit. When asked to check, audit, or find vulnerabilities/cookies/credentials on a URL (e.g. 'find cookies vulnerability or credential https://...'), call osint_http_recon directly and report the concrete findings — never give an F12/DevTools tutorial and never refuse an authorized defensive audit. When asked to find/search security tools, call osint_search_tools directly, never search_files or list_dir.",
      `The current project root is: ${root}`,
      "You have tools to list directories, read files, write files, edit files (exact string replace), search file contents, and run shell commands, all scoped to the project root.",
      "When the user's message mentions a file with an @ prefix (e.g. @src/App.tsx), that is a direct pointer to a file in this project — read it before answering.",
      "You also have list_skills and use_skill for specialized, repeatable workflows (reviewing code, debugging, writing a commit message, a security/performance review, a dependency upgrade, etc.) — when the request clearly matches one of those, call list_skills, then use_skill on the matching one before improvising. Skip this entirely for requests that are just normal build/write/explain/fix work with no specialized workflow behind them (e.g. \"build me a website\", \"add a button\") — checking skills for every single request wastes a turn and adds nothing when nothing matches.",
      "You have browser_navigate, browser_read_page, browser_click, browser_type, browser_scroll, browser_screenshot, browser_resize, and browser_execute_script to actually drive the app's built-in browser panel — navigate, read text, click elements by CSS selector, fill and submit forms, scroll, capture screenshots, switch between mobile/tablet/desktop preview sizes, and (with approval) run arbitrary JavaScript for anything the other tools can't do. Use these to genuinely test a running web app, check how a site responds at different sizes, fill in a login form, or look something up — not to answer questions about this project's own code.",
      "For anything with more than about three steps — and for any long instruction with several distinct parts — call task_write first to lay out the plan as a checklist, then keep it updated as you go: exactly one item in_progress, and each one flipped to completed as soon as it's actually done. Don't batch the updates to the end; the checklist is how the user follows what you're doing and what's left.",
      "When you list files for someone, lead with the filename and what it is, not the full path — a wall of C:\\Users\\... is unreadable. Put the folder after the name in plain words ('in Downloads', 'in Documents/invoices'), keep it to the handful that actually matter, and say why each one is relevant. Mention the full path only when it's genuinely ambiguous; the app turns paths into links the user can click to open, so you never need to tell them where to go looking.",
      "You have persistent memory (memory_list, memory_read, memory_write) that survives across every chat and project, and a knowledge base (kb_add, kb_search) for bulk reference material. When the user tells you something durable about themselves, how they want you to work, or a decision behind this project, save it with memory_write rather than letting it evaporate at the end of the chat. When they point you at documentation worth keeping, kb_add it instead of re-fetching it every time.",
      "Check your own work instead of handing that back to the user. If you changed something visual, or the user asks how something looks, drive the browser panel yourself: browser_navigate to the page (start the dev server first if it isn't running) and browser_screenshot it, or view_image a file directly. Both work on every model — when you can't see images yourself, a vision model describes them for you. Never tell the user to open a file or a URL themselves just to check something you could have looked at.",
      "Prefer edit_file over write_file for existing files, and only change what's needed.",
      "Explain briefly what you're about to do, then do it. Whether a tool needs approval is handled by the app and stated to you each turn — never invent a permission step of your own, and never end a turn asking 'shall I go ahead?' when you could have gone ahead.",
      "Use web_search when you're unsure about a library, an error message, or a current version, then browser_navigate and read the best result properly rather than trusting the snippet.",
      "Only ask a clarifying question when you are genuinely blocked — a missing credential, a decision only they can make, or a destructive action with no safe default. An open-ended instruction is a mandate to investigate, not a reason to stop: look at the code, run it, open it in the browser, and report what you actually found.",
    ].join("\n");
  }

  async function persistProjects() {
    settings.projects = projects.map((p) => ({
      path: p.path,
      activeChatId: p.activeChatId,
      chats: p.chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages })),
    }));
    settings.activeProjectPath = activePath;
    await window.nutaan.setSettings(settings);
  }

  function newChat() {
    const proj = activeProject();
    if (!proj) return;
    const chat = makeChat(proj.path);
    proj.chats.unshift(chat);
    proj.activeChatId = chat.id;
    // A new chat is something you type into. Started from Design, Workers or the Studio it was
    // created behind that page and nothing visibly happened.
    sidebarView = "chats";
    renderNav();
    renderExplorer();
    renderEmptyVisibility();
    renderThreadFromMessages(chat.messages);
    threadChatId = chat.id;
    setRunning(false);
    input.focus();
    persistProjects();
  }

  function deleteChat(path, chatId) {
    if (running) return;
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    const chat = proj.chats.find((c) => c.id === chatId);
    if (chat && !confirm(`Delete "${chat.title}"? This can't be undone.`)) return;
    proj.chats = proj.chats.filter((c) => c.id !== chatId);
    if (proj.chats.length === 0) proj.chats.push(makeChat(proj.path));
    if (proj.activeChatId === chatId) proj.activeChatId = proj.chats[0].id;
    renderNav();
    renderExplorer();
    if (path === activePath) renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  async function selectChat(path, chatId) {
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    const pathChanged = path !== activePath;
    activePath = path;
    proj.activeChatId = chatId;
    if (pathChanged) await onProjectChanged();
    const chat = activeChat();
    if (chat) chat.unread = false;
    renderNav();
    renderExplorer();
    renderThreadFromMessages(chat.messages);
    threadChatId = chat.id;
    // Landing in a chat that is still working: the transcript so far, then the live indicator.
    // Its new events stream in from here; the full history lands when it finishes.
    setRunning(runs.has(chat.id));
    if (runs.has(chat.id)) showThinking(runs.get(chat.id).activity || "Working");
    persistProjects();
  }

  async function onProjectChanged() {
    openFiles = [];
    activeFilePath = null;
    contextFiles = null;
    renderFileTabs();
    renderCodeView();
    await refreshTree();
    await refreshGit();
    // The autonomous layer: arm the workspace monitor, fire "on project open" workers, and work
    // out what today actually needs from the repo itself.
    if (activePath) {
      try { window.nutaan.projectOpened(activePath); } catch {}
      loadToday();
      if (sidebarView === "health") loadHealth();
    }
  }

  async function switchProject(path) {
    if (running || path === activePath) return;
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    activePath = path;
    await onProjectChanged();
    renderNav();
    renderExplorer();
    renderRecent();
    renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  function removeProject(path) {
    if (running) return;
    if (!confirm(`Remove "${basename(path)}" from the list? Its chat history goes with it. This can't be undone.`)) return;
    projects = projects.filter((p) => p.path !== path);
    if (activePath === path) activePath = projects.length ? projects[0].path : null;
    onProjectChanged();
    renderNav();
    renderExplorer();
    renderRecent();
    if (activePath) {
      renderThreadFromMessages(activeChat().messages);
    } else {
      thread.innerHTML = "";
      thread.appendChild(emptyState);
    if (coworkerHero) thread.appendChild(coworkerHero);
      liveWriteCards.clear();
      resetFileGroup();
      renderEmptyVisibility();
    }
    persistProjects();
  }

  async function openProject(path) {
    let proj = projects.find((p) => p.path === path);
    if (!proj) {
      const chat = makeChat(path);
      proj = { path, activeChatId: chat.id, chats: [chat] };
      projects.unshift(proj);
    }
    activePath = path;
    await onProjectChanged();
    renderNav();
    renderExplorer();
    renderRecent();
    renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  // Working on the machine itself — organising Downloads, freeing up space, finding a document —
  // needs no project at all. Rather than making someone pick a folder before the app will talk to
  // them, the first message opens a workspace rooted at their home directory.
  let _paths = null;
  async function userPaths() {
    if (!_paths) {
      try { _paths = await window.nutaan.getPaths(); } catch { _paths = { home: "" }; }
    }
    return _paths;
  }

  async function ensureWorkspace() {
    const existing = activeProject();
    if (existing) return existing;
    const paths = await userPaths();
    if (!paths.home) return null;
    await openProject(paths.home);
    const proj = activeProject();
    if (proj) proj.personal = true;
    persistProjects();
    return proj;
  }

  function isPersonal(p) {
    return !!(p && (p.personal || (_paths && p.path === _paths.home)));
  }

  async function pickAndOpenProject() {
    if (running) return;
    const picked = await window.nutaan.pickFolder();
    if (!picked) return;
    await openProject(picked);
  }

  openProjectLink.addEventListener("click", pickAndOpenProject);
  newChatBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    newChat();
  });
  el("newChatMain").addEventListener("click", async () => {
    if (!activePath) await ensureWorkspace();
    if (activePath) newChat();
  });

  // ---------- Sending ----------
  // ---------- Task checklist ----------
  const taskPanel = el("taskPanel");
  const taskHead = el("taskHead");
  const taskList = el("taskList");
  const taskCount = el("taskCount");
  const taskChev = el("taskChev");

  taskHead.addEventListener("click", () => {
    taskList.hidden = !taskList.hidden;
    taskChev.textContent = taskList.hidden ? "▸" : "▾";
  });

  const codebaseCache = new Map();
  async function looksLikeCodebase(root) {
    if (codebaseCache.has(root)) return codebaseCache.get(root);
    let ok = false;
    try {
      const entries = await window.nutaan.listDir(root, ".");
      const names = new Set((entries || []).map((e) => (e.name || "").toLowerCase()));
      const markers = [".git", "package.json", "pyproject.toml", "requirements.txt", "cargo.toml", "go.mod", "pom.xml", "build.gradle", "gemfile", "composer.json", "pubspec.yaml", "makefile", "cmakelists.txt", "src"];
      ok = markers.some((m) => names.has(m));
      if (!ok && window.nutaan.gitStatus) { const g = await window.nutaan.gitStatus(root); ok = !!(g && (g.ok || g.branch) && !g.error); }
    } catch {}
    codebaseCache.set(root, ok);
    return ok;
  }

  const TASK_MARK = { completed: "✓", in_progress: "▸", pending: "○" };

  function renderTasks(tasks) {
    if (!tasks || !tasks.length) {
      taskPanel.hidden = true;
      return;
    }
    taskPanel.hidden = false;
    const done = tasks.filter((t) => t.status === "completed").length;
    taskCount.textContent = `${done}/${tasks.length}`;
    taskPanel.classList.toggle("done", done === tasks.length);
    taskList.innerHTML = "";
    for (const t of tasks) {
      const row = document.createElement("div");
      row.className = "task-item " + t.status;
      row.innerHTML = `<span class="task-mark">${TASK_MARK[t.status] || "○"}</span><span class="task-text">${escapeHtml(t.task)}</span>`;
      taskList.appendChild(row);
    }
  }

  onAgentEvent("agent:tasks-update", ({ tasks }) => {
    const chat = activeChat();
    // Kept on the chat so reopening it later still shows what was planned and what got done.
    if (chat) {
      chat.tasks = tasks;
      persistProjects();
    }
    renderTasks(tasks);
    const done = tasks.filter((t) => t.status === "completed").length;
    const current = tasks.find((t) => t.status === "in_progress");
    if (current) runActivity.textContent = current.task;
    showThinking(`${done}/${tasks.length} tasks done`);
  });

  // ---------- Run status bar ----------
  let runStart = 0;
  let runTokenTotal = 0;
  let runContextTokens = 0;
  let runTimer = null;

  function formatDuration(ms) {
    const total = Math.round(ms / 1000);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return m ? `${m}m ${s}s` : `${s}s`;
  }

  function formatTokens(n) {
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k tokens";
    return `${n} tokens`;
  }

  function paintRunStatus() {
    runElapsed.textContent = formatDuration(Date.now() - runStart);
    runTokens.textContent = formatTokens(runTokenTotal);
    runTokens.title = runContextTokens ? `${runContextTokens.toLocaleString()} tokens of context on the last request` : "";
  }

  function startRunStatus() {
    runStart = Date.now();
    runTokenTotal = 0;
    runContextTokens = 0;
    setRunTasks(0);
    runActivity.textContent = "Working…";
    runStatus.hidden = false;
    paintRunStatus();
    clearInterval(runTimer);
    runTimer = setInterval(paintRunStatus, 1000);
  }

  function stopRunStatus() {
    clearInterval(runTimer);
    runTimer = null;
    runStatus.hidden = true;
  }

  function setRunTasks(n) {
    const show = n > 1;
    runTasks.hidden = !show;
    runTasksSep.hidden = !show;
    if (show) runTasks.textContent = `${n} running tasks`;
  }

  onAgentEvent("agent:usage", ({ usage }) => {
    // Only generated tokens accumulate. Summing total_tokens counted prompt_tokens again on
    // every iteration of the loop — and the prompt is the whole conversation re-sent each time —
    // so a handful of tool calls read as "50.9k tokens" when barely anything had been written.
    runTokenTotal += usage?.completion_tokens || 0;
    runContextTokens = usage?.prompt_tokens || runContextTokens;
    // Lifetime totals for the Settings usage panel — count both prompt and completion tokens the
    // account actually spent, persisted so it survives restarts.
    settings.usageInTokens = (settings.usageInTokens || 0) + (usage?.prompt_tokens || 0);
    settings.usageOutTokens = (settings.usageOutTokens || 0) + (usage?.completion_tokens || 0);
    settings.usageRequests = (settings.usageRequests || 0) + 1;
    window.nutaan.setSettings(settings);
    if (!settingsOverlay.hidden) renderUsagePanel();
    paintRunStatus();
  });

  onAgentEvent("agent:tasks", ({ running, names }) => {
    setRunTasks(running);
    if (running > 1) {
      const labels = [...new Set((names || []).map((n) => TOOL_PENDING_LABEL[n] || n))];
      runActivity.textContent = labels.slice(0, 3).join(", ") + (labels.length > 3 ? "…" : "");
    }
  });

  let thinkingEl = null;

  // No elapsed counter here on purpose: this element is torn down and rebuilt between every
  // tool call, so a timer anchored to it restarted constantly and sat at 0. The status bar
  // above the composer already counts the turn, from one place that survives the whole run.
  function showThinking(label) {
    if (thinkingEl) {
      if (label) thinkingEl.querySelector(".thinking-label").textContent = label;
      return;
    }
    const row = document.createElement("div");
    row.className = "row assistant";
    row.innerHTML = `<div class="bubble thinking"><span class="thinking-label">${escapeHtml(label || "Thinking")}</span><span></span><span></span><span></span></div>`;
    thread.appendChild(row);
    thinkingEl = row;
    renderEmptyVisibility();
    scrollToBottom();
  }

  function hideThinking() {
    if (thinkingEl) {
      thinkingEl.remove();
      thinkingEl = null;
    }
  }

  const TOOL_PENDING_LABEL = {
    run_command: "Preparing a command",
    write_file: "Writing a file",
    edit_file: "Editing a file",
    read_file: "Reading a file",
    list_dir: "Listing files",
    search_files: "Searching the project",
    browser_navigate: "Opening the browser",
    browser_screenshot: "Taking a screenshot",
    generate_image: "Generating an image",
    web_fetch: "Fetching a page",
  };

  onAgentEvent("agent:tool-pending", ({ name }) => {
    const clean = String(name || "").split("<|")[0];
    const label = TOOL_PENDING_LABEL[clean] || "Preparing " + clean;
    showThinking(label);
    runActivity.textContent = label;
  });

  const SEND_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M6 11l6-6 6 6"/></svg>';
  const STOP_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';

  function setRunning(value) {
    running = value;
    sendBtn.innerHTML = value ? STOP_ICON : SEND_ICON;
    sendBtn.title = value ? "Stop" : "Send";
    sendBtn.classList.toggle("stop", value);
    if (value) startRunStatus();
    else {
      stopRunStatus();
      updateSendState();
    }
  }

  function updateSendState() {
    if (running) return;
    sendBtn.classList.toggle("idle", input.value.trim().length === 0);
  }

  function autoGrowInput() {
    input.style.height = "auto";
    input.style.height = Math.min(input.scrollHeight, 180) + "px";
    updateSendState();
  }

  // Images only stay as image_url when the model can actually see them; anything else was
  // already flattened to text by attach:prepare, so a blind model still gets the content.
  function buildUserContent(text) {
    if (!attachments.length) return text;
    const images = attachments.filter((a) => a.kind === "image");
    const asText = attachments
      .filter((a) => a.kind !== "image")
      .map((a) => a.kind === "described-image"
        ? `[Attached image: ${a.name} — described by ${a.viewedBy}]\n${a.text}`
        : `[Attached file: ${a.name}]\n\`\`\`\n${a.text}\n\`\`\``);
    const combined = [...asText, text].filter(Boolean).join("\n\n");
    if (!images.length) return combined;
    return [
      { type: "text", text: combined },
      ...images.map((a) => ({ type: "image_url", image_url: { url: a.dataUrl } })),
    ];
  }

  async function sendMessage() {
    if (running) {
      window.nutaan.stopAgent(activeChat()?.id);
      appendBubble("error", "Stopped. Your draft is still in the box — press Send again to continue.");
      return;
    }
    const text = input.value.trim();
    if (!text && !attachments.length) return;
    if (!settings.nutaanKey) { showActivation("Activate Nutaan Code with your nutaan.com API key first."); return; }
    // Block sending an image to a text-only model — it would just error out.
    if (attachments.some((a) => a.kind === "image") && !looksMultimodal(settings.model)) {
      warnIfTextOnlyForImages();
      return;
    }
    if (!settings.model || (!settings.nutaanKey && !settings.baseUrl && !settings.modelProviderId)) {
      await openSettings();
      switchSettingsTab("omniroute");
      return;
    }
    let proj = activeProject();
    if (!proj) proj = await ensureWorkspace();
    const chat = activeChat();
    if (!proj || !chat) {
      appendBubble("error", "Could not open a workspace on this computer. Open a folder from the project menu and try again.");
      return;
    }
    if (chat.messages.length === 0) chat.messages = [{ role: "system", content: systemPrompt(proj.path) }];
    if (chat.title === "New chat") chat.title = deriveChatTitle(pendingTitle || text);
    chat.updatedAt = new Date().toISOString();

    // Outcome mode: the goal goes to the swarm, not to one agent.
    if (composerMode === "outcome") {
      input.value = "";
      autoGrowInput();
      launchSwarm(text, { chat, proj });
      return;
    }

    // The model gets the wrapped prompt; the thread shows what the person actually typed.
    const shown = pendingTitle || text;
    chat.messages.push({ role: "user", content: buildUserContent(text), ...(pendingTitle ? { display: pendingTitle } : {}) });
    pendingTitle = null;
    _lastTurnHadImage = attachments.some((a) => a.kind === "image");
    resetFileGroup();
    appendBubble("user", attachments.length ? `${attachments.map((a) => `📎 ${a.name}`).join("\n")}\n\n${shown}` : shown);
    attachments = [];
    renderAttachments();
    input.value = "";
    autoGrowInput();
    renderExplorer();
    runs.set(chat.id, { activity: "Thinking" });
    threadChatId = chat.id;
    setRunning(true);
    showThinking();

    // Attached knowledge is retrieved up front and injected just before the user's message, so
    // the model has the relevant passages without having to think to go looking for them. It can
    // still call kb_search itself for anything this first pass missed.
    if (chat.kbIds?.length) {
      showThinking("Searching your knowledge base");
      const [all, found] = await Promise.all([
        window.nutaan.kbList(),
        window.nutaan.kbSearch({
          query: text,
          ids: chat.kbIds,
          topK: 5,
          baseUrl: settings.baseUrl,
          apiKey: settings.apiKey,
          nutaanKey: settings.nutaanKey,
        }),
      ]);
      const attached = all.filter((e) => chat.kbIds.includes(e.id));
      if (attached.length) {
        // The manifest goes in on every turn, not just when a passage matches. Without it, a
        // question *about* the knowledge base ("what's in it?") retrieves nothing — it doesn't
        // resemble the content — and the model, told nothing, invents a generic description of
        // what a knowledge base is. It has to know what it holds even when nothing matched.
        let block =
          "Knowledge bases attached to this conversation:\n" +
          attached.map((e) => `- "${e.title}" (${e.source}) — ${e.chunks} passages`).join("\n");
        if (found.ok && found.matches.length) {
          block +=
            "\n\nPassages matching the user's message — prefer these over your own assumptions, and name the source when you use one:\n\n" +
            found.matches.map((m) => `[${m.title} — ${m.source}]\n${m.text}`).join("\n\n---\n\n");
        } else {
          block +=
            "\n\nNo passage scored as a strong match for this message. If they're asking what the knowledge base holds, answer from the list above. If you need the detail, call kb_search with different wording. Do not invent contents, and do not describe what a knowledge base is in general — say plainly if the indexed material doesn't cover what they asked.";
        }
        chat.messages.splice(chat.messages.length - 1, 0, { role: "system", content: block });
      }
      showThinking("Thinking");
    }

    _autoSwitchCount = 0;
    runAgentTurn();
  }

  // Re-send the current conversation with whatever model is now selected. Used both
  // for a fresh turn and for a silent auto-retry after a model auto-switch.
  function runAgentTurn() {
    const proj = activeProject();
    const chat = activeChat();
    if (!proj || !chat) return;
    window.nutaan.sendAgentMessage({
      root: proj.path,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      nutaanKey: settings.nutaanKey,
      omnirouteApiKey: settings.omnirouteApiKey,
      customProviders: settings.customProviders,
      modelProviderId: settings.modelProviderId,
      model: settings.model,
      imageModel: settings.imageModel,
      autoApprove: settings.autoApprove,
      messages: chat.messages,
      chatId: chat.id,
    });
  }

  sendBtn.addEventListener("click", sendMessage);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  input.addEventListener("input", autoGrowInput);

  function renderAutoApprove() {
    autoApproveBtn.classList.toggle("on", !!settings.autoApprove);
  }
  autoApproveBtn.addEventListener("click", async () => {
    settings.autoApprove = !settings.autoApprove;
    renderAutoApprove();
    await window.nutaan.setSettings(settings);
  });

  // ---------- Agent events ----------
  let streamBubble = null;
  let streamText = "";

  function finalizeStream() {
    finalizeReasoning();
    if (streamBubble) {
      streamBubble.innerHTML = renderMarkdownLite(streamText);
      linkifyPaths(streamBubble);
      enrichServiceLinks(streamBubble);
      enrichAgentListing(streamBubble, streamText);
      streamBubble = null;
      streamText = "";
    }
  }

  // Live chain-of-thought, shown collapsed-by-default in its own card. Reasoning models can
  // spend a long time here before emitting any answer text, and with nothing on screen that
  // reads as the app having hung.
  let reasoningCard = null;
  let reasoningText = "";
  let reasoningStart = 0;

  function reasoningTick() {
    if (!reasoningCard) return;
    const secs = Math.round((Date.now() - reasoningStart) / 1000);
    reasoningCard.querySelector(".reasoning-time").textContent = `${secs}s`;
  }

  function finalizeReasoning() {
    if (!reasoningCard) return;
    clearInterval(reasoningCard._timer);
    reasoningTick();
    reasoningCard.querySelector(".reasoning-label").textContent = "Thought for";
    reasoningCard.classList.remove("live");
    reasoningCard = null;
    reasoningText = "";
  }

  onAgentEvent("agent:reasoning-delta", ({ content }) => {
    hideThinking();
    if (!reasoningCard) {
      resetFileGroup();
      reasoningStart = Date.now();
      const wrap = document.createElement("div");
      wrap.className = "reasoning-card live";
      wrap.innerHTML = `
        <div class="reasoning-header">
          <span class="reasoning-dot"></span>
          <span class="reasoning-label">Thinking</span>
          <span class="reasoning-time">0s</span>
          <span class="tool-chev">▸</span>
        </div>
        <div class="reasoning-body" hidden></div>
      `;
      const body = wrap.querySelector(".reasoning-body");
      wrap.querySelector(".reasoning-header").addEventListener("click", () => {
        body.hidden = !body.hidden;
        wrap.querySelector(".tool-chev").textContent = body.hidden ? "▸" : "▾";
        if (!body.hidden) body.scrollTop = body.scrollHeight;
      });
      thread.appendChild(wrap);
      reasoningCard = wrap;
      wrap._timer = setInterval(reasoningTick, 1000);
      renderEmptyVisibility();
    }
    reasoningText += content;
    const body = reasoningCard.querySelector(".reasoning-body");
    body.textContent = reasoningText;
    if (!body.hidden) body.scrollTop = body.scrollHeight;
    scrollToBottom();
  });

  onAgentEvent("agent:assistant-delta", ({ content }) => {
    if (!streamBubble) {
      hideThinking();
      finalizeReasoning();
      resetFileGroup();
      streamBubble = appendBubble("assistant", "");
    }
    streamText += content;
    streamBubble.innerHTML = renderMarkdownLite(streamText) + '<span class="cursor"></span>';
    scrollToBottom();
  });

  onAgentEvent("agent:tool-start", ({ id, name, args }) => {
    hideThinking();
    finalizeStream();
    toolArgsById.set(id, args);
    // write_file/edit_file get their own agent:permission-request right after this same
    // tool-start event — don't break their group here, or every file in a multi-file batch
    // ends up as its own card instead of one grouped summary.
    if (name !== "write_file" && name !== "edit_file") resetFileGroup();
    const visibleTools = [
      "list_dir", "read_file", "search_files", "list_skills", "use_skill",
      "browser_navigate", "browser_read_page", "browser_click", "browser_type",
      "browser_scroll", "browser_screenshot", "browser_resize",
      "osint_search_tools", "osint_dns_recon", "osint_ip_lookup", "osint_subdomain_enum",
      "osint_http_recon", "osint_dork_generator", "vuln_static_scan",
      // run_background / stop_background_task go through the approval card (like run_command), so
      // they are NOT here — listing them too made a second, never-resolving spinner card.
      "check_background_task", "list_background_tasks", "cleanup_storage", "os_system_stats",
    ];
    if (visibleTools.includes(name)) appendToolCard(id, name, args);
    runActivity.textContent = toolLabel(name, args).replace(/<[^>]+>/g, "");
  });

  onAgentEvent("agent:tool-arg-stream", ({ id, name, path, text }) => {
    // An artboard streams onto the Design canvas (design.js), not as a wall of HTML in the thread.
    if (String(name).startsWith("design_")) return;
    hideThinking();
    finalizeStream();
    let card = liveWriteCards.get(id);
    if (!card) {
      card = document.createElement("div");
      card.className = "tool-card pending";
      card.innerHTML = `
        <div class="tool-header"><div class="tool-title">${name === "edit_file" ? "Editing" : "Writing"} <code></code></div></div>
        <div class="tool-detail"><pre class="live-write-body"></pre></div>
      `;
      thread.appendChild(card);
      liveWriteCards.set(id, card);
      renderEmptyVisibility();
    }
    if (path) card.querySelector(".tool-title code").textContent = path;
    const body = card.querySelector(".live-write-body");
    body.textContent = text;
    body.scrollTop = body.scrollHeight;
    scrollToBottom();
  });

  onAgentEvent("agent:permission-request", (req) => {
    hideThinking();
    finalizeStream();
    const liveCard = liveWriteCards.get(req.id);
    if (liveCard) {
      liveCard.remove();
      liveWriteCards.delete(req.id);
    }
    if ((req.name === "write_file" || req.name === "edit_file") && req.autoApproved) {
      appendFileGroupRow(req);
    } else {
      resetFileGroup();
      appendPermissionCard(req);
    }
  });

  function appendNoticeCard(text) {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    const wrap = document.createElement("div");
    wrap.className = "tool-card ok";
    wrap.innerHTML = `<div class="tool-header"><div class="tool-title">${text}</div></div>`;
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
    showThinking();
  }

  const seenBgTasks = new Set();
  window.nutaan.onAgentEvent("bgtask:update", (u) => {
    if (!u) return;
    // A task id we haven't seen before means one just started — surface it: pop the Terminal
    // panel open so the live output is visible, the way you'd want a dev server or build to show.
    if (u.id && !seenBgTasks.has(u.id)) {
      seenBgTasks.add(u.id);
      termSelectedId = u.id;
      autoOpenPanel();
      setPanelMode("terminal");
    }
    // Keep the badge and the live view current on every update.
    if (panelMode === "terminal") refreshTerminal();
    else window.nutaan.bgTasks.list().then(updateTerminalBadge).catch(() => {});
    // Finished (or crashed): drop a subtle notice in the thread too, without touching the thinking
    // indicator, since a task can complete while the agent is idle between turns.
    if (u.status !== "exited" && u.status !== "error") return;
    const wrap = document.createElement("div");
    wrap.className = "tool-card " + (u.status === "error" || (u.exitCode && u.exitCode !== 0) ? "err" : "ok");
    const label =
      u.status === "error"
        ? `Background task ${u.id} failed: ${escapeHtml(u.error || "")}`
        : `Background task ${u.id} finished — exit ${u.exitCode}${u.command ? ` · <code>${escapeHtml(u.command.slice(0, 60))}</code>` : ""}`;
    wrap.innerHTML = `<div class="tool-header"><div class="tool-title">${label}</div></div>`;
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
  });

  onAgentEvent("agent:compacting", () => {
    appendNoticeCard("Compacting conversation to make room for more context…");
  });

  // A provider stumbling is the app's problem, not the user's: retries show in the run strip and
  // nowhere else, and a model switch is one quiet line in the thread — not three cards. A new
  // user's first chat must not open with a wall of failure.
  onAgentEvent("agent:retrying", ({ message, delayMs }) => {
    runActivity.textContent = `Model busy — retrying in ${Math.max(1, Math.round((delayMs || 0) / 1000))}s`;
    showThinking(/rate.?limit/i.test(message || "") ? "Model busy, waiting" : "Retrying");
  });

  onAgentEvent("agent:model-switched", ({ from, to }) => {
    settings.model = to;
    window.nutaan.setSettings(settings);
    updateModelBadge();
    appendSystemLine(`Switched to ${basename(to)} — ${basename(from)} was busy`);
    showThinking();
  });

  function appendSystemLine(text) {
    hideThinking();
    finalizeStream();
    const line = document.createElement("div");
    line.className = "sys-line";
    line.textContent = text;
    thread.appendChild(line);
    renderEmptyVisibility();
    scrollToBottom();
  }

  const FILE_VIEW_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
  async function maybeShowInCodeTab(id, name, result) {
    if (!FILE_VIEW_TOOLS.has(name) || (result && result.error)) return;
    const args = toolArgsById.get(id);
    if (!args?.path || !activeProject()) return;
    // Don't yank the user off a live browser preview they deliberately have up just because the
    // agent also touched a file — load it into a tab, but only steal focus if Code is showing.
    // A write/edit opens straight into the diff so you see what changed; a plain read shows the file.
    const isEdit = name === "write_file" || name === "edit_file";
    await openFileInPanel(args.path, { focus: panelMode === "code", diff: isEdit, fromAgent: true });
  }

  const FS_MUTATING_TOOLS = new Set(["write_file", "edit_file", "run_command"]);
  // ---------- Motion: encode rendered frames into a video ----------
  // The main process renders one PNG per frame; this draws them onto a canvas at exactly the frame
  // rate while MediaRecorder captures the stream. MP4 (H.264) where Chromium offers it, VP9 WebM
  // otherwise. Nothing native, nothing bundled.
  function motionMime(format) {
    const mp4 = ["video/mp4;codecs=avc1.42E01E", "video/mp4;codecs=avc1", "video/mp4"];
    const webm = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm"];
    const cands = format === "webm" ? [...webm, ...mp4] : [...mp4, ...webm];
    for (const m of cands) { try { if (window.MediaRecorder && MediaRecorder.isTypeSupported(m)) return m; } catch {} }
    return "";
  }
  window.nutaan.motion?.onEncode(async ({ jobId, dir, frames, fps, width, height, ext = "png", format = "mp4" }) => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext("2d", { alpha: false });
      const stream = canvas.captureStream(0);
      const track = stream.getVideoTracks()[0];
      const mime = motionMime(format);
      const rec = new MediaRecorder(stream, { mimeType: mime || undefined, videoBitsPerSecond: Math.min(30_000_000, Math.round(width * height * fps * 0.2)) });
      const chunks = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
      const stopped = new Promise((r) => { rec.onstop = r; });
      const load = (i) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("frame " + i + " failed to load"));
        img.src = "file:///" + (dir.replace(/\\/g, "/") + "/f" + String(i).padStart(5, "0") + "." + ext).replace(/^\/+/, "");
      });
      // Decode several frames ahead so the draw loop never waits on disk: a late frame would be
      // stamped late, and the file would run long in that spot.
      const AHEAD = 8;
      const queue = new Map();
      const fetchAhead = (from) => { for (let k = from; k < Math.min(frames, from + AHEAD); k++) if (!queue.has(k)) queue.set(k, load(k)); };
      fetchAhead(0);
      const first = await queue.get(0);
      ctx.drawImage(first, 0, 0, width, height);
      rec.start(250);
      const step = 1000 / fps;
      const t0 = performance.now();
      for (let i = 0; i < frames; i++) {
        fetchAhead(i + 1);
        const img = i === 0 ? first : await queue.get(i);
        queue.delete(i);
        const due = t0 + i * step;
        const wait = due - performance.now();
        if (wait > 0) await new Promise((r) => setTimeout(r, wait));
        ctx.drawImage(img, 0, 0, width, height);
        track.requestFrame && track.requestFrame();
      }
      const loopMs = performance.now() - t0;
      await new Promise((r) => setTimeout(r, step * 2));
      rec.stop();
      await stopped;
      const blob = new Blob(chunks, { type: mime || "video/webm" });
      window.__lastEncode = { frames, fps, loopMs: Math.round(loopMs), bytes: blob.size, mime };
      await window.nutaan.motion.encoded({ jobId, data: new Uint8Array(await blob.arrayBuffer()), mime: mime || "video/webm" });
    } catch (err) {
      await window.nutaan.motion.encoded({ jobId, error: err.message || String(err) });
    }
  });

  // Progress while a scene renders, and the finished video as a card you can play and open.
  onAgentEvent("motion:progress", ({ frame, frames, phase }) => {
    runActivity.textContent = phase === "encode" ? `Encoding ${frames} frames…` : `Rendering frame ${frame} of ${frames}…`;
  });
  function appendVideoCard({ path, seconds, width, height, bytes }) {
    const wrap = document.createElement("div");
    wrap.className = "video-card";
    const src = "file:///" + String(path).replace(/\\/g, "/").replace(/^\/+/, "");
    wrap.innerHTML = `<video controls preload="metadata" src="${escapeHtml(src)}"></video>
      <div class="video-meta"><span>${escapeHtml(basename(path))}</span><span class="video-dim">${Math.round(seconds || 0)}s · ${width}×${height} · ${((bytes || 0) / 1048576).toFixed(1)} MB</span>
      <button class="link-btn" type="button">Show in folder</button></div>`;
    wrap.querySelector("button").addEventListener("click", () => window.nutaan.studio?.reveal ? window.nutaan.studio.reveal(path) : window.nutaan.osOpen(path));
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
  }
  onAgentEvent("motion:done", (out) => { if (out && out.path) appendVideoCard(out); });

  onAgentEvent("agent:tool-result", ({ id, name, result }) => {
    resolveToolCard(id, name, result);
    maybeShowInCodeTab(id, name, result);
    if (running) showThinking();
    if (FS_MUTATING_TOOLS.has(name) && !(result && result.error)) {
      contextFiles = null;
      refreshTree();
      refreshGit();
    }
  });

  onAgentEvent("agent:done", ({ messages, chatId }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    const chat = activeChat();
    if (messages && chat) {
      chat.messages = messages;
      chat.updatedAt = new Date().toISOString();
      persistProjects();
    }
    runs.delete(chatId || chat?.id);
    setRunning(false);
    // The thread was built for another chat (you switched here mid-run): redraw from history.
    if (chat && threadChatId !== chat.id) { renderThreadFromMessages(chat.messages); threadChatId = chat.id; }
    renderExplorer();
  });

  onAgentEvent("agent:error", ({ message, chatId }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    runs.delete(chatId || activeChat()?.id);

    if (/user not found|invalid.?api.?key|invalid_api_key|no such user|unknown key|missing.*auth|no auth credentials/i.test(message || "")) {
      appendBubble("error", `${message}\n\nThe backend rejected the request as unauthenticated. If you set a custom Server URL under Settings → Advanced, check its API key.`);
      setRunning(false);
      return;
    }

    // A model id left over from a previous Server URL isn't in the live catalog at all — that
    // alone is a reliable signal the model is wrong for this backend. But a valid-looking model
    // can also fail at the backend (500s, "no available channel", a model that can't read the
    // pasted image, an expired route). In both cases: disable the model that just failed and
    // cascade to the next one, retrying silently — never dump a raw server error on the user.
    const unknownModel = settings.model && availableModels.length > 0 && !availableModels.includes(settings.model);
    const backendGlitch = /internal server error|no available channel|无可用渠道|not a valid model|unavailable|temporarily|overloaded|\b5\d\d\b|bad_response|rate.?limit|too many requests|does not support (images|vision)|image|multimodal/i.test(message || "");
    const canSwitch = availableModels.length > 0 && _autoSwitchCount < MAX_AUTO_SWITCH;
    if ((unknownModel || backendGlitch) && canSwitch) {
      const badModel = settings.model;
      // Put the failing model on a temporary cooldown (auto-watch) — never a
      // permanent disable, since it may just be briefly down. It's freed again
      // automatically once the cooldown lapses.
      putModelOnCooldown(badModel);
      const fallback = availableModels.find((m) => m !== badModel && modelUsable(m) && (!_lastTurnHadImage || looksMultimodal(m)));
      if (fallback) {
        _autoSwitchCount++;
        settings.model = fallback;
        // availableModels come from the Nutaan managed backend — route there, not
        // through the OmniRoute gateway (which needs provider keys the user may not
        // have). This is what makes it "just work" without opening Settings.
        settings.modelProviderId = "";
        window.nutaan.setSettings(settings);
        updateModelBadge();
        appendNoticeCard(`"${badModel}" is temporarily unavailable — switched to "${fallback}" and retrying (it'll be retried automatically later)…`);
        setRunning(true);
        showThinking();
        runAgentTurn();
        return;
      }
      // Everything is on cooldown right now — keep the model and tell the user gently.
      window.nutaan.setSettings(settings);
      appendBubble("error", `Every available model is briefly unavailable right now. It'll recover on its own — try again in a minute, or pick another in Settings → Models.`);
      setRunning(false);
      return;
    }

    appendBubble("error", message);
    setRunning(false);
  });

  // ---------- Browser actions driven by the agent ----------
  function agentActionLabel(req) {
    if (req.action === "navigate") return `Opening ${req.url}`;
    if (req.action === "read") return "Reading the page";
    if (req.action === "click") return `Clicking ${req.selector}`;
    if (req.action === "type") return `Typing into ${req.selector}`;
    if (req.action === "scroll") return `Scrolling ${req.direction || "down"}`;
    if (req.action === "screenshot") return "Taking a screenshot";
    if (req.action === "resize") return `Switching to ${req.size} view`;
    if (req.action === "execute") return "Running a script on the page";
    return "Working in the browser";
  }

  // Briefly outlines the element the agent is about to act on, so a page that moves by itself
  // is legible as the agent working rather than as a glitch.
  async function flashElement(view, selector) {
    try {
      await view.executeJavaScript(`
        (function () {
          var el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return;
          el.scrollIntoView({ block: "center", behavior: "smooth" });
          var prev = el.style.boxShadow;
          el.style.boxShadow = "0 0 0 3px #ec4899, 0 0 22px 6px rgba(236,72,153,0.55)";
          setTimeout(function () { el.style.boxShadow = prev; }, 1100);
        })()
      `);
    } catch {
      // the page may have navigated away — the highlight is cosmetic, never fail the action
    }
  }

  onAgentEvent("agent:browser-action", async (req) => {
    autoOpenPanel("browser");
    agentActivityText.textContent = agentActionLabel(req);
    agentActivity.hidden = false;
    if (browserTabs.length === 0) addBrowserTab("about:blank");
    const view = activeWebview();
    if (!view) {
      agentActivity.hidden = true;
      window.nutaan.respondToBrowserAction(req.id, { ok: false, error: "No browser tab available" });
      return;
    }
    // Don't drive a webview that isn't attached/dom-ready yet — wait for it first (capped, so a
    // genuinely stuck page still returns instead of hanging until the main-process timeout).
    const actTab = activeBrowserTab();
    if (req.action !== "navigate" && actTab && !actTab.ready && actTab.whenReady) {
      await Promise.race([actTab.whenReady, new Promise((r) => setTimeout(r, 8000))]);
    }
    if (req.action === "click" || req.action === "type") await flashElement(view, req.selector);
    try {
      if (req.action === "navigate") {
        const url = normalizeUrl(req.url) || req.url;
        let failInfo = null;
        await new Promise((resolve) => {
          let settled = false;
          let started = false;
          const cleanup = () => {
            view.removeEventListener("did-start-loading", onStart);
            view.removeEventListener("dom-ready", onReady);
            view.removeEventListener("did-stop-loading", onStop);
            view.removeEventListener("did-fail-load", onFail);
          };
          const finish = () => {
            if (settled) return;
            settled = true;
            cleanup();
            resolve();
          };
          // Only accept completion events AFTER this navigation actually began — otherwise a
          // stale did-stop-loading queued from the previous page resolves us in ~1ms, before the
          // new page has loaded at all.
          const onStart = () => { started = true; };
          const onReady = () => { if (started) finish(); };
          const onStop = () => { if (started) finish(); };
          // -3 is ERR_ABORTED (a normal redirect/replace), not a real failure worth reporting.
          const onFail = (e) => {
            if (e && e.errorCode && e.errorCode !== -3) failInfo = e.errorDescription || `error ${e.errorCode}`;
            if (started) finish();
          };
          view.addEventListener("did-start-loading", onStart);
          view.addEventListener("dom-ready", onReady);
          view.addEventListener("did-stop-loading", onStop);
          view.addEventListener("did-fail-load", onFail);
          try {
            if (view.loadURL) view.loadURL(url);
            else view.src = url;
          } catch {
            view.src = url;
          }
          setTimeout(finish, 15000);
        });
        const finalUrl = view.getURL ? view.getURL() : url;
        browserAddress.value = finalUrl;
        window.nutaan.respondToBrowserAction(req.id, { ok: true, url: finalUrl, title: view.getTitle ? view.getTitle() : "", failed: failInfo || undefined });
      } else if (req.action === "read") {
        // Return the visible text AND a list of interactive elements with usable selectors, so the
        // agent can inspect the page and click/type accurately instead of guessing a CSS selector.
        const data = await view.executeJavaScript(`
          (function () {
            var text = document.body ? document.body.innerText.slice(0, 5000) : '';
            var els = [];
            var nodes = document.querySelectorAll('a[href], button, input, textarea, select, [role=button], [role=link], [role=tab], [onclick]');
            for (var i = 0; i < nodes.length && els.length < 50; i++) {
              var n = nodes[i];
              var r = n.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              var label = (n.innerText || n.value || n.getAttribute('aria-label') || n.getAttribute('placeholder') || n.getAttribute('title') || n.name || '').trim().replace(/\\s+/g, ' ').slice(0, 70);
              var sel = '';
              try {
                if (n.id) sel = '#' + CSS.escape(n.id);
                else if (n.getAttribute('name')) sel = n.tagName.toLowerCase() + '[name="' + n.getAttribute('name') + '"]';
                else if (n.getAttribute('data-testid')) sel = '[data-testid="' + n.getAttribute('data-testid') + '"]';
                else if (n.getAttribute('aria-label')) sel = n.tagName.toLowerCase() + '[aria-label="' + n.getAttribute('aria-label') + '"]';
              } catch (e) {}
              els.push({ tag: n.tagName.toLowerCase(), type: n.getAttribute('type') || '', label: label, selector: sel });
            }
            var dialogs = (window.__nutaanDialogs || []).slice();
            window.__nutaanDialogs = [];
            return { text: text, elements: els, url: location.href, title: document.title, dialogs: dialogs };
          })()
        `);
        window.nutaan.respondToBrowserAction(req.id, { ok: true, url: data.url || (view.getURL ? view.getURL() : ""), title: data.title, text: data.text, elements: data.elements, dialogs: data.dialogs });
      } else if (req.action === "click") {
        const result = await view.executeJavaScript(`
          (function() {
            var el = document.querySelector(${JSON.stringify(req.selector)});
            if (!el) return { ok: false, error: "No element matches selector" };
            el.scrollIntoView({ block: "center" });
            el.click();
            return { ok: true };
          })()
        `);
        window.nutaan.respondToBrowserAction(req.id, result);
      } else if (req.action === "type") {
        const result = await view.executeJavaScript(`
          (function() {
            var el = document.querySelector(${JSON.stringify(req.selector)});
            if (!el) return { ok: false, error: "No element matches selector" };
            el.focus();
            var setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value") ||
                         Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value");
            if (setter && setter.set) setter.set.call(el, ${JSON.stringify(req.text)});
            else el.value = ${JSON.stringify(req.text)};
            el.dispatchEvent(new Event("input", { bubbles: true }));
            el.dispatchEvent(new Event("change", { bubbles: true }));
            ${req.submit ? 'if (el.form) { if (el.form.requestSubmit) el.form.requestSubmit(); else el.form.submit(); }' : ""}
            return { ok: true };
          })()
        `);
        window.nutaan.respondToBrowserAction(req.id, result);
      } else if (req.action === "scroll") {
        const dy = req.direction === "up" ? -(req.amount || 600) : (req.amount || 600);
        await view.executeJavaScript(`window.scrollBy(0, ${dy})`);
        window.nutaan.respondToBrowserAction(req.id, { ok: true });
      } else if (req.action === "screenshot") {
        if (view.isLoading && view.isLoading()) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              view.removeEventListener("did-stop-loading", finish);
              resolve();
            };
            view.addEventListener("did-stop-loading", finish);
            setTimeout(finish, 8000);
          });
        }
        // Let the page paint before grabbing it — capturePage on a just-shown/just-loaded webview
        // can otherwise return a blank frame. Retry once if the first frame comes back suspiciously
        // small (a blank capture), which happens right after the panel is first shown.
        await new Promise((r) => setTimeout(r, 250));
        let image;
        try {
          image = await view.capturePage();
          if (!image || image.toDataURL().length < 3000) {
            await new Promise((r) => setTimeout(r, 350));
            image = await view.capturePage();
          }
        } catch (e) {
          window.nutaan.respondToBrowserAction(req.id, { ok: false, error: `Couldn't capture the page: ${e.message}` });
          return;
        }
        window.nutaan.respondToBrowserAction(req.id, {
          ok: true,
          url: view.getURL ? view.getURL() : "",
          imageDataUrl: image.toDataURL(),
        });
      } else if (req.action === "resize") {
        setBrowserSize(req.size === "mobile" || req.size === "tablet" ? req.size : "desktop");
        window.nutaan.respondToBrowserAction(req.id, { ok: true, size: req.size });
      } else if (req.action === "execute") {
        const wrapped = `
          (async () => {
            try {
              ${req.code}
            } catch (__nutaanErr) {
              return { __nutaanError: String((__nutaanErr && __nutaanErr.message) || __nutaanErr) };
            }
          })()
        `;
        const raw = await view.executeJavaScript(wrapped);
        if (raw && typeof raw === "object" && "__nutaanError" in raw) {
          window.nutaan.respondToBrowserAction(req.id, { ok: false, error: raw.__nutaanError });
        } else {
          window.nutaan.respondToBrowserAction(req.id, { ok: true, value: raw === undefined ? null : raw });
        }
      } else {
        window.nutaan.respondToBrowserAction(req.id, { ok: false, error: "Unknown browser action" });
      }
    } catch (err) {
      window.nutaan.respondToBrowserAction(req.id, { ok: false, error: err.message });
    } finally {
      agentActivity.hidden = true;
    }
  });

  // ---------- Settings (multi-tab) ----------
  let _settingsActiveTab = "account";
  let _modelSearchTerm = "";
  let _modelFilterCategory = "all";

  async function openSettings(tabId) {
    if (baseUrlInput) baseUrlInput.value = settings.baseUrl || "";
    if (apiKeyInput) apiKeyInput.value = settings.apiKey || "";
    if (imageModelInput) imageModelInput.value = settings.imageModel || "";

    const advBase = el("advBaseUrl");
    const advKey = el("advApiKey");
    if (advBase) advBase.value = settings.baseUrl || "";
    if (advKey) advKey.value = settings.apiKey || "";

    const autoToggle = el("autoFallbackToggle");
    if (autoToggle) autoToggle.checked = settings.autoModelFallback !== false;

    renderAccountRow();
    renderUsagePanel();
    await loadOmniRouteCatalog();
    if (typeof refreshTools === "function") refreshTools();
    switchSettingsTab(tabId || _settingsActiveTab || "account");
    settingsOverlay.hidden = false;
  }

  function switchSettingsTab(tabId) {
    _settingsActiveTab = tabId;
    document.querySelectorAll(".settings-tab").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tab === tabId);
    });
    document.querySelectorAll(".settings-page").forEach((page) => {
      page.hidden = page.dataset.page !== tabId;
    });
    const titles = {
      account: "Account",
      omniroute: "OmniRoute Universal Gateway",
      models: "Models Catalog",
      providers: "Model Providers",
      tools: "Tools & Integrations",
      skills: "Skills",
      agentbridge: "AgentBridge (Internal MITM)",
      advanced: "Advanced Settings"
    };
    const titleEl = el("settingsPageTitle");
    if (titleEl) titleEl.textContent = titles[tabId] || tabId;

    if (tabId === "omniroute") renderOmniRouteTab();
    if (tabId === "models") renderModelTable();
    if (tabId === "providers") renderProviders();
    if (tabId === "tools") { if (typeof renderTools === "function") renderTools(); }
    if (tabId === "agentbridge") renderAgentBridgeTab();
    if (tabId === "skills") renderSkillsPage();
  }

  // ---------- Skills page ----------
  // The same catalogue list_skills hands the model, grouped by where each skill lives.
  let _skillsCache = null;
  async function renderSkillsPage(force) {
    const list = el("skillList");
    if (!list) return;
    if (!_skillsCache || force) {
      list.innerHTML = `<div class="sk-empty">Looking for skills…</div>`;
      try { _skillsCache = await window.nutaan.skills.list(activePath || null); }
      catch (e) { list.innerHTML = `<div class="sk-empty">${escapeHtml(e.message)}</div>`; return; }
    }
    const q = (el("skillSearch").value || "").trim().toLowerCase();
    const all = _skillsCache.skills || [];
    const shown = q ? all.filter((k) => (k.id + " " + k.name + " " + k.description).toLowerCase().includes(q)) : all;
    el("skillCount").textContent = q ? `${shown.length} of ${all.length}` : `${all.length} skills`;
    const groups = new Map();
    for (const d of _skillsCache.dirs || []) groups.set(d.label, { dir: d.dir, items: [] });
    for (const k of shown) (groups.get(k.source) || groups.set(k.source, { dir: "", items: [] }).get(k.source)).items.push(k);
    list.innerHTML = "";
    for (const [label, g] of groups) {
      if (!g.items.length && (q || label === "Built in")) continue;
      const sec = document.createElement("div");
      sec.className = "sk-group";
      sec.innerHTML = `<div class="sk-group-h">${escapeHtml(label)} <span class="n">${g.items.length}</span>` +
        (g.dir ? `<button class="link-btn" data-dir="${escapeHtml(g.dir)}" type="button">Open folder</button>` : "") + `</div>` +
        (g.items.length
          ? g.items.map((k) => `
            <div class="sk-row" title="${escapeHtml(k.dir || "")}">
              <span class="sk-icon">${escapeHtml((k.name || k.id).slice(0, 1).toUpperCase())}</span>
              <div><div class="sk-name">${escapeHtml(k.id)}</div><div class="sk-desc">${escapeHtml(k.description || "No description in SKILL.md")}</div></div>
              <span class="sk-src">${escapeHtml(label)}</span>
            </div>`).join("")
          : `<div class="sk-empty">Nothing here yet — a folder with a SKILL.md in ${escapeHtml(g.dir)} shows up on refresh.</div>`);
      list.appendChild(sec);
    }
    if (!shown.length) list.innerHTML = `<div class="sk-empty">No skill matches "${escapeHtml(q)}".</div>`;
  }
  el("skillSearch")?.addEventListener("input", () => renderSkillsPage());
  el("skillRefresh")?.addEventListener("click", () => renderSkillsPage(true));
  el("skillOpenUser")?.addEventListener("click", async () => {
    const user = (_skillsCache?.dirs || []).find((d) => /user/i.test(d.label)) || (_skillsCache?.dirs || [])[1];
    if (user) await window.nutaan.skills.openFolder(user.dir);
  });
  el("skillList")?.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-dir]");
    if (b) window.nutaan.skills.openFolder(b.dataset.dir);
  });

  document.querySelectorAll(".settings-tab").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      switchSettingsTab(btn.dataset.tab);
    });
  });

  // ---------- OmniRoute Gateway Controller ----------
  let _orPollInterval = null;

  async function renderOmniRouteTab() {
    const dot = el("orStatusDot");
    const startBtn = el("orStartBtn");
    const stopBtn = el("orStopBtn");
    const epCode = el("orEndpointUrl");
    const copyBtn = el("orCopyEndpointBtn");
    const comboSelect = el("orActiveCombo");
    const freePoolToggle = el("orFreePoolToggle");
    const agBadge = el("orAgStatusBadge");
    const kiroBadge = el("orKiroStatusBadge");
    const statReq = el("orStatReq");
    const statOk = el("orStatOk");
    const statFb = el("orStatFb");
    const statModels = el("orStatModels");

    async function updateStatus() {
      if (!window.nutaan || !window.nutaan.gateway) return;
      try {
        const st = await window.nutaan.gateway.status();
        const isRunning = Boolean(st.running);
        if (dot) dot.className = "or-status-dot" + (isRunning ? " running" : "");
        if (startBtn) startBtn.hidden = isRunning;
        if (stopBtn) stopBtn.hidden = !isRunning;
        if (epCode) epCode.textContent = `http://127.0.0.1:${st.port || 20128}/v1`;

        if (st.stats) {
          if (statReq) statReq.textContent = st.stats.totalRequests || 0;
          if (statOk) statOk.textContent = st.stats.successfulRequests || 0;
          if (statFb) statFb.textContent = st.stats.fallbacksTriggered || 0;
        }
        if (statModels) statModels.textContent = String(st.modelsCount || 0);
        if (st.error) el("orConnectionMessage").textContent = st.error;
      } catch (err) {
        console.warn("Error fetching gateway status:", err);
      }

      // Check MITM interception status
      if (window.nutaan && window.nutaan.mitm) {
        try {
          const mitmSt = await window.nutaan.mitm.status();
          if (agBadge) {
            agBadge.textContent = mitmSt.running ? "✓ Actively Intercepted" : "Ready to Intercept";
            agBadge.style.color = mitmSt.running ? "#34d399" : "#94a3b8";
          }
          if (kiroBadge) {
            kiroBadge.textContent = mitmSt.running ? "✓ Actively Intercepted" : "Ready to Intercept";
            kiroBadge.style.color = mitmSt.running ? "#34d399" : "#94a3b8";
          }
        } catch {}
      }
    }

    if (startBtn && !startBtn._bound) {
      startBtn._bound = true;
      startBtn.addEventListener("click", async () => {
        startBtn.disabled = true;
        startBtn.textContent = "Starting…";
        try {
          const result = await window.nutaan.gateway.start({ port: 20128 });
          if (result.error) throw new Error(result.error);
          await updateStatus();
        } catch (error) {
          el("orConnectionMessage").textContent = error.message;
        } finally {
          startBtn.disabled = false;
          startBtn.textContent = "Start Gateway";
        }
      });
    }

    if (stopBtn && !stopBtn._bound) {
      stopBtn._bound = true;
      stopBtn.addEventListener("click", async () => {
        stopBtn.disabled = true;
        stopBtn.textContent = "Stopping…";
        try {
          await window.nutaan.gateway.stop();
          await updateStatus();
        } finally {
          stopBtn.disabled = false;
          stopBtn.textContent = "Stop Gateway";
        }
      });
    }

    if (copyBtn && !copyBtn._bound) {
      copyBtn._bound = true;
      copyBtn.addEventListener("click", () => {
        navigator.clipboard.writeText("http://127.0.0.1:20128/v1");
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
      });
    }

    await updateStatus();
    await refreshGatewayConnections();
  }

  // ---------- Enhanced Model Table Rendering ----------
  async function refreshGatewayConnections() {
    const message = el("orConnectionMessage");
    message.textContent = "Syncing models from OmniRoute…";
    const result = await window.nutaan.gateway.getModels();
    if (result.error) { message.textContent = result.error; return; }
    _omniProviders = result.providers || [];
    _omniCombosCache = result.combos || {};
    _omniCatalogCache = result.models || [];
    _omniModelsLoaded = true;
    rebuildModels();
    message.textContent = _omniCatalogCache.length + " models returned by OmniRoute. Test selected verifies the selected route.";
    el("orStatModels").textContent = String(_omniCatalogCache.length);
    el("orClientKey").value = settings.omnirouteApiKey || "";
    updateSendState();
  }
  el("orRefreshProviders")?.addEventListener("click", () => refreshGatewayConnections().catch(error => { el("orConnectionMessage").textContent = error.message; }));
  // Both buttons open the local dashboard (root) — that is where the provider
  // key fields, free-tier pool and connect flow all live in the native gateway.
  for (const id of ["orOpenProviders", "orOpenFreeTiers", "orOpenDashboard"]) {
    el(id)?.addEventListener("click", async () => {
      el(id).disabled = true;
      try {
        const result = await window.nutaan.gateway.start({ port: 20128 });
        if (result && result.error) throw new Error(result.error);
        await window.nutaan.openExternal("http://127.0.0.1:20128/");
      } catch(error) { el("orConnectionMessage").textContent = error.message; }
      finally { el(id).disabled = false; }
    });
  }
  el("orSaveClientKey")?.addEventListener("click", async () => {
    settings.omnirouteApiKey = el("orClientKey").value.trim();
    await window.nutaan.setSettings(settings);
    await refreshGatewayConnections();
  });

  ['ChatGPT', 'Google', 'Claude', 'Groq', 'DeepSeek', 'Mistral', 'Perplexity'].forEach(provider => {
    const btn = el(`btnLogin${provider}`);
    btn?.addEventListener('click', async () => {
      const msg = el("orInterceptMessage");
      if (msg) msg.textContent = `Waiting for login in ${provider}... Please authenticate in the popup window.`;
      btn.disabled = true;
      try {
        const result = await window.nutaan.gateway.authIntercept(provider.toLowerCase());
        if (result && result.ok) {
           if (msg) msg.textContent = `✅ Successfully connected ${provider}! Tokens intercepted and active in gateway.`;
           btn.textContent = "Connected";
           btn.classList.remove("btn-secondary");
           btn.classList.add("btn-primary");
           await refreshGatewayConnections();
        } else {
           if (msg) msg.textContent = `❌ ${result?.error || "Login window closed before token was captured"}`;
        }
      } catch (err) {
        if (msg) msg.textContent = `❌ Error: ${err.message}`;
      } finally {
        btn.disabled = false;
      }
    });
  });


  async function testModelConnections(selectedOnly) {
    const buttons = [el("testModelsBtn"), el("testSelectedModelBtn")];
    buttons.forEach(button => { button.disabled = true; });
    const status = el("modelTestStatus");
    const models = selectedOnly ? [{ id: settings.model, providerId: settings.modelProviderId || "" }] : aggregatedModels;
    settings.modelHealth ||= {};
    let passed = 0, checked = 0;
    try {
      for (const model of models.filter(m => m.id)) {
        status.textContent = `Testing ${++checked}/${models.length}: ${model.id}`;
        const result = await window.nutaan.testModels({ ...settings, modelProviderId: model.providerId || "", models: [model.id] });
        const health = result.results?.[0] || { ok: false, error: result.error || "No test result" };
        settings.modelHealth[modelHealthKey(model.providerId || "", model.id)] = { ...health, checkedAt: Date.now() };
        if (health.ok) passed++;
        renderModelTable();
      }
      await window.nutaan.setSettings(settings);
      const last = selectedOnly && settings.modelHealth[modelHealthKey(settings.modelProviderId || "", settings.model)];
      status.textContent = `${passed}/${checked} models responded.${last?.error ? ` ${last.error}` : ""}`;
    } catch(error) { status.textContent = error.message; }
    finally { buttons.forEach(button => { button.disabled = false; }); }
  }
  el("testModelsBtn")?.addEventListener("click", () => testModelConnections(false));
  el("testSelectedModelBtn")?.addEventListener("click", () => testModelConnections(true));

  function modelHealthKey(providerId, modelId) {
    return `${providerId || ""}::${modelId || ""}`;
  }
  function renderModelTable() {
    const tbody = el("modelTableBody");
    if (!tbody) return;

    // Search and filter listeners
    const searchInput = el("modelSearchInput");
    if (searchInput && !searchInput._bound) {
      searchInput._bound = true;
      searchInput.addEventListener("input", (e) => {
        _modelSearchTerm = (e.target.value || "").toLowerCase().trim();
        renderModelTable();
      });
    }

    const chipsContainer = el("modelFilterChips");
    if (chipsContainer && !chipsContainer._bound) {
      chipsContainer._bound = true;
      chipsContainer.querySelectorAll(".m-chip").forEach((btn) => {
        btn.addEventListener("click", () => {
          chipsContainer.querySelectorAll(".m-chip").forEach((b) => b.classList.remove("active"));
          btn.classList.add("active");
          _modelFilterCategory = btn.dataset.filter || "all";
          renderModelTable();
        });
      });
    }

    if (!aggregatedModels || !aggregatedModels.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="model-table-empty">No connected models. Open OmniRoute to connect a provider, or connect your Nutaan account.</td></tr>`;
      return;
    }

    // Filter models
    let filtered = aggregatedModels;
    if (_modelSearchTerm) {
      filtered = filtered.filter((m) =>
        (m.id && m.id.toLowerCase().includes(_modelSearchTerm)) ||
        (m.name && m.name.toLowerCase().includes(_modelSearchTerm)) ||
        (m.providerName && m.providerName.toLowerCase().includes(_modelSearchTerm))
      );
    }

    if (_modelFilterCategory === "free") {
      filtered = filtered.filter((m) => m.tier === "free" || (m.id && m.id.includes(":free")));
    } else if (_modelFilterCategory === "coding") {
      filtered = filtered.filter((m) => m.category === "coding" || (m.id && (m.id.includes("code") || m.id.includes("qwen"))));
    } else if (_modelFilterCategory === "reasoning") {
      filtered = filtered.filter((m) => m.category === "reasoning" || (m.id && (m.id.includes("r1") || m.id.includes("reason") || m.id.includes("thinking") || m.id.includes("o3"))));
    } else if (_modelFilterCategory === "local") {
      filtered = filtered.filter((m) => m.tier === "local" || (m.providerType && m.providerType.includes("ollama")));
    }

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" class="model-table-empty">No models match "${escapeHtml(_modelSearchTerm)}"</td></tr>`;
      return;
    }

    tbody.innerHTML = "";
    // Display up to 150 items to keep DOM super responsive
    const slice = filtered.slice(0, 150);

    for (const m of slice) {
      const pId = m.providerId === "nutaan" ? "" : (m.providerId || "");
      const healthKey = modelHealthKey(pId, m.id);
      const health = (settings.modelHealth || {})[healthKey];
      const statusHtml = health
        ? (health.ok
            ? `<span class="model-status-chip ok">✓ OK</span>`
            : `<span class="model-status-chip fail" title="${escapeHtml(health.error || '')}">✗ Failed</span>`)
        : `<span class="model-status-chip untested">— Untested</span>`;

      const isActive = m.id === settings.model && (pId === (settings.modelProviderId || ""));
      const isFreePool = m.tier === "free" || (m.id && m.id.includes(":free"));

      const tr = document.createElement("tr");
      tr.className = isActive ? "model-row active-model" : "model-row";
      tr.innerHTML = `
        <td class="model-id-cell">
          <b>${escapeHtml(m.name || m.id)}</b>${isFreePool ? ' <span class="free-pool-badge">Free tier</span>' : ''}
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono);margin-top:2px;">${escapeHtml(m.id)}</div>
        </td>
        <td>
          <div class="provider-logo-cell">
            <img class="provider-logo-img" src="${getProviderLogo(m.providerType || m.id)}" alt="" />
            <span>${escapeHtml(m.providerName || "Nutaan")}</span>
          </div>
        </td>
        <td>
          <span class="context-badge">${escapeHtml(m.context_window || "—")}</span>
          ${m.speed ? `<span class="speed-badge">${escapeHtml(m.speed)}</span>` : ""}
        </td>
        <td>${statusHtml}</td>
        <td>
          <button type="button" class="model-select-btn${isActive ? " active" : ""}">
            ${isActive ? "Active" : "Use"}
          </button>
        </td>`;

      const btn = tr.querySelector(".model-select-btn");
      btn.addEventListener("click", async () => {
        await selectModel(m.id, pId);
        renderModelTable();
      });
      tbody.appendChild(tr);
    }
  }

  el("refreshModelsBtn")?.addEventListener("click", async () => {
    const btn = el("refreshModelsBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Refreshing…"; }
    await refreshModels();
    await loadOmniRouteCatalog(true);
    renderModelTable();
    if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
  });

  el("autoFallbackToggle")?.addEventListener("change", async (e) => {
    settings.autoModelFallback = e.target.checked;
    await window.nutaan.setSettings(settings);
  });

  let _abBusy = false;
  async function renderAgentBridgeTab() {
    const statusDotEl = el("abStatusDot");
    const statusTextEl = el("abStatusText");
    const startBtn = el("abStartBtn");
    const stopBtn = el("abStopBtn");
    const certChip = el("abCertChip");
    const dnsChip = el("abDnsChip");
    const agentsEl = el("abAgents");

    let status = { running: false };
    if (window.nutaan && window.nutaan.mitm) {
      try { status = await window.nutaan.mitm.status(); } catch {}
    }

    if (statusDotEl) statusDotEl.className = "ab-status-dot" + (status.running ? " running" : "");
    if (statusTextEl) statusTextEl.textContent = status.running ? `Running (PID ${status.pid || "?"})` : "Stopped";
    if (startBtn) startBtn.hidden = !!status.running;
    if (stopBtn) stopBtn.hidden = !status.running;

    if (certChip) {
      certChip.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"/></svg> Root CA: ${status.certTrusted ? "✓ Trusted" : status.certExists ? "⚠ Not trusted" : "✗ Missing"}`;
    }
    if (dnsChip) {
      dnsChip.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M3.4 9.5h17.2M3.4 14.5h17.2M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg> DNS: ${status.dnsConfigured ? "✓ Configured" : "✗ Not configured"}`;
    }

    if (agentsEl && window.nutaan && window.nutaan.mitm) {
      try {
        const detected = await window.nutaan.mitm.detectAgents();
        const targets = [
          { key: "antigravity", name: "Antigravity IDE", detail: detected.antigravity },
          { key: "kiro", name: "Kiro IDE", detail: detected.kiro },
        ];
        agentsEl.innerHTML = "";
        for (const t of targets) {
          const row = document.createElement("div");
          row.className = "ab-agent-row";
          const isInstalled = t.detail && t.detail.installed;
          const dot = isInstalled ? "🟢" : "⚫";
          const installText = isInstalled
            ? `<span class="ab-agent-path" title="${escapeHtml(t.detail.path || '')}">Installed</span>`
            : `<span class="ab-agent-path not-found">Not detected</span>`;

          const ab = settings.agentBridge || {};
          const modelKey = t.key + "Model";
          const mapped = ab[modelKey] || settings.model || "";
          const options = (aggregatedModels || []).slice(0, 40).map((m) =>
            `<option value="${escapeHtml(m.id)}"${m.id === mapped ? " selected" : ""}>${escapeHtml(m.id)}</option>`
          ).join("");

          row.innerHTML = `
            <div class="ab-agent-info">
              <span class="ab-agent-dot">${dot}</span>
              <span class="ab-agent-name">${escapeHtml(t.name)}</span>
              ${installText}
            </div>
            <div class="ab-agent-model">
              <label style="font-size:12px;color:#6b7280;">Route to</label>
              <select class="ab-model-select" data-agent="${escapeHtml(t.key)}">
                ${options}
              </select>
            </div>`;
          agentsEl.appendChild(row);

          row.querySelector("select")?.addEventListener("change", async (e) => {
            settings.agentBridge = settings.agentBridge || {};
            settings.agentBridge[modelKey] = e.target.value;
            await window.nutaan.setSettings(settings);
          });
        }
      } catch {}
    }
  }

  el("abStartBtn")?.addEventListener("click", async () => {
    if (_abBusy) return;
    _abBusy = true;
    const btn = el("abStartBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Starting…"; }
    const errEl = el("abError");
    if (errEl) errEl.hidden = true;
    try {
      const ab = settings.agentBridge || {};
      const agentMap = {
        antigravity: { model: ab.antigravityModel || settings.model || "" },
        kiro: { model: ab.kiroModel || settings.model || "" },
      };
      const res = await window.nutaan.mitm.start({ nutaanKey: settings.nutaanKey, agentMap });
      if (!res.ok && errEl) {
        errEl.textContent = res.error || "Could not start AgentBridge";
        errEl.hidden = false;
      }
      await renderAgentBridgeTab();
    } catch (err) {
      if (errEl) { errEl.textContent = String(err.message || err); errEl.hidden = false; }
    } finally {
      _abBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = "Start AgentBridge"; }
    }
  });

  el("abStopBtn")?.addEventListener("click", async () => {
    if (_abBusy) return;
    _abBusy = true;
    const btn = el("abStopBtn");
    if (btn) { btn.disabled = true; btn.textContent = "Stopping…"; }
    try {
      await window.nutaan.mitm.stop();
      await renderAgentBridgeTab();
    } catch {}
    finally {
      _abBusy = false;
      if (btn) { btn.disabled = false; btn.textContent = "Stop AgentBridge"; }
    }
  });


  // ---------- Tools (MCP servers, other coding agents, apps, signed-in web apps) ----------
  // Everything the panel shows comes from the main process's status(); the renderer never
  // decides what a tool is, only how a row looks. Live connection changes arrive on tools:status.
  let toolRows = [];
  let toolCustomTemplate = null;
  let toolEditing = null; // { id } for a catalogue tool's settings, or { custom: true } for a new server
  let toolOpen = null; // id whose detail strip is expanded

  async function refreshTools() {
    if (!window.nutaan.tools) return;
    try {
      const [rows, cat] = await Promise.all([window.nutaan.tools.status(), toolCustomTemplate ? null : window.nutaan.tools.catalog()]);
      if (cat) toolCustomTemplate = cat.custom;
      toolRows = rows || [];
    } catch (e) {
      toolRows = [];
    }
    renderTools();
  }

  if (window.nutaan.tools?.onStatus) {
    window.nutaan.tools.onStatus((rows) => {
      toolRows = rows || [];
      if (settingsOverlay && !settingsOverlay.hidden) renderTools();
    });
  }

  const TOOL_KIND_LABEL = { mcp: "MCP", cli: "Agent", app: "App", session: "Web" };

  function toolStateOf(t) {
    if (!t.enabled) return { cls: "", text: "off" };
    if (t.kind === "mcp") {
      if (t.connecting) return { cls: "busy", text: "connecting…" };
      if (t.connected) return { cls: "on", text: `${t.toolCount} tool${t.toolCount === 1 ? "" : "s"}` };
      if (t.needsAuth) return { cls: "err", text: "sign in needed" };
      if (t.error) return { cls: "err", text: "not connected" };
      return { cls: "", text: "off" };
    }
    return { cls: "on", text: "ready" };
  }

  function renderTools() {
    const list = el("toolList");
    if (!list) return;
    list.innerHTML = "";
    for (const t of toolRows) {
      const row = document.createElement("div");
      row.className = "provider-row tool-row" + (t.enabled ? "" : " disabled");

      const main = document.createElement("div"); main.className = "tool-main";
      // The icon sits on the same light tile the model-provider logos use, so a coloured mark reads
      // cleanly. The accent only fills in behind a letter when the image is missing.
      const logo = document.createElement("div"); logo.className = "provider-logo";
      const img = document.createElement("img"); img.src = "../assets/tools/" + t.icon; img.alt = "";
      img.addEventListener("error", () => { img.remove(); logo.style.background = t.accent || "#8b93a7"; logo.textContent = (t.name || "?").slice(0, 1).toUpperCase(); });
      logo.appendChild(img);
      main.appendChild(logo);

      const meta = document.createElement("div"); meta.className = "tool-meta";
      const name = document.createElement("span"); name.className = "provider-name"; name.textContent = t.name;
      const blurb = document.createElement("span"); blurb.className = "tool-blurb"; blurb.textContent = t.blurb || "";
      meta.appendChild(name); meta.appendChild(blurb);
      main.appendChild(meta);

      const kind = document.createElement("span"); kind.className = "tool-kind"; kind.textContent = TOOL_KIND_LABEL[t.kind] || t.kind;
      main.appendChild(kind);

      const st = toolStateOf(t);
      const state = document.createElement("span"); state.className = "tool-state " + st.cls; state.textContent = st.text;
      main.appendChild(state);

      const actions = document.createElement("div"); actions.className = "tool-actions";
      if (t.enabled && t.kind === "mcp" && t.needsOAuth) {
        const b = document.createElement("button"); b.type = "button"; b.className = "btn-secondary provider-connect";
        if (t.signedIn && t.connected) { b.textContent = "Sign out"; b.addEventListener("click", () => toolSignOut(t.id)); }
        else { b.textContent = t.signedIn ? "Reconnect" : "Sign in"; b.addEventListener("click", () => toolAuthorize(t.id, b)); }
        actions.appendChild(b);
      } else if (t.enabled && t.kind === "mcp" && t.error && !t.connecting) {
        const b = document.createElement("button"); b.type = "button"; b.className = "btn-secondary provider-connect"; b.textContent = "Retry";
        b.addEventListener("click", () => toolConnect(t.id, b)); actions.appendChild(b);
      }
      const hasSettings = (t.fields && t.fields.length) || (t.oauthFields && t.oauthFields.length) || t.custom;
      if (hasSettings) {
        const b = document.createElement("button"); b.type = "button"; b.className = "icon-btn tiny"; b.title = "Settings"; b.textContent = "⚙";
        b.addEventListener("click", () => openToolEditor(t.id)); actions.appendChild(b);
      }
      if (t.custom) {
        const rm = document.createElement("button"); rm.type = "button"; rm.className = "icon-btn tiny provider-remove"; rm.title = "Remove"; rm.textContent = "✕";
        rm.addEventListener("click", () => toolRemoveCustom(t.id)); actions.appendChild(rm);
      }
      main.appendChild(actions);

      const sw = document.createElement("span"); sw.className = "tool-switch" + (t.enabled ? " on" : ""); sw.title = t.enabled ? "Switch off" : "Switch on";
      sw.innerHTML = '<span class="switch-track"><span class="switch-knob"></span></span>';
      sw.addEventListener("click", () => toolSetEnabled(t.id, !t.enabled));
      main.appendChild(sw);

      main.addEventListener("click", (e) => {
        if (e.target.closest("button, .tool-switch")) return;
        toolOpen = toolOpen === t.id ? null : t.id;
        renderTools();
      });
      row.appendChild(main);

      if (toolOpen === t.id) {
        const d = document.createElement("div"); d.className = "tool-detail";
        const noteFor = (text, cls) => { const n = document.createElement("div"); n.className = "note" + (cls ? " " + cls : ""); n.textContent = text; d.appendChild(n); };
        if (t.error && t.enabled) noteFor(t.error, "err");
        if (t.noApi) noteFor(t.noApi);
        if (t.kind === "mcp" && t.connected && t.serverInfo) noteFor(`Connected to ${t.serverInfo.name || "server"}${t.serverInfo.version ? " " + t.serverInfo.version : ""}.`);
        if (t.kind === "mcp" && t.tools && t.tools.length) {
          const wrap = document.createElement("div"); wrap.className = "tool-tools";
          for (const tt of t.tools.slice(0, 40)) { const c = document.createElement("code"); c.textContent = tt.name; c.title = tt.description || ""; wrap.appendChild(c); }
          if (t.tools.length > 40) { const c = document.createElement("code"); c.textContent = `+${t.tools.length - 40} more`; wrap.appendChild(c); }
          d.appendChild(wrap);
        }
        if (t.kind === "cli") noteFor(`The agent gets a "${t.id.replace(/-/g, "_")}_task" tool: it hands over a task and reads the answer back.`);
        if (t.kind === "app") noteFor(`The agent gets a "${t.id.replace(/-/g, "_")}_open" tool to open the project, a folder or a file in it.`);
        if (t.kind === "session") noteFor("Driven in its own signed-in window. The first time, sign in there and the login is kept.");
        if (t.docs) {
          const a = document.createElement("a"); a.href = "#"; a.className = "note"; a.textContent = "Documentation ↗";
          a.addEventListener("click", (e) => { e.preventDefault(); window.nutaan.openExternal(t.docs); }); d.appendChild(a);
        }
        row.appendChild(d);
      }
      list.appendChild(row);
    }
  }

  async function toolSetEnabled(id, enabled) {
    try { toolRows = await window.nutaan.tools.setEnabled(id, enabled); } catch (e) { console.warn("tools:set-enabled failed", e); }
    renderTools();
  }
  async function toolConnect(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Connecting…"; }
    try { await window.nutaan.tools.connect(id); } catch (e) { console.warn("tools:connect failed", e); }
    await refreshTools();
  }
  async function toolAuthorize(id, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Waiting for sign-in…"; }
    try {
      const res = await window.nutaan.tools.authorize(id);
      if (res && res.status) toolRows = res.status;
      if (res && !res.ok) { toolOpen = id; const r = toolRows.find((x) => x.id === id); if (r) r.error = res.error; }
    } catch (e) { console.warn("tools:authorize failed", e); }
    renderTools();
  }
  async function toolSignOut(id) {
    try { toolRows = await window.nutaan.tools.signOut(id); } catch (e) { console.warn("tools:sign-out failed", e); }
    renderTools();
  }
  async function toolRemoveCustom(id) {
    try { toolRows = await window.nutaan.tools.removeCustom(id); } catch (e) { console.warn("tools:remove-custom failed", e); }
    if (toolOpen === id) toolOpen = null;
    renderTools();
  }

  // The editor is one form built from the catalogue's field list, so a new field on a tool never
  // needs a renderer change. keyvalue and list fields grow a row at a time.
  function teFieldRow(f, value) {
    const wrap = document.createElement("div"); wrap.className = "field"; wrap.dataset.key = f.key;
    if (f.when) wrap.dataset.when = JSON.stringify(f.when);
    const label = document.createElement("label"); label.textContent = f.label; wrap.appendChild(label);
    if (f.type === "select") {
      const s = document.createElement("select"); s.dataset.key = f.key;
      for (const o of f.options || []) { const op = document.createElement("option"); op.value = o.value; op.textContent = o.label; s.appendChild(op); }
      if (value != null) s.value = value;
      s.addEventListener("change", teApplyWhen);
      wrap.appendChild(s);
    } else if (f.type === "keyvalue" || f.type === "list") {
      const box = document.createElement("div"); box.dataset.key = f.key; box.dataset.type = f.type;
      const addRow = (k = "", v = "") => {
        const r = document.createElement("div"); r.className = f.type === "keyvalue" ? "te-kv-row" : "te-list-row";
        if (f.type === "keyvalue") { const ki = document.createElement("input"); ki.placeholder = "Name"; ki.value = k; ki.dataset.role = "k"; r.appendChild(ki); }
        const vi = document.createElement("input"); vi.placeholder = f.type === "keyvalue" ? "Value" : (f.placeholder || ""); vi.value = v; vi.dataset.role = "v"; r.appendChild(vi);
        const x = document.createElement("button"); x.type = "button"; x.className = "icon-btn tiny"; x.textContent = "✕"; x.addEventListener("click", () => r.remove()); r.appendChild(x);
        box.appendChild(r);
      };
      if (f.type === "keyvalue" && value && typeof value === "object") for (const [k, v] of Object.entries(value)) addRow(k, v);
      else if (f.type === "list" && Array.isArray(value)) for (const v of value) addRow("", v);
      const add = document.createElement("button"); add.type = "button"; add.className = "btn-secondary"; add.textContent = "+ Add"; add.addEventListener("click", () => addRow());
      wrap.appendChild(box); wrap.appendChild(add);
    } else {
      const i = document.createElement("input"); i.type = f.type === "password" ? "password" : f.type === "number" ? "number" : "text";
      i.dataset.key = f.key; i.placeholder = f.placeholder || ""; i.autocomplete = "off"; if (value != null) i.value = value;
      wrap.appendChild(i);
    }
    if (f.hint) { const h = document.createElement("div"); h.className = "note"; h.textContent = f.hint; wrap.appendChild(h); }
    return wrap;
  }

  function teApplyWhen() {
    const box = el("teFields"); if (!box) return;
    const current = {};
    box.querySelectorAll("select[data-key], input[data-key]").forEach((i) => { current[i.dataset.key] = i.value; });
    box.querySelectorAll(".field[data-when]").forEach((w) => {
      const cond = JSON.parse(w.dataset.when);
      w.hidden = !Object.entries(cond).every(([k, v]) => current[k] === v);
    });
  }

  function teCollect() {
    const box = el("teFields"); const out = {};
    box.querySelectorAll(".field").forEach((w) => {
      if (w.hidden) return;
      const key = w.dataset.key;
      const kv = w.querySelector("[data-type]");
      if (kv) {
        if (kv.dataset.type === "keyvalue") {
          const o = {}; kv.querySelectorAll(".te-kv-row").forEach((r) => { const k = r.querySelector("[data-role=k]").value.trim(); const v = r.querySelector("[data-role=v]").value; if (k) o[k] = v; });
          out[key] = o;
        } else {
          out[key] = [...kv.querySelectorAll(".te-list-row [data-role=v]")].map((i) => i.value.trim()).filter(Boolean);
        }
        return;
      }
      const i = w.querySelector("input[data-key], select[data-key]");
      if (!i) return;
      out[key] = i.type === "number" && i.value !== "" ? Number(i.value) : i.value;
    });
    return out;
  }

  function openToolEditor(id) {
    const editor = el("toolEditor"); const box = el("teFields"); if (!editor || !box) return;
    box.innerHTML = ""; el("teError").hidden = true;
    if (id) {
      const t = toolRows.find((x) => x.id === id); if (!t) return;
      toolEditing = { id };
      el("teTitle").textContent = t.name + " settings";
      const fields = t.custom && toolCustomTemplate ? toolCustomTemplate.fields : (t.fields || []);
      for (const f of fields) box.appendChild(teFieldRow(f, t.config?.[f.key]));
      if (t.oauthFields && t.oauthFields.length) {
        const n = document.createElement("div"); n.className = "note"; n.textContent = t.oauthNote || "API access (optional)"; n.style.marginTop = "10px"; box.appendChild(n);
        for (const f of t.oauthFields) box.appendChild(teFieldRow(f, t.config?.[f.key]));
      }
      if (!fields.length && !(t.oauthFields || []).length) { const n = document.createElement("div"); n.className = "note"; n.textContent = "Nothing to configure."; box.appendChild(n); }
    } else {
      if (!toolCustomTemplate) return;
      toolEditing = { custom: true };
      el("teTitle").textContent = toolCustomTemplate.name;
      for (const f of toolCustomTemplate.fields) box.appendChild(teFieldRow(f, f.key === "transport" ? "http" : undefined));
    }
    teApplyWhen();
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  function closeToolEditor() { const e = el("toolEditor"); if (e) e.hidden = true; toolEditing = null; }

  async function saveToolEditor() {
    if (!toolEditing) return;
    const cfg = teCollect(); const err = el("teError");
    try {
      if (toolEditing.custom) {
        if (cfg.transport === "http" && !cfg.url) throw new Error("A server URL is needed.");
        if (cfg.transport === "stdio" && !cfg.command) throw new Error("A command is needed.");
        toolRows = await window.nutaan.tools.addCustom(cfg);
      } else {
        toolRows = await window.nutaan.tools.saveConfig(toolEditing.id, cfg);
      }
      closeToolEditor(); renderTools();
    } catch (e) { err.textContent = e.message || String(e); err.hidden = false; }
  }

  el("addToolBtn")?.addEventListener("click", () => openToolEditor(null));
  el("teClose")?.addEventListener("click", closeToolEditor);
  el("teCancel")?.addEventListener("click", closeToolEditor);
  el("teSave")?.addEventListener("click", saveToolEditor);

  function fmtNum(n) {
    n = n || 0;
    if (n >= 1e9) return (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return (n / 1e6).toFixed(2) + "M";
    if (n >= 1e3) return (n / 1e3).toFixed(1) + "k";
    return String(Math.round(n));
  }

  function renderUsagePanel() {
    const inT = settings.usageInTokens || 0;
    const outT = settings.usageOutTokens || 0;
    const set = (id, v) => { const e = el(id); if (e) e.textContent = v; };
    set("usageTotal", fmtNum(inT + outT));
    set("usageIn", fmtNum(inT));
    set("usageOut", fmtNum(outT));
    set("usageReq", fmtNum(settings.usageRequests || 0));
  }

  // User-managed provider presets. Any OpenAI-compatible endpoint works; "custom" covers the rest.
  const PROVIDER_PRESETS = [
    { type: "cerebras", name: "Cerebras (2000 tps Free)", baseUrl: "https://api.cerebras.ai/v1", color: "#f54734", mark: "Cb" },
    { type: "sambanova", name: "SambaNova (DeepSeek-R1 Free)", baseUrl: "https://api.sambanova.ai/v1", color: "#f97316", mark: "SN" },
    { type: "groq", name: "Groq (Free Tier)", baseUrl: "https://api.groq.com/openai/v1", color: "#f55036", mark: "gq" },
    { type: "google", name: "Google Gemini (Free Tier)", baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", color: "#4285f4", mark: "G" },
    { type: "openrouter", name: "OpenRouter (Free + Paid)", baseUrl: "https://openrouter.ai/api/v1", color: "#6467f2", mark: "OR" },
    { type: "agentrouter", name: "AgentRouter", baseUrl: "https://agentrouter.org/v1", color: "#7c3aed", mark: "AR" },
    { type: "deepseek", name: "DeepSeek (Official)", baseUrl: "https://api.deepseek.com/v1", color: "#4d6bfe", mark: "DS" },
    { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", color: "#10a37f", mark: "AI" },
    { type: "azure", name: "Azure OpenAI", baseUrl: "https://YOUR-RESOURCE.openai.azure.com", color: "#0078d4", mark: "Az" },
    { type: "bedrock", name: "AWS Bedrock", baseUrl: "https://bedrock-runtime.us-east-1.amazonaws.com", color: "#ff9900", mark: "BR" },
    { type: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", color: "#d97757", mark: "A" },
    { type: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", color: "#0f6fff", mark: "T" },
    { type: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", color: "#fa5310", mark: "M" },
    { type: "ollama", name: "Ollama (Local Offline)", baseUrl: "http://127.0.0.1:11434/v1", color: "#1e293b", mark: "OL" },
    { type: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", color: "#76b900", mark: "NV" },
    { type: "xai", name: "xAI (Grok)", baseUrl: "https://api.x.ai/v1", color: "#111827", mark: "x" },
    { type: "custom", name: "Custom (OpenAI-compatible)", baseUrl: "", color: "#6b7280", mark: "•" },
  ];
  const presetFor = (type) => PROVIDER_PRESETS.find((p) => p.type === type) || PROVIDER_PRESETS.find((p) => p.type === "custom");

  function providerLogoEl(type, mark, color) {
    const logo = document.createElement("span");
    logo.className = "provider-logo";
    const img = document.createElement("img");
    img.src = getProviderLogo(type);
    img.alt = "";
    img.onerror = () => { logo.textContent = mark || "•"; logo.style.background = color || "#6b7280"; logo.style.color = "#fff"; };
    logo.appendChild(img);
    return logo;
  }

  function renderProviders() {
    const list = el("providerList");
    if (!list) return;
    const hasNutaan = !!(settings.nutaanKey && settings.nutaanKey.trim());
    list.innerHTML = "";

    // Managed Nutaan row (active when no user-managed model is selected).
    {
      const active = !settings.modelProviderId;
      const row = document.createElement("div");
      row.className = "provider-row" + (active ? " active" : "");
      row.appendChild(providerLogoEl("nutaan", "N", "#a855f7"));
      const name = document.createElement("span"); name.className = "provider-name"; name.textContent = "Nutaan (managed)";
      const sp = document.createElement("span"); sp.className = "settings-spacer";
      row.appendChild(name); row.appendChild(sp);
      const badge = document.createElement("span"); badge.className = "provider-badge managed"; badge.textContent = "Nutaan-managed";
      row.appendChild(badge);
      if (active) { const a = document.createElement("span"); a.className = "provider-active"; a.textContent = "active"; row.appendChild(a); }
      list.appendChild(row);
    }

    // Configured user-managed providers.
    for (const p of settings.customProviders || []) {
      const preset = presetFor(p.type);
      const row = document.createElement("div"); row.className = "provider-row";
      row.appendChild(providerLogoEl(p.type, preset.mark, preset.color));
      const name = document.createElement("span"); name.className = "provider-name"; name.textContent = p.name || preset.name;
      const sp = document.createElement("span"); sp.className = "settings-spacer";
      row.appendChild(name); row.appendChild(sp);
      const n = (p.models || []).length;
      const cnt = document.createElement("span"); cnt.className = "provider-badge managed"; cnt.textContent = n + " model" + (n === 1 ? "" : "s");
      row.appendChild(cnt);
      const edit = document.createElement("button"); edit.type = "button"; edit.className = "btn-secondary provider-connect"; edit.textContent = "Edit";
      edit.addEventListener("click", () => openProviderEditor(p.id)); row.appendChild(edit);
      const rm = document.createElement("button"); rm.type = "button"; rm.className = "icon-btn tiny provider-remove"; rm.title = "Remove"; rm.textContent = "✕";
      rm.addEventListener("click", () => removeProvider(p.id)); row.appendChild(rm);
      list.appendChild(row);
    }

    const gate = el("byoGateNote");
    if (gate) gate.textContent = "Connect your own provider key or local server.";
    const addBtn = el("addProviderBtn");
    if (addBtn) addBtn.disabled = false;
  }

  // ---------- Provider editor (add / edit a user-managed provider with its own key + models) ----------
  let editingProviderId = null;
  let editorModels = [];

  function openProviderEditor(id) {
    const editor = el("providerEditor");
    if (!editor) return;
    const sel = el("peType");
    sel.innerHTML = "";
    for (const p of PROVIDER_PRESETS) { const o = document.createElement("option"); o.value = p.type; o.textContent = p.name; sel.appendChild(o); }
    if (id) {
      const p = (settings.customProviders || []).find((x) => x.id === id);
      editingProviderId = id;
      el("peTitle").textContent = "Edit provider";
      sel.value = p.type || "custom";
      el("peName").value = p.name || "";
      el("peBaseUrl").value = p.baseUrl || "";
      el("peKey").value = p.apiKey || "";
      editorModels = [...(p.models || [])];
    } else {
      editingProviderId = null;
      el("peTitle").textContent = "Add provider";
      const preset = presetFor(sel.value);
      el("peName").value = preset.name; el("peBaseUrl").value = preset.baseUrl; el("peKey").value = ""; editorModels = [];
    }
    const lg = el("peTypeLogo"); if (lg) { lg.onerror = () => { lg.onerror = null; lg.src = "providers/nutaan.png"; }; lg.src = getProviderLogo(el("peType").value || "openai"); }
    renderEditorModels();
    editor.hidden = false;
    editor.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function renderEditorModels() {
    const box = el("peModelList");
    box.innerHTML = "";
    if (!editorModels.length) { box.innerHTML = `<span class="byo-sub">No models yet — add at least one id.</span>`; return; }
    editorModels.forEach((m, i) => {
      const chip = document.createElement("span"); chip.className = "model-chip";
      const label = document.createElement("span"); label.textContent = m; chip.appendChild(label);
      const x = document.createElement("button"); x.type = "button"; x.textContent = "✕";
      x.addEventListener("click", () => { editorModels.splice(i, 1); renderEditorModels(); });
      chip.appendChild(x); box.appendChild(chip);
    });
  }

  function addEditorModel() {
    const inp = el("peModelInput");
    const v = (inp.value || "").trim();
    if (!v) return;
    // support pasting several ids (comma/space/newline separated)
    for (const id of v.split(/[\s,]+/).filter(Boolean)) { if (!editorModels.includes(id)) editorModels.push(id); }
    inp.value = "";
    renderEditorModels();
  }

  let _fetchingModels = false;
  // Auto-detect which models a provider actually exposes — the user only pastes
  // a base URL + API key, we call its /models endpoint and fill the list.
  async function fetchProviderModels(opts = {}) {
    const baseUrl = (el("peBaseUrl").value || "").trim();
    const apiKey = (el("peKey").value || "").trim();
    if (!baseUrl || _fetchingModels) return;
    if (opts.requireKey && !apiKey) return;
    if (!window.nutaan || !window.nutaan.providerListModels) return;
    _fetchingModels = true;
    const inp = el("peModelInput");
    const prevPlaceholder = inp ? inp.placeholder : "";
    if (inp) { inp.placeholder = "Checking available models…"; }
    try {
      const provType = (el("peType") && el("peType").value) || "";
      const res = await window.nutaan.providerListModels(baseUrl, apiKey, provType);
      const ids = (res && res.ok && Array.isArray(res.models)) ? res.models : [];
      if (ids.length) {
        let added = 0;
        for (const id of ids) { if (id && !editorModels.includes(id)) { editorModels.push(id); added++; } }
        renderEditorModels();
        if (inp) { inp.placeholder = added ? `Found ${ids.length} models — ${added} added` : `${ids.length} models available`; }
      } else if (inp) {
        inp.placeholder = (res && res.error) ? `Couldn't list models: ${res.error}` : "No models returned — add ids manually";
      }
    } catch (e) {
      if (inp) inp.placeholder = "Couldn't reach /models — add ids manually";
    } finally {
      _fetchingModels = false;
      if (inp) setTimeout(() => { if (inp) inp.placeholder = prevPlaceholder; }, 4000);
    }
  }

  function saveProviderEditor() {
    const type = el("peType").value;
    const baseUrl = (el("peBaseUrl").value || "").trim();
    const apiKey = (el("peKey").value || "").trim();
    const name = (el("peName").value || "").trim() || presetFor(type).name;
    if (!baseUrl) { el("peBaseUrl").focus(); return; }
    if (!editorModels.length) { el("peModelInput").focus(); return; }
    settings.customProviders = settings.customProviders || [];
    if (editingProviderId) {
      const p = settings.customProviders.find((x) => x.id === editingProviderId);
      if (p) { p.type = type; p.name = name; p.baseUrl = baseUrl; p.apiKey = apiKey; p.models = [...editorModels]; }
    } else {
      settings.customProviders.push({ id: "prov_" + Date.now().toString(36), type, name, baseUrl, apiKey, models: [...editorModels] });
    }
    window.nutaan.setSettings(settings);
    el("providerEditor").hidden = true;
    renderProviders();
    rebuildModels();
  }

  function removeProvider(id) {
    settings.customProviders = (settings.customProviders || []).filter((p) => p.id !== id);
    if (settings.modelProviderId === id) { settings.modelProviderId = ""; }
    window.nutaan.setSettings(settings);
    renderProviders();
    rebuildModels();
  }

  (function wireProviderEditor() {
    el("addProviderBtn")?.addEventListener("click", () => openProviderEditor(null));
    el("peClose")?.addEventListener("click", () => { el("providerEditor").hidden = true; });
    el("peCancel")?.addEventListener("click", () => { el("providerEditor").hidden = true; });
    el("peSave")?.addEventListener("click", saveProviderEditor);
    el("peModelAdd")?.addEventListener("click", addEditorModel);
    el("peDetectModels")?.addEventListener("click", async () => {
      const btn = el("peDetectModels");
      const baseUrl = (el("peBaseUrl").value || "").trim();
      if (!baseUrl) { el("peBaseUrl").focus(); return; }
      btn.disabled = true; const prev = btn.textContent; btn.textContent = "Detecting…";
      try { await fetchProviderModels({ force: true }); }
      finally { btn.disabled = false; btn.textContent = prev; }
    });
    el("peModelInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addEditorModel(); } });
    // Auto-check available models once the user finishes entering the API key
    // (or the base URL), so they never have to type model ids by hand.
    el("peKey")?.addEventListener("blur", () => fetchProviderModels());
    el("peKey")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); fetchProviderModels(); } });
    el("peBaseUrl")?.addEventListener("blur", () => fetchProviderModels({ requireKey: true }));
    el("peType")?.addEventListener("change", () => {
      const preset = presetFor(el("peType").value);
      el("peName").value = preset.name;
      el("peBaseUrl").value = preset.baseUrl;
      const lg = el("peTypeLogo"); if (lg) { lg.onerror = () => { lg.onerror = null; lg.src = "providers/nutaan.png"; }; lg.src = getProviderLogo(preset.type); }
    });
  })();

  el("useBuiltInBtn").addEventListener("click", async () => {
    baseUrlInput.value = "";
    apiKeyInput.value = "";
    settings.baseUrl = "";
    settings.apiKey = "";
    settings.model = "";
    await window.nutaan.setSettings(settings);
    await refreshModels();
  });

  settingsBtn.addEventListener("click", () => openSettings());
  settingsCancel.addEventListener("click", () => { settingsOverlay.hidden = true; });
  el("settingsCloseX")?.addEventListener("click", () => { settingsOverlay.hidden = true; });
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.hidden = true;
  });
  el("useBuiltInBtnAdv")?.addEventListener("click", async () => {
    if (baseUrlInput) baseUrlInput.value = "";
    if (apiKeyInput) apiKeyInput.value = "";
    const advBase = el("advBaseUrl");
    const advKey = el("advApiKey");
    if (advBase) advBase.value = "";
    if (advKey) advKey.value = "";
    settings.baseUrl = "";
    settings.apiKey = "";
    await window.nutaan.setSettings(settings);
    await refreshModels();
  });
  settingsSave.addEventListener("click", async () => {
    const advBase = el("advBaseUrl");
    const advKey = el("advApiKey");
    settings.baseUrl = (advBase ? advBase.value : (baseUrlInput ? baseUrlInput.value : "")).trim();
    settings.apiKey = (advKey ? advKey.value : (apiKeyInput ? apiKeyInput.value : "")).trim();
    const sel = modelSelectSettings ? (modelSelectSettings.value || "") : "";
    if (sel.includes("::")) {
      const i = sel.indexOf("::");
      settings.modelProviderId = sel.slice(0, i);
      settings.model = sel.slice(i + 2) || settings.model;
    }
    if (imageModelInput) settings.imageModel = imageModelInput.value.trim();
    await window.nutaan.setSettings(settings);
    settingsOverlay.hidden = true;
    updateModelBadge();
    refreshModels();
  });

  sidebarToggleBtn.addEventListener("click", async () => {
    settings.sidebarCollapsed = appEl.classList.toggle("sidebar-collapsed");
    await window.nutaan.setSettings(settings);
  });

  statusText.addEventListener("click", () => {
    if (!settings.nutaanKey) showActivation("");
    else if (statusText.title) appendBubble("error", "Can't reach the model server: " + statusText.title);
  });

  document.addEventListener("click", () => closeAllMenus());

  if (checkUpdatesBtn) {
    checkUpdatesBtn.addEventListener("click", async () => {
      if (updateButtonOpensReleases) {
        await window.nutaan.openReleases?.();
        return;
      }
      checkUpdatesBtn.disabled = true;
      checkUpdatesBtn.textContent = "Checking…";
      const res = await window.nutaan.checkForUpdates();
      if (!res.ok) {
        updateButtonOpensReleases = Boolean(res.releasesUrl);
        checkUpdatesBtn.textContent = updateButtonOpensReleases ? "Open releases" : "Check for updates";
        checkUpdatesBtn.disabled = false;
        appVersionText.textContent = String(res.message || "Could not check for updates.").slice(0, 160);
      }
    });
  }
  if (window.nutaan.onUpdateStatus) {
    window.nutaan.onUpdateStatus((data) => {
      if (data.status === "checking") {
        updateButtonOpensReleases = false;
        checkUpdatesBtn.textContent = "Checking…";
        checkUpdatesBtn.disabled = true;
      } else if (data.status === "available") {
        checkUpdatesBtn.textContent = "Downloading update…";
      } else if (data.status === "downloaded") {
        checkUpdatesBtn.textContent = "Restart to update";
      } else if (data.status === "not-available") {
        updateButtonOpensReleases = false;
        checkUpdatesBtn.textContent = "You're up to date";
        checkUpdatesBtn.disabled = false;
        setTimeout(() => { checkUpdatesBtn.textContent = "Check for updates"; }, 3000);
      } else if (data.status === "unsupported") {
        updateButtonOpensReleases = true;
        checkUpdatesBtn.textContent = "Open releases";
        checkUpdatesBtn.disabled = false;
        appVersionText.textContent = String(data.message || "Install the latest package from Releases.").slice(0, 160);
      } else if (data.status === "error") {
        updateButtonOpensReleases = Boolean(data.releasesUrl);
        checkUpdatesBtn.textContent = updateButtonOpensReleases ? "Open releases" : "Check for updates";
        checkUpdatesBtn.disabled = false;
        if (data.message) appVersionText.textContent = String(data.message).slice(0, 160);
      }
    });
  }

  // ---------- Init ----------
  // =====================================================================================
  // Autonomous layer — Workers (scheduled jobs + Updates feed), Self-Healing Workspace,
  // Nutaan Swarm (Outcome mode), and Today (what this project needs, from the repo itself).
  // =====================================================================================
  const workersPage = el("workersPage");
  const healthPage = el("healthPage");
  const studioPage = el("studioPage");
  const designPage = el("designPage");
  const composerWrap = document.querySelector(".composer-wrap");
  const todaySection = el("todaySection");
  const todayGrid = el("todayGrid");
  const outcomeChips = el("outcomeChips");
  const emptyTitle = el("emptyTitle");
  const emptySub = el("emptySub");
  const modeToggle = el("modeToggle");

  function relTime(ts) {
    if (!ts) return "";
    const stamp = typeof ts === "number" ? ts : new Date(ts).getTime();
    if (!Number.isFinite(stamp)) return "";
    const m = Math.round((Date.now() - stamp) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return d === 1 ? "yesterday" : `${d}d ago`;
  }
  function untilTime(ts) {
    if (!ts) return "";
    const m = Math.round((ts - Date.now()) / 60000);
    if (m <= 0) return "due now";
    if (m < 60) return `in ${m} min`;
    const h = Math.round(m / 60);
    if (h < 24) return `in ${h}h`;
    return new Date(ts).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });
  }
  function clockTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }

  // Pages replace the thread while Workers / Health is selected in the sidebar. The composer
  // stays, so the user can still talk to the agent from either page.
  function renderPages() {
    const showWorkers = sidebarView === "workers";
    const showHealth = sidebarView === "health";
    // The Studio is a full-bleed editor rather than a page above the composer — a timeline and a
    // chat box fighting for the same bottom strip helps nobody.
    const showStudio = sidebarView === "studio";
    const showDesign = sidebarView === "design";
    workersPage.hidden = !showWorkers;
    healthPage.hidden = !showHealth;
    if (studioPage) studioPage.hidden = !showStudio;
    if (designPage) designPage.hidden = !showDesign;
    // Both are full-bleed workspaces: a canvas or a timeline has no room left beside the composer.
    if (composerWrap) composerWrap.hidden = showStudio || showDesign;
    threadScroll.hidden = showWorkers || showHealth || showStudio || showDesign;
    if (chatRail) chatRail.hidden = threadScroll.hidden; // the rail belongs to the thread, not the page behind it
    if (showWorkers) renderWorkersPage();
    if (showHealth) {
      renderHealthPage();
      if (window.NutaanMonitor) window.NutaanMonitor.onShowHealth();
    }
    // The Studio is a full-bleed editor — a stage, an inspector and a timeline do not fit beside
    // the code/browser panel. Fold the panel away while it is open and put it back on the way out,
    // exactly as the user left it.
    if ((showStudio || showDesign) && !panel.hidden) {
      studioFoldedPanel = true;
      panel.hidden = true;
      resizer.hidden = true;
    } else if (!showStudio && !showDesign && studioFoldedPanel) {
      studioFoldedPanel = false;
      panel.hidden = false;
      resizer.hidden = false;
    }
    if (window.NutaanStudio) {
      if (showStudio) window.NutaanStudio.onShow();
      else window.NutaanStudio.onHide();
    }
    if (window.NutaanDesign) {
      if (showDesign) window.NutaanDesign.onShow();
      else window.NutaanDesign.onHide();
    }
  }
  let studioFoldedPanel = false;

  // ---------- Workers ----------
  async function loadWorkers() {
    try {
      const [w, u] = await Promise.all([window.nutaan.workers.list(), window.nutaan.workers.updates(100)]);
      autonomous.workers = w.workers || [];
      autonomous.templates = w.templates || [];
      autonomous.updates = u.updates || [];
      autonomous.unread = u.unread || 0;
    } catch (e) {
      console.warn("workers load failed", e);
    }
    renderNav();
    if (sidebarView === "workers") { renderWorkersPage(); renderWorkersSidebar(); }
  }

  function workerStatusChip(w) {
    if (w.isRunning) return `<span class="wk-chip running"><span class="wk-spark"></span>running</span>`;
    if (!w.enabled) return `<span class="wk-chip off">paused</span>`;
    if (w.lastStatus === "error") return `<span class="wk-chip err">last run failed</span>`;
    return `<span class="wk-chip">${escapeHtml(w.nextRunAt ? untilTime(w.nextRunAt) : w.scheduleText)}</span>`;
  }

  function renderWorkersPage() {
    const list = el("workerList");
    const count = el("workerCount");
    count.textContent = autonomous.workers.length ? String(autonomous.workers.length) : "";
    list.innerHTML = "";
    if (!autonomous.workers.length) {
      list.innerHTML = `<div class="page-empty">No workers yet. Pick a template below, or just tell the agent: <em>"every morning at 8, check whether any new RERA project was registered"</em>.</div>`;
    }
    for (const w of autonomous.workers) {
      const row = document.createElement("div");
      row.className = "worker-row" + (w.enabled ? "" : " off");
      row.innerHTML =
        `<span class="wk-icon">${escapeHtml(w.icon || "🤖")}</span>` +
        `<div class="wk-main"><div class="wk-name">${escapeHtml(w.name)}</div>` +
        `<div class="wk-meta">${escapeHtml(w.scheduleText)}${w.root ? ` · ${escapeHtml(basename(w.root))}` : ""}${w.readOnly ? "" : " · can edit"}</div>` +
        (w.lastHeadline ? `<div class="wk-last">${escapeHtml(w.lastHeadline)}<span class="wk-when"> · ${escapeHtml(relTime(w.lastRunAt))}</span></div>` : "") +
        `</div>` +
        `<div class="wk-side">${workerStatusChip(w)}` +
        `<div class="wk-actions">` +
        `<button class="icon-btn tiny" data-act="run" title="${w.isRunning ? "Stop" : "Run now"}">${w.isRunning
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 5l12 7-12 7z"/></svg>'}</button>` +
        `<button class="icon-btn tiny" data-act="toggle" title="${w.enabled ? "Pause" : "Resume"}">${w.enabled
          ? '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>'
          : '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4.5V10h-5.4"/></svg>'}</button>` +
        `<button class="icon-btn tiny" data-act="edit" title="Edit"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/></svg></button>` +
        `</div></div>`;
      row.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) { openWorkerModal(w); return; }
        e.stopPropagation();
        const act = btn.dataset.act;
        if (act === "run") { if (w.isRunning) await window.nutaan.workers.stop(w.id); else await window.nutaan.workers.runNow(w.id); }
        if (act === "toggle") await window.nutaan.workers.update(w.id, { enabled: !w.enabled });
        if (act === "edit") openWorkerModal(w);
        loadWorkers();
      });
      list.appendChild(row);
    }

    const tpl = el("workerTemplates");
    tpl.innerHTML = "";
    for (const t of autonomous.templates) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "template-card";
      card.innerHTML = `<span class="tpl-icon">${escapeHtml(t.icon)}</span><span class="tpl-name">${escapeHtml(t.name)}</span><span class="tpl-when">${escapeHtml(describeScheduleClient(t.schedule))}</span>`;
      card.addEventListener("click", () => openWorkerModal({ ...t, id: null, root: t.needsProject ? activePath : null }));
      tpl.appendChild(card);
    }
    renderUpdates();
  }

  function describeScheduleClient(s) {
    if (!s) return "";
    if (s.type === "interval") return s.everyMinutes % 60 === 0 ? `every ${s.everyMinutes / 60}h` : `every ${s.everyMinutes} min`;
    if (s.type === "daily") {
      const d = s.days || [];
      const when = !d.length ? "daily" : d.length === 5 && !d.includes(0) && !d.includes(6) ? "weekdays" : d.length === 6 && !d.includes(0) ? "Mon–Sat" : `${d.length} days/wk`;
      return `${when} · ${s.time}`;
    }
    if (s.type === "project-open") return "on project open";
    if (s.type === "app-start") return "on app start";
    if (s.type === "once") return "once";
    return "";
  }

  function renderUpdates() {
    const feed = el("updateFeed");
    const count = el("updateCount");
    count.textContent = autonomous.unread ? `${autonomous.unread} new` : "";
    feed.innerHTML = "";
    if (!autonomous.updates.length) {
      feed.innerHTML =
        `<div class="updates-empty">` +
        `<div class="ue-icon"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg></div>` +
        `<div class="ue-title">No updates yet</div>` +
        `<div class="ue-sub">When a worker runs, its report lands here — the headline first, then the facts and the sources it used. You'll get a desktop notification too.</div>` +
        `</div>`;
      return;
    }
    let lastDay = "";
    for (const u of autonomous.updates) {
      const day = new Date(u.at).toDateString();
      if (day !== lastDay) {
        lastDay = day;
        const h = document.createElement("div");
        h.className = "feed-day";
        h.textContent = day === new Date().toDateString() ? "Today" : day === new Date(Date.now() - 86400000).toDateString() ? "Yesterday" : new Date(u.at).toLocaleDateString([], { weekday: "long", day: "numeric", month: "short" });
        feed.appendChild(h);
      }
      const card = document.createElement("div");
      card.className = "update-card" + (u.unread ? " unread" : "") + (u.status === "error" ? " err" : "");
      card.innerHTML =
        `<div class="up-head"><span class="up-icon">${escapeHtml(u.icon || "🤖")}</span>` +
        `<span class="up-worker">${escapeHtml(u.workerName)}</span>` +
        `<span class="up-time">${escapeHtml(clockTime(u.at))}${u.durationMs ? ` · ${Math.round(u.durationMs / 1000)}s` : ""}</span>` +
        `<span class="up-chev">▸</span></div>` +
        `<div class="up-headline">${escapeHtml(u.headline)}</div>` +
        `<div class="up-body" hidden>${renderMarkdownLite(u.body || "")}` +
        (u.toolsUsed?.length ? `<div class="up-tools">${u.toolsUsed.slice(0, 12).map((t) => `<span>${escapeHtml(t.tool)}${t.args ? `: ${escapeHtml(String(t.args).slice(0, 40))}` : ""}</span>`).join("")}</div>` : "") +
        `<div class="up-actions"><button class="link-btn" data-act="ask">Ask about this</button></div></div>`;
      card.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (btn?.dataset.act === "ask") {
          e.stopPropagation();
          sidebarView = "chats";
          renderNav(); renderExplorer();
          input.value = `About the "${u.workerName}" update from ${clockTime(u.at)} ("${u.headline}"): `;
          input.focus();
          autoGrowInput();
          return;
        }
        const body = card.querySelector(".up-body");
        body.hidden = !body.hidden;
        card.querySelector(".up-chev").textContent = body.hidden ? "▸" : "▾";
        if (u.unread) {
          u.unread = false;
          card.classList.remove("unread");
          autonomous.unread = Math.max(0, autonomous.unread - 1);
          count.textContent = autonomous.unread ? `${autonomous.unread} new` : "";
          renderNav();
          window.nutaan.workers.markRead([u.id]);
        }
      });
      feed.appendChild(card);
    }
  }

  function renderWorkersSidebar() {
    chatsView.innerHTML = "";
    const box = document.createElement("div");
    box.className = "side-list";
    if (!autonomous.workers.length) {
      box.innerHTML = `<div class="side-empty">No workers yet</div>`;
    }
    for (const w of autonomous.workers) {
      const row = document.createElement("div");
      row.className = "side-row" + (w.enabled ? "" : " off");
      row.innerHTML = `<span class="side-icon">${escapeHtml(w.icon || "🤖")}</span><span class="side-name">${escapeHtml(w.name)}</span><span class="side-meta">${w.isRunning ? "●" : escapeHtml(w.nextRunAt ? untilTime(w.nextRunAt) : "")}</span>`;
      row.addEventListener("click", () => openWorkerModal(w));
      box.appendChild(row);
    }
    const add = document.createElement("button");
    add.type = "button";
    add.className = "side-add";
    add.textContent = "+ New worker";
    add.addEventListener("click", () => openWorkerModal(null));
    box.appendChild(add);
    chatsView.appendChild(box);
  }

  // ---- worker modal ----
  const workerOverlay = el("workerOverlay");
  const wk = { icon: el("wkIcon"), name: el("wkName"), prompt: el("wkPrompt"), type: el("wkType"), time: el("wkTime"), every: el("wkEvery"), at: el("wkAt"), days: el("wkDays"), project: el("wkProject"), changes: el("wkChanges"), notify: el("wkNotify"), del: el("wkDelete") };
  let editingWorker = null;

  function syncWorkerFields() {
    const t = wk.type.value;
    el("wkTimeField").hidden = t !== "daily";
    el("wkDaysField").hidden = t !== "daily";
    el("wkEveryField").hidden = t !== "interval";
    el("wkAtField").hidden = t !== "once";
  }
  wk.type.addEventListener("change", syncWorkerFields);
  wk.days.addEventListener("click", (e) => {
    const b = e.target.closest("button[data-day]");
    if (b) b.classList.toggle("on");
  });

  function openWorkerModal(w) {
    editingWorker = w && w.id ? w : null;
    el("workerModalTitle").textContent = editingWorker ? "Edit worker" : "New worker";
    wk.icon.value = w?.icon || "🤖";
    wk.name.value = w?.name || "";
    wk.prompt.value = w?.prompt || "";
    const s = w?.schedule || { type: "daily", time: "07:30", days: [] };
    wk.type.value = s.type || "daily";
    wk.time.value = s.time || "07:30";
    wk.every.value = s.everyMinutes || 60;
    wk.at.value = s.at ? new Date(s.at).toISOString().slice(0, 16) : "";
    for (const b of wk.days.querySelectorAll("button")) b.classList.toggle("on", (s.days || []).includes(Number(b.dataset.day)));
    wk.project.checked = !!(w?.root || w?.needsProject);
    wk.project.disabled = !activePath;
    el("wkProjectHint").textContent = activePath ? `(${basename(activePath)})` : "(open a project first)";
    wk.changes.checked = w ? w.readOnly === false : false;
    wk.notify.checked = w ? w.notify !== false : true;
    wk.del.hidden = !editingWorker;
    syncWorkerFields();
    workerOverlay.hidden = false;
    setTimeout(() => (wk.name.value ? wk.prompt : wk.name).focus(), 30);
  }
  function closeWorkerModal() { workerOverlay.hidden = true; editingWorker = null; }

  el("wkCancel").addEventListener("click", closeWorkerModal);
  workerOverlay.addEventListener("click", (e) => { if (e.target === workerOverlay) closeWorkerModal(); });
  el("wkSave").addEventListener("click", async () => {
    const name = wk.name.value.trim();
    const prompt = wk.prompt.value.trim();
    if (!name || !prompt) { (name ? wk.prompt : wk.name).focus(); return; }
    const type = wk.type.value;
    const schedule = { type };
    if (type === "daily") { schedule.time = wk.time.value || "08:00"; schedule.days = [...wk.days.querySelectorAll("button.on")].map((b) => Number(b.dataset.day)); }
    if (type === "interval") schedule.everyMinutes = Number(wk.every.value) || 60;
    if (type === "once") schedule.at = wk.at.value ? new Date(wk.at.value).toISOString() : new Date(Date.now() + 3600_000).toISOString();
    const spec = { name, icon: wk.icon.value.trim() || "🤖", prompt, schedule, root: wk.project.checked && activePath ? activePath : null, readOnly: !wk.changes.checked, notify: wk.notify.checked };
    try {
      if (editingWorker) await window.nutaan.workers.update(editingWorker.id, spec);
      else await window.nutaan.workers.create(spec);
    } catch (e) {
      alert("Could not save the worker: " + e.message);
      return;
    }
    closeWorkerModal();
    loadWorkers();
  });
  wk.del.addEventListener("click", async () => {
    if (!editingWorker) return;
    if (!confirm(`Delete "${editingWorker.name}"?`)) return;
    await window.nutaan.workers.remove(editingWorker.id);
    closeWorkerModal();
    loadWorkers();
  });
  el("newWorkerBtn").addEventListener("click", () => openWorkerModal(null));
  // Worker sub-tabs: My workers / Templates
  document.querySelectorAll(".worker-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      const which = btn.dataset.wtab;
      document.querySelectorAll(".worker-tab").forEach((b) => b.classList.toggle("active", b === btn));
      document.querySelectorAll(".worker-panel").forEach((p) => { p.hidden = p.dataset.wpanel !== which; });
    });
  });
  el("markAllReadBtn").addEventListener("click", async () => { await window.nutaan.workers.markRead(null); loadWorkers(); });
  el("clearUpdatesBtn").addEventListener("click", async () => { if (confirm("Clear the whole Updates feed?")) { await window.nutaan.workers.clearUpdates(); loadWorkers(); } });

  // ---------- Self-Healing Workspace ----------
  async function loadHealth() {
    try { autonomous.health = await window.nutaan.healer.view(activePath || null); }
    catch (e) { console.warn("health load failed", e); return; }
    autonomous.openIncidents = autonomous.health.openCount || 0;
    renderNav();
    if (sidebarView === "health") { renderHealthPage(); renderHealthSidebar(); }
  }

  const STAGE_LABEL = { detect: "Detect", reproduce: "Reproduce", diagnose: "Diagnose", patch: "Patch", test: "Test", deploy: "Deploy", verify: "Verify" };
  const INCIDENT_STATUS = { detected: "Detected", repairing: "Repairing", fixed: "Fixed", "patched-unverified": "Patched · not verified", failed: "Repair failed", ignored: "Ignored", "needs-human": "Needs you" };

  function renderHealthPage() {
    const h = autonomous.health;
    if (!h) return;
    for (const b of el("healMode").querySelectorAll("button")) b.classList.toggle("active", b.dataset.mode === h.mode);
    const cfg = h.project || {};
    if (document.activeElement !== el("healthUrl")) el("healthUrl").value = cfg.healthUrl || "";
    if (document.activeElement !== el("healthTest")) el("healthTest").value = cfg.testCommand || "";
    if (document.activeElement !== el("healthDeploy")) el("healthDeploy").value = cfg.deployCommand || "";
    el("healthWatchTests").checked = !!cfg.watchTests;
    el("healthConfig").classList.toggle("disabled", !activePath);
    const status = el("healthStatus");
    if (!activePath) status.innerHTML = `<span class="muted">Open a project to configure its checks.</span>`;
    else if (h.mode === "off") status.innerHTML = `<span class="muted">Monitoring is off.</span>`;
    else status.innerHTML =
      `<span class="hs ${cfg.healthy === true ? "ok" : cfg.healthy === false ? "bad" : ""}">${cfg.healthUrl ? (cfg.healthy === true ? "Health URL responding" : cfg.healthy === false ? "Health URL down" : "Health URL not checked yet") : "No health URL"}</span>` +
      `<span class="hs">${h.mode === "auto" ? "Auto-heal on — incidents are repaired automatically" : "Watch mode — incidents are reported, repair is one click"}</span>`;

    const list = el("incidentList");
    const count = el("incidentCount");
    const incidents = h.incidents || [];
    count.textContent = h.openCount ? `${h.openCount} open` : "";
    list.innerHTML = "";
    if (!incidents.length) {
      list.innerHTML = `<div class="page-empty">Nothing detected${activePath ? ` in ${escapeHtml(basename(activePath))}` : ""}. Start the dev server with the agent (it runs as a background task) or open your app in the browser panel, and anything that breaks shows up here.</div>`;
      return;
    }
    for (const inc of incidents) {
      const card = document.createElement("div");
      card.className = `incident ${inc.status}`;
      const stages = (inc.stages || []).map((s) => `<span class="stage ${s.status}" title="${escapeHtml(s.note || "")}"><span class="stage-dot"></span>${STAGE_LABEL[s.stage] || s.stage}</span>`).join('<span class="stage-arrow">→</span>');
      const notes = (inc.stages || []).filter((s) => s.note && s.status !== "pending").map((s) => `<div class="stage-note"><b>${STAGE_LABEL[s.stage]}</b> ${escapeHtml(s.note)}</div>`).join("");
      card.innerHTML =
        `<div class="inc-head"><span class="inc-src">${escapeHtml(inc.source)}</span><span class="inc-title">${escapeHtml(inc.title)}</span><span class="inc-status ${inc.status}">${INCIDENT_STATUS[inc.status] || inc.status}</span></div>` +
        `<div class="inc-meta">${escapeHtml(relTime(inc.detectedAt))}${inc.occurrences > 1 ? ` · seen ${inc.occurrences}×` : ""}${inc.filesChanged?.length ? ` · changed ${inc.filesChanged.map(escapeHtml).join(", ")}` : ""}${inc.currentTool ? ` · <span class="inc-tool">${escapeHtml(inc.currentTool)}</span>` : ""}</div>` +
        `<div class="stages">${stages}</div>` +
        (notes ? `<div class="stage-notes">${notes}</div>` : "") +
        `<details class="inc-evidence"><summary>Evidence</summary><pre>${escapeHtml(inc.evidence || "")}</pre></details>` +
        (inc.summary ? `<div class="inc-summary">${renderMarkdownLite(inc.summary)}</div>` : "") +
        `<div class="inc-actions">` +
        (inc.status === "repairing"
          ? `<button class="btn-secondary sm" data-act="stop">Stop repair</button>`
          : inc.status === "fixed" || inc.status === "ignored" ? ""
          : `<button class="btn-primary sm" data-act="repair">${inc.status === "detected" ? "Repair now" : "Retry repair"}</button>`) +
        (inc.status !== "repairing" && inc.status !== "ignored" ? `<button class="link-btn" data-act="chat">Open in chat</button><button class="link-btn" data-act="ignore">Ignore</button>` : "") +
        `</div>`;
      card.addEventListener("click", async (e) => {
        const btn = e.target.closest("button[data-act]");
        if (!btn) return;
        const act = btn.dataset.act;
        if (act === "repair") { btn.disabled = true; btn.textContent = "Starting…"; const r = await window.nutaan.healer.repair(inc.id); if (!r.ok) alert(r.error); }
        if (act === "stop") await window.nutaan.healer.stopRepair(inc.id);
        if (act === "ignore") await window.nutaan.healer.ignore(inc.id);
        if (act === "chat") {
          sidebarView = "chats"; renderNav(); renderExplorer();
          input.value = `The workspace monitor caught this in ${inc.source}: "${inc.title}". Evidence:\n${(inc.evidence || "").slice(0, 1200)}\n\nReproduce it, find the root cause, fix it, and verify.`;
          input.focus(); autoGrowInput();
          return;
        }
        loadHealth();
      });
      list.appendChild(card);
    }
  }

  function renderHealthSidebar() {
    chatsView.innerHTML = "";
    const h = autonomous.health;
    const box = document.createElement("div");
    box.className = "side-list";
    if (!h) { box.innerHTML = `<div class="side-empty">Loading…</div>`; chatsView.appendChild(box); return; }
    const mode = document.createElement("div");
    mode.className = "side-mode";
    mode.innerHTML = `<span class="dot ${h.mode}"></span>${h.mode === "auto" ? "Auto-heal" : h.mode === "watch" ? "Watching" : "Off"}${h.project?.healthUrl ? ` · ${h.project.healthy === true ? "up" : h.project.healthy === false ? "down" : "…"}` : ""}`;
    box.appendChild(mode);
    const open = (h.incidents || []).filter((i) => i.status !== "ignored").slice(0, 12);
    if (!open.length) box.innerHTML += `<div class="side-empty">No incidents</div>`;
    for (const inc of open) {
      const row = document.createElement("div");
      row.className = `side-row inc-${inc.status}`;
      row.innerHTML = `<span class="side-icon">${inc.status === "fixed" ? "✓" : inc.status === "repairing" ? "◌" : "!"}</span><span class="side-name">${escapeHtml(inc.title)}</span><span class="side-meta">${escapeHtml(relTime(inc.detectedAt))}</span>`;
      box.appendChild(row);
    }
    chatsView.appendChild(box);
  }

  el("healMode").addEventListener("click", async (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    await window.nutaan.healer.setMode(b.dataset.mode);
    loadHealth();
  });
  el("healthSave").addEventListener("click", async () => {
    if (!activePath) return;
    await window.nutaan.healer.configure(activePath, { healthUrl: el("healthUrl").value, testCommand: el("healthTest").value, deployCommand: el("healthDeploy").value, watchTests: el("healthWatchTests").checked });
    loadHealth();
  });
  el("healthScan").addEventListener("click", async () => {
    if (!activePath) return;
    const btn = el("healthScan");
    btn.disabled = true; btn.textContent = "Checking…";
    try {
      await window.nutaan.healer.configure(activePath, { healthUrl: el("healthUrl").value, testCommand: el("healthTest").value, deployCommand: el("healthDeploy").value, watchTests: el("healthWatchTests").checked });
      const r = await window.nutaan.healer.scan(activePath);
      const status = el("healthStatus");
      status.innerHTML = (r.findings || []).length
        ? r.findings.map((f) => `<span class="hs ${f.ok ? "ok" : "bad"}">${escapeHtml(f.check)}: ${escapeHtml(f.detail)}</span>`).join("")
        : `<span class="muted">Nothing to check — set a health URL or a test command first.</span>`;
    } finally {
      btn.disabled = false; btn.textContent = "Check now";
      loadHealth();
    }
  });
  el("clearIncidentsBtn").addEventListener("click", async () => { await window.nutaan.healer.clear(); loadHealth(); });

  // ---------- Today ----------
  function lastChatSummary() {
    const proj = activeProject();
    if (!proj) return null;
    const chats = [...proj.chats].filter((c) => c.messages?.some((m) => m.role === "user")).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    const chat = chats[0];
    if (!chat) return null;
    let tasks = null;
    for (const m of chat.messages) {
      for (const call of m.tool_calls || []) {
        if (String(call.function?.name || "").startsWith("task_write")) {
          try { tasks = JSON.parse(call.function.arguments || "{}").tasks || null; } catch {}
        }
      }
    }
    const openTasks = (tasks || []).filter((t) => t.status !== "completed").map((t) => t.task).slice(0, 6);
    return { title: chat.title, openTasks };
  }

  let todayToken = 0;
  async function loadToday({ force = false } = {}) {
    if (!activePath) { todaySection.hidden = true; return; }
    // A home folder or a plain directory is not a project: scanning it for TODOs and tests produces
    // nonsense ("clear 35 TODOs in Arduino15/libraries"). Today speaks only for a real codebase.
    if (!(await looksLikeCodebase(activePath))) { todaySection.hidden = true; return; }
    const token = ++todayToken;
    const root = activePath;
    todaySection.hidden = settings.uiMode === "office";
    el("todayDate").textContent = new Date().toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" });
    if (!autonomous.today || autonomous.today.root !== root) {
      el("todayHeadline").textContent = "Reading the project…";
      todayGrid.innerHTML = "";
    }
    try {
      const t = await window.nutaan.today({ root, lastChat: lastChatSummary(), force });
      if (token !== todayToken || activePath !== root) return;
      autonomous.today = t;
      renderToday();
    } catch (e) {
      if (token !== todayToken) return;
      el("todayHeadline").textContent = "Couldn't read the project: " + e.message;
    }
  }

  const KIND_COLOR = { fix: "#f87171", resume: "#c084fc", git: "#60a5fa", code: "#fb923c", quality: "#4ade80", deps: "#facc15", config: "#e0a336", docs: "#38bdf8", run: "#34d399", worker: "#a78bfa", idea: "#ec4899", todo: "#9ba0ab" };

  function renderToday() {
    const t = autonomous.today;
    if (!t) return;
    el("todayHeadline").textContent = t.headline || "";
    todayGrid.innerHTML = "";
    if (!t.cards.length) {
      todayGrid.innerHTML = `<div class="today-empty">Nothing is waiting on you in ${escapeHtml(t.name)} — pick a quick action below.</div>`;
      return;
    }
    for (const c of t.cards) {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "today-card" + (c.kind === "fix" ? " fix" : "");
      card.innerHTML =
        `<span class="tc-bar" style="background:${KIND_COLOR[c.kind] || KIND_COLOR.todo}"></span>` +
        `<span class="tc-title">${escapeHtml(c.title)}</span>` +
        `<span class="tc-why">${escapeHtml(c.why || "")}</span>` +
        (c.fromModel ? `<span class="tc-tag">suggested</span>` : "");
      card.addEventListener("click", async () => {
        if (String(c.prompt).startsWith("__run_worker__:")) {
          await window.nutaan.workers.runNow(c.prompt.split(":")[1]);
          sidebarView = "workers"; renderNav(); renderExplorer(); loadWorkers();
          return;
        }
        input.value = c.prompt;
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        autoGrowInput();
      });
      todayGrid.appendChild(card);
    }
  }
  el("todayRefresh").addEventListener("click", () => loadToday({ force: true }));
  // The cards fold away by default so the home stays a greeting and a box; the headline still
  // says what is going on, and one click opens the cards. Remembered.
  function renderTodayFold() {
    const open = !!settings.todayExpanded;
    todaySection.classList.toggle("collapsed", !open);
    el("todayToggleLabel").textContent = open ? "Hide" : "Show";
  }
  el("todayToggle").addEventListener("click", async () => {
    settings.todayExpanded = !settings.todayExpanded;
    renderTodayFold();
    await window.nutaan.setSettings(settings);
  });
  renderTodayFold();

  // ---------- Outcome mode + Nutaan Swarm ----------
  const OUTCOMES = [
    { label: "Build a SaaS", goal: "Build a SaaS: " },
    { label: "Fix production", goal: "Fix production: " },
    { label: "Launch website", goal: "Launch the website: " },
    { label: "Create marketing campaign", goal: "Create a marketing campaign for " },
    { label: "Research competitors", goal: "Research competitors: " },
    { label: "Set up CRM", goal: "Set up a CRM for " },
    { label: "Deploy application", goal: "Deploy the application to " },
  ];

  function setComposerMode(mode) {
    composerMode = mode;
    for (const b of modeToggle.querySelectorAll(".mode-opt")) b.classList.toggle("active", b.dataset.mode === mode);
    input.placeholder = mode === "outcome" ? "What outcome do you want? e.g. Launch my SaaS by Friday" : "Build a feature, fix a bug, or refactor code...";
    appEl.classList.toggle("outcome-mode", mode === "outcome");
    renderOutcomeEmpty();
  }
  modeToggle.addEventListener("click", (e) => {
    const b = e.target.closest(".mode-opt");
    if (b) setComposerMode(b.dataset.mode);
  });

  function renderOutcomeEmpty() {
    const outcome = composerMode === "outcome";
    if (outcome) {
      emptyTitle.innerHTML = `What <span class="grad-text">outcome</span> do you want?`;
      emptySub.textContent = "Name the result, not the steps. Nutaan Swarm plans it, splits it across Planner · Developer · Browser QA · Researcher · Reviewer · DevOps, runs them in parallel and merges one report.";
    } else {
      renderHomeCopy();
    }
    outcomeChips.hidden = !outcome;
    quickGrid.hidden = outcome;
    if (outcome && !outcomeChips.childElementCount) {
      for (const o of OUTCOMES) {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "outcome-chip";
        chip.textContent = o.label;
        chip.addEventListener("click", () => { input.value = o.goal; input.focus(); input.setSelectionRange(input.value.length, input.value.length); autoGrowInput(); });
        outcomeChips.appendChild(chip);
      }
    }
  }

  const swarmCards = new Map(); // runId -> { el, chat }

  async function launchSwarm(goal, { chat, proj }) {
    if (!settings.nutaanKey && !settings.apiKey) { showActivation("Activate Nutaan Code with your nutaan.com API key first."); return; }
    appendBubble("user", goal);
    chat.messages.push({ role: "user", content: `[Outcome handed to Nutaan Swarm] ${goal}` });
    chat.updatedAt = new Date().toISOString();
    let res;
    try { res = await window.nutaan.swarm.start({ goal, root: proj.path, model: settings.model }); }
    catch (e) { appendBubble("error", "Couldn't start the swarm: " + e.message); return; }
    ensureSwarmCard(res.runId, { goal, chat });
    persistProjects();
  }

  function ensureSwarmCard(runId, { goal, chat }) {
    if (swarmCards.has(runId)) return swarmCards.get(runId);
    const card = document.createElement("div");
    card.className = "swarm-card";
    card.dataset.runId = runId;
    card.innerHTML = `<div class="sw-head"><span class="sw-mark">◎</span><div class="sw-title"><b>Nutaan Swarm</b><span class="sw-goal">${escapeHtml(goal || "")}</span></div><span class="sw-status">planning</span><button class="link-btn sw-stop">Stop</button></div><div class="sw-plan" hidden></div><div class="sw-team"></div>`;
    card.querySelector(".sw-stop").addEventListener("click", () => window.nutaan.swarm.stop(runId));
    thread.appendChild(card);
    renderEmptyVisibility();
    scrollToBottom();
    const entry = { el: card, chat: chat || activeChat(), reported: false };
    swarmCards.set(runId, entry);
    return entry;
  }

  function renderSwarmCard(run) {
    const entry = swarmCards.get(run.id) || ensureSwarmCard(run.id, { goal: run.goal });
    const card = entry.el;
    const status = card.querySelector(".sw-status");
    status.textContent = run.status;
    status.className = "sw-status " + run.status;
    card.querySelector(".sw-stop").hidden = !["planning", "running", "merging"].includes(run.status);
    const plan = card.querySelector(".sw-plan");
    if (run.plan?.summary) { plan.hidden = false; plan.textContent = run.plan.summary; }
    const team = card.querySelector(".sw-team");
    team.innerHTML = "";
    for (const t of run.tasks) {
      const row = document.createElement("div");
      row.className = `sw-agent ${t.status}`;
      const steps = t.steps || [];
      // The steps trail expands like Claude Code's side panel: the header line summarises, and the
      // list under it shows every step this agent took. Auto-open while running so the user watches
      // it work; collapsible once done so a finished run stays tidy.
      const stateLabel = t.status === "running"
        ? `<span class="wk-spark"></span>${escapeHtml(t.currentTool || "working")}${t.toolCount ? ` · ${t.toolCount}` : ""}`
        : t.status === "done" ? `✓${t.toolCount ? ` ${t.toolCount} steps` : ""}`
        : t.status === "pending" ? (t.dependsOn?.length ? "waiting" : "queued") : t.status;
      const head =
        `<div class="sw-agent-head">` +
        `<span class="sw-role" style="--role:${t.color || "#9ba0ab"}">${escapeHtml(t.icon)} ${escapeHtml(t.roleName)}</span>` +
        `<span class="sw-task">${escapeHtml(t.title)}</span>` +
        `<span class="sw-state">${stateLabel}</span>` +
        (steps.length ? `<span class="sw-chev">${t.status === "running" ? "▾" : "▸"}</span>` : "") +
        `</div>`;
      const stepList = steps.length
        ? `<div class="sw-steps"${t.status === "running" ? "" : " hidden"}>` +
          steps.map((s) => `<div class="sw-step">${escapeHtml(s)}</div>`).join("") +
          `</div>`
        : "";
      row.innerHTML =
        head + stepList +
        (t.findings && t.status === "done" ? `<details class="sw-findings"><summary>Findings</summary>${renderMarkdownLite(t.findings)}</details>` : "") +
        (t.error ? `<div class="sw-err">${escapeHtml(t.error)}</div>` : "");
      if (steps.length) {
        const h = row.querySelector(".sw-agent-head");
        const list = row.querySelector(".sw-steps");
        const chev = row.querySelector(".sw-chev");
        h.style.cursor = "pointer";
        h.addEventListener("click", () => { list.hidden = !list.hidden; if (chev) chev.textContent = list.hidden ? "▸" : "▾"; });
      }
      team.appendChild(row);
    }
    if ((run.status === "done" || run.status === "stopped" || run.status === "failed") && !entry.reported) {
      entry.reported = true;
      const report = run.report || (run.status === "stopped" ? "Swarm stopped before finishing." : run.error ? `Swarm failed: ${run.error}` : "");
      if (report) {
        const tagged = `[Nutaan Swarm report]\n\n${report}`;
        appendBubble("assistant", tagged);
        const chat = entry.chat;
        if (chat) {
          chat.messages.push({ role: "assistant", content: tagged });
          chat.updatedAt = new Date().toISOString();
          persistProjects();
        }
      }
      loadToday();
    }
    scrollToBottom();
  }

  // ---------- events from the main process ----------
  window.nutaan.onAutonomousEvent("workers:changed", ({ workers }) => {
    autonomous.workers = workers || autonomous.workers;
    if (sidebarView === "workers") { renderWorkersPage(); renderWorkersSidebar(); }
  });
  window.nutaan.onAutonomousEvent("workers:update", (u) => {
    autonomous.updates.unshift(u);
    if (u.unread) autonomous.unread++;
    renderNav();
    if (sidebarView === "workers") renderUpdates();
  });
  window.nutaan.onAutonomousEvent("workers:run", () => { if (sidebarView === "workers") loadWorkers(); });
  window.nutaan.onAutonomousEvent("swarm:event", ({ run }) => { if (run) renderSwarmCard(run); });
  window.nutaan.onAutonomousEvent("swarm:launched", ({ runId, goal }) => { ensureSwarmCard(runId, { goal }); });
  window.nutaan.onAutonomousEvent("healer:changed", (view) => {
    if (!view.project || !activePath || view.project.root === activePath) autonomous.health = view;
    autonomous.openIncidents = view.openCount || 0;
    renderNav();
    if (sidebarView === "health") { renderHealthPage(); renderHealthSidebar(); }
  });
  window.nutaan.onAutonomousEvent("healer:incident", ({ incident }) => {
    if (incident.root === activePath) loadToday();
  });
  window.nutaan.onAutonomousEvent("healer:health", () => { if (sidebarView === "health") loadHealth(); });
  window.nutaan.onAutonomousEvent("healer:repair-done", () => { loadHealth(); loadToday(); });

  (async function init() {
    if (appVersionText && window.nutaan.getVersion) {
      window.nutaan.getVersion().then((v) => { appVersionText.textContent = "v" + v; });
    }

    const saved = await window.nutaan.getSettings();
    settings = { ...settings, ...saved };

    // Earlier builds stored a user-supplied Server URL, key and model for a gateway that no
    // longer exists. Left in place they shadow the built-in backend and every request dies with
    // ECONNREFUSED against a server that isn't running, so clear them once on upgrade.
    if (settings.backendRevision !== BACKEND_REVISION) {
      settings.backendRevision = BACKEND_REVISION;
      await window.nutaan.setSettings(settings);
    }

    applyExplorerCollapsed();
    renderAutoApprove();
    updateModelBadge();
    rebuildModels();
    renderQuickActions();
    renderCoworkerChips();
    renderBookmarks();
    renderBrowserTabs();
    setBrowserSize("desktop");
    setPanelMode("code");
    // The panel opens when you open it, and comes back the way you left it — never on its own.
    panel.hidden = !settings.panelOpen;
    resizer.hidden = !settings.panelOpen;
    if (settings.sidebarCollapsed) appEl.classList.add("sidebar-collapsed");

    if (Array.isArray(saved.projects) && saved.projects.length) {
      projects = saved.projects.map((p) => {
        if (Array.isArray(p.chats)) {
          return { path: p.path, activeChatId: p.activeChatId, chats: p.chats.length ? p.chats : [makeChat(p.path)] };
        }
        // migrate from the old single-thread-per-project shape
        const messages = p.messages?.length ? p.messages : [{ role: "system", content: systemPrompt(p.path) }];
        const firstUser = messages.find((m) => m.role === "user");
        const chat = {
          id: genId(),
          title: firstUser ? deriveChatTitle(firstUser.content) : "Chat 1",
          updatedAt: new Date().toISOString(),
          messages,
        };
        return { path: p.path, activeChatId: chat.id, chats: [chat] };
      });
    } else if (saved.projectPath) {
      const chat = makeChat(saved.projectPath);
      projects = [{ path: saved.projectPath, activeChatId: chat.id, chats: [chat] }];
    }

    activePath = saved.activeProjectPath && projects.some((p) => p.path === saved.activeProjectPath)
      ? saved.activeProjectPath
      : projects[0]?.path || null;

    renderNav();
    renderExplorer();
    renderRecent();
    renderProjectLabel();
    renderAccountRow();
    updateSendState();

    if (activePath) {
      await refreshTree();
      await refreshGit();
      renderThreadFromMessages(activeChat().messages);
      try { window.nutaan.projectOpened(activePath); } catch {}
    }
    persistProjects();
    // Badges for unread updates and open incidents, and today's suggestions for the open project.
    loadWorkers();
    loadHealth();
    if (activePath) loadToday();

    // Nothing works without a nutaan.com key: the activation screen is the only thing on screen
    // until one is accepted, and the first accepted key leads straight into first-run setup.
    if (!settings.nutaanKey) showActivation("");
    else if (!settings.onboarded) showOnboarding();

    applyUiMode();

    await refreshModels();
    // The free pool (combos + catalog) shows in the model menu from the very first open.
    loadOmniRouteCatalog().catch(() => {});
  })();
})();
