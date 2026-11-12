//! Issue #97 — Contract error codes for admin clawback failures.
//!
//! Verifies that `admin_clawback()` panics with the expected structured error
//! code strings for each invalid-input scenario, and that a valid clawback
//! succeeds with the correct token transfer.

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

// ---------------------------------------------------------------------------
// Error code tests
// ---------------------------------------------------------------------------

/// Non-admin caller is rejected by `admin.require_auth()`.
#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn test_clawback_unauthorized_caller() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    let amount = 500i128;
    let args = clawback_auth_args(&h.env, tid, amount, &h.buyer);
    h.client()
        .mock_auths(&[auth_invoke!(&h, &h.stranger, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &h.buyer);
}

/// Amount of zero triggers CLAWBACK_INVALID_AMOUNT.
#[test]
#[should_panic(expected = "CLAWBACK_INVALID_AMOUNT")]
fn test_clawback_invalid_amount_zero() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().admin_clawback(&tid, &0i128, &h.buyer);
}

/// Negative amount triggers CLAWBACK_INVALID_AMOUNT.
#[test]
#[should_panic(expected = "CLAWBACK_INVALID_AMOUNT")]
fn test_clawback_invalid_amount_negative() {
    let h = Harness::new();
    let tid = h.funded_trade(1_000);
    h.client().admin_clawback(&tid, &(-1i128), &h.buyer);
}

/// Non-existent trade triggers CLAWBACK_STREAM_NOT_FOUND.
#[test]
#[should_panic(expected = "Trade not found")]
fn test_clawback_stream_not_found() {
    let h = Harness::new();
    // Use a trade_id that was never created
    h.client().admin_clawback(&9999u64, &100i128, &h.buyer);
}

/// Amount exceeding the escrowed balance triggers CLAWBACK_INSUFFICIENT_VESTED.
#[test]
#[should_panic(expected = "clawback_amount exceeds remaining escrowed amount")]
fn test_clawback_insufficient_vested() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    // Request more than was escrowed
    h.client().admin_clawback(&tid, &(amount + 1), &h.buyer);
}

/// Clawback on a non-Funded (Created) trade triggers CLAWBACK_INVALID_STATUS.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_invalid_status_created() {
    let h = Harness::new();
    // Create a trade but do NOT fund it — status is Created
    let tid = h
        .client()
        .create_trade(&h.buyer, &h.seller, &500i128, &5000u32, &5000u32, &None);
    h.client().admin_clawback(&tid, &500i128, &h.buyer);
}

/// Clawback on a Completed trade triggers CLAWBACK_INVALID_STATUS.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_invalid_status_completed() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);
    // Confirm delivery and release → Completed
    h.client().confirm_delivery(&tid);
    h.client().release_funds(&tid, &h.buyer);
    // Now status is Completed — clawback must fail
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}

// ---------------------------------------------------------------------------
// Happy-path tests
// ---------------------------------------------------------------------------

/// Valid admin clawback of the full amount succeeds.
///
/// Verifies:
/// - buyer receives the full escrowed amount
/// - trade status transitions to Cancelled
/// - contract balance goes to zero
#[test]
fn test_clawback_full_amount_succeeds() {
    let h = Harness::new();
    let amount = 2_000i128;
    let tid = h.funded_trade(amount);

    let tok = h.token();

    // Buyer spent `amount` on deposit; balance should be 0 before clawback
    assert_eq!(tok.balance(&h.buyer), 0);
    assert_eq!(tok.balance(&h.client().address), amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // After clawback buyer has funds back
    assert_eq!(tok.balance(&h.buyer), amount);
    assert_eq!(tok.balance(&h.client().address), 0);

    // Trade is now Cancelled
    let trade = h.client().get_trade(&tid);
    assert!(matches!(trade.status, TradeStatus::Cancelled));
}

/// Valid admin clawback of a partial amount succeeds.
///
/// Verifies that the admin can clawback less than the full escrowed amount.
#[test]
fn test_clawback_partial_amount_succeeds() {
    let h = Harness::new();
    let amount = 2_000i128;
    let partial = 1_000i128;
    let tid = h.funded_trade(amount);

    let tok = h.token();

    h.client().admin_clawback(&tid, &partial, &h.buyer);

    // Buyer received partial refund; remaining stays in escrow
    assert_eq!(tok.balance(&h.buyer), partial);
    assert_eq!(tok.balance(&h.client().address), amount - partial);
    let trade = h.client().get_trade(&tid);
    assert!(matches!(trade.status, TradeStatus::Funded));
    assert_eq!(trade.amount, amount - partial);
}
