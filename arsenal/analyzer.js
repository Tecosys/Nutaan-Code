const fs = require("node:fs/promises");
const path = require("node:path");

/**
 * High-performance, zero-GPU, zero-dependency Static Vulnerability Analysis Engine.
 * Runs instantly on any device (Windows, Linux, macOS) directly in Node.js.
 */

// Canonical vulnerability rule definitions mapped to CWE categories
const RULES = [
  // 1. Secrets & Credentials (CWE-798)
  {
    id: "SEC-SECRET-AWS",
    cwe: "CWE-798",
    name: "Hardcoded AWS Access Key",
    severity: "HIGH",
    pattern: /(?:A3T[A-Z0-9]|AKIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}/g,
    description: "Hardcoded AWS Access Key ID detected.",
    remediation: "Move access keys to secure environment variables or secret managers (e.g. AWS Secrets Manager, Vault).",
    languages: ["all"],
  },
  {
    id: "SEC-SECRET-GENERIC",
    cwe: "CWE-798",
    name: "Hardcoded Private Key / Secret Token",
    severity: "HIGH",
    pattern: /(?:-----BEGIN (?:RSA|OPENSSH|EC|PGP) PRIVATE KEY-----|ghp_[a-zA-Z0-9]{36}|github_pat_[a-zA-Z0-9_]{82}|sk-[a-zA-Z0-9]{32,}|xox[baprs]-[0-9a-zA-Z]{10,48})/g,
    description: "Private cryptographic key or API token committed directly in code.",
    remediation: "Revoke and rotate the exposed token immediately. Store secrets outside of version control.",
    languages: ["all"],
  },
  {
    id: "SEC-SECRET-ASSIGN",
    cwe: "CWE-798",
    name: "Hardcoded Password / Secret Assignment",
    severity: "MEDIUM",
    pattern: /(?:password|passwd|secret|api_key|apikey|auth_token)\s*[:=]\s*["'][a-zA-Z0-9!@#$%^&*()_+=-]{8,}["']/gi,
    description: "Potential hardcoded plaintext secret assignment.",
    remediation: "Read passwords and tokens from process.env or configuration files that are gitignored.",
    languages: ["all"],
  },

  // 2. Command Injection (CWE-78)
  {
    id: "SEC-CMD-INJECT-JS",
    cwe: "CWE-78",
    name: "Command Injection via Child Process",
    severity: "CRITICAL",
    pattern: /(?:exec|execSync)\s*\(\s*`[^`]*\${[^}]+}[^`]*`|(?:exec|execSync)\s*\(\s*["'][^"']*["']\s*\+\s*[a-zA-Z0-9_.]+/g,
    description: "Untrusted string interpolation directly passed to shell execution function.",
    remediation: "Use child_process.spawn or execFile with parameterized array arguments rather than shell string concatenation.",
    languages: ["js", "ts"],
  },
  {
    id: "SEC-CMD-INJECT-PY",
    cwe: "CWE-78",
    name: "Command Injection via os.system / subprocess",
    severity: "CRITICAL",
    pattern: /(?:os\.system|os\.popen|subprocess\.Popen|subprocess\.call|subprocess\.run)\s*\(\s*(?:f["'][^"']*{[^}]+}[^"']*["']|["'][^"']*["']\s*\+\s*[a-zA-Z0-9_]+|.*shell\s*=\s*True)/g,
    description: "Shell execution with unparameterized command formatting or shell=True.",
    remediation: "Pass arguments as a list with shell=False (default), and sanitize user input.",
    languages: ["py"],
  },

  // 3. SQL Injection (CWE-89)
  {
    id: "SEC-SQLI-JS",
    cwe: "CWE-89",
    name: "SQL Injection via String Concatenation",
    severity: "HIGH",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE|FROM|WHERE)\s+[^;]*\s*(?:\+\s*[a-zA-Z0-9_.]+|\$\{[^}]+\})/gi,
    description: "Raw SQL query string constructed via direct string concatenation or template literal.",
    remediation: "Use parameterized queries / prepared statements (e.g. $1, ?, or ORM query builders).",
    languages: ["js", "ts", "py", "php", "java"],
  },

  // 4. Code Execution & Unsafe Deserialization (CWE-94 / CWE-502)
  {
    id: "SEC-EVAL-JS",
    cwe: "CWE-94",
    name: "Unsafe Dynamic Code Evaluation (eval / Function)",
    severity: "CRITICAL",
    pattern: /\b(?:eval|Function)\s*\(\s*(?!["'][^"']*["']\s*\))[^)]+\)/g,
    description: "Dynamic string evaluation allows arbitrary code execution if input is attacker-influenced.",
    remediation: "Avoid eval and Function constructor entirely. Use JSON.parse for structured data.",
    languages: ["js", "ts"],
  },
  {
    id: "SEC-DESERIALIZE-PY",
    cwe: "CWE-502",
    name: "Insecure Deserialization (pickle / yaml)",
    severity: "HIGH",
    pattern: /\b(?:pickle\.loads?|_pickle\.loads?|yaml\.load\s*\([^,)]+\))/g,
    description: "Deserializing untrusted data with pickle or unsafe yaml.load can lead to arbitrary code execution.",
    remediation: "Use yaml.safe_load() or JSON for data interchange instead of pickle.",
    languages: ["py"],
  },

  // 5. Path Traversal (CWE-22)
  {
    id: "SEC-PATH-TRAVERSAL",
    cwe: "CWE-22",
    name: "Potential Path Traversal",
    severity: "MEDIUM",
    pattern: /(?:readFile|readFileSync|createReadStream|unlink|unlinkSync|open)\s*\(\s*(?:path\.join\s*\([^)]*(?:req\.|params|query|body)|["'][^"']*["']\s*\+\s*(?:req\.|params|query))/g,
    description: "File system access with path composed directly from user request parameters without normalization verification.",
    remediation: "Verify that path.resolve(basePath, userInput) begins with basePath + path.sep before operating on it.",
    languages: ["js", "ts"],
  },

  // 6. Broken Cryptography & Insecure Hashes (CWE-327 / CWE-328)
  {
    id: "SEC-WEAK-CRYPTO",
    cwe: "CWE-328",
    name: "Weak Hashing Algorithm (MD5 / SHA1)",
    severity: "LOW",
    pattern: /(?:createHash\s*\(\s*["'](?:md5|sha1)["']|hashlib\.(?:md5|sha1)\s*\()/gi,
    description: "MD5 and SHA-1 have known collision weaknesses and should not be used for passwords or digital signatures.",
    remediation: "Use SHA-256 / SHA-512 for integrity hashes, and bcrypt / argon2 for password hashing.",
    languages: ["js", "ts", "py"],
  },

  // 7. Insecure Network & TLS Configuration (CWE-295 / CWE-942)
  {
    id: "SEC-TLS-DISABLE",
    cwe: "CWE-295",
    name: "Disabled TLS Certificate Validation",
    severity: "HIGH",
    pattern: /(?:rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*['"]0['"])/g,
    description: "Certificate validation explicitly disabled, making connections vulnerable to Man-In-The-Middle (MITM) attacks.",
    remediation: "Enable certificate validation (`rejectUnauthorized: true`). Use valid certificates or local truststores in testing.",
    languages: ["js", "ts", "py"],
  },
  {
    id: "SEC-CORS-PERMISSIVE",
    cwe: "CWE-942",
    name: "Overly Permissive CORS Origin",
    severity: "MEDIUM",
    pattern: /(?:Access-Control-Allow-Origin\s*['"]\s*,\s*['"]\*['"]|cors\s*\(\s*{\s*origin\s*:\s*["']\*["']\s*,\s*credentials\s*:\s*true)/gi,
    description: "Wildcard CORS origin configured with credentials or on authenticated endpoints.",
    remediation: "Explicitly specify trusted origins or validate the Origin request header against an allowlist.",
    languages: ["js", "ts", "py"],
  },
];

const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  "coverage",
  "vendor",
  ".venv",
  "env",
]);

function getLanguage(filePath) {
  const ext = path.extname(filePath).slice(1).toLowerCase();
  if (["js", "jsx", "mjs", "cjs"].includes(ext)) return "js";
  if (["ts", "tsx"].includes(ext)) return "ts";
  if (["py", "pyw"].includes(ext)) return "py";
  if (["php"].includes(ext)) return "php";
  if (["java"].includes(ext)) return "java";
  return ext;
}

/**
 * Scan a single string content for vulnerabilities
 */
function scanContent(content, filePath = "snippet") {
  const lang = getLanguage(filePath);
  const findings = [];
  const lines = content.split("\n");

  for (const rule of RULES) {
    if (!rule.languages.includes("all") && !rule.languages.includes(lang)) {
      continue;
    }

    // Reset regex state
    rule.pattern.lastIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      // Skip commented lines in quick check
      const trimmed = line.trim();
      if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*")) {
        continue;
      }

      rule.pattern.lastIndex = 0;
      const match = rule.pattern.exec(line);
      if (match) {
        findings.push({
          ruleId: rule.id,
          cwe: rule.cwe,
          name: rule.name,
          severity: rule.severity,
          file: filePath,
          line: i + 1,
          snippet: line.trim().slice(0, 140),
          description: rule.description,
          remediation: rule.remediation,
        });
      }
    }
  }

  return findings;
}

/**
 * Recursively scan a project directory or single file
 */
async function scanProject(rootPath, targetRel = ".", maxFiles = 2500) {
  const startPath = path.resolve(rootPath, targetRel);
  const findings = [];
  let scannedFiles = 0;

  async function walk(dir) {
    if (scannedFiles >= maxFiles) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (scannedFiles >= maxFiles) break;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (!IGNORE_DIRS.has(entry.name) && !entry.name.startsWith(".")) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        // Check code / config extensions
        if (["js", "jsx", "ts", "tsx", "py", "php", "java", "json", "env", "yml", "yaml"].includes(ext)) {
          scannedFiles++;
          try {
            const stat = await fs.stat(fullPath);
            if (stat.size <= 500_000) { // Max 500KB per file
              const content = await fs.readFile(fullPath, "utf8");
              const relPath = path.relative(rootPath, fullPath).replace(/\\/g, "/");
              const fileFindings = scanContent(content, relPath);
              findings.push(...fileFindings);
            }
          } catch {}
        }
      }
    }
  }

  const stat = await fs.stat(startPath).catch(() => null);
  if (stat && stat.isFile()) {
    scannedFiles = 1;
    const content = await fs.readFile(startPath, "utf8");
    const relPath = path.relative(rootPath, startPath).replace(/\\/g, "/");
    findings.push(...scanContent(content, relPath));
  } else if (stat && stat.isDirectory()) {
    await walk(startPath);
  }

  // Summary breakdown
  const summary = {
    totalFindings: findings.length,
    scannedFiles,
    severityBreakdown: {
      CRITICAL: findings.filter((f) => f.severity === "CRITICAL").length,
      HIGH: findings.filter((f) => f.severity === "HIGH").length,
      MEDIUM: findings.filter((f) => f.severity === "MEDIUM").length,
      LOW: findings.filter((f) => f.severity === "LOW").length,
    },
    findings: findings.slice(0, 100),
    truncated: findings.length > 100,
    timestamp: new Date().toISOString(),
  };

  return summary;
}

module.exports = {
  RULES,
  scanContent,
  scanProject,
};
