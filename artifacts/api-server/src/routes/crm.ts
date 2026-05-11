import { Router, type IRouter } from "express";
import { db, companiesTable, contactsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";

const router: IRouter = Router();

// ── COMPANIES ─────────────────────────────────────────────────────────────────

// GET /api/companies
router.get("/companies", async (req, res) => {
  try {
    const rows = await db.select().from(companiesTable).orderBy(asc(companiesTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list companies");
    res.status(500).json({ error: "Failed to list companies" });
  }
});

// GET /api/companies/:id
router.get("/companies/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(companiesTable).where(eq(companiesTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to get company");
    res.status(500).json({ error: "Failed to get company" });
  }
});

// POST /api/companies
router.post("/companies", async (req, res) => {
  try {
    const data = req.body as typeof companiesTable.$inferInsert;
    const [row] = await db.insert(companiesTable).values(data).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create company");
    res.status(500).json({ error: "Failed to create company" });
  }
});

// PATCH /api/companies/:id
router.patch("/companies/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const patch = { ...req.body, updatedAt: new Date() } as Partial<typeof companiesTable.$inferInsert>;
    const [row] = await db.update(companiesTable).set(patch).where(eq(companiesTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update company");
    res.status(500).json({ error: "Failed to update company" });
  }
});

// DELETE /api/companies/:id
router.delete("/companies/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(companiesTable).where(eq(companiesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete company");
    res.status(500).json({ error: "Failed to delete company" });
  }
});

// ── CONTACTS ──────────────────────────────────────────────────────────────────

// GET /api/contacts  (optionally filter by ?company=)
router.get("/contacts", async (req, res) => {
  try {
    const { company } = req.query;
    const rows = company
      ? await db.select().from(contactsTable).where(eq(contactsTable.company, company as string)).orderBy(asc(contactsTable.name))
      : await db.select().from(contactsTable).orderBy(asc(contactsTable.name));
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list contacts");
    res.status(500).json({ error: "Failed to list contacts" });
  }
});

// GET /api/contacts/:id
router.get("/contacts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const [row] = await db.select().from(contactsTable).where(eq(contactsTable.id, id));
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to get contact");
    res.status(500).json({ error: "Failed to get contact" });
  }
});

// POST /api/contacts
router.post("/contacts", async (req, res) => {
  try {
    const data = req.body as typeof contactsTable.$inferInsert;
    const [row] = await db.insert(contactsTable).values(data).returning();
    res.status(201).json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to create contact");
    res.status(500).json({ error: "Failed to create contact" });
  }
});

// PATCH /api/contacts/:id
router.patch("/contacts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const patch = { ...req.body, updatedAt: new Date() } as Partial<typeof contactsTable.$inferInsert>;
    const [row] = await db.update(contactsTable).set(patch).where(eq(contactsTable.id, id)).returning();
    if (!row) { res.status(404).json({ error: "Not found" }); return; }
    res.json(row);
  } catch (err) {
    req.log.error({ err }, "Failed to update contact");
    res.status(500).json({ error: "Failed to update contact" });
  }
});

// DELETE /api/contacts/:id
router.delete("/contacts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    await db.delete(contactsTable).where(eq(contactsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete contact");
    res.status(500).json({ error: "Failed to delete contact" });
  }
});

export { router as crmRouter };
