//! Shared admin signer fixture for contract unit and integration tests.
//!
//! # Purpose
//!
//! Contract tests previously each generated their own admin via
//! `Address::generate`. This module is the **single source of truth** for the
//! test admin address and a reusable escrow harness with companion roles
//! (buyer, seller, mediator, treasury, stranger).
//!
//! # Updating the admin key
//!
//! Change [`admin_address`] only. Every harness built through
//! [`AdminSignerFixture`] picks up the new generation strategy automatically.
//!
//! # Auth patterns
//!
//! - **Allow (happy path):** [`AdminSignerFixture::new`] enables
//!   `env.mock_all_auths()` so admin-gated calls succeed without spelling out
//!   each authorization.
//! - **Deny (non-admin):** use the [`auth_invoke`] macro with
//!   `client.mock_auths(&[...])` to supply auth for the wrong caller and
//!   assert the contract rejects it.
//!
//! This module is compiled for native / test builds only
//! (`#[cfg(not(feature = "wasm"))]` in `lib.rs`).

#![allow(dead_code)]

use soroban_sdk::{testutils::Address as _, token, Address, Env, IntoVal, Val, Vec};

use crate::{EscrowContract, EscrowContractClient};

/// Default platform fee (1%) used when tests do not need a custom rate.
pub const DEFAULT_FEE_BPS: u32 = 100;

/// Create the canonical test admin address.
///
/// This is the **only** place that defines how the admin signer is generated
/// for the contract test suite. Update this function if the admin key /
/// generation strategy changes.
pub fn admin_address(env: &Env) -> Address {
    Address::generate(env)
}

/// Create a non-admin role address (buyer, seller, stranger, etc.).
pub fn role_address(env: &Env) -> Address {
    Address::generate(env)
}

/// Shared escrow test harness with a fixed admin signer and companion roles.
///
/// Use this instead of duplicating `Env::default` / `Address::generate` /
/// `initialize` setup across test files.
pub struct AdminSignerFixture {
    pub env: Env,
    pub contract_id: Address,
    /// Escrow settlement token (stellar asset registered with `admin` as issuer).
    pub token_id: Address,
    /// Source token for path-payment deposits. Equal to [`Self::token_id`] for
    /// the default constructors; a distinct Stellar Asset Contract when built
    /// with [`AdminSignerFixture::new_with_source_token`].
    pub source_token_id: Address,
    /// Contract admin — the only address authorised for admin-gated entry points.
    pub admin: Address,
    pub buyer: Address,
    pub seller: Address,
    pub mediator: Address,
    pub treasury: Address,
    /// Address with no special role (non-admin caller for deny-path tests).
    pub stranger: Address,
}

impl AdminSignerFixture {
    /// Build a fixture with [`DEFAULT_FEE_BPS`], `mock_all_auths`, and a
    /// registered mediator.
    pub fn new() -> Self {
        Self::new_with_fee_bps(DEFAULT_FEE_BPS)
    }

    /// Same as [`Self::new`] but with a custom fee rate.
    pub fn new_with_fee_bps(fee_bps: u32) -> Self {
        Self::build(fee_bps, false)
    }

    /// Like [`Self::new`], but registers a second Stellar Asset Contract as
    /// the path-payment source token, so `deposit_with_path` runs against two
    /// real SAC tokens instead of one token playing both roles.
    pub fn new_with_source_token() -> Self {
        Self::build(DEFAULT_FEE_BPS, true)
    }

    fn build(fee_bps: u32, distinct_source_token: bool) -> Self {
        let env = Env::default();
        env.mock_all_auths();

        let admin = admin_address(&env);
        let buyer = role_address(&env);
        let seller = role_address(&env);
        let mediator = role_address(&env);
        let treasury = role_address(&env);
        let stranger = role_address(&env);

        let token_id = env
            .register_stellar_asset_contract_v2(admin.clone())
            .address();
        let source_token_id = if distinct_source_token {
            env.register_stellar_asset_contract_v2(admin.clone())
                .address()
        } else {
            token_id.clone()
        };
        let contract_id = env.register(EscrowContract, ());

        let client = EscrowContractClient::new(&env, &contract_id);
        client.initialize(&admin, &token_id, &treasury, &fee_bps, &source_token_id);
        client.add_mediator(&mediator);

        Self {
            env,
            contract_id,
            token_id,
            source_token_id,
            admin,
            buyer,
            seller,
            mediator,
            treasury,
            stranger,
        }
    }

    /// Alias for [`Self::token_id`] used by suites that still name the asset USDC.
    pub fn usdc_id(&self) -> &Address {
        &self.token_id
    }

    pub fn client(&self) -> EscrowContractClient<'_> {
        EscrowContractClient::new(&self.env, &self.contract_id)
    }

    pub fn token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.token_id)
    }

    pub fn source_token(&self) -> token::Client<'_> {
        token::Client::new(&self.env, &self.source_token_id)
    }

    /// Mint the path-payment source token (see [`Self::source_token_id`]).
    pub fn mint_source(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.source_token_id).mint(to, &amount);
    }

    pub fn mint(&self, to: &Address, amount: i128) {
        token::StellarAssetClient::new(&self.env, &self.token_id).mint(to, &amount);
    }

    /// Create a trade and deposit so it is in `Funded` status (50/50 split).
    pub fn funded_trade(&self, amount: i128) -> u64 {
        self.mint(&self.buyer, amount);
        let tid = self.client().create_trade(
            &self.buyer,
            &self.seller,
            &amount,
            &5000u32,
            &5000u32,
            &None,
        );
        self.client().deposit(&tid);
        tid
    }
}

impl Default for AdminSignerFixture {
    fn default() -> Self {
        Self::new()
    }
}

/// Build `MockAuth` args for `admin_clawback(trade_id, amount, destination)`.
pub fn clawback_auth_args(
    env: &Env,
    trade_id: u64,
    amount: i128,
    destination: &Address,
) -> Vec<Val> {
    soroban_sdk::vec![
        env,
        trade_id.into_val(env),
        amount.into_val(env),
        destination.into_val(env),
    ]
}

/// Construct a [`soroban_sdk::testutils::MockAuth`] at the call site
/// (temporary lifetime must cover the invoke).
///
/// ```rust,ignore
/// use amana_escrow::{auth_invoke, test_fixture::{clawback_auth_args, AdminSignerFixture}};
///
/// let f = AdminSignerFixture::new();
/// let tid = f.funded_trade(1_000);
/// let args = clawback_auth_args(&f.env, tid, 1_000, &f.buyer);
/// f.client()
///     .mock_auths(&[auth_invoke!(&f, &f.stranger, "admin_clawback", args)])
///     .admin_clawback(&tid, &1_000i128, &f.buyer);
/// ```
#[macro_export]
macro_rules! auth_invoke {
    ($fixture:expr, $caller:expr, $fn_name:expr, $args:expr) => {
        ::soroban_sdk::testutils::MockAuth {
            address: $caller,
            invoke: &::soroban_sdk::testutils::MockAuthInvoke {
                contract: &$fixture.contract_id,
                fn_name: $fn_name,
                args: $args,
                sub_invokes: &[],
            },
        }
    };
}
