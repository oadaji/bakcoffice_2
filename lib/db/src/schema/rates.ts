import { pgTable, serial, text, timestamp, numeric, integer, jsonb, boolean, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { partnersTable } from "./partners";

export const ratesTable = pgTable("rates", {
  id: serial("id").primaryKey(),
  originPortCode: text("origin_port_code"),
  destinationPortCode: text("destination_port_code"),
  pol: text("pol").notNull(),
  pod: text("pod").notNull(),
  carrier: text("carrier"),
  scac: text("scac"),
  isAgentRate: boolean("is_agent_rate").notNull().default(false),
  cargoType: text("cargo_type"),
  rateType: text("rate_type"),
  inclusionType: text("inclusion_type"),
  commodityType: text("commodity_type"),
  commodityTypeField: text("commodity_type_field"),
  charge20ft: numeric("charge_20ft"),
  charge40ft: numeric("charge_40ft"),
  charge40hc: numeric("charge_40hc"),
  containerType: text("container_type"),
  freightRate: numeric("freight_rate"),
  commodity: text("commodity"),
  currency: text("currency").notNull().default("USD"),
  validFrom: timestamp("valid_from"),
  validTo: timestamp("valid_to"),
  sailingDate: timestamp("sailing_date"),
  freeTime: integer("free_time"),
  transitTime: integer("transit_time"),
  demurrageDays: integer("demurrage_days"),
  detentionDays: integer("detention_days"),
  avgMarketRate20ft: numeric("avg_market_rate_20ft"),
  avgMarketRate40ft: numeric("avg_market_rate_40ft"),
  partnerId: integer("partner_id").references(() => partnersTable.id),
  notes: text("notes"),
  breakdown: jsonb("breakdown").notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertRateSchema = createInsertSchema(ratesTable).omit({ id: true, createdAt: true });
export type InsertRate = z.infer<typeof insertRateSchema>;
export type Rate = typeof ratesTable.$inferSelect;

// ── OCEAN FREIGHT RATES ─────────────────────────────────────────────────────
export const oceanFreightRates = pgTable("ocean_freight_rates", {
  id: serial("id").primaryKey(),
  carrier: text("carrier").notNull(),
  polCode: text("pol_code").notNull(),
  originCountry: text("origin_country"),
  podCode: text("pod_code").notNull(),
  destCountry: text("dest_country"),
  commodityType: text("commodity_type").notNull().default("general"),
  equipmentType: text("equipment_type").notNull().default("40ft"),
  rateType: text("rate_type").notNull().default("all_in"),
  inclusionType: text("inclusion_type"),
  transitTime: text("transit_time"),
  freeTime: text("free_time"),
  currency: text("currency").notNull().default("USD"),
  amount20ft: numeric("amount_20ft", { precision: 12, scale: 2 }),
  amount40ft: numeric("amount_40ft", { precision: 12, scale: 2 }),
  amount40hc: numeric("amount_40hc", { precision: 12, scale: 2 }),
  expiryDate: date("expiry_date").notNull(),
  partnerId: integer("partner_id").references(() => partnersTable.id),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OceanFreightRate = typeof oceanFreightRates.$inferSelect;

// ── HAULAGE IMPORT RATES ─────────────────────────────────────────────────────
export const haulageImportRates = pgTable("haulage_import_rates", {
  id: serial("id").primaryKey(),
  terminalName: text("terminal_name").notNull(),
  portCode: text("port_code").notNull(),
  originState: text("origin_state"),
  destCity: text("dest_city"),
  destLga: text("dest_lga").notNull(),
  destState: text("dest_state"),
  shipmentType: text("shipment_type").notNull().default("fcl"),
  equipmentType: text("equipment_type").notNull().default("40ft"),
  commodityType: text("commodity_type").notNull().default("general"),
  currency: text("currency").notNull().default("NGN"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type HaulageImportRate = typeof haulageImportRates.$inferSelect;

// ── HAULAGE EXPORT RATES ─────────────────────────────────────────────────────
export const haulageExportRates = pgTable("haulage_export_rates", {
  id: serial("id").primaryKey(),
  terminalName: text("terminal_name").notNull(),
  portCode: text("port_code").notNull(),
  originState: text("origin_state").notNull(),
  originCity: text("origin_city"),
  originLga: text("origin_lga").notNull(),
  destState: text("dest_state"),
  shipmentType: text("shipment_type").notNull().default("fcl"),
  equipmentType: text("equipment_type").notNull().default("40ft"),
  commodityType: text("commodity_type").notNull().default("general"),
  currency: text("currency").notNull().default("NGN"),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type HaulageExportRate = typeof haulageExportRates.$inferSelect;

// ── OTHER CHARGES ─────────────────────────────────────────────────────────────
export const otherCharges = pgTable("other_charges", {
  id: serial("id").primaryKey(),
  itemName: text("item_name").notNull(),
  shipmentType: text("shipment_type").notNull().default("both"),
  itemCategory: text("item_category").notNull(),
  commodityType: text("commodity_type").notNull().default("FAK"),
  country: text("country"),
  currency: text("currency").notNull().default("NGN"),
  price: numeric("price", { precision: 12, scale: 2 }),
  asPerReceipt: boolean("as_per_receipt").notNull().default(false),
  expiryDate: date("expiry_date"),
  archived: boolean("archived").notNull().default(false),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type OtherCharge = typeof otherCharges.$inferSelect;

// ── MARKET INDEX SNAPSHOTS (Option A — scraped indices) ──────────────────────
export const marketIndexSnapshots = pgTable("market_index_snapshots", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(),          // 'xeneta', 'drewry', 'fbx', 'carrier'
  tradeLane: text("trade_lane").notNull(),    // e.g. "Far East → N.Europe"
  polRegion: text("pol_region"),             // origin region
  podRegion: text("pod_region"),             // destination region
  equipType: text("equip_type").notNull().default("40ft"),
  rateUsd: numeric("rate_usd", { precision: 12, scale: 2 }),
  wowChangePct: numeric("wow_change_pct", { precision: 6, scale: 2 }),
  momChangePct: numeric("mom_change_pct", { precision: 6, scale: 2 }),
  weekDate: date("week_date"),
  rawData: jsonb("raw_data").notNull().default({}),
  scrapedAt: timestamp("scraped_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type MarketIndexSnapshot = typeof marketIndexSnapshots.$inferSelect;

// ── RATE BENCHMARKS (Option C — manual market benchmarks) ────────────────────
export const rateBenchmarks = pgTable("rate_benchmarks", {
  id: serial("id").primaryKey(),
  laneName: text("lane_name").notNull(),     // e.g. "China → Lagos"
  polRegion: text("pol_region").notNull(),   // "Far East", "N.Europe", "Med", "Americas"
  podRegion: text("pod_region").notNull(),   // "West Africa"
  equipType: text("equip_type").notNull().default("40ft"),
  rate20ft: numeric("rate_20ft", { precision: 12, scale: 2 }),
  rate40ft: numeric("rate_40ft", { precision: 12, scale: 2 }),
  waAdjustmentPct: numeric("wa_adjustment_pct", { precision: 6, scale: 2 }).default("0"),
  validFrom: date("valid_from"),
  source: text("source"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type RateBenchmark = typeof rateBenchmarks.$inferSelect;

// ── PARTNER OUTREACH ─────────────────────────────────────────────────────────
export const partnerOutreach = pgTable("partner_outreach", {
  id: serial("id").primaryKey(),
  partnerIds: jsonb("partner_ids").notNull().default([]),
  partnerNames: jsonb("partner_names").notNull().default([]),
  partnerEmails: jsonb("partner_emails").notNull().default([]),
  routes: jsonb("routes").notNull().default([]),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("sent"),
  responseNotes: text("response_notes"),
  respondedAt: timestamp("responded_at"),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type PartnerOutreach = typeof partnerOutreach.$inferSelect;
