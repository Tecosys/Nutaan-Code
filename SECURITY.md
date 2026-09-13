# Security policy

## Reporting a vulnerability

Please report security problems privately, through
[GitHub's private advisory form](https://github.com/Tecosys/Nutaan-Code/security/advisories/new),
rather than in a public issue.

Include what an attacker can do with the bug, the steps to reproduce it, and the app version and OS
you saw it on. A proof of concept helps, but a clear description of the impact matters more.

## Supported versions

Fixes go into the next release from the latest version. Older installers are not patched — the app
updates itself, so the fix reaches you that way.

## What this app can do on your machine

Worth knowing when you judge a report, and worth knowing before you run the app:

- **It runs shell commands.** The agent executes commands in the project you open, including
  long-running background ones. That is the point of the app, not a vulnerability — but a bug that
  gets commands executed *without* the user asking is one, and we want to hear about it.
- **It reads files outside the project.** Co-worker mode searches the wider machine, and it can open
  documents and local mail files.
- **It drives a browser and makes network requests.** The arsenal tools perform live reconnaissance
  against hosts you name.
- **It holds an API key** for nutaan.com, stored in the app's data directory.

Anything that lets a *project's own contents* — a file, a repository, a web page the agent visits —
steer those capabilities without the user's say-so is a security bug. Prompt injection that leads to
command execution, file exfiltration, or a request to an attacker's host is exactly the kind of
report we want.

## Using the arsenal responsibly

The bundled OSINT and security tooling is for authorised work: systems you own, engagements you have
written permission for, and CTFs. Pointing it at anything else is likely illegal where you live, and
is not something this project supports.
