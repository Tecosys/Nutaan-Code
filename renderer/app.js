(function () {
  const el = (id) => document.getElementById(id);

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
  let running = false;
  let sidebarView = "files"; // files | chats | recent
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
    for (const m of [projectMenu, contextMenu, slashMenu, modelMenu, deviceMenu]) {
      if (m && m !== except) m.hidden = true;
    }
  }

  // ---------- Markdown ----------
  function inlineFormat(escaped) {
    return escaped
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
    await refreshModels();
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
  };

  function renderNav() {
    const proj = activeProject();
    const chatCount = proj ? proj.chats.length : 0;
    const defs = [
      { id: "chats", label: "Chats", icon: "chat", badge: chatCount ? String(chatCount) : "" },
      { id: "files", label: "Projects", icon: "folder", badge: projects.length ? String(projects.length) : "" },
      { id: "coworker", label: "Co-worker", icon: "coworker", badge: "" },
      { id: "settings", label: "Settings", icon: "gear", badge: "" },
    ];
    navList.innerHTML = "";
    for (const d of defs) {
      const row = document.createElement("div");
      row.className = "nav-row" + (d.id === sidebarView ? " active" : "");
      row.innerHTML =
        `<span class="nav-icon">${ICONS[d.icon]}</span>` +
        `<span class="nav-label">${d.label}</span>` +
        (d.badge ? `<span class="nav-badge">${escapeHtml(d.badge)}</span>` : "");
      row.addEventListener("click", () => {
        if (d.id === "settings") {
          openSettings();
          return;
        }
        sidebarView = d.id;
        renderNav();
        renderExplorer();
        renderEmptyVisibility();
      });
      navList.appendChild(row);
    }
  }

  function renderExplorer() {
    const isFiles = sidebarView === "files";
    filesView.hidden = !isFiles;
    chatsView.hidden = isFiles;
    explorerLabel.textContent = isFiles ? "Explorer" : sidebarView === "chats" ? "Chats" : "Co-worker";
    if (sidebarView === "chats") renderChatsView();
    if (sidebarView === "coworker") renderCoWorkerView();
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
    const proj = activeProject();
    chatsView.innerHTML = "";
    if (!proj) {
      chatsView.innerHTML = `<div class="menu-empty">Open a project to see its chats.</div>`;
      return;
    }
    for (const c of proj.chats) {
      const row = document.createElement("div");
      row.className = "chat-row" + (c.id === proj.activeChatId ? " active" : "");
      row.innerHTML =
        `<span class="chat-title">${escapeHtml(c.title)}</span>` +
        `<span class="chat-meta">${escapeHtml(basename(proj.path))} · ${escapeHtml(relTime(c.updatedAt))}</span>` +
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
    projectBtnLabel.textContent = activePath ? basename(activePath) : "No project";
    projectBtn.title = activePath || "Open a project";
    treeProjectRow.hidden = !activePath;
    treeProjectName.textContent = activePath ? basename(activePath) : "";
    treeProjectName.title = activePath || "";
    openProjectLinkLabel.textContent = activePath
      ? `Working in ${basename(activePath)} — switch project`
      : "Open a project to get started";
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

  refreshTreeBtn.addEventListener("click", async () => {
    refreshIcon.classList.add("spinning");
    contextFiles = null;
    await refreshTree();
    await refreshGit();
    setTimeout(() => refreshIcon.classList.remove("spinning"), 300);
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
    if (isTerm) refreshTerminal();
  }

  function openPanel(mode) {
    panel.hidden = false;
    resizer.hidden = false;
    if (mode) setPanelMode(mode);
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
    openPanel("code");
    renderFileTabs();
    renderCodeView();
  }

  async function openFileInPanel(relPath, { focus = true, diff = false } = {}) {
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

    openPanel("code");
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
  });
  panelToggleBtn.addEventListener("click", () => {
    const show = panel.hidden;
    panel.hidden = !show;
    resizer.hidden = !show;
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

  function navigateBrowser(value) {
    const url = normalizeUrl(value);
    if (!url) return;
    openPanel("browser");
    const tab = activeBrowserTab() || addBrowserTab(url);
    tab.url = url;
    tab.view.src = url;
  }

  browserAddress.addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigateBrowser(browserAddress.value);
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
      btn.addEventListener("click", () => navigateBrowser(b.url));
      bookmarksEl.appendChild(btn);
    }
  }

  // ---------- Thread rendering ----------
  function renderEmptyVisibility() {
    const hasContent = thread.querySelectorAll(".row, .tool-card, .permission-card, .file-group-card").length > 0;
    const coworker = sidebarView === "coworker";
    emptyState.hidden = hasContent || coworker;
    if (coworkerHero) coworkerHero.hidden = hasContent || !coworker;
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

  function appendBubble(role, content) {
    const row = document.createElement("div");
    row.className = "row " + role;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.innerHTML = role === "assistant" ? renderMarkdownLite(content) : escapeHtml(content);
    if (role === "assistant") linkifyPaths(bubble);
    row.appendChild(bubble);
    thread.appendChild(row);
    renderEmptyVisibility();
    scrollToBottom();
    return bubble;
  }

  function toolLabel(name, args) {
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
    if (name === "stop_background_task") return `Stopping background task <code>${escapeHtml(args.id || "")}</code>`;
    if (name === "run_command") {
      const cmd = String(args.command || "").replace(/\s+/g, " ").trim();
      if (!cmd) return `Running command`;
      return `Running <code>${escapeHtml(cmd.length > 90 ? cmd.slice(0, 90) + "…" : cmd)}</code>`;
    }
    return escapeHtml(name);
  }

  function appendToolCard(id, name, args) {
    const wrap = document.createElement("div");
    wrap.className = "tool-card pending";
    wrap.innerHTML = `
      <div class="tool-header">
        <span class="tool-title">${toolLabel(name, args)}</span>
        <span class="tool-chev">▸</span>
      </div>
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

  function diffHtml(diff) {
    const { rows } = diffStat(diff);
    const body = rows
      .map((r) => {
        const cls = r.t === "+" ? "diff-add" : r.t === "-" ? "diff-del" : "diff-ctx";
        return `<div class="diff-line ${cls}">${r.t} ${escapeHtml(r.l)}</div>`;
      })
      .join("");
    return `<pre class="diff">${body}</pre>`;
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
      detail.innerHTML = `<pre>${escapeHtml(preview)}</pre>`;
    } else if (name === "run_command") {
      const out = (result.stdout || "") + (result.stderr ? "\n" + result.stderr : "");
      if (out.trim()) detail.innerHTML = `<pre>${escapeHtml(out.slice(0, 800))}</pre>`;
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
    }

    if (!detail.innerHTML.trim()) {
      const chev = cardEl.querySelector(".tool-chev");
      if (chev) chev.style.visibility = "hidden";
    }
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
        const text = messageText(m.content);
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
  function setStatus(ok, text, title) {
    statusDot.className = "status-dot " + (ok === null ? "" : ok ? "online" : "offline");
    statusText.textContent = text;
    statusText.title = title || "";
  }

  // ---------- Models ----------
  async function refreshModels() {
    if (!settings.nutaanKey) {
      setStatus(false, "Not activated");
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

    // If the saved model is a Nutaan one that's no longer in the catalog, fall back — but leave a
    // user-managed model (modelProviderId set) alone, it lives in the user's own provider.
    if (!settings.modelProviderId && !res.models.includes(settings.model)) {
      const fallback = res.defaultModel && res.models.includes(res.defaultModel) ? res.defaultModel : res.models[0];
      if (fallback) {
        settings.model = fallback;
        settings.modelProviderId = "";
        await window.nutaan.setSettings(settings);
      }
    }
    rebuildModels();
  }

  let _omniCatalogCache = [];
  let _omniCombosCache = {};
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
    if (id.includes("mistral") || id.includes("codestral")) return "providers/mistral.png";
    if (id.includes("openai") || id.includes("gpt") || id.includes("o3") || id.includes("o1")) return "providers/openai.png";
    if (id.includes("together")) return "providers/together.png";
    if (id.includes("xai") || id.includes("grok")) return "providers/xai.png";
    if (id.includes("ollama") || id.includes("local")) return "providers/ollama.svg";
    return "providers/nutaan.png";
  }

  async function loadOmniRouteCatalog() {
    if (_omniModelsLoaded || !window.nutaan || !window.nutaan.gateway) return;
    try {
      const res = await window.nutaan.gateway.getModels();
      if (res && res.models) {
        _omniCatalogCache = res.models;
        _omniCombosCache = res.combos || {};
        _omniModelsLoaded = true;
        rebuildModels();
      }
    } catch (e) {
      console.warn("OmniRoute catalog fetch:", e);
    }
  }

  // Combine the Nutaan catalog with OmniRoute models and user-managed provider models
  function rebuildModels() {
    aggregatedModels = [];
    for (const id of nutaanModels) aggregatedModels.push({ id, providerId: "", providerName: "Nutaan", providerType: "nutaan" });
    for (const p of settings.customProviders || []) {
      for (const id of p.models || []) aggregatedModels.push({ id, providerId: p.id, providerName: p.name, providerType: p.type });
    }
    // Inject OmniRoute 1,000+ Models Catalog
    if (_omniCatalogCache && _omniCatalogCache.length) {
      for (const m of _omniCatalogCache) {
        if (!aggregatedModels.some((existing) => existing.id === m.id)) {
          aggregatedModels.push({
            id: m.id,
            name: m.name,
            providerId: m.provider,
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
          mlogo.src = "providers/" + (m.providerType || "nutaan") + ".png";
          mlogo.alt = "";
          mlogo.onerror = () => { mlogo.style.visibility = "hidden"; };
          const mname = document.createElement("div");
          mname.className = "name";
          mname.title = m.id;
          mname.textContent = m.id;
          item.appendChild(mlogo);
          item.appendChild(mname);
          item.addEventListener("click", () => selectModel(m.id, m.providerId));
          modelMenu.appendChild(item);
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

  function renderQuickActions() {
    quickGrid.innerHTML = "";
    for (const qa of QUICK_ACTIONS) {
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

  function renderAttachments() {
    attachRow.innerHTML = "";
    attachments.forEach((a, i) => {
      const chip = document.createElement("span");
      chip.className = "attach-chip";
      chip.innerHTML = `<span>${escapeHtml(a.name)}</span><button title="Remove">✕</button>`;
      chip.querySelector("button").addEventListener("click", () => {
        attachments.splice(i, 1);
        renderAttachments();
      });
      attachRow.appendChild(chip);
    });
  }

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

  // ---------- Project / chat management ----------
  function systemPrompt(root) {
    return [
      "You are Nutaan Code, a careful personal coding assistant running as a desktop app on the user's own machine.",
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
    if (!proj || running) return;
    const chat = makeChat(proj.path);
    proj.chats.unshift(chat);
    proj.activeChatId = chat.id;
    renderNav();
    renderExplorer();
    renderThreadFromMessages(chat.messages);
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
    if (running) return;
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    const pathChanged = path !== activePath;
    activePath = path;
    proj.activeChatId = chatId;
    if (pathChanged) await onProjectChanged();
    renderNav();
    renderExplorer();
    renderThreadFromMessages(activeChat().messages);
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
  el("newChatMain").addEventListener("click", () => {
    if (activePath) newChat();
    else pickAndOpenProject();
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

  window.nutaan.onAgentEvent("agent:tasks-update", ({ tasks }) => {
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

  window.nutaan.onAgentEvent("agent:usage", ({ usage }) => {
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

  window.nutaan.onAgentEvent("agent:tasks", ({ running, names }) => {
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

  window.nutaan.onAgentEvent("agent:tool-pending", ({ name }) => {
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
      window.nutaan.stopAgent();
      appendBubble("error", "Stopped. Your draft is still in the box — press Send again to continue.");
      return;
    }
    const text = input.value.trim();
    if (!text) return;
    if (!settings.nutaanKey) {
      showActivation("Activate Nutaan Code with your nutaan.com API key to start chatting.");
      return;
    }
    const proj = activeProject();
    const chat = activeChat();
    if (!proj || !chat) {
      pickAndOpenProject();
      return;
    }
    if (chat.messages.length === 0) chat.messages = [{ role: "system", content: systemPrompt(proj.path) }];
    if (chat.title === "New chat") chat.title = deriveChatTitle(text);
    chat.updatedAt = new Date().toISOString();

    chat.messages.push({ role: "user", content: buildUserContent(text) });
    resetFileGroup();
    appendBubble("user", attachments.length ? `${attachments.map((a) => `📎 ${a.name}`).join("\n")}\n\n${text}` : text);
    attachments = [];
    renderAttachments();
    input.value = "";
    autoGrowInput();
    renderExplorer();
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

    window.nutaan.sendAgentMessage({
      root: proj.path,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      nutaanKey: settings.nutaanKey,
      customProviders: settings.customProviders,
      modelProviderId: settings.modelProviderId,
      model: settings.model,
      imageModel: settings.imageModel,
      autoApprove: settings.autoApprove,
      messages: chat.messages,
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

  window.nutaan.onAgentEvent("agent:reasoning-delta", ({ content }) => {
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

  window.nutaan.onAgentEvent("agent:assistant-delta", ({ content }) => {
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

  window.nutaan.onAgentEvent("agent:tool-start", ({ id, name, args }) => {
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
      "check_background_task", "list_background_tasks",
    ];
    if (visibleTools.includes(name)) appendToolCard(id, name, args);
    runActivity.textContent = toolLabel(name, args).replace(/<[^>]+>/g, "");
  });

  window.nutaan.onAgentEvent("agent:tool-arg-stream", ({ id, name, path, text }) => {
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

  window.nutaan.onAgentEvent("agent:permission-request", (req) => {
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
      openPanel();
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

  window.nutaan.onAgentEvent("agent:compacting", () => {
    appendNoticeCard("Compacting conversation to make room for more context…");
  });

  window.nutaan.onAgentEvent("agent:retrying", ({ message, attempt, max, delayMs }) => {
    appendNoticeCard(`Provider hiccup (${escapeHtml(message || "")}) — retrying in ${Math.round(delayMs / 1000)}s… (${attempt}/${max})`);
  });

  window.nutaan.onAgentEvent("agent:model-switched", ({ from, to }) => {
    settings.model = to;
    window.nutaan.setSettings(settings);
    updateModelBadge();
    appendNoticeCard(`"${escapeHtml(from)}" wasn't responding, so switched to "${escapeHtml(to)}" and kept going…`);
  });

  const FILE_VIEW_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
  async function maybeShowInCodeTab(id, name, result) {
    if (!FILE_VIEW_TOOLS.has(name) || (result && result.error)) return;
    const args = toolArgsById.get(id);
    if (!args?.path || !activeProject()) return;
    // Don't yank the user off a live browser preview they deliberately have up just because the
    // agent also touched a file — load it into a tab, but only steal focus if Code is showing.
    // A write/edit opens straight into the diff so you see what changed; a plain read shows the file.
    const isEdit = name === "write_file" || name === "edit_file";
    await openFileInPanel(args.path, { focus: panelMode === "code", diff: isEdit });
  }

  const FS_MUTATING_TOOLS = new Set(["write_file", "edit_file", "run_command"]);
  window.nutaan.onAgentEvent("agent:tool-result", ({ id, name, result }) => {
    resolveToolCard(id, name, result);
    maybeShowInCodeTab(id, name, result);
    if (running) showThinking();
    if (FS_MUTATING_TOOLS.has(name) && !(result && result.error)) {
      contextFiles = null;
      refreshTree();
      refreshGit();
    }
  });

  window.nutaan.onAgentEvent("agent:done", ({ messages }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    const chat = activeChat();
    if (messages && chat) {
      chat.messages = messages;
      chat.updatedAt = new Date().toISOString();
      persistProjects();
    }
    setRunning(false);
    renderExplorer();
  });

  window.nutaan.onAgentEvent("agent:error", ({ message }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();

    if (/user not found|invalid.?api.?key|invalid_api_key|no such user|unknown key|missing.*auth|no auth credentials/i.test(message || "")) {
      appendBubble("error", `${message}\n\nThe backend rejected the request as unauthenticated. If you set a custom Server URL under Settings → Advanced, check its API key.`);
      setRunning(false);
      return;
    }

    // A model id left over from a previous Server URL isn't in the live catalog at all — that
    // alone is a reliable signal the model is wrong for this backend, independent of whatever
    // error text the server happens to return for a request it can't fulfil.
    const unknownModel = settings.model && availableModels.length > 0 && !availableModels.includes(settings.model);
    if (unknownModel) {
      const fallback = availableModels[0];
      const badModel = settings.model;
      settings.model = fallback;
      window.nutaan.setSettings(settings);
      updateModelBadge();
      appendBubble("error", `${message}\n\n"${badModel}" isn't a valid model for this backend. Switched to "${fallback}" — try sending again.`);
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

  window.nutaan.onAgentEvent("agent:browser-action", async (req) => {
    openPanel("browser");
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
    renderProviders();
    await loadOmniRouteCatalog();
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
      agentbridge: "AgentBridge (Internal MITM)",
      advanced: "Advanced Settings"
    };
    const titleEl = el("settingsPageTitle");
    if (titleEl) titleEl.textContent = titles[tabId] || tabId;

    if (tabId === "omniroute") renderOmniRouteTab();
    if (tabId === "models") renderModelTable();
    if (tabId === "agentbridge") renderAgentBridgeTab();
  }

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
        if (statModels) statModels.textContent = `${(aggregatedModels && aggregatedModels.length) || 1200}+`;
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
          await window.nutaan.gateway.start({ port: 20128 });
          await updateStatus();
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
  }

  // ---------- Enhanced Model Table Rendering ----------
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
      tbody.innerHTML = `<tr><td colspan="5" class="model-table-empty">Loading 1,000+ models from OmniRoute catalog…</td></tr>`;
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
          <b>${escapeHtml(m.name || m.id)}</b>${isFreePool ? ' <span class="free-pool-badge">1.6B Pool</span>' : ''}
          <div style="font-size:11px;color:var(--text-muted);font-family:var(--mono);margin-top:2px;">${escapeHtml(m.id)}</div>
        </td>
        <td>
          <div class="provider-logo-cell">
            <img class="provider-logo-img" src="${getProviderLogo(m.providerId || m.providerType)}" alt="" />
            <span>${escapeHtml(m.providerName || "Nutaan")}</span>
          </div>
        </td>
        <td>
          <span class="context-badge">${m.context_window || "128k"}</span>
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

  window.nutaan?.onAgentEvent("agent:model-switched", ({ from, to }) => {
    if (to) appendBubble("error", `⚡ Auto-switched model: ${from} → ${to}`);
  });

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
    { type: "deepseek", name: "DeepSeek (Official)", baseUrl: "https://api.deepseek.com/v1", color: "#4d6bfe", mark: "DS" },
    { type: "openai", name: "OpenAI", baseUrl: "https://api.openai.com/v1", color: "#10a37f", mark: "AI" },
    { type: "anthropic", name: "Anthropic", baseUrl: "https://api.anthropic.com/v1", color: "#d97757", mark: "A" },
    { type: "together", name: "Together AI", baseUrl: "https://api.together.xyz/v1", color: "#0f6fff", mark: "T" },
    { type: "mistral", name: "Mistral", baseUrl: "https://api.mistral.ai/v1", color: "#fa5310", mark: "M" },
    { type: "ollama", name: "Ollama (Local Offline)", baseUrl: "http://127.0.0.1:11434/v1", color: "#1e293b", mark: "OL" },
    { type: "nvidia", name: "NVIDIA NIM", baseUrl: "https://integrate.api.nvidia.com/v1", color: "#76b900", mark: "NV" },
    { type: "azure", name: "Azure OpenAI", baseUrl: "", color: "#0a84ff", mark: "Az" },
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
    if (gate) gate.textContent = hasNutaan ? "" : "— add your nutaan.com API key first (required for bring-your-own-key)";
    const addBtn = el("addProviderBtn");
    if (addBtn) addBtn.disabled = !hasNutaan;
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
    const lg = el("peTypeLogo"); if (lg) lg.src = "providers/" + (el("peType").value || "openai") + ".png";
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
    el("peModelInput")?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addEditorModel(); } });
    el("peType")?.addEventListener("change", () => {
      const preset = presetFor(el("peType").value);
      el("peName").value = preset.name;
      el("peBaseUrl").value = preset.baseUrl;
      const lg = el("peTypeLogo"); if (lg) lg.src = "providers/" + preset.type + ".png";
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
      checkUpdatesBtn.disabled = true;
      checkUpdatesBtn.textContent = "Checking…";
      const res = await window.nutaan.checkForUpdates();
      if (!res.ok) {
        checkUpdatesBtn.textContent = "Check for updates";
        checkUpdatesBtn.disabled = false;
        appVersionText.textContent = String(res.message || "Could not check for updates.").slice(0, 160);
      }
    });
  }
  if (window.nutaan.onUpdateStatus) {
    window.nutaan.onUpdateStatus((data) => {
      if (data.status === "checking") {
        checkUpdatesBtn.textContent = "Checking…";
        checkUpdatesBtn.disabled = true;
      } else if (data.status === "available") {
        checkUpdatesBtn.textContent = "Downloading update…";
      } else if (data.status === "downloaded") {
        checkUpdatesBtn.textContent = "Restart to update";
      } else if (data.status === "not-available") {
        checkUpdatesBtn.textContent = "You're up to date";
        checkUpdatesBtn.disabled = false;
        setTimeout(() => { checkUpdatesBtn.textContent = "Check for updates"; }, 3000);
      } else if (data.status === "error") {
        checkUpdatesBtn.textContent = "Check for updates";
        checkUpdatesBtn.disabled = false;
      }
    });
  }

  // ---------- Init ----------
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
      settings.baseUrl = "";
      settings.apiKey = "";
      settings.model = "";
      settings.backendRevision = BACKEND_REVISION;
      await window.nutaan.setSettings(settings);
    }

    renderAutoApprove();
    updateModelBadge();
    rebuildModels();
    renderQuickActions();
    renderCoworkerChips();
    renderBookmarks();
    renderBrowserTabs();
    setBrowserSize("desktop");
    setPanelMode("code");
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
    }
    persistProjects();

    if (!settings.nutaanKey) {
      showActivation("");
      setStatus(false, "Not activated");
    } else {
      await refreshModels();
    }
  })();
})();
