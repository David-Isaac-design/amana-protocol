# Query Performance Review

Process for finding and fixing slow queries before they cause an outage, instead of
discovering them via pagination timeouts in production.

## 1. Baseline capture

`postgres-staging` runs with `pg_stat_statements` enabled and
`log_min_duration_statement=200` (see `docker-compose.yml`), so every query slower than
200ms is logged and aggregated automatically — no manual instrumentation needed.

Capture the current top offenders:

```bash
DATABASE_URL=postgresql://... ./scripts/capture-slow-queries.sh 20
```

Run this at the start of a review and save the output (e.g. into a dated file under
`security-reports/` or a tracking issue) as the "before" baseline.

## 2. Analyze

For each offender in the report:

1. `EXPLAIN (ANALYZE, BUFFERS)` the query against a staging dataset representative of
   production volume.
2. Look for sequential scans on large tables, sort steps that could be served by an
   index, or N+1 patterns in the calling service.
3. Propose a composite or partial index that matches the query's actual `WHERE` /
   `ORDER BY` shape — not a single-column index per filtered field.

## 3. Ship the migration

1. Add the index to `backend/prisma/schema.prisma` and generate a migration
   (`npx prisma migrate dev --name <description>`).
2. Apply via `./scripts/migrate-safe.sh`, which runs pre-flight backward-compatibility
   and backup checks before applying.
3. Note the rollback path in the migration PR (see
   [migration-rollback-playbook.md](migration-rollback-playbook.md)).

## 4. Re-measure

Re-run `./scripts/capture-slow-queries.sh` after the index is live and compare
`mean_exec_time` for the target query against the baseline. Record both numbers in the
PR/issue that shipped the index. Watch write-path latency on the same table for a few
days to confirm no regression beyond an agreed threshold (index maintenance cost on
inserts/updates).

## 5. Cadence

Run this review monthly, or immediately after a pagination/list endpoint is reported as
slow. `pg_stat_statements` accumulates since the last `pg_stat_statements_reset()` (or
container restart), so a monthly cadence gives roughly a month's worth of representative
traffic per review.

## Review log: trade list by party and status

Query shapes (`TradeService.listUserTrades`, `backend/src/services/trade.service.ts`):

| Case | Shape |
|---|---|
| With status | `WHERE ("buyerAddress" = $1 OR "sellerAddress" = $1) AND "status" = $2 ORDER BY "createdAt" DESC` |
| Without status | `WHERE "buyerAddress" = $1 OR "sellerAddress" = $1 ORDER BY "createdAt" DESC` |

Reproduce against seeded data:

```sql
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM "Trade"
WHERE ("buyerAddress" = '<addr>' OR "sellerAddress" = '<addr>') [AND "status" = 'FUNDED']
ORDER BY "createdAt" DESC LIMIT 20;
```

Index coverage:

| Case | Before | After |
|---|---|---|
| With status | `BitmapOr` over `Trade_{buyer,seller}Address_status_createdAt_idx` (migration `20260829140848`) — already covered | unchanged |
| Without status | `BitmapOr` over single-column `Trade_buyerAddress_idx` / `Trade_sellerAddress_idx` + explicit `Sort` on `createdAt` | `BitmapOr` / `Merge Append` over new `Trade_{buyer,seller}Address_createdAt_idx`, no full sort of the party's trades |

New indexes ship in `20260929000001_add_trade_buyer_created_at_index` and
`20260929000002_add_trade_seller_created_at_index`, one statement each, using
`CREATE INDEX CONCURRENTLY` so writes to `Trade` are not blocked.

Timings (`EXPLAIN ANALYZE` execution time, seeded staging data):

| Case | Before | After |
|---|---|---|
| With status | _to be recorded_ | _to be recorded_ |
| Without status | _to be recorded_ | _to be recorded_ |
