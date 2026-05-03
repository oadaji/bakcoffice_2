import { Router, type IRouter } from "express";
import { db, partnerOutreach } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/partner-outreach — list all records newest first
router.get("/partner-outreach", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(partnerOutreach)
      .orderBy(desc(partnerOutreach.sentAt));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list partner outreach");
    res.status(500).json({ error: String(err) });
  }
});

// POST /api/partner-outreach — save a new outreach record
router.post("/partner-outreach", async (req, res) => {
  const { partnerIds, partnerNames, partnerEmails, routes, subject, body } = req.body as {
    partnerIds: number[];
    partnerNames: string[];
    partnerEmails: string[];
    routes: Array<{ pol: string; pod: string; equip: string; commodity: string }>;
    subject: string;
    body: string;
  };
  if (!partnerIds?.length || !routes?.length || !subject || !body) {
    res.status(400).json({ error: "partnerIds, routes, subject, body are required" });
    return;
  }
  try {
    const [row] = await db
      .insert(partnerOutreach)
      .values({ partnerIds, partnerNames, partnerEmails, routes, subject, body })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create partner outreach");
    res.status(500).json({ error: String(err) });
  }
});

// PATCH /api/partner-outreach/:id — update status / response notes
router.patch("/partner-outreach/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { status, responseNotes } = req.body as { status?: string; responseNotes?: string };
  try {
    const updates: Record<string, unknown> = {};
    if (status) updates.status = status;
    if (responseNotes !== undefined) updates.responseNotes = responseNotes;
    if (status === "responded" && !updates.respondedAt) {
      updates.respondedAt = new Date();
    }
    const [row] = await db
      .update(partnerOutreach)
      .set(updates)
      .where(eq(partnerOutreach.id, id))
      .returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update partner outreach");
    res.status(500).json({ error: String(err) });
  }
});

export { router as outreachRouter };
