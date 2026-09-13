---
name: system-health
description: Diagnose a slow or full computer — CPU, memory, disk space, runaway processes — and fix it by closing what's hogging resources or clearing reclaimable storage. Use when the user says their machine or this app is slow, laggy, hot, out of disk space, or asks what's running, what's using CPU/RAM, or to close/kill a program.
---

This is about the **machine**, not the codebase. If the user means slow *code*, that's `performance-review`.

Works identically on Windows, macOS and Linux — the tools handle the platform differences, so never
tell the user to open Task Manager, Activity Monitor or `top` themselves. Read it for them.

## Measure first

Call `os_system_stats`. It returns, sampled live over a real interval:

- `cpu.percent` overall and `cpu.perCore` — one pinned core out of eight is 12% overall, not idle.
- `memory` used vs free.
- `topProcesses` — the 15 busiest, grouped by program with a process count, CPU normalised so a
  fully-busy *machine* is 100% (the same scale Task Manager shows, not ps's per-core scale).
- `disks` — free space per drive.
- `app` — Nutaan Code's own processes, split into browser/renderer/gpu/utility.

Read what's actually there before theorising. "Slow" has a different cause at 99% CPU than at 95%
RAM, and a different one again when the disk is nearly full.

## Then act

**Something is hogging CPU or RAM** → `os_kill_process` with the `pid` from `topProcesses`. Prefer
pid over name; a name closes every process sharing it. It asks the program to quit first, so only
pass `force:true` when that was already tried or the user asks — and warn that unsaved work dies
with it. Critical OS processes and Nutaan Code's own are refused outright; that refusal is correct,
so don't route around it with `run_command`.

**The disk is filling up** → `cleanup_storage`, `dry_run:true` first.

## Reporting the cleanup honestly

`cleanup_storage` returns two different numbers and they mean different things:

- `scannedMB` — what *looked* reclaimable. A candidate, nothing more.
- `freedMB` — what is measurably gone, computed from the size left behind after deleting.
- `blockedCount` / `blockedMB` — what would not budge, with a per-item `error` saying why (almost
  always a file another running program holds open).

Only `freedMB` may be described as freed. If `blockedCount` is above zero, say so in the same
sentence and name the biggest offenders. Never present `scannedMB` as the result, and never
quietly add blocked space into the total — the user can check the folder in ten seconds, and a
cleanup that lies about what it did is worse than one that freed nothing.

A locked temp folder is usually the program that owns it still running. If it's worth the space,
say which program to close, or offer to close it.
