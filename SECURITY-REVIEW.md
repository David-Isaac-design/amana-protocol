# Amana Protocol Security Review Summary

This summary covers the contract legacy-storage and path-payment findings
reviewed for the path-payment redesign. The detailed analysis and caller
inventory are in [docs/contract-security-review.md](./docs/contract-security-review.md).

| # | Severity | File | Lines | Vulnerability | Confidence |
|---|----------|------|-------|---------------|------------|
| 1 | 🟡 MEDIUM | [contracts/amana_escrow/src/lib.rs](./contracts/amana_escrow/src/lib.rs#L1974) | 1974 | **Resolved:** legacy unwrapped trades could fail on expiry-refund reads. Fixed in `045fbcd`; `test_upgrade_reads_legacy_unwrapped_trade_storage` confirms legacy reads but is not an end-to-end expiry-claim test. | 9/10 |
| 2 | 🟠 HIGH | [contracts/amana_escrow/src/lib.rs](./contracts/amana_escrow/src/lib.rs#L2170) | 2170, 2405 | **Resolved:** escrow-wide token deltas could let unrelated deposits satisfy a path intent. Fixed in `47ce298`; regression tests are `path_intent_cannot_claim_an_unrelated_trade_deposit` and `finalization_transfers_only_the_buyers_path_payment_delta`. | 10/10 |
| 3 | 🟡 MEDIUM | [contracts/amana_escrow/src/tests/path_payment_sac_tests.rs](./contracts/amana_escrow/src/tests/path_payment_sac_tests.rs#L54) | 54 | **Resolved as a side effect of #2:** source tokens are no longer transferred into escrow when the contract does not execute the external swap. Regression test: `deposit_with_path_leaves_source_tokens_with_the_buyer`. | 10/10 |
| 4 | 🟡 MEDIUM | [contracts/amana_escrow/src/lib.rs](./contracts/amana_escrow/src/lib.rs#L2170) | 2170, 2405 | **Residual:** any post-intent destination-token credit, including a third-party transfer, can satisfy the balance check if the buyer authorizes finalization. Test: `third_party_credit_after_intent_is_fungible_and_can_fund_the_trade`. | 10/10 |
| 5 | 🟡 MEDIUM | [contracts/amana_escrow/src/tests/path_payment_sac_tests.rs](./contracts/amana_escrow/src/tests/path_payment_sac_tests.rs#L121) | 121 | **Residual:** multiple open intents for one buyer share the same balance increase; the first finalized intent can fund, while another may fail if the remaining delta is insufficient. Test: `two_open_intents_with_one_swap_fund_only_the_first_finalized_trade`. | 10/10 |
| 6 | ⚪ LOW | [contracts/amana_escrow/src/lib.rs](./contracts/amana_escrow/src/lib.rs#L2405) | 2405 | **Residual:** spending destination tokens after intent creation can reduce the net delta below `dest_min` and block finalization until replenished. Test: `spending_received_tokens_can_put_net_delta_below_minimum`. | 9/10 |

The current path flow requires opening the intent before the external swap.
Finalization requires a post-intent balance increase of at least `dest_min`,
which must cover the agreed trade amount; exactly `dest_min` is transferred to
escrow and any surplus remains in the buyer's wallet. No storage-layout or
golden-value changes were made. The medium residual risks require stronger
payment provenance or intent serialization to eliminate.
