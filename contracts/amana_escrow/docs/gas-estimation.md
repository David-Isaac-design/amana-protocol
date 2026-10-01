# Amana Escrow Gas Estimation

This document records the assumptions used by the contract gas and footprint regression tests.

## Scope

The gas suite measures the Amana escrow hot paths that are most likely to affect user-facing transaction cost:

- `create_trade`
- `deposit`
- `initiate_dispute`
- `resolve_dispute`
- `admin_clawback` (unilateral admin `cancel_trade` on funded escrow)
- repeated partial `admin_clawback` calls on the same trade (Issue #110)
- the combined dispute lifecycle

## Baseline Gas & Footprint Thresholds

| Path | CPU Instructions Baseline | Memory Bytes Baseline | Primary Cost Drivers |
| --- | --- | --- | --- |
| `create_trade` | 3,000,000 | 2,000,000 | Trade struct initialization, persistent storage write, counter bump |
| `deposit` | 5,000,000 | 3,000,000 | Auth verification, Stellar asset token transfer into escrow, status update |
| `initiate_dispute` | 3,000,000 | 2,000,000 | Dispute record initialization, reason hash validation, status update |
| `resolve_dispute` | 8,000,000 | 4,000,000 | Mediator authorization, payout BPS calculation, token transfer(s), dispute record update |
| `admin_clawback` | 6,000,000 | 3,500,000 | Admin auth check, Stellar asset token refund transfer to buyer, status update to `Cancelled`, release sequence update, event emission |
| `repeated_partial_clawback` (5x) | 25,000,000 | 15,000,000 | 5 sequential partial `admin_clawback` calls: admin auth + feature-flag check, token transfer, `ClawbackTotal` read/write, and trade-record write per call |

### Repeated clawback benchmarking (Issue #110)

`test_gas_repeated_partial_clawback` calls `admin_clawback` 5 times in a row against the same trade to confirm cost scales linearly (no unbounded storage growth per call — `ClawbackTotal` is a single scalar overwrite, not an appended list). The baseline above is set with headroom over `5 * BASELINE_ADMIN_CLAWBACK` rather than a full 1:1 multiple, since repeated calls skip the one-time trade-creation/deposit setup cost. No further gas optimization was identified as necessary at this call volume; if future changes make per-trade clawback history append-only, re-baseline using the policy below and re-evaluate whether the per-call cost still stays flat.

## Methodology

The tests use Soroban test utilities and reset the budget immediately before the measured closure. Setup calls such as contract registration, token minting, initialization, and mediator registration are intentionally excluded from hot-path measurements.

Every measured path asserts both CPU instruction cost and memory byte cost against the checked-in values in `src/tests/gas_footprint_baselines.json`. Each value allows at most 10% headroom; exceeding either CPU or memory budget fails the test. Test output reports the measured value, baseline, and maximum for each path.

## Re-baselining policy

Only re-baseline when a deliberate contract change increases cost for a documented reason. When re-baselining:

1. Run `cargo test --lib gas_footprint_tests -- --nocapture` from `contracts/amana_escrow/` and record the reported CPU and memory values.
2. Update the matching entry in `src/tests/gas_footprint_baselines.json` to the newly measured values; do not add the 10% budget to the stored baseline.
3. Run the gas-footprint tests again and confirm the new baseline passes with the shared 10% allowance.
4. Commit baseline changes together with the contract change that caused the intentional increase, explaining the cost in the PR.

Do not add network-dependent or timing-dependent checks to the gas suite. CI should remain deterministic and non-flaky.

## Current invariants

Gas estimation must not weaken these contract invariants:

- escrowed funds are conserved across release and dispute-resolution transfers;
- only valid trade lifecycle transitions are accepted;
- only approved mediators may resolve disputes;
- evidence and release sequence storage remain append-only or monotonic where applicable.
