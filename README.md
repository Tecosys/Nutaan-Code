# Nutaan Code

A desktop coding agent, built in-house at Tecosys — reads your project's files, proposes edits, runs commands, and can drive a built-in browser panel to actually test what it builds. Every file write, edit, and shell command stops for your approval first (or runs immediately if you turn on Auto-approve), same permission model as Claude Code.

It talks to models through any OpenAI-compatible endpoint — [OpenRouter](https://openrouter.ai) by default, which fronts hundreds of models (including several genuinely free ones) behind a single API key, no local server or terminal required.

## Install — no terminal, no dev setup

1. Go to the [Releases page](https://github.com/Tecosys/Nutaan-Code/releases) and download the latest `Nutaan-Code-Setup-x.x.x.exe`.
2. Run it — it installs like any Windows app (Start Menu + desktop shortcut).

   > **Windows shows a blue "Windows protected your PC" screen?** That's expected — the installer isn't code-signed yet (that costs a paid certificate), so Windows doesn't recognize the publisher. It's not a virus or a broken download. Click **More info**, then **Run anyway**. This one-time warning goes away for that file once you've run it.
3. Launch Nutaan Code. On first run it opens **⚙ Settings** for you automatically:
   - Click **Get a free API key →** — this opens OpenRouter's key page in Nutaan Code's own built-in browser panel, so you never leave the app. Sign in (Google/GitHub/email) and create a key.
   - Paste the key into the **API key** field and hit **Save**. A free (`:free`) model is picked by default — no card needed.
4. Click **+ Open Project**, pick a folder, and start chatting.

The app auto-updates itself after this — no need to reinstall for new versions. Want to use a specific paid model later (e.g. an Anthropic Claude model)? Add credit on OpenRouter and pick it from the Model dropdown in Settings — no code changes needed, since Nutaan Code speaks the standard OpenAI-compatible API any provider on OpenRouter exposes.

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

- `main.js` — Electron main process: owns the file system and shell access, the tool-calling agent loop (streamed via SSE) against the configured OpenAI-compatible `/v1/chat/completions` endpoint, the permission gate, and auto-update.
- `preload.js` — the only bridge between the renderer (UI) and the main process, via `contextBridge`.
- `renderer/` — the UI: project sidebar, file tree, chat thread, tool-call cards, permission prompts, the settings modal, and the embedded browser panel (also used to fetch an OpenRouter key without leaving the app).
- `skills/` — built-in skill packs.

Every install uses **its own** API key, entered locally — nothing is shared between installs, and nothing leaves the machine except through whichever endpoint (OpenRouter by default) each person configures.
