// Visual-test stub: satisfies window.nutaan so the renderer boots without the real main process.
(() => {
  const ok = (v) => Promise.resolve(v);
  const SAMPLE_FOUND = [
    {
      id: "claude-code",
      name: "Claude Code",
      detail: "2 MCP servers found",
      mcp: [
        { name: "github", transport: "stdio", command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "***" } },
        { name: "docs", transport: "http", url: "https://mcp.example.com/sse", headers: {} },
      ],
      instructions: { file: "CLAUDE.md", text: "Always answer in the user's language. Prefer small, reviewed edits over large rewrites." },
    },
    {
      id: "codex",
      name: "Codex",
      detail: "1 MCP server found",
      mcp: [{ name: "playwright", transport: "stdio", command: "npx", args: ["-y", "@playwright/mcp"], env: {} }],
      instructions: { file: "AGENTS.md", text: "Keep commits atomic. Run tests before declaring done." },
    },
    {
      id: "antigravity",
      name: "Antigravity / Gemini",
      detail: "0 MCP servers found",
      mcp: [],
      instructions: { file: "GEMINI.md", text: "Use concise explanations with code samples." },
    },
  ];
  window.nutaan = new Proxy(
    {},
    {
      get(_t, k) {
        if (k === "getSettings") return () => ok({ nutaanKey: "nut-test", nutaanEmail: "tester@nutaan.dev", onboarded: true, uiMode: "coding", role: "software", roleLabel: "Software / Data / AI" });
        if (k === "validateNutaanKey") return () => ok({ ok: true, email: "tester@nutaan.dev" });
        if (k === "getVersion") return () => ok("0.1.58-test");
        if (k === "import") return { detect: () => ok({ found: SAMPLE_FOUND }), apply: (p) => ok({ ok: true, added: (p.mcp || []).length }) };
        return (..._a) => ok([]);
      },
    }
  );
})();
