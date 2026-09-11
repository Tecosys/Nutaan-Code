---
name: debugging
description: Systematically track down a bug. Use when the user reports an error, crash, unexpected behavior, or asks "why isn't this working."
---

Don't guess-and-check. Work in this order:

1. **Reproduce first.** Read the actual error message/stack trace before touching anything. If there isn't one, ask the user to run the failing command via `run_command` and read the real output.
2. **Localize.** Use `search_files` to find where the failing behavior originates — the function/module actually involved, not just where the symptom appears.
3. **Read before editing.** Use `read_file` to see the real code around the suspected site. Form one concrete hypothesis for the root cause before proposing a fix.
4. **Fix the cause, not the symptom.** Avoid adding try/catch or fallback values that hide the error instead of fixing it, unless that's genuinely the right boundary.
5. **Verify.** After the fix, re-run the failing command/test to confirm it now passes.
