# IPFS Pinning Credential Rotation Runbook

Step-by-step procedure for safely rotating the Pinata IPFS pinning API key in production, staging, and development environments. Companion docs: [secrets-policy.md](../secrets-policy.md) (secrets inventory, detection, and incident procedures) and [admin-secret-rotation.md](../admin-secret-rotation.md) (example zero-downtime rotation pattern for reference).

---

## 1. Overview & Scope

The `PINATA_JWT` credential is used by the Amana backend and frontend to authenticate with Pinata's pinning service for storing and retrieving video evidence of goods during dispute resolution.

### Rotation Frequency
- **Scheduled**: Every 180 days.
- **Unscheduled / Emergency**: Immediately upon suspected compromise, accidental exposure, or credential leak alert.

### Impact of Credential Compromise
- An attacker could upload malicious video evidence or modify existing pins.
- Video evidence could be deleted, breaking dispute resolution chains.
- Account quotas could be exceeded, causing legitimate evidence uploads to fail.

---

## 2. Pre-Rotation Checklist

Before initiating rotation:

1. **Backup Pins**: Export a list of all pinned content from Pinata dashboard for recovery reference.
   ```bash
   curl --request GET "https://api.pinata.cloud/data/pinList" \
     -H "Authorization: Bearer $PINATA_JWT" | jq . > pinned-hashes-backup.json
   ```

2. **Verify Current Key Status**: Confirm the old key is still active and functional.
   ```bash
   # Attempt a test pin or metadata query
   curl --request GET "https://api.pinata.cloud/data/pinList?limit=1" \
     -H "Authorization: Bearer $PINATA_JWT"
   ```

3. **Notify Team**: Alert backend and frontend teams that a rotation is starting. No action required on their part, but confirm there are no pending upload operations.

4. **Check CI/CD**: Ensure all tests are green in `.github/workflows/ci.yml` and no deployments are in progress.

---

## 3. Generate New Pinata JWT

### Step 1: Access Pinata Dashboard

1. Log in to the Pinata dashboard: https://app.pinata.cloud/
2. Navigate to **API Keys** (typically under Settings or Account menu).
3. Confirm you have administrative permissions to generate new keys.

### Step 2: Create New JWT

1. Click **+ New Key**.
2. Name the key descriptively: `amana-rotation-<date>` (e.g., `amana-rotation-2026-09-26`).
3. Select scopes:
   - `pinning:pinFileToIPFS` — required for uploading video evidence.
   - `pinning:unpin` — required for cleanup operations (if implemented).
   - `pinning:hashMetadata` — required for retrieving pin metadata.
4. **DO NOT** grant admin scopes (`admin:*`) unless strictly necessary.
5. Set key **expiration** to 90 days (or your organization's secret rotation max age).
6. Click **Generate**.
7. Copy the new JWT immediately. **You will not be able to view it again**.

### Step 3: Store New Key Securely

Store the new JWT in your secret management system **before** decommissioning the old key:

**If using AWS Secrets Manager:**
```bash
aws secretsmanager create-secret \
  --name amana/pinata-jwt-next \
  --secret-string "new-jwt-value" \
  --region us-east-1
```

**If using Kubernetes Secrets:**
```bash
kubectl create secret generic amana-pinata-secrets \
  --from-literal=PINATA_JWT_NEXT="new-jwt-value" \
  --dry-run=client -o yaml | kubectl apply -f -
```

**If using environment files (.env):**
```bash
# Temporarily store in a secure location (not committed to git)
echo "PINATA_JWT_NEXT=new-jwt-value" > /tmp/pinata-new-jwt.env
```

---

## 4. Dual-JWT Acceptance Window (Zero-Downtime Pattern)

To avoid disrupting in-flight uploads, the backend and frontend should accept both the old and new JWT during the rotation window.

### Step 1: Deploy New JWT as Secondary

Update your deployment configuration to accept the new JWT alongside the old one:

**Backend Configuration (backend/.env or K8s secret):**
```env
PINATA_JWT=old-jwt-value
PINATA_JWT_NEXT=new-jwt-value
```

**Code Pattern** (if not already implemented):
The backend's IPFS service should attempt authentication with `PINATA_JWT_NEXT` first; if it fails or is not set, fall back to `PINATA_JWT`:

```typescript
// Example in backend/src/services/ipfs.service.ts
const jwt = process.env.PINATA_JWT_NEXT || process.env.PINATA_JWT;
const pinataClient = new PinataClient({ jwt });
```

### Step 2: Deploy and Monitor

1. Deploy the updated configuration to staging first:
   ```bash
   cd backend
   npm ci
   npm run build
   # Deploy dist/ with both PINATA_JWT and PINATA_JWT_NEXT set
   ```

2. Monitor for errors in staging logs:
   ```bash
   # Tail backend logs for IPFS-related errors
   kubectl logs -f deployment/backend --tail=100 | grep -i ipfs
   ```

3. Perform a test upload in staging:
   ```bash
   curl -X POST http://localhost:4000/health/ready -H "Authorization: Bearer test-token"
   # Confirm no IPFS auth errors in response
   ```

4. If staging is healthy, deploy to production using the same pattern.

### Step 3: Promote New JWT to Primary

Once all instances are running with dual-JWT acceptance and no errors are detected:

1. Update configuration to make `PINATA_JWT_NEXT` the primary:
   ```env
   PINATA_JWT=new-jwt-value
   PINATA_JWT_NEXT=old-jwt-value
   ```

2. Trigger a rolling deployment:
   ```bash
   kubectl rollout restart deployment/backend -n default
   kubectl rollout status deployment/backend -n default --timeout=2m
   ```

3. Monitor the rollout:
   ```bash
   kubectl get pods -w
   ```

---

## 5. Retire Old JWT

### Step 1: Confirm Stability

Wait at least 30 minutes after the deployment completes, then verify:

1. No IPFS auth errors in logs:
   ```bash
   kubectl logs -f deployment/backend --tail=200 | grep -i "auth\|403\|unauthorized"
   ```

2. Backend health checks are green:
   ```bash
   curl https://<backend-host>/health/ready
   curl https://<backend-host>/health/startup
   ```

3. Recent uploads are in IPFS:
   ```bash
   # Query a recent evidence record and verify IPFS hash is accessible
   curl "https://gateway.pinata.cloud/ipfs/<hash>" -I
   ```

### Step 2: Revoke Old JWT in Pinata

1. Log in to Pinata dashboard.
2. Navigate to **API Keys**.
3. Find the old key (e.g., `amana-rotation-<old-date>`).
4. Click **Revoke** or **Delete**.
5. Confirm the action.

### Step 3: Remove Old JWT from Configuration

Once revoked, remove the old JWT from your secret stores:

**AWS Secrets Manager:**
```bash
aws secretsmanager delete-secret \
  --secret-id amana/pinata-jwt-old \
  --force-delete-without-recovery
```

**Kubernetes Secrets:**
```bash
kubectl delete secret amana-pinata-old-secrets
```

**Environment files:**
```bash
rm /tmp/pinata-new-jwt.env
```

### Step 4: Update Configuration to Single JWT

Simplify the backend configuration to use only the new JWT:

```env
PINATA_JWT=new-jwt-value
# Remove PINATA_JWT_NEXT
```

Deploy this change:
```bash
cd backend
npm run build
# Deploy dist/ with only PINATA_JWT set
```

---

## 6. Post-Rotation Verification

1. **Verify All Pins Are Accessible:**
   ```bash
   # Query the list of pins and spot-check a few hashes
   curl --request GET "https://api.pinata.cloud/data/pinList?limit=5" \
     -H "Authorization: Bearer $PINATA_JWT" | jq '.rows[].ipfs_pin_hash'
   
   for hash in $(curl -s -H "Authorization: Bearer $PINATA_JWT" \
     "https://api.pinata.cloud/data/pinList?limit=5" | jq -r '.rows[].ipfs_pin_hash'); do
     echo "Checking $hash..."
     curl -I "https://gateway.pinata.cloud/ipfs/$hash" | grep -E "HTTP|200"
   done
   ```

2. **Confirm Backend IPFS Operations Work:**
   - Upload a test video to staging evidence endpoint.
   - Verify the hash is pinned in Pinata.
   - Retrieve and play the video to confirm accessibility.

3. **Update Secrets Inventory:**
   Record the rotation completion date in [`backend/scripts/secrets-rotation-status.json`](../../backend/scripts/secrets-rotation-status.json):
   ```json
   {
     "PINATA_JWT": {
       "lastRotated": "2026-09-26T16:34:00Z",
       "maxAge": 15552000,
       "rotatedBy": "your-github-handle"
     }
   }
   ```

4. **CI Verification:**
   - All `.github/workflows/ci.yml` gates pass.
   - `./scripts/verify-secrets-rotation.sh` shows `PINATA_JWT` as current.

---

## 7. Rollback Procedure

If post-rotation issues arise (e.g., uploads fail, auth errors spike, access to pinned content is lost):

### Immediate Actions

1. **Restore Old JWT in Configuration:**
   ```bash
   # Update to temporarily use old JWT (if still available)
   export PINATA_JWT="old-jwt-value"
   kubectl create secret generic amana-pinata-secrets \
     --from-literal=PINATA_JWT="old-jwt-value" \
     --dry-run=client -o yaml | kubectl apply -f -
   ```

2. **Trigger Rollout:**
   ```bash
   kubectl rollout restart deployment/backend -n default
   kubectl rollout status deployment/backend -n default --timeout=2m
   ```

3. **Verify Health:**
   ```bash
   curl https://<backend-host>/health/ready
   kubectl logs -f deployment/backend --tail=100 | grep -i ipfs
   ```

### Investigation

1. **Check Pinata Status Page:**
   https://status.pinata.cloud/ — confirm no service outages.

2. **Review Error Logs:**
   ```bash
   kubectl logs deployment/backend --tail=500 | grep -A 5 "pinata\|ipfs\|auth"
   ```

3. **Open Incident:**
   If a rollback was necessary, open a security/operational incident issue and document what failed, why, and what steps prevented recurrence.

---

## 8. Troubleshooting

| Issue | Cause | Resolution |
|-------|-------|-----------|
| `401 Unauthorized` in logs | JWT is invalid, expired, or revoked. | Verify the new JWT is correctly stored and deployed. |
| `403 Forbidden` in logs | JWT lacks required scopes (e.g., `pinning:pinFileToIPFS`). | Regenerate key with all required scopes. |
| IPFS hash returns `404` on gateway | Pin was deleted or expired. | Check Pinata quota and retention settings. Re-upload if needed. |
| Uploads timeout after rotation | Pinata backend latency or quota exceeded. | Check Pinata dashboard for account status; confirm quotas. |
| Old JWT still works after revocation | Cache propagation delay at CDN or load balancer. | Clear caches; wait 5 minutes; retry. |

---

## 9. Runbook Maintenance

This runbook should be reviewed and updated:
- **Quarterly**: Alongside the threat model review (see [threat-model-review-checklist.md](../threat-model-review-checklist.md)).
- **On Pinata API Changes**: If Pinata's authentication mechanism or API changes.
- **After Each Rotation**: Document lessons learned and update steps as needed.

Last updated: [TBD by reviewer]  
Last rotation: [TBD by operator]
