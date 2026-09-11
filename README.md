# Nutaan Code

A desktop coding agent, built in-house at Tecosys — reads your project's files, proposes edits, runs commands, and can drive a built-in browser panel to actually test what it builds. Every file write, edit, and shell command stops for your approval first (or runs immediately if you turn on Auto-approve), same permission model as Claude Code.

It talks to models through a local gateway rather than any single AI provider directly, so it can route across whichever models are connected there — including free-tier ones — and switch automatically if one runs out of quota.

## Install (team members — no dev setup needed)

1. Go to the [Releases page](https://github.com/Tecosys/Nutaan-Code/releases) and download the latest `Nutaan-Code-Setup-x.x.x.exe`.
2. Run it — it installs like any Windows app (Start Menu + desktop shortcut).

   > **Windows shows a blue "Windows protected your PC" screen?** That's expected — the installer isn't code-signed yet (that costs a paid certificate), so Windows doesn't recognize the publisher. It's not a virus or a broken download. Click **More info**, then **Run anyway**. This one-time warning goes away for that file once you've run it.
3. Install the model gateway once, from an admin/PowerShell terminal:
   ```bash
   npm install -g omniroute
   omniroute serve
   ```
   (needs [Node.js](https://nodejs.org) 22.22.2+ or 24.x — install that first if you don't have it)
4. Open the OmniRoute dashboard it prints (`http://localhost:20128`), sign in with the default password `CHANGEME` and **change it immediately**, then add at least one model provider (or a free-tier one that needs no key).
5. Launch Nutaan Code. On first run, open **⚙ Settings**, generate an API key from that same OmniRoute dashboard, and paste it in.
6. Click **+ Open Project**, pick a folder, and start chatting.

The app auto-updates itself after this — no need to reinstall for new versions.

## Features

- **Multi-project sidebar** — each open project keeps its own persistent chat history.
- **File tools** — read, write, edit (exact string replace), and search across a project, all scoped to its root folder.
- **Terminal** — runs real shell commands in the project root, killable mid-run.
- **Browser panel** — navigate, read page text, click, type/submit forms, scroll, screenshot, switch between mobile/tablet/desktop preview sizes, and (with approval) run arbitrary JS in the page for anything else.
- **Skills** — reusable instruction packs (`skills/*/SKILL.md`) for specific kinds of work: code review, debugging, refactoring, security review, performance review, writing tests, documentation, dependency upgrades, commit messages. Drop a `SKILL.md` into a project's `.nutaan/skills/<name>/` to add project-specific ones. If Claude Code is installed on the machine, its skills (`~/.claude/skills`, `<project>/.claude/skills`) are picked up automatically too.
- **Auto-approve** — toggle at the top of the chat to skip the approval prompt and move fast; every action still shows up in the thread, just already resolved.
- **Context compaction** — long conversations get auto-summarized instead of hitting a context limit.

## Dev setup (working on Nutaan Code itself)

```bash
git clone https://github.com/Tecosys/Nutaan-Code.git
cd Nutaan-Code
npm install
npm start
```

To build the Windows installer locally:
```bash
npm run dist
```
Output lands in `dist/`.

## Releasing an update

Publishing a new version is entirely handled by CI — nobody needs a token or to run a manual publish:

```bash
npm version patch   # or minor / major
git push --follow-tags
```

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds the Windows installer and publishes it as a GitHub Release. Every installed copy checks for updates on launch (and every few hours) and offers to install once one's downloaded.

## How it works

- `main.js` — Electron main process: owns the file system and shell access, the tool-calling agent loop (streamed via SSE) against the gateway's OpenAI-compatible `/v1/chat/completions` endpoint, the permission gate, and auto-update.
- `preload.js` — the only bridge between the renderer (UI) and the main process, via `contextBridge`.
- `renderer/` — the UI: project sidebar, file tree, chat thread, tool-call cards, permission prompts, and the embedded browser panel.
- `skills/` — built-in skill packs.

Every install talks to **its own** local model gateway and **its own** API key — nothing is shared between installs, and nothing leaves the machine except through the gateway each person configures themselves.
