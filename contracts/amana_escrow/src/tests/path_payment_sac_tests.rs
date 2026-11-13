/// Issue #16 — `deposit_with_path` → `finalize_path_payment` → release against
/// real Stellar Asset Contracts (`register_stellar_asset_contract_v2`) for both
/// the source and the escrow token, rather than mocks.
///
/// The contract does not perform the swap itself: it records the intent, an
/// external path payment delivers the escrow token to the buyer, and
/// `finalize_path_payment` transfers the buyer-authorized exact amount into
/// escrow. Tests simulate that delivery by minting the escrow token to the buyer.
#[cfg(test)]
#[allow(clippy::module_inception)]
mod path_payment_sac_tests {
    use crate::TradeStatus;
    use crate::test_fixture::AdminSignerFixture;
    use soroban_sdk::{Address, Vec, vec};

    /// Stellar Asset Contracts always use 7 decimals.
    const SAC_DECIMALS: u32 = 7;
    const SOURCE_AMOUNT: i128 = 1_000 * 10_i128.pow(SAC_DECIMALS);

    fn path(f: &AdminSignerFixture) -> Vec<Address> {
        vec![&f.env, f.source_token_id.clone(), f.token_id.clone()]
    }

    /// Create a `Created` trade and open a path deposit for `SOURCE_AMOUNT`.
    fn open_path_deposit(f: &AdminSignerFixture, dest_min: i128) -> u64 {
        f.mint_source(&f.buyer, SOURCE_AMOUNT);
        let tid = f.client().create_trade(
            &f.buyer,
            &f.seller,
            &SOURCE_AMOUNT,
            &5000u32,
            &5000u32,
            &None,
        );
        f.client()
            .deposit_with_path(&tid, &f.buyer, &SOURCE_AMOUNT, &dest_min, &path(f));
        tid
    }

    /// Simulate the external path payment delivering `dest_amount` to the buyer.
    fn deliver(f: &AdminSignerFixture, buyer: &Address, dest_amount: i128) {
        f.mint(buyer, dest_amount);
    }

    #[test]
    fn source_and_escrow_tokens_are_distinct_sacs() {
        let f = AdminSignerFixture::new_with_source_token();
        assert_ne!(f.source_token_id, f.token_id);
        assert_eq!(f.client().get_source_token(), f.source_token_id);
        assert_eq!(f.client().get_token_contract(), f.token_id);
    }

    #[test]
    fn deposit_with_path_leaves_source_tokens_with_the_buyer() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);

        assert_eq!(f.source_token().balance(&f.buyer), SOURCE_AMOUNT);
        assert_eq!(f.source_token().balance(&f.contract_id), 0);
        // Nothing of the escrow token has moved yet; the trade is not funded.
        assert_eq!(f.token().balance(&f.contract_id), 0);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    #[test]
    fn path_intent_cannot_claim_an_unrelated_trade_deposit() {
        let f = AdminSignerFixture::new_with_source_token();
        let path_tid = open_path_deposit(&f, SOURCE_AMOUNT);

        let unrelated_buyer = f.stranger.clone();
        f.mint(&unrelated_buyer, SOURCE_AMOUNT);
        let unrelated_tid = f.client().create_trade(
            &unrelated_buyer,
            &f.seller,
            &SOURCE_AMOUNT,
            &5000u32,
            &5000u32,
            &None,
        );
        f.client().deposit(&unrelated_tid);

        let result = f.client().try_finalize_path_payment(&path_tid, &f.buyer);
        assert!(
            result.is_err(),
            "a different trade's escrow deposit must not finalize this path intent"
        );
        assert!(matches!(
            f.client().get_trade(&path_tid).status,
            TradeStatus::Created
        ));
        assert!(matches!(
            f.client().get_trade(&unrelated_tid).status,
            TradeStatus::Funded
        ));
        assert_eq!(f.token().balance(&f.contract_id), SOURCE_AMOUNT);
    }

    #[test]
    fn finalization_transfers_only_the_buyers_path_payment_delta() {
        let f = AdminSignerFixture::new_with_source_token();
        let preexisting_balance = 123i128;
        let dest_amount = SOURCE_AMOUNT * 2;
        f.mint(&f.buyer, preexisting_balance);
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);

        deliver(&f, &f.buyer, dest_amount);
        f.client().finalize_path_payment(&tid, &f.buyer);

        assert_eq!(f.client().get_trade(&tid).amount, SOURCE_AMOUNT);
        assert_eq!(
            f.token().balance(&f.buyer),
            preexisting_balance + dest_amount - SOURCE_AMOUNT
        );
        assert_eq!(f.token().balance(&f.contract_id), SOURCE_AMOUNT);
    }

    #[test]
    fn two_open_intents_with_one_swap_fund_only_the_first_finalized_trade() {
        let f = AdminSignerFixture::new_with_source_token();
        let first = open_path_deposit(&f, SOURCE_AMOUNT);
        let second = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, &f.buyer, SOURCE_AMOUNT);

        f.client().finalize_path_payment(&first, &f.buyer);
        let second_result = f.client().try_finalize_path_payment(&second, &f.buyer);

        assert!(second_result.is_err());
        assert!(matches!(
            f.client().get_trade(&first).status,
            TradeStatus::Funded
        ));
        assert_eq!(f.client().get_trade(&first).amount, SOURCE_AMOUNT);
        assert!(matches!(
            f.client().get_trade(&second).status,
            TradeStatus::Created
        ));
    }

    #[test]
    fn surplus_above_dest_min_stays_with_the_buyer() {
        let f = AdminSignerFixture::new_with_source_token();
        let dest_min = SOURCE_AMOUNT;
        let received = SOURCE_AMOUNT * 2;
        let tid = open_path_deposit(&f, dest_min);
        deliver(&f, &f.buyer, received);

        f.client().finalize_path_payment(&tid, &f.buyer);

        assert_eq!(f.client().get_trade(&tid).amount, dest_min);
        assert_eq!(f.token().balance(&f.contract_id), dest_min);
        assert_eq!(f.token().balance(&f.buyer), received - dest_min);
    }

    #[test]
    fn third_party_credit_after_intent_is_fungible_and_can_fund_the_trade() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        f.mint(&f.stranger, SOURCE_AMOUNT);
        f.token().transfer(&f.stranger, &f.buyer, &SOURCE_AMOUNT);

        f.client().finalize_path_payment(&tid, &f.buyer);

        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Funded
        ));
        assert_eq!(f.client().get_trade(&tid).amount, SOURCE_AMOUNT);
    }

    #[test]
    fn spending_received_tokens_can_put_net_delta_below_minimum() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        let received = SOURCE_AMOUNT + SOURCE_AMOUNT / 2;
        let spent = SOURCE_AMOUNT * 6 / 10;
        deliver(&f, &f.buyer, received);
        f.token().transfer(&f.buyer, &f.stranger, &spent);

        let result = f.client().try_finalize_path_payment(&tid, &f.buyer);

        assert!(result.is_err());
        assert_eq!(f.token().balance(&f.buyer), SOURCE_AMOUNT * 9 / 10);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    #[test]
    fn tokens_received_before_intent_do_not_count_toward_minimum() {
        let f = AdminSignerFixture::new_with_source_token();
        f.mint(&f.buyer, SOURCE_AMOUNT);
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);

        let result = f.client().try_finalize_path_payment(&tid, &f.buyer);

        assert!(result.is_err());
        assert_eq!(f.token().balance(&f.buyer), SOURCE_AMOUNT);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    #[test]
    fn path_intent_rejects_minimum_below_agreed_trade_amount() {
        let f = AdminSignerFixture::new_with_source_token();
        f.mint_source(&f.buyer, SOURCE_AMOUNT);
        let tid = f.client().create_trade(
            &f.buyer,
            &f.seller,
            &SOURCE_AMOUNT,
            &5000u32,
            &5000u32,
            &None,
        );

        let result = f.client().try_deposit_with_path(
            &tid,
            &f.buyer,
            &SOURCE_AMOUNT,
            &(SOURCE_AMOUNT - 1),
            &path(&f),
        );

        assert!(result.is_err());
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
        assert_eq!(f.source_token().balance(&f.contract_id), 0);
    }

    /// deposit_with_path → finalize_path_payment → confirm_delivery → release.
    #[test]
    fn path_deposit_finalize_and_release_end_to_end() {
        let f = AdminSignerFixture::new_with_source_token();
        // The path pays out 2 units of escrow token per source unit.
        let dest_amount = SOURCE_AMOUNT * 2;
        let tid = open_path_deposit(&f, dest_amount);

        deliver(&f, &f.buyer, dest_amount);
        f.client().finalize_path_payment(&tid, &f.buyer);

        let trade = f.client().get_trade(&tid);
        assert!(matches!(trade.status, TradeStatus::Funded));
        assert_eq!(trade.amount, dest_amount);
        assert_eq!(f.token().balance(&f.contract_id), dest_amount);

        f.client().confirm_delivery(&tid);
        f.client().release_funds(&tid, &f.buyer);

        let fee = f.client().get_accrued_fees();
        assert!(fee > 0);
        assert_eq!(f.token().balance(&f.seller), dest_amount - fee);
        // The contract retains exactly the accrued fees of the escrow token.
        assert_eq!(f.token().balance(&f.contract_id), fee);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Completed
        ));
    }

    /// The admin may also finalize a path payment on the buyer's behalf.
    #[test]
    fn admin_can_finalize_path_payment() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, &f.buyer, SOURCE_AMOUNT);

        f.client().finalize_path_payment(&tid, &f.admin);

        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Funded
        ));
    }

    #[test]
    #[should_panic(expected = "Unauthorized path payment finalization")]
    fn stranger_cannot_finalize_path_payment() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, &f.buyer, SOURCE_AMOUNT);

        f.client().finalize_path_payment(&tid, &f.stranger);
    }

    /// Slippage: the path delivers less than `dest_min`, so finalization is
    /// rejected and the trade stays unfunded with its intent still pending.
    #[test]
    #[should_panic(expected = "Path payment: dest_amount below dest_min")]
    fn finalize_rejects_slippage_below_dest_min() {
        let f = AdminSignerFixture::new_with_source_token();
        let dest_min = SOURCE_AMOUNT;
        let tid = open_path_deposit(&f, dest_min);
        deliver(&f, &f.buyer, dest_min - 1);

        f.client().finalize_path_payment(&tid, &f.buyer);
    }

    /// After a slippage rejection nothing is consumed: once enough escrow
    /// token arrives the same intent finalizes normally.
    #[test]
    fn slippage_rejection_leaves_trade_and_intent_intact() {
        let f = AdminSignerFixture::new_with_source_token();
        let dest_min = SOURCE_AMOUNT;
        let tid = open_path_deposit(&f, dest_min);
        deliver(&f, &f.buyer, dest_min - 1);

        assert!(
            f.client()
                .try_finalize_path_payment(&tid, &f.buyer)
                .is_err()
        );
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));

        // The shortfall arrives late; the pending intent is still valid.
        deliver(&f, &f.buyer, 1);
        f.client().finalize_path_payment(&tid, &f.buyer);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Funded
        ));
        assert_eq!(f.client().get_trade(&tid).amount, dest_min);
    }

    /// Nothing delivered at all is a slippage failure, not a funded zero trade.
    #[test]
    fn finalize_rejects_when_nothing_was_delivered() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);

        assert!(
            f.client()
                .try_finalize_path_payment(&tid, &f.buyer)
                .is_err()
        );
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    /// Decimal mismatch: a `dest_min` computed as if the escrow asset used 18
    /// decimals cannot be met by a 7-decimal SAC delivery, so it is rejected
    /// rather than silently funding a trade with the wrong scale.
    #[test]
    fn finalize_rejects_dest_min_scaled_for_wrong_decimals() {
        let f = AdminSignerFixture::new_with_source_token();
        let wrong_scale = 10_i128.pow(18 - SAC_DECIMALS);
        let tid = open_path_deposit(&f, SOURCE_AMOUNT * wrong_scale);
        // A correct 1:1 delivery at the SAC's real 7 decimals.
        deliver(&f, &f.buyer, SOURCE_AMOUNT);

        assert!(
            f.client()
                .try_finalize_path_payment(&tid, &f.buyer)
                .is_err()
        );
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    /// With `dest_min` scaled for the real 7 decimals, the same delivery
    /// funds the trade at exactly the delivered amount.
    #[test]
    fn finalize_accepts_dest_min_scaled_for_matching_decimals() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, &f.buyer, SOURCE_AMOUNT);

        f.client().finalize_path_payment(&tid, &f.buyer);
        assert_eq!(f.client().get_trade(&tid).amount, SOURCE_AMOUNT);
    }

    /// A second path deposit cannot be opened while one is pending.
    #[test]
    #[should_panic(expected = "Trade must be in Created status")]
    fn finalized_trade_cannot_open_another_path_deposit() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, &f.buyer, SOURCE_AMOUNT);
        f.client().finalize_path_payment(&tid, &f.buyer);

        f.mint_source(&f.buyer, SOURCE_AMOUNT);
        f.client()
            .deposit_with_path(&tid, &f.buyer, &SOURCE_AMOUNT, &SOURCE_AMOUNT, &path(&f));
    }
}
