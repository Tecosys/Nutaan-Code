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
        partition: `persist:${provider}-auth` // separate partition to ensure clean login
      },
      autoHideMenuBar: true
    });

    const ses = win.webContents.session;

    if (provider === "chatgpt" || provider === "openai") {
      ses.webRequest.onCompleted({ urls: ["https://chatgpt.com/api/auth/session"] }, async (details) => {
        if (details.statusCode === 200) {
          try {
            const script = `
              fetch('/api/auth/session')
                .then(r => r.json())
                .then(d => d.accessToken)
                .catch(e => null)
            `;
            const token = await win.webContents.executeJavaScript(script);
            if (token) {
              capturedToken = token;
              win.close();
            }
          } catch (e) {
            console.error("Failed to extract ChatGPT token:", e);
          }
        }
      });
    } else if (provider === "claude" || provider === "anthropic") {
      ses.cookies.on('changed', (event, cookie, cause, removed) => {
        if (!removed && cookie.domain && cookie.domain.includes('claude.ai') && cookie.name === 'sessionKey') {
          capturedToken = cookie.value;
          win.close();
        }
      });
    } else if (provider === "gemini" || provider === "google") {
      ses.cookies.on('changed', (event, cookie, cause, removed) => {
        if (!removed && cookie.domain && cookie.domain.includes('google.com') && cookie.name === '__Secure-1PSID') {
          setTimeout(async () => {
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
          }, 3000);
        }
      });
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
