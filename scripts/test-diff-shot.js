// One-off visual: simulated conversation showing the numbered diff, rail, and access chip.
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const path = require("path");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  session.defaultSession.setPreloads([path.join(__dirname, "_stub-preload.js")]);
  const win = new BrowserWindow({
    width: 1680, height: 1020, show: true, titleBarStyle: "hidden",
    titleBarOverlay: { color: "#0f1117", symbolColor: "#c7cad2", height: 38 },
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  await wait(1600);
  await win.webContents.executeJavaScript("document.getElementById('importCancel').click()");
  await wait(300);
  await win.webContents.executeJavaScript(`
    document.getElementById('emptyState').hidden = true;
    document.querySelector('main.chat').appendChild(document.querySelector('.composer-wrap'));
    const thread = document.getElementById('thread');
    thread.innerHTML = '';
    thread.insertAdjacentHTML('beforeend', \`
      <div class='row user'><div class='bubble'>Move the platform check into app.js</div></div>
      <div class='tool-card ok kind-edit'><div class='tool-header'><span class='tool-title'>Edit</span><code class='tool-cmd'>app.js</code><span class='tool-stat'><span class='stat-add'>+3</span> <span class='stat-del'>-1</span></span><span class='tool-chev'>▾</span></div>
      <pre class='diff diff-numbered'>
        <div class='diff-line diff-ctx'><span class='diff-no'>1</span><span class='diff-no'>1</span><span class='diff-sign'></span><span class='diff-text'>(function () {</span></div>
        <div class='diff-line diff-ctx'><span class='diff-no'>2</span><span class='diff-no'>2</span><span class='diff-sign'></span><span class='diff-text'>  const el = (id) =&gt; document.getElementById(id);</span></div>
        <div class='diff-line diff-del'><span class='diff-no'>3</span><span class='diff-no'></span><span class='diff-sign'>-</span><span class='diff-text'>  const old = navigator.platform;</span></div>
        <div class='diff-line diff-add'><span class='diff-no'></span><span class='diff-no'>3</span><span class='diff-sign'>+</span><span class='diff-text'>  <span class='hl-comment'>// windows draws the overlay on the frameless window</span></span></div>
        <div class='diff-line diff-add'><span class='diff-no'></span><span class='diff-no'>4</span><span class='diff-sign'>+</span><span class='diff-text'>  <span class='hl-keyword'>if</span> (<span class='hl-string'>/Win/i</span>.test(navigator.userAgent || <span class='hl-string'>''</span>)) document.documentElement.classList.add(<span class='hl-string'>'platform-win'</span>);</span></div>
        <div class='diff-line diff-add'><span class='diff-no'></span><span class='diff-no'>5</span><span class='diff-sign'>+</span><span class='diff-text'>  <span class='hl-keyword'>const</span> thread = el(<span class='hl-string'>'thread'</span>);</span></div>
        <div class='diff-line diff-ctx'><span class='diff-no'>4</span><span class='diff-no'>6</span><span class='diff-sign'></span><span class='diff-text'>})();</span></div>
      </pre></div>
      <div class='tool-card pending kind-terminal'><div class='tool-header'><span class='tool-title'>Terminal</span><code class='tool-cmd'>node --check app.js</code><span class='tool-stat'>running</span><span class='tool-chev'>▸</span></div></div>
      <div class='row assistant'><div class='bubble'>Done — platform check is now in app.js and the run is being verified.</div></div>
    \`);
    for (let i = 0; i < 14; i++) thread.insertAdjacentHTML('beforeend', '<div class="row assistant"><div class="bubble">filler ' + i + '</div></div>');
    document.getElementById('accessChip').classList.add('on');
    document.querySelector('#accessChip .label-text').textContent = 'Full access';
    document.getElementById('input').placeholder = 'Keep typing to queue follow-up changes';
  `);
  await wait(400);
  const img = await win.webContents.capturePage();
  fs.writeFileSync(path.join(__dirname, "..", "test-shots", "08-diff-rail.png"), img.toPNG());
  console.log("shot 08 done");
  app.quit();
}).catch((e) => { console.error(e); app.quit(1); });
