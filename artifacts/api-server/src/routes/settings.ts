import { Router, type IRouter } from "express";
import { db, appSettings } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// ── GET all settings (masks sensitive values) ─────────────────────────────────
router.get("/settings", async (req, res) => {
  try {
    const rows = await db.select().from(appSettings);
    const masked = rows.map(r => ({
      key: r.key,
      label: r.label,
      isSet: !!r.value,
      updatedAt: r.updatedAt,
    }));
    res.json(masked);
  } catch (err) {
    req.log.error({ err }, "Failed to get settings");
    res.status(500).json({ error: "Failed to get settings" });
  }
});

// ── PUT upsert a setting ──────────────────────────────────────────────────────
router.put("/settings/:key", async (req, res) => {
  try {
    const { key } = req.params;
    const { value, label } = req.body as { value?: string; label?: string };
    if (!value) {
      res.status(400).json({ error: "value is required" }); return;
    }
    const [row] = await db
      .insert(appSettings)
      .values({ key, value, label: label ?? key, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: appSettings.key,
        set: { value, label: label ?? key, updatedAt: new Date() },
      })
      .returning();
    res.json({ key: row.key, label: row.label, isSet: true, updatedAt: row.updatedAt });
  } catch (err) {
    req.log.error({ err }, "Failed to save setting");
    res.status(500).json({ error: "Failed to save setting" });
  }
});

// ── DELETE a setting ──────────────────────────────────────────────────────────
router.delete("/settings/:key", async (req, res) => {
  try {
    await db.delete(appSettings).where(eq(appSettings.key, req.params.key));
    res.json({ deleted: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete setting");
    res.status(500).json({ error: "Failed to delete setting" });
  }
});

// ── CMA-CGM SPOT RATE PROXY ───────────────────────────────────────────────────
router.get("/rates/spot/cma-cgm", async (req, res) => {
  try {
    const [setting] = await db
      .select()
      .from(appSettings)
      .where(eq(appSettings.key, "cma_cgm_api_key"));

    if (!setting?.value) {
      res.status(403).json({ error: "CMA-CGM API key not configured. Add it in Settings." });
      return;
    }

    const apiKey = setting.value;
    const { pol, pod, container, date } = req.query as {
      pol?: string; pod?: string; container?: string; date?: string;
    };

    if (!pol || !pod) {
      res.status(400).json({ error: "pol and pod query params are required" }); return;
    }

    // Map container size to CMA-CGM equipment codes
    const containerCodeMap: Record<string, string> = {
      "20ft": "22G1", "20FT": "22G1",
      "40ft": "42G1", "40FT": "42G1",
      "40hc": "L5G1", "40HC": "L5G1",
    };
    const containerCode = containerCodeMap[container ?? "40ft"] ?? "42G1";
    const departureDate = date ?? new Date().toISOString().split("T")[0];

    // CMA-CGM Spot Rate API
    const url = new URL("https://apis.cma-cgm.net/tariff/v1/freightrates");
    url.searchParams.set("originPortCode", pol.toUpperCase());
    url.searchParams.set("destinationPortCode", pod.toUpperCase());
    url.searchParams.set("containerCode", containerCode);
    url.searchParams.set("departureDate", departureDate);

    req.log.info({ pol, pod, containerCode, departureDate }, "Calling CMA-CGM API");

    const apiRes = await fetch(url.toString(), {
      headers: {
        "x-apikey": apiKey,
        "Accept": "application/json",
      },
    });

    const text = await apiRes.text();
    let data: unknown;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!apiRes.ok) {
      req.log.warn({ status: apiRes.status, data }, "CMA-CGM API error");
      res.status(apiRes.status).json({
        error: "CMA-CGM API returned an error",
        status: apiRes.status,
        detail: data,
      });
      return;
    }

    res.json({ source: "cma-cgm", pol, pod, containerCode, departureDate, data });
  } catch (err) {
    req.log.error({ err }, "CMA-CGM proxy error");
    res.status(500).json({ error: "Failed to reach CMA-CGM API", detail: String(err) });
  }
});

// ── CMA-CGM CONNECTION TEST ───────────────────────────────────────────────────
router.post("/rates/spot/cma-cgm/test", async (req, res) => {
  try {
    const { apiKey } = req.body as { apiKey?: string };
    const keyToTest = apiKey || (await db.select().from(appSettings)
      .where(eq(appSettings.key, "cma_cgm_api_key")).then(r => r[0]?.value));

    if (!keyToTest) {
      res.status(400).json({ ok: false, message: "No API key provided" }); return;
    }

    // Lightweight test call — fetch a known lane
    const url = new URL("https://apis.cma-cgm.net/tariff/v1/freightrates");
    url.searchParams.set("originPortCode", "CNSHA");
    url.searchParams.set("destinationPortCode", "FRMRS");
    url.searchParams.set("containerCode", "42G1");
    url.searchParams.set("departureDate", new Date().toISOString().split("T")[0]);

    const apiRes = await fetch(url.toString(), {
      headers: { "x-apikey": keyToTest, "Accept": "application/json" },
    });

    if (apiRes.status === 401 || apiRes.status === 403) {
      res.json({ ok: false, message: "Invalid API key — authentication failed" }); return;
    }
    if (apiRes.status === 404 || apiRes.status >= 200 && apiRes.status < 500) {
      res.json({ ok: true, message: "API key accepted (HTTP " + apiRes.status + ")" }); return;
    }
    res.json({ ok: false, message: "CMA-CGM returned HTTP " + apiRes.status });
  } catch (err) {
    res.json({ ok: false, message: "Could not reach CMA-CGM API: " + String(err) });
  }
});

export { router as settingsRouter };
