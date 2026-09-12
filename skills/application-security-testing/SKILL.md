---
name: application-security-testing
description: Application security testing (AppSec) across a whole product — decide which asset needs which test (source code, running web app, API, CI pipeline), run it, and turn the results into one ranked remediation plan. Nutaan exploits and proves each issue itself instead of emitting static-analysis alerts, so the plan is ordered by what is actually reachable. Use when the user asks for an application security review or audit, an appsec assessment, vulnerability scanning across their stack, a pre-launch security review or customer security questionnaire, or does not yet know which kind of security test they need.
---

# Application security testing

This is the entry point for "make my application secure" when the target is not yet a single URL or repo. Nutaan does the testing itself — its terminal, built-in browser, and file tools are the whole toolkit, so there is nothing external to install. The job here is to pick the right test per asset, run it, and produce one ranked plan — not to run everything at maximum depth.

**Authorization first.** Only test assets the user owns or is explicitly authorized to test. Confirm this before the first probe, and prefer staging over production — real exploit payloads can create or modify data. See the `penetration-testing` skill for the full authorization/scope gate; record the answers in the engagement notes.

## 1. Map the assets

Ask, or read from the repo, and write the answers down before scanning:

- **Source** — one repo, a monorepo, several services? Which languages/frameworks?
- **Running environments** — staging deployment? public production site? local dev server only?
- **APIs** — REST, GraphQL, gRPC? Is there an OpenAPI/GraphQL schema or Postman collection?
- **Authentication** — can you get two test accounts in different tenants, plus one privileged account? Most high-impact bugs need them.
- **Constraints** — out-of-scope paths, whether production may be touched, and any time limits.

If there is no staging environment and production is off limits, say so early. A code-only review is still valuable, but it cannot prove exploitability against a live app.

## 2. Pick the right test per asset

| Asset | Skill to use |
| --- | --- |
| Repository or working tree | `find-security-vulnerabilities-in-code` |
| Live web app or staging site | `web-app-penetration-testing` |
| REST / GraphQL / gRPC API | `api-security-testing` |
| Assessment mapped to OWASP categories | `owasp-top-10-testing` |
| A specific vulnerability class, hands-on technique | `web-vulnerability-testing` |
| Attack-surface mapping before any of the above | `reconnaissance` |
| Every pull request, continuously | `ci-security-scanning` |
| Proving a candidate finding | `exploit-validation` |
| Writing it all up | `pentest-report` |

Those skills carry the technique, credential handling, and evidence details — don't duplicate them here.

Sequence for a first assessment:

1. **Review the code first.** Cheapest pass, and it maps the authorization model that makes the live run sharper.
2. **Pentest staging with credentials**, keeping the repo open in Nutaan so source context is available while testing live behaviour.
3. **Add CI scanning**, so later regressions are caught without another manual pass.

Run one asset at a time and read each result before starting the next.

## 3. Consolidate into one plan

Merge findings across runs and rank by **proven impact**, not by scanner severity:

1. Validated exploits reachable without authentication.
2. Validated cross-tenant or privilege-escalation issues.
3. Validated issues needing an authenticated account.
4. Unproven observations (configuration, dependency, hardening notes) — flag as such, never as confirmed vulnerabilities.

Deduplicate: the same root cause often surfaces in both the code review and the live pentest.

## 4. Be honest about coverage

State plainly what was *not* tested — assets with no staging environment, and categories a black-box run cannot reach (logging/alerting, supply-chain integrity, insecure design). An empty result set is not a clean bill of health; it means nothing exploitable was proven in what was actually examined. Then remediate with `fix-security-vulnerabilities`, which re-tests each fix to prove the exploit no longer works.
