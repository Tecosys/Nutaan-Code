---
name: commit-message
description: Write a good git commit message for staged changes. Use when the user asks to commit, or write/draft a commit message.
---

Look at the actual diff (via `run_command` with `git diff --staged` or `git diff`), not just the file list.

Write a commit message that explains **why**, not just what:
- First line: imperative mood, under 70 characters, summarizing the change (e.g. "Fix race condition in session cleanup", not "Updated files").
- Body (only if needed): 1-3 short sentences on the motivation or context — what problem this solves, not a restatement of the diff.
- Never mention file names in the subject line unless there's only one file and it's the whole point.
