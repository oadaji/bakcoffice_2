import { Router, type IRouter } from "express";
import { db, ratesTable, partnersTable, rfqsTable, emailsTable } from "@workspace/db";
import { eq, and, ilike, or, inArray } from "drizzle-orm";
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

// Fuzzy match a stored pol/pod against a query string (case-insensitive keyword overlap)
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
      .select({
        rate: ratesTable,
        partner: partnersTable,
      })
      .from(ratesTable)
      .leftJoin(partnersTable, eq(ratesTable.partnerId, partnersTable.id));

    // Filter in JS for fuzzy location matching
    const matched = allRates.filter(({ rate }) => {
      const polMatch = !pol || locationsMatch(rate.pol, pol);
      const podMatch = !pod || locationsMatch(rate.pod, pod);
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
    const {
      pol, pod, containerType, commodity, freightRate, currency = "USD",
      carrier, validFrom, validTo, partnerId, notes, breakdown = {},
    } = req.body as {
      pol: string;
      pod: string;
      containerType?: string;
      commodity?: string;
      freightRate?: string;
      currency?: string;
      carrier?: string;
      validFrom?: string;
      validTo?: string;
      partnerId?: number;
      notes?: string;
      breakdown?: Record<string, unknown>;
    };
    if (!pol || !pod) {
      res.status(400).json({ error: "pol and pod are required" });
      return;
    }
    const [rate] = await db
      .insert(ratesTable)
      .values({
        pol,
        pod,
        containerType: containerType ?? null,
        commodity: commodity ?? null,
        freightRate: freightRate ?? null,
        currency,
        carrier: carrier ?? null,
        validFrom: validFrom ? new Date(validFrom) : null,
        validTo: validTo ? new Date(validTo) : null,
        partnerId: partnerId ?? null,
        notes: notes ?? null,
        breakdown,
      })
      .returning();
    res.status(201).json(rate);
  } catch (err) {
    req.log.error({ err }, "Failed to create rate");
    res.status(500).json({ error: "Failed to create rate" });
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

    // Extract key fields from the RFQ
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

    // Determine which partner categories are relevant
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

    // Fetch active partners
    const allPartners = await db
      .select()
      .from(partnersTable)
      .where(eq(partnersTable.active, true));

    // Filter by category overlap
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
