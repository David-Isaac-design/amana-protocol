extern crate std;

use amana_escrow::{TradeStatus, test_fixture::AdminSignerFixture};
use soroban_sdk::{
    Env, IntoVal, TryIntoVal, Val, symbol_short, testutils::Events as _, xdr::ContractEventBody,
};

type Harness = AdminSignerFixture;

fn create_trade(h: &Harness) -> u64 {
    h.client()
        .create_trade(&h.buyer, &h.seller, &1_000i128, &5000u32, &5000u32, &None)
}

#[test]
fn cancel_by_buyer_cancels_created_trade_and_emits_event() {
    let h = Harness::new();
    let trade_id = create_trade(&h);

    h.client().cancel_by_buyer(&trade_id);

    // Read events before any further host invoke (testutils keeps last-invoke events).
    let all_events = h.env.events().all();
    let events = all_events.events();
    let event = events.last().expect("cancel event should be emitted");
    match &event.body {
        ContractEventBody::V0(v0) => {
            let expected: soroban_sdk::xdr::ScVal =
                IntoVal::<Env, Val>::into_val(&symbol_short!("TCNBYR"), &h.env)
                    .try_into_val(&h.env)
                    .unwrap();
            assert_eq!(v0.topics.first().unwrap(), &expected);
            match &v0.data {
                soroban_sdk::xdr::ScVal::Vec(Some(payload)) => assert_eq!(payload.len(), 2),
                soroban_sdk::xdr::ScVal::Map(Some(payload)) => assert_eq!(payload.len(), 2),
                other => panic!("expected vec or map event payload, got {other:?}"),
            }
        }
    }

    let trade = h.client().get_trade(&trade_id);
    assert!(matches!(trade.status, TradeStatus::Cancelled));
}

#[test]
#[should_panic(expected = "Trade must be in Created status")]
fn cancel_by_buyer_rejects_funded_trade() {
    let h = Harness::new();
    let trade_id = create_trade(&h);
    h.mint(&h.buyer, 1_000);
    h.client().deposit(&trade_id);

    h.client().cancel_by_buyer(&trade_id);
}

#[test]
#[should_panic]
fn cancel_by_buyer_rejects_non_buyer_auth() {
    let h = Harness::new();
    let trade_id = create_trade(&h);

    h.client()
        .mock_auths(&[soroban_sdk::testutils::MockAuth {
            address: &h.stranger,
            invoke: &soroban_sdk::testutils::MockAuthInvoke {
                contract: &h.contract_id,
                fn_name: "cancel_by_buyer",
                args: soroban_sdk::vec![&h.env, IntoVal::<Env, Val>::into_val(&trade_id, &h.env),],
                sub_invokes: &[],
            },
        }])
        .cancel_by_buyer(&trade_id);
}
