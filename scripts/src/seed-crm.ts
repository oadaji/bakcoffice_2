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

const contacts: Array<{
  companyDomain: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  whatsappPhone?: string;
  jobTitle: string;
  role: string;
  isPrimary: boolean;
  source: string;
  tags: string[];
  notes?: string;
}> = [
  // Royal Foam
  { companyDomain: "royalfoamng.com", firstName: "Emeka", lastName: "Eze", email: "emeka.eze@royalfoamng.com", phone: "+234 803 400 1122", jobTitle: "Logistics Manager", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary"], notes: "Main point of contact. Responsive on WhatsApp." },
  { companyDomain: "royalfoamng.com", firstName: "Chidi", lastName: "Okeke", email: "chidi.okeke@royalfoamng.com", phone: "+234 706 211 0033", jobTitle: "Procurement Officer", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Dankuru Industries
  { companyDomain: "dankuru.com.ng", firstName: "Tunde", lastName: "Fashola", email: "tunde.fashola@dankuru.com.ng", phone: "+234 802 553 7788", jobTitle: "Head of Supply Chain", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary"] },
  { companyDomain: "dankuru.com.ng", firstName: "Hauwa", lastName: "Musa", email: "hauwa.musa@dankuru.com.ng", phone: "+234 703 890 2211", jobTitle: "Clearing & Forwarding Coordinator", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Nwosu Agro
  { companyDomain: "nwosuagro.com.ng", firstName: "Adaeze", lastName: "Nwosu", email: "adaeze.nwosu@nwosuagro.com.ng", phone: "+234 806 441 9900", whatsappPhone: "+2348064419900", jobTitle: "Managing Director", role: "decision-maker", isPrimary: true, source: "whatsapp", tags: ["primary", "owner"] },
  { companyDomain: "nwosuagro.com.ng", firstName: "Chukwuemeka", lastName: "Okafor", email: "c.okafor@nwosuagro.com.ng", phone: "+234 812 200 3344", jobTitle: "Export Officer", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Sarten
  { companyDomain: "sarten.com.tr", firstName: "Demir", lastName: "Güzel", email: "demirguzel@sarten.com.tr", phone: "+90 533 210 8899", jobTitle: "International Logistics Coordinator", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "turkey"] },
  { companyDomain: "sarten.com.tr", firstName: "Aylin", lastName: "Çelik", email: "aylin.celik@sarten.com.tr", phone: "+90 542 100 2200", jobTitle: "Export Documentation Specialist", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Greenfield Shipping
  { companyDomain: "greenfield-logistics.ng", firstName: "Biodun", lastName: "Adeyinka", email: "biodun@greenfield-logistics.ng", phone: "+234 801 335 5566", whatsappPhone: "+2348013355566", jobTitle: "Operations Director", role: "partner", isPrimary: true, source: "email", tags: ["partner", "primary"] },
  { companyDomain: "greenfield-logistics.ng", firstName: "Ngozi", lastName: "Ibe", email: "ngozi.ibe@greenfield-logistics.ng", phone: "+234 708 221 4477", jobTitle: "Customer Service Lead", role: "contact", isPrimary: false, source: "whatsapp", tags: [] },

  // Meridian Foods
  { companyDomain: "meridianfoods.com", firstName: "Lars", lastName: "van den Berg", email: "l.vandenberg@meridianfoods.com", phone: "+31 6 2233 4455", jobTitle: "Procurement & Logistics Manager", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "europe"] },
  { companyDomain: "meridianfoods.com", firstName: "Sophie", lastName: "Dekker", email: "s.dekker@meridianfoods.com", phone: "+31 6 8877 1122", jobTitle: "Trade Compliance Officer", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Kingsway Trading
  { companyDomain: "kingstrade.com.ng", firstName: "Yusuf", lastName: "Bello", email: "yusuf.bello@kingstrade.com.ng", phone: "+234 805 667 2200", jobTitle: "General Manager", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary"] },
  { companyDomain: "kingstrade.com.ng", firstName: "Fatima", lastName: "Aliyu", email: "fatima.a@kingstrade.com.ng", phone: "+234 907 334 5511", jobTitle: "Shipping Coordinator", role: "contact", isPrimary: false, source: "email", tags: [] },

  // PetroVast
  { companyDomain: "petrovast.ng", firstName: "Chukwudi", lastName: "Obi", email: "c.obi@petrovast.ng", phone: "+234 803 199 7766", jobTitle: "Logistics & Procurement Manager", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "ph"] },
  { companyDomain: "petrovast.ng", firstName: "Remi", lastName: "Adeleke", email: "r.adeleke@petrovast.ng", phone: "+234 706 850 1122", jobTitle: "Project Cargo Coordinator", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Guangzhou Nexlink
  { companyDomain: "nexlink.com.cn", firstName: "Wang", lastName: "Fang", email: "wangfang@nexlink.com.cn", phone: "+86 139 2288 4400", jobTitle: "Export Sales Manager", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "china"] },
  { companyDomain: "nexlink.com.cn", firstName: "Kevin", lastName: "Chen", email: "kevin.chen@nexlink.com.cn", phone: "+86 135 1100 6677", whatsappPhone: "+8613511006677", jobTitle: "Logistics Coordinator", role: "contact", isPrimary: false, source: "whatsapp", tags: [] },

  // Afropharma
  { companyDomain: "afropharma.ng", firstName: "Ifeoma", lastName: "Nwachukwu", email: "i.nwachukwu@afropharma.ng", phone: "+234 803 740 5500", jobTitle: "Supply Chain Director", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "pharma"] },
  { companyDomain: "afropharma.ng", firstName: "Segun", lastName: "Adebayo", email: "s.adebayo@afropharma.ng", phone: "+234 810 290 6633", jobTitle: "Regulatory & Logistics Officer", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Delta Steel
  { companyDomain: "deltasteelworks.ng", firstName: "Ovie", lastName: "Erhirhie", email: "ovie.e@deltasteelworks.ng", phone: "+234 805 430 8811", whatsappPhone: "+2348054308811", jobTitle: "Import Manager", role: "decision-maker", isPrimary: true, source: "whatsapp", tags: ["primary", "delta"] },
  { companyDomain: "deltasteelworks.ng", firstName: "Grace", lastName: "Oghenero", email: "grace.o@deltasteelworks.ng", phone: "+234 703 510 2200", jobTitle: "Admin & Documentation", role: "contact", isPrimary: false, source: "email", tags: [] },

  // Harvest Moon
  { companyDomain: "harvestmooncocoa.com", firstName: "Olabisi", lastName: "Akin-Peters", email: "olabisi@harvestmooncocoa.com", phone: "+234 806 300 7744", jobTitle: "Export Director", role: "decision-maker", isPrimary: true, source: "email", tags: ["primary", "exporter"] },
  { companyDomain: "harvestmooncocoa.com", firstName: "Taiwo", lastName: "Adegoke", email: "taiwo.adegoke@harvestmooncocoa.com", phone: "+234 908 210 5566", jobTitle: "Quality & Shipping Officer", role: "contact", isPrimary: false, source: "email", tags: [] },
];

async function main() {
  console.log("🌱  Seeding companies…");
  const companyIdMap = new Map<string, number>();

  for (const co of companies) {
    const existing = await db
      .select({ id: companiesTable.id })
      .from(companiesTable)
      .where(eq(companiesTable.domain, co.domain))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ↩  skip ${co.name} (already exists)`);
      companyIdMap.set(co.domain, existing[0].id);
    } else {
      const [row] = await db.insert(companiesTable).values(co).returning({ id: companiesTable.id });
      companyIdMap.set(co.domain, row.id);
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

    const companyId = companyIdMap.get(ct.companyDomain);
    const { companyDomain: _, ...rest } = ct;
    await db.insert(contactsTable).values({ ...rest, companyId, updatedAt: new Date() });
    inserted++;
  }

  console.log(`\n✅  Done — ${companies.length} companies, ${inserted} contacts inserted, ${skipped} skipped`);
  process.exit(0);
}

main().catch(err => {
  console.error("Seed failed:", err);
  process.exit(1);
});
