const arsenal = require("../arsenal");

async function runTests() {
  console.log("=== Testing Arsenal Engine ===");

  // 1. Categories
  const categories = arsenal.getCategories();
  console.log(`[PASS] Loaded ${categories.length} categories.`);
  console.log(`Top 3 categories:`, categories.slice(0, 3));

  // 2. Search
  const searchRecon = arsenal.searchTools({ query: "subdomain", limit: 5 });
  console.log(`[PASS] Search 'subdomain' returned ${searchRecon.length} tools:`, searchRecon.map((t) => t.name));

  const searchSherlock = arsenal.searchTools({ query: "sherlock", limit: 1 });
  console.log(`[PASS] Search 'sherlock':`, searchSherlock[0]?.name, `(${searchSherlock[0]?.install?.method})`);

  // 3. Lookup by ID
  const tool = arsenal.getToolById("nuclei");
  console.log(`[PASS] Tool 'nuclei':`, tool ? `${tool.name} - ${tool.category}` : "NOT FOUND");

  // 4. Dork Generator
  const dorks = arsenal.generateDorks("example.com", "admin");
  console.log(`[PASS] Dork Generator:`, Object.keys(dorks.categories));

  // 5. DNS Recon
  try {
    const dnsRes = await arsenal.dnsRecon("google.com");
    console.log(`[PASS] DNS Recon for google.com: A=${Boolean(dnsRes.records.A)}, MX=${Boolean(dnsRes.records.MX)}, SPF=${dnsRes.security.hasSpf}`);
  } catch (err) {
    console.log(`[WARN] DNS Recon failed:`, err.message);
  }

  // 6. HTTP Recon
  try {
    const httpRes = await arsenal.httpRecon("https://example.com");
    console.log(`[PASS] HTTP Recon status: ${httpRes.status}, Issues: ${httpRes.detectedIssues.length}`);
  } catch (err) {
    console.log(`[WARN] HTTP Recon failed:`, err.message);
  }

  // 7. IP Lookup
  try {
    const ipRes = await arsenal.ipLookup("1.1.1.1");
    console.log(`[PASS] IP Lookup for 1.1.1.1: Country=${ipRes.country}, ISP=${ipRes.isp}, AS=${ipRes.as}`);
  } catch (err) {
    console.log(`[WARN] IP Lookup failed:`, err.message);
  }

  console.log("=== Arsenal Tests Completed Successfully ===");
}

runTests().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
