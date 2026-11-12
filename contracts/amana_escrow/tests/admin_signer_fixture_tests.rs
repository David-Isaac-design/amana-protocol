//! Issue #108 — Shared admin signer fixture coverage.
//!
//! Verifies that [`AdminSignerFixture`] is the single source of truth for the
//! test admin identity and that both admin (allow) and non-admin (deny) caller
//! paths work through the fixture.

extern crate std;

use amana_escrow::{
    TradeStatus, auth_invoke,
    test_fixture::{AdminSignerFixture, clawback_auth_args},
};

#[test]
fn fixture_admin_matches_initialized_contract_admin() {
    let f = AdminSignerFixture::new();
    assert_eq!(
        f.client().get_admin(),
        f.admin,
        "fixture.admin must be the address stored by initialize"
    );
}

#[test]
fn fixture_admin_can_clawback_funded_trade() {
    let f = AdminSignerFixture::new();
    let amount = 1_000i128;
    let tid = f.funded_trade(amount);

    // Happy path: fixture enables mock_all_auths, so the stored admin may act.
    f.client().admin_clawback(&tid, &amount, &f.buyer);

    assert!(matches!(
        f.client().get_trade(&tid).status,
        TradeStatus::Cancelled
    ));
    assert_eq!(f.token().balance(&f.buyer), amount);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn fixture_non_admin_stranger_denied_clawback() {
    let f = AdminSignerFixture::new();
    let amount = 1_000i128;
    let tid = f.funded_trade(amount);
    let args = clawback_auth_args(&f.env, tid, amount, &f.buyer);

    // Deny path: only authorize the stranger; stored admin.require_auth fails.
    f.client()
        .mock_auths(&[auth_invoke!(&f, &f.stranger, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &f.buyer);
}

#[test]
#[should_panic(expected = "Error(Auth, InvalidAction)")]
fn fixture_non_admin_buyer_denied_clawback() {
    let f = AdminSignerFixture::new();
    let amount = 500i128;
    let tid = f.funded_trade(amount);
    let args = clawback_auth_args(&f.env, tid, amount, &f.buyer);

    f.client()
        .mock_auths(&[auth_invoke!(&f, &f.buyer, "admin_clawback", args)])
        .admin_clawback(&tid, &amount, &f.buyer);
}
