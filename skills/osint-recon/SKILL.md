---
name: osint-recon
description: Perform open-source intelligence (OSINT) reconnaissance on domains, hosts, usernames, emails, or organizations. Use when asked to research, footprint, or gather intelligence on an external target.
---

Follow a structured, phased OSINT reconnaissance workflow:

### Phase 1: Target Definition & Scope
- Clarify the exact target (domain, IP, username, email, company).
- Ensure testing is passive, ethical, and within authorized bounds.

### Phase 2: Native Passive Reconnaissance
Execute immediate zero-dependency reconnaissance using Nutaan Code's native tools:
1. **DNS Recon** (`osint_dns_recon`):
   - Resolve A, AAAA, MX, NS, TXT, SOA, and CNAME records.
   - Inspect SPF and DMARC policies for email spoofability.
2. **Subdomain Enumeration** (`osint_subdomain_enum`):
   - Query Certificate Transparency logs via crt.sh to map the target's public attack surface and staging/dev servers.
3. **IP Intelligence** (`osint_ip_lookup`):
   - Retrieve ISP, ASN, organization, geographic location, and reverse DNS.
4. **Targeted Dorking** (`osint_dork_generator`):
   - Generate Google and GitHub dorks to locate exposed admin panels, sensitive documents, `.env` / credential leaks, and directory listings.

### Phase 3: Arsenal Tool Selection & Deep Recon
Search the 753-tool database using `osint_search_tools`:
- **Domain & Infrastructure**: `amass`, `sublist3r`, `theHarvester`, `shodan`, `censys`.
- **Username & Social**: `sherlock`, `maigret`, `blackbird`, `whatsmyname`.
- **Email & People**: `holehe`, `ghunt`, `h8mail`, `hunter`.
- **Breach & Leaks**: `haveibeenpwned`, `dehashed`, `breachdirectory`.

For web tools, use `browser_navigate` to inspect results directly in Nutaan Code's browser panel.
For CLI tools, propose running them via `run_command` with user approval.

### Phase 4: Intelligence Synthesis & Reporting
Synthesize findings into an actionable intelligence brief:
- **Executive Summary**: Target identity, primary infrastructure, security posture.
- **Key Assets**: Active domains, resolved subdomains, hosting providers, mail servers.
- **Exposure / Risks**: Weak SPF/DMARC policies, exposed endpoints, cloud buckets, breach records.
- **Recommended Next Steps**: Hardening actions or prioritized investigation avenues.
