/// Issue #388/#552/#544 — Gas and footprint regression checks for hot paths
///
/// Measures CPU instructions and memory bytes consumed by the escrow hot paths.
/// See `contracts/amana_escrow/docs/gas-estimation.md` for the methodology,
/// re-baselining policy, and CI assumptions.
#[cfg(test)]
#[allow(clippy::module_inception)]
mod gas_footprint_tests {
    use crate::test_fixture::admin_address;
    use crate::{EscrowContract, EscrowContractClient};
    use soroban_sdk::{Address, Env, String, testutils::Address as _, token};

    const REGRESSION_BUDGET_PERCENT: u64 = 10;

    #[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
    struct CostEstimate {
        cpu: u64,
        mem: u64,
    }

    impl CostEstimate {
        fn assert_under(self, label: &str, baseline_name: &str) {
            assert!(self.cpu > 0, "{label} CPU estimate must be non-zero");
            assert!(self.mem > 0, "{label} MEM estimate must be non-zero");
            let baselines: std::collections::BTreeMap<String, CostEstimate> =
                serde_json::from_str(include_str!("gas_footprint_baselines.json"))
                    .expect("gas footprint baselines must be valid JSON");
            let baseline = baselines
                .get(baseline_name)
                .unwrap_or_else(|| panic!("missing gas footprint baseline: {baseline_name}"));
            let max_cpu = baseline.cpu * (100 + REGRESSION_BUDGET_PERCENT) / 100;
            let max_mem = baseline.mem * (100 + REGRESSION_BUDGET_PERCENT) / 100;

            println!(
                "{label}: CPU {} (baseline {}, max {}), MEM {} (baseline {}, max {})",
                self.cpu, baseline.cpu, max_cpu, self.mem, baseline.mem, max_mem
            );
            assert!(
                self.cpu <= max_cpu,
                "{label} CPU regression: {} > baseline {} with {}% budget (max {max_cpu})",
                self.cpu, baseline.cpu, REGRESSION_BUDGET_PERCENT
            );
            assert!(
                self.mem <= max_mem,
                "{label} MEM regression: {} > baseline {} with {}% budget (max {max_mem})",
                self.mem, baseline.mem, REGRESSION_BUDGET_PERCENT
            );
        }
    }

    struct Ctx {
        env: Env,
        contract_id: Address,
        admin: Address,
        buyer: Address,
        seller: Address,
        mediator: Address,
    }

    impl Ctx {
        fn new(amount: i128) -> Self {
            let env = Env::default();
            env.mock_all_auths();
            env.cost_estimate().budget().reset_unlimited();

            let admin = admin_address(&env);
            let buyer = Address::generate(&env);
            let seller = Address::generate(&env);
            let treasury = Address::generate(&env);
            let mediator = Address::generate(&env);

            let contract_id = env.register(EscrowContract, ());
            let usdc_id = env
                .register_stellar_asset_contract_v2(admin.clone())
                .address();

            token::StellarAssetClient::new(&env, &usdc_id).mint(&buyer, &(amount * 10));

            let client = EscrowContractClient::new(&env, &contract_id);
            client.initialize(&admin, &usdc_id, &treasury, &100_u32, &usdc_id);
            client.set_mediator(&mediator);

            Ctx {
                env,
                contract_id,
                admin,
                buyer,
                seller,
                mediator,
            }
        }

        fn client(&self) -> EscrowContractClient<'_> {
            EscrowContractClient::new(&self.env, &self.contract_id)
        }

        fn measure<F: FnOnce()>(&self, f: F) -> CostEstimate {
            self.env.cost_estimate().budget().reset_unlimited();
            f();
            let budget = self.env.cost_estimate().budget();
            CostEstimate {
                cpu: budget.cpu_instruction_cost(),
                mem: budget.memory_bytes_cost(),
            }
        }
    }

    #[test]
    fn test_gas_create_trade() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let cost = ctx.measure(|| {
            client.create_trade(
                &ctx.buyer,
                &ctx.seller,
                &10_000_i128,
                &5000_u32,
                &5000_u32,
                &None,
            );
        });

        cost.assert_under("create_trade", "create_trade");
    }

    #[test]
    fn test_gas_deposit() {
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

        let cost = ctx.measure(|| {
            client.deposit(&trade_id);
        });

        cost.assert_under("deposit", "deposit");
    }

    #[test]
    fn test_gas_initiate_dispute() {
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

        let cost = ctx.measure(|| {
            client.initiate_dispute(
                &trade_id,
                &ctx.buyer,
                &String::from_str(&ctx.env, "QmGasTestReason"),
            );
        });

        cost.assert_under("initiate_dispute", "initiate_dispute");
    }

    #[test]
    fn test_gas_resolve_dispute() {
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
        client.initiate_dispute(
            &trade_id,
            &ctx.buyer,
            &String::from_str(&ctx.env, "QmGasTestReason"),
        );

        let cost = ctx.measure(|| {
            client.resolve_dispute(&trade_id, &ctx.mediator, &5_000_u32);
        });

        cost.assert_under("resolve_dispute", "resolve_dispute");
    }

    #[test]
    fn test_gas_full_dispute_lifecycle_combined() {
        let ctx = Ctx::new(10_000);
        let client = ctx.client();

        let cost = ctx.measure(|| {
            let trade_id = client.create_trade(
                &ctx.buyer,
                &ctx.seller,
                &10_000_i128,
                &5000_u32,
                &5000_u32,
                &None,
            );
            client.deposit(&trade_id);
            client.initiate_dispute(
                &trade_id,
                &ctx.buyer,
                &String::from_str(&ctx.env, "QmCombinedReason"),
            );
            client.resolve_dispute(&trade_id, &ctx.mediator, &5_000_u32);
        });

        cost.assert_under("combined lifecycle", "combined_lifecycle");
    }

    #[test]
    fn test_gas_admin_clawback() {
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

        let cost = ctx.measure(|| {
            client.cancel_trade(&trade_id, &ctx.admin);
        });

        cost.assert_under("admin_clawback", "admin_clawback");
    }

    /// Issue #110 — repeated partial `admin_clawback` calls on the same trade
    /// must not accumulate unexpected gas cost per call (e.g. via unbounded
    /// history/list growth). See `docs/gas-estimation.md` for the recorded
    /// baseline and methodology.
    #[test]
    fn test_gas_repeated_partial_clawback() {
        let ctx = Ctx::new(50_000);
        let client = ctx.client();
        let trade_id = client.create_trade(
            &ctx.buyer,
            &ctx.seller,
            &50_000_i128,
            &5000_u32,
            &5000_u32,
            &None,
        );
        client.deposit(&trade_id);
        let destination = Address::generate(&ctx.env);

        let cost = ctx.measure(|| {
            for _ in 0..5 {
                client.admin_clawback(&trade_id, &5_000_i128, &destination);
            }
        });

        cost.assert_under(
            "repeated_partial_clawback (5x)",
            "repeated_partial_clawback_5x",
        );
    }
}
