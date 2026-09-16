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

    if (targetUrls[provider]) {
      url = targetUrls[provider];
    } else {
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

    // Spoof User-Agent to prevent Google "Suspicious Browser" blocks
    const userAgent = win.webContents.getUserAgent().replace(/Electron\/[0-9\.]+\s/, '').replace(/NutaanCode\/[0-9\.]+\s/, '');
    win.webContents.setUserAgent(userAgent);

    const ses = win.webContents.session;

    win.loadURL(url);

    if (provider === "chatgpt" || provider === "openai") {
      const checkChatGpt = async () => {
        if (win.isDestroyed() || capturedToken) return;
        try {
          const cookies = await ses.cookies.get({ domain: '.chatgpt.com' });
          const tokenCookie = cookies.find(c => c.name === '__Secure-next-auth.session-token');
          if (tokenCookie) {
            capturedToken = tokenCookie.value;
            win.close();
          }
        } catch(e) {}
      };
      ses.cookies.on('changed', checkChatGpt);
      const poll = setInterval(checkChatGpt, 2000);
      win.on('closed', () => clearInterval(poll));

    } else if (provider === "claude" || provider === "anthropic") {
      const checkClaude = async () => {
        if (win.isDestroyed() || capturedToken) return;
        try {
          const cookies = await ses.cookies.get({ domain: '.claude.ai' });
          const tokenCookie = cookies.find(c => c.name === 'sessionKey');
          if (tokenCookie) {
            capturedToken = tokenCookie.value;
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
          if (psid) {
            capturedToken = `__Secure-1PSID=${psid}`;
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
