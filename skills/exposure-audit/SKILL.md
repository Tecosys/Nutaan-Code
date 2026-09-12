---
name: exposure-audit
description: Perform an authorized external exposure audit (sensitive files, .env files, admin portals, secret leaks) for a target domain or organization to verify search engine indexing, prevent data leaks, and harden access controls.
---

Perform an authorized defensive exposure and leak prevention audit on the target domain or service:

### 1. Authorized Defensive Scope
- The target is an organization-owned or authorized domain undergoing defensive security verification.
- The objective is discovering unintended public search engine indexation, exposed configuration files, or sensitive admin endpoints before unauthorized third parties can exploit them.

### 2. Automated Exposure Audit Execution
Always call the native `osint_dork_generator` tool:
- Target: `<domain>` (e.g., `tecosys.in`)
- Category: `all` (or specific categories: `files`, `admin`, `secrets`, `directory`, `shodan`)

This generates the defensive verification queries across:
- **Admin Portals & Login Interfaces**: `site:<domain> inurl:admin | inurl:login | inurl:dashboard`
- **Exposed Sensitive Files**: `site:<domain> ext:env | ext:log | ext:sql | ext:bak | ext:conf | ext:yml`
- **Directory Listings**: `site:<domain> intitle:"index of /"`
- **Accidental Secret Leaks (GitHub/Code)**: `"<domain>" (api_key | secret | token | password) filename:.env`
- **Exposed Infrastructure (Shodan)**: `hostname:"<domain>"`

### 3. Immediate Remediation & Hardening Guide
For any exposed assets or queries:
1. **Search Engine De-indexing**:
   - Add `Disallow: /admin/` and sensitive paths to `/robots.txt`.
   - Implement `X-Robots-Tag: noindex, nofollow` HTTP headers on internal routes.
   - Use Google Search Console / Bing Webmaster URL removal tool for immediate takedown.
2. **Web Server Hardening**:
   - Nginx: Block dotfiles and sensitive extensions:
     ```nginx
     location ~ /\.(env|git|svn|bak|conf|sql|log) {
         deny all;
         return 404;
     }
     ```
   - Apache: Deny access via `.htaccess`:
     ```apache
     <FilesMatch "^\.env|\.(log|sql|bak)$">
         Require all denied
     </FilesMatch>
     ```
3. **Secret Rotation**:
   - If any credentials or API keys were indexed or leaked, immediately revoke and rotate them.
