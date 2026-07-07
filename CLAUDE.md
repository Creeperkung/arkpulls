# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ArkPulls: an Arknights gacha pull tracker with community luck analytics. Two apps in one repo:

- **Root** — Express 5 + TypeScript REST API (port 3000), Prisma ORM
- **`web/`** — Next.js 16 dashboard (port 3001), proxies `/api/*` to the backend via rewrites in `web/next.config.ts`, so there is no CORS handling anywhere. `web/` has its own CLAUDE.md: Next 16 has breaking changes; consult `web/node_modules/next/dist/docs/` before writing Next-specific code.

## Commands

```bash
# API (repo root)
npm run dev              # tsx watch, http://localhost:3000
npm run db:migrate       # prisma migrate dev (also regenerates client + runs seed)
npm run db:seed          # seed 50 simulated players (idempotent)
npm run build            # tsc → dist/

# Dashboard
cd web && npm run dev    # defaults to port 3000 — collides with the API
```

Run the dashboard on port 3001. On Windows/PowerShell, `npm run dev -- --port 3001` mangles the flag (npm passes `3001` as a directory); use `$env:PORT=3001; npm run dev` instead.

Database is SQLite (`dev.db`, gitignored) for dev. For deployment, change `provider` in `prisma/schema.prisma` to `postgresql` and point `DATABASE_URL` (in `.env`) at Postgres.

There are no tests yet (roadmap item: Vitest, targeting pity extraction and import merging first).

## Architecture

Data flow: ingestion → Prisma (User/Banner/Pull) → stats service → REST API → dashboard.

Two import paths, both idempotent, both identify accounts by **SHA-256 hash only** (raw tokens/account names are never stored):

- `src/services/ingest.ts` (`POST /api/import`) — token-based. Calls `fetchGachaHistory()` in `src/services/yostarClient.ts`, which is currently a **mock** that generates deterministic-per-token histories using real Arknights pity mechanics (2% base 6★, +2%/pull after 50). The planned real Yostar email-code integration replaces only that function's body; keep its interface stable. Appends new pulls by `seq`.
- `src/services/jsonImport.ts` (`POST /api/import/json`) — paste-based import of Yostar Account Center Headhunting History exports. The parser was written against community-known shapes, not a confirmed real export — expect to adapt field names when a real sample appears. Accepts flat arrays or grouped `data.list`+`chars`, auto-detects 0- vs 1-indexed rarity and seconds vs milliseconds timestamps.

### Invariants that break stats if violated

- `Pull.seq` must be **chronological within (userId, bannerId)** — pity extraction (`src/services/stats.ts`) walks pulls in `seq` order to compute pity costs. `jsonImport` preserves this by deleting and re-creating a banner's pulls in timestamp order on every merge (an import can contain pulls older than what's stored).
- JSON-import dedup is a **multiset** keyed by `(timestamp, operator, rarity)` — a ten-pull can legally contain the same operator twice at the same timestamp, so per-key counts are compared, not key existence.
- Rarity is stored **1-indexed (3–6)**; Arknights game data is 0-indexed (6★ = 5). Conversion happens only at the jsonImport boundary.

### Known debt

Community stats (`getCommunityStats`, `luckPercentile`) rescan every pull in memory per request. Fine at seed scale; the roadmap moves this to SQL aggregation / cached materialized stats before real traffic.

## Frontend conventions

Chart and theme colors are CSS custom properties defined once in `web/app/globals.css` (light + dark via `prefers-color-scheme`), consumed as `var(--series-1)`, `var(--ink)`, etc. The histogram (`web/components/PityHistogram.tsx`) is hand-rolled SVG — no chart library. Palette values follow a validated accessibility method (contrast + colorblind-safety per mode); don't introduce new chart colors ad hoc.
