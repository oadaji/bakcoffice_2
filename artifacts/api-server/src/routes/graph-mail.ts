import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { db, emailAccounts, emailsTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { getValidAccessToken } from "./gmail";

const router: IRouter = Router();

// ── Graph API helpers ─────────────────────────────────────────────────────────

interface GraphToken {
  access_token: string;
  expires_in: number;
}

/** Get an app-only token via client credentials (no user login needed). */
export async function getGraphAppToken(): Promise<string> {
  const tenantId = process.env.MICROSOFT_TENANT_ID;
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!tenantId || !clientId || !clientSecret) {
    throw new Error("MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET must be set");
  }

  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
      }),
    }
  );
  const data = await res.json() as GraphToken & { error?: string; error_description?: string };
  if (!data.access_token) {
    throw new Error(data.error_description ?? data.error ?? "Failed to get Graph app token");
  }
  return data.access_token;
}

interface GraphMessage {
  id: string;
  subject?: string;
  receivedDateTime: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  ccRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  body?: { content?: string; contentType?: string };
}

/** Fetch messages from a mailbox via Graph API. */
async function fetchGraphMessages(token: string, mailbox: string, since: Date): Promise<GraphMessage[]> {
  const sinceStr = since.toISOString();
  let nextUrl: string = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(mailbox)}/messages`
    + `?$top=50`
    + `&$select=id,subject,receivedDateTime,from,toRecipients,ccRecipients,body`
    + `&$filter=receivedDateTime ge ${sinceStr}`
    + `&$orderby=receivedDateTime desc`;

  const all: GraphMessage[] = [];
  while (nextUrl && all.length < 500) {
    const res = await fetch(nextUrl, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const err = await res.json() as { error?: { code?: string; message?: string } };
      throw new Error(err.error?.message ?? `Graph API error ${res.status}`);
    }
    const data = await res.json() as { value: GraphMessage[]; "@odata.nextLink"?: string };
    all.push(...(data.value ?? []));
    nextUrl = data["@odata.nextLink"] ?? "";
  }
  return all;
}

/** Strip HTML tags from Graph body content. */
function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ── POST /api/email-accounts/shared ──────────────────────────────────────────
// Add a shared mailbox by reusing an existing OAuth2 account's token.
// The signed-in user (e.g. okpanachia) must have Full Access to the shared mailbox.
// No new sign-in popup needed — we borrow the token from the existing oauth2 account.
router.post("/email-accounts/shared", async (req, res) => {
  const { email, label } = req.body as { email?: string; label?: string };
  if (!email) { res.status(400).json({ error: "email is required" }); return; }

  const emailNorm = email.toLowerCase().trim();

  try {
    // Find an existing active OAuth2 Outlook account to borrow tokens from
    const allAccounts = await db.select().from(emailAccounts).where(eq(emailAccounts.active, true));
    const donor = allAccounts.find(a => a.authType === "oauth2" && a.provider === "outlook" && a.refreshToken);

    if (!donor) {
      res.status(400).json({ error: "No signed-in Microsoft account found. Use 'Sign in with Microsoft' first to connect your personal mailbox, then add shared mailboxes." });
      return;
    }

    // Get a valid access token from the donor account (refresh if needed)
    const token = await getValidAccessToken({
      email: donor.email,
      authType: "oauth2",
      accessToken: donor.accessToken,
      refreshToken: donor.refreshToken,
      tokenExpiresAt: donor.tokenExpiresAt,
      imapHost: "outlook.office365.com",
      imapPort: 993,
      label: donor.label ?? donor.email,
      dbId: donor.id,
    });

    // Test IMAP connection to the shared mailbox using the donor's token
    const client = new ImapFlow({
      host: "outlook.office365.com",
      port: 993,
      secure: true,
      auth: { user: emailNorm, accessToken: token } as any,
      logger: false,
    });
    client.on("error", () => {});

    await client.connect();
    const status = await client.status("INBOX", { messages: true, unseen: true });
    await client.logout();

    // Save the shared mailbox reusing the donor's tokens
    const now = new Date();
    const [row] = await db.insert(emailAccounts).values({
      email: emailNorm,
      label: label || `${emailNorm} (shared via ${donor.email})`,
      provider: "outlook",
      imapHost: "outlook.office365.com",
      imapPort: 993,
      authType: "oauth2",
      refreshToken: donor.refreshToken,
      accessToken: donor.accessToken,
      tokenExpiresAt: donor.tokenExpiresAt,
      lastSyncedAt: now,
      active: true,
    }).onConflictDoUpdate({
      target: emailAccounts.email,
      set: {
        authType: sql`'oauth2'`,
        provider: sql`'outlook'`,
        refreshToken: donor.refreshToken,
        accessToken: donor.accessToken,
        tokenExpiresAt: donor.tokenExpiresAt,
        lastSyncedAt: now,
        active: sql`true`,
        lastError: sql`null`,
      },
    }).returning({
      id: emailAccounts.id,
      email: emailAccounts.email,
      label: emailAccounts.label,
      provider: emailAccounts.provider,
      authType: emailAccounts.authType,
    });

    res.status(201).json({ ...row, ok: true, unread: status.unseen ?? 0, message: `Connected — ${status.unseen ?? 0} unread in INBOX` });
  } catch (err) {
    req.log.warn({ err }, "Shared mailbox connect failed");
    const e = err as Record<string, unknown>;
    const isAuth = e.authenticationFailed === true || String(e.message ?? "").toLowerCase().includes("auth");
    res.status(400).json({
      error: isAuth
        ? `Access denied for ${emailNorm}. Make sure your account has Full Access delegation to this shared mailbox in Exchange admin.`
        : String((err as Error).message ?? err),
    });
  }
});

// ── POST /api/graph/sync ──────────────────────────────────────────────────────
// Syncs all mailboxes with provider='graph' using app-only Graph access.
router.post("/graph/sync", async (req, res) => {
  const { since } = req.body as { since?: string };
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 60 * 1000);

  try {
    const graphAccounts = await db
      .select()
      .from(emailAccounts)
      .where(eq(emailAccounts.active, true));

    const targets = graphAccounts.filter(a => a.provider === "graph");

    if (targets.length === 0) {
      res.status(503).json({ error: "No Graph mailboxes configured. Add one first." });
      return;
    }

    const token = await getGraphAppToken(); // one token covers all mailboxes

    let totalSynced = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const acct of targets) {
      try {
        const messages = await fetchGraphMessages(token, acct.email, sinceDate);
        let synced = 0;
        let skipped = 0;

        for (const msg of messages) {
          const uid = `graph-${msg.id}`;
          const fromAddr = msg.from?.emailAddress;
          const fromEmail = fromAddr?.address ?? "";
          const fromName = fromAddr?.name ?? fromEmail;
          const subject = msg.subject ?? "(no subject)";
          const receivedAt = msg.receivedDateTime;

          let body = "";
          if (msg.body?.contentType === "html" && msg.body.content) {
            body = stripHtml(msg.body.content);
          } else {
            body = msg.body?.content ?? "";
          }

          // Skip if already in DB
          const existing = await db
            .select({ id: emailsTable.id })
            .from(emailsTable)
            .where(eq(emailsTable.uid, uid))
            .limit(1);
          if (existing.length > 0) { skipped++; continue; }

          // Ingest via /api/rfq/ingest
          const port = process.env.PORT ?? "8080";
          const ingestRes = await fetch(`http://localhost:${port}/api/rfq/ingest`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid,
              fromName,
              fromEmail,
              subject,
              body,
              receivedAt,
              receivedInbox: acct.email,
            }),
          });
          if (ingestRes.ok) synced++;
          else skipped++;
        }

        totalSynced += synced;
        totalSkipped += skipped;

        await db.update(emailAccounts).set({
          lastSyncedAt: new Date(),
          lastError: null,
        }).where(eq(emailAccounts.id, acct.id));

      } catch (err) {
        const msg = String((err as Error).message ?? err);
        allErrors.push(`${acct.email}: ${msg}`);
        await db.update(emailAccounts).set({ lastError: msg }).where(eq(emailAccounts.id, acct.id));
      }
    }

    res.json({
      synced: totalSynced,
      skipped: totalSkipped,
      errors: allErrors,
      accounts: targets.length,
    });
  } catch (err) {
    req.log.error({ err }, "Graph sync failed");
    res.status(500).json({ error: String(err) });
  }
});

export { router as graphMailRouter };
