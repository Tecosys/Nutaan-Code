const { BrowserWindow, session } = require("electron");

async function interceptServiceLogin(provider) {
  return new Promise((resolve, reject) => {
    let url = "";
    let capturedToken = null;

    const targetUrls = {
      "chatgpt": "https://chatgpt.com/",
      "openai": "https://chatgpt.com/",
      "gemini": "https://gemini.google.com/",
      "google": "https://gemini.google.com/",
      "claude": "https://claude.ai/login",
      "anthropic": "https://claude.ai/login",
      "groq": "https://groq.com/",
      "deepseek": "https://chat.deepseek.com/",
      "mistral": "https://chat.mistral.ai/",
      "perplexity": "https://www.perplexity.ai/"
    };

    url = targetUrls[provider];
    if (!url) {
      return reject(new Error("Unknown provider for auth interception"));
    }

    const win = new BrowserWindow({
      width: 900,
      height: 800,
      title: `Login to ${provider} to link with Nutaan`,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        partition: `persist:omniroute-auth` // Shared partition so user only logs into Google once
      },
      autoHideMenuBar: true
    });

    const ses = win.webContents.session;

    if (provider === "chatgpt" || provider === "openai") {
      // Modern ChatGPT may not trigger a network request to /api/auth/session that we can intercept easily.
      // Instead, we poll the page context every 2 seconds to check if a valid session exists.
      const pollInterval = setInterval(async () => {
        if (win.isDestroyed()) {
          clearInterval(pollInterval);
          return;
        }
        try {
          const script = `
            fetch('/api/auth/session')
              .then(r => r.json())
              .then(d => d.accessToken)
              .catch(e => null)
          `;
          const token = await win.webContents.executeJavaScript(script);
          if (token && typeof token === 'string' && token.length > 50) {
            clearInterval(pollInterval);
            capturedToken = token;
            if (!win.isDestroyed()) win.close();
          }
        } catch (e) {
          // Ignore execution context errors (e.g., during navigation)
        }
      }, 2000);
    } else if (provider === "claude" || provider === "anthropic") {
      const checkClaude = async () => {
        if (win.isDestroyed() || capturedToken) return;
        try {
          const cookies = await ses.cookies.get({ domain: 'claude.ai', name: 'sessionKey' });
          if (cookies && cookies.length > 0) {
            capturedToken = cookies[0].value;
            win.close();
          }
        } catch(e) {}
      };
      ses.cookies.on('changed', checkClaude);
      const poll = setInterval(checkClaude, 2000);
      win.on('closed', () => clearInterval(poll));

    } else if (provider === "gemini" || provider === "google") {
      const checkGemini = async () => {
        if (win.isDestroyed() || capturedToken) return;
        try {
          const cookies = await ses.cookies.get({ domain: '.google.com' });
          const psid = cookies.find(c => c.name === '__Secure-1PSID')?.value;
          const psidts = cookies.find(c => c.name === '__Secure-1PSIDTS')?.value;
          if (psid) {
            capturedToken = `__Secure-1PSID=${psid};`;
            if (psidts) capturedToken += ` __Secure-1PSIDTS=${psidts};`;
            win.close();
          }
        } catch(e) {}
      };
      ses.cookies.on('changed', checkGemini);
      const poll = setInterval(checkGemini, 2000);
      win.on('closed', () => clearInterval(poll));

    } else {
      // Generic fallback for Groq, DeepSeek, Mistral, Perplexity
      // Sniff 'Authorization: Bearer' headers on API calls
      ses.webRequest.onBeforeSendHeaders((details, callback) => {
        const authHeader = details.requestHeaders['Authorization'] || details.requestHeaders['authorization'];
        if (authHeader && authHeader.toLowerCase().startsWith('bearer ') && !capturedToken) {
          // Ignore telemetry or analytics endpoints to ensure we capture the real API token
          if (!details.url.includes("telemetry") && !details.url.includes("analytics") && !details.url.includes("sentry")) {
            capturedToken = authHeader.substring(7); // Extract token after "Bearer "
            setTimeout(() => {
              if (!win.isDestroyed()) win.close();
            }, 1500);
          }
        }
        callback({ requestHeaders: details.requestHeaders });
      });

      // Monitor potential cookies as a backup (e.g. __session for Groq or similar platforms)
      ses.cookies.on('changed', (event, cookie, cause, removed) => {
        if (!removed && !capturedToken) {
          if (provider === 'groq' && cookie.name === '__session') {
            capturedToken = cookie.value;
            setTimeout(() => { if (!win.isDestroyed()) win.close(); }, 1500);
          }
        }
      });
    }

    win.on('closed', () => {
      if (capturedToken) {
        resolve({ ok: true, token: capturedToken, provider });
      } else {
        resolve({ ok: false, error: "Window closed before token was captured" });
      }
    });

    win.loadURL(url);
  });
}

module.exports = { interceptServiceLogin };
