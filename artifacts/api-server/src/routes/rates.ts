import { Router, type IRouter } from "express";
import { db, ratesTable, partnersTable, rfqsTable, emailsTable,
  oceanFreightRates, haulageImportRates, haulageExportRates, otherCharges } from "@workspace/db";
import { eq, and, ilike } from "drizzle-orm";
import nodemailer from "nodemailer";
import { anthropic } from "@workspace/integrations-anthropic-ai";

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
    const rows = await db
      .select({
        id: oceanFreightRates.id,
        carrier: oceanFreightRates.carrier,
        polCode: oceanFreightRates.polCode,
        originCountry: oceanFreightRates.originCountry,
        podCode: oceanFreightRates.podCode,
        destCountry: oceanFreightRates.destCountry,
        commodityType: oceanFreightRates.commodityType,
        equipmentType: oceanFreightRates.equipmentType,
        rateType: oceanFreightRates.rateType,
        inclusionType: oceanFreightRates.inclusionType,
        transitTime: oceanFreightRates.transitTime,
        freeTime: oceanFreightRates.freeTime,
        currency: oceanFreightRates.currency,
        amount20ft: oceanFreightRates.amount20ft,
        amount40ft: oceanFreightRates.amount40ft,
        amount40hc: oceanFreightRates.amount40hc,
        expiryDate: oceanFreightRates.expiryDate,
        partnerId: oceanFreightRates.partnerId,
        partnerName: partnersTable.name,
        archived: oceanFreightRates.archived,
        createdAt: oceanFreightRates.createdAt,
        updatedAt: oceanFreightRates.updatedAt,
      })
      .from(oceanFreightRates)
      .leftJoin(partnersTable, eq(oceanFreightRates.partnerId, partnersTable.id))
      .where(eq(oceanFreightRates.archived, false));
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
      partnerId: b.partnerId ? Number(b.partnerId) : null,
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
    const s = (k: string) => { if (b[k] !== undefined) patch[k] = b[k] ?? null; };
    s("carrier"); s("polCode"); s("originCountry"); s("podCode"); s("destCountry");
    s("commodityType"); s("equipmentType"); s("rateType"); s("inclusionType");
    s("transitTime"); s("freeTime"); s("currency");
    s("amount20ft"); s("amount40ft"); s("amount40hc"); s("expiryDate");
    if (b.partnerId !== undefined) patch.partnerId = b.partnerId ? Number(b.partnerId) : null;
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

// ── BULK CSV IMPORT ────────────────────────────────────────────────────────────

router.post("/rates/ocean-freight/import", async (req, res) => {
  try {
    const rows = req.body as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Expected non-empty array" }); return;
    }
    const values = rows.map(r => ({
      carrier: String(r.carrier ?? ""),
      polCode: String(r.polCode ?? ""),
      podCode: String(r.podCode ?? ""),
      originCountry: (r.originCountry as string) ?? null,
      destCountry: (r.destCountry as string) ?? null,
      commodityType: (r.commodityType as string) ?? "general",
      equipmentType: (r.equipmentType as string) ?? "40ft",
      rateType: (r.rateType as string) ?? "all_in",
      inclusionType: (r.inclusionType as string) ?? null,
      transitTime: (r.transitTime as string) ?? null,
      freeTime: (r.freeTime as string) ?? null,
      currency: (r.currency as string) ?? "USD",
      amount20ft: r.amount20ft ? String(r.amount20ft) : null,
      amount40ft: r.amount40ft ? String(r.amount40ft) : null,
      amount40hc: r.amount40hc ? String(r.amount40hc) : null,
      expiryDate: (r.expiryDate as string) ?? null,
      partnerId: r.partnerId ? Number(r.partnerId) : null,
    })).filter(r => r.carrier && r.polCode && r.podCode);
    if (!values.length) {
      res.status(400).json({ error: "No valid rows — carrier, polCode, podCode are required" }); return;
    }
    const inserted = await db.insert(oceanFreightRates).values(values).returning();
    res.status(201).json({ imported: inserted.length });
  } catch (err) {
    req.log.error({ err }, "Failed to import ocean freight rates");
    res.status(500).json({ error: "Failed to import", detail: String(err) });
  }
});

router.post("/rates/haulage-import/import", async (req, res) => {
  try {
    const rows = req.body as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Expected non-empty array" }); return;
    }
    const values = rows.map(r => ({
      terminalName: String(r.terminalName ?? ""),
      portCode: String(r.portCode ?? ""),
      originState: (r.originState as string) ?? null,
      destCity: (r.destCity as string) ?? null,
      destLga: String(r.destLga ?? ""),
      destState: (r.destState as string) ?? null,
      shipmentType: (r.shipmentType as string) ?? "fcl",
      equipmentType: (r.equipmentType as string) ?? "40ft",
      commodityType: (r.commodityType as string) ?? "general",
      currency: (r.currency as string) ?? "NGN",
      price: String(r.price ?? "0"),
    })).filter(r => r.terminalName && r.portCode && r.destLga && r.price);
    if (!values.length) {
      res.status(400).json({ error: "No valid rows — terminalName, portCode, destLga, price are required" }); return;
    }
    const inserted = await db.insert(haulageImportRates).values(values).returning();
    res.status(201).json({ imported: inserted.length });
  } catch (err) {
    req.log.error({ err }, "Failed to import haulage import rates");
    res.status(500).json({ error: "Failed to import", detail: String(err) });
  }
});

router.post("/rates/haulage-export/import", async (req, res) => {
  try {
    const rows = req.body as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Expected non-empty array" }); return;
    }
    const values = rows.map(r => ({
      terminalName: String(r.terminalName ?? ""),
      portCode: String(r.portCode ?? ""),
      originState: String(r.originState ?? ""),
      originCity: (r.originCity as string) ?? null,
      originLga: String(r.originLga ?? ""),
      destState: (r.destState as string) ?? null,
      shipmentType: (r.shipmentType as string) ?? "fcl",
      equipmentType: (r.equipmentType as string) ?? "40ft",
      commodityType: (r.commodityType as string) ?? "general",
      currency: (r.currency as string) ?? "NGN",
      price: String(r.price ?? "0"),
    })).filter(r => r.terminalName && r.portCode && r.originState && r.originLga && r.price);
    if (!values.length) {
      res.status(400).json({ error: "No valid rows — terminalName, portCode, originState, originLga, price are required" }); return;
    }
    const inserted = await db.insert(haulageExportRates).values(values).returning();
    res.status(201).json({ imported: inserted.length });
  } catch (err) {
    req.log.error({ err }, "Failed to import haulage export rates");
    res.status(500).json({ error: "Failed to import", detail: String(err) });
  }
});

router.post("/rates/other-charges/import", async (req, res) => {
  try {
    const rows = req.body as Record<string, unknown>[];
    if (!Array.isArray(rows) || rows.length === 0) {
      res.status(400).json({ error: "Expected non-empty array" }); return;
    }
    const values = rows.map(r => {
      const apr = r.asPerReceipt === "true" || r.asPerReceipt === true;
      return {
        itemName: String(r.itemName ?? ""),
        shipmentType: (r.shipmentType as string) ?? "both",
        itemCategory: String(r.itemCategory ?? "other"),
        commodityType: (r.commodityType as string) ?? "FAK",
        country: (r.country as string) ?? null,
        currency: (r.currency as string) ?? "NGN",
        price: apr ? null : (r.price ? String(r.price) : null),
        asPerReceipt: apr,
        expiryDate: (r.expiryDate as string) ?? null,
      };
    }).filter(r => r.itemName && r.itemCategory);
    if (!values.length) {
      res.status(400).json({ error: "No valid rows — itemName, itemCategory are required" }); return;
    }
    const inserted = await db.insert(otherCharges).values(values).returning();
    res.status(201).json({ imported: inserted.length });
  } catch (err) {
    req.log.error({ err }, "Failed to import other charges");
    res.status(500).json({ error: "Failed to import", detail: String(err) });
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

// ── AUTO-PARSE RATES FROM EMAIL ────────────────────────────────────────────────
// POST /api/rates/parse-email
// Called automatically when a rate-reply email is ingested, or manually from the UI.
// Body: { emailId?, body, subject, fromName, fromEmail }
// Returns: { parsed: number, rates: OceanFreightRate[] }

router.post("/rates/parse-email", async (req, res) => {
  try {
    const { emailId, body, subject, fromName, fromEmail } = req.body as {
      emailId?: number;
      body: string;
      subject?: string;
      fromName?: string;
      fromEmail?: string;
    };
    if (!body) { res.status(400).json({ error: "body is required" }); return; }

    // Try to match sender to a known partner by email domain
    let partnerId: number | null = null;
    if (fromEmail) {
      const domain = fromEmail.split("@")[1]?.toLowerCase();
      if (domain) {
        const [partner] = await db
          .select({ id: partnersTable.id })
          .from(partnersTable)
          .where(ilike(partnersTable.email, `%@${domain}`))
          .limit(1);
        if (partner) partnerId = partner.id;
      }
    }

    const cleanBody = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const prompt = `You are a freight rate data entry specialist at OnePort 365.
Extract all ocean freight rate entries from the email below and return them as a JSON array.

Sender: ${fromName || ""} <${fromEmail || ""}>
Subject: ${subject || ""}
Body:
${cleanBody}

Return ONLY a JSON array (no other text). Each element must have:
{
  "carrier": "<shipping line or NVOCC name>",
  "polCode": "<UNLOCODE e.g. CNCGU, NGAPP, TRIST>",
  "podCode": "<UNLOCODE e.g. NGAPP, NLRTM, DEHAM>",
  "originCountry": "<2-letter ISO country code or null>",
  "destCountry": "<2-letter ISO country code or null>",
  "equipmentType": "20ft" | "40ft" | "40hc" | "lcl",
  "commodityType": "general" | "reefer" | "dg" | "other",
  "rateType": "all_in" | "freight_only" | "spot",
  "currency": "USD" | "EUR" | "GBP" | "NGN",
  "amount20ft": <number or null>,
  "amount40ft": <number or null>,
  "amount40hc": <number or null>,
  "transitTime": "<e.g. '21 days' or null>",
  "freeTime": "<e.g. '14 days' or null>",
  "expiryDate": "<YYYY-MM-DD — use validity date from email, or 30 days from today if not stated>"
}

Rules:
- One entry per POL-POD-carrier-equipment combination.
- If a single row lists rates for 20FT, 40FT, 40HC together, produce ONE entry with all three amounts.
- If only one container size is mentioned, set the others to null.
- polCode / podCode must be 5-character UNLOCODEs. Common ones: Lagos/Apapa=NGAPP, Apapa=NGAPP, Tincan=NGTIN, Shanghai=CNSHA, Guangzhou=CNCGU, Qingdao=CNTAO, Ningbo=CNNGB, Shenzhen=CNSZX, Rotterdam=NLRTM, Hamburg=DEHAM, Antwerp=BEANR, Istanbul=TRIST, Dubai/Jebel Ali=AEJEA, Tema=GHTEM, Abidjan=CIABJ, Mombasa=KEMBA, Durban=ZADUR, Cape Town=ZACPT.
- If the email contains no ocean freight rates, return an empty array [].
- Do NOT include surcharges as separate entries — fold BAF/CAF/PSS into the all-in amount if the sender does.`;

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = response.content[0].type === "text" ? response.content[0].text : "[]";
    const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    let entries: Record<string, unknown>[] = [];
    try { entries = JSON.parse(cleaned); } catch { entries = []; }

    if (!Array.isArray(entries) || entries.length === 0) {
      res.json({ parsed: 0, rates: [] });
      return;
    }

    // Derive a 30-day fallback expiry
    const fallbackExpiry = new Date();
    fallbackExpiry.setDate(fallbackExpiry.getDate() + 30);
    const fallbackExpiryStr = fallbackExpiry.toISOString().slice(0, 10);

    const values = entries
      .filter((e) => e.carrier && e.polCode && e.podCode)
      .map((e) => ({
        carrier: String(e.carrier),
        polCode: String(e.polCode).toUpperCase(),
        podCode: String(e.podCode).toUpperCase(),
        originCountry: (e.originCountry as string) ?? null,
        destCountry: (e.destCountry as string) ?? null,
        equipmentType: (e.equipmentType as string) ?? "40ft",
        commodityType: (e.commodityType as string) ?? "general",
        rateType: (e.rateType as string) ?? "all_in",
        currency: (e.currency as string) ?? "USD",
        amount20ft: e.amount20ft != null ? String(e.amount20ft) : null,
        amount40ft: e.amount40ft != null ? String(e.amount40ft) : null,
        amount40hc: e.amount40hc != null ? String(e.amount40hc) : null,
        transitTime: (e.transitTime as string) ?? null,
        freeTime: (e.freeTime as string) ?? null,
        expiryDate: (e.expiryDate as string) ?? fallbackExpiryStr,
        partnerId,
      }));

    if (!values.length) { res.json({ parsed: 0, rates: [] }); return; }

    const inserted = await db.insert(oceanFreightRates).values(values).returning();
    req.log.info({ emailId, parsed: inserted.length, partnerId }, "Auto-parsed rates from rate-reply email");
    res.status(201).json({ parsed: inserted.length, rates: inserted });
  } catch (err) {
    req.log.error({ err }, "Failed to parse rates from email");
    res.status(500).json({ error: "Failed to parse rates from email" });
  }
});

export { router as ratesRouter };
