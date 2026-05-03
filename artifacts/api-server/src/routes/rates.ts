import { Router, type IRouter } from "express";
import { db, ratesTable, partnersTable, rfqsTable, emailsTable,
  oceanFreightRates, haulageImportRates, haulageExportRates, otherCharges } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import nodemailer from "nodemailer";

const router: IRouter = Router();

function createMailTransporter() {
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user: process.env.GMAIL_ADDRESS, pass: process.env.GMAIL_APP_PASSWORD },
  });
}

function locationsMatch(stored: string, query: string): boolean {
  if (!stored || !query) return false;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
  const storedTokens = normalize(stored);
  const queryTokens = normalize(query);
  return queryTokens.some((qt) => storedTokens.some((st) => st.startsWith(qt) || qt.startsWith(st)));
}

// ── OCEAN FREIGHT RATES ──────────────────────────────────────────────────────

router.get("/rates/ocean-freight", async (req, res) => {
  try {
    const rows = await db.select().from(oceanFreightRates).where(eq(oceanFreightRates.archived, false));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list ocean freight rates");
    res.status(500).json({ error: "Failed to list ocean freight rates" });
  }
});

router.post("/rates/ocean-freight", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.carrier || !b.polCode || !b.podCode || !b.expiryDate) {
      res.status(400).json({ error: "carrier, polCode, podCode, expiryDate are required" });
      return;
    }
    const [row] = await db.insert(oceanFreightRates).values({
      carrier: b.carrier as string,
      polCode: b.polCode as string,
      originCountry: (b.originCountry as string) ?? null,
      podCode: b.podCode as string,
      destCountry: (b.destCountry as string) ?? null,
      commodityType: (b.commodityType as string) ?? "general",
      equipmentType: (b.equipmentType as string) ?? "40ft",
      rateType: (b.rateType as string) ?? "all_in",
      inclusionType: (b.inclusionType as string) ?? null,
      transitTime: (b.transitTime as string) ?? null,
      freeTime: (b.freeTime as string) ?? null,
      currency: (b.currency as string) ?? "USD",
      amount20ft: (b.amount20ft as string) ?? null,
      amount40ft: (b.amount40ft as string) ?? null,
      amount40hc: (b.amount40hc as string) ?? null,
      expiryDate: b.expiryDate as string,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create ocean freight rate");
    res.status(500).json({ error: "Failed to create ocean freight rate" });
  }
});

router.put("/rates/ocean-freight/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const s = (k: string, dbk?: string) => { if (b[k] !== undefined) patch[dbk ?? k] = b[k] ?? null; };
    s("carrier"); s("polCode"); s("originCountry"); s("podCode"); s("destCountry");
    s("commodityType"); s("equipmentType"); s("rateType"); s("inclusionType");
    s("transitTime"); s("freeTime"); s("currency");
    s("amount20ft"); s("amount40ft"); s("amount40hc"); s("expiryDate");
    patch.updatedAt = new Date();
    const [updated] = await db.update(oceanFreightRates).set(patch).where(eq(oceanFreightRates.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Rate not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update ocean freight rate");
    res.status(500).json({ error: "Failed to update ocean freight rate" });
  }
});

router.delete("/rates/ocean-freight/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(oceanFreightRates).set({ archived: true, updatedAt: new Date() }).where(eq(oceanFreightRates.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete ocean freight rate");
    res.status(500).json({ error: "Failed to delete ocean freight rate" });
  }
});

// ── HAULAGE IMPORT RATES ──────────────────────────────────────────────────────

router.get("/rates/haulage-import", async (req, res) => {
  try {
    const rows = await db.select().from(haulageImportRates).where(eq(haulageImportRates.archived, false));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list haulage import rates");
    res.status(500).json({ error: "Failed to list haulage import rates" });
  }
});

router.post("/rates/haulage-import", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.terminalName || !b.portCode || !b.destLga || !b.price) {
      res.status(400).json({ error: "terminalName, portCode, destLga, price are required" });
      return;
    }
    const [row] = await db.insert(haulageImportRates).values({
      terminalName: b.terminalName as string,
      portCode: b.portCode as string,
      originState: (b.originState as string) ?? null,
      destCity: (b.destCity as string) ?? null,
      destLga: b.destLga as string,
      destState: (b.destState as string) ?? null,
      shipmentType: (b.shipmentType as string) ?? "fcl",
      equipmentType: (b.equipmentType as string) ?? "40ft",
      commodityType: (b.commodityType as string) ?? "general",
      currency: (b.currency as string) ?? "NGN",
      price: b.price as string,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create haulage import rate");
    res.status(500).json({ error: "Failed to create haulage import rate" });
  }
});

router.put("/rates/haulage-import/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    ["terminalName","portCode","originState","destCity","destLga","destState",
     "shipmentType","equipmentType","commodityType","currency","price"]
      .forEach(k => { if (b[k] !== undefined) patch[k] = b[k] ?? null; });
    const [updated] = await db.update(haulageImportRates).set(patch).where(eq(haulageImportRates.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Rate not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update haulage import rate");
    res.status(500).json({ error: "Failed to update haulage import rate" });
  }
});

router.delete("/rates/haulage-import/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(haulageImportRates).set({ archived: true, updatedAt: new Date() }).where(eq(haulageImportRates.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete haulage import rate");
    res.status(500).json({ error: "Failed to delete haulage import rate" });
  }
});

// ── HAULAGE EXPORT RATES ──────────────────────────────────────────────────────

router.get("/rates/haulage-export", async (req, res) => {
  try {
    const rows = await db.select().from(haulageExportRates).where(eq(haulageExportRates.archived, false));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list haulage export rates");
    res.status(500).json({ error: "Failed to list haulage export rates" });
  }
});

router.post("/rates/haulage-export", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.terminalName || !b.portCode || !b.originState || !b.originLga || !b.price) {
      res.status(400).json({ error: "terminalName, portCode, originState, originLga, price are required" });
      return;
    }
    const [row] = await db.insert(haulageExportRates).values({
      terminalName: b.terminalName as string,
      portCode: b.portCode as string,
      originState: b.originState as string,
      originCity: (b.originCity as string) ?? null,
      originLga: b.originLga as string,
      destState: (b.destState as string) ?? null,
      shipmentType: (b.shipmentType as string) ?? "fcl",
      equipmentType: (b.equipmentType as string) ?? "40ft",
      commodityType: (b.commodityType as string) ?? "general",
      currency: (b.currency as string) ?? "NGN",
      price: b.price as string,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create haulage export rate");
    res.status(500).json({ error: "Failed to create haulage export rate" });
  }
});

router.put("/rates/haulage-export/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    ["terminalName","portCode","originState","originCity","originLga","destState",
     "shipmentType","equipmentType","commodityType","currency","price"]
      .forEach(k => { if (b[k] !== undefined) patch[k] = b[k] ?? null; });
    const [updated] = await db.update(haulageExportRates).set(patch).where(eq(haulageExportRates.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Rate not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update haulage export rate");
    res.status(500).json({ error: "Failed to update haulage export rate" });
  }
});

router.delete("/rates/haulage-export/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(haulageExportRates).set({ archived: true, updatedAt: new Date() }).where(eq(haulageExportRates.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete haulage export rate");
    res.status(500).json({ error: "Failed to delete haulage export rate" });
  }
});

// ── OTHER CHARGES ─────────────────────────────────────────────────────────────

router.get("/rates/other-charges", async (req, res) => {
  try {
    const rows = await db.select().from(otherCharges).where(eq(otherCharges.archived, false));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list other charges");
    res.status(500).json({ error: "Failed to list other charges" });
  }
});

router.post("/rates/other-charges", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    if (!b.itemName || !b.itemCategory) {
      res.status(400).json({ error: "itemName, itemCategory are required" });
      return;
    }
    const [row] = await db.insert(otherCharges).values({
      itemName: b.itemName as string,
      shipmentType: (b.shipmentType as string) ?? "both",
      itemCategory: b.itemCategory as string,
      commodityType: (b.commodityType as string) ?? "FAK",
      country: (b.country as string) ?? null,
      currency: (b.currency as string) ?? "NGN",
      price: b.asPerReceipt ? null : (b.price as string) ?? null,
      asPerReceipt: Boolean(b.asPerReceipt ?? false),
      expiryDate: (b.expiryDate as string) ?? null,
    }).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create other charge");
    res.status(500).json({ error: "Failed to create other charge" });
  }
});

router.put("/rates/other-charges/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = { updatedAt: new Date() };
    ["itemName","shipmentType","itemCategory","commodityType","country","currency","expiryDate"]
      .forEach(k => { if (b[k] !== undefined) patch[k] = b[k] ?? null; });
    if (b.asPerReceipt !== undefined) {
      patch.asPerReceipt = Boolean(b.asPerReceipt);
      patch.price = b.asPerReceipt ? null : (b.price as string) ?? null;
    } else if (b.price !== undefined) {
      patch.price = b.price ?? null;
    }
    const [updated] = await db.update(otherCharges).set(patch).where(eq(otherCharges.id, id)).returning();
    if (!updated) { res.status(404).json({ error: "Charge not found" }); return; }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update other charge");
    res.status(500).json({ error: "Failed to update other charge" });
  }
});

router.delete("/rates/other-charges/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await db.update(otherCharges).set({ archived: true, updatedAt: new Date() }).where(eq(otherCharges.id, id));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete other charge");
    res.status(500).json({ error: "Failed to delete other charge" });
  }
});

// ── LEGACY RATES (kept for backward compatibility) ────────────────────────────

router.get("/rates", async (req, res) => {
  try {
    const { pol, pod, container } = req.query as { pol?: string; pod?: string; container?: string };
    const allRates = await db
      .select({ rate: ratesTable, partner: partnersTable })
      .from(ratesTable)
      .leftJoin(partnersTable, eq(ratesTable.partnerId, partnersTable.id));
    const matched = allRates.filter(({ rate }) => {
      const polMatch = !pol || locationsMatch(rate.pol, pol) || (rate.originPortCode ? locationsMatch(rate.originPortCode, pol) : false);
      const podMatch = !pod || locationsMatch(rate.pod, pod) || (rate.destinationPortCode ? locationsMatch(rate.destinationPortCode, pod) : false);
      const containerMatch = !container || !rate.containerType || rate.containerType.toLowerCase().includes(container.toLowerCase());
      return polMatch && podMatch && containerMatch;
    });
    res.json(matched);
  } catch (err) {
    req.log.error({ err }, "Failed to search rates");
    res.status(500).json({ error: "Failed to search rates" });
  }
});

router.post("/rates", async (req, res) => {
  try {
    const b = req.body as Record<string, unknown>;
    const pol = (b.pol as string | undefined)?.trim();
    const pod = (b.pod as string | undefined)?.trim();
    if (!pol || !pod) { res.status(400).json({ error: "pol and pod are required" }); return; }
    const [rate] = await db.insert(ratesTable).values({
      originPortCode: (b.originPortCode as string) ?? null,
      destinationPortCode: (b.destinationPortCode as string) ?? null,
      pol, pod,
      carrier: (b.carrier as string) ?? null,
      scac: (b.scac as string) ?? null,
      isAgentRate: Boolean(b.isAgentRate ?? false),
      cargoType: (b.cargoType as string) ?? null,
      rateType: (b.rateType as string) ?? null,
      inclusionType: (b.inclusionType as string) ?? null,
      commodityType: (b.commodityType as string) ?? null,
      commodityTypeField: (b.commodityTypeField as string) ?? null,
      charge20ft: (b.charge20ft as string) ?? null,
      charge40ft: (b.charge40ft as string) ?? null,
      charge40hc: (b.charge40hc as string) ?? null,
      containerType: (b.containerType as string) ?? null,
      freightRate: (b.freightRate as string) ?? null,
      commodity: (b.commodity as string) ?? null,
      currency: (b.currency as string) ?? "USD",
      validFrom: b.validFrom ? new Date(b.validFrom as string) : null,
      validTo: b.validTo ? new Date(b.validTo as string) : null,
      sailingDate: b.sailingDate ? new Date(b.sailingDate as string) : null,
      freeTime: b.freeTime ? Number(b.freeTime) : null,
      transitTime: b.transitTime ? Number(b.transitTime) : null,
      demurrageDays: b.demurrageDays ? Number(b.demurrageDays) : null,
      detentionDays: b.detentionDays ? Number(b.detentionDays) : null,
      avgMarketRate20ft: (b.avgMarketRate20ft as string) ?? null,
      avgMarketRate40ft: (b.avgMarketRate40ft as string) ?? null,
      partnerId: b.partnerId ? Number(b.partnerId) : null,
      notes: (b.notes as string) ?? null,
      breakdown: (b.breakdown as Record<string, unknown>) ?? {},
    }).returning();
    res.status(201).json(rate);
  } catch (err) {
    req.log.error({ err }, "Failed to create rate");
    res.status(500).json({ error: "Failed to create rate" });
  }
});

router.put("/rates/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const b = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};
    const str = (k: string) => { if (b[k] !== undefined) patch[k] = (b[k] as string) ?? null; };
    const num = (k: string) => { if (b[k] !== undefined) patch[k] = b[k] ? Number(b[k]) : null; };
    const dt  = (k: string) => { if (b[k] !== undefined) patch[k] = b[k] ? new Date(b[k] as string) : null; };
    str("originPortCode"); str("destinationPortCode"); str("pol"); str("pod");
    str("carrier"); str("scac"); str("cargoType"); str("rateType"); str("inclusionType");
    str("commodityType"); str("commodityTypeField");
    str("charge20ft"); str("charge40ft"); str("charge40hc");
    str("containerType"); str("freightRate"); str("commodity"); str("currency"); str("notes");
    str("avgMarketRate20ft"); str("avgMarketRate40ft");
    dt("validFrom"); dt("validTo"); dt("sailingDate");
    num("freeTime"); num("transitTime"); num("demurrageDays"); num("detentionDays");
    if (b.partnerId !== undefined) patch.partnerId = b.partnerId ? Number(b.partnerId) : null;
    if (b.isAgentRate !== undefined) patch.isAgentRate = Boolean(b.isAgentRate);
    if (b.breakdown !== undefined) patch.breakdown = b.breakdown as Record<string, unknown>;
    const updated = await db.update(ratesTable).set(patch).where(eq(ratesTable.id, id)).returning();
    if (!updated.length) { res.status(404).json({ error: "Rate not found" }); return; }
    res.json(updated[0]);
  } catch (err) {
    req.log.error({ err }, "Failed to update rate");
    res.status(500).json({ error: "Failed to update rate" });
  }
});

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

// ── REQUEST RATES FROM PARTNERS ───────────────────────────────────────────────

router.post("/rfqs/:id/request-rates", async (req, res) => {
  try {
    const rfqId = parseInt(req.params.id, 10);
    const rows = await db
      .select().from(rfqsTable)
      .leftJoin(emailsTable, eq(rfqsTable.emailId, emailsTable.id))
      .where(eq(rfqsTable.id, rfqId));
    if (!rows.length) { res.status(404).json({ error: "RFQ not found" }); return; }
    const rfq = rows[0].rfqs;
    const email = rows[0].emails;
    const fields = (rfq.fields as Array<{ k: string; v: string; ok: boolean }>) ?? [];
    const getField = (key: string) => fields.find((f) => f.k.toLowerCase() === key.toLowerCase())?.v ?? "";
    const pol = getField("POL"); const pod = getField("POD");
    const container = getField("Container"); const commodity = getField("Commodity");
    const customer = getField("Customer") || email?.fromName || "Customer";
    const incoterm = getField("Incoterm"); const quantity = getField("Quantity");
    const relevantCategories: string[] = [];
    const containerLower = container.toLowerCase();
    if (containerLower.includes("lcl")) relevantCategories.push("LCL");
    else if (containerLower.includes("air") || pod.toLowerCase().includes("airport")) relevantCategories.push("AIR");
    else relevantCategories.push("FCL");
    if (commodity.toLowerCase().match(/reefer|frozen|chilled|perishable|fresh/)) relevantCategories.push("REEFER");
    if (commodity.toLowerCase().match(/dangerous|hazardous|dg|class\s*\d/i)) relevantCategories.push("DG");
    const allPartners = await db.select().from(partnersTable).where(eq(partnersTable.active, true));
    const targetPartners = allPartners.filter((p) => {
      const cats = (p.categories as string[]) ?? [];
      return cats.length === 0 || relevantCategories.some((rc) => cats.some((c) => c.toUpperCase() === rc));
    });
    if (!targetPartners.length) { res.status(422).json({ error: "No active partners match this shipment type" }); return; }
    const transporter = createMailTransporter();
    const emailBody = `Dear Partner,\n\nWe have received a freight enquiry and are requesting rates for the following shipment:\n\n  Customer   : ${customer}\n  POL        : ${pol}\n  POD        : ${pod}\n  Container  : ${container}\n  Commodity  : ${commodity}\n  Quantity   : ${quantity}\n  Incoterm   : ${incoterm}\n  RFQ Ref    : ${rfq.ref}\n\nPlease send us your best rates for this lane at your earliest convenience.\n\nThank you,\nOnePort 365 Commercial Team\n`;
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
