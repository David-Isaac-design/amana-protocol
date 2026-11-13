# Stellar Proxy Endpoints

These endpoints proxy the Stellar network (via Horizon) so clients don't
need to talk to Horizon directly or manage network selection themselves. The
backend targets whichever network `STELLAR_NETWORK` is configured for
(`testnet` or `pubnet`/mainnet).

None of these require a bearer token unless noted.

## Fee stats

`GET /stellar/fees`

Current network fee statistics from Horizon's fee stats endpoint, plus a
congestion-buffered recommendation (issue #184).

Optional query param `operations` (1–100, default 1) sizes
`recommended.transactionFee` for a multi-operation transaction.

**Response `200`**

```json
{
  "feeCharged": { "min": "100", "max": "10000", "p50": "100", "p90": "120" },
  "maxFee": { "min": "100", "max": "10000", "p50": "100" },
  "ledger": 51234567,
  "lastLedgerBaseFee": 100,
  "ledgerCapacityUsage": 0.12,
  "recommended": {
    "perOperationFee": 180,
    "transactionFee": 180,
    "operations": 1,
    "percentile": "p90",
    "percentileFee": 120,
    "multiplier": 1.5,
    "congested": false,
    "cappedAtMax": false,
    "minStroops": 100,
    "maxStroops": 1000000
  }
}
```

`recommended.perOperationFee` is `percentileFee × multiplier`, clamped to
`[minStroops, maxStroops]`. `multiplier` rises from `STELLAR_FEE_SAFETY_MULTIPLIER`
to `STELLAR_FEE_SAFETY_MULTIPLIER × STELLAR_FEE_CONGESTION_BOOST` when the
network looks congested (`ledgerCapacityUsage ≥ STELLAR_FEE_CONGESTION_CAPACITY`,
or `percentileFee ≥ lastLedgerBaseFee × STELLAR_FEE_CONGESTION_FEE_RATIO`), and a
`stellar_fee_congestion` ops alert is dispatched (subject to alert cooldown).

The raw Horizon fields are unchanged for backward compatibility.

`502` if Horizon is unreachable or errors.

### Tuning

| Env var | Default | Meaning |
|---|---|---|
| `STELLAR_FEE_PERCENTILE` | `p90` | `fee_charged` percentile the estimate is based on |
| `STELLAR_FEE_SAFETY_MULTIPLIER` | `1.5` | multiplier applied when calm |
| `STELLAR_FEE_CONGESTION_BOOST` | `2` | extra factor applied when congested |
| `STELLAR_FEE_CONGESTION_CAPACITY` | `0.75` | `ledger_capacity_usage` congestion threshold |
| `STELLAR_FEE_CONGESTION_FEE_RATIO` | `4` | percentile-fee / base-fee congestion threshold |
| `STELLAR_FEE_MIN_STROOPS` | `100` | lower clamp |
| `STELLAR_FEE_MAX_STROOPS` | `1000000` | upper clamp |
| `STELLAR_FEE_BUMP_FACTOR` | `1.5` | fee increase per bump-and-retry step |
| `STELLAR_FEE_MAX_RETRIES` | `3` | bump-and-retry attempts on timeout-style failures |

For Soroban invocations, `feeEstimator.sizeResourceFee(minResourceFee, perOperationFee)`
folds a simulation's `minResourceFee` into the total, and
`feeEstimator.withFeeBumpRetry(submit, fee)` re-submits with `bumpFee`-raised
fees when a submission fails with a timeout-style error.

## Transaction status

`GET /stellar/tx/:hash/status`

Looks up a submitted transaction by its 64-character hex hash and decodes
its result XDR into human-readable operation result codes.

**Response `200`**

```json
{
  "status": "success",
  "resultCodes": { "transaction": "txSUCCESS", "operations": ["opINNER"] },
  "ledger": 51234567,
  "hash": "a1b2c3...",
  "createdAt": "2026-07-05T12:00:00Z"
}
```

| Status | Meaning |
|---|---|
| `400` | `hash` missing or not 64 characters |
| `404` | Not found on the network yet - `{ "status": "pending", ... }`. A transaction that was just submitted may briefly 404 before Horizon ingests it; poll rather than treating this as a failure. |
| `502` | Horizon lookup failed for another reason |

## Assets

`GET /stellar/assets?issuer=<address>` - lists assets, optionally filtered by
issuer.

`GET /stellar/assets/:code?issuer=<address>` - lists assets matching a code,
optionally scoped to one issuer. `404` if nothing matches.

Both endpoints cache Horizon responses for 5 minutes; a cache hit is
indicated by `"cached": true` in the response so clients can tell freshness
apart from a live lookup.

**Response `200`**

```json
{
  "assets": [
    {
      "code": "USDC",
      "issuer": "GBBB...C4",
      "supply": "1000000.0000000",
      "authRequired": false,
      "authRevocable": false,
      "authClawbackEnabled": false,
      "numAccounts": 42
    }
  ],
  "cached": false
}
```

## Account balance

`GET /stellar/account/:address/balance`

**Response `200`**

```json
{
  "address": "GAAA...WHF",
  "balances": [
    { "assetType": "native", "assetCode": "XLM", "issuer": null, "balance": "100.0000000", "limit": null },
    { "assetType": "credit_alphanum4", "assetCode": "USDC", "issuer": "GBBB...C4", "balance": "250.0000000", "limit": "1000000" }
  ]
}
```

An address that's valid but not yet funded on-network returns `200` with an
empty `balances` array rather than a `404` - "not funded" and "no balances"
are treated as the same client-visible state. `400` for a malformed address
(must be 56 characters starting with `G`).

## Account creation

`POST /stellar/account/create`

Generates a new Stellar keypair server-side. **The response includes the
secret key, symmetrically encrypted** (`encryptedSecretKey`) - decrypting it
is the caller's responsibility using whatever key-management flow the
client app implements; the backend does not persist the plaintext secret.

**Request body** (all optional)

```json
{ "fund": true }
```

`fund: true` on testnet triggers a Friendbot airdrop so the account is
immediately usable; on mainnet `fund` is accepted but ignored (no automatic
funding exists there), and Friendbot failures don't fail account creation -
the account is still returned with `"funded": false`.

**Response `201`**

```json
{
  "publicKey": "GAAA...WHF",
  "encryptedSecretKey": "...",
  "funded": true
}
```

## Contract state

`GET /contract/:contractId/state?tradeId=<id>`

Reads a trade's on-chain escrow contract state directly from the Soroban
contract (not the backend's own database) - useful for verifying that the
backend's view of a trade matches the chain.

**Response `200`**

```json
{ "contractId": "CA...", "tradeId": "4294967297", "state": { "...": "..." } }
```

`tradeId` query parameter is required (`400 VALIDATION_ERROR` otherwise).

## Path payment quotes

`GET /wallet/path-payment-quote?sourceAmount=1000&sourceAsset=NGN&sourceAssetIssuer=<issuer>`

**Requires a bearer token.** Returns candidate Stellar path-payment routes
to the configured USDC asset. This is a read-only quote: it neither submits a
path payment nor opens/finalizes an escrow deposit. The escrow trade token may
be cNGN, so a USDC quote must not be treated as a cNGN settlement quote.

For the contract path-deposit sequence, the buyer must open
`deposit_with_path` before the external swap, receive destination tokens in
their own wallet, and then call `finalize_path_payment`. The contract takes
exactly `dest_min` (which must be at least the agreed trade amount); surplus
remains in the buyer's wallet. See
[ADR-001](../adr/ADR-001-stellar-path-payment-architecture.md#escrow-path-payment-sequence)
for ordering and balance-attribution limitations. The current backend quote
endpoint does not invoke these contract methods.

| Query param | Required | Notes |
|---|---|---|
| `sourceAmount` | yes | Decimal string |
| `sourceAsset` | yes | Asset code, or `native` for XLM |
| `sourceAssetIssuer` | only for non-native assets | Issuer's Stellar public key |

`400` with `{ "error": "Missing sourceAmount or sourceAsset" }` if either
required parameter is absent.
