import { Router, type IRouter } from "express";
import { ReplitConnectors } from "@replit/connectors-sdk";
import { db, emailsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();
const connectors = new ReplitConnectors();

// ── helpers ──────────────────────────────────────────────────────────────────

function decodeBase64Url(str: string): string {
  const base64 = str.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf-8");
}

function getHeader(headers: { name: string; value: string }[], name: string): string {
  return headers.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractBody(payload: GmailPayload): string {
  // text/plain preferred, fallback to text/html parts
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.mimeType === "text/html" && payload.body?.data) {
    // strip HTML tags for plain text storage
    return decodeBase64Url(payload.body.data).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  }
  if (payload.parts) {
    // prefer text/plain part
    const plain = payload.parts.find((p) => p.mimeType === "text/plain");
    if (plain) return extractBody(plain);
    // fallback: first part
    for (const part of payload.parts) {
      const text = extractBody(part);
      if (text) return text;
    }
  }
  return "";
}

function parseFrom(from: string): { name: string; email: string } {
  // "Display Name <email@example.com>" or "email@example.com"
  const match = from.match(/^(.*?)\s*<([^>]+)>$/);
  if (match) {
    return { name: match[1].trim().replace(/^"|"$/g, ""), email: match[2].trim() };
  }
  return { name: from.trim(), email: from.trim() };
}

interface GmailPayload {
  mimeType?: string;
  body?: { data?: string };
  parts?: GmailPayload[];
  headers?: { name: string; value: string }[];
}

interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPayload;
}

// ── GET /api/gmail/status — check connection is live ─────────────────────────
router.get("/gmail/status", async (req, res) => {
  try {
    const resp = await connectors.proxy("google-mail", "/gmail/v1/users/me/profile");
    const profile = await resp.json() as { emailAddress?: string; messagesTotal?: number };
    res.json({ connected: true, email: profile.emailAddress, total: profile.messagesTotal });
  } catch (err) {
    req.log.error({ err }, "Gmail status check failed");
    res.status(500).json({ connected: false, error: "Gmail connection failed" });
  }
});

// ── POST /api/gmail/sync — pull recent inbox emails and ingest new ones ───────
router.post("/gmail/sync", async (req, res) => {
  try {
    const { maxResults = 20, query = "in:inbox" } = req.body as {
      maxResults?: number;
      query?: string;
    };

    // 1. List recent messages
    const listResp = await connectors.proxy(
      "google-mail",
      `/gmail/v1/users/me/messages?maxResults=${maxResults}&q=${encodeURIComponent(query)}`,
    );
    const listData = await listResp.json() as { messages?: { id: string }[]; error?: unknown };
    req.log.info({ listStatus: listResp.status, listData }, "Gmail list response");
    const messageIds = listData.messages ?? [];

    if (!messageIds.length) {
      res.json({ synced: 0, skipped: 0, message: "No messages found" });
      return;
    }

    let synced = 0;
    let skipped = 0;
    const errors: string[] = [];

    // 2. For each message, fetch full content and ingest
    for (const { id } of messageIds) {
      try {
        // Check if already in DB by gmail message id (used as uid)
        const existing = await db
          .select()
          .from(emailsTable)
          .where(eq(emailsTable.uid, `gmail:${id}`));

        if (existing.length) {
          skipped++;
          continue;
        }

        // Fetch full message
        const msgResp = await connectors.proxy(
          "google-mail",
          `/gmail/v1/users/me/messages/${id}?format=full`,
        );
        const msg = await msgResp.json() as GmailMessage;

        if (!msg.payload) {
          skipped++;
          continue;
        }

        const headers = msg.payload.headers ?? [];
        const subject = getHeader(headers, "subject") || "(no subject)";
        const fromRaw = getHeader(headers, "from");
        const dateStr = getHeader(headers, "date");
        const { name: fromName, email: fromEmail } = parseFrom(fromRaw);
        const body = extractBody(msg.payload);

        if (!body.trim()) {
          skipped++;
          continue;
        }

        const receivedAt = dateStr ? new Date(dateStr).toISOString() : new Date().toISOString();

        // Call our own ingest endpoint so Claude extraction + DB save runs
        const ingestResp = await fetch(
          `http://localhost:${process.env.PORT ?? 8080}/api/rfq/ingest`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              uid: `gmail:${id}`,
              fromName,
              fromEmail,
              subject,
              body,
              receivedAt,
              emailType: "customer-rfq",
            }),
          },
        );

        if (ingestResp.ok) {
          synced++;
        } else {
          const err = await ingestResp.text();
          errors.push(`${id}: ${err}`);
        }
      } catch (err) {
        errors.push(`${id}: ${String(err)}`);
      }
    }

    res.json({ synced, skipped, errors: errors.length ? errors : undefined });
  } catch (err) {
    req.log.error({ err }, "Gmail sync failed");
    res.status(500).json({ error: "Gmail sync failed" });
  }
});

export { router as gmailRouter };
