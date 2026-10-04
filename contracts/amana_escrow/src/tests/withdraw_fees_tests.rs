/// Issue #5 — `withdraw_fees` must refuse the escrow contract as destination.
#[cfg(test)]
mod withdraw_fees_tests {
    use crate::fee_errors;
    use crate::test_fixture::AdminSignerFixture;

    /// Fund a trade, confirm delivery and release it so fees accrue.
    fn accrue_fees(f: &AdminSignerFixture) -> i128 {
        let tid = f.funded_trade(10_000);
        f.client().confirm_delivery(&tid);
        f.client().release_funds(&tid, &f.buyer);
        let accrued = f.client().get_accrued_fees();
        assert!(accrued > 0);
        accrued
    }

    #[test]
    #[should_panic(expected = "FEES_DESTINATION_IS_CONTRACT")]
    fn withdraw_fees_rejects_contract_as_destination() {
        let f = AdminSignerFixture::new();
        let accrued = accrue_fees(&f);
        f.client().withdraw_fees(&accrued, &f.contract_id);
    }

    #[test]
    fn withdraw_fees_rejection_leaves_accrued_fees_untouched() {
        let f = AdminSignerFixture::new();
        let accrued = accrue_fees(&f);
        let result = f.client().try_withdraw_fees(&accrued, &f.contract_id);
        assert!(result.is_err());
        assert_eq!(f.client().get_accrued_fees(), accrued);
    }

    #[test]
    fn withdraw_fees_to_other_destination_still_works() {
        let f = AdminSignerFixture::new();
        let accrued = accrue_fees(&f);
        f.client().withdraw_fees(&accrued, &f.treasury);
        assert_eq!(f.client().get_accrued_fees(), 0);
        assert_eq!(f.token().balance(&f.treasury), accrued);
    }

    #[test]
    fn fee_error_code_is_stable() {
        assert_eq!(
            fee_errors::DESTINATION_IS_CONTRACT,
            "FEES_DESTINATION_IS_CONTRACT"
        );
    }
}
