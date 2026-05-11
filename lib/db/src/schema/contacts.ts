import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";

export const contactsTable = pgTable("contacts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  company: text("company"),
  phone: text("phone"),
  source: text("source").notNull().default("email"),
  rfqCount: integer("rfq_count").notNull().default(0),
  quoteCount: integer("quote_count").notNull().default(0),
  lastSeenAt: timestamp("last_seen_at"),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type Contact = typeof contactsTable.$inferSelect;
export type InsertContact = typeof contactsTable.$inferInsert;
