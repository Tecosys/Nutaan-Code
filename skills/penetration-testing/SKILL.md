---
name: penetration-testing
description: Run an authorized penetration test end to end — recon, mapping, exploitation, validation, and reporting. Nutaan is the pentester itself, using its terminal, built-in browser, and file tools; no external scanner or Docker required. Use when the user asks to pentest, hack, attack, or find and prove exploitable vulnerabilities in a target they own or are authorized to test. Orchestrates the reconnaissance, web-app-penetration-testing, api-security-testing, owasp-top-10-testing, web-vulnerability-testing, find-security-vulnerabilities-in-code, exploit-validation, fix-security-vulnerabilities, and pentest-report skills.
---

Run a penetration test the way a real attacker would: find a weakness, then prove it with a working proof-of-concept instead of guessing. This is the umbrella — it sets scope and rules of engagement, then hands off to the focused skills. **Nutaan does the exploitation itself** (terminal + built-in browser + file access); every finding is validated, so there are no signature-based false positives to triage.

## Before anything: authorization gate

Only proceed against a target the user owns or is explicitly authorized to test. Establish this first and record it at the top of the engagement notes:

- **Target and scope.** Which hosts, domains, IP ranges, apps, repos, or API specs are in scope — and what is explicitly out (payment flows, mass-email endpoints, destructive admin actions, third-party SSO).
- **Authorization.** The user owns the target or holds written permission (engagement contract, bug-bounty scope, or their own system). If they can't assert this, stop — don't test third-party systems on unverified say-so.
- **Rules of engagement.** Test windows, whether destructive tests (data modification, DoS) are permitted (default: **no**), rate limits, and any accounts/credentials for authenticated testing. Prefer **staging over production** — real exploit payloads create and modify data.
- **Credentials.** Ask for two accounts in different tenants plus one privileged account; the highest-impact bugs (cross-tenant access, privilege escalation) can only be proven with them.

If scope is unclear, ask before touching anything.

## Choose the engagement type

| The target is… | Start with |
|---|---|
| Not yet a single asset ("secure my app") | `application-security-testing` (picks the right test per asset) |
| A live web app / website / staging URL | `web-app-penetration-testing` |
| A REST/GraphQL/gRPC API | `api-security-testing` |
| A repo or working tree (white-box) | `find-security-vulnerabilities-in-code` |
| A compliance-style OWASP assessment | `owasp-top-10-testing` |

## Phases (delegate to the focused skills)

1. **Reconnaissance** → `reconnaissance`. Map the surface: hosts, subdomains, ports, technologies, endpoints, parameters, auth flows. Passive first, then active within scope.
2. **Discovery** → `web-vulnerability-testing` (technique reference) driven by the workflow skill above. Work every class methodically — access control/IDOR, injection, XSS, SSRF, XXE, auth/JWT, CSRF, business logic, mass assignment, misconfiguration.
3. **Validation** → `exploit-validation`. Build a minimal, safe PoC for each candidate. No unproven findings in the report.
4. **Reporting** → `pentest-report`. Confirmed findings with CVSS, OWASP class, reproduction, PoC, and concrete remediation.
5. **Remediation** → `fix-security-vulnerabilities`. Patch the root cause, then re-run the exploit to prove closure.
6. **Continuous** → `ci-security-scanning`. Keep the target tested on every change.

## Use the tools you already have

Nutaan gives you what an autonomous pentest platform's sandbox provides, natively:

- **Terminal** — recon and testing tooling when installed (curl, nmap, ffuf, nuclei, sqlmap, jwt tooling), and running PoC scripts (Python/Node) in the scratch directory.
- **Built-in browser** — drive authenticated flows, test client-side issues (XSS, CSRF, clickjacking), observe requests/responses.
- **File read/edit** — source-assisted (white-box) testing when a repo or OpenAPI spec is in scope, and drafting the fix in place afterwards.
- **Memory / knowledge base** — keep engagement notes (scope, credentials handling, findings, retest status) across the session.

### Bring up your own tooling — don't punt to the user

When a scan needs a service or CLI that isn't running, start it yourself before asking for help. Telling the user "Docker isn't running, here are instructions" is the app admitting it knows what to do and declining to do it.

- **Prefer the built-in tools first.** Most passive recon and a lot of active testing needs nothing but the terminal (`curl`, `git`, `openssl`, `nslookup`/`dig`) and the built-in browser: crt.sh, DNS, HTTP headers, Wayback, GitHub search, and endpoint probing all work with `curl` and the browser, no Docker at all. Reach for a heavy scanner only when it genuinely adds coverage — don't make the run depend on one.
- **If you do want a Dockerized scanner** (SpiderFoot, nuclei, OWASP ZAP, an sqlmap image) and `docker info` fails, check whether Docker is merely stopped and start it, then poll until the engine answers:
  - Windows: `powershell -Command "Start-Process 'C:\Program Files\Docker\Docker\Docker Desktop.exe'"`
  - macOS: `open -a Docker`
  - Linux: `sudo systemctl start docker` (or `service docker start`)
  - Then loop on `docker info` (every few seconds, ~2 min cap) until it returns a server version. Once up, **actually run the scan** — `docker run --rm ...`, read the output, report findings — rather than writing instructions for the user to run it.
- **Only hand back the one thing a human must do.** A first-run Docker Desktop that needs its terms accepted or WSL2 enabled, `sudo` you don't have, or credentials — name that single action precisely and stop there. Don't paste a generic setup guide, and don't give up on the whole scan because one optional tool wouldn't start: fall back to the built-in-tool path and get what coverage you can.

> Optional heavier engine: if the user has the external Strix CLI (Docker) installed and wants a fully autonomous multi-agent run as a second opinion, Nutaan can drive it from the terminal — but it is not required; everything here runs with Nutaan's own tools.

## Discipline

- Prefer non-destructive proofs. Read, don't write; enumerate, don't delete. Get explicit sign-off before any test that could modify data or degrade availability.
- Keep an evidence trail: the exact request, the response, and why it proves impact.
- Rate honestly. Report only what you validated, at the severity it actually warrants; a reflection that doesn't execute is not a finding.
- Be honest about coverage: name what you did **not** test (categories a dynamic test can't reach, assets with no staging). An empty result set is not a clean bill of health.
- Never exfiltrate real user data or use findings beyond demonstrating the vulnerability to the owner. Keep credentials and secrets out of shell history and committed files.
