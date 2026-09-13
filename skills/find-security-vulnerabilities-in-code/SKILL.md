---
name: find-security-vulnerabilities-in-code
description: Find security vulnerabilities in a codebase or repository — a white-box security review that reads the source, reasons about the actual data flow and authorization model, then exploits what it finds in a live sandbox so every reported issue has a working proof-of-concept instead of a noisy static-analysis alert. Covers injection, XSS, SSRF, broken access control and IDOR, insecure deserialization, secrets in code, unsafe dependencies, and business-logic flaws. Use when the user asks to security-scan, security-review, or audit their code, repo, or pull request for vulnerabilities.
---

# Find security vulnerabilities in code

White-box security review: read the source to build a model of routes, sinks, and authorization checks, then attempt real exploitation against a running instance. The output is a short list of *proven* issues with proof-of-concepts, not the hundreds of "potential" hits a pattern-matcher produces. This is Nutaan's strongest security mode — it already has the repo open and can read every file, then drive the running app to confirm.

## 1. Build the model from the source

Read the code the way an attacker with source access would:

- **Routes & entry points** — every HTTP handler, GraphQL resolver, CLI, queue consumer, and webhook. These are the attack surface.
- **Sinks** — where input reaches a dangerous operation: DB queries (SQL/NoSQL), shell/`exec`, template rendering, file paths, deserialization, outbound HTTP (SSRF), HTML output (XSS).
- **The authorization model** — where and how the app checks *who* the caller is and *whether they may act on this specific object*. Note the tenancy model (how tenant/owner id is derived — session, JWT claim, URL?). Most high-impact bugs are a missing object-level check, so map this carefully.
- **Trust boundaries** — which inputs are attacker-controlled, and what is assumed trusted but shouldn't be.
- **Secrets** — hardcoded keys/passwords/tokens in source, config, or committed history.
- **Dependencies** — outdated/vulnerable packages (cross-check versions against known CVEs).

Follow the taint: for each attacker-controlled input, trace whether it reaches a sink without adequate validation/escaping, and whether the handler enforces authorization before acting.

## 2. Prove it against a running instance

Reading the source tells you where a bug *probably* is; a running instance turns "this looks unsafe" into a validated finding. Start the app (or ask the user to), point the built-in browser / terminal at it, and exploit the candidate with `exploit-validation`. If nothing can be run, describe static-only findings as **unconfirmed** — never present an unexploited code smell as a confirmed vulnerability.

## 3. Scope the review

Whole-repo review is wasteful on a large codebase. Focus on the risky subtree and tell yourself what matters, e.g. "the authorization layer in `src/auth` and every route under `src/routes/admin`; multi-tenant, tenant id comes from the JWT — flag any query that filters by object id without also filtering by tenant." For a pull request, review only the diff (`git diff <base>...HEAD`) — see `ci-security-scanning` for diff-scoping in a pipeline.

## 4. Report with file and line

For each finding give the exact `file:line`, the data flow that makes it exploitable, the PoC, and the root-cause fix. Because the repo is open in Nutaan, offer to jump to the line and draft the patch immediately.

## 5. Complementary tooling

This is exploit-validated review, not an exhaustive inventory. Keep a dependency scanner (SCA) and secret scanning in place for complete coverage of known-CVE dependencies and committed credentials; use this review for the logic, authorization, and injection bugs those tools structurally cannot find.

Then hand results to `fix-security-vulnerabilities`: patch the root cause (the shared authorization helper, not the one route), and re-run the exploit to prove it's closed.
