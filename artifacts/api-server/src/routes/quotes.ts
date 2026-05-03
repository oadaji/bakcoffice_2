import { Router, type IRouter } from "express";
import { db, rfqsTable, quotesTable, oceanFreightRates, haulageImportRates, haulageExportRates, otherCharges } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { anthropic } from "@workspace/integrations-anthropic-ai";

const router: IRouter = Router();

function generateQuoteRef(): string {
  const now = new Date();
  const yymm = String(now.getFullYear()).slice(2) + String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 9000) + 1000);
  return `QUOTE-${yymm}-${rand}`;
}

function fieldVal(fields: unknown[], key: string): string {
  if (!Array.isArray(fields)) return "";
  const f = fields.find((x: any) => typeof x?.k === "string" && x.k.toLowerCase().includes(key.toLowerCase()));
  return (f as any)?.v ?? "";
}

function isNigeriaPort(code: string): boolean {
  return code?.startsWith("NG") ?? false;
}

// GET /quotes
router.get("/quotes", async (req, res) => {
  try {
    const rows = await db.select().from(quotesTable).orderBy(desc(quotesTable.createdAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list quotes");
    res.status(500).json({ error: "Failed to list quotes" });
  }
});

// POST /quotes/generate — AI-powered quote generation (MUST be before /:id routes)
router.post("/quotes/generate", async (req, res) => {
  try {
    const { rfqId, marginPct = 13, exchangeRate = 1600, save = true } = req.body as {
      rfqId: number; marginPct?: number; exchangeRate?: number; save?: boolean;
    };

    if (!rfqId) { res.status(400).json({ error: "rfqId is required" }); return; }

    // 1. Load RFQ
    const [rfq] = await db.select().from(rfqsTable).where(eq(rfqsTable.id, rfqId));
    if (!rfq) { res.status(404).json({ error: "RFQ not found" }); return; }

    const fields: any[] = Array.isArray(rfq.fields) ? rfq.fields : [];

    const polCode = fieldVal(fields, "POL") || fieldVal(fields, "origin port");
    const podCode = fieldVal(fields, "POD") || fieldVal(fields, "destination port");
    const commodity = fieldVal(fields, "commodity") || fieldVal(fields, "cargo");
    const rawContainer = fieldVal(fields, "container") || fieldVal(fields, "equipment");
    const qtyStr = fieldVal(fields, "quantity") || fieldVal(fields, "qty") || "1";
    const customerName = fieldVal(fields, "shipper") || fieldVal(fields, "consignee") || fieldVal(fields, "customer") || "";
    const companyName = fieldVal(fields, "company") || "";
    const customerEmail = rfq.fields ? (fields.find((f: any) => f?.k?.toLowerCase().includes("email"))?.v ?? "") : "";

    // Normalize container type
    const containerType = rawContainer.toUpperCase().includes("40HC") ? "40HC"
      : rawContainer.toUpperCase().includes("40") ? "40FT" : "20FT";
    const containerQty = Math.max(1, parseInt(qtyStr) || 1);

    // 2. Determine shipment direction
    const isImportToNigeria = isNigeriaPort(podCode);
    const isExportFromNigeria = isNigeriaPort(polCode);
    const shipmentDir = isImportToNigeria ? "import" : isExportFromNigeria ? "export" : "both";

    // 3. Fetch matching ocean freight rates (POL/POD match with fuzzy)
    const allOcean = await db.select().from(oceanFreightRates)
      .where(and(eq(oceanFreightRates.archived, false)));
    const polUpper = polCode.toUpperCase().slice(0, 5);
    const podUpper = podCode.toUpperCase().slice(0, 5);
    const matchedOcean = allOcean.filter(r => {
      const polMatch = r.polCode?.toUpperCase().includes(polUpper) || polUpper.includes(r.polCode?.toUpperCase().slice(0, 3));
      const podMatch = r.podCode?.toUpperCase().includes(podUpper) || podUpper.includes(r.podCode?.toUpperCase().slice(0, 3));
      return polMatch && podMatch;
    });
    // Fallback: partial match on first 3 chars
    const oceanPool = matchedOcean.length > 0 ? matchedOcean : allOcean.filter(r => {
      return r.polCode?.toUpperCase().startsWith(polUpper.slice(0, 2))
        || r.podCode?.toUpperCase().startsWith(podUpper.slice(0, 2));
    }).slice(0, 10);

    // 4. Fetch applicable other charges
    const allOther = await db.select().from(otherCharges)
      .where(and(eq(otherCharges.archived, false)));
    const applicableCharges = allOther.filter(c => {
      const sType = c.shipmentType?.toLowerCase();
      return sType === "both" || sType === shipmentDir || sType === "import" || sType === "export";
    });

    // 5. Fetch haulage rates if applicable
    let haulagePool: any[] = [];
    if (isImportToNigeria) {
      haulagePool = await db.select().from(haulageImportRates)
        .where(and(eq(haulageImportRates.archived, false),
          eq(haulageImportRates.portCode, podUpper)));
    } else if (isExportFromNigeria) {
      haulagePool = await db.select().from(haulageExportRates)
        .where(and(eq(haulageExportRates.archived, false),
          eq(haulageExportRates.portCode, polUpper)));
    }

    // 6. Call Claude to build the quote
    const prompt = `You are a freight quoting assistant for OnePort 365, a Nigerian freight forwarding company.

Given the following RFQ and available rates, build a complete freight quote.

RFQ Details:
- RFQ Ref: ${rfq.ref}
- POL Code: ${polCode}
- POD Code: ${podCode}
- Commodity: ${commodity || "General Cargo"}
- Container Type: ${containerType}
- Container Qty: ${containerQty}
- Customer: ${customerName || "Unknown"}
- Company: ${companyName || "Unknown"}
- Shipment Direction: ${shipmentDir}
- Raw Fields: ${JSON.stringify(fields.slice(0, 20))}

Available Ocean Freight Rates (${oceanPool.length} options):
${JSON.stringify(oceanPool.slice(0, 15), null, 2)}

Available Other Charges (${applicableCharges.length} items):
${JSON.stringify(applicableCharges.slice(0, 30), null, 2)}

Available Haulage Rates (${haulagePool.length} options):
${JSON.stringify(haulagePool.slice(0, 10), null, 2)}

Instructions:
1. Select the BEST ocean freight rate from the available options. Pick the most appropriate rate matching the container type (${containerType}). If none match exactly, pick the closest.
2. Select relevant other charges for this shipment type (${shipmentDir}). Include core charges like Agency Clearance Fee, THC, Shipping Line Charges, Form M/Documentation etc. for import. For export include export doc fee, THC, NXP form etc.
3. If haulage rates are available AND the RFQ mentions inland delivery or no specific port pickup, include haulage. Set hasSuggestedHaulage=true.
4. Mark asPerReceipt charges clearly.
5. Use exchange rate ${exchangeRate} NGN/USD for cost calculations.

Respond with ONLY valid JSON in this exact format:
{
  "selectedOceanRateId": <id or null>,
  "carrier": "<carrier name>",
  "oceanAmount": <number in USD>,
  "oceanCurrency": "USD",
  "transitTime": "<e.g. 22 days>",
  "freeTime": "<e.g. 14 days>",
  "polLabel": "<e.g. Apapa (NGAPP) Nigeria>",
  "podLabel": "<e.g. Rotterdam (NLRTM) Netherlands>",
  "originCharges": [
    {"id": <id or null>, "itemName": "<name>", "amount": <number or null>, "currency": "NGN", "asPerReceipt": <bool>, "category": "<category>", "basis": "<Per Container|Per BL|Per Shipment>"}
  ],
  "destCharges": [],
  "selectedHaulageRateId": <id or null>,
  "hasSuggestedHaulage": <bool>,
  "haulageTerminal": "<terminal name or null>",
  "haulageDestCity": "<city or null>",
  "haulageAmount": <number or null>,
  "haulageCurrency": "NGN",
  "notes": "<brief reasoning>",
  "marginPct": ${marginPct},
  "exchangeRate": ${exchangeRate}
}`;

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const rawText = (message.content[0] as any).text ?? "";
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      res.status(500).json({ error: "Claude returned invalid JSON", raw: rawText });
      return;
    }
    const ai = JSON.parse(jsonMatch[0]);

    // 7. Build quote data
    const selectedOcean = oceanPool.find(r => r.id === ai.selectedOceanRateId) ?? oceanPool[0];
    const oceanAmount = ai.oceanAmount ?? (selectedOcean
      ? Number(containerType === "20FT" ? selectedOcean.amount20ft
        : containerType === "40FT" ? selectedOcean.amount40ft
        : selectedOcean.amount40hc) || 0
      : 0);

    const haulageRate = haulagePool.find(r => r.id === ai.selectedHaulageRateId) ?? null;
    const haulageObj = (haulageRate || ai.selectedHaulageRateId) ? {
      rateId: haulageRate?.id ?? ai.selectedHaulageRateId,
      terminalName: ai.haulageTerminal ?? haulageRate?.terminalName,
      portCode: haulageRate?.portCode ?? podUpper,
      destCity: ai.haulageDestCity ?? haulageRate?.destCity ?? haulageRate?.destLga,
      amount: ai.haulageAmount ?? Number(haulageRate?.price) ?? 0,
      currency: ai.haulageCurrency ?? "NGN",
    } : null;

    const originChargesRaw: any[] = Array.isArray(ai.originCharges) ? ai.originCharges : [];
    const destChargesRaw: any[] = Array.isArray(ai.destCharges) ? ai.destCharges : [];

    // Calculate totals
    const fx = Number(exchangeRate) || 1600;
    const originNGN = originChargesRaw.filter(c => !c.asPerReceipt && c.currency === "NGN")
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const originUSD = originChargesRaw.filter(c => !c.asPerReceipt && c.currency === "USD")
      .reduce((s, c) => s + (Number(c.amount) || 0), 0);
    const haulageNGN = haulageObj && !haulageObj.amount ? 0 : Number(haulageObj?.amount) || 0;
    const totalCost = oceanAmount + originUSD + Math.round(originNGN / fx) + Math.round(haulageNGN / fx);
    const margin = Number(marginPct) / 100;
    const sellPrice = Math.round(totalCost * (1 + margin));

    const quoteData = {
      quoteRef: generateQuoteRef(),
      rfqId,
      rfqRef: rfq.ref,
      status: "draft",
      customerName: customerName || null,
      companyName: companyName || null,
      customerEmail: customerEmail || null,
      pol: ai.polLabel ?? polCode,
      pod: ai.podLabel ?? podCode,
      polCode,
      podCode,
      commodity: commodity || "General Cargo",
      containerType,
      containerQty,
      carrier: ai.carrier ?? selectedOcean?.carrier ?? "TBD",
      oceanLine: {
        rateId: selectedOcean?.id ?? null,
        carrier: ai.carrier ?? selectedOcean?.carrier,
        amount: oceanAmount,
        currency: ai.oceanCurrency ?? "USD",
        transitTime: ai.transitTime ?? selectedOcean?.transitTime ?? "TBD",
        freeTime: ai.freeTime ?? selectedOcean?.freeTime ?? "TBD",
      },
      originCharges: originChargesRaw,
      destCharges: destChargesRaw,
      haulage: haulageObj,
      hasSuggestedHaulage: ai.hasSuggestedHaulage ?? !!haulageObj,
      exchangeRate: String(fx),
      marginPct: String(marginPct),
      totalCostUSD: String(totalCost),
      sellPriceUSD: String(sellPrice),
      aiNotes: ai.notes ?? null,
      notes: null,
    };

    if (save) {
      const [saved] = await db.insert(quotesTable).values(quoteData).returning();
      res.status(201).json(saved);
    } else {
      res.json(quoteData);
    }
  } catch (err) {
    req.log.error({ err }, "Failed to generate quote");
    res.status(500).json({ error: "Failed to generate quote", detail: String(err) });
  }
});

// GET /quotes/:id
router.get("/quotes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [row] = await db.select().from(quotesTable).where(eq(quotesTable.id, id));
    if (!row) { res.status(404).json({ error: "Quote not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to get quote");
    res.status(500).json({ error: "Failed to get quote" });
  }
});

// PATCH /quotes/:id
router.patch("/quotes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const allowed = ["status", "notes", "marginPct", "exchangeRate", "originCharges", "destCharges", "haulage",
      "hasSuggestedHaulage", "oceanLine", "carrier", "sentAt", "totalCostUSD", "sellPriceUSD"];
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    for (const k of allowed) { if (b[k] !== undefined) patch[k] = b[k]; }
    if (b.status === "sent" && !b.sentAt) patch.sentAt = new Date();
    const [updated] = await db.update(quotesTable).set(patch).where(eq(quotesTable.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Quote not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update quote");
    res.status(500).json({ error: "Failed to update quote" });
  }
});

// DELETE /quotes/:id
router.delete("/quotes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.delete(quotesTable).where(eq(quotesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete quote");
    res.status(500).json({ error: "Failed to delete quote" });
  }
});

export { router as quotesRouter };
