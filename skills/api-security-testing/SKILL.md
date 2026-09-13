---
name: api-security-testing
description: Security-test a REST, GraphQL, or gRPC API — enumerate endpoints from an OpenAPI/GraphQL/Postman schema (or by crawling), then actually exploit the API-specific vulnerability classes in the OWASP API Security Top 10 (2023) — broken object-level authorization (BOLA/IDOR), broken object property level authorization (excessive data exposure and mass assignment), broken function-level authorization, unrestricted resource consumption, SSRF, injection, and auth/token flaws. Every finding comes with a working proof-of-concept request. Nutaan sends the requests itself. Use when the user asks to pentest, security-test, audit, or find vulnerabilities in an API, endpoint, or backend service.
---

# Security-test an API

APIs fail differently from web UIs: there is no rendered surface to crawl, the interesting bugs are authorization-shaped rather than injection-shaped, and the same endpoint behaves differently per token. Nutaan tests these directly from the terminal (curl / a short request script), using the current [OWASP API Security Top 10 (2023)](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) as the coverage checklist. For the web-UI equivalent, see `owasp-top-10-testing` and `web-app-penetration-testing`.

## 1. Gather what the test needs

APIs are near-impossible to test blind, so collect first:

| Input | Why it matters |
|---|---|
| **Schema** — OpenAPI/Swagger (`.json`/`.yaml`), Postman collection, GraphQL introspection, or a gRPC `.proto` | Turns guesswork into full endpoint enumeration — the single biggest win in coverage. |
| **Two sets of credentials/tokens, in different tenants** | BOLA/IDOR (API1:2023, still the #1 API risk) can only be *proven* by accessing tenant A's objects with tenant B's token. |
| **A low-privilege and a high-privilege token** | Required to prove broken function-level authorization (API5:2023 — a `user` calling admin-only routes). |
| **Example object IDs** | Lets you test id tampering immediately instead of hunting for valid identifiers. |
| **Out-of-scope routes** | Payments, mass notification, destructive admin endpoints. |
| **Rate limits / WAF** in front of the API | So testing adapts instead of burning time on throttled requests. |

Ask the user for anything missing — never fabricate tokens or test an API they don't own.

## 2. Enumerate and test

Parse the schema into the full endpoint list (method + path + params + required auth), then work each OWASP API class:

- **API1 BOLA / object-level authz** — for every endpoint taking an object id, request tenant A's object with tenant B's token. A `200` with the other tenant's data is the proof; an empty `200` or `403` is not.
- **API2 Broken authentication** — weak/forgeable JWTs (`alg:none`, weak secret, `kid` injection, unverified signature), tokens that don't expire, credential-stuffing-friendly endpoints.
- **API3 Object property level authz** — mass assignment (send extra fields like `role`/`isAdmin` on `PATCH /users/{id}`) and excessive data exposure (list/detail responses leaking fields the client shouldn't see).
- **API4 Unrestricted resource consumption** — missing rate limits, unbounded page sizes, expensive queries, no pagination caps.
- **API5 Broken function-level authz** — call admin-only routes with a low-priv token.
- **API6 Unrestricted access to sensitive business flows**, **API7 SSRF** (any server-side fetch parameter), **API8 misconfiguration**, **API9 improper inventory** (undocumented/old `/v1` endpoints), **API10 unsafe third-party API consumption**.
- **Injection** where inputs reach a SQL/NoSQL/command/template sink.

Practical notes:
- **GraphQL** — if introspection is on, pull the schema; test batching/aliasing abuse, query depth/complexity limits, and per-field authorization.
- **gRPC** — use the `.proto` to build valid requests; test the same authz classes.
- **Many services** — keep a target list and work through them one at a time.
- **Add the backend source** (open the service repo in Nutaan) so you can reason about the real authorization checks and object ownership instead of inferring them from responses.

## 3. Validate and record

Every finding needs the exact request that proved it. Replay it with `curl` (see `exploit-validation`); for authorization findings, confirm the response really contains the other tenant's data rather than an empty success. Capture the request/response pair as evidence.

## 4. Fix, re-test, keep it tested

Remediate with `fix-security-vulnerabilities` — fix the shared authorization check, not the single endpoint — then replay the PoC to prove it's dead. Wire diff-scoped checks into pull-request CI with `ci-security-scanning` so new endpoints get tested as they ship. Write up with `pentest-report`.
