import { pgTable, serial, text, timestamp, numeric, integer, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const ratesTable = pgTable("rates", {
  id: serial("id").primaryKey(),

  // Route
  originPortCode: text("origin_port_code"),          // LOCODE e.g. "NGAPP"
  destinationPortCode: text("destination_port_code"), // LOCODE e.g. "CNSHA"
  pol: text("pol").notNull(),                         // human-readable origin name
  pod: text("pod").notNull(),                         // human-readable destination name

  // Carrier
  carrier: text("carrier"),
  scac: text("scac"),                                 // carrier SCAC code e.g. "MSCU"
  isAgentRate: boolean("is_agent_rate").notNull().default(false),

  // Cargo & rate classification
  cargoType: text("cargo_type"),                      // "dry" | "reefer"
  rateType: text("rate_type"),                        // "standard" | "spot" | "contract"
  inclusionType: text("inclusion_type"),              // "imported" | "manual" | "integrated"
  commodityType: text("commodity_type"),              // "fak" | "others"
  commodityTypeField: text("commodity_type_field"),   // free-text commodity description

  // Per-size charges (new — replaces single freightRate for multi-size records)
  charge20ft: numeric("charge_20ft"),
  charge40ft: numeric("charge_40ft"),
  charge40hc: numeric("charge_40hc"),

  // Legacy single-rate field (kept for backward compat with existing records)
  containerType: text("container_type"),              // "20FT" | "40FT" | "40HC" | "LCL"
  freightRate: numeric("freight_rate"),               // base ocean freight USD (legacy)

  commodity: text("commodity"),                       // legacy cargo filter
  currency: text("currency").notNull().default("USD"),

  // Time fields
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  sailingDate: timestamp("sailing_date"),

  // Days
  freeTime: integer("free_time"),                     // free days at destination
  transitTime: integer("transit_time"),               // transit days
  demurrageDays: integer("demurrage_days"),
  detentionDays: integer("detention_days"),

  // Market reference
  avgMarketRate20ft: numeric("avg_market_rate_20ft"),
  avgMarketRate40ft: numeric("avg_market_rate_40ft"),

  // Relations & metadata
  partnerId: integer("partner_id").references(() => partnersTable.id),
  notes: text("notes"),
  breakdown: jsonb("breakdown").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRateSchema = createInsertSchema(ratesTable).omit({
  id: true,
  createdAt: true,
});

export type InsertRate = z.infer<typeof insertRateSchema>;
export type Rate = typeof ratesTable.$inferSelect;
