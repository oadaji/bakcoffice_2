/**
 * seed-crm.ts
 * Seeds companies and contacts tables with realistic freight-industry fake data.
 * Idempotent — skips rows where domain/email already exists.
 */
import { db, companiesTable, contactsTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const companies = [
  {
    name: "Royal Foam Nigeria Ltd",
    domain: "royalfoamng.com",
    industry: "Manufacturing",
    city: "Lagos",
    state: "Lagos",
    country: "Nigeria",
    phone: "+234 1 774 0000",
    website: "https://royalfoamng.com",
    tradeCorridors: ["China→Nigeria", "Turkey→Nigeria"],
    cargoTypes: ["Raw materials", "Chemicals", "Foam blocks"],
    tags: ["key-account", "regular"],
    notes: "Monthly 40HC shipments from Guangzhou. Primary contact is Emeka.",
  },
  {
    name: "Dankuru Industries Ltd",
    domain: "dankuru.com.ng",
    industry: "FMCG / Distribution",
    city: "Kano",
    state: "Kano",
    country: "Nigeria",
    phone: "+234 64 300 100",
    website: "https://dankuru.com.ng",
    tradeCorridors: ["India→Nigeria", "Dubai→Nigeria"],
    cargoTypes: ["Consumer goods", "Electronics", "Textiles"],
    tags: ["north-nigeria", "high-volume"],
    notes: "Distributes across Kano, Kaduna and Abuja. Prefer air + sea combo.",
  },
  {
    name: "Nwosu Agro Commodities",
    domain: "nwosuagro.com.ng",
    industry: "Agriculture / Export",
    city: "Onitsha",
    state: "Anambra",
    country: "Nigeria",
    phone: "+234 46 210 555",
    website: "https://nwosuagro.com.ng",
    tradeCorridors: ["Nigeria→Europe", "Nigeria→Asia"],
    cargoTypes: ["Cashew nuts", "Sesame seeds", "Cocoa beans"],
    tags: ["exporter", "seasonal"],
    notes: "Peak season Feb–May (cashew). Requires phytosanitary docs.",
  },
  {
    name: "Sarten Packaging A.Ş.",
    domain: "sarten.com.tr",
    industry: "Packaging / Manufacturing",
    city: "Istanbul",
    state: "Istanbul",
    country: "Turkey",
    phone: "+90 212 438 0000",
    website: "https://sarten.com.tr",
    tradeCorridors: ["Turkey→Nigeria", "Turkey→Ghana"],
    cargoTypes: ["Aerosol cans", "Metal packaging", "Industrial containers"],
    tags: ["international", "repeat"],
    notes: "Ships from Ambarlı port. DDP to Lagos required. ~1×20FT/month.",
  },
  {
    name: "Greenfield Shipping & Logistics",
    domain: "greenfield-logistics.ng",
    industry: "Freight Forwarding",
    city: "Apapa",
    state: "Lagos",
    country: "Nigeria",
    phone: "+234 1 580 2200",
    website: "https://greenfield-logistics.ng",
    tradeCorridors: ["Nigeria→UAE", "Nigeria→China", "USA→Nigeria"],
    cargoTypes: ["General cargo", "Project cargo", "Dangerous goods"],
    tags: ["partner", "forwarder"],
    notes: "Local partner for last-mile in Apapa and Tin Can.",
  },
  {
    name: "Meridian Foods International",
    domain: "meridianfoods.com",
    industry: "Food & Beverages",
    city: "Rotterdam",
    state: "South Holland",
    country: "Netherlands",
    phone: "+31 10 412 9900",
    website: "https://meridianfoods.com",
    tradeCorridors: ["Netherlands→Nigeria", "Nigeria→EU"],
    cargoTypes: ["Frozen foods", "Dairy", "Processed foods"],
    tags: ["europe", "cold-chain"],
    notes: "Requires reefer containers. Seasonal volume Oct–Dec.",
  },
  {
    name: "Kingsway Trading Co.",
    domain: "kingstrade.com.ng",
    industry: "Import / General Trade",
    city: "Lagos",
    state: "Lagos",
    country: "Nigeria",
    phone: "+234 1 463 7711",
    website: "https://kingstrade.com.ng",
    tradeCorridors: ["China→Nigeria", "Hong Kong→Nigeria"],
    cargoTypes: ["Electronics", "Household appliances", "Spare parts"],
    tags: ["importer", "spot"],
    notes: "Frequent spot enquiries. Price-sensitive. Volume varies.",
  },
  {
    name: "PetroVast Nigeria Ltd",
    domain: "petrovast.ng",
    industry: "Oil & Gas / Energy",
    city: "Port Harcourt",
    state: "Rivers",
    country: "Nigeria",
    phone: "+234 84 230 400",
    website: "https://petrovast.ng",
    tradeCorridors: ["USA→Nigeria", "Germany→Nigeria"],
    cargoTypes: ["Oilfield equipment", "Pipes", "Machinery"],
    tags: ["project-cargo", "high-value"],
    notes: "OOG and breakbulk experience required. SPAs with 60-day terms.",
  },
  {
    name: "Guangzhou Nexlink Trading",
    domain: "nexlink.com.cn",
    industry: "Manufacturing / Export",
    city: "Guangzhou",
    state: "Guangdong",
    country: "China",
    phone: "+86 20 3888 5500",
    website: "https://nexlink.com.cn",
    tradeCorridors: ["China→Nigeria", "China→Ghana", "China→Cameroon"],
    cargoTypes: ["Textiles", "Consumer goods", "Building materials"],
    tags: ["china", "high-volume"],
    notes: "Ships FCL and LCL. Prefers Hapag/MSC to NGAPP.",
  },
  {
    name: "Afropharma Distribution",
    domain: "afropharma.ng",
    industry: "Pharmaceuticals",
    city: "Ikeja",
    state: "Lagos",
    country: "Nigeria",
    phone: "+234 1 291 6600",
    website: "https://afropharma.ng",
    tradeCorridors: ["India→Nigeria", "Belgium→Nigeria"],
    cargoTypes: ["Pharmaceuticals", "Medical devices", "Lab reagents"],
    tags: ["pharma", "temperature-sensitive"],
    notes: "GDP-compliant cold chain required. NAFDAC clearance support.",
  },
  {
    name: "Delta Steel Works",
    domain: "deltasteelworks.ng",
    industry: "Steel / Construction",
    city: "Warri",
    state: "Delta",
    country: "Nigeria",
    phone: "+234 53 250 800",
    website: "https://deltasteelworks.ng",
    tradeCorridors: ["China→Nigeria", "Ukraine→Nigeria", "India→Nigeria"],
    cargoTypes: ["Steel coils", "Iron rods", "Structural steel"],
    tags: ["heavy-cargo", "warri"],
    notes: "Imports via Warri port (NGWAR). 3–5 containers/month.",
  },
  {
    name: "Harvest Moon Cocoa",
    domain: "harvestmooncocoa.com",
    industry: "Agriculture / Export",
    city: "Ibadan",
    state: "Oyo",
    country: "Nigeria",
    phone: "+234 2 819 4400",
    website: "https://harvestmooncocoa.com",
    tradeCorridors: ["Nigeria→Netherlands", "Nigeria→Belgium"],
    cargoTypes: ["Cocoa beans", "Cocoa butter", "Cocoa powder"],
    tags: ["exporter", "bulk"],
    notes: "Exports from Tin Can and Apapa. ICO certified supplier.",
  },
];

// Contacts use the DB schema: name, email, company, phone, source, notes
const contacts: Array<{
  name: string;
  email: string;
  company: string;
  phone?: string;
  source: string;
  notes?: string;
}> = [
  // Royal Foam
  { name: "Emeka Eze", email: "emeka.eze@royalfoamng.com", company: "Royal Foam Nigeria Ltd", phone: "+234 803 400 1122", source: "email", notes: "Main point of contact. Decision-maker. Responsive on WhatsApp." },
  { name: "Chidi Okeke", email: "chidi.okeke@royalfoamng.com", company: "Royal Foam Nigeria Ltd", phone: "+234 706 211 0033", source: "email", notes: "Procurement Officer" },
  // Dankuru
  { name: "Tunde Fashola", email: "tunde.fashola@dankuru.com.ng", company: "Dankuru Industries Ltd", phone: "+234 802 553 7788", source: "email", notes: "Head of Supply Chain" },
  { name: "Hauwa Musa", email: "hauwa.musa@dankuru.com.ng", company: "Dankuru Industries Ltd", phone: "+234 703 890 2211", source: "email", notes: "Clearing & Forwarding Coordinator" },
  // Nwosu Agro
  { name: "Adaeze Nwosu", email: "adaeze.nwosu@nwosuagro.com.ng", company: "Nwosu Agro Commodities", phone: "+234 806 441 9900", source: "whatsapp", notes: "Managing Director. Owner." },
  { name: "Chukwuemeka Okafor", email: "c.okafor@nwosuagro.com.ng", company: "Nwosu Agro Commodities", phone: "+234 812 200 3344", source: "email", notes: "Export Officer" },
  // Sarten
  { name: "Demir Güzel", email: "demirguzel@sarten.com.tr", company: "Sarten Packaging A.Ş.", phone: "+90 533 210 8899", source: "email", notes: "International Logistics Coordinator" },
  { name: "Aylin Çelik", email: "aylin.celik@sarten.com.tr", company: "Sarten Packaging A.Ş.", phone: "+90 542 100 2200", source: "email", notes: "Export Documentation Specialist" },
  // Greenfield
  { name: "Biodun Adeyinka", email: "biodun@greenfield-logistics.ng", company: "Greenfield Shipping & Logistics", phone: "+234 801 335 5566", source: "email", notes: "Operations Director. Partner contact." },
  { name: "Ngozi Ibe", email: "ngozi.ibe@greenfield-logistics.ng", company: "Greenfield Shipping & Logistics", phone: "+234 708 221 4477", source: "whatsapp", notes: "Customer Service Lead" },
  // Meridian Foods
  { name: "Lars van den Berg", email: "l.vandenberg@meridianfoods.com", company: "Meridian Foods International", phone: "+31 6 2233 4455", source: "email", notes: "Procurement & Logistics Manager" },
  { name: "Sophie Dekker", email: "s.dekker@meridianfoods.com", company: "Meridian Foods International", phone: "+31 6 8877 1122", source: "email", notes: "Trade Compliance Officer" },
  // Kingsway
  { name: "Yusuf Bello", email: "yusuf.bello@kingstrade.com.ng", company: "Kingsway Trading Co.", phone: "+234 805 667 2200", source: "email", notes: "General Manager" },
  { name: "Fatima Aliyu", email: "fatima.a@kingstrade.com.ng", company: "Kingsway Trading Co.", phone: "+234 907 334 5511", source: "email", notes: "Shipping Coordinator" },
  // PetroVast
  { name: "Chukwudi Obi", email: "c.obi@petrovast.ng", company: "PetroVast Nigeria Ltd", phone: "+234 803 199 7766", source: "email", notes: "Logistics & Procurement Manager" },
  { name: "Remi Adeleke", email: "r.adeleke@petrovast.ng", company: "PetroVast Nigeria Ltd", phone: "+234 706 850 1122", source: "email", notes: "Project Cargo Coordinator" },
  // Nexlink
  { name: "Wang Fang", email: "wangfang@nexlink.com.cn", company: "Guangzhou Nexlink Trading", phone: "+86 139 2288 4400", source: "email", notes: "Export Sales Manager" },
  { name: "Kevin Chen", email: "kevin.chen@nexlink.com.cn", company: "Guangzhou Nexlink Trading", phone: "+86 135 1100 6677", source: "whatsapp", notes: "Logistics Coordinator" },
  // Afropharma
  { name: "Ifeoma Nwachukwu", email: "i.nwachukwu@afropharma.ng", company: "Afropharma Distribution", phone: "+234 803 740 5500", source: "email", notes: "Supply Chain Director" },
  { name: "Segun Adebayo", email: "s.adebayo@afropharma.ng", company: "Afropharma Distribution", phone: "+234 810 290 6633", source: "email", notes: "Regulatory & Logistics Officer" },
  // Delta Steel
  { name: "Ovie Erhirhie", email: "ovie.e@deltasteelworks.ng", company: "Delta Steel Works", phone: "+234 805 430 8811", source: "whatsapp", notes: "Import Manager" },
  { name: "Grace Oghenero", email: "grace.o@deltasteelworks.ng", company: "Delta Steel Works", phone: "+234 703 510 2200", source: "email", notes: "Admin & Documentation" },
  // Harvest Moon
  { name: "Olabisi Akin-Peters", email: "olabisi@harvestmooncocoa.com", company: "Harvest Moon Cocoa", phone: "+234 806 300 7744", source: "email", notes: "Export Director" },
  { name: "Taiwo Adegoke", email: "taiwo.adegoke@harvestmooncocoa.com", company: "Harvest Moon Cocoa", phone: "+234 908 210 5566", source: "email", notes: "Quality & Shipping Officer" },
];

async function main() {
  console.log("🌱  Seeding companies…");

  for (const co of companies) {
    const existing = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.domain, co.domain!))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  skip ${co.name} (already exists)`);
    } else {
      await db.insert(companiesTable).values(co);
      console.log(`  ✓  inserted ${co.name}`);
    }
  }

  console.log("\n🌱  Seeding contacts…");
  let inserted = 0, skipped = 0;

  for (const ct of contacts) {
    const existing = await db
      .select({ id: contactsTable.id })
      .from(contactsTable)
      .where(eq(contactsTable.email, ct.email))
      .limit(1);

    if (existing.length > 0) {
      skipped++;
      continue;
    }

    await db.insert(contactsTable).values({ ...ct, updatedAt: new Date() });
    inserted++;
  }

  console.log(`\n✅  Done — ${companies.length} companies processed, ${inserted} contacts inserted, ${skipped} skipped`);
  process.exit(0);
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
