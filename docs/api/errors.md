# Error Reference

## Envelope shapes

Most routes return a **structured error**:

```json
{
  "code": "VALIDATION_ERROR",
  "message": "Validation failed",
  "details": [{ "path": "body.amountUsdc", "message": "Invalid amount format" }],
  "timestamp": "2026-07-05T12:00:00.000Z",
  "path": "/trades",
  "requestId": "...",
  "correlationId": "..."
}
```

A handful of older/simpler routes (mostly the Stellar proxy endpoints in
[stellar.md](./stellar.md) and a few `403` checks) instead return a
**legacy envelope**:

```json
{ "error": "Forbidden" }
```

Check for `code` first; if absent, fall back to `error`. Both shapes are
called out per-endpoint in [trades.md](./trades.md), [stellar.md](./stellar.md),
and [admin.md](./admin.md) where they differ from the structured default.

`requestId` and `correlationId` (when present) identify the request in
server logs/tracing - include them when reporting an issue.

## Error codes

| Code | Typical HTTP status | Meaning | What to do |
|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Request body/query failed schema validation | Fix the field(s) listed in `details` and retry - don't retry unchanged |
| `AUTH_ERROR` | 401 | Missing, expired, revoked, or otherwise invalid bearer token | Re-run the [challenge/verify flow](./overview.md#authentication) to get a fresh token |
| `DOMAIN_ERROR` | 400/403 | A business rule was violated (rather than a schema failure) | Message/`details` explain the rule; not retryable without changing the request |
| `INFRA_ERROR` | 500/503 | A dependency (JWT config, database, etc.) failed | Transient - safe to retry with backoff; if it persists, treat it as a service incident |
| `NOT_FOUND` | 404 | The resource doesn't exist, or you don't have access to see that it does | Check the identifier; some endpoints intentionally 404 instead of 403 to avoid leaking existence |
| `INTERNAL_ERROR` | 500 | Unhandled server error | Retry once with backoff; if it repeats, report `requestId` |
| `RATE_LIMIT_EXCEEDED` | 429 | Too many requests for the bucket the endpoint belongs to | Wait `details.retryAfterSeconds` before retrying - see [overview.md](./overview.md#rate-limits) |

### Trade-specific codes

| Code | HTTP status | Meaning | What to do |
|---|---|---|---|
| `TRADE_NOT_FOUND` | 404 | No trade with that id (or id malformed) | Confirm the `tradeId` |
| `TRADE_ACCESS_DENIED` | 403 | Caller is not the buyer/seller/admin required for this action | Check which role the action requires - see [trades.md](./trades.md) |
| `TRADE_INVALID_STATUS` | 400 | The trade isn't in the status this action requires (e.g. confirming delivery on a trade that isn't `FUNDED`) | Fetch the trade's current `status` and only call the action valid for it |
| `TRADE_BUILD_FAILED` | 500 | Building the Stellar/Soroban transaction failed server-side | Retryable; if it persists the underlying contract/network call is likely failing |

### Dispute-specific codes

| Code | HTTP status | Meaning | What to do |
|---|---|---|---|
| `DISPUTE_INVALID_CATEGORY` | 400 | `category`/`categoryId` doesn't match an active dispute category | Fetch `GET /dispute-categories` for valid values |
| `DISPUTE_STATUS_TRANSITION_INVALID` | 400 | Requested dispute status change isn't a legal transition | Check the dispute's current status before transitioning |
| `DISPUTE_STATUS_CONFLICT` | 409 | Dispute was modified concurrently (optimistic-lock conflict) | Re-fetch the dispute and retry |
| `DISPUTE_NOT_FOUND` | 404 | No dispute with that id | Confirm the identifier |

### Payment provider codes

These surface from the path-payment/quote flow when the upstream payment
provider misbehaves.

| Code | Meaning | What to do |
|---|---|---|
| `PAYMENT_PROVIDER_ERROR` | The payment provider returned an error | Not generally retryable without changing input; check `details` |
| `PAYMENT_PROVIDER_TIMEOUT` | The payment provider didn't respond in time | Safe to retry with backoff |
| `PAYMENT_INSUFFICIENT_FUNDS` | The quoted route can't be filled at the requested amount | Retry with a smaller `sourceAmount` or a different `sourceAsset` |

## Stellar transaction result codes

The `GET /stellar/tx/:hash/status` endpoint includes a `resultCodes` object in every response.
Raw codes are always present for debugging; `transactionInfo` and `operationInfos` provide
human-readable messages and suggested actions.

### Response shape

```json
{
  "status": "failed",
  "resultCodes": {
    "transaction": "tx_bad_seq",
    "operations": ["op_success"],
    "transactionInfo": {
      "message": "Transaction sequence number is incorrect.",
      "action": "Fetch the latest account sequence number and rebuild the transaction."
    },
    "operationInfos": [
      {
        "message": "Operation was successful.",
        "action": "No action required."
      }
    ]
  },
  "ledger": 12345,
  "hash": "...",
  "createdAt": "2026-09-01T00:00:00Z"
}
```

If a code is not in the mapping table, `transactionInfo` / `operationInfos[n]` will be `null` —
fall back to the raw code in that case.

### Transaction-level codes

| Code | Message | Action |
|---|---|---|
| `tx_success` | Transaction was successful. | No action required. |
| `tx_failed` | One or more operations failed. | Inspect operation result codes. |
| `tx_too_early` | minTime has not yet been reached. | Wait for minTime. |
| `tx_too_late` | maxTime has already passed. | Rebuild with updated time bounds. |
| `tx_missing_operation` | Transaction has no operations. | Add at least one operation. |
| `tx_bad_seq` | Sequence number is incorrect. | Refresh account sequence and rebuild. |
| `tx_bad_auth` | Too few valid signatures or wrong signers. | Ensure all required signers have signed. |
| `tx_insufficient_balance` | Not enough XLM for fee + minimum balance. | Fund the source account. |
| `tx_no_source_account` | Source account does not exist. | Create the account first. |
| `tx_insufficient_fee` | Fee too low for current network load. | Increase fee; see `/stellar/fees`. |
| `tx_bad_auth_extra` | Unused signatures present. | Remove extra signatures. |
| `tx_internal_error` | Internal Horizon error. | Retry; report if persistent. |

### Operation-level codes (common)

| Code | Message | Action |
|---|---|---|
| `op_success` | Operation was successful. | No action required. |
| `op_bad_auth` | Insufficient signatures for this operation. | Provide correct signer. |
| `op_underfunded` | Insufficient funds for this operation. | Add more funds and retry. |
| `op_no_source_account` | Operation source account does not exist. | Create the account first. |
| `payment_underfunded` | Not enough funds to send this payment. | Reduce amount or fund account. |
| `payment_no_destination` | Destination account does not exist. | Create destination account. |
| `payment_no_trust` | Destination lacks a trustline for the asset. | Ask recipient to add trustline. |
| `payment_line_full` | Destination trustline balance would exceed limit. | Reduce amount or increase limit. |
| `payment_src_no_trust` | Source lacks a trustline for the asset. | Create trustline on source account. |
| `manage_offer_underfunded` | Insufficient funds for the offer. | Add more funds and retry. |
| `manage_offer_low_reserve` | Not enough XLM for additional offer reserve. | Add XLM to source account. |
| `manage_offer_cross_self` | Offer would cross own existing offer. | Cancel conflicting offer first. |

## Resolution checklist

1. **Read `code` before `message`** - `message` is for humans/logs and can
   change wording over time; `code` is the stable contract to branch on.
2. **`401` is always worth one retry** after re-authenticating - tokens
   expire (`JWT_EXPIRES_IN`, default 24h) and can be revoked by logout on
   another session.
3. **`429` and `INFRA_ERROR`/`5xx`** are the only cases worth an automatic
   retry with backoff. Everything else (`400`, `403`, `404`, `409`) means
   the request itself needs to change first.
4. **`403` vs `404`**: some endpoints (e.g. fetching another user's trade)
   intentionally return `404` instead of `403` to avoid confirming that a
   resource exists for an unauthorized caller. Don't assume a `404` means
   "never existed."
5. When reporting a bug, include the endpoint, `code`, and `requestId`
   (or `correlationId`) from the response - that's what maps back to a
   specific server-side log entry.
