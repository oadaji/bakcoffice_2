import { pgTable, serial, text, timestamp, numeric, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const ratesTable = pgTable("rates", {
  id: serial("id").primaryKey(),
  pol: text("pol").notNull(),
  pod: text("pod").notNull(),
  containerType: text("container_type"),        // "20FT", "40FT", "40HC", "LCL", "AIR"
  commodity: text("commodity"),                 // optional cargo filter
  freightRate: numeric("freight_rate"),          // base ocean freight USD
  currency: text("currency").notNull().default("USD"),
  carrier: text("carrier"),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  partnerId: integer("partner_id").references(() => partnersTable.id),
  notes: text("notes"),
  // Optional cost breakdown: { ocean, originCharges, destinationCharges, thc, blFee, other }
  breakdown: jsonb("breakdown").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRateSchema = createInsertSchema(ratesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRate = z.infer<typeof insertRateSchema>;
export type Rate = typeof ratesTable.$inferSelect;
