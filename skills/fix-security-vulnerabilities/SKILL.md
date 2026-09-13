---
name: fix-security-vulnerabilities
description: Fix security vulnerabilities found in a pentest or code review — triage by severity, patch the root cause rather than the symptom, and re-run the exploit to prove each fix actually closes it. Handles injection, XSS, SSRF, broken access control, IDOR, auth/JWT flaws, secrets exposure, and other validated findings. Use after a security scan reports findings, or when the user asks to remediate, patch, or fix security issues.
---

# Fix findings and verify

Turn validated findings into minimal, correct fixes — and prove they work by re-testing. Nutaan has the repo open and the exploit in hand, so it can patch and re-run in one loop.

## 1. Triage

Order work by severity: **critical → high → medium → low**. Every finding that came through `exploit-validation` has a working proof-of-concept, so don't dismiss one as a false positive without re-running its PoC yourself. Group findings that share a root cause — often one fix closes several.

## 2. Fix the root cause, not the payload

For each finding:

1. **Reproduce it** with the PoC first, so you have a red test to turn green.
2. **Fix the cause, not the symptom** — parameterize *every* query rather than blocking one string; enforce authorization in the handler rather than hiding the endpoint; add the check to the shared helper rather than the one route.
3. **Prefer the framework's built-in defense** — ORM parameterization, template auto-escaping, CSRF middleware, a central authorization layer — over ad-hoc sanitization.
4. **Keep the diff minimal** and follow the repo's existing patterns.

Common classes and their real fixes:

| Class | Root-cause fix |
|---|---|
| SQL/NoSQL injection | Parameterized queries / ORM bindings at the sink — never string concatenation |
| Command injection | Avoid the shell; pass an argument array to `exec`, validate against an allowlist |
| IDOR / broken access control | Object-level authorization check in the handler (caller **owns** this object), applied centrally |
| Privilege escalation | Server-side role check on every privileged action; never trust a client-sent role/`isAdmin` |
| SSRF | Allowlist destinations, block internal/metadata ranges, resolve-then-validate |
| XSS | Context-aware output encoding + a Content-Security-Policy; avoid `innerHTML`/`dangerouslySetInnerHTML` |
| CSRF | Anti-CSRF tokens / `SameSite` cookies via the framework's middleware |
| JWT flaws | Verify the signature with a fixed algorithm; reject `alg:none`; rotate a weak secret |
| Secrets in code | **Rotate the secret** AND remove it from source and git history |
| Insecure deserialization | Don't deserialize untrusted data into objects; use a safe format/allowlist |

Never move a security check to the client — the fix must be server-side.

## 3. Verify by re-running the exploit

After patching, **re-run the original PoC** against the fixed code — this is the ground-truth signal that the fix landed. Then:

- Re-test the surrounding area for the same class (a fix in one route often needs to cover its siblings).
- Run the project's own test suite so the fix doesn't break behaviour.
- For a diff-scoped confidence pass, re-review the changed files (`git diff <base>...HEAD`) for regressions.

A finding is only closed when its exploit no longer reproduces — not when the code merely looks fixed.

## 4. Report

Summarize per finding: severity, root cause, fix applied (`file:line`), and verification result (exploit no longer reproduces / tests pass). Never include live secrets in the report; if a secret leaked, state clearly that **rotation is required** and whether it's been done. Feed this into `pentest-report` for the full write-up.
