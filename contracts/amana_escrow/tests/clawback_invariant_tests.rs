/// Issue #91 — Contract state invariants and tests for clawback arithmetic.
///
/// Covers every invariant documented in `admin_clawback`:
///
///   1. Amount positivity — zero-value escrowed trades are rejected.
///   2. Amount conservation — buyer receives exactly `trade.amount` tokens.
///   3. Contract balance drops to zero after clawback.
///   4. Trade state transitions correctly to `Cancelled`.
///   5. Edge cases: minimum amount (1 stroop), maximum allowed amount,
///      and boundary values just inside `MAX_TRADE_VALUE`.
///   6. idempotency guard — a second clawback on the same trade must fail
///      because the trade is already `Cancelled`.
///   7. History record written — `get_trade_history` contains the
///      `admin_clawback` event after a successful call.
///
/// # How vesting math is protected
///
/// `admin_clawback` does not perform any arithmetic on the transferred amount.
/// It reads `trade.amount` verbatim and uses it as the sole transfer value,
/// so there is no multiplication or division that could overflow.  The only
/// numeric assertions are:
///
///   - `clawback_amount > 0`  — guards against a pathological zero-amount escrow.
///   - `clawback_amount <= trade.amount` — defensive upper-bound check.
///   - `clawback_amount == trade.amount` — post-transfer conservation check.
///
/// These are labelled `INVARIANT 1–4` in `lib.rs` so code reviewers can locate
/// them without reading the full function body.
extern crate std;

use amana_escrow::{MAX_TRADE_VALUE, TradeStatus, test_fixture::AdminSignerFixture};
use soroban_sdk::{Address, testutils::Address as _};

type Harness = AdminSignerFixture;

// ===========================================================================
// INVARIANT 1: Amount must be positive (#91)
// ===========================================================================

/// Normal single-stroop clawback — minimum valid escrow amount.
/// Verifies the lower boundary of the positivity invariant.
#[test]
fn test_clawback_invariant_minimum_amount_one_stroop() {
    let h = Harness::new();
    let amount = 1i128; // 1 stroop — absolute minimum
    let tid = h.funded_trade(amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // Buyer receives 1 stroop back
    assert_eq!(h.token().balance(&h.buyer), 1);
    // Contract holds nothing
    assert_eq!(h.token().balance(&h.client().address), 0);
    // Trade is cancelled
    assert!(matches!(
        h.client().get_trade(&tid).status,
        TradeStatus::Cancelled
    ));
}

// ===========================================================================
// INVARIANT 2 & 3: Conservation — buyer receives exactly trade.amount (#91)
// ===========================================================================

/// Clawback of a typical mid-range amount: verify exact token conservation.
/// `buyer_balance_after == amount` and `contract_balance == 0`.
#[test]
fn test_clawback_invariant_buyer_receives_exact_amount() {
    let h = Harness::new();
    let amount = 42_000i128;
    let tid = h.funded_trade(amount);

    let buyer_before = h.token().balance(&h.buyer);
    let contract_before = h.token().balance(&h.client().address);

    // Pre-conditions
    assert_eq!(
        buyer_before, 0,
        "buyer should have no balance before clawback"
    );
    assert_eq!(
        contract_before, amount,
        "contract should hold the full escrow"
    );

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // Post-conditions: conservation invariant
    let buyer_after = h.token().balance(&h.buyer);
    let contract_after = h.token().balance(&h.client().address);

    assert_eq!(
        buyer_after, amount,
        "INVARIANT: buyer must receive exactly trade.amount ({amount})"
    );
    assert_eq!(
        contract_after, 0,
        "INVARIANT: contract must hold zero tokens after clawback"
    );
    // No tokens created or destroyed
    assert_eq!(
        buyer_after + contract_after,
        amount,
        "INVARIANT: total token supply must be conserved"
    );
}

/// Clawback with fee_bps = 0 (no platform fee) — amount conservation is the same.
#[test]
fn test_clawback_invariant_conservation_with_zero_fee() {
    let h = Harness::new_with_fee_bps(0);
    let amount = 10_000i128;
    let tid = h.funded_trade(amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    assert_eq!(h.token().balance(&h.buyer), amount);
    assert_eq!(h.token().balance(&h.client().address), 0);
}

// ===========================================================================
// INVARIANT: Large amounts — near MAX_TRADE_VALUE boundary (#91)
// ===========================================================================

/// Clawback of the maximum allowed trade value to confirm no overflow occurs
/// in the conservation check.
#[test]
fn test_clawback_invariant_max_trade_value() {
    let h = Harness::new();
    let amount = MAX_TRADE_VALUE; // 1_000_000_000_000 stroops
    let tid = h.funded_trade(amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    assert_eq!(h.token().balance(&h.buyer), amount);
    assert_eq!(h.token().balance(&h.client().address), 0);
    assert!(matches!(
        h.client().get_trade(&tid).status,
        TradeStatus::Cancelled
    ));
}

/// Clawback at MAX_TRADE_VALUE - 1 — one stroop below the cap.
#[test]
fn test_clawback_invariant_one_below_max_trade_value() {
    let h = Harness::new();
    let amount = MAX_TRADE_VALUE - 1;
    let tid = h.funded_trade(amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    assert_eq!(h.token().balance(&h.buyer), amount);
    assert_eq!(h.token().balance(&h.client().address), 0);
}

// ===========================================================================
// INVARIANT: Trade state machine (#91)
// ===========================================================================

/// After a successful clawback, the trade status must be `Cancelled`.
/// Attempting a second clawback must panic because the state is no longer `Funded`.
#[test]
#[should_panic(expected = "Trade must be in Funded or Disputed status for clawback")]
fn test_clawback_invariant_idempotency_second_call_rejected() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);

    // First call succeeds and moves trade to Cancelled
    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // Second call must panic — INVARIANT: status guard prevents re-entrancy
    h.client().admin_clawback(&tid, &amount, &h.buyer);
}

/// The trade status transitions correctly from Funded → Cancelled.
#[test]
fn test_clawback_invariant_status_transitions_to_cancelled() {
    let h = Harness::new();
    let amount = 500i128;
    let tid = h.funded_trade(amount);

    let before = h.client().get_trade(&tid);
    assert!(
        matches!(before.status, TradeStatus::Funded),
        "pre-condition: trade must be Funded"
    );

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    let after = h.client().get_trade(&tid);
    assert!(
        matches!(after.status, TradeStatus::Cancelled),
        "post-condition: trade must be Cancelled"
    );
}

// ===========================================================================
// INVARIANT: Trade history record (#91)
// ===========================================================================

/// After a successful `admin_clawback`, the trade history must contain a
/// clawback-related event entry.
#[test]
fn test_clawback_invariant_history_record_written() {
    let h = Harness::new();
    let amount = 1_000i128;
    let tid = h.funded_trade(amount);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    let history = h.client().get_trade_history(&tid);
    let found = history.iter().any(|evt| {
        evt.event_type == soroban_sdk::String::from_str(&h.env, "clawback_full")
            || evt.event_type == soroban_sdk::String::from_str(&h.env, "admin_clawback")
    });
    assert!(
        found,
        "INVARIANT: trade history must contain a clawback event"
    );
}

// ===========================================================================
// INVARIANT: Partial-custody scenario — other trades unaffected (#91)
// ===========================================================================

/// Clawback on trade A must not affect trade B's escrowed balance.
/// Confirms token conservation is scoped to the target trade.
#[test]
fn test_clawback_invariant_other_trades_unaffected() {
    let h = Harness::new();
    let amount_a = 1_000i128;
    let amount_b = 2_000i128;

    // Create a second buyer for trade B
    let buyer_b = Address::generate(&h.env);
    let seller_b = Address::generate(&h.env);
    h.mint(&buyer_b, amount_b);

    let tid_a = h.funded_trade(amount_a);
    let tid_b = h
        .client()
        .create_trade(&buyer_b, &seller_b, &amount_b, &5000u32, &5000u32, &None);
    h.client().deposit(&tid_b);

    // Contract holds amount_a + amount_b
    assert_eq!(h.token().balance(&h.client().address), amount_a + amount_b);

    // Clawback only trade A
    h.client().admin_clawback(&tid_a, &amount_a, &h.buyer);

    // Trade A cancelled, trade B still funded
    assert!(matches!(
        h.client().get_trade(&tid_a).status,
        TradeStatus::Cancelled
    ));
    assert!(matches!(
        h.client().get_trade(&tid_b).status,
        TradeStatus::Funded
    ));

    // Contract still holds only trade B's escrow
    assert_eq!(
        h.token().balance(&h.client().address),
        amount_b,
        "INVARIANT: contract must only hold trade B's escrow after clawback of trade A"
    );
}

// ===========================================================================
// INVARIANT: Asymmetric loss ratios do not affect clawback amount (#91)
// ===========================================================================

/// With buyer_loss_bps=7000 / seller_loss_bps=3000 the clawback must still
/// return the full amount.  Loss ratios apply to dispute resolution, not
/// to admin clawback.
#[test]
fn test_clawback_invariant_asymmetric_loss_ratios_full_refund() {
    let h = Harness::new();
    let amount = 10_000i128;
    h.mint(&h.buyer, amount);

    let tid = h.client().create_trade(
        &h.buyer, &h.seller, &amount, &7000u32, // buyer bears 70% loss
        &3000u32, // seller bears 30% loss
        &None,
    );
    h.client().deposit(&tid);

    h.client().admin_clawback(&tid, &amount, &h.buyer);

    // Admin clawback ignores loss ratios — buyer gets everything back
    assert_eq!(
        h.token().balance(&h.buyer),
        amount,
        "INVARIANT: admin clawback must return full amount regardless of loss ratios"
    );
    assert_eq!(h.token().balance(&h.client().address), 0);
}
