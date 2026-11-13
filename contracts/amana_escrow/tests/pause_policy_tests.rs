use amana_escrow::{TradeStatus, test_fixture::AdminSignerFixture};
use soroban_sdk::{Address, String, Vec, testutils::Ledger};

const AMOUNT: i128 = 10_000;

fn create_trade(f: &AdminSignerFixture, amount: i128, expires_at: Option<u64>) -> u64 {
    f.client().create_trade(
        &f.buyer,
        &f.seller,
        &amount,
        &5000u32,
        &5000u32,
        &expires_at,
    )
}

fn fund_trade(f: &AdminSignerFixture, amount: i128, expires_at: Option<u64>) -> u64 {
    f.mint(&f.buyer, amount);
    let trade_id = create_trade(f, amount, expires_at);
    f.client().deposit(&trade_id);
    trade_id
}

fn empty_path(f: &AdminSignerFixture) -> Vec<Address> {
    Vec::new(&f.env)
}

fn pause(f: &AdminSignerFixture) {
    f.client().add_guardian(&f.stranger);
    f.client().pause(&f.stranger);
    assert!(f.client().is_paused());
}

#[test]
fn pause_gates_new_obligations_and_unpause_restores_them() {
    let f = AdminSignerFixture::new_with_source_token();

    let fee_trade = fund_trade(&f, AMOUNT, None);
    f.client().confirm_delivery(&fee_trade);
    f.client().release_funds(&fee_trade, &f.buyer);
    let accrued_fees = f.client().get_accrued_fees();
    assert!(accrued_fees > 0);

    let now = f.env.ledger().timestamp();
    let deadline_trade = fund_trade(&f, AMOUNT, Some(now + 3_600));
    let direct_deposit_trade = {
        f.mint(&f.buyer, AMOUNT);
        create_trade(&f, AMOUNT, None)
    };
    let path_intent_trade = create_trade(&f, AMOUNT, None);
    let finalize_trade = create_trade(&f, AMOUNT, None);
    f.client()
        .deposit_with_path(&finalize_trade, &f.buyer, &AMOUNT, &AMOUNT, &empty_path(&f));
    f.mint(&f.buyer, AMOUNT);

    pause(&f);

    assert!(
        f.client()
            .try_create_trade(&f.buyer, &f.seller, &AMOUNT, &5000u32, &5000u32, &None)
            .is_err()
    );
    assert!(f.client().try_deposit(&direct_deposit_trade).is_err());
    assert!(
        f.client()
            .try_deposit_with_path(
                &path_intent_trade,
                &f.buyer,
                &AMOUNT,
                &AMOUNT,
                &empty_path(&f),
            )
            .is_err()
    );
    assert!(
        f.client()
            .try_finalize_path_payment(&finalize_trade, &f.buyer)
            .is_err()
    );
    assert!(
        f.client()
            .try_extend_deadline(&deadline_trade, &(now + 7_200))
            .is_err()
    );
    assert!(
        f.client()
            .try_withdraw_fees(&accrued_fees, &f.treasury)
            .is_err()
    );
    assert_eq!(f.client().get_accrued_fees(), accrued_fees);

    f.client().unpause(&f.stranger);
    assert!(!f.client().is_paused());

    let created_after_unpause = create_trade(&f, AMOUNT, None);
    f.client().finalize_path_payment(&finalize_trade, &f.buyer);
    f.client().deposit(&direct_deposit_trade);
    f.client().deposit_with_path(
        &path_intent_trade,
        &f.buyer,
        &AMOUNT,
        &AMOUNT,
        &empty_path(&f),
    );
    f.mint(&f.buyer, AMOUNT);
    f.client()
        .finalize_path_payment(&path_intent_trade, &f.buyer);
    f.client().extend_deadline(&deadline_trade, &(now + 7_200));
    f.client().withdraw_fees(&accrued_fees, &f.treasury);

    assert!(matches!(
        f.client().get_trade(&created_after_unpause).status,
        TradeStatus::Created
    ));
    assert!(matches!(
        f.client().get_trade(&direct_deposit_trade).status,
        TradeStatus::Funded
    ));
    assert!(matches!(
        f.client().get_trade(&finalize_trade).status,
        TradeStatus::Funded
    ));
    assert_eq!(f.client().get_accrued_fees(), 0);
}

#[test]
fn pause_keeps_settlement_refunds_disputes_and_clawbacks_available() {
    let f = AdminSignerFixture::new();
    let delivery_trade = fund_trade(&f, AMOUNT, None);
    let mutual_cancel_trade = fund_trade(&f, AMOUNT, None);
    let refund_trade = fund_trade(&f, AMOUNT, None);
    let dispute_trade = fund_trade(&f, AMOUNT, None);
    let admin_clawback_trade = fund_trade(&f, AMOUNT, None);
    let queued_clawback_trade = fund_trade(&f, AMOUNT, None);
    let buyer_cancel_trade = create_trade(&f, AMOUNT, None);

    pause(&f);

    f.client().confirm_delivery(&delivery_trade);
    f.client().release_funds(&delivery_trade, &f.buyer);
    assert!(matches!(
        f.client().get_trade(&delivery_trade).status,
        TradeStatus::Completed
    ));

    let buyer_before_cancel = f.token().balance(&f.buyer);
    f.client().cancel_trade(&mutual_cancel_trade, &f.buyer);
    f.client().cancel_trade(&mutual_cancel_trade, &f.seller);
    assert_eq!(f.token().balance(&f.buyer) - buyer_before_cancel, AMOUNT);
    assert!(matches!(
        f.client().get_trade(&mutual_cancel_trade).status,
        TradeStatus::Cancelled
    ));

    let buyer_before_refund = f.token().balance(&f.buyer);
    f.client().refund(&refund_trade);
    assert_eq!(f.token().balance(&f.buyer) - buyer_before_refund, AMOUNT);

    f.client().cancel_by_buyer(&buyer_cancel_trade);
    assert!(matches!(
        f.client().get_trade(&buyer_cancel_trade).status,
        TradeStatus::Cancelled
    ));

    f.client().initiate_dispute(
        &dispute_trade,
        &f.buyer,
        &String::from_str(&f.env, "QmPausePolicyDispute"),
    );
    f.client()
        .resolve_dispute(&dispute_trade, &f.mediator, &5000u32);
    assert!(matches!(
        f.client().get_trade(&dispute_trade).status,
        TradeStatus::Completed
    ));

    let buyer_before_clawback = f.token().balance(&f.buyer);
    f.client()
        .admin_clawback(&admin_clawback_trade, &1_000i128, &f.buyer);
    assert_eq!(f.token().balance(&f.buyer) - buyer_before_clawback, 1_000);

    let stranger_before_queued_clawback = f.token().balance(&f.stranger);
    let operation_id = f
        .client()
        .queue_clawback(&queued_clawback_trade, &1_000i128, &f.stranger);
    f.env.ledger().with_mut(|ledger| {
        ledger.timestamp += 1_000_000;
    });
    f.client().execute_clawback(&operation_id);
    assert_eq!(
        f.token().balance(&f.stranger) - stranger_before_queued_clawback,
        1_000
    );
}

#[test]
fn paused_buyer_can_claim_an_expired_trade() {
    let f = AdminSignerFixture::new();
    let deadline = f.env.ledger().timestamp() + 10;
    let trade_id = fund_trade(&f, AMOUNT, Some(deadline));

    pause(&f);
    f.env.ledger().with_mut(|ledger| {
        ledger.timestamp = deadline;
    });

    let buyer_before = f.token().balance(&f.buyer);
    f.client().claim_expiry_refund(&trade_id, &f.buyer);

    assert_eq!(f.token().balance(&f.buyer) - buyer_before, AMOUNT);
    assert!(matches!(
        f.client().get_trade(&trade_id).status,
        TradeStatus::Cancelled
    ));
}
