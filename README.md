# AI NOC

Real-time AI-industry intelligence dashboard. Ingests RSS/Atom feeds from AI labs, research aggregators, and tech press; clusters related stories; scores priority; generates executive briefings via Amazon Bedrock; and pushes updates to the dashboard over WebSocket.

## Stack

- Server: Express 5, Drizzle ORM, node-postgres, ws
- Client: React 18, Vite, Tailwind, shadcn/ui
- Infra: AWS CDK (`infra/`)
- Tests: vitest with PGlite (in-memory Postgres)

## Prerequisites

- Node 20
- Local PostgreSQL (for `npm run dev`; tests do not need it)

## Environment variables

Copy `.env.example` to `.env` and fill in values. See `.env.example` for the full commented list.

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | Full Postgres connection string (takes precedence over the parts below) |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_HOST` / `DB_PORT` / `DB_NAME` | Individual Postgres connection parts |
| `BEDROCK_REGION` | AWS region for Bedrock briefing generation |
| `BEDROCK_MODEL_ID` | Bedrock model/inference-profile ID |
| `SEED_DEMO_DATA` | Dev-only demo data seeding; never set in production |
| `TRUST_PROXY_HOPS` | Number of trusted proxy hops in front of Express |
| `ORIGIN_VERIFY_TOKEN` | Shared secret verifying requests came through the CDN |

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the dev server (Express + Vite middleware) |
| `npm run build` | Build client and server bundles into `dist/` |
| `npm start` | Run the production bundle |
| `npm run check` | Type-check with tsc |
| `npm test` | Run the vitest suite |
| `npm run test:coverage` | Run tests with V8 coverage |
| `npm run db:migrate` | Apply SQL migrations |

## Tests

- `test/unit/` — pure-function unit tests
- `test/integration/` — storage and API tests against PGlite (in-memory Postgres, no local DB needed)
- `test/component/` — React component tests (jsdom + Testing Library)

Test databases are provisioned per-test via `test/helpers/db.ts`.

## Deployment

See [docs/deploy-runbook.md](docs/deploy-runbook.md).
