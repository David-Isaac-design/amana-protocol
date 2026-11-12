#!/usr/bin/env bash
#
# Storage layout compatibility gate (#196).
#
# `storage_golden_tests.rs` and `schema_version_tests.rs` already detect a
# breaking change to the persistent storage layout. They were not, however,
# enforced as a blocking check with review discipline around golden values —
# so an upgrade PR could regenerate a golden value, land green, and silently
# corrupt the storage of every deployed instance.
#
# This script closes that. It runs the layout tests, then inspects the diff:
# a change to the DataKey enum or its golden test is refused unless the PR
# says the change is intentional AND bumps the schema version to match.
#
# Marking a diff intentional:
#   - add the `storage-layout-change` label to the PR, or
#   - include the marker [storage-layout] in the PR title or body, or
#   - include the marker [storage-layout] in a commit message on the branch.
#
# An intentional layout change must also bump CURRENT_SCHEMA_VERSION in
# contracts/amana_escrow/src/lib.rs, so deployed instances have a version to
# branch on when migrating.
#
# Usage:
#   scripts/check-storage-layout-gate.sh [base_ref]
#
# `base_ref` defaults to $GITHUB_BASE_REF, then origin/main.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
contract_dir="$repo_root/contracts/amana_escrow"

INTENT_MARKER="[storage-layout]"
INTENT_LABEL="storage-layout-change"
SCHEMA_CONST="CURRENT_SCHEMA_VERSION"

fail() {
  echo ""
  echo "storage layout gate FAILED: $*" >&2
  echo "" >&2
  echo "See docs/storage-layout-gate.md for how to refresh golden values safely." >&2
  exit 1
}

note() { echo "  $*"; }

# ---------------------------------------------------------------------------
# 1. Resolve the base commit to diff against
# ---------------------------------------------------------------------------

base_ref="${1:-${GITHUB_BASE_REF:-}}"
if [[ -z "$base_ref" ]]; then
  base_ref="main"
fi
# GITHUB_BASE_REF is a bare branch name; qualify it when it is not already.
if ! git -C "$repo_root" rev-parse --verify --quiet "$base_ref" >/dev/null; then
  base_ref="origin/$base_ref"
fi

if ! git -C "$repo_root" rev-parse --verify --quiet "$base_ref" >/dev/null; then
  echo "storage layout gate: no base ref to diff against ($base_ref); running tests only"
  base_ref=""
fi

# ---------------------------------------------------------------------------
# 2. Run the layout tests — these are the actual compatibility assertions
# ---------------------------------------------------------------------------

echo "storage layout gate: running layout compatibility tests"
(
  cd "$contract_dir"
  # AMANA_REGEN_GOLDEN must never be set here: it turns the assertions into
  # print statements and the gate would pass unconditionally.
  unset AMANA_REGEN_GOLDEN
  cargo test --locked --test storage_golden_tests
  cargo test --locked --test schema_version_tests
)
echo "storage layout gate: layout tests passed"

if [[ -z "$base_ref" ]]; then
  echo "storage layout gate: no diff to inspect, done"
  exit 0
fi

# ---------------------------------------------------------------------------
# 3. Detect changes to the storage key layout or its golden tests
# ---------------------------------------------------------------------------

merge_base="$(git -C "$repo_root" merge-base "$base_ref" HEAD)"
changed_files="$(git -C "$repo_root" diff --name-only "$merge_base"...HEAD || true)"

golden_changed=false
datakey_changed=false
schema_bumped=false

if grep -qE '^contracts/amana_escrow/tests/storage_golden_tests\.rs$' <<<"$changed_files"; then
  golden_changed=true
fi

base_datakey="$(git -C "$repo_root" show "$merge_base:contracts/amana_escrow/src/lib.rs" \
  | sed -n '/^pub enum DataKey {/,/^}/p')"
head_datakey="$(git -C "$repo_root" show "HEAD:contracts/amana_escrow/src/lib.rs" \
  | sed -n '/^pub enum DataKey {/,/^}/p')"
if [[ "$base_datakey" != "$head_datakey" ]]; then
  datakey_changed=true
fi

# A schema bump is a change to the CURRENT_SCHEMA_VERSION line specifically,
# not merely a change somewhere in lib.rs.
if git -C "$repo_root" diff -U0 "$merge_base"...HEAD -- contracts/amana_escrow/src/lib.rs \
  | grep -qE "^\+pub const ${SCHEMA_CONST}: u32 = "; then
  schema_bumped=true
fi

if [[ "$golden_changed" == false && "$datakey_changed" == false ]]; then
  echo "storage layout gate: no DataKey or golden test changes in this PR"
  exit 0
fi

echo "storage layout gate: storage layout artefacts changed in this PR"
[[ "$datakey_changed" == true ]] && note "storage keys: DataKey in src/lib.rs"
[[ "$golden_changed" == true ]] && note "golden values: storage_golden_tests.rs"

# ---------------------------------------------------------------------------
# 4. Require the change to be tagged intentional
# ---------------------------------------------------------------------------

intentional=false

# PR labels, when the workflow exports them.
if [[ -n "${PR_LABELS:-}" ]] && grep -qF "$INTENT_LABEL" <<<"${PR_LABELS}"; then
  intentional=true
  note "intent: '$INTENT_LABEL' label present"
fi

# PR title / body, when the workflow exports them.
if [[ "$intentional" == false ]]; then
  pr_text="${PR_TITLE:-} ${PR_BODY:-}"
  if grep -qF "$INTENT_MARKER" <<<"$pr_text"; then
    intentional=true
    note "intent: '$INTENT_MARKER' marker in PR title or body"
  fi
fi

# Commit messages on the branch, so the gate also works locally.
if [[ "$intentional" == false ]]; then
  if git -C "$repo_root" log --format=%B "$merge_base"..HEAD | grep -qF "$INTENT_MARKER"; then
    intentional=true
    note "intent: '$INTENT_MARKER' marker in a commit message"
  fi
fi

if [[ "$intentional" == false ]]; then
  fail "storage layout artefact changed without being tagged intentional.
  A change here alters the on-chain storage layout of deployed instances.
  If it is deliberate, add the '$INTENT_LABEL' label or put the
  '$INTENT_MARKER' marker in the PR title, body, or a commit message —
  and say in the PR description what moved and why it is safe."
fi

# ---------------------------------------------------------------------------
# 5. A DataKey layout change must bump the schema version
# ---------------------------------------------------------------------------

if [[ "$datakey_changed" == true && "$schema_bumped" == false ]]; then
  fail "storage layout changed intentionally but $SCHEMA_CONST was not bumped.
  Deployed instances need a version to branch on before migrating. Bump
  $SCHEMA_CONST in contracts/amana_escrow/src/lib.rs and update the
  expectations in schema_version_tests.rs in the same PR."
fi

if [[ "$datakey_changed" == true ]]; then
  note "schema: $SCHEMA_CONST bumped alongside the DataKey layout change"
fi
echo "storage layout gate: intentional change, correctly reviewed and versioned"
