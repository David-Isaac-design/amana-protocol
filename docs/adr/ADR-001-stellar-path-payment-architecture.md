# ADR-001: Stellar Path Payment Architecture

## Status

Accepted (quote implementation in `backend/src/services/pathPayment.service.ts`,
exposed via `GET /wallet/path-payment-quote`; escrow sequence implemented in
`contracts/amana_escrow/src/lib.rs`) - see
[docs/api/stellar.md](../api/stellar.md#path-payment-quotes)).

## Context

The escrow contract settles each trade in its configured destination token
(current product documentation refers to cNGN), while the backend quote
endpoint currently returns routes to a network-configured USDC asset. Buyers
may hold other source assets (for example NGN-pegged tokens or XLM). Stellar's
DEX supports **path payments**, which let a
sender pay in one asset while the receiver gets another, atomically, via an
on-network conversion path - but discovering a *viable* path (one with
enough liquidity for the amount involved) requires querying Horizon's
`strictSendPaths` endpoint, and that endpoint is an external network
dependency that can be slow, rate-limited, or briefly unavailable.

We needed a way to expose "what will I get if I pay with X" to the frontend
without making every quote request a single point of failure for the rest
of the API.

## Decision

1. **The quote endpoint currently targets USDC.** The backend
   resolves the correct USDC issuer for the configured network
   (`USDC_ISSUER_MAINNET`/`USDC_ISSUER_TESTNET`) rather than accepting an
   arbitrary destination asset. This quote endpoint is independent of escrow
   contract invocation and does not prove or execute a deposit. Its USDC quote
   must not be presented as a cNGN escrow quote; the quote target and trade
   token need to be aligned before this endpoint can support that flow.
2. **Source asset defaults to a fixed test/reference issuer when the caller
   doesn't supply one**, so the endpoint has a sane behavior in
   non-production environments without every caller needing to know a real
   issuer address.
3. **Wrap the Horizon call in both a retry and a circuit breaker**
   (`retryAsync` from `lib/retry.ts`, `CircuitBreaker` from
   `lib/circuitBreaker.ts`, named `horizon-path-payment`):
   - `retryAsync` absorbs transient failures (network blips, Horizon 5xx)
     with backoff, so a single flaky request doesn't surface as an error to
     the client.
   - The circuit breaker (5 consecutive failures to open, 2 successes in
     half-open to close, 30s cooldown) protects the rest of the backend
     from a sustained Horizon outage - once open, quote requests fail fast
     with a clear "temporarily unavailable" error instead of piling up
     retries against a dead dependency.
4. **The quote endpoint is read-only and side-effect-free.** It never
   builds or submits a transaction; it only returns candidate routes
   (`source_amount`, `destination_amount`, `path`, etc.).
5. **No caching of path payment quotes.** Unlike `stellar.asset.ts` (which
   caches asset lookups for 5 minutes - see
   [docs/api/stellar.md](../api/stellar.md#assets)), path quotes are
   time-sensitive to DEX liquidity and are deliberately fetched live every
   time rather than risking a stale quote a user acts on.

## Escrow path-payment sequence

The escrow contract does not execute the DEX swap. For its path-payment
deposit flow, the required order is:

1. Create the trade with its agreed destination-token amount.
2. Before any external swap, the buyer calls `deposit_with_path` with the
   trade ID, source amount, path, and `dest_min`. The call records the buyer's
   destination-token balance as the baseline. `dest_min` must be at least the
   trade's agreed amount.
3. Only after the intent succeeds, the buyer's wallet submits the external
   Stellar path payment to the buyer's own account and waits for it to succeed.
   The contract does not transfer or hold the source asset.
4. The buyer calls `finalize_path_payment`. The buyer authorizes the escrow
   token transfer. The contract requires the buyer's destination-token balance
   increase since step 2 to be at least `dest_min`, then transfers exactly
   `dest_min` into escrow and sets the funded trade amount to that minimum.
   Any surplus remains in the buyer's wallet.

Opening the intent after the swap will not count tokens received before its
balance snapshot. The balance check cannot prove which transaction or sender
caused a post-intent credit: token balances are fungible, so a third-party
credit after the intent can satisfy the check if the buyer authorizes
finalization. Multiple pending intents for the same buyer also share the same
balance increase; whichever intent is finalized first can consume up to its
own `dest_min`. A later intent then fails if the remaining post-snapshot
increase is below its minimum. Clients should not overlap path intents for one
buyer. Spending destination tokens between intent and finalization reduces
the measured net increase and may make finalization fail.

The current frontend trade-creation form posts a trade draft; it does not call
these escrow path-payment methods. The backend quote API is also not a contract
caller. The `routes-d` strict-send/strict-receive endpoints build generic
wallet transactions to the supplied account destination; they do not open or
finalize an escrow intent.

## Consequences

- **Positive:** A Horizon outage degrades gracefully (fast, clear failure
  via the circuit breaker) instead of cascading into slow timeouts across
  the API.
- **Positive:** Clients can discover candidate routes without coupling quote
  availability to the rest of the API.
- **Negative:** Quotes are advisory only - the actual conversion happens
  when the buyer's wallet builds and submits a path-payment transaction, and
  DEX liquidity can move between quote and execution. The backend does not
  (and cannot, without holding funds) guarantee the quoted rate.
- **Negative:** The escrow balance snapshot is not a payment receipt. Its
  fungibility limitations and required transaction order are described above.
- **Negative:** The circuit breaker is process-local (an in-memory
  `Map`-backed registry in `lib/circuitBreaker.ts`), so in a multi-instance
  deployment each instance trips independently - a coordinated view of
  Horizon health across instances would need a shared store, which we
  don't have today.
- **Follow-up:** If additional Horizon-backed endpoints need the same
  resilience pattern, extract the retry+circuit-breaker wrapping into a
  shared helper rather than re-implementing it per service - `stellar.fees.ts`
  and `stellar.tx.status.ts` currently handle Horizon failures with a bare
  `try/catch` -> `502`, not this pattern, and might benefit from it as they
  see more traffic.
