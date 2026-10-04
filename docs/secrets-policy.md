# Secrets Policy

This document describes how Amana prevents accidental secret exposure and what to do when a secret is detected in the repository.

---

## 1. What We Scan For

The CI workflow `.github/workflows/secrets-scan.yml` runs on every push and pull request using **Gitleaks** with custom rules defined in `.gitleaks.toml`.

### Detected patterns

| Pattern | Severity |
|---------|----------|
| Stellar secret key (`S...` 56-char base32) | Critical |
| Private key PEM (`-----BEGIN PRIVATE KEY-----`) | Critical |
| JWT tokens assigned to secret env vars | Critical |
| PostgreSQL URLs with embedded passwords | Critical |
| Redis URLs with embedded passwords | High |
| Supabase service role key | Critical |
| Pinata JWT | Critical |
| Generic `API_KEY` / `SECRET_KEY` assignments | High |

### Safe files (excluded from scanning)
- `*.env.*.example` and `*.env.example` — placeholder values only
- `docs/**`, `*.md` — documentation prose
- `backend/src/__tests__/**` — test fixtures with fake credentials

---

## 2. How to Prevent Exposure

### Never commit real values

Use environment variable files that are excluded by `.gitignore`:

```
.env
.env.staging
.env.production
.env.local
backups/
```

### Use placeholder syntax in example files

```env
# ✓ Safe — placeholder value
JWT_SECRET=your-super-secret-jwt-key-must-be-at-least-32-chars-change-in-production!

# ✗ Unsafe — real value
JWT_SECRET=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Use GitHub Secrets for CI

Reference secrets as `${{ secrets.MY_SECRET }}` in workflows. Never echo or print them.

### Rotate immediately if exposed

If a key is accidentally committed, assume it is compromised even if the commit is later removed from history.

---

## 3. When a Secret Is Detected

### Step 1 — Revoke immediately

Revoke the exposed credential **before** doing anything else:

| Credential type | Where to revoke |
|----------------|-----------------|
| JWT Secret | Rotate `JWT_SECRET` in all environments and invalidate active sessions |
| Stellar secret key | Transfer funds immediately; the key is burned |
| Supabase service role key | Supabase dashboard → API settings → Rotate key |
| Pinata JWT | Pinata dashboard → API Keys → Revoke |
| Database password | Cloud console → Rotate credentials |

### Step 2 — Remove from git history

Removing from git history is **optional for revoked keys** but required for compliance:

```bash
# Using git-filter-repo (preferred)
pip install git-filter-repo
git filter-repo --path-glob '*.env' --invert-paths

# Or using BFG Repo Cleaner
java -jar bfg.jar --delete-files '*.env' repo.git
```

After rewriting history, force-push and notify all team members to re-clone.

### Step 3 — Notify

- Open a security incident issue (use the `security` label, keep it private if sensitive)
- Notify the team lead and on-call engineer
- Document what was exposed, when, and what was done

### Step 4 — Post-mortem

Document the root cause and add a `.gitleaks.toml` rule if the pattern isn't already covered.

---

## 4. Local Pre-commit Hook

Install Gitleaks locally to catch secrets before pushing:

```bash
# Install gitleaks (macOS)
brew install gitleaks
```

Then wire the repo's pre-commit hook (checked into [`.githooks/`](../.githooks/)):

```bash
./scripts/install-git-hooks.sh
```

This points git at `.githooks/pre-commit`, which runs `gitleaks protect --config=.gitleaks.toml --staged` on every commit and blocks it if a match is found. If gitleaks isn't installed locally, the hook warns and lets the commit through — CI (§ below) still blocks the push.

You can also run a full-repo scan manually at any time:

```bash
gitleaks detect --config=.gitleaks.toml --source=. --verbose
```

---

## 5. GitHub Push Protection

In addition to CI scanning, enable **GitHub's native secret scanning** in the repository settings:

1. **Settings** → **Security** → **Code security and analysis**
2. Enable **Secret scanning**
3. Enable **Push protection** — blocks pushes containing known secret formats

This provides a second layer of protection at the GitHub API level, independent of CI.

---

## 6. Suppressing False Positives

If Gitleaks flags a known safe value (e.g., a test fixture with a fake key), add it to `.gitleaks.toml`:

```toml
[[allowlists]]
description = "Known safe test fixture"
commits = ["abc1234"]
# or
regexes = ["FAKE_KEY_PLACEHOLDER_DO_NOT_USE"]
```

Document all suppressions with a comment explaining why they are safe.

---

## 7. Admin Secret Rotation (`ADMIN_SECRET_KEY`)

Admin signing key (`ADMIN_SECRET_KEY`) rotation is governed by the following operational requirements:

### Key Requirements
- **Rotation Interval**: Every 90 days or immediately upon suspected leak/offboarding.
- **Zero-Downtime**: Kubernetes deployment spec in `infra/k8s/backend-deployment.yaml` specifies `RollingUpdate` with `maxSurge: 1` and `maxUnavailable: 0`.
- **Validation**: Every secret change must be verified using `./scripts/validate-admin-secret.sh`.

### Rotation Steps
1. Update secret in Kubernetes: `kubectl apply -f infra/k8s/secrets.yaml`
2. Perform zero-downtime rollout: `kubectl rollout restart deployment/backend`
3. Run validation check: `ADMIN_SECRET_KEY="S..." ./scripts/validate-admin-secret.sh http://api.amanavault.com`
4. In case of validation error, perform immediate rollback: `kubectl rollout undo deployment/backend`

For detailed step-by-step instructions, see [docs/admin-secret-rotation.md](./admin-secret-rotation.md).

---

## 8. Secrets Inventory & Automated Rotation Schedule

This is the canonical inventory of platform secrets, their owners, storage location, and maximum age before rotation is required. It is also linked from the README's [Security & Operations](../README.md#-security--operations) section.

| Secret | Owner | Location | Max age | Rotation trigger |
|---|---|---|---|---|
| `JWT_SECRET` | Backend team (`@Ndifreke000`) | K8s secret `amana-secrets` / `backend/.env` | 90 days | Scheduled + suspected leak |
| `ADMIN_SECRET_KEY` | Backend team (`@Ndifreke000`) | K8s secret `amana-secrets` | 90 days | Scheduled + offboarding (see §7) |
| Webhook HMAC signing secret (`WEBHOOK_SIGNING_SECRET`) | Backend team | K8s secret `amana-secrets` | 180 days | Scheduled + consumer offboarding |
| `SUPABASE_SERVICE_ROLE_KEY` | Backend team | Supabase dashboard + K8s secret | 90 days | Scheduled + suspected leak |
| `PINATA_JWT` | Backend team | Pinata dashboard + K8s secret / `backend/.env` | 180 days | Scheduled + suspected leak (see [ipfs-pinning-credential-rotation.md](./runbooks/ipfs-pinning-credential-rotation.md)) |
| `STAGING_POSTGRES_PASSWORD` / `STAGING_REDIS_PASSWORD` | DevOps | GitHub Actions secrets | 180 days | Scheduled |
| Stellar signer keys (mediator/treasury automation, if any) | Backend team | Isolated key custody (see §7 Step 1) | 90 days | Scheduled + suspected leak |

### 8.1 Scheduled reminders

[`.github/workflows/secrets-rotation-reminder.yml`](../.github/workflows/secrets-rotation-reminder.yml) runs weekly and opens a tracked GitHub issue (label `secrets-rotation`) for any secret in the inventory above whose `max age` is within 14 days of elapsing, based on the `lastRotated` timestamps recorded in [`backend/scripts/secrets-rotation-status.json`](../backend/scripts/secrets-rotation-status.json). Update that file's `lastRotated` field every time you complete a rotation — the reminder and verification job both read from it.

### 8.2 Dual-secret acceptance window

For zero-downtime rotation of verification secrets (`JWT_SECRET`, webhook HMAC), the backend should accept both the outgoing and incoming secret for a bounded window during rollout (mirrors the `keyVersion` pattern already used by `EncryptionService`, see [docs/pii-encryption.md](./pii-encryption.md)). Concretely:

1. Deploy the new secret as a *secondary* verifier (e.g. `JWT_SECRET_NEXT`) alongside the current `JWT_SECRET`, without invalidating existing sessions/signatures.
2. Once all pods are running with both accepted, promote `JWT_SECRET_NEXT` to `JWT_SECRET` and roll again.
3. Retire the old value only after the rollout is confirmed healthy — this is what makes rotation zero-downtime instead of an outage.

### 8.3 Verification

Run `./scripts/verify-secrets-rotation.sh` to assert every secret in the inventory has a `lastRotated` timestamp younger than its `max age`. This is the "verification job asserting last-rotated timestamps" required by issue #203; wire it into a scheduled CI job (the same `secrets-rotation-reminder.yml` workflow runs it and fails the job — surfacing as a red check — if any secret is overdue).

### 8.4 Staging rotation drill

Follow `docs/admin-secret-rotation.md` end-to-end against the staging environment to drill a JWT/admin secret rotation without downtime: generate → deploy as secondary → roll → promote → validate via `./scripts/validate-admin-secret.sh` → retire old secret → record the drill date below.

**Drill log:**

| Date | Secret | Environment | Outcome | Notes |
|---|---|---|---|---|
| TODO | `JWT_SECRET` | staging | Not yet run | Schedule the first drill and record the outcome here. |
