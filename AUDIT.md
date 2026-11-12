# Repository Audit

Audit date: 2026-08-30

This audit records baseline results from before the cleanup and the final
results after it. Checks were run locally; a failing check is reported as-is.

## Stack checks

| Stack | Check | Before cleanup | After cleanup |
|---|---|---|---|
| Contracts | `cargo build --workspace` | Not run: Cargo was unavailable. | Passed with Rust 1.100.0. |
| Contracts | `cargo clippy --workspace --all-targets -- -D warnings` | Not run: Cargo was unavailable. | Passed. |
| Contracts | `cargo fmt --check` | Not run: Cargo was unavailable. | Passed after the style-only formatting commit `4fdf5b9`. |
| Contracts | `cargo test --workspace --no-fail-fast` | Not run: Cargo was unavailable. | Passed: 585 passed, 0 failed, 6 ignored across 28 test binaries. Ran with `AMANA_PROP_SEED=1794523570 AMANA_PROP_TESTS=64`. The six pre-existing ignored tests were not changed. |
| Contracts | `cargo audit` | Not run: Cargo and `cargo-audit` were unavailable. | Passed (exit 0): one investigated host-only advisory is narrowly ignored; 3 upstream warnings remain. See Dependency health. |
| Backend | `npm run build` | Failed: Prisma schema validation (P1012); Prisma CLI 7.10.0 rejects `datasource.url`. | Failed with the same P1012 validation error. |
| Backend | `./node_modules/.bin/tsc --noEmit -p tsconfig.json` | Failed: generated Prisma types and other TypeScript errors. | Failed: Prisma exports/types are unavailable, with downstream implicit-any/type errors. |
| Backend | `npm run lint` | Failed: 991 problems (12 errors, 979 warnings). | Failed: 991 problems (12 errors, 979 warnings). |
| Backend | `npm test -- --runInBand` | Terminated with exit 143 after partial Prisma-related compile failures. | Failed: 158 suites failed, 46 passed, 1 skipped; 51 tests failed, 1,151 passed, 3 skipped. |
| Frontend | `npm run build` | Failed during TypeScript validation: `CrashOnRender` returns `void`. | Failed during TypeScript validation on the same `CrashOnRender` component. |
| Frontend | `./node_modules/.bin/tsc --noEmit` | Failed with TypeScript errors. | Failed with TypeScript errors in UI fixtures, tests, and visual/E2E files. |
| Frontend | `npm run lint` | Failed: 78 problems (63 errors, 15 warnings). | Failed: 78 problems (63 errors, 15 warnings). |
| Frontend | `npm test -- --runInBand` | Failed: 13 suites failed, 84 passed; 96 tests failed, 1,150 passed (1,246 total). | Same totals: 13 suites failed, 84 passed; 96 tests failed, 1,150 passed (1,246 total). |
| Mobile | Expo Android export (`npx expo export --platform android`) | Failed while evaluating `app.config.ts` (`getDefaultConfig` was undefined). | Expo config now resolves and preserves the static plugins/native settings; export reaches Metro and fails because `src/navigation/AppNavigator.tsx` imports missing `src/screens/DisputeDetailScreen`. |
| Mobile | `npm run type-check` | Failed with TypeScript errors. | Failed with TypeScript errors, including unresolved `DisputeDetailScreen`, auth-store typing, and test errors. |
| Mobile | `npm run lint` | Failed on undefined Jest globals in test files. | Failed: 907 problems (901 errors, 6 warnings), primarily undefined Jest globals. |
| Mobile | `npm test -- --runInBand` | Failed: 6 suites failed, 17 passed; 12 tests failed, 173 passed. | Failed: 5 suites failed, 18 passed; 9 tests failed, 176 passed. |

Mobile dependency installation was verified with `npm ci --ignore-scripts` after
the lockfile was regenerated using standard npm peer resolution. npm reported
peer overrides for `react-server-dom-webpack`/React; the install completed.
`eas build` was not run because it is a remote native build requiring EAS
credentials and platform configuration.

Contract tooling uses Rust stable 1.100.0 with the minimal profile,
`wasm32-unknown-unknown`, `clippy`, and `rustfmt`. There is no repository
toolchain pin; the contract uses edition 2024 and `soroban-sdk` 25.3.2, whose
declared minimum Rust version is 1.84.0. Stellar CLI 30.0.1 and `cargo-audit`
0.23.0 are installed. The Stellar CLI was installed from its checksum-verified
release binary after `cargo install --locked stellar-cli` did not complete.
The devcontainer configuration installs these tools for future Codespaces.

The original 15 contract test failures were triaged individually in
[`docs/contracts-test-triage.md`](./docs/contracts-test-triage.md). Two were
real contract bugs: expiry refunds decoded versioned trade storage as the
legacy type, and dispute lifecycle transitions were missing persistent history
records. The remaining failures were stale accounting expectations, floating
point-generated parity fixtures, or test harness assumptions. The minimal
contract fixes and stronger assertions now pass the full workspace suite.

## Repository hygiene and documentation

- **Pass:** The root `.gitignore` covers `node_modules/`, `target/`, `.env*`,
  `dist/`, `build/`, `.next/`, Expo output, and coverage. `*.example` env files
  remain trackable; eight are currently tracked.
- **Pass:** 1,006 generated Soroban host snapshots were removed from Git
  tracking and are now ignored. Fixed storage encodings and schema-version
  tests remain the checked-in regression gates.
- **Pass:** `git rm -r --cached node_modules` removed all five tracked
  dependency-artifact paths from the index. The installed files remain local
  and ignored.
- **Pass:** The MIT license is present at the root.
- **Pass:** All local links in README files, including image links, resolve.
- **Found and fixed:** The root README referenced the missing
  `DISTRIBUTED_TRACING_GUIDE.md`; it now links to
  [`docs/distributed-tracing.md`](./docs/distributed-tracing.md), which
  describes the implementation and its limitations.
- **Branding:** Human-facing names, package names, root README, and mobile
  display name now use Amana Protocol. Legacy machine identifiers such as the
  mobile secure-storage key `innov8_token`, metric names, Kubernetes
  resource/secret names, and historical external issue URLs were retained to
  avoid breaking deployed integrations or references.
- **Secret review:** A source/config text search and manual review did not
  identify a confirmed live credential. Environment examples contain
  placeholders. This was not a comprehensive secret scan: `gitleaks` and
  `trivy` are unavailable in this environment.
- **Dead code:** No dedicated dead-code analyzer was available. ESLint reports
  unused symbols, including unused trade-metric imports in the backend and
  unused variables/imports in frontend and mobile tests; see the lint results
  above.

## Removed and archived material

- Moved the five issue/PR summaries for issues 39, 40, 67, 72, and 75 into
  [`docs/history/`](./docs/history/), with a note that these are historical
  records rather than verified current behavior.
- Deleted the root `.codex` and `STELLAR_WAVE_IMPLEMENTATION.md`, plus the
  obsolete root issue implementation and PR summary files after archiving the
  selected summaries.
- Deleted the obsolete contents of `archive/` rather than presenting them as
  current documentation.

## Dependency health

`npm audit` results from the initial cleanup run (counts are advisories across
the lockfile; they are not claims of exploitability in this application and
were not rerun during contract triage):

| Package area | Low | Moderate | High | Critical | Total |
|---|---:|---:|---:|---:|---:|
| Root tooling | 3 | 16 | 0 | 0 | 19 |
| Backend | 10 | 68 | 22 | 2 | 102 |
| Frontend | 3 | 17 | 13 | 2 | 35 |
| Mobile | 9 | 27 | 27 | 2 | 65 |
| `routes-d` | 0 | 2 | 10 | 3 | 15 |

`npm outdated` reports 1 outdated direct dependency at the root, 44 in
`backend/`, 25 in `frontend/`, 37 in `mobile/`, and 8 in `routes-d/`. Broad
dependency upgrades were not attempted.

`cargo audit` scanned 213 lockfile dependencies and exited 0. The dependency
tree was checked with `cargo tree -i` for each finding:

- `crypto-bigint 0.5.5`, `RUSTSEC-2026-0387`, is pulled through
  `elliptic-curve` / `k256` / `p256` into `soroban-env-host`. It is absent from
  the `wasm32-unknown-unknown` dependency graph and remains a host-side
  Soroban SDK dependency. `contracts/.cargo/audit.toml` ignores only this
  advisory, with its rationale and removal condition documented in the file.
- `derivative 2.2.0` and `paste 1.0.15` are unmaintained upstream
  dependencies; `spin 0.9.8` is yanked upstream through `soroban-wasmi`.
  No compatible upstream fix is available for these warnings.
- Compatible updates moved `anyhow` to `1.0.104` and `rand` to `0.8.8` /
  `0.10.3`; their earlier advisories no longer appear in the audit.
