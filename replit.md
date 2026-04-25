# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **AI**: Replit AI Integrations (Anthropic/Claude) — no user API key required

## Artifacts

- **oneport365** (`/`) — React/Vite landing page + static HTML tools served via Vite public folder
  - `/` — landing page with links to both tools
  - `/outlook_scan.html` — RFQ Intake tool (uses hardcoded demo data)
  - `/rfq_pipeline.html` — RFQ Pipeline tool (calls `/api/claude` proxy)
- **api-server** (`/api`) — Express API server
  - `POST /api/claude` — Claude proxy endpoint (uses Replit AI Integrations)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Claude Proxy

The `/api/claude` endpoint in `artifacts/api-server/src/routes/claude.ts` accepts the same JSON body
format as the Anthropic Messages API `{model, max_tokens, messages}` and returns the same response.
The model is locked to `claude-sonnet-4-6` regardless of what the client requests.
API credentials come from `AI_INTEGRATIONS_ANTHROPIC_BASE_URL` and `AI_INTEGRATIONS_ANTHROPIC_API_KEY`
environment variables (auto-provisioned by Replit AI Integrations — no user key needed).

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.
