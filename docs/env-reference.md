# Environment Variable Reference

Complete reference for all environment variables used across innov8 stacks. This is the single source of truth for environment configuration.

## Backend (Node.js/TypeScript)

Environment variables for the backend API server. Source: `backend/src/config/env.ts` (zod schema).

| Variable | Required? | Default | Type | Secret? | Description |
|----------|-----------|---------|------|---------|-------------|
| **Server** | | | | | |
| `NODE_ENV` | No | `development` | Enum: `development`, `production`, `staging`, `test` | No | Deployment environment. Production requires a tracing backend. |
| `PORT` | No | `4000` | Number | No | Port to listen on. |
| `TRUST_PROXY` | No | `false` | Boolean | No | Trust X-Forwarded-* headers from proxy. Set to `true` behind load balancer. |
| **Authentication & Sessions** | | | | | |
| `JWT_SECRET` | Yes | — | String (min 32 chars) | Yes | Secret key for signing JWT tokens. Must be at least 32 characters. |
| `JWT_EXPIRES_IN` | No | `86400` | String | No | JWT expiration time (seconds). Default 24 hours. |
| `JWT_ISSUER` | No | `amana` | String | No | JWT issuer claim. |
| `JWT_AUDIENCE` | No | `amana-api` | String | No | JWT audience claim. |
| `ADMIN_SECRET_KEY` | Yes | — | String (min 1 char) | Yes | Stellar secret key for signing admin transactions. Server fails to start without this. |
| `ADMIN_STELLAR_PUBKEYS` | No | (empty) | String (comma-separated) | No | List of Stellar public keys allowed to access admin routes. Empty means all authenticated users. |
| `ADMIN_ROUTES_ENABLED` | No | `false` | Boolean | No | Enable/disable admin routes at startup. |
| `ADMIN_SESSION_BINDING_ENABLED` | No | `false` | Boolean | No | Enable device binding for admin sessions (IP + user-agent). |
| `ADMIN_SESSION_BINDING_ENFORCE` | No | `false` | Boolean | No | When enabled, reject admin bearers with no device binding. |
| `ADMIN_BOUND_JWT_EXPIRES_IN` | No | `900` | Number | No | TTL (seconds) for device-bound admin tokens. Default 15 minutes. |
| `ADMIN_IP_V4_PREFIX_BITS` | No | `24` | Number (0-32) | No | IPv4 prefix bits for device binding (e.g., 24 = /24 subnet). |
| `ADMIN_IP_V6_PREFIX_BITS` | No | `48` | Number (0-128) | No | IPv6 prefix bits for device binding. |
| **Database** | | | | | |
| `DATABASE_URL` | Yes | — | String (PostgreSQL URI) | Yes | PostgreSQL connection string. Format: `postgresql://user:password@host:port/database` |
| `REDIS_URL` | No | `redis://localhost:6379` | String (Redis URI) | No | Redis connection string for caching and rate limiting. |
| **Supabase** | | | | | |
| `SUPABASE_URL` | No | — | String (URL) | No | Supabase project URL. |
| `SUPABASE_SERVICE_ROLE_KEY` | No | — | String | Yes | Supabase service role key for backend-to-database operations. |
| **API & CORS** | | | | | |
| `CORS_ORIGINS` | No | (empty) | String (comma-separated URLs) | No | Allowed CORS origins. Empty allows all. |
| `API_PUBLIC_URL` | No | — | String (URL) | No | Public URL of the API (used in error responses, docs generation). |
| **Stellar & Soroban** | | | | | |
| `STELLAR_NETWORK` | No | `testnet` | Enum: `testnet`, `mainnet` | No | Stellar network. |
| `STELLAR_NETWORK_PASSPHRASE` | No | — | String | No | Stellar network passphrase (auto-set from network if empty). |
| `STELLAR_RPC_URL` | No | — | String (URL) | No | Stellar RPC endpoint. If empty, uses network default. |
| `SOROBAN_RPC_URL` (deprecated) | No | — | String (URL) | No | Soroban RPC endpoint. Deprecated: use `STELLAR_RPC_URL`. |
| `AMANA_ESCROW_CONTRACT_ID` | Yes | — | String (contract ID) | No | Soroban contract ID for the escrow. Format: `C...` (56 chars). |
| `USDC_CONTRACT_ID` | Yes | — | String (contract ID) | No | Soroban contract ID for USDC token. Format: `C...` (56 chars). |
| `CONTRACT_ID` (deprecated) | No | — | String (contract ID) | No | Deprecated: use `AMANA_ESCROW_CONTRACT_ID`. |
| **Stellar Fee Estimation** | | | | | |
| `STELLAR_FEE_PERCENTILE` | No | `p90` | Enum: `p10`, `p20`, ..., `p99` | No | Fee percentile for network congestion resilience. |
| `STELLAR_FEE_SAFETY_MULTIPLIER` | No | `1.5` | Number (positive) | No | Multiplier applied to base fee. |
| `STELLAR_FEE_CONGESTION_BOOST` | No | `2` | Number (≥1) | No | Fee boost when network utilization is high. |
| `STELLAR_FEE_CONGESTION_CAPACITY` | No | `0.75` | Number (0-1) | No | Network utilization threshold (%) to trigger congestion boost. |
| `STELLAR_FEE_CONGESTION_FEE_RATIO` | No | `4` | Number (≥1) | No | Ratio of congested fee to base fee. |
| `STELLAR_FEE_MIN_STROOPS` | No | `100` | Number | No | Minimum fee per operation (stroops). |
| `STELLAR_FEE_MAX_STROOPS` | No | `1000000` | Number | No | Maximum fee per operation (stroops). |
| `STELLAR_FEE_BUMP_FACTOR` | No | `1.5` | Number (>1) | No | Fee increase factor for retries. |
| `STELLAR_FEE_MAX_RETRIES` | No | `3` | Number (≥0) | No | Maximum fee estimation retries. |
| **Admin Soroban Operations** | | | | | |
| `SOROBAN_SUBMIT_MAX_RETRIES` | No | `3` | Number (≥0) | No | Max retries for admin Soroban transaction submission. |
| `SOROBAN_SUBMIT_BACKOFF_MS` | No | `1000,2000,4000,8000` | String (comma-separated ms) | No | Exponential backoff delays (ms) between retries. |
| `ADMIN_ROUTE_TIMEOUT_MS` | No | `15000` | Number | No | Hard timeout (ms) for admin Soroban route execution. |
| **IPFS & Pinata** | | | | | |
| `PINATA_API_KEY` | No | — | String | Yes | Pinata API key for pinning files. |
| `PINATA_SECRET` | No | — | String | Yes | Pinata API secret (legacy auth). |
| `PINATA_JWT` | No | — | String | Yes | Pinata JWT token for file operations. |
| `IPFS_GATEWAY_URL` | No | `https://gateway.pinata.cloud/ipfs` | String (URL) | No | Primary IPFS gateway URL. |
| `IPFS_GATEWAY_URLS` | No | — | String (comma-separated URLs) | No | Fallback IPFS gateway URLs. |
| `IPFS_GATEWAY_ALLOWLIST` | No | (empty) | String (comma-separated domains) | No | Restrict gateway requests to allowlisted domains. |
| `IPFS_UPLOAD_TIMEOUT_MS` | No | `10000` | Number | No | Timeout (ms) for IPFS file uploads. |
| `IPFS_STREAM_TIMEOUT_MS` | No | `5000` | Number | No | Timeout (ms) for IPFS stream operations. |
| `IPFS_PINATA_CIRCUIT_FAILURE_THRESHOLD` | No | `3` | Number | No | Consecutive failures before circuit breaks Pinata. |
| `IPFS_PINATA_CIRCUIT_COOLDOWN_MS` | No | `30000` | Number | No | Cooldown (ms) before retrying failed Pinata requests. |
| `IPFS_GATEWAY_CIRCUIT_FAILURE_THRESHOLD` | No | `3` | Number | No | Consecutive failures before circuit breaks gateway. |
| `IPFS_GATEWAY_CIRCUIT_COOLDOWN_MS` | No | `30000` | Number | No | Cooldown (ms) before retrying failed gateway requests. |
| `IPFS_URL_SIGNING_SECRET` | No | — | String (min 32 chars) | Yes | Secret for signing IPFS gateway URLs (defaults to `JWT_SECRET` in dev). |
| `IPFS_URL_TTL_SECONDS` | No | `300` | Number (1-3600) | No | TTL (seconds) for signed IPFS URLs. Default 5 minutes. |
| **Evidence & Manifest** | | | | | |
| `EVIDENCE_MAX_BYTES` | No | `52428800` | Number | No | Maximum size (bytes) for evidence uploads. Default 50 MB. |
| `EVIDENCE_METADATA_RETENTION_DAYS` | No | `90` | Number | No | Days to retain evidence metadata. |
| `EVIDENCE_SCAN_REQUIRED` | No | `false` | Boolean | No | Require malware scan for evidence uploads. |
| `MANIFEST_PII_RETENTION_DAYS` | No | `30` | Number | No | Days to retain driver/manifest PII. |
| **Soroban Event Listener** | | | | | |
| `EVENT_POLL_INTERVAL_MS` | No | `10000` | Number | No | Interval (ms) to poll Soroban for events. |
| `BACKOFF_INITIAL_MS` | No | `1000` | Number | No | Initial backoff (ms) for polling failures. |
| `BACKOFF_MAX_MS` | No | `30000` | Number | No | Maximum backoff (ms) for polling failures. |
| `PROCESSED_LEDGERS_CACHE_SIZE` | No | `10000` | Number | No | Number of processed ledgers to cache in memory. |
| `EVENT_OUTBOX_MAX_ATTEMPTS` | No | `5` | Number | No | Maximum retry attempts for event outbox delivery. |
| **Distributed Tracing** | | | | | |
| `JAEGER_ENDPOINT` | No | — | String (URL) | No | Jaeger collector endpoint for trace export. |
| `ZIPKIN_ENDPOINT` | No | — | String (URL) | No | Zipkin collector endpoint for trace export. |
| `PROMETHEUS_PORT` | No | — | Number | No | Prometheus metrics server port. |
| `OTEL_SERVICE_NAME` | No | — | String | No | OpenTelemetry service name for traces. |
| `OTEL_EXPORTER_JAEGER_AGENT_HOST` | No | — | String | No | Jaeger agent host (direct agent reporting). |
| `OTEL_EXPORTER_JAEGER_AGENT_PORT` | No | — | Number | No | Jaeger agent port (direct agent reporting). |
| `TRACE_BASELINE_RATE` | No | `0.1` | Number (0-1) | No | Sampling rate for baseline (non-error) requests. Default 10%. |
| `TRACE_SLOW_THRESHOLD_MS` | No | `2000` | Number | No | Threshold (ms) to always sample slow requests. |
| `TRACE_ROUTE_OVERRIDES` | No | `{}` | String (JSON) | No | Per-route sampling rate overrides. Example: `{"/wallet":0.2}` |
| **Audit & Signing** | | | | | |
| `AUDIT_SIGNING_KEY_ID` | No | — | String (min 1 char) | No | Key ID for audit export signing (Ed25519). |
| `AUDIT_SIGNING_PRIVATE_KEY_PEM` | No | — | String (PEM format) | Yes | Private key (PEM) for signing audit exports. |
| `AUDIT_SIGNING_PUBLIC_KEY_PEM` | No | — | String (PEM format) | Yes | Public key (PEM) for verifying audit exports. |
| **Webhooks** | | | | | |
| `WEBHOOK_URL` | No | — | String (URL) | No | Outbound webhook URL for trade events. |
| `WEBHOOK_SECRET` | No | — | String | Yes | Secret for signing outbound webhooks. |
| `WEBHOOK_MAX_ATTEMPTS` | No | `3` | Number | No | Max retry attempts for webhook delivery. |
| `WEBHOOK_RETRY_BASE_MS` | No | `1000` | Number | No | Base delay (ms) for webhook retries. |
| `WEBHOOK_RETRY_MAX_MS` | No | `30000` | Number | No | Maximum delay (ms) for webhook retries. |
| `INBOUND_WEBHOOK_SECRETS` | No | — | String (JSON) | Yes | Secrets for verifying inbound webhooks. Format: `{"provider":"secret1,secret2"}` |
| `INBOUND_WEBHOOK_TOLERANCE_SECONDS` | No | `300` | Number | No | Replay window (seconds) for inbound webhook signatures. |
| **Alerts & Monitoring** | | | | | |
| `ALERT_WEBHOOK_URL` | No | — | String (URL) | No | Webhook URL for ops alerts (cache/DB failures). |
| `ALERT_WEBHOOK_SECRET` | No | — | String | Yes | Secret for signing alert webhooks. |
| `ALERT_COOLDOWN_MS` | No | `300000` | Number | No | Cooldown (ms) between alert webhook deliveries. |
| `ADMIN_TX_FAILURE_THRESHOLD` | No | `5` | Number (>0) | No | Number of failures to trigger alert. |
| `ADMIN_TX_FAILURE_WINDOW_MS` | No | `300000` | Number (>0) | No | Time window (ms) for counting failures. |
| `ADMIN_STATS_CACHE_TTL_SECONDS` | No | `60` | Number (>0) | No | TTL (seconds) for admin stats cache. |
| **Rate Limiting** | | | | | |
| `RATE_LIMIT_AUTH_WINDOW_MS` | No | `900000` | Number (>0) | No | Window (ms) for auth rate limit. Default 15 min. |
| `RATE_LIMIT_AUTH_MAX` | No | `10` | Number (>0) | No | Max login attempts per window. |
| `RATE_LIMIT_AUTH_REFRESH_WINDOW_MS` | No | `900000` | Number (>0) | No | Window (ms) for token refresh rate limit. |
| `RATE_LIMIT_AUTH_REFRESH_MAX` | No | `30` | Number (>0) | No | Max token refresh attempts per window. |
| `RATE_LIMIT_USER_WINDOW_MS` | No | `60000` | Number (>0) | No | Window (ms) for general user rate limit. Default 1 min. |
| `RATE_LIMIT_USER_MAX` | No | `30` | Number (>0) | No | Max requests per user per window. |
| `RATE_LIMIT_DISPUTE_WINDOW_MS` | No | `3600000` | Number (>0) | No | Window (ms) for dispute submission rate limit. Default 1 hour. |
| `RATE_LIMIT_DISPUTE_MAX` | No | `5` | Number (>0) | No | Max dispute submissions per window. |
| **Admin Operation Quotas** | | | | | |
| `ADMIN_QUOTA_CLAWBACK_WINDOW_MS` | No | `3600000` | Number (>0) | No | Window (ms) for clawback quota. Default 1 hour. |
| `ADMIN_QUOTA_CLAWBACK_MAX` | No | `10` | Number (>0) | No | Max clawback operations per window. |
| `ADMIN_QUOTA_TRADE_BATCH_WINDOW_MS` | No | `3600000` | Number (>0) | No | Window (ms) for batch trade quota. Default 1 hour. |
| `ADMIN_QUOTA_TRADE_BATCH_MAX` | No | `20` | Number (>0) | No | Max batch trade operations per window. |
| **Path Payments** | | | | | |
| `QUOTE_CACHE_TTL_SECONDS` | No | `30` | Number (>0) | No | TTL (seconds) for path payment quote cache. |
| `QUOTE_MAX_SLIPPAGE_BPS` | No | `500` | Number (0-10000) | No | Maximum slippage (BPS) for path payments. Default 5%. |
| **Reconciliation** | | | | | |
| `RECONCILIATION_WARNING_THRESHOLD_BPS` | No | `100` | Number (≥0) | No | BPS deviation threshold for warnings (1%). |
| `RECONCILIATION_CRITICAL_THRESHOLD_BPS` | No | `1000` | Number (≥0) | No | BPS deviation threshold for critical alerts (10%). |
| `RECONCILIATION_CRON_ENABLED` | No | `true` | Boolean | No | Enable daily reconciliation cron job. |
| **PII Scanner** | | | | | |
| `PII_SCANNER_CRON_ENABLED` | No | `true` | Boolean | No | Enable periodic PII leak scanner. |
| `PII_SCANNER_SAMPLE_SIZE` | No | `2000` | Number (>0) | No | Number of logs to sample per scan. |

### Backend Usage

```bash
# Copy example file
cp backend/.env.example backend/.env

# Edit with your values
nano backend/.env

# Start server (env validated at boot)
npm run dev
```

Production must have all required secrets and a tracing backend configured.

---

## Frontend (Next.js)

Environment variables for the Next.js frontend application. These are injected at build time and **must be prefixed with `NEXT_PUBLIC_`** to be accessible in the browser.

| Variable | Required? | Default | Type | Secret? | Description |
|----------|-----------|---------|------|---------|-------------|
| **API & Backend** | | | | | |
| `NEXT_PUBLIC_API_URL` | No | `http://localhost:4000` | String (URL) | No | Backend API base URL. Used for all fetch requests. |
| `NEXT_PUBLIC_API_VERSION_PREFIX` | No | `/api/v1` | String | No | API version prefix (`/api/v1` for versioned, empty for legacy). |
| **Stellar Network** | | | | | |
| `NEXT_PUBLIC_STELLAR_NETWORK` | No | `testnet` | Enum: `testnet`, `mainnet` | No | Stellar network for wallet operations. |
| `NEXT_PUBLIC_RPC_URL` (deprecated) | No | — | String (URL) | No | Deprecated: use `NEXT_PUBLIC_STELLAR_RPC_URL`. |
| `NEXT_PUBLIC_STELLAR_RPC_URL` | No | `https://soroban-testnet.stellar.org` | String (URL) | No | Soroban RPC endpoint for contract calls. |
| **Contract IDs** | | | | | |
| `NEXT_PUBLIC_CONTRACT_ID` | Yes | — | String (contract ID) | No | Soroban escrow contract ID. Format: `C...` (56 chars). |
| **Wallet Integration** | | | | | |
| `NEXT_PUBLIC_FREIGHTER_ENABLED` | No | `true` | Boolean | No | Enable Freighter wallet integration. |
| `NEXT_PUBLIC_ALBEDO_URL` | No | `https://albedo.link` | String (URL) | No | Albedo wallet integration URL. |
| **Supabase** | | | | | |
| `NEXT_PUBLIC_SUPABASE_URL` | No | — | String (URL) | No | Supabase project URL for client auth/metadata. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | No | — | String | No | Supabase anonymous key (safe to expose in browser). |
| **Admin UI** | | | | | |
| `NEXT_PUBLIC_ADMIN_WALLETS` | No | — | String (comma-separated keys) | No | Stellar public keys allowed to see admin UI. Should match backend `ADMIN_STELLAR_PUBKEYS`. |
| **Pinata** | | | | | |
| `PINATA_JWT` | No | — | String | Yes | Pinata JWT for client-side evidence uploads. |
| `PINATA_GATEWAY_URL` | No | — | String (URL) | No | Custom Pinata gateway URL (if using private gateway). |

### Frontend Usage

```bash
# Copy example file
cp frontend/.env.example frontend/.env.local

# Edit with your values
nano frontend/.env.local

# Build includes env at build time
npm run build

# Or run dev server
npm run dev
```

**Note:** Only `NEXT_PUBLIC_*` variables are accessible in the browser. Other secrets must go in backend.

---

## Mobile (React Native / Expo)

Environment variables for the Expo mobile app. Variables must be prefixed with `EXPO_PUBLIC_` to be accessible at runtime.

| Variable | Required? | Default | Type | Secret? | Description |
|----------|-----------|---------|------|---------|-------------|
| **API & Backend** | | | | | |
| `EXPO_PUBLIC_API_URL` | No | `http://localhost:4000` | String (URL) | No | Backend API base URL. |
| `EXPO_PUBLIC_API_VERSION_PREFIX` | No | `/api/v1` | String | No | API version prefix (`/api/v1` for versioned, empty for legacy). |
| **Stellar Network** | | | | | |
| `EXPO_PUBLIC_STELLAR_NETWORK` | No | `testnet` | Enum: `testnet`, `mainnet` | No | Stellar network (testnet or public mainnet). |
| **Analytics** | | | | | |
| `EXPO_PUBLIC_ANALYTICS_ENABLED` | No | `true` | Boolean | No | Enable analytics tracking. |
| **Push Notifications** | | | | | |
| `EXPO_PUBLIC_PUSH_PROVIDER` | No | `expo` | String | No | Push notification provider (e.g., `expo`, `fcm`). |

### Mobile Usage

```bash
# Copy example file
cp mobile/.env.example mobile/.env.local

# Edit with your values
nano mobile/.env.local

# Start dev server
npm start

# Or run on device
npx expo run:ios    # or run:android
```

---

## Contracts (Rust/Soroban)

Smart contracts are compiled and deployed independently. No runtime environment variables are used; contract IDs are passed to backend/frontend via their respective `*_CONTRACT_ID` variables.

---

## Development Checklist

When setting up a new environment:

### ✅ Backend

- [ ] Copy `backend/.env.example` → `backend/.env`
- [ ] Set `DATABASE_URL` (PostgreSQL)
- [ ] Set `JWT_SECRET` (≥32 chars, random)
- [ ] Set `ADMIN_SECRET_KEY` (Stellar secret key)
- [ ] Set `AMANA_ESCROW_CONTRACT_ID` (from deployed contract)
- [ ] Set `USDC_CONTRACT_ID` (from deployed contract)
- [ ] Optionally: set Pinata keys for IPFS uploads
- [ ] Optionally: set tracing backend (for production)
- [ ] Run `npm ci && npm run dev`

### ✅ Frontend

- [ ] Copy `frontend/.env.example` → `frontend/.env.local`
- [ ] Set `NEXT_PUBLIC_CONTRACT_ID` (match backend's `AMANA_ESCROW_CONTRACT_ID`)
- [ ] Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (if using)
- [ ] Run `npm ci && npm run dev`

### ✅ Mobile

- [ ] Copy `mobile/.env.example` → `mobile/.env.local`
- [ ] Set `EXPO_PUBLIC_API_URL` (match backend URL)
- [ ] Run `npm ci && npm start`

---

## CI Validation

All `.env.example` files are validated in CI to ensure:

1. No unknown or misspelled keys.
2. All required (no-default) variables are documented.
3. Non-secret values are well-formed.
4. Production examples satisfy production requirements (e.g., tracing backend).

Run validation locally:

```bash
# Backend validation
cd backend
pnpm tsx scripts/validate-env-examples.ts

# Frontend & Mobile: CI only (no validation script yet)
```

---

## Secrets Management

### Secret Env Keys (Backend)

Never logged or echoed in diagnostics:

- `JWT_SECRET` — JWT signing key
- `ADMIN_SECRET_KEY` — Stellar signing key for admin ops
- `IPFS_URL_SIGNING_SECRET` — IPFS gateway URL signing key
- `WEBHOOK_SECRET` — Outbound webhook signing secret
- `ALERT_WEBHOOK_SECRET` — Alert webhook signing secret
- `SUPABASE_SERVICE_ROLE_KEY` — Supabase backend auth
- `AUDIT_SIGNING_PRIVATE_KEY_PEM` — Ed25519 private key
- `AUDIT_SIGNING_PUBLIC_KEY_PEM` — Ed25519 public key
- `PINATA_SECRET` — Pinata API secret (legacy)
- `PINATA_JWT` — Pinata JWT token
- `PINATA_API_KEY` — Pinata API key

### Secret Env Keys (Frontend/Mobile)

Accessible in browser (non-secret):

- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Safe to expose; limited permissions
- `PINATA_JWT` — Limited-scope Pinata token for uploads

### Rotation & Deprecation

See [`docs/secrets-policy.md`](./secrets-policy.md) for:

- Secret inventory and ownership
- Automated rotation reminders
- Verification procedures
- Max age policies

---

## Examples

### Local Development (Backend + Frontend)

**backend/.env:**
```
NODE_ENV=development
PORT=4000
JWT_SECRET=your-secret-key-must-be-at-least-32-characters-long
ADMIN_SECRET_KEY=SXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
DATABASE_URL=postgresql://user:password@localhost:5432/amana
STELLAR_NETWORK=testnet
AMANA_ESCROW_CONTRACT_ID=CXXXXXX...
USDC_CONTRACT_ID=CYYYYYY...
```

**frontend/.env.local:**
```
NEXT_PUBLIC_API_URL=http://localhost:4000
NEXT_PUBLIC_STELLAR_NETWORK=testnet
NEXT_PUBLIC_CONTRACT_ID=CXXXXXX...
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGc...
```

### Production (Minimal, Staging)

**backend/.env.staging:**
```
NODE_ENV=staging
PORT=4000
JWT_SECRET=***REDACTED*** (use strong random)
ADMIN_SECRET_KEY=***REDACTED*** (Stellar key)
DATABASE_URL=***REDACTED*** (production Postgres)
STELLAR_NETWORK=testnet
AMANA_ESCROW_CONTRACT_ID=CXXXXXX...
USDC_CONTRACT_ID=CYYYYYY...
JAEGER_ENDPOINT=http://jaeger:16686  (required for staging/prod)
PINATA_JWT=***REDACTED***
```

---

## Troubleshooting

### Backend Won't Start

1. Check for validation errors: `npm run dev` prints a detailed report
2. Ensure all required variables are set (e.g., `JWT_SECRET`, `AMANA_ESCROW_CONTRACT_ID`)
3. Verify secret values (JWT_SECRET ≥32 chars, contract IDs match deployed contracts)
4. In production, ensure a tracing backend is configured

### Frontend Build Fails

1. Ensure all `NEXT_PUBLIC_*` variables are set in `.env.local`
2. Check that `NEXT_PUBLIC_API_URL` is reachable
3. Verify contract ID matches deployed contract

### Secrets Leaked in Logs

Backend secrets are automatically redacted in diagnostic output. If a secret appears in logs:

1. Rotate the affected secret immediately
2. Search logs for the old secret value and remove entries
3. Review `SECRET_ENV_KEYS` in `backend/src/config/env.ts` for new secret types

---

## Related Documentation

- [Env Validation (fail-fast design)](./env-validation.md) — how env is validated at boot
- [Secrets Policy](./secrets-policy.md) — rotation, inventory, max-age
- [PII Encryption at Rest](./pii-encryption.md) — encrypted columns, access logging
- [Threat Model](./threat-model.md) — security analysis including env/secrets handling

