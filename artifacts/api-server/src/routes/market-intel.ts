import { Router } from "express";
import { db } from "@workspace/db";
import { marketIndexSnapshots, rateBenchmarks, oceanFreightRates } from "@workspace/db";
import { desc, eq } from "drizzle-orm";

export const marketIntelRouter = Router();

// ── SCRAPER HELPERS ──────────────────────────────────────────────────────────

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; OnePort365/1.0)",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
    signal: AbortSignal.timeout(15000),
  });
  return res.text();
}

function parseNumber(s: string): number | null {
  const n = parseFloat(s.replace(/[$,\s]/g, ""));
  return isNaN(n) ? null : n;
}

// Option A — Xeneta XSI (public page, no auth required)
async function scrapeXeneta(): Promise<void> {
  const html = await fetchText("https://xsi.xeneta.com/");

  // Extract lanes with regex: pattern matches "$2,463" followed by WoW/MoM
  const lanePatterns: Array<{ label: string; pol: string; pod: string; regex: RegExp }> = [
    { label: "Far East → N.Europe",  pol: "Far East",  pod: "N.Europe",   regex: /Far East\s*-\s*N\.?\s*Europe[\s\S]{0,200}?\$([\d,]+)[\s\S]{0,100}?WoW[\s\S]{0,50}?([\d.]+)%[\s\S]{0,50}?MoM[\s\S]{0,50}?([\d.]+)%/i },
    { label: "N.Europe → Far East",  pol: "N.Europe",  pod: "Far East",   regex: /N\.?\s*Europe\s*-\s*Far East[\s\S]{0,200}?\$([\d,]+)[\s\S]{0,100}?WoW[\s\S]{0,50}?([\d.]+)%[\s\S]{0,50}?MoM[\s\S]{0,50}?([\d.]+)%/i },
    { label: "Far East → USWC",      pol: "Far East",  pod: "USWC",       regex: /Far East\s*-\s*USWC[\s\S]{0,200}?\$([\d,]+)[\s\S]{0,100}?WoW[\s\S]{0,50}?([\d.]+)%[\s\S]{0,50}?MoM[\s\S]{0,50}?([\d.]+)%/i },
    { label: "N.Europe → USEC",      pol: "N.Europe",  pod: "USEC",       regex: /N\.?\s*Europe\s*-\s*USEC[\s\S]{0,200}?\$([\d,]+)[\s\S]{0,100}?WoW[\s\S]{0,50}?([\d.]+)%[\s\S]{0,50}?MoM[\s\S]{0,50}?([\d.]+)%/i },
  ];

  // Simpler fallback: find all dollar amounts preceded by lane names
  const dollarMatches = [...html.matchAll(/\$([\d,]+)/g)];
  const wowMatches    = [...html.matchAll(/WoW[\s\S]{0,30}?([\d.]+)%/g)];
  const momMatches    = [...html.matchAll(/MoM[\s\S]{0,30}?([\d.]+)%/g)];

  const weekDate = new Date().toISOString().split("T")[0];

  // Known Xeneta lanes in order they appear on the page
  const knownLanes = [
    { label: "Far East → N.Europe",  pol: "Far East", pod: "N.Europe" },
    { label: "N.Europe → Far East",  pol: "N.Europe", pod: "Far East" },
    { label: "Far East → USWC",      pol: "Far East", pod: "USWC"    },
    { label: "USWC → Far East",      pol: "USWC",     pod: "Far East" },
    { label: "Far East → SAEC",      pol: "Far East", pod: "SAEC"    },
    { label: "N.Europe → USEC",      pol: "N.Europe", pod: "USEC"    },
    { label: "USEC → N.Europe",      pol: "USEC",     pod: "N.Europe" },
    { label: "N.Europe → SAEC",      pol: "N.Europe", pod: "SAEC"    },
  ];

  const rows = [];
  for (let i = 0; i < knownLanes.length; i++) {
    const lane = knownLanes[i];
    const rate = dollarMatches[i] ? parseNumber(dollarMatches[i][1]) : null;
    const wow  = wowMatches[i]    ? parseNumber(wowMatches[i][1])    : null;
    const mom  = momMatches[i]    ? parseNumber(momMatches[i][1])    : null;
    if (rate !== null) {
      rows.push({
        source: "xeneta",
        tradeLane: lane.label,
        polRegion: lane.pol,
        podRegion: lane.pod,
        equipType: "40ft",
        rateUsd: String(rate),
        wowChangePct: wow !== null ? String(wow) : null,
        momChangePct: mom !== null ? String(mom) : null,
        weekDate,
        rawData: { raw: `$${rate}`, wow, mom },
      });
    }
  }

  if (rows.length > 0) {
    await db.insert(marketIndexSnapshots).values(rows);
  }
}

// Option A — Drewry WCI (public weekly page)
async function scrapeDrewry(): Promise<void> {
  const html = await fetchText(
    "https://www.drewry.co.uk/supply-chain-advisors/supply-chain-expertise/world-container-index-assessed-by-drewry"
  );

  // Drewry WCI typically shows the composite index and 8 trade lanes
  // Pattern: look for currency amounts in the page
  const priceMatches = [...html.matchAll(/\$\s*([\d,]+(?:\.\d+)?)/g)];
  const weekDate = new Date().toISOString().split("T")[0];

  const drewryLanes = [
    { label: "WCI Composite",        pol: "Global",    pod: "Global"   },
    { label: "Shanghai → Rotterdam", pol: "Far East",  pod: "N.Europe" },
    { label: "Rotterdam → Shanghai", pol: "N.Europe",  pod: "Far East" },
    { label: "Shanghai → Genoa",     pol: "Far East",  pod: "Med"      },
    { label: "Shanghai → LA",        pol: "Far East",  pod: "USWC"     },
    { label: "LA → Shanghai",        pol: "USWC",      pod: "Far East" },
    { label: "Shanghai → NY",        pol: "Far East",  pod: "USEC"     },
    { label: "NY → Rotterdam",       pol: "USEC",      pod: "N.Europe" },
    { label: "Rotterdam → NY",       pol: "N.Europe",  pod: "USEC"     },
  ];

  const rows = [];
  for (let i = 0; i < Math.min(drewryLanes.length, priceMatches.length); i++) {
    const lane = drewryLanes[i];
    const rate = parseNumber(priceMatches[i][1]);
    if (rate !== null && rate > 100) {
      rows.push({
        source: "drewry",
        tradeLane: lane.label,
        polRegion: lane.pol,
        podRegion: lane.pod,
        equipType: "40ft",
        rateUsd: String(rate),
        weekDate,
        rawData: { raw: `$${rate}` },
      });
    }
  }

  if (rows.length > 0) {
    await db.insert(marketIndexSnapshots).values(rows);
  }
}

// Option B — Carrier GRI/market-update scraper (AI-assisted text parsing)
async function scrapeCarriers(): Promise<CarrierResult[]> {
  const sources = [
    {
      name: "Maersk",
      url: "https://www.maersk.com/local-information/africa/west-africa",
      fallbackUrl: "https://www.maersk.com/insights",
    },
    {
      name: "CMA CGM",
      url: "https://www.cma-cgm.com/news/3835/west-africa-rates",
      fallbackUrl: "https://www.cma-cgm.com/news",
    },
    {
      name: "Hapag-Lloyd",
      url: "https://www.hapag-lloyd.com/en/online-business/spot.html",
      fallbackUrl: "https://www.hapag-lloyd.com/en/news-insights/insights.html",
    },
  ];

  const results: CarrierResult[] = [];

  for (const src of sources) {
    try {
      let text = "";
      try {
        text = await fetchText(src.url);
      } catch {
        text = await fetchText(src.fallbackUrl);
      }

      // Extract any GRI / rate mentions using regex
      const griMatches = [
        ...text.matchAll(/GRI[^$\d]{0,50}?\$\s*([\d,]+)/gi),
        ...text.matchAll(/\$([\d,]+)\s*(?:per|\/)\s*(?:TEU|FEU|container|box)/gi),
        ...text.matchAll(/rate[^$\d]{0,30}?\$\s*([\d,]+)/gi),
      ];

      const rates = griMatches
        .map(m => parseNumber(m[1]))
        .filter((r): r is number => r !== null && r > 200 && r < 20000);

      results.push({
        carrier: src.name,
        url: src.url,
        ratesFound: rates,
        rawSnippet: text.slice(0, 500),
        scrapedAt: new Date().toISOString(),
      });

      if (rates.length > 0) {
        const weekDate = new Date().toISOString().split("T")[0];
        await db.insert(marketIndexSnapshots).values({
          source: `carrier:${src.name.toLowerCase().replace(/\s+/g, "-")}`,
          tradeLane: `${src.name} Market Rate`,
          polRegion: "Various",
          podRegion: "West Africa",
          equipType: "40ft",
          rateUsd: String(rates[0]),
          weekDate,
          rawData: { carrier: src.name, allRates: rates, url: src.url },
        });
      }
    } catch (err: any) {
      results.push({
        carrier: src.name,
        url: src.url,
        ratesFound: [],
        error: err.message,
        scrapedAt: new Date().toISOString(),
      });
    }
  }

  return results;
}

interface CarrierResult {
  carrier: string;
  url: string;
  ratesFound: number[];
  rawSnippet?: string;
  error?: string;
  scrapedAt: string;
}

// ── ROUTES ───────────────────────────────────────────────────────────────────

// GET /api/market-intel/snapshots — latest snapshot per source+lane
marketIntelRouter.get("/market-intel/snapshots", async (req, res) => {
  const rows = await db
    .select()
    .from(marketIndexSnapshots)
    .orderBy(desc(marketIndexSnapshots.scrapedAt))
    .limit(100);

  // Deduplicate: keep only the latest per tradeLane+source
  const seen = new Set<string>();
  const latest = rows.filter(r => {
    const key = `${r.source}|${r.tradeLane}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  res.json(latest);
});

// POST /api/market-intel/scrape — trigger full scrape (A + B)
marketIntelRouter.post("/market-intel/scrape", async (req, res) => {
  const results: Record<string, any> = {};
  const errors: Record<string, string> = {};

  // Option A: Xeneta
  try {
    await scrapeXeneta();
    results.xeneta = "ok";
  } catch (e: any) {
    errors.xeneta = e.message;
  }

  // Option A: Drewry
  try {
    await scrapeDrewry();
    results.drewry = "ok";
  } catch (e: any) {
    errors.drewry = e.message;
  }

  // Option B: Carriers
  try {
    const carrierResults = await scrapeCarriers();
    results.carriers = carrierResults.map(r => ({
      carrier: r.carrier,
      ratesFound: r.ratesFound.length,
      error: r.error,
    }));
  } catch (e: any) {
    errors.carriers = e.message;
  }

  res.json({ ok: true, results, errors, scrapedAt: new Date().toISOString() });
});

// GET /api/market-intel/benchmarks — manual benchmarks (Option C)
marketIntelRouter.get("/market-intel/benchmarks", async (_req, res) => {
  const rows = await db
    .select()
    .from(rateBenchmarks)
    .orderBy(desc(rateBenchmarks.createdAt));
  res.json(rows);
});

// POST /api/market-intel/benchmarks — add manual benchmark
marketIntelRouter.post("/market-intel/benchmarks", async (req, res) => {
  const body = req.body as {
    laneName: string;
    polRegion: string;
    podRegion: string;
    equipType?: string;
    rate20ft?: number;
    rate40ft?: number;
    waAdjustmentPct?: number;
    validFrom?: string;
    source?: string;
    notes?: string;
  };

  if (!body.laneName || !body.polRegion || !body.podRegion) {
    return res.status(400).json({ error: "laneName, polRegion, podRegion are required" });
  }

  const [row] = await db.insert(rateBenchmarks).values({
    laneName: body.laneName,
    polRegion: body.polRegion,
    podRegion: body.podRegion,
    equipType: body.equipType || "40ft",
    rate20ft: body.rate20ft != null ? String(body.rate20ft) : null,
    rate40ft: body.rate40ft != null ? String(body.rate40ft) : null,
    waAdjustmentPct: body.waAdjustmentPct != null ? String(body.waAdjustmentPct) : "0",
    validFrom: body.validFrom || null,
    source: body.source || null,
    notes: body.notes || null,
  }).returning();

  res.status(201).json(row);
});

// PATCH /api/market-intel/benchmarks/:id — update benchmark
marketIntelRouter.patch("/market-intel/benchmarks/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  const body = req.body as Partial<{
    laneName: string; polRegion: string; podRegion: string;
    equipType: string; rate20ft: number; rate40ft: number;
    waAdjustmentPct: number; validFrom: string; source: string; notes: string;
  }>;

  const update: Record<string, any> = { updatedAt: new Date() };
  if (body.laneName)          update.laneName = body.laneName;
  if (body.polRegion)         update.polRegion = body.polRegion;
  if (body.podRegion)         update.podRegion = body.podRegion;
  if (body.equipType)         update.equipType = body.equipType;
  if (body.rate20ft != null)  update.rate20ft = String(body.rate20ft);
  if (body.rate40ft != null)  update.rate40ft = String(body.rate40ft);
  if (body.waAdjustmentPct != null) update.waAdjustmentPct = String(body.waAdjustmentPct);
  if (body.validFrom)         update.validFrom = body.validFrom;
  if (body.source)            update.source = body.source;
  if (body.notes != null)     update.notes = body.notes;

  const [row] = await db.update(rateBenchmarks).set(update).where(eq(rateBenchmarks.id, id)).returning();
  if (!row) return res.status(404).json({ error: "Not found" });
  res.json(row);
});

// DELETE /api/market-intel/benchmarks/:id
marketIntelRouter.delete("/market-intel/benchmarks/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  await db.delete(rateBenchmarks).where(eq(rateBenchmarks.id, id));
  res.json({ ok: true });
});

// ── MAERSK SPOT API CONNECTOR ─────────────────────────────────────────────────
// POST /api/market-intel/maersk-spot — fetch real spot rates from Maersk API
marketIntelRouter.post("/market-intel/maersk-spot", async (req, res) => {
  const { apiKey, polCode, podCode, equipmentCode } = req.body as {
    apiKey?: string; polCode?: string; podCode?: string; equipmentCode?: string;
  };

  const key = apiKey || process.env.MAERSK_API_KEY;
  if (!key) {
    return res.status(400).json({
      error: "no_api_key",
      message: "No Maersk API key provided. Register free at developer.maersk.com to get a Consumer-Key.",
      registerUrl: "https://developer.maersk.com/api-catalogue",
    });
  }
  if (!polCode || !podCode) {
    return res.status(400).json({ error: "polCode and podCode are required" });
  }

  try {
    const equip = equipmentCode || "22G1"; // 20' general purpose
    const equipCodes: Record<string, string[]> = {
      "20ft":  ["22G1"],
      "40ft":  ["42G1"],
      "40hc":  ["45G1"],
      "all":   ["22G1","42G1","45G1"],
    };
    const codes = equipCodes[equip] || ["22G1","42G1","45G1"];

    const offers: Array<{
      polCode: string; podCode: string; equipmentCode: string;
      price: number; currency: string; transitTime: number;
      validFrom: string; validTo: string; productName?: string;
    }> = [];

    for (const code of codes) {
      const url = `https://api.maersk.com/spot-rates/v2/offers?portOfLoad=${polCode}&portOfDischarge=${podCode}&equipmentCode=${code}&numberOfContainers=1`;
      const r = await fetch(url, {
        headers: {
          "Consumer-Key": key,
          "Accept": "application/json",
        },
        signal: AbortSignal.timeout(20000),
      });

      if (r.status === 401) {
        return res.status(401).json({
          error: "invalid_api_key",
          message: "Maersk API key rejected. Check your Consumer-Key at developer.maersk.com.",
        });
      }
      if (!r.ok) {
        const errText = await r.text().catch(() => "");
        req.log.warn({ status: r.status, body: errText }, "Maersk API non-200");
        continue;
      }

      const data = await r.json() as { offers?: Array<{
        price?: { amount?: number; currency?: string };
        transitTime?: number; validFrom?: string; validTo?: string;
        productName?: string; equipmentCode?: string;
      }> };

      for (const o of data.offers || []) {
        if (o.price?.amount) {
          offers.push({
            polCode, podCode,
            equipmentCode: o.equipmentCode || code,
            price: o.price.amount,
            currency: o.price.currency || "USD",
            transitTime: o.transitTime || 0,
            validFrom: o.validFrom || new Date().toISOString().slice(0, 10),
            validTo: o.validTo || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
            productName: o.productName,
          });
        }
      }
    }

    res.json({ offers, count: offers.length });
  } catch (err) {
    req.log.error({ err }, "Maersk Spot API fetch failed");
    res.status(502).json({ error: "Maersk API request failed", detail: String(err) });
  }
});

// POST /api/market-intel/maersk-spot/import — fetch from Maersk + save to ocean_freight_rates
marketIntelRouter.post("/market-intel/maersk-spot/import", async (req, res) => {
  const { apiKey, polCode, podCode, originCountry, destCountry } = req.body as {
    apiKey?: string; polCode?: string; podCode?: string;
    originCountry?: string; destCountry?: string;
  };

  const key = apiKey || process.env.MAERSK_API_KEY;
  if (!key) {
    return res.status(400).json({ error: "no_api_key", message: "Maersk API key required." });
  }
  if (!polCode || !podCode) {
    return res.status(400).json({ error: "polCode and podCode are required" });
  }

  try {
    // Fetch 20ft, 40ft, 40HC offers
    const equipMap: Record<string, keyof typeof insertRow> = {
      "22G1": "amount20ft", "42G1": "amount40ft", "45G1": "amount40hc",
    };
    type InsertRow = {
      carrier: string; polCode: string; podCode: string;
      originCountry: string | null; destCountry: string | null;
      rateType: string; commodityType: string; equipmentType: string;
      currency: string; amount20ft: string | null; amount40ft: string | null; amount40hc: string | null;
      transitTime: string | null; expiryDate: string; archived: boolean;
    };
    const insertRow: InsertRow = {
      carrier: "Maersk", polCode, podCode,
      originCountry: originCountry || null,
      destCountry: destCountry || null,
      rateType: "spot", commodityType: "general", equipmentType: "40ft",
      currency: "USD",
      amount20ft: null, amount40ft: null, amount40hc: null,
      transitTime: null,
      expiryDate: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      archived: false,
    };

    let transitTime = 0;
    let foundAny = false;

    for (const [isoCode, field] of Object.entries(equipMap)) {
      const url = `https://api.maersk.com/spot-rates/v2/offers?portOfLoad=${polCode}&portOfDischarge=${podCode}&equipmentCode=${isoCode}&numberOfContainers=1`;
      const r = await fetch(url, {
        headers: { "Consumer-Key": key, "Accept": "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) continue;
      const data = await r.json() as { offers?: Array<{
        price?: { amount?: number; currency?: string };
        transitTime?: number; validTo?: string;
      }> };
      const best = (data.offers || []).sort((a, b) => (a.price?.amount||0) - (b.price?.amount||0))[0];
      if (best?.price?.amount) {
        (insertRow as any)[field] = String(best.price.amount);
        if (best.transitTime) transitTime = best.transitTime;
        if (best.validTo) insertRow.expiryDate = best.validTo.slice(0, 10);
        if (best.price.currency) insertRow.currency = best.price.currency;
        foundAny = true;
      }
    }

    if (!foundAny) {
      return res.status(404).json({ error: "No rates returned by Maersk API for this route" });
    }

    if (transitTime) insertRow.transitTime = `${transitTime} days`;

    const [saved] = await db.insert(oceanFreightRates).values(insertRow).returning();
    res.status(201).json({ imported: 1, rate: saved });
  } catch (err) {
    req.log.error({ err }, "Maersk import failed");
    res.status(502).json({ error: "Import failed", detail: String(err) });
  }
});
