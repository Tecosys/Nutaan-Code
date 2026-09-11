---
name: dependency-upgrade
description: Upgrade a package/dependency version. Use when the user asks to update, upgrade, or bump a dependency.
---

1. Check the current version and the target version's changelog/release notes for breaking changes before touching anything — don't upgrade blind.
2. Upgrade one dependency (or one clearly-related group) at a time, not everything at once — makes it possible to tell what broke if something does.
3. After upgrading, actually run the project's build and tests (via run_command) to confirm nothing broke, rather than assuming a version bump is safe.
4. If the upgrade requires code changes (a renamed API, a new required option), make those changes and explain what changed and why.
5. Flag major version bumps explicitly as higher-risk before proceeding, since those are the ones most likely to carry breaking changes.
