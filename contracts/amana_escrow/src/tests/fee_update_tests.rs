/// Issue #751 — update_fee_bps tests
// =============================================================================
// Issue #12 — [Contract] Test that fee changes do not affect already-funded trades
// https://github.com/Happybello365/innov8/issues/12
//
// ─── PROBLEM ─────────────────────────────────────────────────────────────────
//
// update_fee_bps() changes the GLOBAL platform fee stored at DataKey::FeeBps.
// release_funds() and resolve_dispute() read DataKey::FeeBps at the time of
// settlement, NOT at the time the trade was funded. This means:
//
//   • A trade funded at 1% fee → admin raises fee to 5% → seller settles
//     and receives 95% not 99%.
//
// The intended behaviour has never been formally documented. There are two
// valid design choices:
//
//   Option A — "Fee at funding" (snapshot):
//     The fee is locked into Trade.fee_bps at create_trade() / deposit() time.
//     Settlement always uses Trade.fee_bps. An admin fee change only applies
//     to trades created after the change.
//
//   Option B — "Fee at settlement" (live):
//     Settlement always uses the current global fee. Trades funded before a
//     change pay the new rate. This is the current (undocumented) behaviour.
//
// DECISION (document in this file and in the contract):
// The current behaviour is Option B. This is intentional because:
//   - It allows the protocol to adjust fees without a contract upgrade.
//   - LPs benefit from fee increases on in-flight trades.
//   - The risk to traders is bounded by the MIN_FEE_BPS/MAX_FEE_BPS range
//     (1–500 bps), so the worst-case surprise is 5% - initial_rate.
//
// This decision MUST be documented in the contract's public API docs and in
// README/CHANGELOG so traders know to check the current fee before funding.
//
// ─── TESTS TO ADD (in this file) ─────────────────────────────────────────────
//
// Test 1 — fee_change_affects_release_path
// ----------------------------------------
// Steps:
//   1. Initialize contract with fee_bps = 100 (1%)
//   2. Fund a trade for 10_000 stroops
//   3. Confirm delivery
//   4. Admin calls update_fee_bps(500)  ← fee raised to 5% while trade is live
//   5. Buyer calls release_funds
//
// Expected (Option B — fee at settlement):
//   seller receives 10_000 * 95% = 9_500
//   treasury accrues 500
//
// Assert:
//   assert_eq!(tok.balance(&seller), 9_500);
//   assert_eq!(client.get_accrued_fees(), 500);
//
// Test 2 — fee_change_affects_dispute_path
// -----------------------------------------
// Same setup but use initiate_dispute + resolve_dispute(mediator, 10_000_bps)
// (full seller payout). After the fee change to 5%:
//   seller_raw = 10_000, fee = 500, seller_net = 9_500
//   Assert seller gets 9_500, treasury gets 500.
//
// Test 3 — fee_change_affects_refund_path
// ----------------------------------------
// Steps:
//   1. Initialize with fee_bps = 100
//   2. Fund trade
//   3. Admin raises fee to 5%
//   4. Seller calls refund() (unilateral refund)
//
// Expected: refund() returns the full escrowed amount to buyer with no fee
// deduction (refund path does not call checked_fee_amount — verify this).
// This is the one path where fee changes are irrelevant.
//
// ─── ACCEPTANCE CRITERIA ─────────────────────────────────────────────────────
//
//  ✅  Documented semantics: fee is applied at settlement time (Option B)
//  ✅  Test 1: release path after fee increase
//  ✅  Test 2: dispute path after fee increase
//  ✅  Test 3: refund path is fee-independent
//  ✅  All three tests are in this file (fee_update_tests.rs)
//
// ─── FILES TO CHANGE ─────────────────────────────────────────────────────────
//
//   contracts/amana_escrow/src/tests/fee_update_tests.rs ← (THIS FILE) tests
//   contracts/amana_escrow/src/lib.rs  ← add doc comment to update_fee_bps()
//                                         stating "fee applies at settlement"
//   README.md or SECURITY.md           ← document fee semantics publicly
//
// =============================================================================
#[cfg(test)]
#[allow(clippy::module_inception)]
mod fee_update_tests {
    use crate::{EscrowContract, EscrowContractClient, MAX_FEE_BPS, MIN_FEE_BPS};
    use crate::test_fixture::admin_address;
    use soroban_sdk::{Address, Env, IntoVal, testutils::Address as _};

    fn setup(env: &Env) -> (Address, Address, Address) {
        let admin = admin_address(env);
        let contract_id = env.register(EscrowContract, ());
        let token = Address::generate(env);
        let treasury = Address::generate(env);
        EscrowContractClient::new(env, &contract_id)
            .initialize(&admin, &token, &treasury, &100u32, &token);
        (contract_id, admin, token)
    }

    #[test]
    fn update_fee_bps_valid_updates() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        let client = EscrowContractClient::new(&env, &contract_id);
        client.update_fee_bps(&MIN_FEE_BPS);
        client.update_fee_bps(&250u32);
        client.update_fee_bps(&MAX_FEE_BPS);
    }

    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn update_fee_bps_rejects_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        EscrowContractClient::new(&env, &contract_id).update_fee_bps(&0u32);
    }

    #[test]
    #[should_panic(expected = "fee_bps out of range")]
    fn update_fee_bps_rejects_above_max() {
        let env = Env::default();
        env.mock_all_auths();
        let (contract_id, _admin, _token) = setup(&env);
        EscrowContractClient::new(&env, &contract_id).update_fee_bps(&(MAX_FEE_BPS + 1));
    }

    #[test]
    #[should_panic]
    fn update_fee_bps_rejects_non_admin() {
        let env = Env::default();
        let (contract_id, _admin, _token) = setup(&env);
        let stranger = Address::generate(&env);
        // Provide auth only for stranger — admin.require_auth() will fail
        EscrowContractClient::new(&env, &contract_id)
            .mock_auths(&[soroban_sdk::testutils::MockAuth {
                address: &stranger,
                invoke: &soroban_sdk::testutils::MockAuthInvoke {
                    contract: &contract_id,
                    fn_name: "update_fee_bps",
                    args: soroban_sdk::vec![
                        &env,
                        IntoVal::<Env, soroban_sdk::Val>::into_val(&250u32, &env),
                    ],
                    sub_invokes: &[],
                },
            }])
            .update_fee_bps(&250u32);
    }
}
