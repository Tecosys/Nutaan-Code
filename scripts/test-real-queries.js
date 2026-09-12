const arsenal = require("../arsenal");

async function testRealQueries() {
  console.log("=================================================");
  console.log("🔥 TESTING REAL OSINT & ARSENAL QUERIES IN NUTAAN");
  console.log("=================================================\n");

  // Query 1: Domain & Mail Protection Recon
  console.log("👉 REAL QUERY 1: 'Perform DNS and mail spoofing recon on github.com'");
  const dnsResult = await arsenal.dnsRecon("github.com");
  console.log("   [Result] A Records:", dnsResult.records.A);
  console.log("   [Result] MX Records:", dnsResult.records.MX?.map((m) => m.exchange));
  console.log("   [Result] SPF Protection:", dnsResult.security.hasSpf ? "✅ Active" : "❌ Inactive");
  console.log("   [Result] DMARC Protection:", dnsResult.security.hasDmarc ? "✅ Active" : "❌ Inactive");
  console.log();

  // Query 2: IP Geolocation and Network Intelligence
  console.log("👉 REAL QUERY 2: 'Lookup IP intelligence for 140.82.121.4 (GitHub)'");
  const ipResult = await arsenal.ipLookup("140.82.121.4");
  console.log("   [Result] IP:", ipResult.ip);
  console.log("   [Result] Location:", `${ipResult.city}, ${ipResult.region}, ${ipResult.country}`);
  console.log("   [Result] Organization / ISP:", `${ipResult.org} / ${ipResult.isp}`);
  console.log("   [Result] Autonomous System (AS):", ipResult.as);
  console.log();

  // Query 3: Subdomain Enumeration
  console.log("👉 REAL QUERY 3: 'Find subdomains for hackerone.com via Certificate Transparency'");
  const subResult = await arsenal.subdomainEnum("hackerone.com");
  console.log(`   [Result] Discovered ${subResult.count} subdomains. Sample (first 5):`);
  console.log("  ", subResult.subdomains.slice(0, 5).join(", "));
  console.log();

  // Query 4: HTTP Security Audit
  console.log("👉 REAL QUERY 4: 'Audit HTTP security headers on https://example.com'");
  const httpResult = await arsenal.httpRecon("https://example.com");
  console.log("   [Result] Status:", httpResult.status);
  console.log("   [Result] Security Score:", `${httpResult.securityScore} / 100`);
  console.log("   [Result] Issues Found:", httpResult.detectedIssues);
  console.log();

  // Query 5: Arsenal Tool Search for Usernames
  console.log("👉 REAL QUERY 5: 'Find tools in our arsenal for tracking usernames on social media'");
  const userTools = arsenal.searchTools({ query: "username", category: "username-social", limit: 5 });
  console.log(`   [Result] Found ${userTools.length} matching tools:`);
  for (const t of userTools) {
    console.log(`   • ${t.name} (${t.install?.method}): ${t.description}`);
  }
  console.log();

  // Query 6: Arsenal Tool Search for Vulnerability Scanners
  console.log("👉 REAL QUERY 6: 'Find web vulnerability scanners and SQL injection tools'");
  const vulnTools = arsenal.searchTools({ query: "sqlmap", limit: 3 });
  console.log(`   [Result] Found tool: ${vulnTools[0]?.name} - ${vulnTools[0]?.description}`);
  console.log(`   [Result] Install/Run: ${vulnTools[0]?.install?.raw}`);
  console.log();

  console.log("=================================================");
  console.log("✅ ALL REAL QUERIES EXECUTED SUCCESSFULLY!");
  console.log("=================================================");
}

testRealQueries().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
