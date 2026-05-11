import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Readable } from "stream";
import { db, emailsTable, rfqsTable, emailAccounts } from "@workspace/db";
import { eq, sql, and, desc } from "drizzle-orm";
import nodemailer from "nodemailer";

// Strip angle brackets from Message-ID values for consistent storage
function normaliseMessageId(raw: string | undefined): string | null {
  if (!raw) return null;
  return raw.trim().replace(/^<|>$/g, "");
}

const router: IRouter = Router();

// ── Automated-sender filter ───────────────────────────────────────────────────
// Returns true if the email should be skipped (not an RFQ candidate)

const AUTOMATED_ADDRESS_PATTERNS = [
  /^no.?reply@/i,
  /^noreply@/i,
  /^do.?not.?reply@/i,
  /^mailer@/i,
  /^bounce[+-]/i,
  /^notifications?@/i,
  /^alerts?@/i,
  /^newsletter@/i,
  /^updates?@/i,
  /^orders?@/i,
  /^support@/i,
  /^billing@/i,
  /^info@accounts\./i,
  /@accounts\.google\.com$/i,
  /@notifications\./i,
  /@mail\.(linkedin|facebook|twitter|instagram|tiktok|amazon|ebay|paypal)\.com$/i,
];

const AUTOMATED_SUBJECT_PATTERNS = [
  /security alert/i,
  /verify your email/i,
  /confirm your (email|account|subscription)/i,
  /unsubscribe/i,
  /newsletter/i,
  /your (order|receipt|invoice) (has been|was)/i,
  /password reset/i,
  /\[automated\]/i,
  /cupcake|pastry|bakery|cake order|food order/i,
  /appointment (confirmed|reminder|booked)/i,
  /booking confirmation/i,
  /thank you for your (order|purchase)/i,
];

function isAutomatedEmail(fromEmail: string, subject: string, hasListUnsubscribe: boolean): boolean {
  if (hasListUnsubscribe) return true;
  if (AUTOMATED_ADDRESS_PATTERNS.some((p) => p.test(fromEmail))) return true;
  if (AUTOMATED_SUBJECT_PATTERNS.some((p) => p.test(subject))) return true;
  return false;
}

// ── IMAP client factory ───────────────────────────────────────────────────────

interface AccountConfig {
  email: string;
  password?: string | null;
  accessToken?: string | null;
  authType: string;
  imapHost: string;
  imapPort: number;
  label: string;
  dbId?: number;
  refreshToken?: string | null;
  tokenExpiresAt?: Date | null;
}

export function imapHostForProvider(provider: string): string {
  // outlook.office365.com works for both personal (@outlook.com/@hotmail.com)
  // and business Microsoft 365 accounts (custom domains on Exchange Online)
  if (provider === "outlook") return "outlook.office365.com";
  return "imap.gmail.com";
}

/** Refresh an OAuth2 access token using the refresh token */
async function refreshAccessToken(acct: AccountConfig): Promise<string> {
  const clientId = process.env.MICROSOFT_CLIENT_ID;
  const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error("Microsoft OAuth not configured");

  const tenantId = process.env.MICROSOFT_TENANT_ID ?? "common";
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: acct.refreshToken ?? "",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "https://outlook.office365.com/IMAP.AccessAsUser.All offline_access",
    }),
  });
  const data = await res.json() as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string };
  if (!data.access_token) throw new Error(`Token refresh failed: ${data.error}`);

  // Persist updated tokens
  if (acct.dbId) {
    await db.update(emailAccounts).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token ?? acct.refreshToken,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
      lastError: null,
    }).where(eq(emailAccounts.id, acct.dbId));
  }
  return data.access_token;
}

/** Get a valid access token, refreshing if expired */
export async function getValidAccessToken(acct: AccountConfig): Promise<string> {
  const soon = new Date(Date.now() + 5 * 60 * 1000); // 5 min buffer
  if (acct.accessToken && acct.tokenExpiresAt && acct.tokenExpiresAt > soon) {
    return acct.accessToken;
  }
  return refreshAccessToken(acct);
}

function createImapClientForAccount(acct: AccountConfig, accessToken?: string): ImapFlow {
  const auth = acct.authType === "oauth2" && accessToken
    ? { user: acct.email, accessToken }
    : { user: acct.email, pass: acct.password ?? "" };

  const client = new ImapFlow({
    host: acct.imapHost,
    port: acct.imapPort,
    secure: true,
    auth,
    logger: false,
  });
  // Prevent unhandled 'error' events (e.g. socket timeout after logout) from
  // crashing the process — errors are caught in try/catch at the call sites.
  client.on("error", () => {});
  return client;
}

/** Build the full list of accounts to sync: DB accounts + env-var fallback */
async function getAccountsToSync(): Promise<AccountConfig[]> {
  const accounts: AccountConfig[] = [];

  // Env-var account (legacy / default)
  const envUser = process.env.GMAIL_ADDRESS;
  const envPass = process.env.GMAIL_APP_PASSWORD;
  if (envUser && envPass) {
    accounts.push({
      email: envUser,
      password: envPass,
      authType: "password",
      imapHost: "imap.gmail.com",
      imapPort: 993,
      label: envUser,
    });
  }

  // DB-stored accounts
  const rows = await db.select().from(emailAccounts).where(eq(emailAccounts.active, true));
  for (const row of rows) {
    // Skip if already covered by env var
    if (envUser && row.email.toLowerCase() === envUser.toLowerCase()) continue;
    accounts.push({
      email: row.email,
      password: row.password,
      authType: row.authType ?? "password",
      accessToken: row.accessToken,
      refreshToken: row.refreshToken,
      tokenExpiresAt: row.tokenExpiresAt,
      imapHost: row.imapHost ?? imapHostForProvider(row.provider),
      imapPort: row.imapPort ?? 993,
      label: row.label ?? row.email,
      dbId: row.id,
    });
  }

  return accounts;
}

// ── GET /api/gmail/status ─────────────────────────────────────────────────────

router.get("/gmail/status", async (req, res) => {
  try {
    const accounts = await getAccountsToSync();
    if (accounts.length === 0) {
      res.status(503).json({ connected: false, error: "No email accounts configured" });
      return;
    }

    const statuses = await Promise.allSettled(accounts.map(async (acct) => {
      const token = acct.authType === "oauth2" ? await getValidAccessToken(acct) : undefined;
      const client = createImapClientForAccount(acct, token);
      await client.connect();
      const status = await client.status("INBOX", { messages: true, unseen: true });
      await client.logout();
      return { email: acct.label, connected: true, messages: status.messages, unseen: status.unseen };
    }));

    const results = statuses.map((s, i) =>
      s.status === "fulfilled" ? s.value : { email: accounts[i].label, connected: false, error: String((s as PromiseRejectedResult).reason) }
    );

    res.json({ accounts: results, connected: results.some(r => r.connected) });
  } catch (err) {
    req.log.error({ err }, "Gmail status check failed");
    res.status(500).json({ connected: false, error: String(err) });
  }
});

// ── POST /api/gmail/sync ──────────────────────────────────────────────────────
// Syncs ALL active accounts (env-var + DB). Deduplicates by Message-ID so an
// email delivered to multiple monitored addresses only becomes one RFQ.

router.post("/gmail/sync", async (req, res) => {
  const { maxResults = 500, since } = req.body as {
    maxResults?: number;
    since?: string;
  };

  const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 60 * 1000);

  try {
    const accounts = await getAccountsToSync();

    if (accounts.length === 0) {
      res.status(503).json({ error: "No email accounts configured. Add an account first." });
      return;
    }

    let totalSynced = 0;
    let totalSkipped = 0;
    const allErrors: string[] = [];

    for (const acct of accounts) {
      const token = acct.authType === "oauth2" ? await getValidAccessToken(acct) : undefined;
      const client = createImapClientForAccount(acct, token);
      try {
        await client.connect();
        await client.mailboxOpen("INBOX");

        // Use IMAP server-side SEARCH to find UIDs since the cutoff date
        const matchingUids = await client.search({ since: sinceDate }, { uid: true });
        req.log.info({ account: acct.email, matchingUids: matchingUids.length, sinceDate: sinceDate.toISOString() }, "IMAP search");

        if (matchingUids.length === 0) {
          await client.logout();
          continue;
        }

        // Cap at maxResults (take the most recent ones = end of the array)
        const fetchUids = matchingUids.slice(-maxResults);

        let synced = 0;
        let skipped = 0;
        const errors: string[] = [];

        const port = process.env.PORT ?? "8080";

        for await (const msg of client.fetch(fetchUids, { envelope: true, source: true, internalDate: true }, { uid: true })) {
          try {

            if (!msg.source) { skipped++; continue; }
            const readable = Readable.from(msg.source);
            const parsed = await simpleParser(readable);

            const subject = parsed.subject ?? "(no subject)";
            const fromAddr = parsed.from?.value?.[0];
            const fromEmail = fromAddr?.address ?? "";
            const fromName = fromAddr?.name ?? fromEmail;
            const receivedAt = (parsed.date ?? new Date()).toISOString();
            const messageId = normaliseMessageId(parsed.messageId);
            const inReplyTo = normaliseMessageId(parsed.inReplyTo);
            const cc = parsed.cc?.value?.map((a: { address?: string }) => a.address).filter(Boolean).join(", ") || null;

            // ── Global UID: use Message-ID for cross-account dedup ──────────
            // Same email delivered to multiple monitored inboxes → same uid →
            // the ingest endpoint sees it already exists and skips it.
            const uid = messageId ? `mid:${messageId}` : `${acct.email.split("@")[0]}:${msg.uid}`;

            let body = parsed.text ?? "";
            if (!body && parsed.html) {
              body = parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
            }
            // Truncate to 15 000 chars — Claude only needs the relevant text
            if (body.length > 15000) body = body.slice(0, 15000);

            if (!fromEmail || !body.trim()) { skipped++; continue; }

            // ── Reply detection ──────────────────────────────────────────────
            if (inReplyTo) {
              const parentRows = await db
                .select({ emailId: emailsTable.id })
                .from(emailsTable)
                .where(eq(emailsTable.messageId, inReplyTo));

              if (parentRows.length) {
                const parentEmailId = parentRows[0].emailId;
                let rfqRows = await db
                  .select({ rfqId: rfqsTable.id })
                  .from(rfqsTable)
                  .where(eq(rfqsTable.emailId, parentEmailId));

                // If no direct RFQ match, the parent may be an outbound reply we sent.
                // Walk up one level via parentEmailId to find the original RFQ email.
                if (!rfqRows.length) {
                  const parentEmailRows = await db
                    .select({ parentEmailId: emailsTable.parentEmailId })
                    .from(emailsTable)
                    .where(eq(emailsTable.id, parentEmailId));
                  if (parentEmailRows.length && parentEmailRows[0].parentEmailId) {
                    rfqRows = await db
                      .select({ rfqId: rfqsTable.id })
                      .from(rfqsTable)
                      .where(eq(rfqsTable.emailId, parentEmailRows[0].parentEmailId));
                  }
                }

                if (rfqRows.length) {
                  const rfqId = rfqRows[0].rfqId;
                  const replyResp = await fetch(`http://localhost:${port}/api/rfqs/${rfqId}/ingest-reply`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ uid, fromName, fromEmail, body, receivedAt, messageId }),
                  });
                  if (replyResp.ok) {
                    const result = await replyResp.json() as { skipped?: boolean };
                    if (!result.skipped) synced++;
                    else skipped++;
                  } else {
                    const errText = await replyResp.text();
                    errors.push(`reply ${uid}: ${errText}`);
                  }
                  continue;
                }
              }
            }

            // ── Subject-based threading fallback ─────────────────────────────
            // Some mail clients omit the In-Reply-To header entirely.
            // If the subject starts with "Re:", try to match against existing
            // emails from the same sender by stripping all leading "Re:" prefixes.
            if (/^re:\s/i.test(subject)) {
              const baseSubject = subject.replace(/^(re:\s*)+/i, "").trim();
              const subjectMatchRows = await db
                .select({ emailId: emailsTable.id })
                .from(emailsTable)
                .where(
                  and(
                    eq(emailsTable.fromEmail, fromEmail),
                    sql`lower(${emailsTable.subject}) = lower(${baseSubject})`
                  )
                )
                .orderBy(desc(emailsTable.id))
                .limit(1);

              if (subjectMatchRows.length) {
                const matchedEmailId = subjectMatchRows[0].emailId;
                let rfqRows = await db
                  .select({ rfqId: rfqsTable.id })
                  .from(rfqsTable)
                  .where(eq(rfqsTable.emailId, matchedEmailId));

                // Also try walking up if the matched email is an outbound
                if (!rfqRows.length) {
                  const parentEmailRows = await db
                    .select({ parentEmailId: emailsTable.parentEmailId })
                    .from(emailsTable)
                    .where(eq(emailsTable.id, matchedEmailId));
                  if (parentEmailRows.length && parentEmailRows[0].parentEmailId) {
                    rfqRows = await db
                      .select({ rfqId: rfqsTable.id })
                      .from(rfqsTable)
                      .where(eq(rfqsTable.emailId, parentEmailRows[0].parentEmailId));
                  }
                }

                if (rfqRows.length) {
                  req.log.info({ uid, fromEmail, subject, baseSubject, rfqId: rfqRows[0].rfqId }, "Subject-match threading: routing as reply");
                  const rfqId = rfqRows[0].rfqId;
                  const replyResp = await fetch(`http://localhost:${port}/api/rfqs/${rfqId}/ingest-reply`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ uid, fromName, fromEmail, body, receivedAt, messageId }),
                  });
                  if (replyResp.ok) {
                    const result = await replyResp.json() as { skipped?: boolean };
                    if (!result.skipped) synced++;
                    else skipped++;
                  } else {
                    const errText = await replyResp.text();
                    errors.push(`reply (subject-match) ${uid}: ${errText}`);
                  }
                  continue;
                }
              }
            }

            // ── New email (not a reply) ──────────────────────────────────────
            const hasListUnsubscribe = !!parsed.headers?.get("list-unsubscribe");
            if (isAutomatedEmail(fromEmail, subject, hasListUnsubscribe)) { skipped++; continue; }

            const ingestResp = await fetch(`http://localhost:${port}/api/rfq/ingest`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                uid,
                fromName,
                fromEmail,
                subject,
                body,
                receivedAt,
                emailType: "customer-rfq",
                requireFreightMatch: true,
                messageId,
                cc,
                receivedInbox: acct.label,
              }),
            });

            if (ingestResp.status === 422) {
              skipped++;
            } else if (ingestResp.ok) {
              const wasNew = ingestResp.headers.get("x-was-new") === "true";
              if (wasNew) synced++;
              else skipped++;
            } else {
              const shortErr = ingestResp.status === 413
                ? `body too large (${uid})`
                : `ingest ${ingestResp.status} (${uid})`;
              errors.push(shortErr);
            }
          } catch (msgErr) {
            errors.push(`msg ${msg.uid}: ${String(msgErr).slice(0, 200)}`);
          }
        }

        await client.logout();

        // Mark last synced timestamp in DB (for DB accounts only)
        const dbRow = await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(eq(emailAccounts.email, acct.email));
        if (dbRow.length) {
          await db.update(emailAccounts)
            .set({ lastSyncedAt: new Date(), lastError: errors.length ? errors[0] : null })
            .where(eq(emailAccounts.id, dbRow[0].id));
        }

        totalSynced += synced;
        totalSkipped += skipped;
        allErrors.push(...errors);
      } catch (acctErr) {
        req.log.error({ err: acctErr, account: acct.email }, "IMAP sync failed for account");
        allErrors.push(`${acct.email}: ${String(acctErr)}`);

        // Record error in DB
        const dbRow = await db.select({ id: emailAccounts.id })
          .from(emailAccounts)
          .where(eq(emailAccounts.email, acct.email));
        if (dbRow.length) {
          await db.update(emailAccounts)
            .set({ lastError: String(acctErr) })
            .where(eq(emailAccounts.id, dbRow[0].id));
        }

        try { await client.logout(); } catch {}
      }
    }

    res.json({
      synced: totalSynced,
      skipped: totalSkipped,
      accountsChecked: accounts.length,
      errors: allErrors.length ? allErrors : undefined,
    });
  } catch (err) {
    req.log.error({ err }, "Gmail sync failed");
    res.status(500).json({ error: String(err) });
  }
});

// ── POST /api/gmail/send-outreach ─────────────────────────────────────────────
// Send a rate-request email to one or more partners

router.post("/gmail/send-outreach", async (req, res) => {
  const { recipients, subject, body } = req.body as {
    recipients: Array<{ name: string; email: string }>;
    subject: string;
    body: string;
  };

  if (!recipients?.length || !subject || !body) {
    res.status(400).json({ error: "recipients, subject, and body are required" });
    return;
  }

  const user = process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) {
    res.status(500).json({ error: "Gmail credentials not configured" });
    return;
  }

  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass },
  });

  const results: Array<{ email: string; ok: boolean; error?: string }> = [];

  for (const recipient of recipients) {
    try {
      await transporter.sendMail({
        from: `OnePort 365 Rates <${user}>`,
        to: `${recipient.name} <${recipient.email}>`,
        subject,
        text: body,
      });
      results.push({ email: recipient.email, ok: true });
    } catch (err) {
      req.log.error({ err, email: recipient.email }, "Failed to send outreach email");
      results.push({ email: recipient.email, ok: false, error: String(err) });
    }
  }

  const allOk = results.every(r => r.ok);
  res.status(allOk ? 200 : 207).json({ results });
});

export { router as gmailRouter };
