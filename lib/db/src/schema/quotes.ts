import { pgTable, serial, text, timestamp, integer, jsonb, boolean, numeric } from "drizzle-orm/pg-core";
import { rfqsTable } from "./rfqs";

export const quotesTable = pgTable("quotes", {
  id: serial("id").primaryKey(),
  quoteRef: text("quote_ref").notNull(),
  rfqId: integer("rfq_id").references(() => rfqsTable.id),
  rfqRef: text("rfq_ref"),
  status: text("status").notNull().default("draft"),
  customerName: text("customer_name"),
  companyName: text("company_name"),
  customerEmail: text("customer_email"),
  pol: text("pol"),
  pod: text("pod"),
  polCode: text("pol_code"),
  podCode: text("pod_code"),
  commodity: text("commodity"),
  containerType: text("container_type"),
  containerQty: integer("container_qty").default(1),
  carrier: text("carrier"),
  oceanLine: jsonb("ocean_line").default({}),
  oceanOptions: jsonb("ocean_options").default([]),
  originCharges: jsonb("origin_charges").default([]),
  destCharges: jsonb("dest_charges").default([]),
  availableCharges: jsonb("available_charges").default([]),
  haulage: jsonb("haulage"),
  hasSuggestedHaulage: boolean("has_suggested_haulage").default(false),
  exchangeRate: numeric("exchange_rate", { precision: 10, scale: 2 }).default("1600"),
  marginPct: numeric("margin_pct", { precision: 5, scale: 2 }).default("13"),
  totalCostUSD: numeric("total_cost_usd", { precision: 12, scale: 2 }),
  sellPriceUSD: numeric("sell_price_usd", { precision: 12, scale: 2 }),
  aiNotes: text("ai_notes"),
  notes: text("notes"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Quote = typeof quotesTable.$inferSelect;
