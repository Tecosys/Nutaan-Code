// End-to-end visual test on v0.1.58: import offer → home → workers → co-worker → settings.
const { app, BrowserWindow, session } = require("electron");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "test-shots");
fs.mkdirSync(OUT, { recursive: true });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  session.defaultSession.setPreloads([path.join(__dirname, "_stub-preload.js")]);
  const win = new BrowserWindow({
    width: 1680,
    height: 1020,
    show: true,
    titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
    titleBarOverlay: process.platform === "win32" ? { color: "#0f1117", symbolColor: "#c7cad2", height: 38 } : false,
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  await win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  await wait(1600);

  const shot = async (name) => {
    const img = await win.webContents.capturePage();
    fs.writeFileSync(path.join(OUT, name), img.toPNG());
    console.log("shot:", name);
  };
  const js = (code) => win.webContents.executeJavaScript(code);

  // 1: import offer should have auto-opened (stub reports Claude Code + Codex + Antigravity)
  await shot("01-import-offer.png");
  await js("document.getElementById('importCancel').click()");
  await wait(400);

  // 2: home in coding mode
  await shot("02-home.png");

  // 3: workers page via the nav
  await js("document.querySelectorAll('.nav-row')[3].click()");
  await wait(600);
  await shot("03-workers.png");

  // 4: co-worker page
  await js("document.querySelectorAll('.nav-row')[2].click()");
  await wait(600);
  await shot("04-coworker.png");

  // 5: back home, office (co-worker) mode look
  await js("document.querySelectorAll('.nav-row')[0].click(); document.getElementById('app').classList.add('office-mode')");
  await wait(400);
  await shot("05-home-office.png");
  await js("document.getElementById('app').classList.remove('office-mode')");

  // 6: settings → tools tab (import button + intercept cards)
  await js("document.getElementById('settingsBtn').click()");
  await wait(400);
  await js("const t=document.querySelector('.settings-tab[data-tab=\\\"tools\\\"]'); if(t) t.click()");
  await wait(400);
  await shot("06-settings-tools.png");
  await js("document.getElementById('settingsOverlay').hidden = true");

  // 7: reopen import dialog from the UI path used everywhere else
  await js("document.getElementById('importOverlay').hidden = false");
  await wait(300);
  await shot("07-import-reopen.png");

  console.log("ALL SHOTS DONE");
  app.quit();
}).catch((e) => { console.error(e); app.quit(1); });
