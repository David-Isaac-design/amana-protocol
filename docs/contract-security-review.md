# Contract Security Review: Path-Payment Funding

## Scope

This update records the previously identified path-payment and legacy-storage
findings, then reviews the buyer-balance-snapshot redesign and its regression
tests. It is not a new audit of every public contract entry point.

No `DataKey` variant, `Trade` field, or golden storage value was changed for
this redesign.

## Findings

| # | Severity | Finding and status | Evidence / resolution |
|---|---|---|---|
| 1 | Medium | **Resolved:** expiry refund reads could fail for legacy unwrapped trade storage. | `load_trade` handles both stored forms; commit `045fbcd6ba237ccbcf1f7bfca69ac5e8f8994456`. `test_upgrade_reads_legacy_unwrapped_trade_storage` verifies the legacy value remains readable after upgrade; it is not an end-to-end expiry-claim test. |
| 2 | High | **Resolved:** finalization could use escrow-wide token balance changes to satisfy a buyer's path intent, allowing unrelated deposits to be misattributed. | Commit `47ce29822e5cad3f11ac1e5290d8ac47a82400d5` snapshots the buyer's destination-token balance at intent creation and measures that buyer's later balance increase. Regression tests: `path_intent_cannot_claim_an_unrelated_trade_deposit` and `finalization_transfers_only_the_buyers_path_payment_delta` in `src/tests/path_payment_sac_tests.rs`. |
| 3 | Medium | **Resolved as a side effect of finding 2:** the prior intent path transferred the source token to escrow even though the contract did not execute the external swap. | Commit `47ce29822e5cad3f11ac1e5290d8ac47a82400d5` removes that source-token transfer. Regression test: `deposit_with_path_leaves_source_tokens_with_the_buyer` in `src/tests/path_payment_sac_tests.rs`. |
| 4 | Medium | **Residual:** a buyer's post-intent balance increase is fungible, not transaction-proven. A third-party destination-token credit can satisfy the minimum if the buyer authorizes finalization. | Test: `third_party_credit_after_intent_is_fungible_and_can_fund_the_trade`. The contract does not inspect a payment receipt or establish the credit's sender. |
| 5 | Medium | **Residual:** multiple open intents for one buyer share post-intent balance changes. The first finalized intent can use its own minimum; a later intent fails if its remaining measured delta is too small. | Test: `two_open_intents_with_one_swap_fund_only_the_first_finalized_trade`. Clients should serialize intents per buyer. |
| 6 | Low | **Residual:** spending destination tokens after opening an intent reduces the net balance increase and can block finalization until the shortfall is replenished. | Tests: `spending_received_tokens_can_put_net_delta_below_minimum` and `slippage_rejection_leaves_trade_and_intent_intact`. Failed finalization does not fund the trade or consume the intent. |

## Current path-payment invariants

- The intent must be opened before the external path payment; pre-intent
  credits are part of the baseline and do not count.
- `dest_min` must be at least the agreed trade amount. Finalization transfers
  exactly `dest_min`; any additional destination tokens remain in the buyer's
  wallet.
- Finalization requires the buyer's authorization even when the caller is an
  authorized admin.
- The source asset is not held by escrow. The wallet submits the external path
  payment to the buyer's own account, then the buyer finalizes.
- These semantics do not provide payment provenance or serialize a buyer's
  intents. A future design that needs either guarantee requires a stronger
  receipt/nonce mechanism; no storage-layout change is included here.

## Caller and documentation inventory

- **Backend:** `GET /wallet/path-payment-quote` returns advisory quotes only;
  it does not call `deposit_with_path` or `finalize_path_payment`. Its
  destination is currently configured USDC, so it must not be presented as a
  cNGN escrow quote.
- **Frontend:** the trade-creation form posts a trade request and does not
  invoke the contract path-payment methods. Copy now says so.
- **Mobile:** no path-payment contract caller was found; its README now makes
  that limitation explicit.
- **`routes-d`:** strict-send and strict-receive handlers build generic wallet
  transactions for the supplied account destination; they do not open or
  finalize an escrow intent.
- **Scripts and docs:** the local deployment script's source-token option
  configures event attribution only. ADR-001, the Stellar API guide, local
  deployment guide, root README, and contract README document the
  intent-before-swap sequence and exact-minimum transfer.

## Original finding 4: pause policy and coverage (MEDIUM, resolved)

**Status:** The finding was omitted from the earlier written review; it had
not been fixed, rejected, or accepted at that time. The inconsistency is now
resolved in commit `927817d` (`fix(contracts): enforce pause entrypoint
policy`). The policy deliberately keeps dispute settlement and emergency
clawbacks available. Tests:

- `pause_gates_new_obligations_and_unpause_restores_them`
- `pause_keeps_settlement_refunds_disputes_and_clawbacks_available`
- `paused_buyer_can_claim_an_expired_trade`

The pause flag defaults to `false` when unset (`is_paused`, lines 1022-1028).
`pause` and `unpause` update it at lines 1235-1261 and require a guardian.
`assert_not_paused` is now applied only to the operations gated by this
policy. The entrypoint inventory reflects the implementation.

| Entry point | Lines | Checks pause now? | Behavior while paused |
|---|---:|---|---|
| `create_trade` | 2003-2012 | Yes, 2012 | Blocked; no new trade obligation. |
| `deposit` | 2099-2100 | Yes, 2100 | Blocked; no direct funding transfer. |
| `deposit_with_path` | 2139-2147 | Yes, 2147 | Blocked; no new path intent. |
| `finalize_path_payment` | 2378-2379 | Yes, 2379 | Blocked; no destination-token transfer into escrow. |
| `extend_deadline` | 2662-2663 | Yes, 2663 | Blocked; deadline obligations cannot be extended. |
| `withdraw_fees` | 1368-1369 | Yes, 1369 | Blocked; accrued fees cannot be withdrawn during the pause. |
| `confirm_delivery` | 2883-2891 | No | Available; state transition only, no transfer. |
| `release_funds` | 2913 onward | No | Available under normal state/auth rules. |
| `refund` | 2569 onward | No | Seller-authorized refund remains available. |
| `claim_expiry_refund` | 2597 onward | No | Available after expiry for a `Funded` trade and authorized caller. |
| `initiate_dispute` | 2995 onward | No | Available for a funded trade; preserves an existing party remedy. |
| `resolve_dispute` | 3109 onward | No | Settlement remains available. |
| `cast_dispute_vote` | 3376 onward | No | Available; a qualifying vote can settle the dispute. |
| `resolve_dispute_by_fallback` | 3480 onward | No | Fallback settlement remains available. |
| `cancel_trade` | 2461 onward | No | Available under normal authorization; cancellation/refund paths remain open. |
| `cancel_by_buyer` | 2538 onward | No | Buyer can cancel a `Created` trade. |
| `queue_clawback` | 1418 onward | No | Available; incident-response queueing remains available. |
| `execute_clawback` | 1485 onward | No | Available under its timelock and authorization rules. |
| `admin_clawback` | 1632 onward | No | Available under admin auth and the existing clawback-enabled control. |

### Approved pause policy

The pause blocks new funding and obligation changes: trade creation, direct
deposit, both path-payment stages, and deadline extension. Fee withdrawal is
also blocked. Unpausing restores these operations.

Settlement and user remedy paths remain available under their existing
authorization and status rules: delivery confirmation, release, cancellation,
seller refund, expiry refund, dispute initiation and resolution, voting, and
fallback settlement. Dispute initiation is not gated because it protects a
party to an already-funded trade; gating it could remove a remedy during an
incident.

Clawback also remains available while paused. It is an incident-response
mechanism; gating it could force an unpause and thereby reopen funding during
an active incident. Its existing admin authorization, clawback-enabled control,
and timelock for queued clawbacks continue to apply. Fee withdrawals are
different: they are discretionary treasury outflows, not a user-fund recovery
path, so they are gated. No `DataKey` or `Trade` layout change was made.
