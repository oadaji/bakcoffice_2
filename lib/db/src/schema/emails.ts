import { pgTable, serial, text, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const emailsTable = pgTable("emails", {
  id: serial("id").primaryKey(),
  uid: text("uid").unique().notNull(),
  fromName: text("from_name").notNull(),
  fromEmail: text("from_email").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  receivedAt: timestamp("received_at").notNull().defaultNow(),
  emailType: text("email_type").notNull().default("customer-rfq"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  // Threading
  messageId: text("message_id"),
  inReplyTo: text("in_reply_to"),
  parentEmailId: integer("parent_email_id"),
  // Recipients
  cc: text("cc"),
  // Multi-inbox tracking
  receivedInbox: text("received_inbox"),
  // Source channel: 'email' (default) or 'whatsapp'
  source: text("source").notNull().default("email"),
  // WhatsApp phone number (set when source = 'whatsapp')
  whatsappPhone: text("whatsapp_phone"),
});

export const insertEmailSchema = createInsertSchema(emailsTable).omit({
  id: true,
  createdAt: true,
});

export type InsertEmail = z.infer<typeof insertEmailSchema>;
export type Email = typeof emailsTable.$inferSelect;

// ── EMAIL ACCOUNTS (multi-inbox monitoring) ────────────────────────────────────
export const emailAccounts = pgTable("email_accounts", {
  id: serial("id").primaryKey(),
  label: text("label"),
  email: text("email").notNull().unique(),
  provider: text("provider").notNull().default("gmail"), // 'gmail' | 'outlook' | 'imap'
  imapHost: text("imap_host"),
  imapPort: integer("imap_port"),
  password: text("password").notNull(),
  active: boolean("active").notNull().default(true),
  lastSyncedAt: timestamp("last_synced_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type EmailAccount = typeof emailAccounts.$inferSelect;
