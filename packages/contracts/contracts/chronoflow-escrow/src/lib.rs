#![no_std]

//! # ChronoFlow Escrow
//!
//! On-chain, time-locked escrow and milestone-based payment streaming for Stellar.
//!
//! A *funder* locks an amount of a SEP-41 token into a vault for a *recipient*.
//! The amount is split into `milestones` equal slices; slice `i` becomes
//! releasable at
//! `start_time + duration * (i + 1) / milestones` and pays the recipient
//! directly. Milestones unlock strictly in order.
//!
//! Once the schedule has fully elapsed plus a protocol-wide grace period, any
//! slice the recipient never claimed can be clawed back by the funder. The
//! recipient therefore has the whole vault duration to claim, while abandoned
//! capital still returns to the funder.
//!
//! ## Design notes
//!
//! * **Auth:** `create_vault` requires the funder's signature and `clawback`
//!   requires the vault funder's signature. `release_milestone` is
//!   permissionless: the payout always goes to the vault's stored recipient, so
//!   letting anyone advance the stream cannot move funds to a third party. This
//!   makes the stream cheap to keep alive (any relayer/keeper can do it).
//! * **Reentrancy:** state is written *before* the token transfer (checks →
//!   effects → interactions), and the Soroban host reverts the entire
//!   invocation if the transfer fails.
//! * **Storage:** vault records live in `persistent` storage (bounded keyspace,
//!   one entry per vault) while admin configuration lives in `instance`
//!   storage. Both have their TTL bumped on write.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token::TokenClient,
    Address, Env, Vec,
};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Maximum milestone count per vault. Bounds the cost of timeline reads.
pub const MAX_MILESTONES: u32 = 100;

/// Grace period applied to vaults when the constructor does not override it.
pub const DEFAULT_CLAWBACK_DELAY: u64 = 14 * 24 * 60 * 60; // 14 days

/// Stellar closes a ledger roughly every 5 seconds.
const LEDGERS_PER_DAY: u32 = 17_280;

const INSTANCE_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 7;
const INSTANCE_TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 30;

const VAULT_TTL_THRESHOLD: u32 = LEDGERS_PER_DAY * 7;
const VAULT_TTL_EXTEND_TO: u32 = LEDGERS_PER_DAY * 180;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/// Storage keys for the contract.
///
/// `Vault` is the only per-vault key; everything else is singleton
/// configuration held in instance storage.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Admin,
    ClawbackDelay,
    Paused,
    NextVaultId,
    Vault(u64),
}

/// Lifecycle of a vault.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum VaultStatus {
    /// Milestones are still streaming.
    Active,
    /// Every milestone has been released to the recipient.
    Completed,
    /// Remaining funds were returned to the funder.
    ClawedBack,
}

/// Full vault record.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Vault {
    pub id: u64,
    pub funder: Address,
    pub recipient: Address,
    /// SEP-41 token contract used for funding and payouts.
    pub token: Address,
    pub total_amount: i128,
    pub amount_per_milestone: i128,
    pub start_time: u64,
    pub duration: u64,
    pub milestones: u32,
    pub milestones_released: u32,
    pub amount_released: i128,
    /// `start_time + duration + clawback_delay`, fixed when the vault is created.
    pub clawback_time: u64,
    pub status: VaultStatus,
}

/// Timeline read model, one entry per milestone.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneView {
    pub index: u32,
    pub amount: i128,
    pub unlock_time: u64,
    pub released: bool,
    /// True when the milestone is unlocked, unreleased and the vault is active.
    pub releasable: bool,
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/// Emitted when a vault is created and funded.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultCreated {
    #[topic]
    pub vault_id: u64,
    #[topic]
    pub funder: Address,
    #[topic]
    pub recipient: Address,
    pub token: Address,
    pub total_amount: i128,
    pub amount_per_milestone: i128,
    pub milestones: u32,
    pub start_time: u64,
    pub duration: u64,
    pub clawback_time: u64,
}

/// Emitted for every milestone payout.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MilestoneReleased {
    #[topic]
    pub vault_id: u64,
    #[topic]
    pub milestone_index: u32,
    #[topic]
    pub recipient: Address,
    pub amount: i128,
    pub released_at: u64,
}

/// Emitted when unclaimed funds are returned to the funder.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultClawedBack {
    #[topic]
    pub vault_id: u64,
    #[topic]
    pub funder: Address,
    pub amount: i128,
    pub clawed_back_at: u64,
}

/// Emitted when the final milestone of a vault is released.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct VaultCompleted {
    #[topic]
    pub vault_id: u64,
    pub total_released: i128,
    pub completed_at: u64,
}

/// Emitted when an admin changes the grace period for future vaults.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ClawbackDelayUpdated {
    #[topic]
    pub admin: Address,
    pub previous_delay: u64,
    pub new_delay: u64,
}

/// Emitted when an admin toggles the pause switch.
#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ContractPauseToggled {
    #[topic]
    pub admin: Address,
    pub paused: bool,
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// Contract errors. Soroban surfaces these as `ContractError(n)`.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// The contract has not been initialized with an admin.
    NotInitialized = 1,
    /// `duration` must be greater than zero.
    InvalidDuration = 2,
    /// `milestones` must be between 1 and `MAX_MILESTONES`.
    InvalidMilestoneCount = 3,
    /// `amount` must be positive and divisible by the milestone count.
    InvalidAmount = 4,
    /// No vault exists for the given id.
    VaultNotFound = 5,
    /// The vault is completed or was already clawed back.
    VaultNotActive = 6,
    /// The next milestone has not unlocked yet.
    MilestoneLocked = 7,
    /// Every milestone of the vault has already been released.
    NoMilestonesRemaining = 8,
    /// The vault grace period has not elapsed yet.
    ClawbackTooEarly = 9,
    /// New vaults and releases are paused.
    ContractPaused = 10,
    /// The milestone index is outside the vault's schedule.
    MilestoneIndexOutOfBounds = 11,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct ChronoFlowEscrow;

#[contractimpl]
impl ChronoFlowEscrow {
    /// Deploys the protocol and stores the initial configuration.
    ///
    /// * `admin` - address allowed to pause the protocol and change the grace period.
    /// * `clawback_delay` - seconds added to each vault's `duration` before the
    ///   funder may claw back unclaimed funds.
    pub fn __constructor(env: Env, admin: Address, clawback_delay: u64) {
        let storage = env.storage().instance();
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::ClawbackDelay, &clawback_delay);
        storage.set(&DataKey::Paused, &false);
        storage.set(&DataKey::NextVaultId, &1_u64);
        bump_instance(&env);
    }

    /// Creates a time-locked vault and escrows `amount` of `token` from `funder`.
    ///
    /// The vault is funded in the same call: the tokens move from `funder` to
    /// the escrow contract, and are only ever paid out by `release_milestone`
    /// (to `recipient`) or `clawback` (back to `funder`).
    ///
    /// # Arguments
    /// * `funder` - account funding the vault; must authorize the call.
    /// * `recipient` - beneficiary of every milestone payout.
    /// * `token` - SEP-41 token contract address.
    /// * `amount` - total amount to escrow, divisible by `milestones`.
    /// * `duration` - seconds from `start_time` to the final unlock.
    /// * `milestones` - number of equal slices, at most `MAX_MILESTONES`.
    ///
    /// Returns the new vault id.
    pub fn create_vault(
        env: Env,
        funder: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        duration: u64,
        milestones: u32,
    ) -> Result<u64, Error> {
        funder.require_auth();

        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }
        if duration == 0 {
            return Err(Error::InvalidDuration);
        }
        if milestones == 0 || milestones > MAX_MILESTONES {
            return Err(Error::InvalidMilestoneCount);
        }
        if amount <= 0 || amount % (milestones as i128) != 0 {
            return Err(Error::InvalidAmount);
        }

        let vault_id = next_vault_id(&env);
        let amount_per_milestone = amount / (milestones as i128);
        let start_time = env.ledger().timestamp();
        let clawback_time = start_time + duration + read_clawback_delay(&env);

        let vault = Vault {
            id: vault_id,
            funder: funder.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            total_amount: amount,
            amount_per_milestone,
            start_time,
            duration,
            milestones,
            milestones_released: 0,
            amount_released: 0,
            clawback_time,
            status: VaultStatus::Active,
        };

        // Effects before interactions.
        write_vault(&env, &vault);
        env.storage()
            .instance()
            .set(&DataKey::NextVaultId, &(vault_id + 1));
        bump_instance(&env);

        TokenClient::new(&env, &token).transfer(&funder, env.current_contract_address(), &amount);

        VaultCreated {
            vault_id,
            funder,
            recipient,
            token,
            total_amount: amount,
            amount_per_milestone,
            milestones,
            start_time,
            duration,
            clawback_time,
        }
        .publish(&env);

        Ok(vault_id)
    }

    /// Releases the next unlocked milestone of `vault_id` to the recipient.
    ///
    /// Permissionless: the payout always targets the vault's stored recipient,
    /// so any account (or keeper bot) may advance the stream.
    ///
    /// Returns the amount transferred.
    pub fn release_milestone(env: Env, vault_id: u64) -> Result<i128, Error> {
        if is_paused(&env) {
            return Err(Error::ContractPaused);
        }

        let mut vault = read_vault(&env, vault_id)?;
        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let index = vault.milestones_released;
        if index >= vault.milestones {
            return Err(Error::NoMilestonesRemaining);
        }

        let now = env.ledger().timestamp();
        if now < milestone_unlock_time(&vault, index) {
            return Err(Error::MilestoneLocked);
        }

        let amount = vault.amount_per_milestone;
        vault.milestones_released = index + 1;
        vault.amount_released += amount;
        if vault.milestones_released == vault.milestones {
            vault.status = VaultStatus::Completed;
        }

        // Effects before interactions.
        write_vault(&env, &vault);

        TokenClient::new(&env, &vault.token).transfer(
            &env.current_contract_address(),
            &vault.recipient,
            &amount,
        );

        MilestoneReleased {
            vault_id,
            milestone_index: index,
            recipient: vault.recipient.clone(),
            amount,
            released_at: now,
        }
        .publish(&env);

        if vault.status == VaultStatus::Completed {
            VaultCompleted {
                vault_id,
                total_released: vault.amount_released,
                completed_at: now,
            }
            .publish(&env);
        }

        Ok(amount)
    }

    /// Returns every milestone the recipient never claimed to the funder.
    ///
    /// Requires the funder's signature and only succeeds once the vault grace
    /// period (`clawback_time`) has elapsed. Already released milestones are
    /// never touched. Note this stays available while the protocol is paused so
    /// a funder can always recover capital from an expired vault.
    ///
    /// Returns the amount returned to the funder.
    pub fn clawback(env: Env, vault_id: u64) -> Result<i128, Error> {
        let mut vault = read_vault(&env, vault_id)?;
        vault.funder.require_auth();

        if vault.status != VaultStatus::Active {
            return Err(Error::VaultNotActive);
        }

        let now = env.ledger().timestamp();
        if now < vault.clawback_time {
            return Err(Error::ClawbackTooEarly);
        }

        // An `Active` vault always has at least one unreleased milestone, so
        // the remainder is strictly positive here.
        let amount = vault.total_amount - vault.amount_released;

        vault.status = VaultStatus::ClawedBack;

        // Effects before interactions.
        write_vault(&env, &vault);

        TokenClient::new(&env, &vault.token).transfer(
            &env.current_contract_address(),
            &vault.funder,
            &amount,
        );

        VaultClawedBack {
            vault_id,
            funder: vault.funder.clone(),
            amount,
            clawed_back_at: now,
        }
        .publish(&env);

        Ok(amount)
    }

    /// Sets the grace period applied to vaults created from now on.
    ///
    /// Existing vaults keep the `clawback_time` they were created with.
    pub fn set_clawback_delay(env: Env, new_delay: u64) -> Result<(), Error> {
        let admin = read_admin(&env)?;
        admin.require_auth();

        let previous_delay = read_clawback_delay(&env);
        env.storage()
            .instance()
            .set(&DataKey::ClawbackDelay, &new_delay);
        bump_instance(&env);

        ClawbackDelayUpdated {
            admin,
            previous_delay,
            new_delay,
        }
        .publish(&env);

        Ok(())
    }

    /// Pauses or resumes vault creation and milestone releases.
    pub fn set_paused(env: Env, paused: bool) -> Result<(), Error> {
        let admin = read_admin(&env)?;
        admin.require_auth();

        env.storage().instance().set(&DataKey::Paused, &paused);
        bump_instance(&env);

        ContractPauseToggled { admin, paused }.publish(&env);

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// Full vault record.
    pub fn get_vault(env: Env, vault_id: u64) -> Result<Vault, Error> {
        read_vault(&env, vault_id)
    }

    /// Timeline read model for a vault, one entry per milestone.
    pub fn vault_milestones(env: Env, vault_id: u64) -> Result<Vec<MilestoneView>, Error> {
        let vault = read_vault(&env, vault_id)?;
        let now = env.ledger().timestamp();
        let mut milestones = Vec::new(&env);

        for index in 0..vault.milestones {
            let unlock_time = milestone_unlock_time(&vault, index);
            let released = index < vault.milestones_released;
            milestones.push_back(MilestoneView {
                index,
                amount: vault.amount_per_milestone,
                unlock_time,
                released,
                releasable: vault.status == VaultStatus::Active && !released && now >= unlock_time,
            });
        }

        Ok(milestones)
    }

    /// Amount the recipient can release right now.
    ///
    /// Milestones unlock in order, so this sums the contiguous run of unlocked,
    /// unreleased milestones.
    pub fn releasable_amount(env: Env, vault_id: u64) -> Result<i128, Error> {
        let vault = read_vault(&env, vault_id)?;
        if vault.status != VaultStatus::Active {
            return Ok(0);
        }

        let now = env.ledger().timestamp();
        let mut total: i128 = 0;
        for index in vault.milestones_released..vault.milestones {
            if now < milestone_unlock_time(&vault, index) {
                break;
            }
            total += vault.amount_per_milestone;
        }

        Ok(total)
    }

    /// Absolute unlock timestamp of a milestone.
    pub fn unlock_time(env: Env, vault_id: u64, milestone_index: u32) -> Result<u64, Error> {
        let vault = read_vault(&env, vault_id)?;
        if milestone_index >= vault.milestones {
            return Err(Error::MilestoneIndexOutOfBounds);
        }
        Ok(milestone_unlock_time(&vault, milestone_index))
    }

    /// Number of vaults created so far.
    pub fn vault_count(env: Env) -> u64 {
        next_vault_id(&env) - 1
    }

    /// Id the next `create_vault` call will use.
    pub fn next_vault_id(env: Env) -> u64 {
        next_vault_id(&env)
    }

    /// Whether new vaults and releases are currently paused.
    pub fn is_paused(env: Env) -> bool {
        is_paused(&env)
    }

    /// Grace period applied to vaults created from now on.
    pub fn clawback_delay(env: Env) -> u64 {
        read_clawback_delay(&env)
    }

    /// The protocol admin address.
    pub fn admin(env: Env) -> Result<Address, Error> {
        read_admin(&env)
    }
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

/// Absolute unlock timestamp of `index` within a vault's schedule.
///
/// Slice `i` unlocks at `start_time + duration * (i + 1) / milestones`, which
/// spreads the schedule across the whole duration even when it does not divide
/// evenly.
fn milestone_unlock_time(vault: &Vault, index: u32) -> u64 {
    vault.start_time + (vault.duration * (index as u64 + 1)) / (vault.milestones as u64)
}

fn read_vault(env: &Env, vault_id: u64) -> Result<Vault, Error> {
    env.storage()
        .persistent()
        .get(&DataKey::Vault(vault_id))
        .ok_or(Error::VaultNotFound)
}

fn write_vault(env: &Env, vault: &Vault) {
    let key = DataKey::Vault(vault.id);
    let storage = env.storage().persistent();
    storage.set(&key, vault);
    storage.extend_ttl(&key, VAULT_TTL_THRESHOLD, VAULT_TTL_EXTEND_TO);
}

fn read_admin(env: &Env) -> Result<Address, Error> {
    env.storage()
        .instance()
        .get(&DataKey::Admin)
        .ok_or(Error::NotInitialized)
}

fn read_clawback_delay(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::ClawbackDelay)
        .unwrap_or(DEFAULT_CLAWBACK_DELAY)
}

fn next_vault_id(env: &Env) -> u64 {
    env.storage()
        .instance()
        .get(&DataKey::NextVaultId)
        .unwrap_or(1)
}

fn is_paused(env: &Env) -> bool {
    env.storage()
        .instance()
        .get(&DataKey::Paused)
        .unwrap_or(false)
}

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(INSTANCE_TTL_THRESHOLD, INSTANCE_TTL_EXTEND_TO);
}

mod test;
