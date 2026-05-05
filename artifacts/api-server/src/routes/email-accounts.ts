import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { db, emailAccounts } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function imapHostForProvider(provider: string): string {
  if (provider === "outlook") return "imap.outlook.com";
  return "imap.gmail.com";
}

// ── GET /api/email-accounts ───────────────────────────────────────────────────
router.get("/email-accounts", async (req, res) => {
  try {
    const rows = await db.select({
      id: emailAccounts.id,
      label: emailAccounts.label,
      email: emailAccounts.email,
      provider: emailAccounts.provider,
      imapHost: emailAccounts.imapHost,
      imapPort: emailAccounts.imapPort,
      active: emailAccounts.active,
      lastSyncedAt: emailAccounts.lastSyncedAt,
      lastError: emailAccounts.lastError,
      createdAt: emailAccounts.createdAt,
    }).from(emailAccounts).orderBy(emailAccounts.createdAt);

    // Also surface the env-var account if configured
    const envEmail = process.env.GMAIL_ADDRESS;
    const envAccounts = envEmail ? [{
      id: 0,
      label: "Default (env)",
      email: envEmail,
      provider: "gmail",
      imapHost: null,
      imapPort: null,
      active: true,
      lastSyncedAt: null,
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

// ── POST /api/email-accounts ──────────────────────────────────────────────────
router.post("/email-accounts", async (req, res) => {
  try {
    const { email, password, label, provider: rawProvider } = req.body as {
      email?: string; password?: string; label?: string; provider?: string;
    };

    if (!email || !password) {
      res.status(400).json({ error: "email and password are required" }); return;
    }

    // Auto-detect provider from domain
    const domain = email.split("@")[1]?.toLowerCase() ?? "";
    let provider = rawProvider ?? "gmail";
    if (!rawProvider) {
      if (["outlook.com", "hotmail.com", "live.com", "msn.com"].includes(domain)) provider = "outlook";
    }

    const imapHost = imapHostForProvider(provider);

    const [row] = await db.insert(emailAccounts).values({
      email: email.toLowerCase().trim(),
      password,
      label: label || email,
      provider,
      imapHost,
      imapPort: 993,
      active: true,
    }).returning({
      id: emailAccounts.id,
      email: emailAccounts.email,
      label: emailAccounts.label,
      provider: emailAccounts.provider,
      active: emailAccounts.active,
      createdAt: emailAccounts.createdAt,
    });

    res.status(201).json(row);
  } catch (err: unknown) {
    const msg = String(err);
    if (msg.includes("unique")) {
      res.status(409).json({ error: "This email address is already connected" }); return;
    }
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

    const client = new ImapFlow({
      host: acct.imapHost ?? imapHostForProvider(acct.provider),
      port: acct.imapPort ?? 993,
      secure: true,
      auth: { user: acct.email, pass: acct.password },
      logger: false,
    });
    client.on("error", () => {});

    await client.connect();
    const status = await client.status("INBOX", { messages: true, unseen: true });
    await client.logout();
    res.json({ ok: true, message: `Connected — ${status.unseen ?? 0} unread in INBOX` });
  } catch (err) {
    const msg = String(err);
    req.log.warn({ err }, "Email account test failed");
    res.json({ ok: false, message: msg.includes("auth") || msg.includes("Login") || msg.includes("credentials")
      ? "Authentication failed — check your app password"
      : "Connection failed: " + msg.split("\n")[0] });
  }
});

// ── POST /api/email-accounts/test-credentials ─────────────────────────────────
// Test before saving (no id needed)
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
    const msg = String(err);
    res.json({ ok: false, message: msg.includes("auth") || msg.includes("Login")
      ? "Authentication failed — use an app password, not your account password"
      : "Connection failed: " + msg.split("\n")[0] });
  }
});

export { router as emailAccountsRouter };
