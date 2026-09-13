# Contributing to Nutaan Code

Nutaan Code is licensed under the [GNU AGPL v3](LICENSE). By contributing you agree your work ships
under the same licence — including the network clause, which means a hosted fork has to offer its
source too.

The two easiest places to contribute are **skills** and the **arsenal catalogue**. Neither needs you
to understand the Electron app: both are plain files.

---

## Run it from source

```bash
git clone https://github.com/Tecosys/Nutaan-Code.git
cd Nutaan-Code
npm install
npm start
```

You need Node 20 or newer; CI builds on 24. `npm start` runs the app from source, so edits to
`renderer/` show up on reload and edits to `main.js` after a restart.

To build installers for your own platform:

```bash
npx electron-builder --win   # or --mac, or --linux
```

Installers for the *other* platforms are built in CI — each one needs its own OS, so a Windows
machine cannot produce a `.dmg`.

---

## Add a skill

A skill is a Markdown file that tells the agent how to approach one kind of task. The agent picks a
skill by reading its `description`, so that line matters more than the body.

Create `skills/<your-skill-id>/SKILL.md`:

```markdown
---
name: your-skill-id
description: One sentence on what this does, and when the agent should reach for it.
---

The instructions themselves. Write them as directions to the agent, not as documentation for a
human — "Check X before Y", not "This skill checks X".
```

Rules that are easy to miss:

- The folder name is the skill's id. Keep it lowercase and hyphenated.
- `description` is what triggers the skill. Say *when to use it*, not just what it is. Compare
  `"Review code"` with `"Review code changes for correctness bugs. Use when the user asks to review,
  check, or audit a diff or a pull request."` — only the second gives the agent something to match on.
- Skills in `skills/` ship with the app. Users can also drop their own in `~/.claude/skills`, or per
  project in `.claude/skills` or `.nutaan/skills`; a project skill wins over a bundled one with the
  same id.

Look at [`skills/code-review/SKILL.md`](skills/code-review/SKILL.md) for the shape of a good one.

## Add a tool to the arsenal

[`arsenal/tools.json`](arsenal/tools.json) is a catalogue of 753 OSINT and security tools the agent
can search. Adding one is a single array entry:

```json
{
  "id": "unique-slug",
  "name": "Tool Name",
  "description": "What it does, in one line",
  "category": "domain-ip-network",
  "url": "https://example.com",
  "install": {
    "method": "git",
    "kali": "apt install example",
    "raw": "[example.com](https://example.com)"
  },
  "tags": ["domain-ip-network"],
  "aliases": [],
  "archived": false
}
```

- `method` is one of `web`, `manual`, `git`, `apt`, `pip`, `go`, `docker`.
- `category` must be one of the 26 already in the file — run
  `node -e "console.log([...new Set(require('./arsenal/tools.json').map(t=>t.category))])"` to list them.
- `id` has to be unique. The loader will tell you if it is not.

Check it still parses and your tool is findable:

```bash
node -e "const a=require('./arsenal');console.log(a.searchTools({query:'your tool'}))"
```

**Please only add tools that are legal to use and documented publicly.** The arsenal is meant for
authorised security work — pentests you have permission for, CTFs, and your own infrastructure.

---

## Pull requests

- One change per PR. A bug fix and a new feature in the same branch is two PRs.
- Say what breaks without your change. "Fixes the crash when X" beats "improves Y".
- Test what you touched, and say how you tested it. For anything the user sees, that means actually
  running the app, not just building it.
- Match the surrounding code. No formatter is enforced; read the neighbours and do what they do.

## Reporting bugs

Open an [issue](https://github.com/Tecosys/Nutaan-Code/issues) with your OS, the app version (shown
in **Settings**, next to *Check for updates*), and what you expected versus what happened. For a
crash, the output of running the app from a terminal is worth more than a screenshot.

Found a security problem? Please do not open a public issue — see [SECURITY.md](SECURITY.md).
