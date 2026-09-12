---
name: security-audit
description: Audit web applications, servers, or endpoints for configuration weaknesses, missing security headers, exposed secrets, and vulnerabilities. Use when assessing an application's external security posture.
---

Perform an authorized, systematic security audit:

### 1. Local Source Code Vulnerability Scan (Zero-GPU, Deterministic)
Run `vuln_static_scan` on the codebase (`path: "."` or specific folder/file):
- Scans for SQL Injection (CWE-89), Command Injection (CWE-78), Hardcoded Secrets (CWE-798), Path Traversal (CWE-22), and unsafe dynamic evaluation.
- Runs instantly offline without any LLM refusal or cloud API limitations.

### 2. HTTP Security Header & Defense Audit
Run `osint_http_recon` against the target to evaluate browser-level defenses:
- **Strict-Transport-Security (HSTS)**: Is HTTPS strictly enforced with `max-age` and `includeSubDomains`?
- **Content-Security-Policy (CSP)**: Are scripts restricted, or can an attacker execute arbitrary inline XSS?
- **X-Frame-Options / frame-ancestors**: Is the application protected against Clickjacking?
- **X-Content-Type-Options**: Is `nosniff` enabled to prevent MIME-type confusion?
- **Server Banners**: Are exact Apache, Nginx, PHP, or framework versions disclosed in HTTP headers?

### 2. Attack Surface Discovery
- **Subdomain Discovery**: Run `osint_subdomain_enum` to uncover forgotten QA, staging, or admin environments.
- **Dorking for Exposures**: Run `osint_dork_generator` to check for accidentally indexed `.env` files, database dumps, backup `.zip` archives, or exposed Swagger/API docs.

### 3. Arsenal Tooling for Vulnerability Scanning
Search the Arsenal using `osint_search_tools` (category: `domain-ip-network` or `red-team-offensive`):
- **Web App Scanners**: `nuclei`, `nikto`, `zap`, `arjun` (parameter discovery), `sqlmap` (SQLi testing).
- **SSL / TLS Configuration**: `testssl.sh`, `sslyze`.
- **API Security**: `postman`, `kiterunner`, `ffuf`.

For CLI tools, propose the exact command via `run_command` with full explanation and require user approval.

### 4. Findings & Remediation Plan
Structure your report with:
1. **Executive Score & Summary**
2. **Critical & High Severity Vulnerabilities** (with reproduction steps)
3. **Medium & Low Configuration Issues**
4. **Concrete Remediation Snippets** (e.g. Nginx config, Express middleware, Apache `.htaccess`, or CSP directives).
