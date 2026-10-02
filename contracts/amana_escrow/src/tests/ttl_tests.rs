/// Issue #387 — TTL extension and long-ledger-gap behavior
///
/// Validates that:
///   1. bump_instance_ttl() extends the TTL back to INSTANCE_TTL_EXTEND_TO after
///      the ledger advances close to expiry.
///   2. Trade continuity (create → deposit → dispute → resolve) survives a
///      simulated ledger jump that would otherwise expire the instance.
///   3. Multiple sequential ledger jumps do not break state.
#[cfg(test)]
#[allow(clippy::module_inception)]
mod ttl_tests {
    use crate::{
        DEFAULT_MAX_TOTAL_EXTENSION_SECS, DEFAULT_QUORUM_VOTE_WINDOW_SECS, DataKey,
        EscrowContract, EscrowContractClient, INSTANCE_TTL_EXTEND_TO, PERSISTENT_TTL_EXTEND_TO,
        TradeStatus,
    };
    use soroban_sdk::{
        Address, Env, String,
        testutils::{Address as _, Deployer as _, Ledger as _, storage::Persistent as _},
        token,
    };

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    struct Ctx {
        env: Env,
        contract_id: Address,
        buyer: Address,
        seller: Address,
        mediator: Address,
    }

    impl Ctx {
        fn new(amount: i128) -> Self {
            let env = Env::default();
            env.mock_all_auths();

            let admin = Address::generate(&env);
            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);
            let treasury = Address::generate(&env);
            let mediator = Address::generate(&env);

            let contract_id = env.register(EscrowContract, ());
            let usdc_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();

            token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &amount);

            let client = EscrowContractClient::new(&env, &contract_id);
            client.initialize(&admin, &usdc_id, &treasury, &100_u32, &usdc_id);
            client.set_mediator(&mediator);

            Ctx {
                env,
                contract_id,
                buyer,
                seller,
                mediator,
            }
        }

        fn client(&self) -> EscrowContractClient<'_> {
            EscrowContractClient::new(&self.env, &self.contract_id)
        }

        fn ttl(&self) -> u32 {
            self.env
                .deployer()
                .get_contract_instance_ttl(&self.contract_id)
        }

        fn advance_to_near_expiry(&self) {
            let seq = self.env.ledger().sequence();
            // Jump to 1 ledger before expiry
            self.env
                .ledger()
                .set_sequence_number(seq + INSTANCE_TTL_EXTEND_TO - 1);
        }
    }

    // -----------------------------------------------------------------------
    // #387-1  TTL is set to INSTANCE_TTL_EXTEND_TO after initialize
    // -----------------------------------------------------------------------
    #[test]
    fn test_ttl_set_after_initialize() {
        let ctx = Ctx::new(10_000);
        assert_eq!(
            ctx.ttl(),
            INSTANCE_TTL_EXTEND_TO,
            "TTL must equal INSTANCE_TTL_EXTEND_TO right after initialize"
        );
    }

    // -----------------------------------------------------------------------
    // #387-2  create_trade bumps TTL back to INSTANCE_TTL_EXTEND_TO
    // -----------------------------------------------------------------------
    #[test]
    fn test_ttl_bumped_by_create_trade() {
        let ctx = Ctx::new(10_000);
        ctx.advance_to_near_expiry();

        assert_eq!(ctx.ttl(), 1, "TTL must be 1 just before expiry");

        ctx.client().create_trade(
            &ctx.buyer,
            &ctx.seller,
            &10_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );

        assert_eq!(
            ctx.ttl(),
            INSTANCE_TTL_EXTEND_TO,
            "create_trade must bump TTL back to INSTANCE_TTL_EXTEND_TO"
        );
    }

    // -----------------------------------------------------------------------
    // #387-3  Trade continuity survives a single ledger jump
    //         create → [jump] → deposit → [jump] → dispute → [jump] → resolve
    // -----------------------------------------------------------------------
    #[test]
    fn test_trade_continuity_survives_ledger_jump() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        // Create trade
        let trade_id = client.create_trade(
            &ctx.buyer,
            &ctx.seller,
            &10_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Created
        ));

        // Simulate ledger jump near expiry, then deposit (which bumps TTL)
        ctx.advance_to_near_expiry();
        client.deposit(&trade_id);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Funded
        ));
        assert_eq!(
            ctx.ttl(),
            INSTANCE_TTL_EXTEND_TO,
            "TTL must be refreshed after deposit"
        );

        // Another jump, then dispute
        ctx.advance_to_near_expiry();
        client.initiate_dispute(
            &trade_id,
            &ctx.buyer,
            &String::from_str(&ctx.env, "QmLedgerGapReason"),
        );
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Disputed
        ));

        // Another jump, then resolve
        ctx.advance_to_near_expiry();
        client.resolve_dispute(&trade_id, &ctx.mediator, &5_000_u32);
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
    }

    // -----------------------------------------------------------------------
    // #387-4  Trade ID counter survives a long ledger gap (existing test
    //         promoted to this module for explicit TTL assertion)
    // -----------------------------------------------------------------------
    #[test]
    fn test_trade_id_counter_and_ttl_survive_long_gap() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let trade_id_1 = client.create_trade(
            &ctx.buyer,
            &ctx.seller,
            &1_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );
        assert_eq!(
            trade_id_1 & 0xFFFF_FFFF_u64,
            1,
            "first trade counter must be 1"
        );

        // Advance to 1 ledger before expiry
        ctx.advance_to_near_expiry();
        assert_eq!(ctx.ttl(), 1, "TTL must be 1 just before expiry");

        // create_trade bumps TTL
        let trade_id_2 = client.create_trade(
            &ctx.buyer,
            &ctx.seller,
            &1_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );
        assert_eq!(
            trade_id_2 & 0xFFFF_FFFF_u64,
            2,
            "second trade counter must be 2"
        );
        assert_eq!(
            ctx.ttl(),
            INSTANCE_TTL_EXTEND_TO,
            "TTL must be refreshed after second create_trade"
        );
    }

    // -----------------------------------------------------------------------
    // #387-5  Multiple sequential ledger jumps — TTL is refreshed each time
    // -----------------------------------------------------------------------
    #[test]
    fn test_ttl_refreshed_across_multiple_jumps() {
        let ctx = Ctx::new(50_000);
        let client = ctx.client();

        for i in 1_u64..=3 {
            ctx.advance_to_near_expiry();
            assert_eq!(ctx.ttl(), 1, "TTL must be 1 before jump {i}");

            // Any hot-path call bumps TTL
            client.create_trade(
                &ctx.buyer,
                &ctx.seller,
                &1_000_i128,
                &5000_u32,
                &5000_u32,
                &None,
            );
            assert_eq!(
                ctx.ttl(),
                INSTANCE_TTL_EXTEND_TO,
                "TTL must be refreshed after jump {i}"
            );
        }
    }

    // -----------------------------------------------------------------------
    // #387-6  Full happy-path lifecycle with no ledger jumps — TTL stays valid
    // -----------------------------------------------------------------------
    #[test]
    fn test_full_lifecycle_ttl_remains_valid() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let trade_id = client.create_trade(
            &ctx.buyer,
            &ctx.seller,
            &10_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );
        client.deposit(&trade_id);
        client.confirm_delivery(&trade_id);
        client.release_funds(&trade_id, &ctx.buyer);

        assert!(
            ctx.ttl() > 0,
            "TTL must remain positive after a full happy-path lifecycle"
        );
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Completed
        ));
    }

    // -----------------------------------------------------------------------
    // Issue #13 — evidence, manifest and video proof must outlive a dispute
    // -----------------------------------------------------------------------

    /// Longest dispute window in ledgers (~5s each): the maximum total deadline
    /// extension plus the quorum vote window.
    const MAX_DISPUTE_WINDOW_LEDGERS: u32 =
        ((DEFAULT_MAX_TOTAL_EXTENSION_SECS + DEFAULT_QUORUM_VOTE_WINDOW_SECS) / 5) as u32;

    impl Ctx {
        fn persistent_ttl(&self, key: &DataKey) -> u32 {
            self.env.as_contract(&self.contract_id, || {
                self.env.storage().persistent().get_ttl(key)
            })
        }

        /// Keep the contract instance alive across a long ledger jump so the
        /// test isolates the persistent per-trade records.
        fn keep_instance_alive(&self) {
            self.env.as_contract(&self.contract_id, || {
                self.env
                    .storage()
                    .instance()
                    .extend_ttl(3_000_000, 3_000_000);
            });
        }

        /// Trade with manifest, video proof, dispute and evidence written.
        fn disputed_trade_with_records(&self) -> (u64, [DataKey; 8]) {
            let client = self.client();
            let trade_id = client.create_trade(
                &self.buyer,
                &self.seller,
                &10_000_i128,
                &5000_u32,
                &5000_u32,
                &None,
            );
            client.deposit(&trade_id);
            client.submit_manifest(
                &trade_id,
                &self.seller,
                &String::from_str(&self.env, "driver-name-hash"),
                &String::from_str(&self.env, "driver-id-hash"),
            );
            client.submit_video_proof(
                &trade_id,
                &self.seller,
                &String::from_str(&self.env, "QmVideoProof"),
            );
            client.initiate_dispute(
                &trade_id,
                &self.buyer,
                &String::from_str(&self.env, "QmDisputeReason"),
            );
            client.submit_evidence(
                &trade_id,
                &self.buyer,
                &String::from_str(&self.env, "QmEvidence"),
                &String::from_str(&self.env, "QmEvidenceDescription"),
            );
            let keys = [
                DataKey::Trade(trade_id),
                DataKey::TradeHistory(trade_id),
                DataKey::ReleaseSequence(trade_id),
                DataKey::DisputeData(trade_id),
                DataKey::EvidenceList(trade_id),
                DataKey::Evidence(trade_id, self.buyer.clone()),
                DataKey::VideoProof(trade_id),
                DataKey::Manifest(trade_id),
            ];
            (trade_id, keys)
        }
    }

    #[test]
    fn test_dispute_records_ttl_covers_max_dispute_window() {
        let ctx = Ctx::new(10_000);
        let (_trade_id, keys) = ctx.disputed_trade_with_records();

        for key in keys.iter() {
            let ttl = ctx.persistent_ttl(key);
            assert!(
                ttl >= MAX_DISPUTE_WINDOW_LEDGERS,
                "{key:?} TTL {ttl} must cover the max dispute window {MAX_DISPUTE_WINDOW_LEDGERS}"
            );
        }
    }

    #[test]
    fn test_dispute_records_survive_and_are_rebumped_after_ledger_advance() {
        let ctx = Ctx::new(10_000);
        let (trade_id, keys) = ctx.disputed_trade_with_records();
        let client = ctx.client();

        // Well past the network minimum persistent TTL and the old instance
        // TTL, but inside the max dispute window.
        let seq = ctx.env.ledger().sequence();
        ctx.env
            .ledger()
            .set_sequence_number(seq + PERSISTENT_TTL_EXTEND_TO - 100_000);
        ctx.keep_instance_alive();

        // Every record is still readable.
        assert!(client.get_manifest(&trade_id).is_some());
        assert!(client.get_video_proof(&trade_id).is_some());
        assert_eq!(client.get_evidence_list(&trade_id).len(), 1);
        assert!(client.get_evidence(&trade_id, &ctx.buyer).is_some());
        assert!(!client.get_trade_history(&trade_id).is_empty());
        assert!(matches!(
            client.get_trade(&trade_id).status,
            TradeStatus::Disputed
        ));

        // Touching the trade (second evidence submission) re-bumps them all.
        client.submit_evidence(
            &trade_id,
            &ctx.seller,
            &String::from_str(&ctx.env, "QmSellerEvidence"),
            &String::from_str(&ctx.env, "QmSellerEvidenceDescription"),
        );
        for key in keys.iter() {
            assert_eq!(
                ctx.persistent_ttl(key),
                PERSISTENT_TTL_EXTEND_TO,
                "{key:?} must be re-extended when its trade is touched"
            );
        }
        assert_eq!(
            ctx.persistent_ttl(&DataKey::Evidence(trade_id, ctx.seller.clone())),
            PERSISTENT_TTL_EXTEND_TO
        );
    }
}
