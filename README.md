# ArkPulls — Arknights Gacha Analytics

Track your Arknights gacha pull history, see your pity and 6★ luck, and compare
yourself against the whole community's distribution ("you're luckier than 84% of
Doctors").

## Why this exists

Arknights has no official player API. Community tools cover rosters and drop
rates, but nobody answers the question every gacha player actually asks:
**"was I lucky?"** ArkPulls ingests pull histories and aggregates anonymized
community-wide luck statistics to answer it with data.

## Architecture

```
Yostar gacha-history endpoint (currently mocked)
        │
        ▼
 Ingestion service ──► SQLite/Postgres (Prisma) ──► Stats service ──► REST API
 (idempotent import)    users / banners / pulls      pity extraction,
                                                     luck percentiles
```

- **TypeScript + Express** REST API
- **Prisma** ORM — SQLite for local dev, switch `provider` to `postgresql` for deployment
- **Mock Yostar client** (`src/services/yostarClient.ts`) simulates real Arknights
  gacha mechanics (2% base 6★, +2%/pull pity after 50) deterministically per token.
  Swap `fetchGachaHistory()` for the real HTTP integration — the interface is ready.

## Run it

```bash
npm install
npx prisma migrate dev   # creates dev.db + seeds 50 simulated players
npm run dev              # http://localhost:3000
```

## API

| Endpoint | What it returns |
|---|---|
| `POST /api/import` `{ "token": "..." }` | Imports that account's pulls (idempotent — re-import only appends new pulls) |
| `GET /api/users/:id/stats` | Total pulls, rarity breakdown, per-banner current pity, every 6★ with its pity cost, luck percentile vs community |
| `GET /api/community/stats` | Users, total pulls, observed 6★ rate, average pulls per 6★, full pity-cost distribution |
| `GET /api/banners` | Known banners |
| `GET /api/health` | Liveness check |

Tokens are never stored — only a SHA-256 hash, used to map re-imports to the
same account.

## Roadmap

- [ ] Real Yostar endpoint integration behind the existing `fetchGachaHistory` interface
- [ ] Move community aggregation from in-memory to SQL / cached materialized stats (it currently rescans all pulls per request)
- [ ] Redis cache for community stats + rate limiting on `/api/import`
- [ ] Next.js frontend: personal dashboard + community luck histogram
- [ ] Per-banner luck comparisons ("pulls needed for the new limited")
- [ ] Docker + CI/CD (GitHub Actions), deploy to Fly.io/Railway
- [ ] Tests (Vitest) for pity extraction and ingestion idempotency
