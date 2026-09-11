<p align="center">
  <img src="assets/logo.png" width="72" alt="Nutaan Code logo" />
</p>

<h1 align="center">Nutaan Code (Private)</h1>
<p align="center">A personal AI coding agent desktop app, built in-house at Tecosys for nutaan.com users.</p>

Reads your project's files, proposes edits, runs commands, generates real image assets, and can drive a built-in browser panel to actually test what it builds. Every file write, edit, and shell command stops for your approval first (or runs immediately if you turn on Auto-approve) — same permission model as Claude Code.

## Demo

[![Watch the demo](docs/demo-thumb.png)](docs/demo.mp4)

*Click the thumbnail to play the full recording.*

## Install — no terminal, no dev setup

1. Go to your Releases page and download the latest `Nutaan-Code-Setup-x.x.x.exe`.
2. Run it — it installs like any Windows app (Start Menu + desktop shortcut).

   > **Windows shows a blue "Windows protected your PC" screen?** That's expected — the installer isn't code-signed yet (that costs a paid certificate), so Windows doesn't recognize the publisher. It's not a virus or a broken download. Click **More info**, then **Run anyway**. This one-time warning goes away for that file once you've run it.
3. Launch Nutaan Code. On first run it opens **⚙ Settings** for you automatically:
   - Under **Advanced**, set the **Server URL** to your OpenAI-compatible endpoint.
   - Paste your **API key** into the **API key** field and hit **Save**. The Model dropdown populates from your server's model list once connected.
4. Click **+ Open Project**, pick a folder, and start chatting.

Nutaan Code speaks the standard OpenAI-compatible `/v1/chat/completions` API, so any server that implements it works — no code changes needed to switch models or providers, just update the Server URL and API key in Settings.

## Features

- **Multi-project sidebar** — each project keeps its own collapsible list of past chats, not just one growing thread. Create, switch, and delete chats freely.
- **File tools** — read, write, edit (exact string replace), and search across a project, all scoped to its root folder.
- **Code tab** — a live, syntax-highlighted view of whatever file the agent is currently reading or writing, right next to the browser panel. Click any file in the sidebar to open it there directly.
- **Browser panel** — navigate, read page text, click, type/submit forms, scroll, screenshot, switch between mobile/tablet/desktop preview sizes, and (with approval) run arbitrary JS in the page for anything else.
- **Image generation & vision** — the agent can generate real image files (hero images, icons, logos) and look at images it just made or ones you provide, when your server offers an image-capable model. Auto-detected, no manual model wiring.
- **Persistent memory** — long-term facts, preferences, and corrections the agent saves on its own (`~/.nutaan/memory/`), shared across every project on the machine, not just the one it learned something in.
- **Skills** — reusable instruction packs (`skills/*/SKILL.md`) for specific kinds of work: code review, debugging, refactoring, security review, performance review, writing tests, documentation, dependency upgrades, commit messages. Drop a `SKILL.md` into a project's `.nutaan/skills/<name>/` to add project-specific ones. If Claude Code is installed on the machine, its skills (`~/.claude/skills`, `<project>/.claude/skills`) are picked up automatically too.
- **Terminal** — runs real shell commands in the project root, killable mid-run.
- **Auto-approve** — toggle at the top of the chat to skip the approval prompt and move fast; every action still shows up in the thread, just already resolved.
- **Context compaction** — long conversations get auto-summarized instead of hitting a context limit.

## Contributing

Bug reports, feature ideas, and pull requests are all welcome. If you're picking up something non-trivial, opening an issue first to align on approach is appreciated but not required — small fixes can just be a PR.

```bash
git clone <this-repo-url>
cd nutaan-code-private
npm install
npm start
```

That's the full dev loop — `npm start` runs the app straight from source with hot-reload-on-restart, no build step needed while you're iterating on `renderer/` or `main.js`.

To build the Windows installer locally:
```bash
npm run dist
```
Output lands in `dist/`.

## Releasing an update

```bash
npm version patch   # or minor / major
git push --follow-tags
```

Pushing a `vX.Y.Z` tag triggers `.github/workflows/release.yml`, which builds the Windows installer and publishes it as a **draft** GitHub Release — deliberately not made public automatically. Download that build yourself, verify it, then click **Publish release** on it when you're satisfied. Every installed copy checks for updates on launch (and every few hours) against the latest *published* release and offers to install once one's downloaded.

## How it works

- `main.js` — Electron main process: owns the file system and shell access, the tool-calling agent loop (streamed via SSE) against the configured OpenAI-compatible `/v1/chat/completions` endpoint, the permission gate, image generation, memory, and auto-update.
- `preload.js` — the only bridge between the renderer (UI) and the main process, via `contextBridge`.
- `renderer/` — the UI: project sidebar, file tree, chat thread, tool-call cards, permission prompts, the settings modal, the Code tab, and the embedded browser panel.
- `skills/` — built-in skill packs.

Every install uses **its own** API key and Server URL, entered locally — nothing is shared between installs, and nothing leaves the machine except through whichever endpoint each person configures in Settings.

---

<p align="center">
  Maintained by the <a href="https://tecosys.in/teams">Tecosys team</a><br/>
  Learn Tecosys: <a href="https://nutaan.com">nutaan.com</a> · Nutaan AI: <a href="https://nutaan.com">nutaan.com</a>
</p>
