import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Readable } from "stream";
import { db, emailsTable, rfqsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

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
];

function isAutomatedEmail(fromEmail: string, subject: string, hasListUnsubscribe: boolean): boolean {
  if (hasListUnsubscribe) return true;
  if (AUTOMATED_ADDRESS_PATTERNS.some((p) => p.test(fromEmail))) return true;
  if (AUTOMATED_SUBJECT_PATTERNS.some((p) => p.test(subject))) return true;
  return false;
}

// ── IMAP client factory ───────────────────────────────────────────────────────

function createImapClient() {
  const user = process.env.GMAIL_ADDRESS;
  const pass = process.env.GMAIL_APP_PASSWORD;

  if (!user || !pass) {
    throw new Error("GMAIL_ADDRESS and GMAIL_APP_PASSWORD environment variables are required");
  }

  return new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user, pass },
    logger: false,
  });
}

// ── GET /api/gmail/status ─────────────────────────────────────────────────────

router.get("/gmail/status", async (req, res) => {
  const client = createImapClient();
  try {
    await client.connect();
    const status = await client.status("INBOX", { messages: true, unseen: true });
    await client.logout();
    res.json({
      connected: true,
      email: process.env.GMAIL_ADDRESS,
      messages: status.messages,
      unseen: status.unseen,
    });
  } catch (err) {
    req.log.error({ err }, "Gmail IMAP status check failed");
    res.status(500).json({ connected: false, error: String(err) });
  }
});

// ── POST /api/gmail/sync ──────────────────────────────────────────────────────

router.post("/gmail/sync", async (req, res) => {
  const { maxResults = 20, since } = req.body as {
    maxResults?: number;
    since?: string; // ISO date string — only fetch emails after this time
  };

  // Default: only fetch emails from the last 30 minutes if no since provided
  const sinceDate = since ? new Date(since) : new Date(Date.now() - 30 * 60 * 1000);

  const client = createImapClient();
  try {
    await client.connect();
    await client.mailboxOpen("INBOX");

    // Fetch the most recent N messages by sequence number
    // Server-side internalDate filter handles the precise time cutoff
    const status = await client.status("INBOX", { messages: true });
    const total = status.messages ?? 0;

    if (total === 0) {
      await client.logout();
      res.json({ synced: 0, skipped: 0, message: "Inbox is empty" });
      return;
    }

    const start = Math.max(1, total - maxResults + 1);
    const range = `${start}:${total}`;
    req.log.info({ total, start, range, sinceDate: sinceDate.toISOString() }, "IMAP fetch range");

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for await (const msg of client.fetch(range, { envelope: true, source: true, internalDate: true })) {
      try {
        // Server-side time filter — skip messages received before sinceDate
        const msgDate = msg.internalDate ?? msg.envelope.date ?? new Date(0);
        if (new Date(msgDate) < sinceDate) {
          skipped++;
          continue;
        }

        const uid = `gmail:${msg.envelope.messageId ?? msg.uid}`;

        // Parse the raw message
        const sourceBuffer = msg.source;
        const readable = Readable.from(sourceBuffer);
        const parsed = await simpleParser(readable);

        const subject = parsed.subject ?? "(no subject)";
        const fromAddr = parsed.from?.value?.[0];
        const fromEmail = fromAddr?.address ?? "";
        const fromName = fromAddr?.name ?? fromEmail;
        const receivedAt = (parsed.date ?? new Date()).toISOString();
        const messageId = normaliseMessageId(parsed.messageId);
        const inReplyTo = normaliseMessageId(parsed.inReplyTo);

        // Prefer plain text; fall back to stripping HTML
        let body = parsed.text ?? "";
        if (!body && parsed.html) {
          body = parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }

        if (!fromEmail || !body.trim()) {
          skipped++;
          continue;
        }

        const port = process.env.PORT ?? "8080";

        // ── Reply detection ──────────────────────────────────────────────────
        // If In-Reply-To matches a known email's messageId, route to thread ingest
        if (inReplyTo) {
          const parentRows = await db
            .select({ emailId: emailsTable.id })
            .from(emailsTable)
            .where(eq(emailsTable.messageId, inReplyTo));

          if (parentRows.length) {
            const parentEmailId = parentRows[0].emailId;
            const rfqRows = await db
              .select({ rfqId: rfqsTable.id })
              .from(rfqsTable)
              .where(eq(rfqsTable.emailId, parentEmailId));

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

        // ── New email (not a reply) ──────────────────────────────────────────
        // Skip automated/marketing emails — List-Unsubscribe header is a reliable signal
        const hasListUnsubscribe = !!parsed.headers?.get("list-unsubscribe");
        if (isAutomatedEmail(fromEmail, subject, hasListUnsubscribe)) {
          skipped++;
          continue;
        }

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
          }),
        });

        if (ingestResp.status === 422) {
          skipped++;
        } else if (ingestResp.ok) {
          const wasNew = ingestResp.headers.get("x-was-new") === "true";
          if (wasNew) synced++;
          else skipped++;
        } else {
          const errText = await ingestResp.text();
          errors.push(`${uid}: ${errText}`);
        }
      } catch (msgErr) {
        errors.push(`msg ${msg.uid}: ${String(msgErr)}`);
      }
    }

    await client.logout();
    res.json({ synced, skipped, errors: errors.length ? errors : undefined });
  } catch (err) {
    req.log.error({ err }, "Gmail IMAP sync failed");
    try { await client.logout(); } catch {}
    res.status(500).json({ error: String(err) });
  }
});

export { router as gmailRouter };
