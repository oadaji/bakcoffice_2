import { pgTable, serial, text, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { emailsTable } from "./emails";

export const rfqsTable = pgTable("rfqs", {
  id: serial("id").primaryKey(),
  emailId: integer("email_id").references(() => emailsTable.id),
  ref: text("ref").notNull(),
  emailType: text("email_type").notNull().default("customer-rfq"),
  status: text("status").notNull().default("info_needed"),
  fields: jsonb("fields").notNull().default([]),
  missingFields: jsonb("missing_fields").notNull().default([]),
  followUpDraft: text("follow_up_draft"),
  notes: text("notes"),
  // Multi-shipment grouping — all RFQs split from the same source email share a groupId
  groupId: text("group_id"),
  groupIndex: integer("group_index"),
  groupTotal: integer("group_total"),
  sourceMessageId: text("source_message_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertRfqSchema = createInsertSchema(rfqsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type InsertRfq = z.infer<typeof insertRfqSchema>;
export type Rfq = typeof rfqsTable.$inferSelect;
