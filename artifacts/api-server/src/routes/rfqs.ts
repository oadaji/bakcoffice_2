import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { db, emailsTable, rfqsTable } from "@workspace/db";
import { eq, desc, or, inArray } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import nodemailer from "nodemailer";

function createMailTransporter() {
  return nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

const router: IRouter = Router();

// GET /api/rfqs — list all RFQs with their emails
router.get("/rfqs", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .orderBy(desc(emailsTable.receivedAt));

    const result = rows.map((r) => ({
      ...r.rfqs,
      email: r.emails,
    }));

    res.json(result);
  } catch (err) {
    req.log.error({ err }, "Failed to list RFQs");
    res.status(500).json({ error: "Failed to load RFQs" });
  }
});

// GET /api/rfqs/:id — single RFQ
router.get("/rfqs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, id));

    if (!rows.length) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }

    res.json({ ...rows[0].rfqs, email: rows[0].emails });
  } catch (err) {
    req.log.error({ err }, "Failed to get RFQ");
    res.status(500).json({ error: "Failed to get RFQ" });
  }
});

// PATCH /api/rfqs/:id — update status, draft, notes
router.patch("/rfqs/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { status, followUpDraft, notes } = req.body as {
      status?: string;
      followUpDraft?: string;
      notes?: string;
    };

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status !== undefined) updates.status = status;
    if (followUpDraft !== undefined) updates.followUpDraft = followUpDraft;
    if (notes !== undefined) updates.notes = notes;

    const [updated] = await db
      .update(rfqsTable)
      .set(updates)
      .where(eq(rfqsTable.id, id))
      .returning();

    if (!updated) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }

    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update RFQ");
    res.status(500).json({ error: "Failed to update RFQ" });
  }
});

// POST /api/rfqs/:id/send-followup — send the follow-up draft email to the customer
// For grouped RFQs (groupTotal > 1) one combined email is sent and all siblings are marked replied
router.post("/rfqs/:id/send-followup", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { draft } = req.body as { draft?: string };

    // Load the RFQ + its source email
    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, id));

    if (!rows.length || !rows[0].emails) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }

    const rfq = rows[0].rfqs;
    const email = rows[0].emails;
    const bodyText = draft ?? rfq.followUpDraft ?? "";

    if (!bodyText.trim()) {
      res.status(400).json({ error: "No draft text to send" });
      return;
    }

    if (!email.fromEmail) {
      res.status(400).json({ error: "No recipient email address on this RFQ" });
      return;
    }

    const transporter = createMailTransporter();
    await transporter.sendMail({
      from: `OnePort 365 Commercial Team <${process.env.GMAIL_ADDRESS}>`,
      to: email.fromEmail,
      subject: `Re: ${email.subject ?? "Your freight enquiry"}`,
      text: bodyText,
    });

    // For grouped RFQs, mark all siblings as replied with the same draft
    if (rfq.groupId && (rfq.groupTotal ?? 1) > 1) {
      const siblingRows = await db
        .select({ id: rfqsTable.id })
        .from(rfqsTable)
        .where(eq(rfqsTable.groupId, rfq.groupId));
      const siblingIds = siblingRows.map((r) => r.id);
      await db
        .update(rfqsTable)
        .set({ status: "replied", followUpDraft: bodyText, updatedAt: new Date() })
        .where(inArray(rfqsTable.id, siblingIds));
      req.log.info({ rfqId: id, groupId: rfq.groupId, siblingCount: siblingIds.length, to: email.fromEmail }, "Group follow-up email sent");
      res.json({ sent: true, groupId: rfq.groupId, siblingCount: siblingIds.length });
    } else {
      const [updated] = await db
        .update(rfqsTable)
        .set({ status: "replied", followUpDraft: bodyText, updatedAt: new Date() })
        .where(eq(rfqsTable.id, id))
        .returning();
      req.log.info({ rfqId: id, to: email.fromEmail }, "Follow-up email sent");
      res.json({ sent: true, rfq: updated });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to send follow-up email");
    res.status(500).json({ error: "Failed to send email" });
  }
});

// POST /api/rfqs/:id/ingest-reply — attach a customer reply to an existing RFQ thread
// Re-runs Claude on the full conversation and promotes status to "ready" if complete
router.post("/rfqs/:id/ingest-reply", async (req, res) => {
  try {
    const rfqId = parseInt(req.params.id, 10);
    const { uid, fromName, fromEmail, body, receivedAt, messageId } = req.body as {
      uid: string;
      fromName?: string;
      fromEmail: string;
      body: string;
      receivedAt?: string;
      messageId?: string;
    };

    // Load the parent RFQ + its source email
    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, rfqId));

    if (!rows.length || !rows[0].emails) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }

    const rfq = rows[0].rfqs;
    const parentEmail = rows[0].emails;

    // Dedup — skip if we already processed this reply uid
    const existing = await db
      .select({ id: emailsTable.id })
      .from(emailsTable)
      .where(eq(emailsTable.uid, uid));
    if (existing.length) {
      res.json({ skipped: true, rfq });
      return;
    }

    // Save the reply email linked to the parent
    await db.insert(emailsTable).values({
      uid,
      fromName: fromName || fromEmail,
      fromEmail,
      subject: `Re: ${parentEmail.subject}`,
      body,
      emailType: "reply",
      receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
      messageId: messageId ?? null,
      inReplyTo: parentEmail.messageId ?? null,
      parentEmailId: parentEmail.id,
    });

    // Build combined thread context for Claude
    // Fetch all replies so far to include the full conversation
    const replyRows = await db
      .select()
      .from(emailsTable)
      .where(eq(emailsTable.parentEmailId, parentEmail.id))
      .orderBy(emailsTable.receivedAt);

    const threadBody = [
      `ORIGINAL ENQUIRY (${parentEmail.fromName || parentEmail.fromEmail}):\n${parentEmail.body}`,
      ...replyRows.map((r, i) =>
        `CUSTOMER REPLY ${i + 1} (${r.fromName || r.fromEmail}, ${new Date(r.receivedAt).toLocaleDateString()}):\n${r.body}`
      ),
    ].join("\n\n──────────────\n\n");

    // Re-run Claude on the full thread — a reply always refines a single shipment
    const multiExtraction = await extractWithClaude(
      {
        fromName: parentEmail.fromName,
        fromEmail: parentEmail.fromEmail,
        subject: parentEmail.subject,
        body: threadBody,
      },
      rfq.emailType,
    );
    const extraction = multiExtraction.shipments[0];
    const replyDraft = extraction.missing.length
      ? (multiExtraction.combinedDraft ?? extraction.draft ?? null)
      : null;

    // Update the RFQ in place
    const [updated] = await db
      .update(rfqsTable)
      .set({
        status: extraction.status,
        fields: extraction.fields,
        missingFields: extraction.missing,
        followUpDraft: replyDraft,
        updatedAt: new Date(),
      })
      .where(eq(rfqsTable.id, rfqId))
      .returning();

    req.log.info({ rfqId, fromEmail, replyCount: replyRows.length }, "Reply ingested, RFQ updated");
    res.json({ rfq: updated, replyCount: replyRows.length });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest reply");
    res.status(500).json({ error: "Failed to ingest reply" });
  }
});

// GET /api/rfqs/:id/thread — return all emails in the thread (original + replies)
router.get("/rfqs/:id/thread", async (req, res) => {
  try {
    const rfqId = parseInt(req.params.id, 10);

    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, rfqId));

    if (!rows.length || !rows[0].emails) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }

    const parentEmail = rows[0].emails;
    const replies = await db
      .select()
      .from(emailsTable)
      .where(eq(emailsTable.parentEmailId, parentEmail.id))
      .orderBy(emailsTable.receivedAt);

    res.json({ original: parentEmail, replies });
  } catch (err) {
    req.log.error({ err }, "Failed to load thread");
    res.status(500).json({ error: "Failed to load thread" });
  }
});

// POST /api/rfq/ingest — save email + run Claude extraction + create/update RFQ
router.post("/rfq/ingest", async (req, res) => {
  try {
    const {
      uid,
      fromName,
      fromEmail,
      subject,
      body,
      receivedAt,
      emailType = "customer-rfq",
      requireFreightMatch = false,
      messageId,
    } = req.body as {
      uid: string;
      fromName: string;
      fromEmail: string;
      subject: string;
      body: string;
      receivedAt?: string;
      emailType?: string;
      requireFreightMatch?: boolean;
      messageId?: string;
    };

    if (!uid || !fromEmail || !subject || !body) {
      res.status(400).json({ error: "uid, fromEmail, subject, body required" });
      return;
    }

    // Check if email already exists by uid — skip Claude if so
    const existing = await db
      .select()
      .from(emailsTable)
      .where(eq(emailsTable.uid, uid));

    if (existing.length) {
      // Already ingested — return the existing RFQ without re-running Claude
      const existingRfq = await db
        .select()
        .from(rfqsTable)
        .where(eq(rfqsTable.emailId, existing[0].id));
      res.setHeader("x-was-new", "false");
      res.json({ ...(existingRfq[0] ?? {}), email: existing[0] });
      return;
    }

    // New email — insert it
    const [email] = await db
      .insert(emailsTable)
      .values({
        uid,
        fromName: fromName || fromEmail,
        fromEmail,
        subject,
        body,
        emailType,
        receivedAt: receivedAt ? new Date(receivedAt) : new Date(),
        messageId: messageId ?? null,
      })
      .returning();

    // Run Claude extraction — returns array of shipments (length ≥ 1)
    const multiExtraction = await extractWithClaude(
      { fromName, fromEmail, subject, body },
      emailType,
    );

    const { shipments, combinedDraft } = multiExtraction;

    // If requireFreightMatch is set, reject emails with no freight-specific fields extracted.
    // The key freight indicators are POL, POD, Commodity, Container, Incoterm, Quantity.
    // Customer and Company alone do not make an RFQ.
    if (requireFreightMatch) {
      const FREIGHT_KEYS = new Set(["POL", "POD", "Commodity", "Container", "Incoterm", "Quantity"]);
      const anyFreightField = shipments.some((s) =>
        s.fields.some((f) => FREIGHT_KEYS.has(f.k) && f.ok)
      );
      if (!anyFreightField) {
        await db.delete(emailsTable).where(eq(emailsTable.id, email.id));
        res.status(422).json({ rejected: true, reason: "no_freight_fields" });
        return;
      }
    }

    // Assign a shared groupId when there are multiple shipments
    const isGroup = shipments.length > 1;
    const groupId = isGroup ? randomUUID() : null;

    // Create one RFQ per detected shipment
    const createdRfqs = [];
    for (let idx = 0; idx < shipments.length; idx++) {
      const s = shipments[idx];
      const refNum = generateRef();
      // The combined follow-up draft goes on the first shipment only (it covers all)
      const rfqDraft = isGroup
        ? (idx === 0 ? combinedDraft ?? null : null)
        : (combinedDraft ?? s.draft ?? null);
      const [rfq] = await db
        .insert(rfqsTable)
        .values({
          emailId: email.id,
          ref: refNum,
          emailType,
          status: s.status,
          fields: s.fields,
          missingFields: s.missing,
          followUpDraft: rfqDraft,
          groupId,
          groupIndex: isGroup ? idx + 1 : null,
          groupTotal: isGroup ? shipments.length : null,
          sourceMessageId: messageId ?? null,
        })
        .returning();
      createdRfqs.push(rfq);
    }

    res.setHeader("x-was-new", "true");
    // Return first RFQ as the primary; include groupTotal so callers know about siblings
    res.json({ ...createdRfqs[0], email, groupTotal: shipments.length });
  } catch (err) {
    req.log.error({ err }, "Failed to ingest RFQ");
    res.status(500).json({ error: "Failed to ingest RFQ" });
  }
});

// POST /api/rfq/extract — extract fields from pasted email body (no persistence)
router.post("/rfq/extract", async (req, res) => {
  try {
    const { fromName, fromEmail, subject, body, emailType = "customer-rfq" } =
      req.body as {
        fromName?: string;
        fromEmail?: string;
        subject?: string;
        body: string;
        emailType?: string;
      };

    if (!body) {
      res.status(400).json({ error: "body is required" });
      return;
    }

    const extraction = await extractWithClaude(
      { fromName, fromEmail, subject, body },
      emailType,
    );
    res.json(extraction);
  } catch (err) {
    req.log.error({ err }, "Failed to extract RFQ");
    res.status(500).json({ error: "Failed to extract RFQ" });
  }
});

// POST /api/rfq/seed — insert demo data (idempotent)
router.post("/rfq/seed", async (req, res) => {
  try {
    const seeded = await seedDemoData();
    res.json({ ok: true, seeded });
  } catch (err) {
    req.log.error({ err }, "Failed to seed demo data");
    res.status(500).json({ error: "Failed to seed" });
  }
});

// ── helpers ─────────────────────────────────────────────────────────────────

function generateRef(): string {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(2);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 900) + 100);
  return `RFQ-${yy}${mm}-0${seq}`;
}

type SingleExtraction = {
  label: string;
  fields: Array<{ k: string; v: string; ok: boolean }>;
  missing: string[];
  draft: string | null;
  status: string;
};

type MultiExtraction = {
  shipments: SingleExtraction[];
  combinedDraft: string | null;
};

// extractWithClaude — detects multiple shipments in one email and returns an array.
// Single-shipment emails return a one-element array. combinedDraft covers all missing
// fields across all shipments in a single reply (so only one email is sent).
async function extractWithClaude(
  email: {
    fromName?: string;
    fromEmail?: string;
    subject?: string;
    body: string;
  },
  emailType: string,
): Promise<MultiExtraction> {
  const cleanBody = email.body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

  const prompt = `You are a freight operations assistant at OnePort 365, a Nigerian logistics company.
Analyze this email and extract shipment/RFQ details.

Email type: ${emailType}
From: ${email.fromName || ""} <${email.fromEmail || ""}>
Subject: ${email.subject || ""}
Body:
${cleanBody}

IMPORTANT: Detect whether the email contains MORE THAN ONE distinct shipment request.
Signals for multiple shipments: different commodities described separately, different origins/destinations, phrases like "also", "another one", "second item", "one more thing", customer asking about separate pricing, different quantities with different descriptions.

Return ONLY a JSON object with this exact structure — even for a single shipment:
{
  "shipments": [
    {
      "label": "<short commodity/route label e.g. 'Cashew nuts · Apapa → Jebel Ali'>",
      "fields": [
        {"k": "Customer", "v": "<name or 'not specified'>", "ok": true/false},
        {"k": "Company", "v": "<company or 'not specified'>", "ok": true/false},
        {"k": "POL", "v": "<port of loading with country code if known, or 'not specified'>", "ok": true/false},
        {"k": "POD", "v": "<port of discharge, or 'not specified'>", "ok": true/false},
        {"k": "Commodity", "v": "<cargo description, or 'not specified'>", "ok": true/false},
        {"k": "Container", "v": "<type × qty e.g. 20FT × 2, or 'not specified'>", "ok": true/false},
        {"k": "Cargo class", "v": "<GC or DG Class X.X, or 'not specified'>", "ok": true/false},
        {"k": "Incoterm", "v": "<FOB/EXW/CIF/DDP/etc or 'not specified'>", "ok": true/false},
        {"k": "Quantity", "v": "<container count or weight/volume, or 'not specified'>", "ok": true/false}
      ],
      "missing": ["<question to ask for missing field 1>", ...],
      "draft": null,
      "status": "info_needed" or "ready"
    }
  ],
  "combinedDraft": "<single follow-up email covering missing fields for ALL shipments, with clearly labelled sections per shipment if more than one. null if nothing is missing across all shipments.>"
}

Rules:
- ok=true if the value is actually specified in the email; ok=false if inferred or missing
- missing[] lists only truly missing critical fields (POL, POD, commodity, container type, incoterm)
- If all critical fields are present for a shipment, missing=[] and status="ready" for that shipment
- combinedDraft should be a warm, professional follow-up from "Commercial Team · OnePort 365"
- For multiple shipments, combinedDraft must use clearly labelled sections (e.g. "Re: Shipment 1 — Cashew nuts:")
- For rate-reply emails, extract partner details and rate info instead of customer RFQ fields
- Return ONLY the JSON object, no markdown, no explanation`;

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 2000,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  try {
    const cleaned = text
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();
    const parsed = JSON.parse(cleaned) as MultiExtraction;
    if (!Array.isArray(parsed.shipments) || parsed.shipments.length === 0) {
      throw new Error("No shipments array");
    }
    return parsed;
  } catch {
    // Fallback — treat as single shipment
    return {
      shipments: [{
        label: email.subject || "Shipment enquiry",
        fields: [{ k: "Raw response", v: text.slice(0, 200), ok: false }],
        missing: ["Could not parse extraction"],
        draft: null,
        status: "info_needed",
      }],
      combinedDraft: null,
    };
  }
}

async function seedDemoData(): Promise<number> {
  const DEMO_EMAILS = [
    {
      uid: "demo-grace-benson-2604",
      fromName: "Grace Benson | Bioscape Commodities Africa",
      fromEmail: "grace.benson@bioscapeafrica.com",
      subject: "FREIGHT RATE- AARHUS/ CATANIA/ MILAZZO",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-14T09:15:00Z"),
      body: "Dear Daniel,\n\nKindly share freight rate to the below destinations.\n\nProduct: PKC\nContainer: 40FT\nPOL: LAGOS\n\nPOD:\n  · CATANIA, ITALY\n  · MILAZZO, ITALY\n  · AARHUS, DENMARK\n\nRegards,\n\nGrace Benson Edet\nMobile: +234 8131353057\nBioscape Commodities Africa Limited\n118 Mulliner Towers, 39 Alfred Rewane Road, Ikoyi, Lagos",
      fields: [
        { k: "Customer", v: "Grace Benson Edet", ok: true },
        { k: "Company", v: "Bioscape Commodities Africa", ok: true },
        { k: "POL", v: "Lagos, Nigeria (NGAPP)", ok: true },
        { k: "POD", v: "Catania IT · Milazzo IT · Aarhus DK", ok: true },
        { k: "Commodity", v: "PKC (Palm Kernel Cake)", ok: true },
        { k: "Container", v: "40FT", ok: true },
        { k: "Cargo class", v: "GC — agricultural commodity", ok: true },
        { k: "Incoterm", v: "not specified", ok: false },
        { k: "Quantity", v: "not specified", ok: false },
      ],
      missing: [
        "Incoterm — FOB, EXW or CIF?",
        "Number of 40FT containers needed",
      ],
      draft:
        "Dear Grace,\n\nThank you for your enquiry.\nTo prepare rates for all three destinations we need:\n\n· Incoterm — FOB, EXW or CIF?\n· Number of 40FT containers\n\nPlease reply and we will revert with rates shortly.\n\nBest regards,\nCommercial Team · OnePort 365",
      status: "info_needed",
    },
    {
      uid: "demo-demir-guzel-2604",
      fromName: "Demir Güzel · Sarten Packaging A.Ş.",
      fromEmail: "demirguzel@sarten.com.tr",
      subject: "Sarten - DDP Price Quote Request",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-09T11:08:00Z"),
      body: "Hello Dear All,\n\nI received your contact information from our partners in Mitsui. As Sarten Packaging, we have some potential projects in Nigeria.\n\n1. Commodity type: Aerosol Can (HS Code: 73102191)\n2. Pickup address at origin: Ambarlı port, Istanbul\n3. Delivery address: 13-14 Abimbola Way, Isaga Tedo, Ikeja, Lagos State\n4. Service required: DDP including customs clearance in Nigeria\n5. Volume: Approx 1×20FT per month, possibly 2×20FT\n\nBest regards,\nDemir Güzel\nSarten Ambalaj A.Ş. · Istanbul",
      fields: [
        { k: "Customer", v: "Demir Güzel", ok: true },
        { k: "Company", v: "Sarten Packaging A.Ş.", ok: true },
        { k: "POL", v: "Ambarlı, Istanbul — Turkey", ok: true },
        { k: "POD", v: "Ikeja, Lagos (door delivery)", ok: true },
        {
          k: "Commodity",
          v: "Aerosol cans — empty (HS 73102191)",
          ok: true,
        },
        { k: "Container", v: "20FT × 1 (possibly × 2)", ok: true },
        { k: "Cargo class", v: "GC", ok: true },
        { k: "Incoterm", v: "DDP — door to door", ok: true },
        { k: "Quantity", v: "1–2 × 20FT monthly", ok: true },
      ],
      missing: [],
      draft: null,
      status: "ready",
    },
    {
      uid: "demo-kayode-eat-n-go-2604",
      fromName: "Kayode Akintade · OnePort 365 (Internal)",
      fromEmail: "Kayodea@oneport365.com",
      subject: "Eat n Go Quote Request",
      emailType: "internal-rfq",
      receivedAt: new Date("2026-04-10T15:02:00Z"),
      body: "Hello Daniel,\n\nPlease find attached and assist with D2D quote for 1×40FT.\n\nPOL: Hamburg\n\nAkintade Kayode\nSenior Strategic Partnership Lead\n+234 8056751616 · kayodea@oneport365.com",
      fields: [
        { k: "Requested by", v: "Kayode Akintade (Internal)", ok: true },
        { k: "Customer", v: "Eat n Go", ok: true },
        { k: "POL", v: "Hamburg, Germany", ok: true },
        { k: "POD", v: "not specified — check attachment", ok: false },
        { k: "Commodity", v: "not specified — see attachment", ok: false },
        { k: "Container", v: "40FT × 1", ok: true },
        { k: "Cargo class", v: "not specified", ok: false },
        { k: "Incoterm", v: "D2D (door to door)", ok: true },
      ],
      missing: [
        "POD — destination port or address",
        "Commodity type",
        "Cargo class (GC or DG?)",
      ],
      draft:
        "Dear Kayode,\n\nTo complete the D2D quote for Eat n Go we need:\n\n· POD — delivery address in Nigeria\n· Commodity / cargo description\n· Cargo class — GC or DG?\n\nPlease confirm so we can proceed.\n\nThanks,\nCommercial Team · OnePort 365",
      status: "info_needed",
    },
    {
      uid: "demo-may-zhao-oceanfavor-2603",
      fromName: "May Zhao (海外) · OceanFavor International Pte Ltd",
      fromEmail: "overseas@oceanfavor.com",
      subject: "Re: ONEPORT 365 ↔ ARC RIDE SHIPMENT",
      emailType: "rate-reply",
      receivedAt: new Date("2026-03-12T05:25:00Z"),
      body: "Dear Daniel,\n\nKindly check the attached quotation with local charges, haulage & telex fee included.\n\nWarm regards,\nMay\n\nZhao Jia (May Zhao)\nBusiness Manager | Overseas Dept.\nOceanfavor International Pte Ltd.\nTel/WhatsApp: +86 158 0121 5498",
      fields: [
        { k: "Partner", v: "OceanFavor International Pte Ltd", ok: true },
        { k: "Contact", v: "May Zhao (overseas@oceanfavor.com)", ok: true },
        { k: "Re: RFQ", v: "Arc Ride Shipment", ok: true },
        { k: "Attachment", v: "Quotation attached with local charges", ok: true },
        { k: "Includes", v: "Local charges + haulage + telex fee", ok: true },
        {
          k: "Status",
          v: "Rates received — review attachment",
          ok: true,
        },
      ],
      missing: [],
      draft: null,
      status: "ready",
    },
    {
      uid: "demo-summer-mo-jaylead-2603",
      fromName: "Summer Mo (莫浩微) · Jaylead Logistics",
      fromEmail: "summer@jaylead.com",
      subject: "回复：Freight requests: China to SAF/EAF/WAF",
      emailType: "rate-reply",
      receivedAt: new Date("2026-03-12T10:37:00Z"),
      body: "Dear Chinedu Enworom,\n\nPls check the total amount of USD. This is EXW price — B/L Telex release: USD 65. Container over 20T: +USD 10 per 1,000kg.\n\nMSDS cert expired Dec 2025, please provide 2026 cert before booking.\n\nSummer MO — 物流操作部\nJaylead Logistics",
      fields: [
        { k: "Partner", v: "Jaylead Logistics", ok: true },
        { k: "Contact", v: "Summer Mo (summer@jaylead.com)", ok: true },
        { k: "Pricing basis", v: "EXW", ok: true },
        { k: "B/L release", v: "USD 65", ok: true },
        { k: "Overweight", v: "+USD 10 per 1,000kg over 20T", ok: true },
        {
          k: "MSDS cert",
          v: "Expired Dec 2025 — 2026 cert required",
          ok: false,
        },
        { k: "Rates", v: "Approximate — no booking confirmed", ok: false },
      ],
      missing: ["MSDS certificate — 2026 version required before booking"],
      draft: null,
      status: "info_needed",
    },
    {
      uid: "demo-emeka-eze-royal-foam-2604",
      fromName: "Emeka Eze · Royal Foam Nigeria",
      fromEmail: "emeka.eze@royalfoamng.com",
      subject: "containers from china — polyol & isocyanate",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-08T14:10:00Z"),
      body: "Hi,\n\nGood day. We buy raw materials from China every quarter.\n\nSupplier: Yiwu Fuyang Chemical Co Ltd\nPOL: Qingdao (CNTAO)\nPOD: Apapa (NGAPP), Lagos\nContainer: 20FT × 9\nIncoterm: CIF\nReady: 28 April 2026\n\nThe materials are polyol and isocyanate — class 6.1 dangerous goods, MSDS available.\n\nRegards,\nEmeka Eze · Procurement Manager, Royal Foam Nigeria",
      fields: [
        { k: "Customer", v: "Emeka Eze", ok: true },
        { k: "Company", v: "Royal Foam Nigeria", ok: true },
        { k: "POL", v: "Qingdao (CNTAO), China", ok: true },
        { k: "POD", v: "Apapa (NGAPP), Nigeria", ok: true },
        {
          k: "Commodity",
          v: "Polyol & Isocyanate — foam raw materials",
          ok: true,
        },
        { k: "Container", v: "20FT × 9", ok: true },
        { k: "Cargo class", v: "DG Class 6.1 ⚠ MSDS available", ok: true },
        { k: "Incoterm", v: "CIF", ok: true },
        { k: "Ready date", v: "28 April 2026", ok: true },
      ],
      missing: [],
      draft: null,
      status: "ready",
    },
    {
      uid: "demo-tunde-fashola-dankuru-2604",
      fromName: "Tunde Fashola · Dankuru Industries Ltd",
      fromEmail: "tunde.fashola@dankuru.com.ng",
      subject: "Fwd: Fwd: RE: shipment — ceramic tiles",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-07T09:47:00Z"),
      body: "Good morning sir,\n\nPlease I want to know the cost of shipping my goods from china. The goods is ceramic tiles, i have about 2 trucks worth. They are currently at the factory in foshan, guangdong province. I want to bring them to my warehouse in lagos island.\n\nI think i need a 40ft container but the tiles are about 18,000 pieces.\n\nTunde Fashola\nDankuru Industries Ltd · 08033451209",
      fields: [
        { k: "Customer", v: "Tunde Fashola", ok: true },
        { k: "Company", v: "Dankuru Industries Ltd", ok: true },
        { k: "POL", v: "Foshan, Guangdong — China", ok: true },
        { k: "POD", v: "Lagos Island, Nigeria", ok: true },
        { k: "Commodity", v: "Ceramic tiles (~18,000 pieces)", ok: true },
        { k: "Container", v: "40FT — quantity unconfirmed", ok: false },
        { k: "Cargo class", v: "GC", ok: true },
        { k: "Incoterm", v: "FOB (customer unsure)", ok: false },
        {
          k: "Loading port",
          v: "Foshan — confirm Guangzhou or Nansha",
          ok: false,
        },
      ],
      missing: [
        "Exact container quantity — 1 or 2 × 40FT?",
        "Confirm incoterm — FOB, EXW or CIF?",
        "Nearest loading port to Foshan factory",
      ],
      draft:
        "Dear Tunde,\n\nThank you for your enquiry.\nTo prepare your quote we need:\n\n· How many 40FT containers?\n· Incoterm — FOB, EXW or CIF?\n· Loading port — Guangzhou (CNCAN) or Nansha (CNNSN)?\n\nPlease reply and we will come back with rates.\n\nBest regards,\nCommercial Team · OnePort 365",
      status: "info_needed",
    },
    {
      uid: "demo-chinwe-obi-2604",
      fromName: "Chinwe Obi",
      fromEmail: "chinwe.obi22@gmail.com",
      subject: "hello pls I need shipping price",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-05T09:11:00Z"),
      body: "Good afternoon,\n\nMy name is Chinwe, i got your number from my friend Adaeze. I want to ship some things from the UK to Nigeria. I have been buying fairly used children clothes and shoes from charity shops here in london for about 6 months now.\n\nI dont know anything about shipping please guide me. My sister in lagos will receive the goods at her shop in alaba international market.\n\nChinwe\n+447823109456",
      fields: [
        { k: "Customer", v: "Chinwe Obi", ok: true },
        { k: "Phone", v: "+447823109456", ok: true },
        { k: "POL", v: "London, UK", ok: true },
        { k: "POD", v: "Alaba Intl Market, Lagos", ok: true },
        { k: "Commodity", v: "Used clothing & shoes (charity)", ok: true },
        { k: "Container", v: "LCL — volume unknown", ok: false },
        { k: "Cargo class", v: "GC", ok: true },
        { k: "Incoterm", v: "not specified", ok: false },
        { k: "Volume", v: "not specified — \"bags of goods\"", ok: false },
      ],
      missing: [
        "Approx volume or weight (CBM or kg)",
        "Pickup address in London",
        "Service type — LCL or groupage?",
      ],
      draft:
        "Dear Chinwe,\n\nThank you for reaching out!\nTo give you an accurate price:\n\n· Approx volume or weight of goods (cubic metres or kg)\n· Your collection address in London\n\nWe will guide you through the full process from pickup to delivery at Alaba market.\n\nBest regards,\nCommercial Team · OnePort 365",
      status: "info_needed",
    },
    {
      uid: "demo-adaeze-nwosu-sesame-2604",
      fromName: "Adaeze Nwosu · Nwosu Agro Commodities",
      fromEmail: "adaeze.nwosu@nwosuagro.com.ng",
      subject: "Export rates — sesame seeds to Rotterdam",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-04T11:32:00Z"),
      body: "Dear Commercial Team,\n\nWe are an agricultural export company based in Kano, Nigeria.\n\nCommodity: Sesame seeds (cleaned, hulled) — HS code 12074010\nPOL: Lagos (Apapa)\nPOD: Rotterdam, Netherlands\nContainer: 20FT × 4\nIncoterm: FOB\nCargo class: GC — food grade, non-hazardous\nCargo ready: First week of May 2026\nWeight: approx 24 MT per container\n\nWe ship quarterly so a good rate could lead to a long-term relationship.\n\nBest regards,\nAdaeze Nwosu · Director, Nwosu Agro Commodities · +234 802 441 7890",
      fields: [
        { k: "Customer", v: "Adaeze Nwosu", ok: true },
        { k: "Company", v: "Nwosu Agro Commodities", ok: true },
        { k: "POL", v: "Lagos (Apapa), Nigeria", ok: true },
        { k: "POD", v: "Rotterdam, Netherlands", ok: true },
        {
          k: "Commodity",
          v: "Sesame seeds — hulled (HS 12074010)",
          ok: true,
        },
        { k: "Container", v: "20FT × 4", ok: true },
        { k: "Cargo class", v: "GC — food grade", ok: true },
        { k: "Incoterm", v: "FOB", ok: true },
        { k: "Ready date", v: "First week of May 2026", ok: true },
      ],
      missing: [],
      draft: null,
      status: "ready",
    },
    {
      uid: "demo-moses-dafiaghor-saro-2604",
      fromName: "Moses Dafiaghor · Saro Agro Sciences",
      fromEmail: "moses.dafiaghor@saroafrica.com",
      subject: "Import shipment request — Ningbo to Apapa",
      emailType: "customer-rfq",
      receivedAt: new Date("2026-04-02T08:44:00Z"),
      body: "Dear Team,\n\nWe need ocean freight rates for the below import shipment.\n\nCommodity: In Packings (Net Weight ≤ 300g) — agrochemical products\nPOL: Ningbo (CNNGB), China\nPOD: Apapa (NGAPP), Nigeria\nContainer: 20FT × 1\nIncoterm: FOB\nCargo class: GC\n\nPlease advise on rates, transit time, free days at destination, and local charges at Apapa. This is a repeat shipment.\n\nKind regards,\nMoses Dafiaghor · Logistics Manager, Saro Agro Sciences",
      fields: [
        { k: "Customer", v: "Moses Dafiaghor", ok: true },
        { k: "Company", v: "Saro Agro Sciences", ok: true },
        { k: "POL", v: "Ningbo (CNNGB), China", ok: true },
        { k: "POD", v: "Apapa (NGAPP), Nigeria", ok: true },
        {
          k: "Commodity",
          v: "In Packings ≤300g — agrochemicals",
          ok: true,
        },
        { k: "Container", v: "20FT × 1", ok: true },
        { k: "Cargo class", v: "GC", ok: true },
        { k: "Incoterm", v: "FOB", ok: true },
        {
          k: "Note",
          v: "Repeat shipment — previous OnePort customer",
          ok: true,
        },
      ],
      missing: [],
      draft: null,
      status: "ready",
    },
  ];

  let count = 0;

  for (const demo of DEMO_EMAILS) {
    const existing = await db
      .select()
      .from(emailsTable)
      .where(eq(emailsTable.uid, demo.uid));

    if (existing.length) continue;

    const [email] = await db
      .insert(emailsTable)
      .values({
        uid: demo.uid,
        fromName: demo.fromName,
        fromEmail: demo.fromEmail,
        subject: demo.subject,
        body: demo.body,
        emailType: demo.emailType,
        receivedAt: demo.receivedAt,
      })
      .returning();

    const refNum = generateRef();
    await db.insert(rfqsTable).values({
      emailId: email.id,
      ref: refNum,
      emailType: demo.emailType,
      status: demo.status,
      fields: demo.fields,
      missingFields: demo.missing,
      followUpDraft: demo.draft,
    });

    count++;
  }

  return count;
}

export default router;
