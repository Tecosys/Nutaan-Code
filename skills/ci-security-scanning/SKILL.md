---
name: ci-security-scanning
description: Add automated security scanning to CI/CD — GitHub Actions, GitLab CI, or any pipeline — so every pull request is checked for vulnerabilities before it merges, with the build failing on real findings and results uploaded as SARIF to code scanning. Covers diff-scoped review of changed files, secret scanning, dependency/SCA, and SAST/DAST gates. Use when the user asks to add security scanning, SAST, DAST, pentesting, vulnerability checks, or automated security review to their CI pipeline, pre-merge gate, or PR workflow.
---

# Set up security scanning in CI/CD

Gate pull requests so vulnerable code is caught before it merges. Build a layered pipeline — each layer catches a class the others structurally can't — and fail the build on real findings. Nutaan writes the workflow file and wires it to the repo; the layers below are ordered cheapest-first.

## The layers

| Layer | Catches | Common OSS tool |
|---|---|---|
| **Secret scanning** | Committed keys, tokens, passwords | `gitleaks`, `trufflehog` |
| **Dependency / SCA** | Known-CVE dependencies | `osv-scanner`, `trivy`, `npm audit`, `pip-audit` |
| **SAST (static)** | Injection, XSS, unsafe patterns in source | `semgrep` |
| **DAST / dynamic** | Exploitable bugs against a running app | `nuclei`, OWASP ZAP baseline; or the exploit-validated review below |
| **Exploit-validated review** | Logic/authz/injection bugs, proven not just flagged | Nutaan itself, or the Strix CLI if installed |

Secret + SCA + SAST are fast and belong on **every PR**. DAST and deep review are heavier — run them diff-scoped on PRs and in full on a nightly/`release` schedule.

## GitHub Actions starter

Create `.github/workflows/security.yml`:

```yaml
name: Security Scan
on:
  pull_request:

permissions:
  contents: read
  security-events: write   # for SARIF upload

jobs:
  security:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0     # required so diff-scoped steps can resolve the base

      - name: Secret scan
        uses: gitleaks/gitleaks-action@v2

      - name: Dependency scan
        uses: google/osv-scanner-action@v1
        with:
          scan-args: "-r ."

      - name: SAST (Semgrep)
        uses: semgrep/semgrep-action@v1
        with:
          config: p/ci
          generateSarif: "1"

      - name: Upload SARIF
        if: always()
        uses: github/codeql-action/upload-sarif@v3
        with:
          sarif_file: semgrep.sarif
```

Tune each action to **fail the job on findings at your chosen severity** (most support a severity threshold) — a scan that never fails the build is decoration, not a gate.

## Diff-scoped review on large repos

Reviewing the whole tree on every PR is wasteful. Scope to the PR's changed files and resolve the base branch robustly — don't hard-code `origin/main`:

```bash
# Prefer the CI's own base-branch variable; fall back to origin/HEAD.
BASE_BRANCH="${GITHUB_BASE_REF:-${CI_MERGE_REQUEST_TARGET_BRANCH_NAME:-}}"
if [ -z "$BASE_BRANCH" ]; then
  BASE_BRANCH=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null)
  BASE_BRANCH="${BASE_BRANCH#origin/}"
fi
DIFF_BASE="origin/${BASE_BRANCH:-main}"
# Fail loudly rather than silently narrowing scope to, say, HEAD~1 (which on a
# multi-commit branch would scan only the last commit and let earlier ones pass).
git rev-parse --verify --quiet "$DIFF_BASE" >/dev/null || {
  echo "Cannot resolve diff base '$DIFF_BASE' — fetch the base branch or set it explicitly." >&2; exit 1; }
CHANGED=$(git diff --name-only "$DIFF_BASE"...HEAD)
# run semgrep / your reviewer over $CHANGED
```

## Other pipelines

Any CI works the same way: install the tools, run them headless, and gate on the exit code. Schedule `standard` scans nightly and a full dynamic/exploit-validated pass for release candidates.

## Don't fail open

A passing scan means "nothing found **in what was scanned**", not "secure". Make sure each step actually fails on findings, that diff resolution didn't silently fall back to an empty diff, and that heavy dynamic passes are given enough time/budget to finish. A green check on a scan that never ran, or ran on zero files, is worse than no gate — it manufactures false confidence. Findings that make it through still get remediated with `fix-security-vulnerabilities`.
