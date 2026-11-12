/// Issue #92 — Soroban contract access control tests for `admin_clawback`.
///
/// Every test here asserts the caller role is enforced before any state
/// mutation occurs.  The contract-level auth is exercised in two ways:
///
///   1. `mock_all_auths()` — used for the "happy-path" (admin succeeds) tests
///      to let the test focus on state assertions.
///   2. `mock_auths(…)` with a non-admin signer — used for "deny" tests to
///      confirm that supplying auth for the wrong address is rejected.
///
/// # Documentation
/// `admin_clawback` is guarded by two layers:
///   - `admin.require_auth()` — the Soroban auth engine rejects any invocation
///     that is not accompanied by a valid authorization signature from `admin`.
///   - An address comparison against the immutably stored admin — even if a
///     caller somehow passes the auth engine, the assert fires if the supplied
///     address differs from the stored one.
///
/// # Failure messages checked
/// Each deny test uses `#[should_panic(expected = "…")]` with the exact string
/// that the contract emits, making test failures unambiguous.
extern crate std;

use amana_escrow::{TradeStatus, auth_invoke, test_fixture::AdminSignerFixture};
use soroban_sdk::{IntoVal, Val, Vec};

type Harness = AdminSignerFixture;

fn clawback_auth_args(
    env: &soroban_sdk::Env,
    trade_id: u64,
    amount: i128,
    destination: &soroban_sdk::Address,
) -> Vec<Val> {
    soroban_sdk::vec![
        env,
        trade_id.into_val(env),
        amount.into_val(env),
        destination.into_val(env),
    ]
}

// ===========================================================================
// ACCESS CONTROL TESTS  (#92)
// ===========================================================================

// ---------------------------------------------------------------------------
// Admin succeeds
// ---------------------------------------------------------------------------

/// The admin may call `admin_clawback` on any funded trade.
/// After the call the trade must be `Cancelled` and the buyer must have
/// received the full escrowed amount.
#[test]
fn test_clawback_admin_succeeds_and_trade_is_cancelled() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);

    let token = h.token();

    // Admin performs the clawback
    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // Trade must be Cancelled
    assert!(
        matches!(h.client().get_trade(&tid).status, TradeStatus::Cancelled),
        "admin_clawback: trade should be Cancelled after clawback"
    );

    // Full escrow returned to buyer — contract holds nothing
    assert_eq!(
        token.balance(&h.buyer),
        amount,
        "admin_clawback: buyer must receive the full escrowed amount"
    );
    assert_eq!(
        token.balance(&h.client().address),
        0,
        "admin_clawback: contract balance must be zero after clawback"
    );
}

/// Admin may execute clawback on multiple distinct funded trades.
#[test]
fn test_clawback_admin_can_clawback_multiple_trades() {
    let h = Harness::new();
    let amount = 500i128;
    let tid1 = h.funded_trade(amount);
    let tid2 = h.funded_trade(amount);

    h.client().admin_clawback(&tid1, &amount, &h.buyer);
    h.client().admin_clawback(&tid2, &amount, &h.buyer);

    assert!(matches!(
        h.client().get_trade(&tid1).status,
        TradeStatus::Cancelled
    ));
    assert!(matches!(
        h.client().get_trade(&tid2).status,
        TradeStatus::Cancelled
    ));
}

// ---------------------------------------------------------------------------
// Stranger is denied
// ---------------------------------------------------------------------------

/// A stranger (no role) supplying their own auth must be rejected.
/// The Soroban auth engine rejects the call (`Error(Auth, InvalidAction)`).
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_stranger_denied() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.stranger, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Buyer is denied
// ---------------------------------------------------------------------------

/// The buyer cannot use `admin_clawback` even though they are a party to the
/// trade.  The function is strictly admin-only.
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_buyer_denied() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.buyer, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Seller is denied
// ---------------------------------------------------------------------------

/// The seller cannot use `admin_clawback` for their own benefit.
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_seller_denied() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.seller, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Mediator is denied
// ---------------------------------------------------------------------------

/// A registered mediator does not inherit admin capabilities.
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_mediator_denied() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.mediator, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Treasury is denied
// ---------------------------------------------------------------------------

/// The treasury address (fee recipient) is not the admin.
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_treasury_denied() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);

    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.treasury, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Status gate — wrong trade state
// ---------------------------------------------------------------------------

/// `admin_clawback` must be rejected on a `Created` (unfunded) trade.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_rejects_created_trade() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h
        .client()
        .create_trade(&h.buyer, &h.seller, &amount, &5000u32, &5000u32, &None);
    // No deposit — trade is still Created
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}

/// `admin_clawback` must be rejected once the buyer has confirmed delivery
/// (trade is `Delivered`).
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_rejects_delivered_trade() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    h.client().confirm_delivery(&tid);
    // Trade is now Delivered, not Funded
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}

/// `admin_clawback` must be rejected on a `Cancelled` trade.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_rejects_cancelled_trade() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    // Admin cancels via the normal path first
    h.client().cancel_trade(&tid, &h.admin);
    // Now try admin_clawback — must be rejected
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}

/// `admin_clawback` succeeds on a `Disputed` trade (admin emergency recovery).
#[test]
fn test_clawback_admin_succeeds_on_disputed_trade() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    h.client().initiate_dispute(
        &tid,
        &h.buyer,
        &soroban_sdk::String::from_str(&h.env, "QmClawbackDisputeTest"),
    );
    h.client().admin_clawback(&tid, &amount, &h.buyer);
    assert!(matches!(
        h.client().get_trade(&tid).status,
        TradeStatus::Cancelled
    ));
}

/// `admin_clawback` must be rejected on a `Completed` trade.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_rejects_completed_trade() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.admin);
    // Trade is now Completed
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}
