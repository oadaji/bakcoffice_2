# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM (`lib/db`)
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: Replit AI Integrations (Anthropic/Claude) — no user API key required

## Artifacts

- **oneport365** (`/`) — React/Vite landing page + static HTML tools served via Vite public folder
  - `/` — landing page with cards linking to all tools
  - `/outlook_scan.html` — Full RFQ Intake tool (all tabs: RFQ, Deals, Rates, Quotes)
  - `/rfq_pipeline.html` — RFQ Pipeline tool (calls `/api/claude` proxy)
  - `/mvp1.html` — **MVP 1** — Email RFQ intake tool (live DB + AI extraction)
- **api-server** (`/api`) — Express API server
  - `POST /api/claude` — Claude proxy (model locked to claude-sonnet-4-6)
  - `GET /api/rfqs` — List all RFQs with email data (ordered by received_at desc)
  - `GET /api/rfqs/:id` — Single RFQ with email
  - `PATCH /api/rfqs/:id` — Update status, followUpDraft, notes
  - `POST /api/rfq/ingest` — Save email + run Claude extraction → upsert RFQ
  - `POST /api/rfq/extract` — Extract fields from email body (no persistence)
  - `POST /api/rfq/seed` — Seed 10 demo emails + RFQs (idempotent by uid)

## Database Schema (`lib/db/src/schema/`)

- **emails** — uid (unique), fromName, fromEmail, subject, body, receivedAt, emailType
- **rfqs** — emailId (FK→emails), ref, emailType, status, fields (jsonb), missingFields (jsonb), followUpDraft, notes

Status values: `new | info_needed | ready | replied | archived`
EmailType values: `customer-rfq | internal-rfq | rate-reply | outbound`
Fields format: `Array<{k: string, v: string, ok: boolean}>`

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Claude Proxy

The `/api/claude` endpoint accepts `{model, max_tokens, messages}` (Anthropic format).
The model is locked to `claude-sonnet-4-6`.
Credentials come from `AI_INTEGRATIONS_ANTHROPIC_*` env vars (auto-provisioned by Replit AI Integrations).

## MVP 1 Architecture

`mvp1.html` (static HTML in Vite public folder) is wired to the live API:
- On load: `loadInbox()` fetches `GET /api/rfqs` → renders dynamic inbox list
- On email click: `selEmail(rfqId)` looks up rfqData by id, renders email + extraction panel
- Follow-up draft is an editable `<textarea>` — pre-filled from `rfq.followUpDraft`
- Send Now button: `PATCH /api/rfqs/:id` with `{status:'replied', followUpDraft: <edited draft>}`
- Archive button: `PATCH /api/rfqs/:id` with `{status:'archived'}`
- Pipeline panel (Deals view) uses same `rfqData` via `selectRFQ(i)`

## Scratchpad Notes

- Logo: `<img src="/oneport365_logo.png" alt="OnePort 365" style="height:28px;width:auto;display:block">` — new HTML always reverts to ⬡ icon, must fix each time
- Tab labels in outlook_scan.html: "✉ RFQ", "◈ Deals", "$ Rates", "📄 Quotes"
- filterRateType bug: always uses 'ocean'/'inhaulage'/'other' not 'contract'/'spot'/'local'
- Carrier logos: use CARRIER_BRAND object + carrierLogo() CSS badge function (no external URLs)

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
