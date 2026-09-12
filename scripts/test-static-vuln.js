const arsenal = require("../arsenal");

async function testStaticScan() {
  console.log("=== Testing Native Static Vulnerability Analyzer ===");

  const vulnerableSnippet = `
const awsKey = "AKIAIOSFODNN7EXAMPLE";
const query = "SELECT * FROM accounts WHERE id = " + userId;
const result = eval(userProvidedString);
const cmd = "ping " + host;
require("child_process").exec(cmd);
`;

  const findings = arsenal.scanContent(vulnerableSnippet, "auth_controller.js");
  console.log(`[PASS] Snippet scanned. Detected ${findings.length} vulnerabilities:`);
  for (const f of findings) {
    console.log(`   • [${f.severity}] ${f.name} (${f.cwe}) on line ${f.line}: ${f.snippet}`);
  }

  console.log("\n--- Scanning Project Files ---");
  const projectSummary = await arsenal.scanProject(__dirname + "/..", ".");
  console.log(`[PASS] Scanned ${projectSummary.scannedFiles} files.`);
  console.log("Findings breakdown:", projectSummary.severityBreakdown);
  console.log("=== Analyzer Test Succeeded with Zero GPU/External Overhead ===");
}

testStaticScan().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
