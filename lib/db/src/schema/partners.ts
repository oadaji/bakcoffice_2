import { pgTable, serial, text, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const partnersTable = pgTable("partners", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  // e.g. ["FCL", "LCL", "AIR", "RORO", "REEFER", "DG", "BREAKBULK"]
  categories: jsonb("categories").notNull().default([]),
  // Optional tradelane tags e.g. ["WAF", "EAF", "NGAPP-CNTAO"]
  tradelanes: jsonb("tradelanes").notNull().default([]),
  notes: text("notes"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPartnerSchema = createInsertSchema(partnersTable).omit({
  id: true,
  createdAt: true,
});

export type InsertPartner = z.infer<typeof insertPartnerSchema>;
export type Partner = typeof partnersTable.$inferSelect;
