/// Issue #16 — `deposit_with_path` → `finalize_path_payment` → release against
/// real Stellar Asset Contracts (`register_stellar_asset_contract_v2`) for both
/// the source and the escrow token, rather than mocks.
///
/// The contract does not perform the swap itself: it records the intent, an
/// external path payment delivers the escrow token to the contract, and
/// `finalize_path_payment` measures the balance delta. Tests simulate that
/// delivery by minting the escrow token to the contract address.
#[cfg(test)]
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

    /// Simulate the external path payment delivering `dest_amount` of the
    /// escrow token to the contract.
    fn deliver(f: &AdminSignerFixture, dest_amount: i128) {
        f.mint(&f.contract_id, dest_amount);
    }

    #[test]
    fn source_and_escrow_tokens_are_distinct_sacs() {
        let f = AdminSignerFixture::new_with_source_token();
        assert_ne!(f.source_token_id, f.token_id);
        assert_eq!(f.client().get_source_token(), f.source_token_id);
        assert_eq!(f.client().get_token_contract(), f.token_id);
    }

    #[test]
    fn deposit_with_path_moves_real_source_tokens_into_escrow_contract() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);

        assert_eq!(f.source_token().balance(&f.buyer), 0);
        assert_eq!(f.source_token().balance(&f.contract_id), SOURCE_AMOUNT);
        // Nothing of the escrow token has moved yet; the trade is not funded.
        assert_eq!(f.token().balance(&f.contract_id), 0);
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));
    }

    /// deposit_with_path → finalize_path_payment → confirm_delivery → release.
    #[test]
    fn path_deposit_finalize_and_release_end_to_end() {
        let f = AdminSignerFixture::new_with_source_token();
        // The path pays out 2 units of escrow token per source unit.
        let dest_amount = SOURCE_AMOUNT * 2;
        let tid = open_path_deposit(&f, dest_amount);

        deliver(&f, dest_amount);
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
        deliver(&f, SOURCE_AMOUNT);

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
        deliver(&f, SOURCE_AMOUNT);

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
        deliver(&f, dest_min - 1);

        f.client().finalize_path_payment(&tid, &f.buyer);
    }

    /// After a slippage rejection nothing is consumed: once enough escrow
    /// token arrives the same intent finalizes normally.
    #[test]
    fn slippage_rejection_leaves_trade_and_intent_intact() {
        let f = AdminSignerFixture::new_with_source_token();
        let dest_min = SOURCE_AMOUNT;
        let tid = open_path_deposit(&f, dest_min);
        deliver(&f, dest_min - 1);

        assert!(f.client().try_finalize_path_payment(&tid, &f.buyer).is_err());
        assert!(matches!(
            f.client().get_trade(&tid).status,
            TradeStatus::Created
        ));

        // The shortfall arrives late; the pending intent is still valid.
        deliver(&f, 1);
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

        assert!(f.client().try_finalize_path_payment(&tid, &f.buyer).is_err());
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
        deliver(&f, SOURCE_AMOUNT);

        assert!(f.client().try_finalize_path_payment(&tid, &f.buyer).is_err());
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
        deliver(&f, SOURCE_AMOUNT);

        f.client().finalize_path_payment(&tid, &f.buyer);
        assert_eq!(f.client().get_trade(&tid).amount, SOURCE_AMOUNT);
    }

    /// A second path deposit cannot be opened while one is pending.
    #[test]
    #[should_panic(expected = "Trade must be in Created status")]
    fn finalized_trade_cannot_open_another_path_deposit() {
        let f = AdminSignerFixture::new_with_source_token();
        let tid = open_path_deposit(&f, SOURCE_AMOUNT);
        deliver(&f, SOURCE_AMOUNT);
        f.client().finalize_path_payment(&tid, &f.buyer);

        f.mint_source(&f.buyer, SOURCE_AMOUNT);
        f.client()
            .deposit_with_path(&tid, &f.buyer, &SOURCE_AMOUNT, &SOURCE_AMOUNT, &path(&f));
    }
}
