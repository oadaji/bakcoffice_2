import { Router, type IRouter } from "express";
import { db, partnersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// GET /api/partners
router.get("/partners", async (req, res) => {
  try {
    const rows = await db
      .select()
      .from(partnersTable)
      .orderBy(partnersTable.name);
    res.json(rows);
  } catch (err) {
    req.log.error({ err }, "Failed to list partners");
    res.status(500).json({ error: "Failed to list partners" });
  }
});

// POST /api/partners
router.post("/partners", async (req, res) => {
  try {
    const { name, email, categories = [], tradelanes = [], notes } = req.body as {
      name: string;
      email: string;
      categories?: string[];
      tradelanes?: string[];
      notes?: string;
    };
    if (!name || !email) {
      res.status(400).json({ error: "name and email are required" });
      return;
    }
    const [partner] = await db
      .insert(partnersTable)
      .values({ name, email, categories, tradelanes, notes: notes ?? null })
      .returning();
    res.status(201).json(partner);
  } catch (err) {
    req.log.error({ err }, "Failed to create partner");
    res.status(500).json({ error: "Failed to create partner" });
  }
});

// PATCH /api/partners/:id
router.patch("/partners/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { name, email, categories, tradelanes, notes, active } = req.body as {
      name?: string;
      email?: string;
      categories?: string[];
      tradelanes?: string[];
      notes?: string;
      active?: boolean;
    };
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email;
    if (categories !== undefined) updates.categories = categories;
    if (tradelanes !== undefined) updates.tradelanes = tradelanes;
    if (notes !== undefined) updates.notes = notes;
    if (active !== undefined) updates.active = active;

    const [updated] = await db
      .update(partnersTable)
      .set(updates)
      .where(eq(partnersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }
    res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Failed to update partner");
    res.status(500).json({ error: "Failed to update partner" });
  }
});

// DELETE /api/partners/:id — soft delete (set active=false)
router.delete("/partners/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const [updated] = await db
      .update(partnersTable)
      .set({ active: false })
      .where(eq(partnersTable.id, id))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Partner not found" });
      return;
    }
    res.json({ deactivated: true });
  } catch (err) {
    req.log.error({ err }, "Failed to deactivate partner");
    res.status(500).json({ error: "Failed to deactivate partner" });
  }
});

export { router as partnersRouter };
