import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { db, emailAccounts, emailsTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { imapHostForProvider } from "./gmail";

const router: IRouter = Router();

// ── GET /api/email-accounts ───────────────────────────────────────────────────
router.get("/email-accounts", async (req, res) => {
  try {
    const rows = await db.select({
      id: emailAccounts.id,
      label: emailAccounts.label,
      email: emailAccounts.email,
      provider: emailAccounts.provider,
      authType: emailAccounts.authType,
      imapHost: emailAccounts.imapHost,
      imapPort: emailAccounts.imapPort,
      active: emailAccounts.active,
      lastSyncedAt: emailAccounts.lastSyncedAt,
      lastError: emailAccounts.lastError,
      createdAt: emailAccounts.createdAt,
    }).from(emailAccounts).orderBy(emailAccounts.createdAt);

    // Also surface the env-var account if configured
    const envEmail = process.env.GMAIL_ADDRESS;
    let envLastSynced: Date | null = null;
    if (envEmail) {
      const [latest] = await db
        .select({ createdAt: emailsTable.createdAt })
        .from(emailsTable)
        .orderBy(desc(emailsTable.createdAt))
        .limit(1);
      envLastSynced = latest?.createdAt ?? null;
    }
    const envAccounts = envEmail ? [{
      id: 0,
      label: "Default (env)",
      email: envEmail,
      provider: "gmail",
      authType: "password",
      imapHost: null,
      imapPort: null,
      active: true,
      lastSyncedAt: envLastSynced,
      lastError: null,
      createdAt: null,
      isEnvAccount: true,
    }] : [];

    res.json([...envAccounts, ...rows]);
  } catch (err) {
    req.log.error({ err }, "Failed to list email accounts");
    res.status(500).json({ error: "Failed to list email accounts" });
  }
});

// ── POST /api/email-accounts (app-password flow) ──────────────────────────────
router.post("/email-accounts", async (req, res) => {
  try {
    const { email, password, label, provider: rawProvider } = req.body as {
      email?: string; password?: string; label?: string; provider?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" }); return;
    }

    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    let provider = rawProvider ?? "gmail";
    if (!rawProvider) {
      if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) provider = "outlook";
    }

    const imapHost = imapHostForProvider(provider);
    const emailNorm = email.toLowerCase().trim();

    const [row] = await db.insert(emailAccounts).values({
      email: emailNorm,
      password,
      label: label || emailNorm,
      provider,
      imapHost,
      imapPort: 993,
      authType: "password",
      active: true,
    })
    .onConflictDoUpdate({
      target: emailAccounts.email,
      set: {
        password,
        provider,
        imapHost,
        imapPort: sql`993`,
        authType: sql`'password'`,
        active: sql`true`,
        lastError: sql`null`,
        refreshToken: sql`null`,
        accessToken: sql`null`,
        tokenExpiresAt: sql`null`,
      },
    })
    .returning({
      id: emailAccounts.id,
      email: emailAccounts.email,
      label: emailAccounts.label,
      provider: emailAccounts.provider,
      active: emailAccounts.active,
      createdAt: emailAccounts.createdAt,
    });

    res.status(201).json(row);
  } catch (err: unknown) {
    req.log.error({ err }, "Failed to add email account");
    res.status(500).json({ error: "Failed to add email account" });
  }
});

// ── DELETE /api/email-accounts/:id ───────────────────────────────────────────
router.delete("/email-accounts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(emailAccounts).where(eq(emailAccounts.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete email account");
    res.status(500).json({ error: "Failed to delete email account" });
  }
});

// ── POST /api/email-accounts/:id/test ────────────────────────────────────────
router.post("/email-accounts/:id/test", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [acct] = await db.select().from(emailAccounts).where(eq(emailAccounts.id, id));
    if (!acct) { res.status(404).json({ ok: false, message: "Account not found" }); return; }

    let authArg: { user: string; pass?: string | null; accessToken?: string } = { user: acct.email, pass: acct.password };

    if (acct.authType === "oauth2" && acct.accessToken) {
      // Refresh if close to expiry
      let token = acct.accessToken;
      const soon = new Date(Date.now() + 5 * 60 * 1000);
      if (!acct.tokenExpiresAt || acct.tokenExpiresAt < soon) {
        const clientId = process.env.MICROSOFT_CLIENT_ID;
        const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
        if (clientId && clientSecret && acct.refreshToken) {
          const rr = await fetch("https://login.microsoftonline.com/common/oauth2/v2.0/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              grant_type: "refresh_token",
              refresh_token: acct.refreshToken,
              client_id: clientId,
              client_secret: clientSecret,
              scope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access",
            }),
          });
          const rd = await rr.json() as { access_token?: string; refresh_token?: string; expires_in?: number };
          if (rd.access_token) {
            token = rd.access_token;
            await db.update(emailAccounts).set({
              accessToken: token,
              refreshToken: rd.refresh_token ?? acct.refreshToken,
              tokenExpiresAt: new Date(Date.now() + (rd.expires_in ?? 3600) * 1000),
            }).where(eq(emailAccounts.id, id));
          }
        }
      }
      authArg = { user: acct.email, accessToken: token };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = new ImapFlow({
      host: acct.imapHost ?? imapHostForProvider(acct.provider),
      port: acct.imapPort ?? 993,
      secure: true,
      auth: authArg as any,
      logger: false,
    });
    client.on("error", () => {});

    await client.connect();
    const status = await client.status("INBOX", { messages: true, unseen: true });
    await client.logout();
    res.json({ ok: true, message: `Connected — ${status.unseen ?? 0} unread in INBOX` });
  } catch (err) {
    req.log.warn({ err }, "Email account test failed");
    const e = err as Record<string, unknown>;
    const isAuthFail = e.authenticationFailed === true
      || String(e.responseText ?? "").toLowerCase().includes("authenticate")
      || String(e.message ?? "").toLowerCase().includes("auth")
      || String(err).toLowerCase().includes("login");
    res.json({ ok: false, message: isAuthFail
      ? "Authentication failed — check your credentials or try reconnecting via OAuth."
      : "Connection failed: " + String(e.message ?? err).split("\n")[0] });
  }
});

// ── POST /api/email-accounts/test-credentials ─────────────────────────────────
router.post("/email-accounts/test-credentials", async (req, res) => {
  try {
    const { email, password, provider: rawProvider } = req.body as {
      email?: string; password?: string; provider?: string;
    };
    if (!email || !password) { res.status(400).json({ ok: false, message: "email and password required" }); return; }

    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    let provider = rawProvider ?? "gmail";
    if (!rawProvider) {
      if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) provider = "outlook";
    }

    const client = new ImapFlow({
      host: imapHostForProvider(provider),
      port: 993,
      secure: true,
      auth: { user: email, pass: password },
      logger: false,
    });
    client.on("error", () => {});

    await client.connect();
    await client.logout();
    res.json({ ok: true, message: "Connection successful" });
  } catch (err) {
    const e = err as Record<string, unknown>;
    const isAuthFail = e.authenticationFailed === true
      || String(e.responseText ?? "").toLowerCase().includes("authenticate")
      || String(e.message ?? "").toLowerCase().includes("auth")
      || String(err).toLowerCase().includes("login");
    res.json({ ok: false, message: isAuthFail
      ? "Authentication failed. Basic Auth may be blocked by your M365 tenant — use 'Sign in with Microsoft' (OAuth) instead."
      : "Connection failed: " + String(e.message ?? err).split("\n")[0] });
  }
});

// ── GET /api/email-accounts/oauth/microsoft ───────────────────────────────────
// Starts the Microsoft OAuth2 flow. Opens in a popup from the UI.
router.get("/email-accounts/oauth/microsoft", (req, res) => {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  if (!clientId) {
    res.status(503).send(`<html><body style="font-family:sans-serif;padding:32px;text-align:center">
      <p style="color:#dc2626;font-size:14px">Microsoft OAuth is not configured.<br>
      Add MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET to environment variables.</p>
      <button onclick="window.close()">Close</button></body></html>`);
    return;
  }

  const publicDomain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0].trim();
  const redirectUri = publicDomain
    ? `https://${publicDomain}/api/email-accounts/oauth/callback`
    : `${req.protocol}://${req.get("host")}/api/email-accounts/oauth/callback`;

  // Encode csrf + optional target mailbox (for shared mailboxes) in state
  const csrf = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
  const targetMailbox = (req.query.mailbox as string | undefined)?.toLowerCase().trim() ?? "";
  const state = Buffer.from(JSON.stringify({ csrf, mailbox: targetMailbox })).toString("base64url");

  const tenantId = process.env.MICROSOFT_TENANT_ID ?? "common";

  const params = new URLSearchParams({
    client_id: clientId,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access email profile openid",
    state,
    response_mode: "query",
    prompt: "select_account",
  });

  res.redirect(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?${params}`);
});

// ── GET /api/email-accounts/oauth/callback ────────────────────────────────────
// Microsoft redirects here after the user signs in.
router.get("/email-accounts/oauth/callback", async (req, res) => {
  const { code, error, error_description } = req.query as Record<string, string>;

  const closeWithError = (msg: string) => res.send(`<html><body>
    <script>window.opener?.postMessage({type:'ms-oauth-error',error:${JSON.stringify(msg)}},'*');window.close();</script>
    <p style="font-family:sans-serif;padding:32px;color:#dc2626">${msg}</p></body></html>`);

  if (error) { closeWithError(error_description ?? error); return; }
  if (!code) { closeWithError("No auth code received"); return; }

  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) { closeWithError("OAuth not configured on server"); return; }

  try {
    const publicDomain = (process.env.REPLIT_DOMAINS ?? "").split(",")[0].trim();
    const redirectUri = publicDomain
      ? `https://${publicDomain}/api/email-accounts/oauth/callback`
      : `${req.protocol}://${req.get("host")}/api/email-accounts/oauth/callback`;
    const tenantId = process.env.MICROSOFT_TENANT_ID ?? "common";

    // Exchange code for tokens
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access email profile openid",
      }),
    });
    const tokens = await tokenRes.json() as {
      access_token?: string;
      refresh_token?: string;
      id_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!tokens.access_token) {
      closeWithError(tokens.error_description ?? tokens.error ?? "Token exchange failed");
      return;
    }

    // Decode state to get optional target mailbox (shared mailbox flow)
    let targetMailbox = "";
    try {
      const stateStr = req.query.state as string | undefined;
      if (stateStr) {
        const decoded = JSON.parse(Buffer.from(stateStr, "base64url").toString("utf8")) as { mailbox?: string };
        targetMailbox = decoded.mailbox ?? "";
      }
    } catch { /* ignore malformed state */ }

    // Decode id_token (JWT) to get the signed-in user's email
    const idToken = tokens.id_token;
    let signerEmail = "";
    let displayName = "";
    if (idToken) {
      try {
        const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")) as {
          email?: string;
          preferred_username?: string;
          upn?: string;
          name?: string;
        };
        signerEmail = (payload.email ?? payload.preferred_username ?? payload.upn ?? "").toLowerCase();
        displayName = payload.name ?? signerEmail;
      } catch { /* fall through */ }
    }

    if (!signerEmail) { closeWithError("Could not retrieve email from Microsoft account — ensure the openid and email scopes are consented"); return; }

    // If a shared mailbox was requested, use it as the inbox email but store
    // the signed-in user's OAuth tokens (IMAP shared mailbox pattern).
    const email = targetMailbox || signerEmail;
    const label = targetMailbox
      ? `${targetMailbox} (via ${signerEmail})`
      : (displayName || signerEmail);

    // Upsert into email_accounts
    await db.insert(emailAccounts).values({
      email,
      label,
      provider: "outlook",
      imapHost: "outlook.office365.com",
      imapPort: 993,
      authType: "oauth2",
      refreshToken: tokens.refresh_token,
      accessToken: tokens.access_token,
      tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
      active: true,
    }).onConflictDoUpdate({
      target: emailAccounts.email,
      set: {
        authType: sql`'oauth2'`,
        provider: sql`'outlook'`,
        imapHost: sql`'outlook.office365.com'`,
        refreshToken: tokens.refresh_token,
        accessToken: tokens.access_token,
        tokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
        active: sql`true`,
        lastError: sql`null`,
        password: sql`null`,
      },
    });

    res.send(`<html><body>
      <script>window.opener?.postMessage({type:'ms-oauth-success',email:${JSON.stringify(email)}},'*');window.close();</script>
      <p style="font-family:sans-serif;padding:32px;color:#166534">✓ Connected ${email} — you can close this window.</p>
    </body></html>`);
  } catch (err) {
    closeWithError("Server error: " + String(err));
  }
});

export { router as emailAccountsRouter };
