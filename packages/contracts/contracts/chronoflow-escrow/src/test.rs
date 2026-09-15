#![cfg(test)]

//! Host-side unit tests for [`ChronoFlowEscrow`].
//!
//! Every test builds its own `Env::default()` so state never leaks between
//! cases. Time is driven with `env.ledger().set_timestamp()` to walk the
//! milestone schedule.
//!
//! Note on the generated client: in unit tests (the `testutils` build) the
//! `#[contractimpl]` client unwraps results, so `client.create_vault(..)`
//! returns a `u64` directly and panics if the contract returns an error. The
//! `try_*` variants expose the raw `Result<T, Result<Error, InvokeError>>` used
//! to assert exact contract errors.

extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Events as _, Ledger as _, MockAuth, MockAuthInvoke},
    token, Address, Env, Event, IntoVal,
};

const DAY: u64 = 24 * 60 * 60;
const START: u64 = 1_700_000_000;
const DURATION: u64 = 30 * DAY;
const CLAWBACK_DELAY: u64 = 14 * DAY;
const AMOUNT: i128 = 1_000_000_000;
const MILESTONES: u32 = 4;
const PER_MILESTONE: i128 = AMOUNT / MILESTONES as i128;

/// A deployed protocol plus a funded test token.
struct Harness {
    env: Env,
    contract_id: Address,
    token: Address,
    admin: Address,
    funder: Address,
    recipient: Address,
}

impl Harness {
    fn new() -> Self {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().set_timestamp(START);

        let admin = Address::generate(&env);
        let funder = Address::generate(&env);
        let recipient = Address::generate(&env);

        let contract_id = env.register(ChronoFlowEscrow, (admin.clone(), CLAWBACK_DELAY));

        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        let token = sac.address();
        token::StellarAssetClient::new(&env, &token).mint(&funder, &(AMOUNT * 10));

        Self {
            env,
            contract_id,
            token,
            admin,
            funder,
            recipient,
        }
    }

    fn client(&self) -> ChronoFlowEscrowClient<'_> {
        ChronoFlowEscrowClient::new(&self.env, &self.contract_id)
    }

    fn balance(&self, who: &Address) -> i128 {
        token::TokenClient::new(&self.env, &self.token).balance(who)
    }

    /// Creates the default vault and returns its id.
    fn create_vault(&self) -> u64 {
        self.client().create_vault(
            &self.funder,
            &self.recipient,
            &self.token,
            &AMOUNT,
            &DURATION,
            &MILESTONES,
        )
    }

    /// Moves the ledger clock to `timestamp`.
    fn set_time(&self, timestamp: u64) {
        self.env.ledger().set_timestamp(timestamp);
    }

    /// Unlock timestamp of the milestone at `index` for the default vault.
    fn unlock_at(&self, index: u32) -> u64 {
        START + (DURATION * (index as u64 + 1)) / MILESTONES as u64
    }

    /// Asserts the escrow contract emitted `expected` at some point.
    fn assert_emitted<E: Event>(&self, expected: &E) {
        let expected = expected.to_xdr(&self.env, &self.contract_id);
        let emitted = self
            .env
            .events()
            .all()
            .filter_by_contract(&self.contract_id);
        assert!(
            emitted.events().contains(&expected),
            "expected event was not emitted",
        );
    }
}

// ---------------------------------------------------------------------------
// create_vault
// ---------------------------------------------------------------------------

#[test]
fn create_vault_escrows_funds_and_records_state() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    assert_eq!(vault_id, 1);
    assert_eq!(h.balance(&h.contract_id), AMOUNT);
    assert_eq!(h.balance(&h.funder), AMOUNT * 10 - AMOUNT);
    assert_eq!(h.balance(&h.recipient), 0);

    let vault = h.client().get_vault(&vault_id);
    assert_eq!(vault.id, vault_id);
    assert_eq!(vault.funder, h.funder);
    assert_eq!(vault.recipient, h.recipient);
    assert_eq!(vault.token, h.token);
    assert_eq!(vault.total_amount, AMOUNT);
    assert_eq!(vault.amount_per_milestone, PER_MILESTONE);
    assert_eq!(vault.start_time, START);
    assert_eq!(vault.duration, DURATION);
    assert_eq!(vault.milestones, MILESTONES);
    assert_eq!(vault.milestones_released, 0);
    assert_eq!(vault.amount_released, 0);
    assert_eq!(vault.clawback_time, START + DURATION + CLAWBACK_DELAY);
    assert_eq!(vault.status, VaultStatus::Active);
}

#[test]
fn create_vault_emits_vault_created_event() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    h.assert_emitted(&VaultCreated {
        vault_id,
        funder: h.funder.clone(),
        recipient: h.recipient.clone(),
        token: h.token.clone(),
        total_amount: AMOUNT,
        amount_per_milestone: PER_MILESTONE,
        milestones: MILESTONES,
        start_time: START,
        duration: DURATION,
        clawback_time: START + DURATION + CLAWBACK_DELAY,
    });
}

#[test]
fn create_vault_assigns_sequential_ids() {
    let h = Harness::new();

    assert_eq!(h.client().vault_count(), 0);
    assert_eq!(h.client().next_vault_id(), 1);

    let first = h.create_vault();
    let second = h.create_vault();

    assert_eq!((first, second), (1, 2));
    assert_eq!(h.client().vault_count(), 2);
    assert_eq!(h.client().next_vault_id(), 3);
    assert_eq!(h.balance(&h.contract_id), AMOUNT * 2);
}

#[test]
fn create_vault_rejects_zero_duration() {
    let h = Harness::new();

    assert_eq!(
        h.client()
            .try_create_vault(&h.funder, &h.recipient, &h.token, &AMOUNT, &0, &MILESTONES),
        Err(Ok(Error::InvalidDuration)),
    );
}

#[test]
fn create_vault_rejects_invalid_milestone_counts() {
    let h = Harness::new();

    assert_eq!(
        h.client()
            .try_create_vault(&h.funder, &h.recipient, &h.token, &AMOUNT, &DURATION, &0),
        Err(Ok(Error::InvalidMilestoneCount)),
    );

    assert_eq!(
        h.client().try_create_vault(
            &h.funder,
            &h.recipient,
            &h.token,
            &AMOUNT,
            &DURATION,
            &(MAX_MILESTONES + 1)
        ),
        Err(Ok(Error::InvalidMilestoneCount)),
    );

    // The upper bound itself is allowed.
    let vault_id = h.client().create_vault(
        &h.funder,
        &h.recipient,
        &h.token,
        &(MAX_MILESTONES as i128),
        &DURATION,
        &MAX_MILESTONES,
    );
    assert_eq!(h.client().get_vault(&vault_id).amount_per_milestone, 1);
}

#[test]
fn create_vault_rejects_invalid_amounts() {
    let h = Harness::new();

    // Not divisible by the milestone count.
    assert_eq!(
        h.client()
            .try_create_vault(&h.funder, &h.recipient, &h.token, &1_000, &DURATION, &3),
        Err(Ok(Error::InvalidAmount)),
    );

    // Zero.
    assert_eq!(
        h.client().try_create_vault(
            &h.funder,
            &h.recipient,
            &h.token,
            &0,
            &DURATION,
            &MILESTONES
        ),
        Err(Ok(Error::InvalidAmount)),
    );

    // Negative.
    assert_eq!(
        h.client().try_create_vault(
            &h.funder,
            &h.recipient,
            &h.token,
            &-AMOUNT,
            &DURATION,
            &MILESTONES
        ),
        Err(Ok(Error::InvalidAmount)),
    );
}

#[test]
fn create_vault_requires_funder_authorization() {
    let env = Env::default();
    env.ledger().set_timestamp(START);

    let admin = Address::generate(&env);
    let contract_id = env.register(ChronoFlowEscrow, (admin.clone(), CLAWBACK_DELAY));
    let client = ChronoFlowEscrowClient::new(&env, &contract_id);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);

    // Only the test-token mint is authorized here; the funder never signs, so
    // the vault creation must fail.
    env.mock_auths(&[MockAuth {
        address: &admin,
        invoke: &MockAuthInvoke {
            contract: &token,
            fn_name: "mint",
            args: (funder.clone(), AMOUNT).into_val(&env),
            sub_invokes: &[],
        },
    }]);
    token::StellarAssetClient::new(&env, &token).mint(&funder, &AMOUNT);

    assert!(client
        .try_create_vault(&funder, &recipient, &token, &AMOUNT, &DURATION, &MILESTONES)
        .is_err());
}

// ---------------------------------------------------------------------------
// release_milestone
// ---------------------------------------------------------------------------

#[test]
fn release_milestone_is_locked_before_unlock_time() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    // One second before the first unlock.
    h.set_time(h.unlock_at(0) - 1);
    assert_eq!(
        h.client().try_release_milestone(&vault_id),
        Err(Ok(Error::MilestoneLocked))
    );

    // Exactly at the unlock boundary the release is allowed.
    h.set_time(h.unlock_at(0));
    assert_eq!(h.client().release_milestone(&vault_id), PER_MILESTONE);
}

#[test]
fn release_milestone_pays_recipient_and_updates_progress() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(0));

    let released = h.client().release_milestone(&vault_id);

    assert_eq!(released, PER_MILESTONE);
    // Emitted events are scoped to the last invocation, so assert right away.
    h.assert_emitted(&MilestoneReleased {
        vault_id,
        milestone_index: 0,
        recipient: h.recipient.clone(),
        amount: PER_MILESTONE,
        released_at: h.unlock_at(0),
    });

    assert_eq!(h.balance(&h.recipient), PER_MILESTONE);
    assert_eq!(h.balance(&h.contract_id), AMOUNT - PER_MILESTONE);

    let vault = h.client().get_vault(&vault_id);
    assert_eq!(vault.milestones_released, 1);
    assert_eq!(vault.amount_released, PER_MILESTONE);
    assert_eq!(vault.status, VaultStatus::Active);
}

#[test]
fn release_milestone_requires_no_authorization() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(1));

    h.client().release_milestone(&vault_id);

    // Only the escrow contract itself authorizes the token transfer it makes;
    // neither the funder nor the recipient is ever asked to sign a release.
    assert!(!h
        .env
        .auths()
        .iter()
        .any(|(address, _)| *address == h.funder || *address == h.recipient));
}

#[test]
fn release_milestone_walks_the_schedule_in_order() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    for index in 0..MILESTONES {
        // Right before this milestone unlocks the next release must fail.
        h.set_time(h.unlock_at(index) - 1);
        assert_eq!(
            h.client().try_release_milestone(&vault_id),
            Err(Ok(Error::MilestoneLocked))
        );

        h.set_time(h.unlock_at(index));
        assert_eq!(h.client().release_milestone(&vault_id), PER_MILESTONE);
        assert_eq!(h.balance(&h.recipient), PER_MILESTONE * (index as i128 + 1));
    }

    let vault = h.client().get_vault(&vault_id);
    assert_eq!(vault.milestones_released, MILESTONES);
    assert_eq!(vault.amount_released, AMOUNT);
    assert_eq!(vault.status, VaultStatus::Completed);
    assert_eq!(h.balance(&h.contract_id), 0);
}

#[test]
fn release_final_milestone_emits_completion_event() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(MILESTONES - 1));

    // Release every unlocked milestone in one pass.
    for _ in 0..MILESTONES {
        h.client().release_milestone(&vault_id);
    }

    h.assert_emitted(&VaultCompleted {
        vault_id,
        total_released: AMOUNT,
        completed_at: h.unlock_at(MILESTONES - 1),
    });
}

#[test]
fn release_milestone_rejects_completed_vault() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(MILESTONES - 1));

    for _ in 0..MILESTONES {
        h.client().release_milestone(&vault_id);
    }

    assert_eq!(
        h.client().try_release_milestone(&vault_id),
        Err(Ok(Error::VaultNotActive))
    );
}

#[test]
fn release_milestone_rejects_unknown_vaults() {
    let h = Harness::new();

    assert_eq!(
        h.client().try_release_milestone(&999),
        Err(Ok(Error::VaultNotFound))
    );
}

// ---------------------------------------------------------------------------
// clawback
// ---------------------------------------------------------------------------

#[test]
fn clawback_returns_unclaimed_funds_after_grace_period() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    h.set_time(START + DURATION + CLAWBACK_DELAY - 1);
    assert_eq!(
        h.client().try_clawback(&vault_id),
        Err(Ok(Error::ClawbackTooEarly))
    );

    h.set_time(START + DURATION + CLAWBACK_DELAY);
    let claimed = h.client().clawback(&vault_id);

    assert_eq!(claimed, AMOUNT);
    h.assert_emitted(&VaultClawedBack {
        vault_id,
        funder: h.funder.clone(),
        amount: AMOUNT,
        clawed_back_at: START + DURATION + CLAWBACK_DELAY,
    });

    assert_eq!(h.balance(&h.funder), AMOUNT * 10);
    assert_eq!(h.balance(&h.contract_id), 0);
    assert_eq!(
        h.client().get_vault(&vault_id).status,
        VaultStatus::ClawedBack
    );
}

#[test]
fn clawback_only_returns_the_unreleased_remainder() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    h.set_time(h.unlock_at(1));
    h.client().release_milestone(&vault_id);
    h.client().release_milestone(&vault_id);

    h.set_time(START + DURATION + CLAWBACK_DELAY);
    let claimed = h.client().clawback(&vault_id);

    assert_eq!(claimed, AMOUNT - PER_MILESTONE * 2);
    assert_eq!(h.balance(&h.recipient), PER_MILESTONE * 2);
    assert_eq!(h.balance(&h.contract_id), 0);
    assert_eq!(h.balance(&h.funder), AMOUNT * 10 - AMOUNT + claimed);
}

#[test]
fn clawback_requires_the_funder_to_authorize() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(START + DURATION + CLAWBACK_DELAY);

    h.client().clawback(&vault_id);

    assert!(h
        .env
        .auths()
        .iter()
        .any(|(address, _)| *address == h.funder));
}

#[test]
fn clawback_rejects_completed_vaults() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(MILESTONES - 1));

    for _ in 0..MILESTONES {
        h.client().release_milestone(&vault_id);
    }

    h.set_time(START + DURATION + CLAWBACK_DELAY);
    assert_eq!(
        h.client().try_clawback(&vault_id),
        Err(Ok(Error::VaultNotActive))
    );
}

#[test]
fn clawback_rejects_unknown_vaults() {
    let h = Harness::new();

    assert_eq!(h.client().try_clawback(&404), Err(Ok(Error::VaultNotFound)));
}

#[test]
fn clawback_rejects_second_call() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(START + DURATION + CLAWBACK_DELAY);

    h.client().clawback(&vault_id);
    assert_eq!(
        h.client().try_clawback(&vault_id),
        Err(Ok(Error::VaultNotActive))
    );
}

#[test]
fn clawback_stays_available_while_paused() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.client().set_paused(&true);
    h.set_time(START + DURATION + CLAWBACK_DELAY);

    assert_eq!(h.client().clawback(&vault_id), AMOUNT);
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

#[test]
fn unlock_time_follows_the_schedule() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    assert_eq!(h.client().unlock_time(&vault_id, &0), h.unlock_at(0));
    assert_eq!(h.client().unlock_time(&vault_id, &3), START + DURATION);
    assert_eq!(
        h.client().try_unlock_time(&vault_id, &MILESTONES),
        Err(Ok(Error::MilestoneIndexOutOfBounds))
    );

    // A duration that does not divide evenly still ends exactly at `duration`.
    let uneven = h
        .client()
        .create_vault(&h.funder, &h.recipient, &h.token, &999_999, &100, &3);
    assert_eq!(h.client().unlock_time(&uneven, &0), START + 33);
    assert_eq!(h.client().unlock_time(&uneven, &1), START + 66);
    assert_eq!(h.client().unlock_time(&uneven, &2), START + 100);
}

#[test]
fn releasable_amount_tracks_unlocked_milestones() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    assert_eq!(h.client().releasable_amount(&vault_id), 0);

    h.set_time(h.unlock_at(0) - 1);
    assert_eq!(h.client().releasable_amount(&vault_id), 0);

    h.set_time(h.unlock_at(1) + 1);
    assert_eq!(h.client().releasable_amount(&vault_id), PER_MILESTONE * 2);

    h.client().release_milestone(&vault_id);
    assert_eq!(h.client().releasable_amount(&vault_id), PER_MILESTONE);

    // Nothing is releasable once the vault is completed.
    h.set_time(h.unlock_at(MILESTONES - 1));
    for _ in 0..MILESTONES - 1 {
        h.client().release_milestone(&vault_id);
    }
    assert_eq!(h.client().releasable_amount(&vault_id), 0);
}

#[test]
fn releasable_amount_is_zero_for_clawed_back_vaults() {
    let h = Harness::new();
    let vault_id = h.create_vault();
    h.set_time(START + DURATION + CLAWBACK_DELAY);
    h.client().clawback(&vault_id);

    assert_eq!(h.client().releasable_amount(&vault_id), 0);
}

#[test]
fn vault_milestones_builds_the_timeline() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    let timeline = h.client().vault_milestones(&vault_id);
    assert_eq!(timeline.len(), MILESTONES);
    for (index, milestone) in timeline.iter().enumerate() {
        assert_eq!(milestone.index, index as u32);
        assert_eq!(milestone.amount, PER_MILESTONE);
        assert_eq!(milestone.unlock_time, h.unlock_at(index as u32));
        assert!(!milestone.released);
        assert!(!milestone.releasable);
    }

    h.set_time(h.unlock_at(0));
    let timeline = h.client().vault_milestones(&vault_id);
    assert!(timeline.get(0).unwrap().releasable);
    assert!(!timeline.get(1).unwrap().releasable);

    h.client().release_milestone(&vault_id);
    let timeline = h.client().vault_milestones(&vault_id);
    assert!(timeline.get(0).unwrap().released);
    assert!(!timeline.get(0).unwrap().releasable);
    assert!(!timeline.get(1).unwrap().releasable);

    assert_eq!(
        h.client().try_vault_milestones(&77),
        Err(Ok(Error::VaultNotFound))
    );
}

#[test]
fn get_vault_rejects_unknown_ids() {
    let h = Harness::new();

    assert_eq!(h.client().try_get_vault(&42), Err(Ok(Error::VaultNotFound)));
}

#[test]
fn config_views_report_the_constructor_values() {
    let h = Harness::new();

    assert_eq!(h.client().admin(), h.admin);
    assert_eq!(h.client().clawback_delay(), CLAWBACK_DELAY);
    assert!(!h.client().is_paused());
    assert_eq!(h.client().vault_count(), 0);
}

#[test]
fn views_are_isolated_per_vault() {
    let h = Harness::new();
    let first = h.create_vault();
    // A second vault on a much shorter schedule, funded by the same funder.
    let second = h
        .client()
        .create_vault(&h.funder, &h.admin, &h.token, &(AMOUNT * 2), &DAY, &2);

    h.set_time(START + DAY);
    h.client().release_milestone(&second);

    assert_eq!(h.client().get_vault(&first).milestones_released, 0);
    assert_eq!(h.client().get_vault(&second).milestones_released, 1);
    assert_eq!(h.balance(&h.funder), AMOUNT * 10 - AMOUNT - AMOUNT * 2);
    assert_eq!(h.balance(&h.admin), AMOUNT);
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

#[test]
fn pause_blocks_creation_and_releases_until_unpaused() {
    let h = Harness::new();
    h.client().set_paused(&true);
    assert!(h.client().is_paused());

    assert_eq!(
        h.client().try_create_vault(
            &h.funder,
            &h.recipient,
            &h.token,
            &AMOUNT,
            &DURATION,
            &MILESTONES
        ),
        Err(Ok(Error::ContractPaused)),
    );

    h.client().set_paused(&false);
    assert!(!h.client().is_paused());

    let vault_id = h.create_vault();
    h.set_time(h.unlock_at(0));
    h.client().set_paused(&true);

    assert_eq!(
        h.client().try_release_milestone(&vault_id),
        Err(Ok(Error::ContractPaused)),
    );

    h.client().set_paused(&false);
    assert_eq!(h.client().release_milestone(&vault_id), PER_MILESTONE);
}

#[test]
fn set_clawback_delay_only_affects_future_vaults() {
    let h = Harness::new();
    let existing = h.create_vault();

    let new_delay = 30 * DAY;
    h.client().set_clawback_delay(&new_delay);
    h.assert_emitted(&ClawbackDelayUpdated {
        admin: h.admin.clone(),
        previous_delay: CLAWBACK_DELAY,
        new_delay,
    });

    assert_eq!(h.client().clawback_delay(), new_delay);

    let future = h.create_vault();
    assert_eq!(
        h.client().get_vault(&existing).clawback_time,
        START + DURATION + CLAWBACK_DELAY
    );
    assert_eq!(
        h.client().get_vault(&future).clawback_time,
        START + DURATION + new_delay
    );
}

#[test]
fn admin_actions_require_the_admin_to_authorize() {
    let h = Harness::new();

    h.client().set_paused(&true);
    h.client().set_clawback_delay(&DAY);

    let auths = h.env.auths();
    assert!(auths.iter().any(|(address, _)| *address == h.admin));
    assert!(!auths.iter().any(|(address, _)| *address == h.funder));
}

#[test]
fn admin_actions_emit_observability_events() {
    let h = Harness::new();

    h.client().set_paused(&true);
    h.assert_emitted(&ContractPauseToggled {
        admin: h.admin.clone(),
        paused: true,
    });

    h.client().set_paused(&false);
    h.assert_emitted(&ContractPauseToggled {
        admin: h.admin.clone(),
        paused: false,
    });
}

// ---------------------------------------------------------------------------
// Cross-cutting invariants
// ---------------------------------------------------------------------------

#[test]
fn escrow_balance_always_matches_the_active_vaults() {
    let h = Harness::new();
    let vault_id = h.create_vault();

    // Fund a second, shorter vault.
    let second =
        h.client()
            .create_vault(&h.funder, &h.recipient, &h.token, &(AMOUNT / 2), &DAY, &2);

    assert_eq!(h.balance(&h.contract_id), AMOUNT + AMOUNT / 2);

    h.set_time(START + DAY);
    h.client().release_milestone(&second);
    assert_eq!(h.balance(&h.contract_id), AMOUNT + AMOUNT / 2 - AMOUNT / 4);

    h.set_time(START + DURATION + CLAWBACK_DELAY);
    h.client().clawback(&vault_id);
    assert_eq!(h.balance(&h.contract_id), AMOUNT / 4);
}

#[test]
fn zero_clawback_delay_opens_clawback_when_the_vault_ends() {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let contract_id = env.register(ChronoFlowEscrow, (admin.clone(), 0u64));
    let client = ChronoFlowEscrowClient::new(&env, &contract_id);

    assert_eq!(client.clawback_delay(), 0);

    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = sac.address();
    let funder = Address::generate(&env);
    let recipient = Address::generate(&env);
    token::StellarAssetClient::new(&env, &token).mint(&funder, &AMOUNT);

    env.ledger().set_timestamp(START);
    let vault_id =
        client.create_vault(&funder, &recipient, &token, &AMOUNT, &DURATION, &MILESTONES);
    assert_eq!(client.get_vault(&vault_id).clawback_time, START + DURATION);

    env.ledger().set_timestamp(START + DURATION);
    assert_eq!(client.clawback(&vault_id), AMOUNT);
}

#[test]
fn emitted_events_use_snake_case_topic_symbols() {
    // The backend indexer filters on these exact topic symbols, and
    // `#[contractevent]` derives each one from the snake_case form of the Rust
    // type name. This test pins that contract between the two packages.
    let h = Harness::new();

    let vault_id = h.create_vault();
    let created = std::format!(
        "{:?}",
        h.env
            .events()
            .all()
            .filter_by_contract(&h.contract_id)
            .events()
    );
    assert!(created.contains("vault_created"), "{created}");

    h.set_time(h.unlock_at(0));
    h.client().release_milestone(&vault_id);
    let released = std::format!(
        "{:?}",
        h.env
            .events()
            .all()
            .filter_by_contract(&h.contract_id)
            .events()
    );
    assert!(released.contains("milestone_released"), "{released}");

    h.set_time(h.unlock_at(MILESTONES - 1));
    h.client().release_milestone(&vault_id);
    h.client().release_milestone(&vault_id);
    h.client().release_milestone(&vault_id);
    let completed = std::format!(
        "{:?}",
        h.env
            .events()
            .all()
            .filter_by_contract(&h.contract_id)
            .events()
    );
    assert!(completed.contains("vault_completed"), "{completed}");

    let clawback_vault = h.create_vault();
    h.set_time(h.unlock_at(MILESTONES - 1) + DURATION + CLAWBACK_DELAY + 1);
    h.client().clawback(&clawback_vault);
    let clawed_back = std::format!(
        "{:?}",
        h.env
            .events()
            .all()
            .filter_by_contract(&h.contract_id)
            .events()
    );
    assert!(clawed_back.contains("vault_clawed_back"), "{clawed_back}");
}

#[test]
fn large_amounts_are_handled_without_overflow() {
    let h = Harness::new();
    // Largest multiple of the milestone count that still fits an i64.
    let big: i128 = (i128::from(i64::MAX) / 8) * 8;

    token::StellarAssetClient::new(&h.env, &h.token).mint(&h.funder, &big);

    let vault_id = h
        .client()
        .create_vault(&h.funder, &h.recipient, &h.token, &big, &DURATION, &8);

    let vault = h.client().get_vault(&vault_id);
    assert_eq!(vault.amount_per_milestone, big / 8);
    assert_eq!(vault.total_amount, big);
    assert_eq!(vault.amount_per_milestone * 8, big);
}
