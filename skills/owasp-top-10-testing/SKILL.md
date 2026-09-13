---
name: owasp-top-10-testing
description: Test an application against the OWASP Top 10 — attempt real exploits for each category of the current OWASP Top 10:2025 (broken access control including SSRF, security misconfiguration, software supply chain failures, cryptographic failures, injection, insecure design, authentication failures, integrity failures, logging and alerting failures, mishandling of exceptional conditions) and report only what can actually be proven, mapped back to the category with a proof-of-concept. Also covers the OWASP API Security Top 10 (2023). Use when the user asks for an OWASP Top 10 assessment, OWASP compliance testing, or a security review mapped to OWASP categories.
---

# Test against the OWASP Top 10

The OWASP Top 10 is a taxonomy of risk categories, not a test suite — "OWASP Top 10 testing" means exercising each category against the real application and reporting what's actually exploitable. Nutaan does the exploitation itself; this skill covers running it category-by-category and reporting coverage honestly.

**Use the current edition: [OWASP Top 10:2025](https://owasp.org/Top10/)** (supersedes 2021). Ask the user before targeting an older edition — some compliance checklists still reference 2021, and a report labelled with the wrong edition is misleading. Key differences from 2021: **SSRF is folded into A01**, **A03 Software Supply Chain Failures** expands the old "Vulnerable and Outdated Components", and **A10 Mishandling of Exceptional Conditions** is new; A02 Security Misconfiguration moved 5→2.

## What is and is not testable by a dynamic agent

Be straight with the user about this — claiming a clean sweep of all ten is misleading.

| Category (2025) | Coverage |
|---|---|
| A01 Broken Access Control (incl. SSRF) | **Strong** — cross-user/tenant access, privilege escalation, IDOR, and SSRF (including blind, via out-of-band callbacks) are all exploit-validated. Needs two accounts plus a privileged one to prove the authorization half. |
| A02 Security Misconfiguration | **Strong** — debug endpoints, verbose errors, permissive CORS, missing hardening, default credentials, exposed admin surfaces. |
| A03 Software Supply Chain Failures | **Partial** — version fingerprinting, and vulnerable/outdated dependency review when source is supplied. Build-system and distribution compromise (the broader half) is out of scope for a runtime test — pair with an SCA scanner and build-provenance controls. |
| A04 Cryptographic Failures | **Partial** — transport config, unencrypted data in transit, secrets/tokens leaked in responses. At-rest crypto and key management need source or infra review. |
| A05 Injection | **Strong** — SQL/NoSQL/command/template injection and XSS, exploit-validated. |
| A06 Insecure Design | **Partial** — business-logic abuse (price/quantity tampering, workflow skipping, race conditions) is found where reachable; design intent still needs human review and threat modelling. |
| A07 Authentication Failures | **Strong** — auth bypass, weak session/token handling, password-reset and MFA flaws. |
| A08 Software or Data Integrity Failures | **Partial** — insecure deserialization and unsigned-update paths where reachable; CI/CD trust boundaries are not runtime-testable. |
| A09 Security Logging & Alerting Failures | **Not testable from outside** — requires reviewing the logging and alerting pipeline. State this rather than reporting it as passed. |
| A10 Mishandling of Exceptional Conditions | **Partial** — actively probe error handling and fail-open behaviour (malformed input, forced errors, race/timeout conditions) and report what leaks or bypasses a control; exhaustive coverage of internal error paths needs source review. |

For APIs, run the same exercise against the **OWASP API Security Top 10 (2023)** using the `api-security-testing` skill (API1 BOLA, API3 broken object property level authorization, API5 broken function-level authorization, and the rest).

## Run it, category by category

Maximum coverage comes from having **both the source and a running instance**, plus credentials at two privilege levels. Open the repo in Nutaan and point the built-in browser / terminal at the running app, then walk every category systematically:

1. Work `web-vulnerability-testing` class-by-class, tagging each finding with its 2025 category id.
2. Prioritise the strong-coverage categories where a dynamic test proves the most: **A01** (cross-org access, privilege escalation, SSRF), **A02**, **A05**, **A07**, **A10**.
3. For the partial/not-testable categories, do the source/config review you can (dependencies for A03, transport/secrets for A04, deserialization for A08) and explicitly mark what a runtime test cannot reach.

Without a second account, A01 results are structurally incomplete — say so in the report rather than leaving it implied.

## Report honestly

Group findings by category and state, per category: what was attempted, what was proven, and what could not be assessed (A09 always; A03/A04/A06/A08/A10 partially). Label the report with the edition used (OWASP Top 10:2025). Verify each PoC yourself before it goes in front of the user. A category with no finding is "nothing exploitable proven here", not "secure". Then remediate with `fix-security-vulnerabilities` and re-test each fix; for ongoing coverage as the app changes, gate pull requests with `ci-security-scanning`.
