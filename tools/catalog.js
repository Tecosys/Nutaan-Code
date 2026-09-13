// The tools a user can switch on, and what each one needs to work.
//
// Four kinds, because these services genuinely connect in four different ways and pretending
// otherwise is how integrations end up half-working:
//
//   mcp      a Model Context Protocol server — its tools become the agent's tools
//   cli      another coding agent on this machine, handed a task and asked to report back
//   app      a desktop application, opened on something
//   session  a web app with no usable API, driven in its own signed-in window
//
// `fields` are what the user fills in; `oauthFields` are the API route for the services that have
// one, left for later so a session tool can be upgraded in place without changing anything else.

const KINDS = { MCP: "mcp", CLI: "cli", APP: "app", SESSION: "session" };

const CATALOG = [
  {
    id: "nutaan",
    name: "Nutaan AI",
    kind: KINDS.MCP,
    transport: "http",
    blurb: "Voice agents, phone calls, leads and knowledge bases on your Nutaan account.",
    icon: "nutaan.png",
    accent: "#863bff",
    url: "https://nutaan.com/api/mcp",
    // Already signed in: the account key the app uses for models works here too, so this one
    // needs no setup at all.
    auth: "nutaan-key",
    docs: "https://nutaan.com",
    fields: [
      { key: "url", label: "Server URL", type: "text", placeholder: "https://nutaan.com/api/mcp", advanced: true },
      { key: "token", label: "API key override", type: "password", hint: "Leave empty to use the nutaan.com key from Settings.", advanced: true },
    ],
  },
  {
    id: "canva",
    name: "Canva",
    kind: KINDS.MCP,
    transport: "http",
    blurb: "Find, read and edit your Canva designs, brand templates and assets.",
    icon: "canva.ico",
    accent: "#00c4cc",
    url: "https://mcp.canva.com/mcp",
    auth: "oauth",
    docs: "https://www.canva.dev/docs/apps/mcp-server/",
    fields: [
      { key: "url", label: "Server URL", type: "text", placeholder: "https://mcp.canva.com/mcp", advanced: true },
    ],
  },
  {
    id: "claude-code",
    name: "Claude Code",
    kind: KINDS.CLI,
    blurb: "Hand a coding task to Claude Code and get its answer back, without leaving Nutaan Code.",
    icon: "claude.svg",
    accent: "#d97757",
    command: "claude",
    // {prompt} is substituted with the task. --print makes it answer and exit instead of opening
    // its own interactive session.
    args: ["--print", "{prompt}"],
    probe: ["--version"],
    docs: "https://docs.claude.com/en/docs/claude-code",
    fields: [
      { key: "command", label: "Command", type: "text", placeholder: "claude", hint: "Full path if it is not on your PATH." },
      { key: "model", label: "Model", type: "select", hint: "Uses your signed-in Claude Code plan.", options: [
        { value: "", label: "Account default (recommended)" },
        { value: "sonnet", label: "Sonnet — fast, balanced" },
        { value: "opus", label: "Opus — most capable" },
        { value: "haiku", label: "Haiku — quickest" },
      ] },
      { key: "cwd", label: "Run in folder", type: "text", placeholder: "leave empty to use the open project" },
      { key: "timeoutSec", label: "Timeout (seconds)", type: "number", placeholder: "600" },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    kind: KINDS.CLI,
    blurb: "Hand a coding task to OpenAI Codex and get its answer back.",
    icon: "codex.svg",
    accent: "#10a37f",
    command: "codex",
    args: ["exec", "{prompt}"],
    probe: ["--version"],
    docs: "https://developers.openai.com/codex/cli/",
    fields: [
      { key: "command", label: "Command", type: "text", placeholder: "codex", hint: "Full path if it is not on your PATH." },
      { key: "model", label: "Model", type: "select", hint: "Codex only allows the models your OpenAI/ChatGPT plan includes. If one is refused, pick another.", options: [
        { value: "", label: "Account default" },
        { value: "gpt-5.1-codex", label: "gpt-5.1-codex" },
        { value: "gpt-5-codex", label: "gpt-5-codex" },
        { value: "o4-mini", label: "o4-mini" },
        { value: "o3", label: "o3" },
      ] },
      { key: "cwd", label: "Run in folder", type: "text", placeholder: "leave empty to use the open project" },
      { key: "timeoutSec", label: "Timeout (seconds)", type: "number", placeholder: "600" },
    ],
  },
  {
    id: "antigravity",
    name: "Antigravity",
    kind: KINDS.APP,
    blurb: "Open the current project, a folder or a file in Antigravity.",
    icon: "antigravity.png",
    accent: "#4285f4",
    // No CLI ships with it, so this is a launch rather than a delegation — said plainly here
    // rather than pretending a prompt can be handed over.
    win32: ["%LOCALAPPDATA%\\Programs\\Antigravity\\Antigravity.exe"],
    darwin: ["/Applications/Antigravity.app"],
    linux: ["/usr/share/antigravity/antigravity", "/opt/Antigravity/antigravity"],
    docs: "https://antigravity.google/",
    fields: [
      { key: "path", label: "Application path", type: "text", placeholder: "detected automatically", hint: "Only needed if it is installed somewhere unusual." },
    ],
  },
  {
    id: "gmail",
    name: "Gmail",
    kind: KINDS.SESSION,
    blurb: "Read, search and draft mail in your own signed-in Gmail.",
    icon: "gmail.png",
    accent: "#ea4335",
    home: "https://mail.google.com/mail/u/0/#inbox",
    compose: "https://mail.google.com/mail/u/0/#inbox?compose=new",
    docs: "https://developers.google.com/workspace/gmail/api",
    oauthNote: "Google has an API for this. Fill these in to switch Gmail from the signed-in window to the API.",
    oauthFields: [
      { key: "clientId", label: "Google OAuth client ID", type: "text", placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "Client secret", type: "password" },
    ],
  },
  {
    id: "outlook",
    name: "Outlook",
    kind: KINDS.SESSION,
    blurb: "Read, search and draft mail in your own signed-in Outlook.",
    icon: "outlook.ico",
    accent: "#0078d4",
    home: "https://outlook.live.com/mail/0/",
    docs: "https://learn.microsoft.com/en-us/graph/api/resources/mail-api-overview",
    oauthNote: "Microsoft Graph can do this over an API. Fill these in to switch Outlook from the signed-in window to Graph.",
    fields: [
      { key: "home", label: "Which Outlook", type: "select", options: [
        { value: "https://outlook.live.com/mail/0/", label: "Personal (outlook.com)" },
        { value: "https://outlook.office.com/mail/", label: "Work or school (Microsoft 365)" },
      ] },
    ],
    oauthFields: [
      { key: "clientId", label: "Azure application (client) ID", type: "text" },
      { key: "tenantId", label: "Directory (tenant) ID", type: "text", placeholder: "common" },
      { key: "clientSecret", label: "Client secret", type: "password" },
    ],
  },
  {
    id: "google-docs",
    name: "Google Docs",
    kind: KINDS.SESSION,
    blurb: "Open, read and write your Google Docs.",
    icon: "gdocs.png",
    accent: "#1a73e8",
    home: "https://docs.google.com/document/u/0/",
    docs: "https://developers.google.com/workspace/docs/api",
    oauthNote: "Fill these in to use the Google Docs API instead of the signed-in window.",
    oauthFields: [
      { key: "clientId", label: "Google OAuth client ID", type: "text", placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "Client secret", type: "password" },
    ],
  },
  {
    id: "google-sheets",
    name: "Google Sheets",
    kind: KINDS.SESSION,
    blurb: "Open, read and edit your spreadsheets.",
    icon: "gsheets.png",
    accent: "#0f9d58",
    home: "https://docs.google.com/spreadsheets/u/0/",
    docs: "https://developers.google.com/workspace/sheets/api",
    oauthNote: "Fill these in to use the Google Sheets API instead of the signed-in window.",
    oauthFields: [
      { key: "clientId", label: "Google OAuth client ID", type: "text", placeholder: "…apps.googleusercontent.com" },
      { key: "clientSecret", label: "Client secret", type: "password" },
    ],
  },
  {
    id: "notebooklm",
    name: "NotebookLM",
    kind: KINDS.SESSION,
    blurb: "Work with your NotebookLM notebooks and sources.",
    icon: "notebooklm.svg",
    accent: "#4285f4",
    home: "https://notebooklm.google.com/",
    // Stated on the card, because it is the one tool here that can never become an API tool.
    noApi: "NotebookLM has no public API, so the signed-in window is the only way to reach it.",
  },
];

const CUSTOM_TEMPLATE = {
  id: "custom",
  name: "Custom MCP server",
  kind: KINDS.MCP,
  blurb: "Any other MCP server — hosted over HTTP, or a command that runs on this machine.",
  icon: "custom.svg",
  accent: "#8b93a7",
  fields: [
    { key: "label", label: "Name", type: "text", placeholder: "My server" },
    { key: "transport", label: "Connection", type: "select", options: [
      { value: "http", label: "Hosted (URL)" },
      { value: "stdio", label: "Local (command)" },
    ] },
    { key: "url", label: "Server URL", type: "text", placeholder: "https://example.com/mcp", when: { transport: "http" } },
    { key: "headers", label: "Headers", type: "keyvalue", hint: "e.g. Authorization: Bearer …", when: { transport: "http" } },
    { key: "command", label: "Command", type: "text", placeholder: "npx", when: { transport: "stdio" } },
    { key: "args", label: "Arguments", type: "list", placeholder: "-y my-mcp-server", when: { transport: "stdio" } },
    { key: "env", label: "Environment", type: "keyvalue", hint: "e.g. API_KEY: …", when: { transport: "stdio" } },
  ],
};

function byId(id) {
  return CATALOG.find((t) => t.id === id) || null;
}

// Session tools all share one shape of agent-facing verb, so the catalog states the home page and
// the registry does the rest.
function sessionTools() {
  return CATALOG.filter((t) => t.kind === KINDS.SESSION);
}

module.exports = { CATALOG, CUSTOM_TEMPLATE, KINDS, byId, sessionTools };
