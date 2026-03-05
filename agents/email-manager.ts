import { BaseAgent } from "../src/agent/index.js";
import type { AgentAPI } from "../src/types/index.js";
import { getAdobeCleanFontFaceCSS, getThemeCSS, getSharedUIPrimitivesCSS, getHeaderBarCSS, getHeaderHomeIconHTML, dramTheme } from "../src/utils/theme.js";

export default class EmailManagerAgent extends BaseAgent {
  constructor(api: AgentAPI) {
    super(api);
    this.registerRoutes();
    console.log("[email-manager] Email UI available at /email/");
  }

  async execute(): Promise<void> {}

  private registerRoutes(): void {
    this.api.http.registerRoute("/email", this.handleUI.bind(this));
    this.api.http.registerRoute("/email/", this.handleUI.bind(this));
    this.api.http.registerRoute("/email/accounts", this.handleAccounts.bind(this));
    this.api.http.registerRoute("/email/accounts/autodetect", this.handleAutodetect.bind(this));
    this.api.http.registerRoute("/email/accounts/", this.handleAccountSubRoutes.bind(this));
  }

  private async handleAutodetect(req: Request): Promise<Response> {
    if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405 });
    try {
      const body = await req.json();
      let config: any;
      try {
        config = await this.api.plugins.call("email", "autodetectSettings", body);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!/Method .* not found|not found/i.test(msg)) throw e;
        config = this.localAutodetect(body);
      }
      return Response.json({ config });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  private async handleAccounts(req: Request): Promise<Response> {
    try {
      if (req.method === "GET") {
        const accounts = await this.api.plugins.call("email", "listAccounts");
        return Response.json({ accounts });
      }
      if (req.method === "POST") {
        const body = await req.json();
        const added = await this.api.plugins.call("email", "addAccount", body);
        return Response.json(added);
      }
      return new Response("Method Not Allowed", { status: 405 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  private localAutodetect(body: any): any {
    const email = String(body?.email || "").trim();
    const password = String(body?.password || "").trim();
    if (!email.includes("@")) throw new Error("Valid email is required");
    if (!password) throw new Error("Password is required");
    const domain = email.split("@")[1].toLowerCase();
    const presets: Record<string, any> = {
      "gmail.com": { imap: ["imap.gmail.com", 993, true], smtp: ["smtp.gmail.com", 587, false] },
      "outlook.com": { imap: ["outlook.office365.com", 993, true], smtp: ["smtp.office365.com", 587, false] },
      "hotmail.com": { imap: ["outlook.office365.com", 993, true], smtp: ["smtp.office365.com", 587, false] },
      "live.com": { imap: ["outlook.office365.com", 993, true], smtp: ["smtp.office365.com", 587, false] },
      "icloud.com": { imap: ["imap.mail.me.com", 993, true], smtp: ["smtp.mail.me.com", 587, false] },
      "me.com": { imap: ["imap.mail.me.com", 993, true], smtp: ["smtp.mail.me.com", 587, false] },
      "yahoo.com": { imap: ["imap.mail.yahoo.com", 993, true], smtp: ["smtp.mail.yahoo.com", 587, false] },
    };
    const p = presets[domain] || { imap: [`imap.${domain}`, 993, true], smtp: [`smtp.${domain}`, 587, false] };
    return {
      name: String(body?.name || email),
      email,
      imap: { host: p.imap[0], port: p.imap[1], secure: p.imap[2], auth: { user: String(body?.login || email), pass: password } },
      smtp: { host: p.smtp[0], port: p.smtp[1], secure: p.smtp[2], auth: { user: String(body?.login || email), pass: password } },
    };
  }

  private async handleAccountSubRoutes(req: Request): Promise<Response> {
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    const accountId = parts[2];
    if (!accountId) return Response.json({ error: "Missing account id" }, { status: 400 });

    try {
      if (parts.length === 3 && req.method === "DELETE") {
        const removed = await this.api.plugins.call("email", "removeAccount", accountId);
        return Response.json(removed);
      }
      if (parts.length === 4 && parts[3] === "inbox" && req.method === "GET") {
        const limitRaw = url.searchParams.get("limit");
        const limit = limitRaw ? Number.parseInt(limitRaw, 10) : 20;
        const inbox = await this.api.plugins.call("email", "getInbox", accountId, { limit: Number.isFinite(limit) ? limit : 20 });
        return Response.json({ inbox });
      }
      return new Response("Not Found", { status: 404 });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : String(error) },
        { status: 500 }
      );
    }
  }

  private async handleUI(): Promise<Response> {
    const html = `<!doctype html>
<html>
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Email Manager - Ronin</title>
  <style>
    ${getAdobeCleanFontFaceCSS()}
    ${getThemeCSS(dramTheme)}
    ${getSharedUIPrimitivesCSS(dramTheme, { variant: "dram" })}
    ${getHeaderBarCSS(dramTheme)}
    body { margin: 0; padding: 0; }
    .page-content { max-width: 1100px; margin: 0 auto; padding: ${dramTheme.spacing.lg}; }
    .grid { display: grid; gap: ${dramTheme.spacing.md}; grid-template-columns: 1fr 1fr; }
    .card { background: ${dramTheme.colors.backgroundSecondary}; border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.md}; padding: ${dramTheme.spacing.md}; }
    .row { display: grid; grid-template-columns: 1fr 1fr; gap: ${dramTheme.spacing.sm}; margin-bottom: ${dramTheme.spacing.sm}; }
    input, button { width: 100%; padding: 8px; background: ${dramTheme.colors.background}; color: ${dramTheme.colors.textPrimary}; border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.sm}; }
    button { cursor: pointer; }
    .list { display: grid; gap: ${dramTheme.spacing.sm}; }
    .acct { border: 1px solid ${dramTheme.colors.border}; border-radius: ${dramTheme.borderRadius.sm}; padding: 10px; }
    .muted { color: ${dramTheme.colors.textSecondary}; font-size: 12px; }
    .status { margin-bottom: ${dramTheme.spacing.sm}; }
  </style>
</head>
<body>
  <div class="header">${getHeaderHomeIconHTML()}<h1>Email Manager</h1></div>
  <div class="page-content">
    <div id="status" class="status muted">Loading accounts...</div>
    <div class="grid">
      <div class="card">
        <h3>Add Account</h3>
        <div class="row"><input id="name" placeholder="Name"><input id="email" placeholder="Email"></div>
        <div class="row"><input id="password" type="password" placeholder="Password / App Password"><button onclick="autodetect()">Auto Detect Settings</button></div>
        <div class="row"><input id="imapHost" placeholder="IMAP Host"><input id="imapPort" placeholder="IMAP Port (993)" value="993"></div>
        <div class="row"><input id="imapUser" placeholder="IMAP User"><input id="imapPass" type="password" placeholder="IMAP Password"></div>
        <div class="row"><input id="smtpHost" placeholder="SMTP Host"><input id="smtpPort" placeholder="SMTP Port (587)" value="587"></div>
        <div class="row"><input id="smtpUser" placeholder="SMTP User"><input id="smtpPass" type="password" placeholder="SMTP Password"></div>
        <button onclick="addAccount()">Add Account</button>
      </div>
      <div class="card">
        <h3>Accounts</h3>
        <div id="accounts" class="list"></div>
      </div>
    </div>
  </div>
  <script>
    const statusEl = document.getElementById('status');
    const accountsEl = document.getElementById('accounts');
    function setStatus(text, isError = false) {
      statusEl.textContent = text;
      statusEl.style.color = isError ? '#ff6b6b' : '';
    }
    async function loadAccounts() {
      const res = await fetch('/email/accounts');
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load accounts');
      const accounts = data.accounts || [];
      accountsEl.innerHTML = accounts.length ? accounts.map(a => \`
        <div class="acct">
          <div><strong>\${a.name}</strong> &lt;\${a.email}&gt;</div>
          <div class="muted">id: \${a.id}</div>
          <button onclick="removeAccount('\${a.id}')">Remove</button>
        </div>\`).join('') : '<div class="muted">No accounts configured yet.</div>';
      setStatus(\`Loaded \${accounts.length} account(s).\`);
    }
    async function addAccount() {
      try {
        setStatus('Adding account...');
        const body = {
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
          imap: {
            host: document.getElementById('imapHost').value,
            port: Number(document.getElementById('imapPort').value || 993),
            secure: true,
            auth: {
              user: document.getElementById('imapUser').value,
              pass: document.getElementById('imapPass').value
            }
          },
          smtp: {
            host: document.getElementById('smtpHost').value,
            port: Number(document.getElementById('smtpPort').value || 587),
            secure: false,
            auth: {
              user: document.getElementById('smtpUser').value,
              pass: document.getElementById('smtpPass').value
            }
          }
        };
        const res = await fetch('/email/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to add account');
        setStatus('Account added.');
        await loadAccounts();
      } catch (e) {
        setStatus(e.message || String(e), true);
      }
    }
    async function autodetect() {
      try {
        setStatus('Detecting IMAP/SMTP settings...');
        const body = {
          name: document.getElementById('name').value,
          email: document.getElementById('email').value,
          password: document.getElementById('password').value,
          login: document.getElementById('imapUser').value || document.getElementById('smtpUser').value
        };
        const res = await fetch('/email/accounts/autodetect', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Auto detect failed');
        const cfg = data.config || {};
        if (cfg.imap) {
          document.getElementById('imapHost').value = cfg.imap.host || '';
          document.getElementById('imapPort').value = String(cfg.imap.port || 993);
          document.getElementById('imapUser').value = (cfg.imap.auth && cfg.imap.auth.user) || document.getElementById('email').value;
          document.getElementById('imapPass').value = (cfg.imap.auth && cfg.imap.auth.pass) || document.getElementById('password').value;
        }
        if (cfg.smtp) {
          document.getElementById('smtpHost').value = cfg.smtp.host || '';
          document.getElementById('smtpPort').value = String(cfg.smtp.port || 587);
          document.getElementById('smtpUser').value = (cfg.smtp.auth && cfg.smtp.auth.user) || document.getElementById('email').value;
          document.getElementById('smtpPass').value = (cfg.smtp.auth && cfg.smtp.auth.pass) || document.getElementById('password').value;
        }
        setStatus('Settings detected. Review and click Add Account.');
      } catch (e) {
        setStatus(e.message || String(e), true);
      }
    }
    async function removeAccount(id) {
      try {
        setStatus('Removing account...');
        const res = await fetch('/email/accounts/' + encodeURIComponent(id), { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to remove account');
        setStatus('Account removed.');
        await loadAccounts();
      } catch (e) {
        setStatus(e.message || String(e), true);
      }
    }
    loadAccounts().catch(err => setStatus(err.message || String(err), true));
  </script>
</body>
</html>`;
    return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
  }
}
