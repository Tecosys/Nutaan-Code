---
name: security-review
description: Review code for security vulnerabilities. Use when the user asks for a security review, to check for vulnerabilities, or before shipping code that handles user input, auth, or payments.
---

Focus on what's actually exploitable, not theoretical hardening. Check for, in order of how often they matter:

1. **Injection** — user input concatenated into a SQL query, shell command, or HTML output without escaping/parameterization.
2. **Broken auth/access control** — an endpoint or action that doesn't check the caller is who they claim to be, or is allowed to do that specific thing (not just "logged in", but "logged in AND owns this resource").
3. **Secrets** — API keys, passwords, or tokens hardcoded in source or logged in plaintext.
4. **Unvalidated input** — file paths built from user input without checking they stay inside an allowed directory (path traversal), request bodies trusted without size/type limits.
5. **Insecure defaults** — CORS set to allow any origin, debug mode left on, verbose error messages leaking stack traces or internals to the client.

For each finding: name the exact file/line, describe the concrete attack (what input, what happens), and rate it only as serious as it actually is — don't inflate minor issues to sound thorough.
