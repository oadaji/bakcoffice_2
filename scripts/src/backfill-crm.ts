/**
 * backfill-crm.ts
 * Populates the contacts table from existing emails, RFQs and quotes.
 * Safe to run multiple times — upserts on email (unique key).
 */
import { db, emailsTable, rfqsTable, quotesTable, contactsTable } from "@workspace/db";
import { eq, and, sql, desc } from "drizzle-orm";

async function main() {
  console.log("🔍  Scanning existing emails for customer contacts…");

  // 1. Pull all customer-rfq emails (unique senders)
  const emails = await db
    .select()
    .from(emailsTable)
    .where(eq(emailsTable.emailType, "customer-rfq"));

  // Deduplicate by fromEmail (keep most-recent per address)
  const byEmail = new Map<string, typeof emails[0]>();
  for (const e of emails) {
    const existing = byEmail.get(e.fromEmail.toLowerCase());
    if (!existing || e.receivedAt > existing.receivedAt) {
      byEmail.set(e.fromEmail.toLowerCase(), e);
    }
  }

  // 2. Pull all RFQs (for counts + company extraction from fields)
  const rfqs = await db.select().from(rfqsTable);
  const rfqCountByEmail = new Map<string, number>();
  const companyByEmail = new Map<string, string>();
  const lastSeenByEmail = new Map<string, Date>();

  for (const rfq of rfqs) {
    if (!rfq.emailId) continue;
    // Find the source email
    const srcEmail = emails.find(e => e.id === rfq.emailId);
    if (!srcEmail || srcEmail.emailType !== "customer-rfq") continue;
    const key = srcEmail.fromEmail.toLowerCase();

    rfqCountByEmail.set(key, (rfqCountByEmail.get(key) ?? 0) + 1);

    // Extract company from fields JSONB
    const fields = Array.isArray(rfq.fields) ? rfq.fields as Array<{k:string;v:string}> : [];
    const companyField = fields.find(f =>
      /^(company|shipper|consignee|customer)/i.test(f.k ?? "")
    );
    if (companyField?.v && companyField.v !== "not specified") {
      if (!companyByEmail.has(key)) companyByEmail.set(key, companyField.v);
    }

    // Track last-seen via email receivedAt
    const ts = srcEmail.receivedAt;
    const prev = lastSeenByEmail.get(key);
    if (!prev || ts > prev) lastSeenByEmail.set(key, ts);
  }

  // 3. Pull quote counts per customer email
  const quotes = await db.select().from(quotesTable);
  const quoteCountByEmail = new Map<string, number>();
  for (const q of quotes) {
    if (q.customerEmail) {
      const key = q.customerEmail.toLowerCase();
      quoteCountByEmail.set(key, (quoteCountByEmail.get(key) ?? 0) + 1);
    }
    // Also try matching by rfqId → email
    if (q.rfqId) {
      const rfq = rfqs.find(r => r.id === q.rfqId);
      if (rfq?.emailId) {
        const srcEmail = emails.find(e => e.id === rfq.emailId);
        if (srcEmail) {
          const key = srcEmail.fromEmail.toLowerCase();
          quoteCountByEmail.set(key, (quoteCountByEmail.get(key) ?? 0) + 1);
        }
      }
    }
  }

  // 4. Also include WhatsApp senders (source = 'whatsapp')
  const waEmails = await db
    .select()
    .from(emailsTable)
    .where(eq(emailsTable.source, "whatsapp"));

  const waByPhone = new Map<string, typeof waEmails[0]>();
  for (const e of waEmails) {
    const key = e.whatsappPhone ?? e.fromEmail;
    const existing = waByPhone.get(key);
    if (!existing || e.receivedAt > existing.receivedAt) {
      waByPhone.set(key, e);
    }
  }
  // Merge WA senders into byEmail using their fromEmail as key
  for (const [, e] of waByPhone) {
    const key = e.fromEmail.toLowerCase();
    if (!byEmail.has(key)) byEmail.set(key, e);
  }

  // 5. Upsert contacts
  let inserted = 0, updated = 0;
  for (const [emailKey, e] of byEmail) {
    const name = e.fromName || emailKey;
    const company = companyByEmail.get(emailKey) ?? null;
    const rfqCount = rfqCountByEmail.get(emailKey) ?? 0;
    const quoteCount = quoteCountByEmail.get(emailKey) ?? 0;
    const lastSeenAt = lastSeenByEmail.get(emailKey) ?? e.receivedAt ?? null;
    const source = e.source ?? "email";
    const phone = e.whatsappPhone ?? null;

    const existing = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(eq(contactsTable.email, e.fromEmail))
      .limit(1);

    if (existing.length > 0) {
      await db
        .update(contactsTable)
        .set({ name, company, phone, source, rfqCount, quoteCount, lastSeenAt, updatedAt: new Date() })
        .where(eq(contactsTable.email, e.fromEmail));
      updated++;
    } else {
      await db.insert(contactsTable).values({
        name,
        email: e.fromEmail,
        company,
        phone,
        source,
        rfqCount,
        quoteCount,
        lastSeenAt,
        updatedAt: new Date(),
      });
      inserted++;
    }
  }

  console.log(`✅  CRM backfill complete — ${inserted} inserted, ${updated} updated`);
  process.exit(0);
}

main().catch(err => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
