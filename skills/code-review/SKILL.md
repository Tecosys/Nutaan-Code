---
name: code-review
description: Review code changes for correctness bugs and simplification opportunities. Use when the user asks to review, check, or audit code, a diff, or a pull request.
---

Review in two passes:

1. **Correctness** — trace through the actual logic with concrete inputs. Look for: off-by-one errors, null/undefined handling, race conditions, incorrect error handling, edge cases (empty input, zero, negative numbers). Only report something you can state as "given input X, this produces wrong output Y" — not vague code smell.
2. **Simplification** — flag real duplication, dead code, and unnecessary abstraction, but don't suggest rewrites just for style.

Report findings ordered most-severe first. For each: file, line, one-sentence summary, and the concrete failure scenario. Skip anything you're not confident is an actual bug.
