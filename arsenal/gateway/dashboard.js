/**
 * Nutaan OmniRoute Engine — Local Web Dashboard
 *
 * Served at http://127.0.0.1:20128/
 * 100% Nutaan Branded, local-first UI for key management, 1.6B free token pool,
 * model testing, and MITM interception status.
 */
"use strict";

function getDashboardHtml(state = {}) {
  const { port = 20128, activeModelsCount = 1200, stats = {} } = state;

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Nutaan OmniRoute — Universal AI Gateway</title>
  <style>
    :root {
      --bg: #0b0f17;
      --card-bg: #111726;
      --card-border: #1e293b;
      --accent: #3b82f6;
      --accent-glow: rgba(59, 130, 246, 0.25);
      --green: #10b981;
      --orange: #f59e0b;
      --text: #f1f5f9;
      --text-muted: #94a3b8;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
    body { background: var(--bg); color: var(--text); padding: 24px; }
    .container { max-width: 1100px; margin: 0 auto; }
    .header { display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid var(--card-border); padding-bottom: 16px; margin-bottom: 24px; }
    .logo { display: flex; align-items: center; gap: 12px; }
    .badge-hub { background: linear-gradient(135deg, #2563eb, #7c3aed); padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 16px; margin-bottom: 24px; }
    .card { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 18px; }
    .card h3 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.5px; color: var(--text-muted); margin-bottom: 8px; }
    .card .val { font-size: 24px; font-weight: 700; color: #fff; }
    .status-dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: var(--green); margin-right: 6px; box-shadow: 0 0 8px var(--green); }
    
    .panel { background: var(--card-bg); border: 1px solid var(--card-border); border-radius: 12px; padding: 20px; margin-bottom: 24px; }
    .panel-title { font-size: 16px; font-weight: 600; margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; }
    
    .code-box { background: #06090e; border: 1px solid var(--card-border); border-radius: 8px; padding: 12px 16px; font-family: monospace; font-size: 13px; color: #38bdf8; display: flex; justify-content: space-between; align-items: center; margin-top: 8px; }
    .btn { background: var(--accent); color: white; border: none; border-radius: 6px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer; transition: 0.15s ease; }
    .btn:hover { opacity: 0.9; }
    .btn-secondary { background: #1e293b; color: var(--text); border: 1px solid var(--card-border); }
    
    .keys-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); gap: 12px; }
    .key-row { display: flex; flex-direction: column; gap: 6px; background: #0d121f; border: 1px solid var(--card-border); padding: 12px; border-radius: 8px; }
    .key-row label { font-size: 13px; font-weight: 500; display: flex; justify-content: space-between; }
    .key-row input { background: #06090e; border: 1px solid var(--card-border); border-radius: 6px; padding: 8px 10px; color: #fff; font-size: 13px; font-family: monospace; outline: none; }
    .key-row input:focus { border-color: var(--accent); }
    .free-pill { background: rgba(16, 185, 129, 0.15); color: #34d399; font-size: 11px; padding: 2px 6px; border-radius: 4px; font-weight: 600; }
    
    .logs-table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 10px; }
    .logs-table th { text-align: left; padding: 8px; color: var(--text-muted); border-bottom: 1px solid var(--card-border); }
    .logs-table td { padding: 8px; border-bottom: 1px solid rgba(255,255,255,0.05); }
    .badge-ok { color: var(--green); }
    .badge-fb { color: var(--orange); }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="logo">
        <span class="status-dot"></span>
        <h2>Nutaan OmniRoute</h2>
        <span class="badge-hub">Universal AI Gateway</span>
      </div>
      <div>
        <span style="font-size: 13px; color: var(--text-muted); margin-right: 12px;">Port: <b>${port}</b></span>
        <button class="btn" onclick="saveAllKeys()">Save & Sync All Keys</button>
      </div>
    </div>

    <!-- Quick Stats Grid -->
    <div class="grid">
      <div class="card">
        <h3>Local Endpoint</h3>
        <div class="val" style="font-size: 18px; color: #38bdf8;">http://127.0.0.1:${port}/v1</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">OpenAI & Anthropic Compatible</p>
      </div>
      <div class="card">
        <h3>Available Models</h3>
        <div class="val">${activeModelsCount}+ Models</div>
        <p style="font-size: 12px; color: #10b981; margin-top: 6px;">1.6 Billion Free Tokens Pool Active</p>
      </div>
      <div class="card">
        <h3>MITM Interception</h3>
        <div class="val" style="font-size: 18px; color: #a78bfa;">Antigravity &amp; Kiro</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">Internally routed to Nutaan</p>
      </div>
      <div class="card">
        <h3>Total Requests</h3>
        <div class="val" id="reqCount">${stats.totalRequests || 0}</div>
        <p style="font-size: 12px; color: var(--text-muted); margin-top: 6px;">Fallbacks: <span id="fbCount">${stats.fallbacksTriggered || 0}</span></p>
      </div>
    </div>

    <!-- Quick Connect Box -->
    <div class="panel">
      <div class="panel-title">
        <span>Connect Any Client (Cursor, Windsurf, Claude Code, VS Code)</span>
        <span class="free-pill">Zero Config Required</span>
      </div>
      <p style="font-size: 13px; color: var(--text-muted);">
        Point your tools to this local Nutaan gateway. All requests get automatically routed, load-balanced, and protected with zero downtime fallbacks.
      </p>
      <div class="code-box">
        <span>Base URL: <b>http://127.0.0.1:${port}/v1</b> &nbsp;|&nbsp; API Key: <b>nutaan-local-omniroute</b></span>
        <button class="btn btn-secondary" onclick="navigator.clipboard.writeText('http://127.0.0.1:${port}/v1'); alert('Copied endpoint to clipboard!');">Copy URL</button>
      </div>
    </div>

    <!-- Provider Keys Configuration -->
    <div class="panel">
      <div class="panel-title">
        <span>Provider API Keys (Stored Privately on Your Machine)</span>
        <span class="free-pill">1.6B Free Tokens Aggregator</span>
      </div>
      <div class="keys-grid">
        <div class="key-row">
          <label><span>Groq API Key</span> <span class="free-pill">Free Tier Active</span></label>
          <input type="password" id="key_groq" placeholder="gsk_..." value="${state.keys?.groq || ""}" />
        </div>
        <div class="key-row">
          <label><span>Cerebras API Key</span> <span class="free-pill">2000 tps Free</span></label>
          <input type="password" id="key_cerebras" placeholder="csk-..." value="${state.keys?.cerebras || ""}" />
        </div>
        <div class="key-row">
          <label><span>SambaNova API Key</span> <span class="free-pill">DeepSeek-R1 Free</span></label>
          <input type="password" id="key_sambanova" placeholder="..." value="${state.keys?.sambanova || ""}" />
        </div>
        <div class="key-row">
          <label><span>Google Gemini Key</span> <span class="free-pill">1M TPM Free</span></label>
          <input type="password" id="key_gemini" placeholder="AIzaSy..." value="${state.keys?.gemini || ""}" />
        </div>
        <div class="key-row">
          <label><span>OpenRouter API Key</span> <span class="free-pill">40+ Free Models</span></label>
          <input type="password" id="key_openrouter" placeholder="sk-or-v1-..." value="${state.keys?.openrouter || ""}" />
        </div>
        <div class="key-row">
          <label><span>DeepSeek Official Key</span> <span>Direct API</span></label>
          <input type="password" id="key_deepseek" placeholder="sk-..." value="${state.keys?.deepseek || ""}" />
        </div>
        <div class="key-row">
          <label><span>Anthropic Claude Key</span> <span>Direct API</span></label>
          <input type="password" id="key_anthropic" placeholder="sk-ant-..." value="${state.keys?.anthropic || ""}" />
        </div>
        <div class="key-row">
          <label><span>OpenAI API Key</span> <span>Direct API</span></label>
          <input type="password" id="key_openai" placeholder="sk-proj-..." value="${state.keys?.openai || ""}" />
        </div>
      </div>
    </div>

    <!-- Live Inspector & Logs -->
    <div class="panel">
      <div class="panel-title">
        <span>Live Request &amp; Interception Inspector</span>
        <button class="btn btn-secondary" onclick="refreshLogs()">Refresh Logs</button>
      </div>
      <table class="logs-table">
        <thead>
          <tr>
            <th>Time</th>
            <th>Model / Combo</th>
            <th>Status</th>
            <th>Latency</th>
            <th>Auto-Fallback</th>
          </tr>
        </thead>
        <tbody id="logsBody">
          <tr><td colspan="5" style="color: var(--text-muted); text-align: center; padding: 20px;">Ready for requests. Intercepting or direct queries will appear here in real-time.</td></tr>
        </tbody>
      </table>
    </div>
  </div>

  <script>
    async function saveAllKeys() {
      const keys = {
        groq: document.getElementById('key_groq').value.trim(),
        cerebras: document.getElementById('key_cerebras').value.trim(),
        sambanova: document.getElementById('key_sambanova').value.trim(),
        gemini: document.getElementById('key_gemini').value.trim(),
        openrouter: document.getElementById('key_openrouter').value.trim(),
        deepseek: document.getElementById('key_deepseek').value.trim(),
        anthropic: document.getElementById('key_anthropic').value.trim(),
        openai: document.getElementById('key_openai').value.trim(),
      };
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys })
      });
      if (res.ok) {
        alert('All keys saved and synced to Nutaan OmniRoute!');
      } else {
        alert('Failed to save keys.');
      }
    }

    async function refreshLogs() {
      try {
        const res = await fetch('/api/stats');
        const data = await res.json();
        document.getElementById('reqCount').innerText = data.stats.totalRequests || 0;
        document.getElementById('fbCount').innerText = data.stats.fallbacksTriggered || 0;
        const tbody = document.getElementById('logsBody');
        if (data.stats.recentLogs && data.stats.recentLogs.length > 0) {
          tbody.innerHTML = data.stats.recentLogs.map(l => \`
            <tr>
              <td>\${new Date(l.timestamp).toLocaleTimeString()}</td>
              <td><b>\${l.model}</b></td>
              <td><span class="\${l.status === 200 ? 'badge-ok' : 'badge-fb'}">\${l.status}</span></td>
              <td>\${l.latencyMs ? l.latencyMs + 'ms' : '-'}</td>
              <td>\${l.fallback ? '<span class="badge-fb">Cascaded</span>' : 'None'}</td>
            </tr>
          \`).join('');
        }
      } catch (e) {
        console.error(e);
      }
    }

    setInterval(refreshLogs, 5000);
  </script>
</body>
</html>`;
}

module.exports = { getDashboardHtml };
