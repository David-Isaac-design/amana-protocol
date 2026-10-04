/// Issue #15 — weighted tie-breaking and mid-vote weight changes for
/// `cast_dispute_vote` / `resolve_dispute_by_fallback`.
///
/// Rule under test (documented in `docs/mediator-quorum.md`): a tie never
/// settles on its own. It waits for `vote_window_secs` to close, then
/// `resolve_dispute_by_fallback` applies the tied outcome with the lowest
/// `seller_gets_bps` (buyer-protective), independent of vote order.
#[cfg(test)]
mod quorum_tie_tests {
    extern crate std;

    use crate::test_fixture::AdminSignerFixture;
    use crate::TradeStatus;
    use soroban_sdk::{Address, String, testutils::{Address as _, Ledger as _}};

    const WINDOW_SECS: u64 = 7 * 24 * 60 * 60;
    const AMOUNT: i128 = 10_000;
    const HIGH: u32 = 8_000;
    const LOW: u32 = 2_000;

    /// Fixture with quorum enabled for every trade, `n` extra mediators, no fee.
    fn setup(
        required_weight: u32,
        fallback_min: u32,
        n: usize,
    ) -> (AdminSignerFixture, u64, std::vec::Vec<Address>) {
        let f = AdminSignerFixture::new_with_fee_bps(0);
        let mut mediators = std::vec::Vec::new();
        for _ in 0..n {
            let m = Address::generate(&f.env);
            f.client().add_mediator(&m);
            mediators.push(m);
        }
        f.client()
            .set_quorum_config(&true, &0i128, &required_weight, &WINDOW_SECS, &fallback_min);
        let tid = f.funded_trade(AMOUNT);
        f.client().initiate_dispute(
            &tid,
            &f.buyer,
            &String::from_str(&f.env, "QmTieDispute"),
        );
        (f, tid, mediators)
    }

    fn vote(f: &AdminSignerFixture, tid: u64, mediator: &Address, bps: u32) {
        f.client().cast_dispute_vote(
            &tid,
            mediator,
            &bps,
            &String::from_str(&f.env, "QmRationale"),
        );
    }

    fn advance(f: &AdminSignerFixture, secs: u64) {
        f.env.ledger().with_mut(|l| l.timestamp += secs);
    }

    /// 50/50 across two equal-weight mediators: neither side reaches quorum,
    /// so the dispute stays open until the window closes.
    #[test]
    fn even_weight_tie_across_two_mediators_does_not_settle() {
        let (f, tid, m) = setup(2, 2, 2);
        vote(&f, tid, &m[0], HIGH);
        vote(&f, tid, &m[1], LOW);

        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Disputed);
        assert_eq!(f.client().get_dispute_votes(&tid).len(), 2);
        assert!(f.client().try_resolve_dispute_by_fallback(&tid, &f.buyer).is_err());
    }

    /// After the window closes the tie resolves to the lower seller share.
    #[test]
    fn even_weight_tie_resolves_to_lower_seller_share_after_window() {
        let (f, tid, m) = setup(2, 2, 2);
        vote(&f, tid, &m[0], HIGH);
        vote(&f, tid, &m[1], LOW);

        advance(&f, WINDOW_SECS);
        f.client().resolve_dispute_by_fallback(&tid, &f.buyer);

        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Completed);
        // seller_gets_bps = 2_000 with 50/50 loss sharing and no fee:
        // seller keeps 6_000, buyer is refunded 4_000.
        assert_eq!(f.token().balance(&f.buyer), 4_000);
        assert_eq!(f.token().balance(&f.seller), 6_000);
        assert_eq!(f.token().balance(&f.contract_id), 0);
    }

    /// The tie result must not depend on which mediator voted first.
    #[test]
    fn tie_break_is_independent_of_vote_order() {
        let (f1, t1, m1) = setup(2, 2, 2);
        vote(&f1, t1, &m1[0], HIGH);
        vote(&f1, t1, &m1[1], LOW);
        advance(&f1, WINDOW_SECS);
        f1.client().resolve_dispute_by_fallback(&t1, &f1.buyer);

        let (f2, t2, m2) = setup(2, 2, 2);
        vote(&f2, t2, &m2[0], LOW);
        vote(&f2, t2, &m2[1], HIGH);
        advance(&f2, WINDOW_SECS);
        f2.client().resolve_dispute_by_fallback(&t2, &f2.buyer);

        assert_eq!(
            f1.token().balance(&f1.buyer),
            f2.token().balance(&f2.buyer)
        );
        assert_eq!(
            f1.token().balance(&f1.seller),
            f2.token().balance(&f2.seller)
        );
    }

    /// A weighted tie with unequal voter counts (3 vs 1 + 2) is still a tie.
    #[test]
    fn weighted_tie_with_unequal_voter_counts_resolves_to_lower_share() {
        let (f, tid, m) = setup(4, 3, 3);
        f.client().set_mediator_weight(&m[0], &3u32);
        f.client().set_mediator_weight(&m[2], &2u32);

        vote(&f, tid, &m[0], HIGH); // weight 3
        vote(&f, tid, &m[1], LOW); // weight 1
        vote(&f, tid, &m[2], LOW); // weight 2

        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Disputed);

        advance(&f, WINDOW_SECS);
        f.client().resolve_dispute_by_fallback(&tid, &f.buyer);

        assert_eq!(f.token().balance(&f.buyer), 4_000);
        assert_eq!(f.token().balance(&f.seller), 6_000);
    }

    /// A vote records the weight the mediator had when it was cast; changing
    /// the weight afterwards neither rewrites it nor triggers quorum.
    #[test]
    fn weight_change_after_voting_does_not_alter_recorded_vote() {
        let (f, tid, m) = setup(2, 2, 2);
        vote(&f, tid, &m[0], HIGH);

        f.client().set_mediator_weight(&m[0], &5u32);

        let votes = f.client().get_dispute_votes(&tid);
        assert_eq!(votes.get(0).unwrap().weight, 1);
        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Disputed);

        // The new weight only applies to m[0]'s future votes, so this is
        // still a 1-v-1 tie.
        vote(&f, tid, &m[1], LOW);
        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Disputed);

        advance(&f, WINDOW_SECS);
        f.client().resolve_dispute_by_fallback(&tid, &f.buyer);
        // Still a 1-v-1 tie, so it breaks to the lower share.
        assert_eq!(f.token().balance(&f.buyer), 4_000);
    }

    /// A weight raised before a mediator votes applies to that vote and can
    /// break the tie in favour of quorum immediately.
    #[test]
    fn weight_raised_before_voting_applies_to_the_next_vote() {
        let (f, tid, m) = setup(2, 2, 2);
        vote(&f, tid, &m[0], HIGH); // weight 1

        f.client().set_mediator_weight(&m[1], &2u32);
        vote(&f, tid, &m[1], LOW); // weight 2 == required_weight

        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Completed);
        assert_eq!(f.token().balance(&f.buyer), 4_000);
        assert_eq!(f.token().balance(&f.seller), 6_000);
    }

    /// Lowering a mediator's weight below its cast vote's weight is likewise
    /// not retroactive: the recorded vote keeps its original weight.
    #[test]
    fn weight_lowered_after_voting_does_not_reduce_recorded_vote() {
        let (f, tid, m) = setup(3, 2, 2);
        f.client().set_mediator_weight(&m[0], &3u32);
        vote(&f, tid, &m[0], HIGH);

        // Lowering m[0]'s weight afterwards must not undo the quorum it cast.
        // (It already settled: weight 3 == required_weight.)
        assert_eq!(f.client().get_trade(&tid).status, TradeStatus::Completed);
        f.client().set_mediator_weight(&m[0], &1u32);
        let votes = f.client().get_dispute_votes(&tid);
        assert_eq!(votes.get(0).unwrap().weight, 3);
    }
}
