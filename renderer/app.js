(function () {
  const DEFAULT_BASE_URL = "https://openrouter.ai/api/v1";
  const OPENROUTER_KEYS_URL = "https://openrouter.ai/keys";
  const DEFAULT_MODEL = "nex-agi/nex-n2.5-mini:free";

  const el = (id) => document.getElementById(id);
  const thread = el("thread");
  const emptyState = el("emptyState");
  const emptyHint = el("emptyHint");
  const input = el("input");
  const sendBtn = el("sendBtn");
  const statusDot = el("statusDot");
  const statusText = el("statusText");
  const modelSelectSettings = el("modelSelectSettings");
  const settingsBtn = el("settingsBtn");
  const sidebarToggleBtn = el("sidebarToggleBtn");
  const appEl = el("app");
  const settingsOverlay = el("settingsOverlay");
  const baseUrlInput = el("baseUrlInput");
  const imageModelInput = el("imageModelInput");
  const apiKeyInput = el("apiKeyInput");
  const settingsSave = el("settingsSave");
  const settingsCancel = el("settingsCancel");
  const newChatBtn = el("newChatBtn");
  const openFolderBtn = el("openFolderBtn");
  const projectPathEl = el("projectPath");
  const fileTreeEl = el("fileTree");
  const fileTreeDivider = el("fileTreeDivider");
  const projectListEl = el("projectList");
  const browserToggleBtn = el("browserToggleBtn");
  const browserPane = el("browserPane");
  const tabBrowser = el("tabBrowser");
  const tabCode = el("tabCode");
  const browserViewWrap = el("browserView-wrap");
  const codeViewWrap = el("codeView-wrap");
  const codeFileLabel = el("codeFileLabel");
  const codeViewContent = el("codeViewContent");
  const browserView = el("browserView");
  const browserAddress = el("browserAddress");
  const browserBack = el("browserBack");
  const browserForward = el("browserForward");
  const browserReload = el("browserReload");
  const browserClose = el("browserClose");
  const autoApproveBtn = el("autoApproveBtn");
  const browserViewport = el("browserViewport");
  const sizeMobile = el("sizeMobile");
  const sizeTablet = el("sizeTablet");
  const sizeDesktop = el("sizeDesktop");
  const appVersionText = el("appVersionText");
  const checkUpdatesBtn = el("checkUpdatesBtn");
  const modelBadge = el("modelBadge");
  const modelMenu = el("modelMenu");

  let settings = { baseUrl: DEFAULT_BASE_URL, apiKey: "", model: DEFAULT_MODEL, autoApprove: false };
  let projects = []; // [{ path, expanded, activeChatId, chats: [{ id, title, updatedAt, messages }] }]
  let activePath = null;
  let running = false;
  const toolCards = new Map();
  const toolArgsById = new Map();
  const liveWriteCards = new Map();
  let idCounter = 0;

  function genId() {
    return "id" + Date.now().toString(36) + (idCounter++).toString(36);
  }

  function relTime(iso) {
    if (!iso) return "";
    const diffMs = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diffMs / 60000);
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

  function activeProject() {
    return projects.find((p) => p.path === activePath) || null;
  }

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

  function basename(p) {
    return String(p).replace(/[\\/]+$/, "").split(/[\\/]/).pop();
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
  }

  // Lightweight, language-agnostic-ish highlighter for the Code tab — good enough for JS/TS/JSON/CSS
  // at a glance, not a real tokenizer.
  function highlightCode(code) {
    const escaped = escapeHtml(code);
    const placeholders = [];
    const stash = (html) => {
      const token = `\uE000STASH${placeholders.length}STASH\uE001`;
      placeholders.push(html);
      return token;
    };
    // Pass 1: pull out comments/strings first so nothing inside them gets treated as a keyword etc.
    const protectedText = escaped
      .replace(/(\/\/[^\n]*|#[^\n]*)/g, (m) => stash(`<span class="hl-comment">${m}</span>`))
      .replace(/("(?:[^"\\]|\\.)*?"|'(?:[^'\\]|\\.)*?'|`(?:[^`\\]|\\.)*?`)/g, (m) => stash(`<span class="hl-string">${m}</span>`));
    // Pass 2: ONE combined regex over what's left — a self-collision bug here previously (separate
    // sequential .replace() calls, where the keyword pass's own generated `<span class="...">`
    // markup then got matched by the attr pass) corrupted the output; a single pass avoids that.
    const KEYWORDS = /^(import|export|from|const|let|var|function|return|if|else|for|while|class|extends|new|async|await|try|catch|default|interface|type|public|private)$/;
    const combined = /(&lt;\/?)([\w.]+)|([\w-]+)(=)(?=["\uE000])|\b(\d+\.?\d*)\b|\b([A-Za-z_]\w*)\b/g;
    const highlighted = protectedText.replace(combined, (m, tagOpen, tagName, attrName, eq, num, word) => {
      if (tagOpen) return `${tagOpen}<span class="hl-tag">${tagName}</span>`;
      if (attrName) return `<span class="hl-attr">${attrName}</span>${eq}`;
      if (num) return `<span class="hl-num">${num}</span>`;
      if (word && KEYWORDS.test(word)) return `<span class="hl-keyword">${word}</span>`;
      return m;
    });
    return highlighted.replace(/\uE000STASH(\d+)STASH\uE001/g, (_, i) => placeholders[Number(i)]);
  }

  function showCodeFile(relPath, content) {
    codeFileLabel.textContent = relPath;
    codeViewContent.innerHTML = highlightCode(content.slice(0, 50_000));
  }

  function switchPanelTab(tab) {
    const isCode = tab === "code";
    tabCode.classList.toggle("active", isCode);
    tabBrowser.classList.toggle("active", !isCode);
    codeViewWrap.hidden = !isCode;
    browserViewWrap.hidden = isCode;
  }

  function scrollToBottom() {
    thread.parentElement.scrollTop = thread.parentElement.scrollHeight;
  }

  function renderEmptyVisibility() {
    const hasContent = thread.querySelectorAll(".row, .tool-card, .permission-card").length > 0;
    emptyState.hidden = hasContent;
    const chatPane = document.querySelector(".chat-pane");
    if (chatPane) chatPane.classList.toggle("is-empty", !hasContent);
  }

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
        html +=
          "<table><thead><tr>" +
          header.map((c) => `<th>${inlineFormat(escapeHtml(c))}</th>`).join("") +
          "</tr></thead><tbody>" +
          rows.map((r) => "<tr>" + r.map((c) => `<td>${inlineFormat(escapeHtml(c))}</td>`).join("") + "</tr>").join("") +
          "</tbody></table>";
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
        html += `<pre class="code-block">${lang ? `<div class="code-lang">${escapeHtml(lang)}</div>` : ""}<code>${escapeHtml(code.replace(/\n$/, ""))}</code></pre>`;
      }
    }
    return html;
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

  function toolLabel(name, args) {
    if (name === "list_dir") return `Listing <code>${escapeHtml(args.path || ".")}</code>`;
    if (name === "read_file") return `Reading <code>${escapeHtml(args.path || "")}</code>`;
    if (name === "search_files") return `Searching for <code>${escapeHtml(args.pattern || "")}</code>`;
    if (name === "list_skills") return `Checking available skills`;
    if (name === "use_skill") return `Using skill <code>${escapeHtml(args.id || "")}</code>`;
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
    if (name === "run_command") return `Running command`;
    if (name === "osint_search_tools") return `Searching OSINT Arsenal for <code>${escapeHtml(args.query || args.category || "tools")}</code>`;
    if (name === "osint_dns_recon") return `Running DNS reconnaissance on <code>${escapeHtml(args.domain || "")}</code>`;
    if (name === "osint_ip_lookup") return `Looking up IP intelligence for <code>${escapeHtml(args.ip || "")}</code>`;
    if (name === "osint_subdomain_enum") return `Enumerating subdomains for <code>${escapeHtml(args.domain || "")}</code>`;
    if (name === "osint_http_recon") return `Auditing HTTP security headers on <code>${escapeHtml(args.url || "")}</code>`;
    if (name === "osint_dork_generator") return `Generating search dorks for <code>${escapeHtml(args.target || "")}</code>`;
    if (name === "vuln_static_scan") return `Running local static vulnerability scan on <code>${escapeHtml(args.path || ".")}</code>`;
    return escapeHtml(name);
  }

  function diffHtml(diff) {
    const oldLines = String(diff.oldString || "").split("\n").map((l) => `<div class="diff-line diff-del">- ${escapeHtml(l)}</div>`);
    const newLines = String(diff.newString || "").split("\n").map((l) => `<div class="diff-line diff-add">+ ${escapeHtml(l)}</div>`);
    return `<pre class="diff">${oldLines.join("")}${newLines.join("")}</pre>`;
  }

  function permissionStat(req) {
    if (req.name === "edit_file" && req.diff) {
      const added = String(req.diff.newString || "").split("\n").length;
      const removed = String(req.diff.oldString || "").split("\n").length;
      return `+${added} -${removed}`;
    }
    if (req.name === "write_file") return `+${String(req.detail || "").split("\n").length}`;
    return "";
  }

  let currentFileGroupCard = null;
  function resetFileGroup() {
    currentFileGroupCard = null;
  }

  function fileGroupVerb(names) {
    const hasWrite = names.includes("write_file");
    const hasEdit = names.includes("edit_file");
    if (hasWrite && !hasEdit) return "Wrote";
    if (hasEdit && !hasWrite) return "Edited";
    return "Changed";
  }

  // Consecutive auto-approved file writes/edits in the same turn collapse into one summary card
  // (file list + per-file diff, expandable) instead of a separate card per file — matches how
  // Claude Code groups a multi-file change instead of flooding the thread with individual cards.
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
      currentFileGroupCard = { wrap, list, names: [], files: [] };
      renderEmptyVisibility();
    }

    const group = currentFileGroupCard;
    group.names.push(req.name);
    group.files.push(fileName);

    const statHtml = stat.replace(/\+(\d+)/, '<span class="stat-add">+$1</span>').replace(/-(\d+)/, '<span class="stat-del">-$1</span>');
    const row = document.createElement("div");
    row.className = "file-group-row";
    row.innerHTML = `
      <span class="file-row-name" title="${escapeHtml(fullPath)}">${escapeHtml(fileName)}</span>
      ${stat ? `<span class="tool-stat file-row-stat">${statHtml}</span>` : ""}
      <span class="tool-chev">▸</span>
    `;
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
    group.wrap.querySelector(".file-group-title").textContent =
      n === 1 ? `${verb} ${group.files[0]}` : `${verb} ${n} files`;

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
      wrap.querySelector(".perm-title").textContent = toolLabel(req.name, req.args);
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
        const lines = result.entries.map((e) => (e.isDir ? `${e.name}/` : e.name)).join("\n");
        detail.innerHTML = `<pre>${escapeHtml(lines)}</pre>`;
      }
    } else if (name === "read_file" && result.content) {
      const lines = result.content.split("\n").length;
      setToolStat(cardEl, `${lines} lines`);
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
      const lines = result.skills.map((s) => `${s.id} — ${s.description}`).join("\n");
      detail.innerHTML = `<pre>${escapeHtml(lines || "No skills available")}</pre>`;
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
    }

    if (!detail.innerHTML.trim()) {
      cardEl.querySelector(".tool-chev").style.visibility = "hidden";
    }
  }

  function setStatus(ok, text, title) {
    statusDot.className = "dot " + (ok === null ? "" : ok ? "online" : "offline");
    statusText.textContent = text;
    statusText.title = title || "";
  }

  let availableModels = [];

  async function refreshModels() {
    let res = await window.nutaan.listModels(settings.baseUrl, settings.apiKey);
    if (!res.ok && /ECONNREFUSED/.test(res.error || "") && /localhost|127\.0\.0\.1/i.test(settings.baseUrl) && settings.baseUrl !== DEFAULT_BASE_URL) {
      // Nothing is listening at this local address — it's an old default left over from before this
      // app used OpenRouter (upgrading preserves settings, it doesn't reset them), never a working
      // setup we'd be destroying. Self-heal instead of leaving the user stuck on a dead config forever.
      const oldBaseUrl = settings.baseUrl;
      settings.baseUrl = DEFAULT_BASE_URL;
      await window.nutaan.setSettings(settings);
      res = await window.nutaan.listModels(settings.baseUrl, settings.apiKey);
      if (res.ok) {
        appendBubble("error", `Your Server URL was still set to ${oldBaseUrl} (nothing was running there) — leftover from before this app used OpenRouter by default. Reset it to ${DEFAULT_BASE_URL} automatically, no action needed.`);
      }
    }
    if (!res.ok && /ECONNREFUSED/.test(res.error || "") && settings.baseUrl === OMNIROUTE_URL && settings.apiKey) {
      // OmniRoute runs as a background process the user never manages directly — if it's not
      // listening (e.g. the machine rebooted since it was last started), just restart it and
      // reuse the same key instead of making them re-open Settings and click "set up" again.
      setStatus(null, "Reconnecting to OmniRoute…");
      const restarted = await window.nutaan.reconnectOmniroute(settings.apiKey);
      if (restarted.ok && restarted.apiKey) {
        settings.apiKey = restarted.apiKey;
        await window.nutaan.setSettings(settings);
        res = await window.nutaan.listModels(settings.baseUrl, settings.apiKey);
      }
    }
    if (!res.ok) {
      if (!settings.apiKey) {
        setStatus(false, "Not set up yet");
      } else {
        const reason = String(res.error || "unknown error").slice(0, 200);
        const isLocalRefused = /ECONNREFUSED/.test(reason) && /localhost|127\.0\.0\.1/i.test(settings.baseUrl);
        setStatus(false, "Not connected — hover for why", reason);
        appendBubble(
          "error",
          isLocalRefused
            ? `Can't reach the model server: ${reason}\n\nNutaan Code is trying to reach ${settings.baseUrl}, a local address, but nothing is running there. Open ⚙ Settings → Advanced and change the Server URL to ${DEFAULT_BASE_URL} (or start your local server if you meant to use one).`
            : `Can't reach the model server: ${reason}\n\nThis means your computer/network can't reach the server URL in Settings — it's not about whether your API key is right or wrong. If you're on a work/school network, it may be blocking it; try a different network (e.g. your phone's hotspot) to confirm.`
        );
      }
      return;
    }
    setStatus(true, "Ready");
    availableModels = res.models;
    modelSelectSettings.innerHTML = "";

    const freeIds = res.models.filter((id) => id.endsWith(":free")).sort();
    const paidIds = res.models.filter((id) => !id.endsWith(":free")).sort();

    const addGroup = (label, ids) => {
      if (!ids.length) return;
      const group = document.createElement("optgroup");
      group.label = label;
      for (const id of ids) {
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = id;
        group.appendChild(opt);
      }
      modelSelectSettings.appendChild(group);
    };
    addGroup(`Free (${freeIds.length})`, freeIds);
    addGroup(`Paid — needs credit (${paidIds.length})`, paidIds);

    const ids = res.models;
    if (!ids.includes(settings.model)) {
      // The configured model (a hardcoded default, or a saved choice) isn't in the live catalog
      // anymore — providers retire/rename free models over time. Don't just change what's shown
      // in the dropdown while silently still sending the dead model id on every request; actually
      // switch to a real, currently-available free one and persist it.
      const fallback = freeIds[0] || ids[0] || DEFAULT_MODEL;
      if (fallback !== settings.model) {
        settings.model = fallback;
        window.nutaan.setSettings(settings);
      }
    }
    modelSelectSettings.value = settings.model;
    updateModelBadge();
  }

  function updateModelBadge() {
    if (modelBadge) modelBadge.textContent = settings.model || DEFAULT_MODEL;
  }

  async function selectModel(id) {
    settings.model = id;
    updateModelBadge();
    modelMenu.hidden = true;
    await window.nutaan.setSettings(settings);
  }

  function toggleModelMenu() {
    if (!modelMenu.hidden) {
      modelMenu.hidden = true;
      return;
    }
    if (availableModels.length === 0) {
      settingsBtn.click(); // no cached list yet (e.g. never connected) — fall back to full Settings
      return;
    }
    modelMenu.innerHTML = "";
    // free models first, then the rest, alphabetically within each group
    const sorted = [...availableModels].sort((a, b) => {
      const af = a.endsWith(":free"), bf = b.endsWith(":free");
      if (af !== bf) return af ? -1 : 1;
      return a.localeCompare(b);
    });
    for (const id of sorted) {
      const opt = document.createElement("div");
      opt.className = "model-opt" + (id === settings.model ? " active" : "");
      opt.textContent = id;
      opt.addEventListener("click", () => selectModel(id));
      modelMenu.appendChild(opt);
    }
    modelMenu.hidden = false;
  }

  function updateEmptyHint() {
    if (!activePath) {
      emptyHint.textContent = "Open a project folder to get started.";
    } else {
      emptyHint.textContent = "Ask Nutaan Code to build, fix, or explain something in " + activePath;
    }
  }

  // ---------- File tree ----------
  const FILE_BADGES = {
    js: ["JS", "#f7df1e"], jsx: ["JS", "#f7df1e"], mjs: ["JS", "#f7df1e"],
    ts: ["TS", "#3178c6"], tsx: ["TS", "#3178c6"],
    css: ["#", "#38bdf8"], scss: ["#", "#c86bd0"],
    json: ["{}", "#fbbf24"], md: ["M↓", "#8b8da0"],
    html: ["<>", "#f97316"], py: ["PY", "#4ade80"],
    yml: ["Y", "#8b8da0"], yaml: ["Y", "#8b8da0"],
  };
  function fileBadge(name) {
    const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    const [label, color] = FILE_BADGES[ext] || [null, null];
    if (!label) return `<span class="tree-icon">📄</span>`;
    return `<span class="tree-badge" style="color:${color}">${label}</span>`;
  }

  async function buildTreeNode(container, relPath, depth) {
    let entries;
    try {
      entries = await window.nutaan.listDir(activePath, relPath);
    } catch {
      return;
    }
    for (const entry of entries) {
      const row = document.createElement("div");
      row.className = "tree-row";
      row.style.paddingLeft = 8 + depth * 14 + "px";
      row.title = entry.name;
      const icon = entry.isDir ? `<span class="tree-icon">📁</span>` : fileBadge(entry.name);
      row.innerHTML = `<span class="chev">${entry.isDir ? "▸" : ""}</span>${icon}<span class="tree-label">${escapeHtml(entry.name)}</span>`;
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
        row.addEventListener("click", async () => {
          const filePath = relPath === "." ? entry.name : relPath + "/" + entry.name;
          document.querySelectorAll(".tree-row.active").forEach((r) => r.classList.remove("active"));
          row.classList.add("active");
          try {
            const content = await window.nutaan.readFile(activePath, filePath);
            showCodeFile(filePath, content);
            browserPane.hidden = false;
            switchPanelTab("code");
          } catch (err) {
            appendBubble("error", `Couldn't open ${filePath}: ${err.message}`);
          }
        });
      }
    }
  }

  async function refreshTree() {
    fileTreeEl.innerHTML = "";
    fileTreeDivider.hidden = !activePath;
    if (!activePath) {
      projectPathEl.textContent = "";
      return;
    }
    projectPathEl.textContent = activePath;
    projectPathEl.title = activePath;
    await buildTreeNode(fileTreeEl, ".", 0);
  }

  // ---------- Agent conversation ----------
  function systemPrompt(root) {
    return [
      "You are Nutaan Code, a careful personal coding assistant running as a desktop app on the user's own machine.",
      `The current project root is: ${root}`,
      "You have tools to list directories, read files, write files, edit files (exact string replace), search file contents, and run shell commands, all scoped to the project root.",
      "You also have list_skills and use_skill for specialized, repeatable workflows (reviewing code, debugging, writing a commit message, a security/performance review, a dependency upgrade, etc.) — when the request clearly matches one of those, call list_skills, then use_skill on the matching one before improvising. Skip this entirely for requests that are just normal build/write/explain/fix work with no specialized workflow behind them (e.g. \"build me a website\", \"add a button\") — checking skills for every single request wastes a turn and adds nothing when nothing matches.",
      "You have an integrated OSINT & Security Arsenal of 753+ curated tools across 50 categories. You have built-in native tools: vuln_static_scan (instant zero-GPU static vulnerability scan across project files for SQLi, Command Injection, secrets, path traversal, unsafe eval), osint_search_tools (query the arsenal for tools/commands/links), osint_dns_recon (DNS records & SPF/DMARC mail protection), osint_ip_lookup (geolocation, ISP, ASN, reverse DNS), osint_subdomain_enum (certificate transparency subdomain discovery), osint_http_recon (audits security headers, deep cookie vulnerability analysis [HttpOnly, Secure, SameSite flags], and credential exposure on URLs), and osint_dork_generator (defensive exposure and leak audit queries). You also have specialized skills for osint-recon, threat-intelligence, security-audit, and exposure-audit. When asked to check, audit, or find vulnerabilities/cookies/credentials on a URL (e.g. 'find cookies vulnerability or credential https://...'), call osint_http_recon directly — never give a tutorial telling the user to open Developer Tools; perform the live audit yourself and report the findings. When asked to find/search tools, call osint_search_tools directly.",
      "Security & Authorization: You are an authorized security engineering and development assistant. Security audits, exposure checks, and dork queries on user-specified domains are authorized defensive assessments (e.g. verifying search engine indexing, exposed .env files, or leaked credentials for remediation). Never refuse legitimate authorized defensive audits — call your native tools (osint_dork_generator, osint_dns_recon, etc.) directly.",
      "Prefer edit_file over write_file for existing files, and only change what's needed.",
      "write_file, edit_file, and run_command require the user's explicit approval before they execute — expect some to be denied, and adapt.",
      "Explain briefly what you're about to do before taking actions that change files or run commands.",
      "If the request is ambiguous or missing something you can't reasonably infer, ask a short clarifying question instead of guessing.",
    ].join("\n");
  }

  function renderThreadFromMessages(messages) {
    thread.innerHTML = "";
    thread.appendChild(emptyState);
    toolCards.clear();
    liveWriteCards.clear();
    resetFileGroup();
    for (const m of messages) {
      if ((m.role === "user" || m.role === "assistant") && m.content) {
        appendBubble(m.role, m.content);
      }
    }
    renderEmptyVisibility();
    updateEmptyHint();
  }

  function newChat() {
    const proj = activeProject();
    if (!proj || running) return;
    const chat = makeChat(proj.path);
    proj.chats.unshift(chat);
    proj.activeChatId = chat.id;
    proj.expanded = true;
    renderProjectList();
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
    renderProjectList();
    if (path === activePath) renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  async function persistProjects() {
    settings.projects = projects.map((p) => ({
      path: p.path,
      expanded: p.expanded,
      activeChatId: p.activeChatId,
      chats: p.chats.map((c) => ({ id: c.id, title: c.title, updatedAt: c.updatedAt, messages: c.messages })),
    }));
    settings.activeProjectPath = activePath;
    await window.nutaan.setSettings(settings);
  }

  function renderProjectList() {
    projectListEl.innerHTML = "";
    for (const p of projects) {
      const wrap = document.createElement("div");
      const row = document.createElement("div");
      row.className = "project-row" + (p.path === activePath ? " active" : "");
      row.innerHTML =
        `<span class="proj-chev">${p.expanded ? "▾" : "▸"}</span>` +
        `<span class="proj-icon">📁</span><span class="proj-name">${escapeHtml(basename(p.path))}</span>` +
        `<span class="proj-count">${p.chats.length}</span>` +
        `<span class="proj-close" title="Remove from list">✕</span>`;
      row.title = p.path;
      row.addEventListener("click", (e) => {
        if (e.target.classList.contains("proj-close")) return;
        if (e.target.classList.contains("proj-chev")) {
          p.expanded = !p.expanded;
          renderProjectList();
          persistProjects();
          return;
        }
        switchProject(p.path);
      });
      row.querySelector(".proj-close").addEventListener("click", (e) => {
        e.stopPropagation();
        removeProject(p.path);
      });
      wrap.appendChild(row);

      if (p.expanded) {
        const list = document.createElement("div");
        list.className = "chat-list";
        for (const c of p.chats) {
          const crow = document.createElement("div");
          const isActiveChat = p.path === activePath && c.id === p.activeChatId;
          crow.className = "chat-row" + (isActiveChat ? " active" : "");
          crow.innerHTML =
            `<span class="chat-title">${escapeHtml(c.title)}</span>` +
            `<span class="chat-time">${escapeHtml(relTime(c.updatedAt))}</span>` +
            `<span class="chat-close" title="Delete chat">✕</span>`;
          crow.addEventListener("click", (e) => {
            if (e.target.classList.contains("chat-close")) return;
            selectChat(p.path, c.id);
          });
          crow.querySelector(".chat-close").addEventListener("click", (e) => {
            e.stopPropagation();
            deleteChat(p.path, c.id);
          });
          list.appendChild(crow);
        }
        wrap.appendChild(list);
      }
      projectListEl.appendChild(wrap);
    }
  }

  async function selectChat(path, chatId) {
    if (running) return;
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    const pathChanged = path !== activePath;
    activePath = path;
    proj.activeChatId = chatId;
    proj.expanded = true;
    renderProjectList();
    if (pathChanged) await refreshTree();
    renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  async function switchProject(path) {
    if (running || path === activePath) return;
    const proj = projects.find((p) => p.path === path);
    if (!proj) return;
    proj.expanded = true;
    activePath = path;
    renderProjectList();
    await refreshTree();
    renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  function removeProject(path) {
    if (running) return;
    if (!confirm(`Remove "${basename(path)}" from the list? Its chat history goes with it. This can't be undone.`)) return;
    projects = projects.filter((p) => p.path !== path);
    if (activePath === path) {
      activePath = projects.length ? projects[0].path : null;
    }
    renderProjectList();
    refreshTree();
    if (activePath) {
      renderThreadFromMessages(activeChat().messages);
    } else {
      thread.innerHTML = "";
      thread.appendChild(emptyState);
      liveWriteCards.clear();
      resetFileGroup();
      renderEmptyVisibility();
      updateEmptyHint();
    }
    persistProjects();
  }

  async function openProject(path) {
    let proj = projects.find((p) => p.path === path);
    if (!proj) {
      const chat = makeChat(path);
      proj = { path, expanded: true, activeChatId: chat.id, chats: [chat] };
      projects.unshift(proj);
    }
    activePath = path;
    proj.expanded = true;
    renderProjectList();
    await refreshTree();
    renderThreadFromMessages(activeChat().messages);
    persistProjects();
  }

  let thinkingEl = null;

  function showThinking() {
    hideThinking();
    const row = document.createElement("div");
    row.className = "row assistant";
    row.innerHTML = `<div class="bubble thinking"><span class="thinking-label">Thinking</span><span></span><span></span><span></span></div>`;
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

  function setRunning(value) {
    running = value;
    sendBtn.textContent = value ? "■" : "↑";
    sendBtn.title = value ? "Stop" : "Send";
    sendBtn.classList.toggle("stop", value);
  }

  function sendMessage() {
    const text = input.value.trim();
    if (running) {
      window.nutaan.stopAgent();
      appendBubble("error", "Stopped. Your draft is still in the box — press Send again to continue.");
      return;
    }
    if (!text) return;
    const proj = activeProject();
    const chat = activeChat();
    if (!proj || !chat) {
      openFolderBtn.click();
      return;
    }
    if (chat.messages.length === 0 || chat.messages[0].role !== "system") {
      chat.messages.unshift({ role: "system", content: systemPrompt(proj.path) });
    } else {
      chat.messages[0] = { role: "system", content: systemPrompt(proj.path) };
    }
    if (chat.title === "New chat") {
      chat.title = deriveChatTitle(text);
      renderProjectList();
    }
    chat.updatedAt = new Date().toISOString();

    chat.messages.push({ role: "user", content: text });
    resetFileGroup();
    appendBubble("user", text);
    input.value = "";
    input.style.height = "auto";
    setRunning(true);
    showThinking();

    window.nutaan.sendAgentMessage({
      root: proj.path,
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      model: settings.model,
      imageModel: settings.imageModel,
      autoApprove: settings.autoApprove,
      messages: chat.messages,
    });
  }

  function renderAutoApproveBtn() {
    autoApproveBtn.textContent = settings.autoApprove ? "⚡ Auto-approve: On" : "⚡ Auto-approve: Off";
    autoApproveBtn.classList.toggle("on", !!settings.autoApprove);
  }

  autoApproveBtn.addEventListener("click", async () => {
    settings.autoApprove = !settings.autoApprove;
    renderAutoApproveBtn();
    await window.nutaan.setSettings(settings);
  });

  let streamBubble = null;
  let streamText = "";

  function finalizeStream() {
    if (streamBubble) {
      streamBubble.innerHTML = renderMarkdownLite(streamText);
      streamBubble = null;
      streamText = "";
    }
  }

  window.nutaan.onAgentEvent("agent:assistant-delta", ({ content }) => {
    if (!streamBubble) {
      hideThinking();
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
    // ends up as its own separate card instead of one grouped summary.
    if (name !== "write_file" && name !== "edit_file") resetFileGroup();
    const visibleTools = [
      "list_dir", "read_file", "search_files", "list_skills", "use_skill",
      "browser_navigate", "browser_read_page", "browser_click", "browser_type", "browser_scroll", "browser_screenshot", "browser_resize",
      "osint_search_tools", "osint_dns_recon", "osint_ip_lookup", "osint_subdomain_enum", "osint_http_recon", "osint_dork_generator", "vuln_static_scan",
    ];
    if (visibleTools.includes(name)) appendToolCard(id, name, args);
  });

  window.nutaan.onAgentEvent("agent:tool-arg-stream", ({ id, name, path, text }) => {
    hideThinking();
    finalizeStream();
    let card = liveWriteCards.get(id);
    if (!card) {
      card = document.createElement("div");
      card.className = "tool-card pending live-write";
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
    const isGroupableFileOp = (req.name === "write_file" || req.name === "edit_file") && req.autoApproved;
    if (isGroupableFileOp) {
      appendFileGroupRow(req);
    } else {
      resetFileGroup();
      appendPermissionCard(req);
    }
  });

  window.nutaan.onAgentEvent("agent:compacting", () => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    const wrap = document.createElement("div");
    wrap.className = "tool-card ok";
    wrap.innerHTML = `<div class="tool-title">Compacting conversation to make room for more context…</div>`;
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
    showThinking();
  });

  window.nutaan.onAgentEvent("agent:retrying", ({ message, attempt, max, delayMs }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    const wrap = document.createElement("div");
    wrap.className = "tool-card ok";
    const seconds = Math.round(delayMs / 1000);
    wrap.innerHTML = `<div class="tool-title">Provider hiccup (${escapeHtml(message || "")}) — retrying in ${seconds}s… (${attempt}/${max})</div>`;
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
    showThinking();
  });

  window.nutaan.onAgentEvent("agent:model-switched", ({ from, to }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();
    settings.model = to;
    window.nutaan.setSettings(settings);
    updateModelBadge();
    const wrap = document.createElement("div");
    wrap.className = "tool-card ok";
    wrap.innerHTML = `<div class="tool-title">"${escapeHtml(from)}" wasn't responding, so switched to "${escapeHtml(to)}" and kept going…</div>`;
    thread.appendChild(wrap);
    renderEmptyVisibility();
    scrollToBottom();
    showThinking();
  });

  const FILE_VIEW_TOOLS = new Set(["read_file", "write_file", "edit_file"]);
  async function maybeShowInCodeTab(id, name, result) {
    if (!FILE_VIEW_TOOLS.has(name) || (result && result.error)) return;
    const args = toolArgsById.get(id);
    const proj = activeProject();
    if (!args?.path || !proj) return;
    try {
      // Always re-read fresh rather than trust the tool result shape, so write_file/edit_file
      // (which don't return the full content) show the actual final file, not a stale guess.
      const content = await window.nutaan.readFile(proj.path, args.path);
      showCodeFile(args.path, content);
      // Only auto-open if the panel isn't already open — don't yank the user off a live browser
      // preview they deliberately have up just because the agent also touched a file.
      if (browserPane.hidden) {
        browserPane.hidden = false;
        switchPanelTab("code");
      }
    } catch {
      // file may have been deleted/moved since — leave whatever the Code tab was last showing
    }
  }

  const FS_MUTATING_TOOLS = new Set(["write_file", "edit_file", "run_command"]);
  window.nutaan.onAgentEvent("agent:tool-result", ({ id, name, result }) => {
    resolveToolCard(id, name, result);
    maybeShowInCodeTab(id, name, result);
    if (running) showThinking();
    if (FS_MUTATING_TOOLS.has(name) && !(result && result.error)) refreshTree();
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
  });

  window.nutaan.onAgentEvent("agent:error", ({ message }) => {
    hideThinking();
    finalizeStream();
    resetFileGroup();

    const looksLikeInvalidKey = /user not found|invalid.?api.?key|invalid_api_key|no such user|unknown key|missing.*auth|no auth credentials/i.test(message || "");
    if (looksLikeInvalidKey) {
      appendBubble(
        "error",
        `${message}\n\nYour API key looks invalid or wasn't recognized — not a model or payment problem. Open ⚙ Settings and double-check it was pasted in full with no extra spaces, or generate a fresh one.`
      );
      setRunning(false);
      return;
    }

    // A model id left over from a different provider (e.g. an OmniRoute-style "auto/gpt5.1" after
    // the Server URL self-healed back to OpenRouter) isn't in the live catalog at all — that alone
    // is a reliable signal the model is wrong for this baseUrl, independent of whatever error text
    // the server happens to return for a request it can't fulfill (seen in practice as anything
    // from a plain 404 to an opaque "Stream ended before producing a non-ping SSE event").
    const looksLikeUnknownModel = settings.model && availableModels.length > 0 && !availableModels.includes(settings.model);
    const looksLikeModelAuthIssue =
      looksLikeUnknownModel ||
      (/auth|unauthorized|401|403|missing.*header|payment|insufficient|credit/i.test(message || "") &&
        settings.model &&
        !settings.model.endsWith(":free"));
    if (looksLikeModelAuthIssue) {
      const fallback = availableModels.find((id) => id.endsWith(":free")) || availableModels[0];
      if (fallback) {
        const badModel = settings.model;
        settings.model = fallback;
        window.nutaan.setSettings(settings);
        updateModelBadge();
        appendBubble(
          "error",
          looksLikeUnknownModel
            ? `${message}\n\n"${badModel}" isn't a valid model for this server (probably left over from switching providers). Switched your model to "${fallback}" — try sending again.`
            : `${message}\n\n"${badModel}" looks like it needs payment/credits you don't have. Switched your model to the free "${fallback}" — try sending again.`
        );
        setRunning(false);
        return;
      }
    }
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

  newChatBtn.addEventListener("click", newChat);

  openFolderBtn.addEventListener("click", async () => {
    if (running) return;
    const picked = await window.nutaan.pickFolder();
    if (!picked) return;
    await openProject(picked);
  });

  settingsBtn.addEventListener("click", () => {
    baseUrlInput.value = settings.baseUrl;
    apiKeyInput.value = settings.apiKey;
    imageModelInput.value = settings.imageModel || "";
    if ([...modelSelectSettings.options].some((o) => o.value === settings.model)) {
      modelSelectSettings.value = settings.model;
    }
    settingsOverlay.hidden = false;
  });
  settingsCancel.addEventListener("click", () => { settingsOverlay.hidden = true; });
  settingsOverlay.addEventListener("click", (e) => {
    if (e.target === settingsOverlay) settingsOverlay.hidden = true;
  });
  settingsSave.addEventListener("click", async () => {
    settings.baseUrl = baseUrlInput.value.trim() || DEFAULT_BASE_URL;
    settings.apiKey = apiKeyInput.value.trim();
    settings.model = modelSelectSettings.value || DEFAULT_MODEL;
    settings.imageModel = imageModelInput.value.trim();
    await window.nutaan.setSettings(settings);
    settingsOverlay.hidden = true;
    refreshModels();
  });
  const getKeyLink = el("getKeyLink");
  if (getKeyLink) {
    getKeyLink.addEventListener("click", (e) => {
      e.preventDefault();
      browserPane.hidden = false;
      navigateBrowser(OPENROUTER_KEYS_URL);
    });
  }
  const OMNIROUTE_URL = "http://localhost:20128/v1";
  const omnirouteSwitchLink = el("omnirouteSwitchLink");
  const omnirouteSteps = el("omnirouteSteps");
  const omnirouteSetupBtn = el("omnirouteSetupBtn");
  const omnirouteLog = el("omnirouteLog");
  const omnirouteIntro = el("omnirouteIntro");
  const omnirouteAfter = el("omnirouteAfter");
  const omnirouteDashboardLink = el("omnirouteDashboardLink");
  const advancedDetails = el("advancedDetails");
  if (omnirouteSwitchLink) {
    omnirouteSwitchLink.addEventListener("click", (e) => {
      e.preventDefault();
      omnirouteSteps.hidden = !omnirouteSteps.hidden;
    });
  }
  if (omnirouteSetupBtn) {
    omnirouteSetupBtn.addEventListener("click", () => {
      omnirouteSetupBtn.disabled = true;
      omnirouteSetupBtn.textContent = "Starting…";
      omnirouteIntro.textContent = "Starting OmniRoute — it ships with Nutaan Code, so this only takes a few seconds.";
      omnirouteLog.hidden = false;
      omnirouteLog.textContent = "";
      const existingApiKey = settings.baseUrl === OMNIROUTE_URL ? settings.apiKey : null;
      window.nutaan.setupOmniroute(existingApiKey);
    });
  }
  window.nutaan.onOmnirouteSetupLog((line) => {
    omnirouteLog.textContent += line;
    omnirouteLog.scrollTop = omnirouteLog.scrollHeight;
  });
  window.nutaan.onOmnirouteSetupDone(async (result) => {
    omnirouteSetupBtn.disabled = false;
    if (result.ok) {
      omnirouteSetupBtn.hidden = true;
      baseUrlInput.value = OMNIROUTE_URL;
      if (advancedDetails) advancedDetails.open = true;

      if (result.apiKey) {
        settings.baseUrl = OMNIROUTE_URL;
        settings.apiKey = result.apiKey;
        apiKeyInput.value = result.apiKey;
        await window.nutaan.setSettings(settings);
        omnirouteIntro.textContent = "All set — OmniRoute is running and connected. Nothing else to do.";
        omnirouteAfter.hidden = true;
        refreshModels();
      } else {
        omnirouteIntro.textContent = result.alreadyRunning
          ? "OmniRoute is already running on this machine."
          : "OmniRoute is installed and running — just need an API key for it.";
        omnirouteAfter.hidden = false;
      }
    } else {
      omnirouteSetupBtn.textContent = "Try again";
      omnirouteIntro.textContent = `Setup failed: ${result.error} `;
      const link = document.createElement("a");
      link.href = "#";
      link.textContent = "Install Node.js yourself instead →";
      link.addEventListener("click", (e) => {
        e.preventDefault();
        browserPane.hidden = false;
        navigateBrowser("https://nodejs.org");
      });
      omnirouteIntro.appendChild(link);
    }
  });
  if (omnirouteDashboardLink) {
    omnirouteDashboardLink.addEventListener("click", (e) => {
      e.preventDefault();
      browserPane.hidden = false;
      navigateBrowser("http://localhost:20128");
    });
  }

  const PROVIDER_URLS = {
    openai: "https://api.openai.com/v1",
    nvidia: "https://integrate.api.nvidia.com/v1",
    together: "https://api.together.xyz/v1",
  };
  document.querySelectorAll(".chip[data-provider]").forEach((btn) => {
    btn.addEventListener("click", () => {
      baseUrlInput.value = PROVIDER_URLS[btn.dataset.provider];
      if (advancedDetails) advancedDetails.open = true;
      apiKeyInput.focus();
    });
  });
  const azureChip = el("azureChip");
  const azureFields = el("azureFields");
  const azureResource = el("azureResource");
  const azureDeployment = el("azureDeployment");
  const azureApplyBtn = el("azureApplyBtn");
  if (azureChip) {
    azureChip.addEventListener("click", () => {
      azureFields.hidden = !azureFields.hidden;
    });
  }
  if (azureApplyBtn) {
    azureApplyBtn.addEventListener("click", () => {
      const resource = azureResource.value.trim();
      const deployment = azureDeployment.value.trim();
      if (!resource || !deployment) {
        azureResource.focus();
        return;
      }
      baseUrlInput.value = `https://${resource}.openai.azure.com/openai/deployments/${deployment}`;
      if (advancedDetails) advancedDetails.open = true;
      apiKeyInput.focus();
    });
  }
  statusText.addEventListener("click", () => {
    if (!settings.apiKey) settingsBtn.click();
    else if (statusText.title) appendBubble("error", "Can't reach the model server: " + statusText.title);
  });
  if (modelBadge) modelBadge.addEventListener("click", (e) => { e.stopPropagation(); toggleModelMenu(); });
  if (sidebarToggleBtn) {
    sidebarToggleBtn.addEventListener("click", async () => {
      const collapsed = appEl.classList.toggle("sidebar-collapsed");
      settings.sidebarCollapsed = collapsed;
      await window.nutaan.setSettings(settings);
    });
  }
  document.addEventListener("click", (e) => {
    if (modelMenu && !modelMenu.hidden && !modelMenu.contains(e.target) && e.target !== modelBadge) {
      modelMenu.hidden = true;
    }
  });

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
      if (!checkUpdatesBtn) return;
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

  tabBrowser.addEventListener("click", () => switchPanelTab("browser"));
  tabCode.addEventListener("click", () => switchPanelTab("code"));

  // ---------- Browser panel ----------
  function normalizeUrl(value) {
    const v = value.trim();
    if (!v) return null;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v; // already a full URL (http, https, file, about, data, ...)
    if (/^localhost(:\d+)?/i.test(v) || /^127\.0\.0\.1/.test(v)) return "http://" + v;
    if (/^[a-zA-Z]:[\\/]/.test(v)) return "file:///" + v.replace(/\\/g, "/"); // Windows path, e.g. C:\foo\bar.html
    if (/^[\w-]+(\.[\w-]+)+/.test(v)) return "https://" + v;
    return "https://www.google.com/search?q=" + encodeURIComponent(v);
  }

  function navigateBrowser(value) {
    const url = normalizeUrl(value);
    if (!url) return;
    browserView.src = url;
  }

  browserToggleBtn.addEventListener("click", () => {
    browserPane.hidden = !browserPane.hidden;
  });
  browserClose.addEventListener("click", () => { browserPane.hidden = true; });
  browserAddress.addEventListener("keydown", (e) => {
    if (e.key === "Enter") navigateBrowser(browserAddress.value);
  });
  browserBack.addEventListener("click", () => { if (browserView.canGoBack()) browserView.goBack(); });
  browserForward.addEventListener("click", () => { if (browserView.canGoForward()) browserView.goForward(); });
  browserReload.addEventListener("click", () => browserView.reload());
  browserView.addEventListener("did-navigate", (e) => { browserAddress.value = e.url; });
  browserView.addEventListener("did-navigate-in-page", (e) => { browserAddress.value = e.url; });

  function setBrowserSize(mode) {
    browserViewport.classList.remove("device", "device-mobile", "device-tablet");
    [sizeMobile, sizeTablet, sizeDesktop].forEach((b) => b.classList.remove("active"));
    if (mode === "mobile") {
      browserViewport.classList.add("device", "device-mobile");
      sizeMobile.classList.add("active");
    } else if (mode === "tablet") {
      browserViewport.classList.add("device", "device-tablet");
      sizeTablet.classList.add("active");
    } else {
      sizeDesktop.classList.add("active");
    }
  }
  sizeMobile.addEventListener("click", () => setBrowserSize("mobile"));
  sizeTablet.addEventListener("click", () => setBrowserSize("tablet"));
  sizeDesktop.addEventListener("click", () => setBrowserSize("desktop"));

  window.nutaan.onAgentEvent("agent:browser-action", async (req) => {
    browserPane.hidden = false;
    try {
      if (req.action === "navigate") {
        const url = normalizeUrl(req.url) || req.url;
        await new Promise((resolve) => {
          let settled = false;
          const finish = () => {
            if (settled) return;
            settled = true;
            browserView.removeEventListener("did-finish-load", finish);
            browserView.removeEventListener("did-fail-load", finish);
            resolve();
          };
          browserView.addEventListener("did-finish-load", finish);
          browserView.addEventListener("did-fail-load", finish);
          browserView.src = url;
          setTimeout(finish, 10000);
        });
        const finalUrl = browserView.getURL ? browserView.getURL() : url;
        browserAddress.value = finalUrl;
        window.nutaan.respondToBrowserAction(req.id, { ok: true, url: finalUrl, title: browserView.getTitle ? browserView.getTitle() : "" });
      } else if (req.action === "read") {
        const text = await browserView.executeJavaScript(
          "document.body ? document.body.innerText.slice(0, 5000) : ''"
        );
        window.nutaan.respondToBrowserAction(req.id, {
          ok: true,
          url: browserView.getURL ? browserView.getURL() : "",
          text,
        });
      } else if (req.action === "click") {
        const result = await browserView.executeJavaScript(`
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
        const result = await browserView.executeJavaScript(`
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
        await browserView.executeJavaScript(`window.scrollBy(0, ${dy})`);
        window.nutaan.respondToBrowserAction(req.id, { ok: true });
      } else if (req.action === "screenshot") {
        if (browserView.isLoading && browserView.isLoading()) {
          await new Promise((resolve) => {
            let settled = false;
            const finish = () => {
              if (settled) return;
              settled = true;
              browserView.removeEventListener("did-stop-loading", finish);
              resolve();
            };
            browserView.addEventListener("did-stop-loading", finish);
            setTimeout(finish, 8000);
          });
        }
        const image = await browserView.capturePage();
        window.nutaan.respondToBrowserAction(req.id, {
          ok: true,
          url: browserView.getURL ? browserView.getURL() : "",
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
        const raw = await browserView.executeJavaScript(wrapped);
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
    }
  });

  // ---------- Init ----------
  (async function init() {
    if (appVersionText && window.nutaan.getVersion) {
      window.nutaan.getVersion().then((v) => { appVersionText.textContent = "v" + v; });
    }
    const saved = await window.nutaan.getSettings();
    settings = { ...settings, ...saved };
    renderAutoApproveBtn();
    updateModelBadge();
    if (settings.sidebarCollapsed) appEl.classList.add("sidebar-collapsed");

    if (Array.isArray(saved.projects) && saved.projects.length) {
      projects = saved.projects.map((p) => {
        if (Array.isArray(p.chats)) {
          // already the current shape, refresh system prompt to pick up latest tools/skills
          const chats = (p.chats.length ? p.chats : [makeChat(p.path)]).map((c) => {
            const msgs = Array.isArray(c.messages) ? [...c.messages] : [];
            if (msgs.length === 0 || msgs[0].role !== "system") {
              msgs.unshift({ role: "system", content: systemPrompt(p.path) });
            } else {
              msgs[0] = { role: "system", content: systemPrompt(p.path) };
            }
            return { ...c, messages: msgs };
          });
          return {
            path: p.path,
            expanded: p.expanded !== false,
            activeChatId: p.activeChatId,
            chats,
          };
        }
        // migrate from the old single-thread-per-project shape
        const messages = p.messages && p.messages.length ? p.messages : [{ role: "system", content: systemPrompt(p.path) }];
        const firstUser = messages.find((m) => m.role === "user");
        const chat = { id: genId(), title: firstUser ? deriveChatTitle(firstUser.content) : "Chat 1", updatedAt: new Date().toISOString(), messages };
        return { path: p.path, expanded: true, activeChatId: chat.id, chats: [chat] };
      });
    } else if (saved.projectPath) {
      // migrate from the very old single-project shape
      const chat = makeChat(saved.projectPath);
      projects = [{ path: saved.projectPath, expanded: true, activeChatId: chat.id, chats: [chat] }];
    }
    activePath = saved.activeProjectPath && projects.some((p) => p.path === saved.activeProjectPath)
      ? saved.activeProjectPath
      : (projects[0]?.path || null);

    renderProjectList();
    if (activePath) {
      await refreshTree();
      renderThreadFromMessages(activeChat().messages);
    } else {
      updateEmptyHint();
    }
    persistProjects();
    await refreshModels();
    if (!settings.apiKey) settingsBtn.click();
  })();
})();
