import XLSX from 'xlsx';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const features = [
  // ── RFQ INTAKE (mvp1.html) ──────────────────────────────────────────────────
  ['RFQ Intake', 'Gmail Inbox Sync', 'Connects to live Gmail accounts and automatically pulls incoming RFQ emails into the inbox. Supports multiple accounts simultaneously.', 'Live', ''],
  ['RFQ Intake', 'Multi-account Monitoring', 'Monitors multiple Gmail inboxes at once. Shows connected account count badge. Circular sync button triggers manual refresh on demand.', 'Live', ''],
  ['RFQ Intake', 'Background Auto-refresh', 'Inbox silently refreshes every 30 seconds in the background to pick up new emails without disrupting the active compose session.', 'Live', ''],
  ['RFQ Intake', 'AI Field Extraction', 'Claude AI reads each email body and extracts: Company, Contact, Commodity, HS Code, Gross Weight, Volume (CBM), POL, POD, Pick-up Address, Freight Mode, Container Type, Cargo Class, Incoterm, Target Price.', 'Live', ''],
  ['RFQ Intake', 'Port/Airport LOCODE Resolution', 'When a city is named, AI resolves it to the nearest commercial port or airport and appends the UN/LOCODE or IATA code in brackets (e.g. Lagos → Apapa (NGAPP)).', 'Live', ''],
  ['RFQ Intake', 'Import/Export Direction Detection', 'Classifies each shipment as Import → Nigeria (goods arriving), Export ← Nigeria (goods leaving), Domestic (NG-to-NG), or Cross-trade. Nigeria is the default home country. Badge shown prominently in extraction panel.', 'Live', ''],
  ['RFQ Intake', 'Quote Readiness Score', 'Scores each RFQ out of 10 based on how many of the minimum required fields are present. Score badge turns green (≥8), amber (≥5), or red (<5). Controls whether "Search Rates" is available.', 'Live', ''],
  ['RFQ Intake', 'Minimum Required Fields Checklist', 'Shows all 10 required-for-quote fields (Company, Contact, Email, Commodity, HS Code, Tonnage, Volume, POL, POD, Pick-up) with ✓ filled or ⚠ missing status per field.', 'Live', ''],
  ['RFQ Intake', 'Sender Auto-populate', 'Contact name and email are automatically taken from the email sender metadata, so those two fields are never marked missing even if not in the body.', 'Live', ''],
  ['RFQ Intake', 'Freight Mode Badge', 'Displays a colour-coded pill (🚢 Ocean / ✈ Air) at the top of the extraction panel so mode is immediately visible.', 'Live', ''],
  ['RFQ Intake', 'Additional Extracted Details', 'Any fields Claude extracts beyond the 10 required (Incoterm, Container, Cargo Class, Target Price, etc.) appear in an "Additional Details" section below the checklist.', 'Live', ''],
  ['RFQ Intake', 'AI Follow-up Draft', 'When required fields are missing, Claude auto-drafts a warm professional email from "Commercial Team · OnePort 365" listing each missing item as a numbered request, ready to review and send.', 'Live', ''],
  ['RFQ Intake', 'Compose Tray', 'In-app email composer pinned to the bottom of the email view. Pre-fills To, Subject, and the AI draft. User can edit before sending. Supports multiple sender accounts.', 'Live', ''],
  ['RFQ Intake', 'Auto-send Countdown Timer', '3-minute countdown timer that auto-sends the AI draft if not cancelled. Can be discarded at any time.', 'Live', ''],
  ['RFQ Intake', 'Email Thread View', 'Displays full email thread — original enquiry plus all subsequent customer replies — in reverse-chronological order with timestamps.', 'Live', ''],
  ['RFQ Intake', 'Thread Re-extraction', 'When a customer reply is received, AI re-runs extraction on the full conversation thread and fills in any previously missing fields automatically.', 'Live', ''],
  ['RFQ Intake', 'Search Rates Gate', '"Search rates" action button is only enabled when quote readiness is 10/10. Shows exact missing count when locked (e.g. "⚠ 3 fields missing").', 'Live', ''],
  ['RFQ Intake', 'Internal Rates Search', 'Searches the internal rates database for matching ocean/air/inland rates by POL/POD when all required fields are complete.', 'Live', ''],
  ['RFQ Intake', 'Request Rates from Partners', '3-step modal to compose and send rate request emails to freight forwarding partners. Pre-seeded with POL, POD, commodity, and container from the selected RFQ.', 'Live', ''],
  ['RFQ Intake', 'Multi-shipment Detection', 'Detects when a single email contains multiple distinct shipment requests and creates separate extraction tabs per shipment (e.g. "Cashew nuts | Machinery"). A single combined follow-up draft covers all missing fields.', 'Live', ''],
  ['RFQ Intake', 'RFQ Status Workflow', 'Status lifecycle: new → info_needed → ready → replied → archived. Status badges visible in inbox list and extraction panel.', 'Live', ''],
  ['RFQ Intake', 'Archive / Remove', 'Archive hides an RFQ from the active inbox; Remove permanently deletes it.', 'Live', ''],
  ['RFQ Intake', 'Generate Quote with AI', 'AI generates a formatted freight quote document from the extracted fields and matched rate data. Regenerate button refreshes the quote.', 'Live', ''],
  ['RFQ Intake', 'Demo Seed Data', 'One-click seed endpoint populates 10 realistic demo RFQ emails and extracted records for demonstration purposes.', 'Live', ''],

  // ── DEALS / PIPELINE ────────────────────────────────────────────────────────
  ['Deals Pipeline', 'Pipeline Table View', 'Shows all RFQs as rows with columns: RFQ ref, customer, route (POL→POD), commodity, stage (Info Needed / Ready / Follow-up Sent / Archived), and received date.', 'Live', ''],
  ['Deals Pipeline', 'RFQ Detail Panel', 'Clicking a pipeline row opens a side panel with full extracted fields, timeline events, and action buttons.', 'Live', ''],
  ['Deals Pipeline', 'Stage Badges', 'Colour-coded stage chips (green = Ready, amber = Follow-up Sent, red = Info Needed, grey = Archived) give instant visual status in the pipeline table.', 'Live', ''],

  // ── RATES DATABASE (rates.html) ──────────────────────────────────────────────
  ['Rates Database', 'Rate Record Storage', 'Stores freight rates (ocean, air, inland/haulage) in PostgreSQL with carrier, POL, POD, container type, validity, and all-in price.', 'Live', ''],
  ['Rates Database', 'Rate Type Tabs', 'Rates are categorised into Contract, Spot, and Local tabs for quick filtering.', 'Live', ''],
  ['Rates Database', 'Rate Detail Panel', 'Clicking a rate record opens a full detail view with all fields. Supports inline editing and deletion.', 'Live', ''],
  ['Rates Database', 'CSV Rate Import', 'Upload a CSV file matching the template to bulk-import multiple rates at once. Download template button provided.', 'Live', ''],
  ['Rates Database', 'Live Rates (CMA-CGM)', 'Search CMA-CGM live spot rates by POL, POD, and container type via API integration. Results displayed with sailing dates and pricing.', 'Live', ''],
  ['Rates Database', 'Carrier Logo Badges', 'Recognised carrier names (Maersk, MSC, CMA-CGM, Evergreen, etc.) are displayed with branded colour badges.', 'Live', ''],
  ['Rates Database', 'Save Rate to DB', 'Any rate found via search or live lookup can be saved to the internal database with one click.', 'Live', ''],

  // ── NAVIGATION / SHARED ──────────────────────────────────────────────────────
  ['Navigation', 'Unified Dark Navigation Bar', 'Consistent 52px dark top nav across mvp1 and rates pages with OnePort 365 logo, page tabs (CRM / ✉ RFQ / $ Rates / 📄 Quotes), and user chip.', 'Live', ''],
  ['Navigation', 'Shared Session Auth', 'Single password gate using sessionStorage key shared across mvp1 and rates pages — navigating between tools does not require re-login.', 'Live', ''],
  ['Navigation', 'Hash-based Deep Links', 'URL hash routing supports direct links to sub-screens: /mvp1.html#quotes, #deals, #pipeline.', 'Live', ''],

  // ── API / BACKEND ────────────────────────────────────────────────────────────
  ['API / Backend', 'Express 5 REST API', 'All data operations served via an Express 5 API at /api, running on a dedicated port behind a shared reverse proxy.', 'Live', ''],
  ['API / Backend', 'Claude AI Proxy Endpoint', 'POST /api/claude forwards prompts to Anthropic Claude claude-sonnet-4-6 via Replit AI Integrations — no user API key required.', 'Live', ''],
  ['API / Backend', 'RFQ CRUD Endpoints', 'GET /api/rfqs (list), GET /api/rfqs/:id (single), PATCH /api/rfqs/:id (update status/notes/draft), POST /api/rfq/ingest (save + extract), POST /api/rfqs/:id/re-extract (re-run AI on thread).', 'Live', ''],
  ['API / Backend', 'Send Follow-up Email Endpoint', 'POST /api/rfqs/:id/send-followup sends the composed reply email via SMTP (Gmail App Password), marks RFQ as replied, and records the draft.', 'Live', ''],
  ['API / Backend', 'Gmail Sync Endpoint', 'POST /api/gmail/sync fetches recent emails from all monitored Gmail accounts, runs AI extraction, and upserts RFQs. UID deduplication prevents double-ingestion.', 'Live', ''],
  ['API / Backend', 'PostgreSQL + Drizzle ORM', 'All data persisted in a managed PostgreSQL database. Schema managed via Drizzle ORM with push-based migrations.', 'Live', ''],
  ['API / Backend', 'Multi-account Email Support', 'Supports multiple connected Gmail accounts. Outgoing emails can be sent from any configured account.', 'Live', ''],
];

// Column headers
const headers = ['Module', 'Feature', 'Description', 'Status', 'Release Date'];

// Build worksheet data
const wsData = [headers, ...features];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(wsData);

// Column widths
ws['!cols'] = [
  { wch: 18 },   // Module
  { wch: 30 },   // Feature
  { wch: 80 },   // Description
  { wch: 12 },   // Status
  { wch: 18 },   // Release Date
];

// Freeze top row
ws['!freeze'] = { xSplit: 0, ySplit: 1 };

XLSX.utils.book_append_sheet(wb, ws, 'MVP Features');

const outPath = path.join(__dirname, '../../', 'OnePort365_MVP_Features.xlsx');
XLSX.writeFile(wb, outPath);
console.log(`Written: ${outPath}`);
