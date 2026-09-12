const fs = require("fs");
const path = require("path");
const dns = require("dns").promises;

const ARSENAL_FILE = path.join(__dirname, "tools.json");
let toolsCache = null;

function loadTools() {
  if (toolsCache) return toolsCache;
  try {
    const raw = fs.readFileSync(ARSENAL_FILE, "utf8");
    toolsCache = JSON.parse(raw);
  } catch (err) {
    console.error("[Arsenal] Failed to load tools.json:", err.message);
    toolsCache = [];
  }
  return toolsCache;
}

const STOP_WORDS = new Set([
  "a", "about", "above", "after", "again", "all", "am", "an", "and", "any", "are",
  "arsenal", "as", "at", "be", "because", "been", "before", "being", "below", "between",
  "both", "but", "by", "can", "cannot", "cant", "check", "checking", "checks", "company",
  "could", "did", "do", "does", "doing", "down", "during", "each", "few", "find", "finding",
  "for", "from", "further", "had", "has", "have", "having", "he", "her", "here", "hers",
  "herself", "him", "himself", "his", "how", "i", "if", "in", "into", "is", "it",
  "its", "itself", "let", "list", "listing", "look", "lookup", "me", "more", "most", "my",
  "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or", "other", "ought",
  "our", "ours", "ourselves", "out", "over", "own", "same", "search", "searching", "she",
  "should", "show", "showing", "sites", "site", "so", "some", "such", "than", "that", "the",
  "their", "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those",
  "through", "to", "tool", "tools", "too", "under", "until", "up", "very", "was", "we", "were",
  "what", "when", "where", "which", "while", "who", "whom", "why", "with", "would", "you", "your"
]);

/**
 * Search the 753+ tools in the Arsenal
 */
function searchTools({ query = "", category = "", method = "", tag = "", limit = 25 } = {}) {
  const tools = loadTools();
  const q = String(query).trim().toLowerCase();
  const cat = String(category).trim().toLowerCase();
  const meth = String(method).trim().toLowerCase();
  const tg = String(tag).trim().toLowerCase();

  const results = [];

  // Filter out stop words and extract meaningful keywords
  const rawWords = q ? q.split(/[\s,._\-/]+/).filter(Boolean) : [];
  let keywords = rawWords.filter((w) => w.length > 2 && !STOP_WORDS.has(w));
  if (!keywords.length && rawWords.length) keywords = rawWords;

  // Compute document frequency for keywords
  const df = {};
  for (const w of keywords) {
    let count = 0;
    for (const t of tools) {
      const text = ((t.name || "") + " " + (t.id || "") + " " + (t.description || "") + " " + (t.category || "") + " " + (t.tags || []).join(" ")).toLowerCase();
      if (text.includes(w)) count++;
    }
    df[w] = count || 1;
  }

  for (const tool of tools) {
    if (cat && (tool.category || "").toLowerCase() !== cat) continue;
    if (meth && ((tool.install && tool.install.method) || "").toLowerCase() !== meth) continue;
    if (tg && !(tool.tags || []).some((t) => t.toLowerCase().includes(tg))) continue;

    if (!q) {
      results.push({ tool, score: 1 });
      continue;
    }

    let score = 0;
    const name = (tool.name || "").toLowerCase();
    const id = (tool.id || "").toLowerCase();
    const desc = (tool.description || "").toLowerCase();
    const tags = (tool.tags || []).join(" ").toLowerCase();
    const aliases = (tool.aliases || []).join(" ").toLowerCase();
    const toolCat = (tool.category || "").toLowerCase();

    // Exact matches
    if (id === q || name === q) score += 250;
    else if (id.startsWith(q) || name.startsWith(q)) score += 120;
    else if (id.includes(q) || name.includes(q)) score += 60;

    if (aliases.includes(q)) score += 30;
    if (toolCat.includes(q)) score += 25;
    if (tags.includes(q)) score += 25;
    if (desc.includes(q)) score += 20;

    // Keyword scoring with Inverse Document Frequency (rare terms like "ransomware", "infostealer" get massive boost)
    for (const w of keywords) {
      const idf = Math.log(tools.length / df[w]) + 1;
      let wScore = 0;
      if (name === w || id === w) wScore += 60;
      else if (name.includes(w)) wScore += 35;
      if (desc.includes(w)) wScore += 25;
      if (tags.includes(w)) wScore += 20;
      if (toolCat.includes(w)) wScore += 15;
      score += wScore * idf;
    }

    // High-intent domain boosts
    if (q.includes("ransomware") && (desc.includes("ransomware") || name.includes("ransom"))) score += 120;
    if ((q.includes("infostealer") || q.includes("stealer")) && (desc.includes("infostealer") || tags.includes("infostealer") || desc.includes("stealer"))) score += 120;
    if ((q.includes("darkweb") || q.includes("dark web") || q.includes("onion") || q.includes("tor")) && toolCat === "dark-web") score += 60;
    if ((q.includes("breach") || q.includes("leak") || q.includes("compromise")) && toolCat === "data-breach") score += 60;

    if (score > 0) {
      results.push({ tool, score });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit).map((r) => r.tool);
}

/**
 * Get category overview and counts
 */
function getCategories() {
  const tools = loadTools();
  const catMap = new Map();

  for (const t of tools) {
    const cat = t.category || "uncategorized";
    const current = catMap.get(cat) || { category: cat, count: 0, methods: new Set() };
    current.count++;
    if (t.install && t.install.method) current.methods.add(t.install.method);
    catMap.set(cat, current);
  }

  return Array.from(catMap.values())
    .map((c) => ({
      category: c.category,
      count: c.count,
      methods: Array.from(c.methods),
    }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Retrieve a specific tool by its ID
 */
function getToolById(id) {
  const tools = loadTools();
  const lower = String(id).toLowerCase().trim();
  return (
    tools.find(
      (t) =>
        t.id.toLowerCase() === lower ||
        (t.name && t.name.toLowerCase() === lower) ||
        (t.aliases && t.aliases.some((a) => a.toLowerCase() === lower))
    ) || null
  );
}

// ================= Native Recon Utilities =================

function sanitizeHost(input) {
  let host = String(input).trim();
  host = host.replace(/^https?:\/\//i, "");
  host = host.replace(/\/.*$/, "");
  host = host.replace(/:\d+$/, "");
  return host.toLowerCase();
}

/**
 * Native DNS reconnaissance using node:dns/promises
 */
async function dnsRecon(domainInput) {
  const domain = sanitizeHost(domainInput);
  if (!domain || !domain.includes(".")) {
    throw new Error(`Invalid domain name: "${domainInput}"`);
  }

  const results = {
    domain,
    records: {},
    security: {
      hasSpf: false,
      hasDmarc: false,
      spfRecord: null,
      dmarcRecord: null,
    },
    timestamp: new Date().toISOString(),
  };

  const lookups = [
    { type: "A", fn: () => dns.resolve4(domain) },
    { type: "AAAA", fn: () => dns.resolve6(domain) },
    { type: "MX", fn: () => dns.resolveMx(domain) },
    { type: "NS", fn: () => dns.resolveNs(domain) },
    { type: "TXT", fn: () => dns.resolveTxt(domain) },
    { type: "CNAME", fn: () => dns.resolveCname(domain) },
    { type: "SOA", fn: () => dns.resolveSoa(domain) },
  ];

  await Promise.allSettled(
    lookups.map(async ({ type, fn }) => {
      try {
        const res = await fn();
        results.records[type] = res;
      } catch (err) {
        results.records[type] = null;
      }
    })
  );

  try {
    const dmarcTxt = await dns.resolveTxt(`_dmarc.${domain}`);
    const flattened = dmarcTxt.map((parts) => parts.join(""));
    const match = flattened.find((t) => t.toLowerCase().startsWith("v=dmarc1"));
    if (match) {
      results.security.hasDmarc = true;
      results.security.dmarcRecord = match;
    }
  } catch {
    // No DMARC
  }

  if (Array.isArray(results.records.TXT)) {
    const flattened = results.records.TXT.map((parts) => parts.join(""));
    const spf = flattened.find((t) => t.toLowerCase().startsWith("v=spf1"));
    if (spf) {
      results.security.hasSpf = true;
      results.security.spfRecord = spf;
    }
  }

  return results;
}

/**
 * Public IP intelligence & geolocation via ip-api
 */
async function ipLookup(ipOrHost) {
  const target = sanitizeHost(ipOrHost);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);

  try {
    const url = `http://ip-api.com/json/${encodeURIComponent(target)}?fields=status,message,country,countryCode,region,regionName,city,zip,lat,lon,timezone,isp,org,as,query`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "NutaanCode-OSINT/1.0" },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`IP lookup service returned status ${res.status}`);
    const data = await res.json();
    if (data.status === "fail") {
      throw new Error(data.message || "IP lookup failed for target");
    }

    let hostname = null;
    try {
      const hostnames = await dns.reverse(data.query);
      hostname = hostnames[0] || null;
    } catch {
      // Reverse DNS failed
    }

    return {
      ip: data.query,
      country: data.country,
      countryCode: data.countryCode,
      region: data.regionName,
      city: data.city,
      zip: data.zip,
      lat: data.lat,
      lon: data.lon,
      timezone: data.timezone,
      isp: data.isp,
      org: data.org,
      as: data.as,
      reverseDns: hostname,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`IP lookup error for ${target}: ${err.message}`);
  }
}

/**
 * Passive subdomain enumeration via crt.sh (Certificate Transparency)
 */
async function subdomainEnum(domainInput) {
  const domain = sanitizeHost(domainInput);
  if (!domain || !domain.includes(".")) {
    throw new Error(`Invalid domain: "${domainInput}"`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const url = `https://crt.sh/?q=%25.${encodeURIComponent(domain)}&output=json`;
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "NutaanCode-OSINT/1.0" },
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`crt.sh returned HTTP ${res.status}`);
    const data = await res.json();

    const subdomains = new Set();
    for (const entry of data) {
      const name = entry.name_value;
      if (!name) continue;
      const parts = name.split("\n");
      for (const p of parts) {
        const clean = p.trim().toLowerCase().replace(/^\*\./, "");
        if (clean.endsWith(`.${domain}`) || clean === domain) {
          subdomains.add(clean);
        }
      }
    }

    const sortedList = Array.from(subdomains).sort();
    return {
      domain,
      source: "certificate-transparency",
      count: sortedList.length,
      subdomains: sortedList.slice(0, 150),
      truncated: sortedList.length > 150,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timer);
    // Graceful fallback to DNS probe on common high-value subdomains
    const COMMON_PREFIXES = [
      "www", "api", "mail", "dev", "staging", "app", "admin", "blog", "vpn",
      "portal", "auth", "secure", "cdn", "test", "status", "git", "shop", "support", "docs"
    ];
    const found = [];
    await Promise.allSettled(
      COMMON_PREFIXES.map(async (prefix) => {
        const candidate = `${prefix}.${domain}`;
        try {
          await dns.resolve4(candidate);
          found.push(candidate);
        } catch {}
      })
    );

    return {
      domain,
      source: "dns-probe-fallback",
      note: `Certificate transparency feed was busy (${err.message}). Probed top common prefixes.`,
      count: found.length,
      subdomains: found.sort(),
      truncated: false,
      timestamp: new Date().toISOString(),
    };
  }
}

function parseCookieHeader(str) {
  const parts = String(str).split(";").map((p) => p.trim());
  const [first, ...attrs] = parts;
  const eqIdx = first.indexOf("=");
  const name = eqIdx > -1 ? first.slice(0, eqIdx).trim() : first.trim();
  const value = eqIdx > -1 ? first.slice(eqIdx + 1).trim() : "";

  const cookie = {
    name,
    valuePreview: value.length > 24 ? value.slice(0, 10) + "…" + value.slice(-6) : value,
    httpOnly: false,
    secure: false,
    sameSite: null,
    domain: null,
    path: null,
    expires: null,
    maxAge: null,
    issues: [],
    severity: "LOW",
  };

  for (const a of attrs) {
    const lower = a.toLowerCase();
    if (lower === "httponly") cookie.httpOnly = true;
    else if (lower === "secure") cookie.secure = true;
    else if (lower.startsWith("samesite=")) cookie.sameSite = a.split("=")[1].trim();
    else if (lower.startsWith("domain=")) cookie.domain = a.split("=")[1].trim();
    else if (lower.startsWith("path=")) cookie.path = a.split("=")[1].trim();
    else if (lower.startsWith("expires=")) cookie.expires = a.split("=")[1].trim();
    else if (lower.startsWith("max-age=")) cookie.maxAge = a.split("=")[1].trim();
  }

  const isSensitive = /session|token|auth|jwt|sid|login|user|id/i.test(name);

  if (!cookie.httpOnly) {
    cookie.issues.push("Missing HttpOnly: readable by client-side JavaScript via document.cookie (vulnerable to XSS session theft)");
    if (isSensitive) cookie.severity = "HIGH";
  }
  if (!cookie.secure) {
    cookie.issues.push("Missing Secure: can be transmitted over plain HTTP (vulnerable to MITM packet sniffing)");
    if (isSensitive) cookie.severity = "HIGH";
  }
  if (!cookie.sameSite || cookie.sameSite.toLowerCase() === "none") {
    cookie.issues.push(`Insecure SameSite (${cookie.sameSite || "missing"}): sent on third-party cross-site requests (risk of CSRF)`);
    if (cookie.severity !== "HIGH") cookie.severity = "MEDIUM";
  }
  if (isSensitive && !name.startsWith("__Host-") && !name.startsWith("__Secure-")) {
    cookie.issues.push("Lacks cookie prefix (__Host- or __Secure-): vulnerable to subdomain cookie injection or path tampering");
  }

  return cookie;
}

/**
 * Inspect HTTP security headers, server banners, cookies, and credential exposure
 */
async function httpRecon(urlInput) {
  let target = String(urlInput).trim();
  if (!target.startsWith("http://") && !target.startsWith("https://")) {
    target = `https://${target}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);

  try {
    const res = await fetch(target, {
      method: "GET",
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 NutaanCode-Security-Audit/1.0",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timer);

    const headers = {};
    for (const [k, v] of res.headers.entries()) {
      headers[k.toLowerCase()] = v;
    }

    // Extract and audit all Set-Cookie headers
    const rawCookies = typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : [headers["set-cookie"]].filter(Boolean);
    const cookies = rawCookies.map(parseCookieHeader);

    // Scan response body for inline credentials and tokens
    let html = "";
    try {
      html = await res.text();
    } catch (_) {}

    const credentialExposure = [];
    if (html) {
      const secretChecks = [
        { type: "Exposed Firebase API Key", regex: /AIza[0-9A-Za-z-_]{35}/g },
        { type: "Exposed Private Key Pattern", regex: /-----BEGIN (?:RSA )?PRIVATE KEY-----/g },
        { type: "Exposed AWS Access Key", regex: /(?:A3T[A-Z0-9]|AKIA[A-Z0-9]|AGPA[A-Z0-9]|AIDA[A-Z0-9]|AROA[A-Z0-9]|AIPA[A-Z0-9]|ANPA[A-Z0-9]|ANVA[A-Z0-9]|ASIA[A-Z0-9])[A-Z0-9]{16}/g },
        { type: "JWT Token in Markup", regex: /eyJ[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_=]{10,}\.[A-Za-z0-9-_.+/=]{10,}/g },
      ];
      for (const p of secretChecks) {
        const matches = [...html.matchAll(p.regex)];
        if (matches.length) {
          credentialExposure.push({
            type: p.type,
            count: matches.length,
            sample: matches[0][0].slice(0, 35) + "…",
          });
        }
      }
    }

    const securityHeaders = {
      strictTransportSecurity: headers["strict-transport-security"] || null,
      contentSecurityPolicy: headers["content-security-policy"] || null,
      xFrameOptions: headers["x-frame-options"] || null,
      xContentTypeOptions: headers["x-content-type-options"] || null,
      referrerPolicy: headers["referrer-policy"] || null,
      permissionsPolicy: headers["permissions-policy"] || null,
    };

    const serverInfo = {
      server: headers["server"] || null,
      xPoweredBy: headers["x-powered-by"] || null,
      xAspNetVersion: headers["x-aspnet-version"] || null,
    };

    const issues = [];
    if (!securityHeaders.strictTransportSecurity && target.startsWith("https://")) {
      issues.push("Missing Strict-Transport-Security (HSTS) header");
    }
    if (!securityHeaders.contentSecurityPolicy) {
      issues.push("Missing Content-Security-Policy (CSP) header");
    }
    if (!securityHeaders.xFrameOptions && !securityHeaders.contentSecurityPolicy?.includes("frame-ancestors")) {
      issues.push("Missing X-Frame-Options (vulnerable to Clickjacking if framing is permitted)");
    }
    if (!securityHeaders.xContentTypeOptions) {
      issues.push("Missing X-Content-Type-Options: nosniff (vulnerable to MIME-sniffing)");
    }
    if (serverInfo.server || serverInfo.xPoweredBy) {
      issues.push(`Software version disclosure in headers (${[serverInfo.server, serverInfo.xPoweredBy].filter(Boolean).join(", ")})`);
    }

    // Add cookie issues
    for (const c of cookies) {
      for (const iss of c.issues) {
        issues.push(`Cookie [${c.name}]: ${iss}`);
      }
    }

    // Add credential exposure issues
    for (const cred of credentialExposure) {
      issues.push(`Credential Disclosure: ${cred.type} found in HTML markup (${cred.count} occurrence(s))`);
    }

    return {
      targetUrl: target,
      status: res.status,
      statusText: res.statusText,
      location: headers["location"] || null,
      serverInfo,
      securityHeaders,
      cookies,
      cookieSummary: {
        total: cookies.length,
        vulnerableCount: cookies.filter((c) => c.issues.length > 0).length,
      },
      credentialExposure,
      securityScore: Math.max(0, 100 - issues.length * 15),
      detectedIssues: issues,
      rawHeaders: headers,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    clearTimeout(timer);
    throw new Error(`HTTP recon failed for ${target}: ${err.message}`);
  }
}

/**
 * Generate targeted Google / GitHub / Shodan dorks
 */
function generateDorks(targetInput, targetType = "all") {
  const target = sanitizeHost(targetInput);
  const type = String(targetType).toLowerCase();

  const dorks = {
    target,
    categories: {},
  };

  const googleAdmin = [
    `site:${target} inurl:admin | inurl:login | inurl:dashboard | inurl:portal`,
    `site:${target} intitle:"admin login" | intitle:"control panel"`,
    `site:${target} inurl:cpanel | inurl:webmail | inurl:phpmyadmin`,
  ];

  const googleFiles = [
    `site:${target} ext:env | ext:log | ext:sql | ext:bak | ext:conf | ext:yml | ext:json`,
    `site:${target} ext:doc | ext:docx | ext:pdf | ext:xls | ext:xlsx | ext:csv`,
    `site:${target} inurl:"/.git" | inurl:"/.env"`,
  ];

  const googleDirectory = [
    `site:${target} intitle:"index of /" | intitle:"parent directory"`,
    `site:${target} "Index of" /backup | /dump | /db`,
  ];

  const githubSecrets = [
    `"${target}" (api_key | apikey | secret | token | auth | password | bearer) filename:.env`,
    `"${target}" filename:credentials | filename:id_rsa | filename:config.json`,
    `"${target}" (AWS_SECRET_ACCESS_KEY | GITHUB_TOKEN | SLACK_WEBHOOK)`,
  ];

  const shodanQueries = [
    `hostname:"${target}"`,
    `ssl:"${target}"`,
    `http.title:"${target}"`,
  ];

  if (type === "all" || type === "admin") {
    dorks.categories["admin_portals"] = {
      engine: "Google",
      queries: googleAdmin.map((q) => ({ query: q, url: `https://www.google.com/search?q=${encodeURIComponent(q)}` })),
    };
  }

  if (type === "all" || type === "files") {
    dorks.categories["sensitive_files"] = {
      engine: "Google",
      queries: googleFiles.map((q) => ({ query: q, url: `https://www.google.com/search?q=${encodeURIComponent(q)}` })),
    };
  }

  if (type === "all" || type === "directory") {
    dorks.categories["directory_listings"] = {
      engine: "Google",
      queries: googleDirectory.map((q) => ({ query: q, url: `https://www.google.com/search?q=${encodeURIComponent(q)}` })),
    };
  }

  if (type === "all" || type === "secrets" || type === "github") {
    dorks.categories["github_secrets"] = {
      engine: "GitHub",
      queries: githubSecrets.map((q) => ({ query: q, url: `https://github.com/search?q=${encodeURIComponent(q)}&type=code` })),
    };
  }

  if (type === "all" || type === "shodan") {
    dorks.categories["shodan_recon"] = {
      engine: "Shodan",
      queries: shodanQueries.map((q) => ({ query: q, url: `https://www.shodan.io/search?query=${encodeURIComponent(q)}` })),
    };
  }

  return dorks;
}

const analyzer = require("./analyzer");

module.exports = {
  searchTools,
  getCategories,
  getToolById,
  dnsRecon,
  ipLookup,
  subdomainEnum,
  httpRecon,
  generateDorks,
  scanContent: analyzer.scanContent,
  scanProject: analyzer.scanProject,
  SCAN_RULES: analyzer.RULES,
};
