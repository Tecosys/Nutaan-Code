---
name: auth-testing
description: Test authentication, session, and access control on an authorized target — the login/admin bypass steps of a penetration test. Use when the user asks to test, audit, or bypass a login/admin panel, cookie or session auth, JWT, password reset, or access control on a site they own or are authorized to test. Drives the real login flow in the built-in browser and proves each finding, rather than stopping at a headers report.
---

The most common real-world break-in is not an exploit — it's weak authentication, a trusted-client session, or missing access control. This skill covers those steps end to end. It only runs against a target the user **owns or is explicitly authorized to test** (see the `penetration-testing` authorization gate); confirm that first, then work the checklist. A scan of the public homepage is not enough — the session is set after login, so you must drive the actual flow.

## 1. Map the auth surface
In the built-in browser, find and note: the login page, any admin/dashboard path, register, password-reset, "remember me", SSO/OAuth, and the API auth style (cookie vs `Authorization: Bearer`). `osint_http_recon` gives the response headers and any cookies on a given URL; `browser_read_page` lists the login form's fields with selectors.

## 2. Log in and inspect the real session
`browser_navigate` to the login page, sign in with the credentials the user gave you (`browser_type` into the fields, `browser_click` submit), then inspect what the app actually trusts with `browser_execute_script`: `document.cookie`, `localStorage`, `sessionStorage`. Record every auth/session/role value and whether the cookies carry `HttpOnly` / `Secure` / `SameSite`, and whether tokens look signed (a JWT's three dot-separated parts) or are raw/guessable.

## 3. Credential weaknesses (targeted, not mass)
- **Default / weak credentials** — try the handful the app might ship with (admin/admin, admin/password, and any the user names). This is a targeted check, never a large-scale brute force.
- **Username enumeration** — does a wrong username give a different message/timing than a wrong password? That leaks valid accounts.
- **Rate limiting / lockout** — does the login throttle repeated failures at all?

## 4. Login-bypass logic
- **Injection at the login** — SQL/NoSQL auth bypass payloads in the username/password (e.g. a NoSQL operator object, or a classic `' OR '1'='1` where the backend concatenates) — confirm by whether it authenticates, not by an error.
- **Forced browsing** — after logging out (or without logging in), `browser_navigate` straight to a post-auth/admin URL. If it loads, the server isn't checking auth on that route.
- **Response/flow tampering** — a client that "logs you in" based on a response field or redirect it controls.

## 5. Trusted-client session & access control (the big one)
Determine whether the server **re-validates authorization on every protected request**, or trusts client-held state:
- With the user's approval, modify a client-held auth/role value (a `role`/`isAdmin`/`user_id` in a cookie, localStorage, or an unsigned/`alg:none` JWT) via `browser_execute_script`, then `browser_navigate` to a protected/admin page and `browser_read_page` to see whether access was granted. If it is, that's a **broken-access-control / trusted-client-auth** vulnerability — the finding the test exists to prove.
- **IDOR / horizontal & vertical escalation** — swap an object/user id to another user's resource, or a low-priv account to an admin action, and see if the server allows it.
- **Session hygiene** — is the session invalidated on logout and on password change? Is the id predictable? Fixation possible?

## 6. Reset / MFA
Password-reset token predictability or reuse, reset links that don't expire, host-header poisoning of the reset link, MFA that can be skipped by going straight to the post-MFA endpoint.

## Report and remediate
For each confirmed finding: exact steps, the request/state you changed, the impact (e.g. "any user reaches /admin by setting role=admin because the server never re-checks"), and the fix (validate authorization server-side on every request, sign & verify session state, enforce object-level checks, add lockout/rate-limiting). Then hand to `fix-security-vulnerabilities`. Keep everything on the authorized target, and remember every `browser_execute_script` is shown to the user for approval.
