import { pgTable, serial, text, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const companiesTable = pgTable("companies", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  domain: text("domain").unique(),
  industry: text("industry"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  country: text("country"),
  phone: text("phone"),
  website: text("website"),
  tradeCorridors: jsonb("trade_corridors").notNull().default([]),
  cargoTypes: jsonb("cargo_types").notNull().default([]),
  notes: text("notes"),
  tags: jsonb("tags").notNull().default([]),
  status: text("status").notNull().default("active"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
