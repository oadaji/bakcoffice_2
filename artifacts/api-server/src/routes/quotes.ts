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

// Extract a 5-letter IATA/LOCODE port code from a raw field value.
// Handles: "Apapa (NGAPP)", "London, UK", "Lagos, Nigeria", plain codes, etc.
function extractPortCode(raw: string): string {
  if (!raw) return "";
  // Prefer an explicit 5-letter uppercase code inside parentheses
  const parenCode = raw.match(/\(([A-Za-z]{5})\)/);
  if (parenCode) return parenCode[1].toUpperCase();
  // Or a standalone 5-letter code word
  const standalone = raw.match(/\b([A-Z]{5})\b/);
  if (standalone) return standalone[1];
  // City / country name → port code mapping
  const MAP: Record<string, string> = {
    "london": "GBFXT", "felixstowe": "GBFXT", "southampton": "GBSOU",
    "apapa": "NGAPP", "lagos": "NGAPP", "tin can": "NGTCN", "onne": "NGONE",
    "calabar": "NGCBQ", "warri": "NGWAR",
    "rotterdam": "NLRTM", "hamburg": "DEHAM", "gdansk": "PLGDN",
    "antwerp": "BEANR", "barcelona": "ESBCN", "catania": "ITCTG",
    "milan": "ITMIL", "aarhus": "DKAAR",
    "shanghai": "CNSHA", "ningbo": "CNNGB", "qingdao": "CNTAO",
    "foshan": "CNSHA", "guangzhou": "CNSHA", "shenzhen": "CNSHA",
    "china": "CNSHA",
    "singapore": "SGSIN",
    "dubai": "AEJEA", "jebel ali": "AEJEA", "sharjah": "AEJEA",
    "istanbul": "TRIST", "ambarlı": "TRIST", "ambarli": "TRIST",
    "new york": "USNYC", "los angeles": "USLA", "long beach": "USLA",
    "san francisco": "USOAL", "oakland": "USOAL",
    "tokyo": "JPTYO", "yokohama": "JPYOK",
    "busan": "KRPUS",
    "kaohsiung": "TWKHH", "taiwan": "TWKHH",
    "mumbai": "INNSZ", "nhava sheva": "INNSZ", "india": "INNSZ",
    "mombasa": "KEMBA", "kenya": "KEMBA",
    "dar es salaam": "TZDAR", "tanzania": "TZDAR",
    "vietnam": "VNHCM", "ho chi minh": "VNHCM",
    "toronto": "CAYTO", "canada": "CAYTO",
    "uk": "GBFXT", "germany": "DEHAM", "netherlands": "NLRTM",
    "nigeria": "NGAPP", "south korea": "KRPUS", "korea": "KRPUS",
    "japan": "JPYOK", "usa": "USNYC", "uae": "AEJEA",
  };
  const lower = raw.toLowerCase();
  for (const [name, code] of Object.entries(MAP)) {
    if (lower.includes(name)) return code;
  }
  return raw.toUpperCase().slice(0, 5);
}

function isNigeriaPort(code: string): boolean {
  return code?.startsWith("NG") ?? false;
}

// Also check the raw field text for Nigeria destination indicators
function isNigeriaDestinationRaw(raw: string): boolean {
  if (!raw) return false;
  const lower = raw.toLowerCase();
  return lower.includes("nigeria") || lower.includes("lagos") || lower.includes("apapa")
    || lower.includes("onne") || lower.includes("tin can") || lower.includes("alaba")
    || lower.includes("ngapp") || lower.includes("ngone") || lower.includes("ngtcn");
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

    const rawPol = fieldVal(fields, "POL") || fieldVal(fields, "origin port");
    const rawPod = fieldVal(fields, "POD") || fieldVal(fields, "destination port");
    const polCode = extractPortCode(rawPol);
    const podCode = extractPortCode(rawPod);
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

    // 2. Determine shipment direction (check both extracted code AND raw text)
    const isImportToNigeria = isNigeriaPort(podCode) || isNigeriaDestinationRaw(rawPod);
    const isExportFromNigeria = isNigeriaPort(polCode) || isNigeriaDestinationRaw(rawPol);
    const shipmentDir = isImportToNigeria ? "import" : isExportFromNigeria ? "export" : "both";

    // 3. Fetch matching ocean freight rates — try exact code match, then country-prefix, then all
    const allOcean = await db.select().from(oceanFreightRates)
      .where(and(eq(oceanFreightRates.archived, false)));

    // Exact 5-letter code match (best)
    let oceanPool = allOcean.filter(r =>
      r.polCode?.toUpperCase() === polCode && r.podCode?.toUpperCase() === podCode
    );
    // Country-prefix match (first 2 chars = country code): GBFXT → GB*, NGAPP → NG*
    if (oceanPool.length === 0) {
      const polPfx = polCode.slice(0, 2);
      const podPfx = podCode.slice(0, 2);
      oceanPool = allOcean.filter(r =>
        r.polCode?.toUpperCase().startsWith(polPfx) && r.podCode?.toUpperCase().startsWith(podPfx)
      );
    }
    // Wide fallback: match on either end (POD = Nigeria destination, or POL = Nigeria origin)
    if (oceanPool.length === 0 && isImportToNigeria) {
      oceanPool = allOcean.filter(r => r.podCode?.toUpperCase().startsWith("NG")).slice(0, 15);
    } else if (oceanPool.length === 0 && isExportFromNigeria) {
      oceanPool = allOcean.filter(r => r.polCode?.toUpperCase().startsWith("NG")).slice(0, 15);
    }
    // Last resort: send a random sample so Claude can reason
    if (oceanPool.length === 0) {
      oceanPool = allOcean.slice(0, 15);
    }

    // 4. Fetch applicable other charges
    const allOther = await db.select().from(otherCharges)
      .where(and(eq(otherCharges.archived, false)));
    const applicableCharges = allOther.filter(c => {
      const sType = c.shipmentType?.toLowerCase();
      return sType === "both" || sType === shipmentDir;
    });

    // 5. Fetch haulage rates — match by port code, with city-name fallback
    let haulagePool: any[] = [];
    if (isImportToNigeria) {
      // Try by extracted port code first, then by all Lagos/Apapa port codes
      const allImport = await db.select().from(haulageImportRates)
        .where(eq(haulageImportRates.archived, false));
      const nigeriaPodCode = isNigeriaPort(podCode) ? podCode : "NGAPP";
      haulagePool = allImport.filter(r => r.portCode === nigeriaPodCode);
      // Fallback: try matching destination city from the raw POD text
      if (haulagePool.length === 0) {
        haulagePool = allImport.filter(r =>
          rawPod.toLowerCase().includes((r.destCity ?? "").toLowerCase()) ||
          rawPod.toLowerCase().includes((r.destState ?? "").toLowerCase())
        ).slice(0, 10);
      }
      // Last resort: any Apapa/Lagos import rates
      if (haulagePool.length === 0) {
        haulagePool = allImport.filter(r => r.portCode === "NGAPP" || r.portCode === "NGTCN").slice(0, 10);
      }
    } else if (isExportFromNigeria) {
      const allExport = await db.select().from(haulageExportRates)
        .where(eq(haulageExportRates.archived, false));
      const nigeriaPolCode = isNigeriaPort(polCode) ? polCode : "NGAPP";
      haulagePool = allExport.filter(r => r.portCode === nigeriaPolCode);
      if (haulagePool.length === 0) {
        haulagePool = allExport.filter(r => r.portCode === "NGAPP" || r.portCode === "NGTCN").slice(0, 10);
      }
    }

    // 6. Call Claude to build the quote
    const prompt = `You are a freight quoting assistant for OnePort 365, a Nigerian freight forwarding company.

Given the following RFQ and available rates, build a complete freight quote.

RFQ Details:
- RFQ Ref: ${rfq.ref}
- POL (raw): ${rawPol}  →  Extracted Code: ${polCode}
- POD (raw): ${rawPod}  →  Extracted Code: ${podCode}
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
