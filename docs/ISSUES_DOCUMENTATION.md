# Contract Issues Documentation

This document describes four open issues for the `amana_escrow` Soroban contract.
All four target `contracts/amana_escrow/src/lib.rs` and are part of the
[Drips Wave (Stellar Wave)](https://github.com/Happybello365/innov8) program.

---

## Issue #1 — Two-step admin transfer (`propose_admin` / `accept_admin`)

**Type:** Security | **Complexity:** Medium (150 pts)

### Problem

The contract stores one admin address at `DataKey::Admin` (set during
`initialize`). There is currently no function to hand that role to a different
address. If the admin ever needs to rotate keys, there is no safe path — and a
one-step transfer (write new address, done) could lock the contract forever if a
typo or wrong address is used.

### What needs to be built

A two-step handover pattern identical to the "propose → accept" pattern used in
many safe admin-transfer designs:

| Step | Caller | Function | Storage effect |
|------|--------|----------|----------------|
| 1 | Current admin | `propose_admin(new_admin: Address)` | Writes `new_admin` to `DataKey::PendingAdmin` (instance storage) |
| 2 | Proposed address | `accept_admin()` | Copies `PendingAdmin` → `Admin`, clears `PendingAdmin` |

Neither step uses the existing timelock queue — the two-step handshake is itself
the safety mechanism (the wrong address simply cannot call `accept_admin`).

### Events to emit

| Event name | When | Fields |
|------------|------|--------|
| `admin_proposed` | After `propose_admin` succeeds | `current_admin`, `pending_admin` |
| `admin_transferred` | After `accept_admin` succeeds | `old_admin`, `new_admin` |

Both events must be added to `schemas/events/amana_escrow.events.json` and the
generated files regenerated (see `docs/event-schema.md`).

### Storage changes

- New `DataKey` variant: `PendingAdmin` (instance storage).
- Cleared (removed) when `accept_admin` completes or when a new proposal
  overwrites the previous one.

### Test scenarios required

1. **Happy path** — admin proposes, pending address accepts, `get_admin()`
   returns the new address, `PendingAdmin` key is gone.
2. **Wrong acceptor** — a stranger calling `accept_admin` is rejected.
3. **Overwrite pending proposal** — admin calls `propose_admin` twice; the second
   proposal replaces the first and the original pending address can no longer accept.

### Acceptance criteria

- Only the address stored in `PendingAdmin` can complete the transfer.
- `get_admin()` returns the new admin immediately after `accept_admin`.
- All CI gates listed in README → *Required PR CI Gates* pass.

### Relevant files

- `contracts/amana_escrow/src/lib.rs` — add functions, `DataKey` variant, events
- `docs/TIMELOCK_POLICY.md` — no change needed (this feature does not use the
  timelock queue), but the admin-transfer flow should be cross-referenced

---

## Issue #2 — Timelocked treasury address rotation

**Type:** Security | **Complexity:** Medium (150 pts)

### Problem

The treasury address is written once during `initialize` and stored at
`DataKey::Treasury`. It is the destination of all platform fee withdrawals
(`withdraw_fees`). There is no function to update it. If the treasury wallet is
compromised or the team needs to rotate it, there is no on-chain path — and even
if one were added naively, an instant change would let a compromised admin key
silently redirect all future fee income.

### What needs to be built

A new `SetTreasury` operation kind that plugs into the **existing timelock
queue/execute pattern** (same pattern as `queue_clawback` / `execute_clawback`
and `queue_upgrade` / `execute_upgrade`):

| Step | Function | Behaviour |
|------|----------|-----------|
| 1 | `queue_set_treasury(new_treasury: Address)` | Admin auth required. Creates a `QueuedOperation` with `payload: TimelockOpPayload::SetTreasury(...)` and `execute_after = now + clawback_delay_seconds` (or a dedicated config field). Emits `TimelockOperationQueued`. |
| 2 | `execute_set_treasury(operation_id: u64)` | Admin auth required. Asserts delay has passed, not executed, not cancelled. Reads old treasury, writes new one, emits `TreasuryRotatedEvent`. Marks operation executed. |

Cancel is handled by the existing `cancel_queued_operation` function — no new
cancel function is needed.

### Storage / type changes

- New variant on `TimelockOpPayload` enum: `SetTreasury(TimelockSetTreasuryOp)`
- New struct `TimelockSetTreasuryOp { new_treasury: Address }`

### Events to emit

| Event name | Topic | When | Fields |
|------------|-------|------|--------|
| `TimelockOperationQueued` | `TLKQUE` | On queue (already exists) | reused as-is |
| `TreasuryRotatedEvent` | `TRYRTT` (suggested) | On execute | `old_treasury`, `new_treasury`, `operation_id` |

`TreasuryRotatedEvent` must be added to the event schema JSON and generated
files updated (see `docs/event-schema.md`).

### TIMELOCK_POLICY.md update

The policy doc currently lists only `clawback` and `upgrade` operations.
A new section must be added describing:
- The `SetTreasury` operation kind
- Its delay (same 1-day default or a dedicated field — document the choice)
- The queue → delay → execute or cancel flow

### Test scenarios required

1. **Too early** — `execute_set_treasury` called before `execute_after` is
   rejected with `TIMELOCK_NOT_READY`.
2. **Cancellation** — operation is queued then cancelled; subsequent execute
   attempt is rejected.
3. **Success** — delay passes, `execute_set_treasury` runs, `get_treasury()`
   returns the new address, `TreasuryRotatedEvent` is emitted with correct old
   and new values.

### Acceptance criteria

- Treasury address cannot change before the timelock delay has fully elapsed.
- `TIMELOCK_POLICY.md` lists `SetTreasury` as a recognised operation kind.
- All CI gates listed in README → *Required PR CI Gates* pass.

### Relevant files

- `contracts/amana_escrow/src/lib.rs` — `TimelockOpPayload`, new functions,
  new event struct
- `docs/TIMELOCK_POLICY.md` — new section documenting the operation

---

## Issue #3 — Emit events when guardians are added or removed

**Type:** Enhancement | **Complexity:** Trivial (100 pts)

### Problem

`add_guardian(guardian: Address)` and `remove_guardian(guardian: Address)` are
the only two functions that control who can pause the protocol. They currently
write to `DataKey::GuardianRegistry(address)` silently — no event is published.
Indexers, monitoring dashboards, and off-chain security tooling cannot observe
guardian set changes, so a compromised admin key could add a malicious guardian
(and then call `pause`) without any on-chain trace.

### Current behaviour (from `lib.rs`)

```
add_guardian    → sets GuardianRegistry(guardian) = true   (no event)
remove_guardian → removes GuardianRegistry(guardian)       (no event)
```

### What needs to be built

Two new event structs, each emitted at the end of the respective function:

| Struct name | Topic | Fields |
|-------------|-------|--------|
| `GuardianAddedEvent` | `GDNADD` (suggested) | `guardian: Address` |
| `GuardianRemovedEvent` | `GDNREM` (suggested) | `guardian: Address` |

Both follow the same pattern as the already-existing `MediatorAddedEvent`
(`MEDADD`) and `MediatorRemovedEvent` (`MEDREM`) which are the direct analogues
in the mediator registry.

### Event schema update

Both events must be added to `schemas/events/amana_escrow.events.json` and
generated files regenerated:
- `contracts/amana_escrow/src/generated/event_schema.rs`
- `backend/src/types/generated/events.generated.ts`

`docs/event-schema.md` must list both new events in its event table.

### Test changes

The existing guardian tests (covering `add_guardian`, `remove_guardian`,
`is_guardian`, `pause`, `unpause`) must be extended to assert on the emitted
events — that the correct topic fires and the `guardian` field matches the
address passed to the function.

### Acceptance criteria

- `guardian_added` event is emitted on every successful `add_guardian` call.
- `guardian_removed` event is emitted on every successful `remove_guardian` call.
- Both events are documented in `docs/event-schema.md`.
- All CI gates listed in README → *Required PR CI Gates* pass.

### Relevant files

- `contracts/amana_escrow/src/lib.rs` — add event structs, emit in functions
- `docs/event-schema.md` — add entries for both new events

---

## Issue #4 — Emit an event when the deadline extension policy changes

**Type:** Enhancement | **Complexity:** Trivial (100 pts)

### Problem

`set_extension_policy(max_extensions, max_total_extension_secs)` silently
overwrites the `ExtensionPolicy` stored at `DataKey::ExtensionPolicy`. The
existing `ExtensionPolicyUpdatedEvent` struct (`EXTPOL`) **already exists** in
`lib.rs` but it only carries the **new** values — it does not include the old
values before the change. Off-chain monitoring therefore cannot tell what changed
or detect a policy being quietly tightened or loosened.

### Current event shape (already defined)

```rust
pub struct ExtensionPolicyUpdatedEvent {
    pub max_extensions: u32,
    pub max_total_extension_secs: u64,
    pub schema_version: u32,
}
```

### What needs to be built

Two changes:

1. **Read the current policy before overwriting it** and include both old and new
   values in the event. The event struct needs two new fields:

   ```
   old_max_extensions: u32
   old_max_total_extension_secs: u64
   ```

   Because the v1 event shape is locked by `event_schema_tests.rs` (see
   `docs/event-schema.md` — "Additive only"), new fields must be added at the
   end and `EVENT_SCHEMA_VERSION` (and `schemaVersion` in the JSON) must be
   bumped in the same commit.

   > **Alternative:** Emit the existing event unchanged and add a companion
   > event that carries only the old values. This avoids a schema-version bump
   > but adds a second event subscription. The approach taken must be documented.

2. **Verify the event is emitted** — a unit test that calls
   `set_extension_policy`, captures events, and asserts the payload contains
   correct old and new values.

### Schema update

If the existing event struct is extended: bump `EVENT_SCHEMA_VERSION` in
`lib.rs` and `schemaVersion` in `schemas/events/amana_escrow.events.json` in
the same commit and regenerate both generated files.

If a companion event is chosen instead: add the new event to the schema JSON and
regenerate.

Either way, run `npm run codegen:events` before committing.

### Acceptance criteria

- An event (or pair of events) is emitted on every successful
  `set_extension_policy` call.
- The emitted data allows a listener to see both the previous and the new policy
  values.
- All CI gates listed in README → *Required PR CI Gates* pass.

### Relevant files

- `contracts/amana_escrow/src/lib.rs` — update event struct and/or add new one,
  ensure event is emitted
- `docs/deadline-extension-caps.md` — already references `ExtensionPolicyUpdatedEvent`; update if the shape changes

---

## Shared setup

All four issues share the same development setup:

```bash
cd contracts/amana_escrow
cargo build
cargo test
```

Event schema regeneration (needed for issues #2, #3, #4):

```bash
npm run codegen:events        # regenerate
npm run codegen:events:check  # verify without writing (what CI runs)
```

## Cross-cutting notes

| Topic | Where it is documented |
|-------|------------------------|
| Timelock queue/execute pattern | `docs/TIMELOCK_POLICY.md` |
| Event schema rules (add, bump, regenerate) | `docs/event-schema.md` |
| Extension policy caps and ceilings | `docs/deadline-extension-caps.md` |
| Guardian pause/unpause flow | `contracts/amana_escrow/src/lib.rs` lines ~1058–1125 |
| `TimelockOpPayload` enum | `contracts/amana_escrow/src/lib.rs` lines ~878–893 |
