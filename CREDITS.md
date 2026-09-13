# Credits

Nutaan Code is built on other people's work. This is what ships inside it.

## Runtime

| Project | Licence | What it does here |
| --- | --- | --- |
| [Electron](https://github.com/electron/electron) | MIT | The desktop runtime — Chromium and Node in one process tree |
| [electron-updater](https://github.com/electron-userland/electron-builder/tree/master/packages/electron-updater) | MIT | Checks for releases and installs them |

## Build

| Project | Licence | What it does here |
| --- | --- | --- |
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT | Produces the `.exe`, `.dmg`, `.AppImage`, `.deb` and `.rpm` |
| [Jimp](https://github.com/jimp-dev/jimp) | MIT | Resizes the source logo when generating icons |
| [png-to-ico](https://github.com/steambap/png-to-ico) | MIT | Builds the Windows `.ico` |

Their own dependencies are listed in [`package-lock.json`](package-lock.json).

## Fonts

| Font | Licence |
| --- | --- |
| [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | SIL Open Font License 1.1 |
| [Plus Jakarta Sans](https://github.com/tokotype/PlusJakartaSans) | SIL Open Font License 1.1 |

## The arsenal catalogue

[`arsenal/tools.json`](arsenal/tools.json) indexes 753 third-party OSINT and security tools across 26
categories. Nutaan Code does not bundle any of them — the catalogue records each tool's name,
purpose, install command and homepage so the agent can point you at the right one. **Every tool in
it belongs to its own authors and carries its own licence**, and each entry links to its source.

To see who is credited for a given tool:

```bash
node -e "console.log(require('./arsenal/tools.json').find(t => t.id === 'nmap'))"
```

## Provider logos

The marks in [`renderer/providers/`](renderer/providers) — Anthropic, AWS Bedrock, Azure, DeepSeek,
Google, Groq, Mistral, NVIDIA, OpenAI, OpenRouter, Together and xAI — are the trademarks of their
respective owners. They are used to identify which provider a model is reached through. Their
presence does not imply any endorsement or affiliation.

## Contributors

Everyone who has landed a change is listed on the
[contributors page](https://github.com/Tecosys/Nutaan-Code/graphs/contributors). If you want to be
here, see [CONTRIBUTING.md](CONTRIBUTING.md).
