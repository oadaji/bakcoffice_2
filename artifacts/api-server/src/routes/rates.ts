import { Router, type IRouter } from "express";
import { db, ratesTable, partnersTable, rfqsTable, emailsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";

const router: IRouter = Router();

function createMailTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_ADDRESS,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
}

function locationsMatch(stored: string, query: string): boolean {
  if (!stored || !query) return false;
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
  const storedTokens = normalize(stored);
  const queryTokens = normalize(query);
  return queryTokens.some((qt) =>
    storedTokens.some((st) => st.startsWith(qt) || qt.startsWith(st))
  );
}

// GET /api/rates?pol=&pod=&container=
router.get("/rates", async (req, res) => {
  try {
    const { pol, pod, container } = req.query as {
      pol?: string;
      pod?: string;
      container?: string;
    };

    const allRates = await db
      .select({ rate: ratesTable, partner: partnersTable })
      .from(ratesTable)
      .leftJoin(partnersTable, eq(ratesTable.partnerId, partnersTable.id));

    const matched = allRates.filter(({ rate }) => {
      const polMatch = !pol || locationsMatch(rate.pol, pol) || (rate.originPortCode ? locationsMatch(rate.originPortCode, pol) : false);
      const podMatch = !pod || locationsMatch(rate.pod, pod) || (rate.destinationPortCode ? locationsMatch(rate.destinationPortCode, pod) : false);
      const containerMatch =
        !container ||
        !rate.containerType ||
        rate.containerType.toLowerCase().includes(container.toLowerCase());
      return polMatch && podMatch && containerMatch;
    });

    res.json(matched);
  } catch (err) {
    req.log.error({ err }, "Failed to search rates");
    res.status(500).json({ error: "Failed to search rates" });
  }
});

// POST /api/rates — add a rate record
router.post("/rates", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const pol = (b.pol as string | undefined)?.trim();
    const pod = (b.pod as string | undefined)?.trim();
    if (!pol || !pod) {
      res.status(400).json({ error: "pol and pod are required" });
      return;
    }
    const [rate] = await db
      .insert(ratesTable)
      .values({
        // Route
        originPortCode: (b.originPortCode as string) ?? null,
        destinationPortCode: (b.destinationPortCode as string) ?? null,
        pol,
        pod,
        // Carrier
        carrier: (b.carrier as string) ?? null,
        scac: (b.scac as string) ?? null,
        isAgentRate: Boolean(b.isAgentRate ?? false),
        // Classification
        cargoType: (b.cargoType as string) ?? null,
        rateType: (b.rateType as string) ?? null,
        inclusionType: (b.inclusionType as string) ?? null,
        commodityType: (b.commodityType as string) ?? null,
        commodityTypeField: (b.commodityTypeField as string) ?? null,
        // Charges
        charge20ft: (b.charge20ft as string) ?? null,
        charge40ft: (b.charge40ft as string) ?? null,
        charge40hc: (b.charge40hc as string) ?? null,
        // Legacy
        containerType: (b.containerType as string) ?? null,
        freightRate: (b.freightRate as string) ?? null,
        commodity: (b.commodity as string) ?? null,
        currency: (b.currency as string) ?? "USD",
        // Dates
        validFrom: b.validFrom ? new Date(b.validFrom as string) : null,
        validTo: b.validTo ? new Date(b.validTo as string) : null,
        sailingDate: b.sailingDate ? new Date(b.sailingDate as string) : null,
        // Days
        freeTime: b.freeTime ? Number(b.freeTime) : null,
        transitTime: b.transitTime ? Number(b.transitTime) : null,
        demurrageDays: b.demurrageDays ? Number(b.demurrageDays) : null,
        detentionDays: b.detentionDays ? Number(b.detentionDays) : null,
        // Market
        avgMarketRate20ft: (b.avgMarketRate20ft as string) ?? null,
        avgMarketRate40ft: (b.avgMarketRate40ft as string) ?? null,
        // Meta
        partnerId: b.partnerId ? Number(b.partnerId) : null,
        notes: (b.notes as string) ?? null,
        breakdown: (b.breakdown as Record<string, unknown>) ?? {},
      })
      .returning();
    res.status(201).json(rate);
  } catch (err) {
    req.log.error({ err }, "Failed to create rate");
    res.status(500).json({ error: "Failed to create rate" });
  }
});

// PUT /api/rates/:id — update a rate record
router.put("/rates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;

    const patch: Record<string, unknown> = {};
    const str = (k: string) => { if (b[k] !== undefined) patch[k] = (b[k] as string) ?? null; };
    const num = (k: string) => { if (b[k] !== undefined) patch[k] = b[k] ? Number(b[k]) : null; };
    const dt  = (k: string) => { if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k] as string) : null; };

    str("originPortCode"); str("destinationPortCode");
    str("pol"); str("pod");
    str("carrier"); str("scac");
    str("cargoType"); str("rateType"); str("inclusionType");
    str("commodityType"); str("commodityTypeField");
    str("charge20ft"); str("charge40ft"); str("charge40hc");
    str("containerType"); str("freightRate"); str("commodity"); str("currency");
    str("notes");
    str("avgMarketRate20ft"); str("avgMarketRate40ft");
    dt("validFrom"); dt("validTo"); dt("sailingDate");
    num("freeTime"); num("transitTime"); num("demurrageDays"); num("detentionDays");
    if (b.partnerId !== undefined) patch.partnerId = b.partnerId ? Number(b.partnerId) : null;
    if (b.isAgentRate !== undefined) patch.isAgentRate = Boolean(b.isAgentRate);
    if (b.breakdown !== undefined) patch.breakdown = b.breakdown as Record<string, unknown>;

    const updated = await db
      .update(ratesTable)
      .set(patch)
      .where(eq(ratesTable.id, id))
      .returning();

    if (!updated.length) {
      res.status(404).json({ error: "Rate not found" });
      return;
    }
    res.json(updated[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update rate");
    res.status(500).json({ error: "Failed to update rate" });
  }
});

// DELETE /api/rates/:id
router.delete("/rates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(ratesTable).where(eq(ratesTable.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete rate");
    res.status(500).json({ error: "Failed to delete rate" });
  }
});

// POST /api/rfqs/:id/request-rates — email relevant partners asking for a rate
router.post("/rfqs/:id/request-rates", async (req, res) => {
  try {
    const rfqId = parseInt(req.params.id, 10);

    const rows = await db
      .select()
      .from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, rfqId));

    if (!rows.length) {
      res.status(404).json({ error: "RFQ not found" });
      return;
    }
    const rfq = rows[0].rfqs;
    const email = rows[0].emails;

    const fields = (rfq.fields as Array<{ k: string; v: string; ok: boolean }>) ?? [];
    const getField = (key: string) =>
      fields.find((f) => f.k.toLowerCase() === key.toLowerCase())?.v ?? "";

    const pol = getField("POL");
    const pod = getField("POD");
    const container = getField("Container");
    const commodity = getField("Commodity");
    const customer = getField("Customer") || email?.fromName || "Customer";
    const incoterm = getField("Incoterm");
    const quantity = getField("Quantity");

    const relevantCategories: string[] = [];
    const containerLower = container.toLowerCase();
    if (containerLower.includes("lcl")) relevantCategories.push("LCL");
    else if (containerLower.includes("air") || pod.toLowerCase().includes("airport"))
      relevantCategories.push("AIR");
    else relevantCategories.push("FCL");
    if (commodity.toLowerCase().match(/reefer|frozen|chilled|perishable|fresh/))
      relevantCategories.push("REEFER");
    if (commodity.toLowerCase().match(/dangerous|hazardous|dg|class\s*\d/i))
      relevantCategories.push("DG");

    const allPartners = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.active, true));

    const targetPartners = allPartners.filter((p) => {
      const cats = (p.categories as string[]) ?? [];
      return (
        cats.length === 0 ||
        relevantCategories.some((rc) => cats.some((c) => c.toUpperCase() === rc))
      );
    });

    if (!targetPartners.length) {
      res.status(422).json({ error: "No active partners match this shipment type" });
      return;
    }

    const transporter = createMailTransporter();

    const emailBody = `Dear Partner,

We have received a freight enquiry and are requesting rates for the following shipment:

  Customer   : ${customer}
  POL        : ${pol}
  POD        : ${pod}
  Container  : ${container}
  Commodity  : ${commodity}
  Quantity   : ${quantity}
  Incoterm   : ${incoterm}
  RFQ Ref    : ${rfq.ref}

Please send us your best rates for this lane at your earliest convenience.

Thank you,
OnePort 365 Commercial Team
`;

    const results: { partner: string; email: string; sent: boolean; error?: string }[] = [];

    for (const partner of targetPartners) {
      try {
        await transporter.sendMail({
          from: `OnePort 365 Commercial Team <${process.env.GMAIL_ADDRESS}>`,
          to: partner.email,
          subject: `Rate Request: ${pol} → ${pod} | ${container} | ${rfq.ref}`,
          text: emailBody,
        });
        results.push({ partner: partner.name, email: partner.email, sent: true });
      } catch (err) {
        results.push({ partner: partner.name, email: partner.email, sent: false, error: String(err) });
      }
    }

    req.log.info({ rfqId, partners: results.length }, "Rate request emails sent");
    res.json({ sent: results.filter((r) => r.sent).length, results });
  } catch (err) {
    req.log.error({ err }, "Failed to send rate request");
    res.status(500).json({ error: "Failed to send rate request" });
  }
});

export { router as ratesRouter };
