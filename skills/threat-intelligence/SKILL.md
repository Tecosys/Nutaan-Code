---
name: threat-intelligence
description: Investigate security indicators of compromise (IOCs), suspicious IPs, domains, hashes, or potential malware campaigns. Use when analyzing threat data, spam, or malicious infrastructure.
---

Follow this methodology to triage and contextualize indicators of compromise (IOCs):

### 1. Indicator Categorization
Classify the artifact:
- **Network IOC**: IP address, CIDR block, domain name, URL, ASN.
- **Host IOC**: File hash (MD5, SHA1, SHA256), registry key, mutex, file path.
- **Identity IOC**: Malicious sender email, cryptocurrency wallet, phishing handle.

### 2. Immediate Native Lookups
- **IP / Host Reputation**: Use `osint_ip_lookup` to check ISP, autonomous system (AS), hosting provider (bulletproof hosting vs legitimate cloud), and geographic origin.
- **DNS Infrastructure**: Use `osint_dns_recon` to check domain registration infrastructure, fast-flux behavior, and mail exchange records.
- **HTTP Behavior**: Use `osint_http_recon` to inspect redirects, web server banners, and deceptive TLS certificates.

### 3. Threat Intel Platform Queries
Query relevant tools from the 753-tool Arsenal using `osint_search_tools`:
- **Malware & Hash Hunting**: `virustotal`, `malwarebazaar`, `hybrid-analysis`, `anyrun`, `abusech-hunting`.
- **IP & Domain Reputation**: `abuseipdb`, `threatcrowd`, `alienvault-otx`, `urlhaus`, `greynoise`.
- **Phishing & URL Scanners**: `urlscan`, `phishtank`, `checkphish`.
- **Cryptocurrency & Ransomware**: `blockchain-explorer`, `chainabuse`, `bitcoinwhoswho`.

Use `browser_navigate` to inspect threat feeds or reports in the built-in browser panel.

### 4. Threat Assessment & Mitigation
Deliver a clear evaluation:
- **Verdict**: Malicious, Suspicious, Benign, or Inconclusive.
- **Attribution & Context**: Associated malware family, threat actor, or campaign (if known).
- **Blast Radius / Affected Assets**: Systems or communications at risk.
- **Actionable Blocklist / Rules**: Provide Snort, Suricata, YARA, or firewall block rules.
