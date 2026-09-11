---
name: refactor
description: Restructure existing code without changing its behavior. Use when the user asks to clean up, simplify, refactor, or reorganize code.
---

Refactoring means the behavior does not change — only the structure does. Before touching anything:

1. Read the code fully and understand what it actually does, including edge cases.
2. If tests exist, note how to run them so you can verify behavior is unchanged afterward. If none exist, say so before proceeding — refactoring without a safety net is riskier.
3. Make one kind of change at a time (e.g., extract a function, then rename, then simplify a conditional) rather than a single sprawling rewrite — smaller diffs are easier for the user to review and approve.
4. Don't rename things, reformat unrelated code, or "improve" style outside the scope of what was asked — extra unrelated diff noise makes the change harder to trust.
5. After refactoring, run the tests (or ask the user to) before calling it done.
