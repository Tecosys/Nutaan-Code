# Nutaan Code

A personal desktop coding agent — like Claude Code, but routed through your own [OmniRoute](https://github.com/diegosouzapw/OmniRoute) gateway so you can point it at whichever models you've connected there (including free-tier ones).

Nutaan Code can read your project's files, propose edits, and run commands — with an approval prompt before anything that actually changes your disk or executes a command, same as Claude Code's permission model.

## Requirements

- [Node.js](https://nodejs.org) 22.22.2+ or 24.x
- [OmniRoute](https://github.com/diegosouzapw/OmniRoute) running locally (`npm install -g omniroute && omniroute serve`), with at least one model provider connected via its dashboard at `http://localhost:20128`

## Setup

```bash
git clone <this-repo-url>
cd nutaan-code
npm install
npm start
```

On first launch:
1. Click **⚙ Settings** and paste an API key generated from your OmniRoute dashboard (`http://localhost:20128`).
2. Click **Open Project Folder** and pick the codebase you want to work on.
3. Start chatting — ask it to explain, fix, or build something.

## How it works

- `main.js` — Electron main process: owns the file system and shell access, the tool-calling agent loop against OmniRoute's OpenAI-compatible `/v1/chat/completions` endpoint, and the permission gate.
- `preload.js` — the only bridge between the renderer (UI) and the main process, via `contextBridge`.
- `renderer/` — the UI: project file tree, chat thread, tool-call cards, and permission prompts.

Every install talks to **your own** local OmniRoute instance and **your own** API key — nothing is shared between installs, and nothing leaves your machine except through the OmniRoute gateway you configure yourself.

## Personal / internal use

This was built for personal use and casual sharing with friends, not as a maintained public product. There's no auto-update, installer, or support channel — clone it, run it, tweak it.
