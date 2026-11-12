# Contract test failure triage

The 15 failures from the initial full suite were each reproduced in isolation
against the pre-fix commit. Amounts and percentages below are in token stroops
and basis points. The accounting invariant is:

`seller payout + buyer refund + accrued fees = amount deposited`

Dispute fees are held by the escrow contract until `withdraw_fees`; they are
not transferred to the treasury during settlement.

| Test | Reproduced failure and root cause | Classification | Fix | Commit |
|---|---|---|---|---|
| `test_stress_settlement_invariants_after_interleaved_ops` | For amount `500,000`, seller outcome `8,000` bps, and fee `100` bps, the test failed `escrow not empty after settlement` (`left: 4500`, `right: 0`). Hand calculation: seller loss `50,000`, seller gross `450,000`, fee `4,500`, buyer refund `50,000`, seller net `445,500`. The `4,500` remains accrued in escrow. | STALE OR INCORRECT TEST | Assert payouts plus accrued fees equal the deposit; assert contract balance equals accrued fees and treasury balance is unchanged. | `b1595fa` |
| `test_stress_repeated_evidence_does_not_affect_settlement` | For amount `10,000`, `5,000` seller bps, and `100` fee bps, the test reported `left: 9925`, `right: 10000`. Gross seller payout is `7,500`; fee is `75`; buyer refund is `2,500`. The uncounted `75` is accrued in escrow, not in the treasury. Evidence count does not affect the arithmetic. | STALE OR INCORRECT TEST | Include accrued fees in conservation and verify the escrow holds exactly that amount. | `b1595fa` |
| `test_expiry_refund_at_exact_deadline` | Isolated call failed with `HostError: Error(WasmVm, InvalidAction)` and a `ConversionError` at `claim_expiry_refund` for trade ID `429496729601`. | REAL CONTRACT BUG | Load and save the versioned `TradeData` value through `load_trade` / `save_trade`; the existing exact-deadline test now passes. | `9651d28` |
| `test_expiry_refund_buyer_after_deadline` | Same `InvalidAction` / `ConversionError` at `claim_expiry_refund` for trade ID `429496729601`, despite the buyer being eligible after the deadline. | REAL CONTRACT BUG | Same version-aware storage fix; the existing buyer-triggered regression test now passes. | `9651d28` |
| `test_expiry_refund_seller_after_deadline` | Same `InvalidAction` / `ConversionError` at `claim_expiry_refund` for trade ID `429496729601`, despite the seller being eligible after the deadline. | REAL CONTRACT BUG | Same version-aware storage fix; the existing seller-triggered regression test now passes. | `9651d28` |
| `bench_confirm_delivery` | Failed with `attempt to subtract with overflow` while computing an event-count delta. Event counts came from different invocations (the observed counts were `2` before and `1` after); the host exposes the current invocation's events, not a cumulative counter. | TEST HARNESS/ENV ISSUE | Count events from the current invocation instead of subtracting counts captured across invocations. | `b1595fa` |
| `fee_generated_parity` | Corpus case 22 used amount `738621372729540`, fee `8587` bps. Rust correctly computed `634254172762855`; the floating-point-generated fixture expected `634254172762856` (one stroop too high; exact product remainder is `9980` modulo `10000`). | STALE OR INCORRECT TEST | Generate and check fee expectations with `BigInt`, regenerate the corpus, and retain the independent Rust assertion. | `7f48135` |
| `release_funds_conservation_parity` | Corpus case 44 used amount `189527443144471`, fee `8280` bps. Rust computed `156928722923621`; the fixture expected `156928722923622` (remainder `9880` modulo `10000`). | STALE OR INCORRECT TEST | Same exact-integer corpus fix; assert both the fixture's sum flag and seller-plus-fee conservation. | `7f48135` |
| `resolve_dispute_conservation_parity` | Corpus case 127 used total `571883557597176`, seller-getting `810` bps, seller-loss `4360` bps, and fee `7057` bps. Seller gross was `342738966204910`; Rust fee was `241870888450804`, while the fixture expected `241870888450805` (remainder `9870` modulo `10000`). | STALE OR INCORRECT TEST | Same exact-integer corpus fix; assert conservation, non-negativity, and expected clawback totals from the shared fixture. | `7f48135` |
| `test_prop_fund_conservation_seeded` | Replayed with `AMANA_PROP_SEED=1794523570`, case 0: fee `53` bps, amount `183037`, buyer loss `5785` bps, seller loss `4215` bps, seller outcome `5578` bps. Hand calculation: `floor(183037 * 4422 * 4215 / 100000000) = 34115` seller loss; seller raw is `148922`; fee is `floor(148922 * 53 / 10000) = 789`; seller net plus buyer refund is `182248`, and adding the accrued `789` gives `183037`. The test counted the treasury balance instead. | STALE OR INCORRECT TEST | Return `get_accrued_fees()` from the fixture and include it in conservation. | `b1595fa` |
| `test_boundary_fee_calculation_extremes` | Replayed with `AMANA_PROP_SEED=1794523570`, case 0: amount `183037`, fee `26` bps. Expected fee was `475`; the test read `0` from the treasury, while `183037 * 26 / 10000` floors to `475` and is accrued in escrow. | STALE OR INCORRECT TEST | Read accrued fees and compare against the independently calculated integer fee. | `b1595fa` |
| `test_boundary_split_then_merge_metamorphic` | Replayed with `AMANA_PROP_SEED=1794523570`, case 0, amount `1751945`; conservation reported `1745313` versus `1751945`. The missing amount was accrued fees omitted by the helper's treasury-balance accounting. The test also computed a full resolution but did not compare it with the merged half resolutions. | STALE OR INCORRECT TEST | Use accrued fees and compare full versus split results; derived rounding bounds are seller at most 2 stroops, buyer at most 1, and fee at most 1. | `b1595fa` |
| `prop_boundary_fuzz` | QuickCheck shrank to `(raw_amount_seed, raw_fee_bps) = (0, 0)`, giving amount `1` and fee `0`; assertion was `left: 2`, `right: 1`. Setup minted `2 * amount` but deposited only `amount`, so the buyer's unspent token was counted as a payout. Other generated cases also omitted accrued fees. | TEST HARNESS/ENV ISSUE | Mint exactly the amount under test, then include accrued fees and verify contract balance. | `b1595fa` |
| `prop_resolve_dispute_fuzz` | QuickCheck counterexample `(0, 0, 1)` maps to amount `1`, seller outcome `0` bps, and fee `1` bps. The boolean conservation result was false because the harness minted twice the deposit and counted the buyer's unspent token; any accrued fee also remains in escrow. | TEST HARNESS/ENV ISSUE | Mint exactly the deposited amount and assert payouts plus accrued fees, contract balance, and treasury balance separately. | `b1595fa` |
| `test_history_records_dispute_and_resolution` | After creation, funding, dispute, and resolution, history had 2 entries instead of 4. The dispute lifecycle emitted contract events but never appended `disputed` or `resolved` records to persistent trade history. | REAL CONTRACT BUG | Record both lifecycle transitions in the shared history using the initiator and mediator as actors; the existing regression test now passes. | `9651d28` |

## Additional assertion and harness repairs

- `bench_release_funds_hot_path`: for `100,000` at `100` bps, assert the
  accrued fee is exactly `1,000`.
- `bench_storage_footprint_deposit_release_cycle`: five releases of `50,000`
  at `100` bps accrue exactly `2,500`; assert that total rather than only
  checking that fees are positive.
- `parity_money_math` now checks corpus metadata flags, non-negative dispute
  components, payout sums, and `expected_clawback_total`.
- The TypeScript parity suite loaded its corpus in `beforeAll`, but `it.each`
  evaluates the corpus at module load time. Loading it before suite declaration
  fixes that test harness error. Its CI command now uses the Jest 30 option and
  explicitly includes the shared fixture path.
- Soroban wrote 1,006 tracked host-state snapshots and test runs rewrote them;
  property tests also use a wall-clock default seed. These files are diagnostic
  output, not golden assertions, so they are untracked and ignored. Storage
  layout checks use fixed encodings and schema-version assertions instead.

The repaired test groups passed together after the fixes: dispute stress 10,
expiry 11, gas benchmarks 5, money-math parity 7, seeded properties 14,
state-machine fuzz 6, storage goldens 15, schema-version checks 2, and trade
history 5. The final full-workspace result is recorded in [AUDIT.md](./AUDIT.md).
