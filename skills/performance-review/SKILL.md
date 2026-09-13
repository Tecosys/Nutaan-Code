---
name: performance-review
description: Find and fix performance problems in code. Use when the user says something is slow, asks to optimize, or wants a performance review.
---

If what feels slow is the **computer** rather than the code — the whole machine lagging, a fan spinning up, the app itself stuttering — that is the `system-health` skill instead: measure it with `os_system_stats` before looking at a single line of source.

Measure before guessing where possible — if there's a way to profile or time the slow path (via run_command), do that first rather than optimizing blind.

Common real culprits, roughly in order of impact:

1. **N+1 queries** — a loop that makes one DB/API call per item instead of one batched call for all of them.
2. **Unnecessary re-computation** — the same expensive thing (query, parse, regex) run repeatedly with the same input inside a loop or on every render, instead of once/cached.
3. **Loading more than needed** — fetching a whole table/file/object when only a few fields are used.
4. **Blocking on I/O that could be parallel** — sequential awaits for independent operations that could run concurrently.
5. **Algorithmic complexity** — an O(n²) approach (e.g. nested loops with `.includes()`/`.find()`) where a lookup map would make it O(n).

Report the specific bottleneck with why it's slow (not just "this could be faster"), and only propose a fix once you're confident it's the actual cause — don't scatter micro-optimizations across the file.
