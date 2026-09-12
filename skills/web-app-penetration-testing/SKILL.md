---
name: web-app-penetration-testing
description: Pentest a web app or website end to end — black-box testing of a live URL, staging environment, or local dev server that finds and exploits real vulnerabilities (auth bypass, broken access control, IDOR, injection, XSS, SSRF, business logic) and proves each one with a working proof-of-concept instead of a signature match. Nutaan drives the test itself with its terminal and built-in browser. Use when the user asks to pentest, hack, security-test, or audit their web app, website, web application, or staging site.
---

# Pentest a web application

Black-box (and optionally source-assisted) penetration testing of a running web app. Nutaan is the pentester: it sends the requests, drives the built-in browser through the app, reads the responses, and proves each finding with an exploit — so every reported issue is validated, not a signature guess. For the per-class technique details this workflow leans on, use `web-vulnerability-testing`. To map the surface first, use `reconnaissance`.

## 1. Confirm authorization and scope

Before running anything, establish:

- **The target is the user's** or they are explicitly authorized to test it. Never pentest a third-party site on a hunch.
- **Which environment.** Prefer staging over production; real exploit payloads will create/modify data.
- **Out-of-scope paths** — payment flows, mass-email endpoints, destructive admin actions, third-party SSO providers.
- **Credentials.** Most real vulnerabilities live behind login. Without a test account you only ever see the marketing surface. Ask for **two accounts in different tenants plus one privileged account** — cross-account and privilege bugs are the highest-impact class and can only be proven with them.

Ask for anything missing rather than guessing.

## 2. Map, then work the surface

1. **Recon** (`reconnaissance`) — crawl the app in the built-in browser like a real user, capture every endpoint, parameter, form, and the auth/session mechanism. Note file uploads, redirects, server-side fetches, template rendering, admin areas, and payment flows.
2. **Test each class** (`web-vulnerability-testing`) against the mapped surface, prioritising by impact for web apps specifically:
   - **Broken access control / IDOR** first — log in as account A, then try to read or modify account B's resources by swapping ids/UUIDs; call admin routes as a low-priv user. This is consistently the top-impact class.
   - **Auth & session** — bypass, weak/forgeable tokens (JWT `alg:none`, weak secret), missing invalidation, insecure cookie flags.
   - **Injection** — SQL/NoSQL/command/template, confirmed by error/boolean/timing differences with benign payloads.
   - **XSS** — inject a marker and confirm it *executes* in the built-in browser, not just that it reflects.
   - **SSRF** — any parameter the server fetches; prove internal reachability without exfiltrating secrets.
   - **CSRF, open redirect, clickjacking, business logic** (price/quantity tampering, workflow skipping, race conditions).

## 3. Give the test what it needs

- **Credentials and login flow** — including unusual flows (magic link, SSO, MFA-exempt test user). Keep tokens out of shell history and out of committed files.
- **Two accounts beat one** — multi-tenant IDOR and broken-access-control bugs can only be *proven* by cross-account access.
- **Add the source for white-box depth** — open the repo in Nutaan alongside the live target. Reading the authorization layer materially improves coverage of business-logic and authz flaws (see `find-security-vulnerabilities-in-code`).
- **Localhost works** — point at the local dev server directly; the browser and terminal reach it with no sandbox in the way.

## 4. Validate, then report

For every candidate, build a minimal PoC with `exploit-validation` — re-run it yourself to confirm real impact before it counts as a finding. A reflected value that doesn't execute, or an id swap that returns only your own data, is not a finding.

Then write it up with `pentest-report`: severity + CVSS, OWASP class, exact reproduction, the PoC, business impact, and a concrete root-cause fix. Because the repo is open in Nutaan, offer to jump to the vulnerable file and draft the patch.

## 5. Fix and re-test

Hand findings to `fix-security-vulnerabilities`: patch the root cause, then re-run the exploit against the same target to prove it no longer works — re-testing is the only reliable confirmation a fix landed. To keep the app tested on every change, wire it into CI with `ci-security-scanning`.
