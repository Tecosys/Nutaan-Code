---
name: reconnaissance
description: Map a target's attack surface before testing it — hosts, subdomains, ports, technologies, endpoints, parameters, and auth flows. Use during an authorized pentest, or when the user asks to enumerate, fingerprint, or map a target. Passive first, then active within the agreed scope.
---

Reconnaissance builds the map the rest of the test works from. Only enumerate targets in the agreed scope (see the `penetration-testing` skill's authorization gate). Go passive → active.

## 1. Passive (no packets to the target that look like an attack)

- **Scope the domains.** Root domain, known subdomains, related orgs. From the user's repo/OpenAPI spec if provided.
- **Public fingerprinting.** Certificate transparency (crt.sh), DNS records, tech stack from response headers and page source, `robots.txt`, `sitemap.xml`, `.well-known/`.
- **Source-assisted.** If a repo is in scope, read it: routes, framework, dependencies (and their known CVEs), config files, hardcoded hosts, feature flags, auth middleware. White-box recon is the fastest surface map you have.

## 2. Active (within scope + rules of engagement)

Run from the built-in terminal when the tooling is installed; otherwise fall back to `curl`/browser and note what a fuller scan would add. Passive recon needs no heavy tooling — crt.sh, DNS, HTTP headers, Wayback, and GitHub search are all a `curl` away. If you choose a Dockerized recon tool (e.g. SpiderFoot) and the Docker daemon is down, **start it yourself and poll until it's ready** rather than telling the user to — see the `penetration-testing` skill's "Bring up your own tooling". Don't stall the whole recon because one optional tool needs Docker.

- **Subdomain enumeration** — e.g. `subfinder -d target.com`, amass, or CT logs.
- **Port/service scan** — e.g. `nmap -sV -Pn host` for open ports and service versions. Respect rate limits.
- **Web tech fingerprint** — `whatweb`, `httpx -td`, or read the headers/JS yourself.
- **Content & endpoint discovery** — `ffuf`/`gobuster` for paths, `katana`/`hakrawler` for crawling, and the built-in browser to walk the app like a user. Capture every endpoint, parameter, and form.
- **Parameter discovery** — `arjun`/`paramspider`, plus params seen in JS and network traffic.
- **API surface** — if an OpenAPI/GraphQL schema exists, enumerate every operation, its parameters, and its auth requirement.

## 3. Produce the surface map

Write the map to the engagement notes so discovery has a checklist to work:

- Every host/subdomain and what it serves.
- Every endpoint + method + parameters, flagged authenticated vs. anonymous.
- Technologies and versions (link to known CVEs to check later).
- Auth flows: login, session/token mechanism, roles, and where privilege boundaries live (feeds IDOR/access-control testing).
- Interesting spots: file upload, redirects, server-side fetch, template rendering, admin areas, payment flows.

Prefer quiet, targeted enumeration over loud brute force. The goal is a complete map, not the most traffic.
