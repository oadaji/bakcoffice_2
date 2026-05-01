import { Router, type IRouter } from "express";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { Readable } from "stream";

const router: IRouter = Router();

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

    // Search for messages received on or after sinceDate
    // IMAP SINCE uses date only (not time), so we use the date part
    const imapSince = new Date(sinceDate);
    imapSince.setHours(0, 0, 0, 0); // start of that day for IMAP SINCE

    const uids = await client.search({ since: imapSince }, { uid: true });

    if (!uids || uids.length === 0) {
      await client.logout();
      res.json({ synced: 0, skipped: 0, message: "No new messages since " + sinceDate.toISOString() });
      return;
    }

    // Take only the last N uids (most recent)
    const targetUids = uids.slice(-maxResults);
    const range = targetUids.join(",");

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    for await (const msg of client.fetch(range, { envelope: true, source: true, internalDate: true })) {
      try {
        // Server-side time filter — skip messages older than sinceDate (IMAP SINCE is date-only)
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

        // Prefer plain text; fall back to stripping HTML
        let body = parsed.text ?? "";
        if (!body && parsed.html) {
          body = parsed.html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        }

        if (!fromEmail || !body.trim()) {
          skipped++;
          continue;
        }

        // Call the ingest endpoint (handles dedup by uid + Claude extraction)
        const port = process.env.PORT ?? "8080";
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
          }),
        });

        if (ingestResp.ok) {
          const result = await ingestResp.json() as { email?: { id?: number } };
          // ingest returns existing record silently — check if it was already in DB
          // The ingest route upserts, so we check via a header or rely on uid dedup
          const wasNew = ingestResp.headers.get("x-was-new") === "true";
          if (wasNew) {
            synced++;
          } else {
            skipped++;
          }
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
