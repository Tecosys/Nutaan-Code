const { BrowserWindow, session } = require("electron");

async function interceptServiceLogin(provider) {
  return new Promise((resolve, reject) => {
    let url = "";
    let capturedToken = null;

    if (provider === "chatgpt" || provider === "openai") {
      url = "https://chatgpt.com/";
    } else if (provider === "gemini" || provider === "google") {
      url = "https://gemini.google.com/";
    } else if (provider === "claude" || provider === "anthropic") {
      url = "https://claude.ai/login";
    } else {
      return reject(new Error("Unknown provider for auth interception"));
    }

    const win = new BrowserWindow({
      width: 800,
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
