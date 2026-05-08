import { Router, type IRouter } from "express";
import { db, emailsTable, rfqsTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";

const router: IRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function watiEndpoint(): string {
  return (process.env.WATI_API_ENDPOINT ?? "").replace(/\/$/, "");
}

function watiHeaders() {
  return {
    "Content-Type": "application/json",
    "api-token": process.env.WATI_API_KEY ?? "",
  };
}

// ── POST /api/wati/webhook ─────────────────────────────────────────────────────
// Receives incoming WhatsApp messages from WATI and routes them into the RFQ
// pipeline. Only text messages are processed; media attachments are ignored.

router.post("/wati/webhook", async (req, res) => {
  try {
    // Optional webhook token validation
    const webhookToken = process.env.WATI_WEBHOOK_TOKEN;
    if (webhookToken) {
      const provided =
        (req.headers["x-wati-token"] as string | undefined) ||
        (req.query["token"] as string | undefined);
      if (provided !== webhookToken) {
        res.status(401).json({ error: "Invalid webhook token" });
        return;
      }
    }

    // WATI sends one event per webhook call; the payload can vary slightly by version.
    // We support the two most common envelope shapes:
    //   Shape A: { waId, senderName, id, text: { body }, timestamp, type }  (direct)
    //   Shape B: { contacts: [{wa_id, profile:{name}}], messages: [{id, from, text:{body}, timestamp, type}] }
    const body = req.body as Record<string, unknown>;

    let waId: string | undefined;
    let senderName: string | undefined;
    let wamid: string | undefined;
    let textBody: string | undefined;
    let timestamp: string | undefined;
    let msgType: string | undefined;

    if (body.waId && body.id) {
      // Shape A
      waId = body.waId as string;
      senderName = (body.senderName as string | undefined) ?? waId;
      wamid = body.id as string;
      const textObj = body.text as { body?: string } | undefined;
      textBody = textObj?.body;
      timestamp = String(body.timestamp ?? "");
      msgType = (body.type as string | undefined) ?? "text";
    } else if (Array.isArray(body.messages) && body.messages.length > 0) {
      // Shape B (Meta / WATI v2 envelope)
      const msg = body.messages[0] as Record<string, unknown>;
      const contacts = Array.isArray(body.contacts) ? body.contacts : [];
      const contact = contacts[0] as { wa_id?: string; profile?: { name?: string } } | undefined;
      waId = (msg.from as string | undefined) ?? (contact?.wa_id as string | undefined);
      senderName = contact?.profile?.name ?? waId;
      wamid = msg.id as string;
      const textObj = msg.text as { body?: string } | undefined;
      textBody = textObj?.body;
      timestamp = String(msg.timestamp ?? "");
      msgType = (msg.type as string | undefined) ?? "text";
    }

    if (!waId || !wamid) {
      // Unknown payload — acknowledge but skip
      res.json({ ok: true, skipped: true, reason: "unrecognised_payload" });
      return;
    }

    // Only process text messages
    if (msgType !== "text" || !textBody?.trim()) {
      res.json({ ok: true, skipped: true, reason: "non_text_message" });
      return;
    }

    const uid = `wa:${wamid}`;
    const fromEmail = `${waId}@whatsapp`;
    const receivedAt = timestamp
      ? new Date(parseInt(timestamp, 10) * 1000).toISOString()
      : new Date().toISOString();

    const port = process.env.PORT ?? "8080";

    // ── Threading: find the most recent OPEN RFQ from this phone number ────────
    // "Open" = new | info_needed | ready | replied  (only "archived" is truly closed).
    // A customer WhatsApp reply after we've sent a follow-up (status=replied) must
    // continue the same RFQ thread — mirroring how email In-Reply-To threading works.
    // Only "archived" means the conversation is dismissed; start a new RFQ then.
    const OPEN_STATUSES = ["new", "info_needed", "ready", "replied"] as const;

    const existingEmails = await db
      .select({ id: emailsTable.id })
      .from(emailsTable)
      .where(and(
        eq(emailsTable.whatsappPhone, waId),
        eq(emailsTable.source, "whatsapp"),
      ))
      .orderBy(desc(emailsTable.id))
      .limit(10); // fetch a few in case most recent are orphaned

    if (existingEmails.length) {
      // Walk from newest to oldest, find the first RFQ that is still open
      let openRfqId: number | null = null;
      for (const em of existingEmails) {
        const rfqRows = await db
          .select({ rfqId: rfqsTable.id, status: rfqsTable.status })
          .from(rfqsTable)
          .where(eq(rfqsTable.emailId, em.id));

        const openRow = rfqRows.find(r =>
          (OPEN_STATUSES as readonly string[]).includes(r.status ?? "")
        );
        if (openRow) {
          openRfqId = openRow.rfqId;
          break;
        }
      }

      if (openRfqId !== null) {
        const rfqId = openRfqId;
        const replyResp = await fetch(`http://localhost:${port}/api/rfqs/${rfqId}/ingest-reply`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            uid,
            fromName: senderName,
            fromEmail,
            body: textBody,
            receivedAt,
            messageId: wamid,
            source: "whatsapp",
            whatsappPhone: waId,
          }),
        });
        if (replyResp.ok) {
          const result = await replyResp.json() as Record<string, unknown>;
          res.json({ ok: true, type: "reply", rfqId, ...result });
        } else {
          const errText = await replyResp.text();
          req.log.error({ rfqId, waId, err: errText }, "WATI reply ingest failed");
          res.status(500).json({ ok: false, error: errText });
        }
        return;
      }
      // No open RFQ found — fall through to create a new one
      req.log.info({ waId }, "WATI: existing RFQs all closed — treating as new enquiry");
    }

    // ── New contact: ingest as a new RFQ ───────────────────────────────────────
    const ingestResp = await fetch(`http://localhost:${port}/api/rfq/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        uid,
        fromName: senderName ?? waId,
        fromEmail,
        subject: `WhatsApp RFQ from ${senderName ?? waId}`,
        body: textBody,
        receivedAt,
        emailType: "customer-rfq",
        requireFreightMatch: true,
        messageId: wamid,
        source: "whatsapp",
        whatsappPhone: waId,
      }),
    });

    if (ingestResp.status === 422) {
      res.json({ ok: true, skipped: true, reason: "no_freight_fields" });
    } else if (ingestResp.ok) {
      const result = await ingestResp.json() as Record<string, unknown>;
      res.json({ ok: true, type: "new", ...result });
    } else {
      const errText = await ingestResp.text();
      req.log.error({ waId, err: errText }, "WATI ingest failed");
      res.status(500).json({ ok: false, error: errText });
    }
  } catch (err) {
    req.log.error({ err }, "WATI webhook handler error");
    res.status(500).json({ ok: false, error: String(err) });
  }
});

// ── GET /api/wati/status ───────────────────────────────────────────────────────
// Pings WATI contacts endpoint to confirm credentials are valid.

router.get("/wati/status", async (req, res) => {
  const endpoint = watiEndpoint();
  const apiKey = process.env.WATI_API_KEY;

  if (!endpoint || !apiKey) {
    res.json({ connected: false, error: "WATI_API_ENDPOINT or WATI_API_KEY not configured" });
    return;
  }

  try {
    const resp = await fetch(`${endpoint}/api/v1/getContacts?pageSize=1`, {
      headers: watiHeaders(),
    });

    if (resp.ok) {
      res.json({ connected: true });
    } else {
      const text = await resp.text();
      req.log.warn({ status: resp.status, body: text }, "WATI status check failed");
      res.json({ connected: false, error: `WATI returned ${resp.status}` });
    }
  } catch (err) {
    req.log.error({ err }, "WATI status check error");
    res.json({ connected: false, error: String(err) });
  }
});

// ── POST /api/wati/send ────────────────────────────────────────────────────────
// Sends a WhatsApp session message to a given phone number via WATI.
// Body: { phone: string, message: string }

router.post("/wati/send", async (req, res) => {
  const { phone, message } = req.body as { phone?: string; message?: string };

  if (!phone || !message?.trim()) {
    res.status(400).json({ error: "phone and message are required" });
    return;
  }

  const endpoint = watiEndpoint();
  const apiKey = process.env.WATI_API_KEY;

  if (!endpoint || !apiKey) {
    res.status(503).json({ error: "WATI_API_ENDPOINT or WATI_API_KEY not configured" });
    return;
  }

  try {
    const resp = await fetch(
      `${endpoint}/api/v1/sendSessionMessage/${encodeURIComponent(phone)}`,
      {
        method: "POST",
        headers: watiHeaders(),
        body: JSON.stringify({ messageText: message }),
      },
    );

    if (resp.ok) {
      const data = await resp.json() as Record<string, unknown>;
      req.log.info({ phone }, "WhatsApp message sent via WATI");
      res.json({ sent: true, ...data });
    } else {
      const text = await resp.text();
      req.log.error({ phone, status: resp.status, body: text }, "WATI send failed");
      res.status(502).json({ error: `WATI returned ${resp.status}: ${text}` });
    }
  } catch (err) {
    req.log.error({ err, phone }, "WATI send error");
    res.status(500).json({ error: String(err) });
  }
});

export { router as watiRouter };
