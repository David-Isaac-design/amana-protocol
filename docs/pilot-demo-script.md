# Pilot Demo Script

This is a step-by-step walkthrough for demoing Amana to pilot users and partners. Follow it
exactly so every demo covers the same steps in the same order. It takes about
**20 minutes**: 5 for setup and 15 for the demo.

The demo covers four roles:

| Role | Who plays it | Account |
|---|---|---|
| **Seller** | Presenter, browser profile A | Seeded `Demo Seller — Kano Grains Co-op` |
| **Buyer** | Presenter, browser profile B | Seeded `Demo Buyer — Lagos Foods Ltd` |
| **Driver** | No login. The seller enters the driver's details on the manifest | n/a |
| **Mediator** | Presenter, browser profile C | Seeded `Demo Mediator` (must be on the mediator allowlist) |

> Use three separate browser profiles, each with Freighter on **Testnet**, so you
> can switch roles without disconnecting wallets mid-demo.

---

## Part 1: Setup (once per demo environment)

### 1.1 Create three testnet wallets

```bash
# Stellar CLI: generates and funds each key on testnet
stellar keys generate demo-seller --network testnet --fund
stellar keys generate demo-buyer --network testnet --fund
stellar keys generate demo-mediator --network testnet --fund

stellar keys address demo-seller     # G... seller address
stellar keys address demo-buyer      # G... buyer address
stellar keys address demo-mediator   # G... mediator address
```

Import each secret (`stellar keys show <name>`) into Freighter in its own browser
profile. Make sure the **buyer** wallet holds enough of the trade token (cNGN/USDC
on testnet) for the demo trade (**100**).

### 1.2 Configure the backend

In `backend/.env`:

```bash
# The mediator console only opens for allowlisted addresses
ADMIN_STELLAR_PUBKEYS=<mediator G... address>

# Seeded demo accounts (#128). Without these, placeholder addresses are used
# and you won't be able to sign in as the demo users.
DEMO_SELLER_ADDRESS=<seller G... address>
DEMO_BUYER_ADDRESS=<buyer G... address>
DEMO_MEDIATOR_ADDRESS=<mediator G... address>

# Optional: shows the pilot trade cap in step 2.3 (#127)
PILOT_MAX_TRADE_AMOUNT_USDC=500
```

In `frontend/.env.local`, set `NEXT_PUBLIC_ADMIN_WALLETS=<mediator G... address>` so
the mediator sees the admin/mediator navigation.

### 1.3 Seed and start

```bash
cd backend
npx prisma migrate deploy
npm run seed          # re-run before every demo; the demo data is idempotent
npm run dev

cd ../frontend
npm run dev           # http://localhost:3000
```

The seed prints a `Pilot demo:` block. Check that it lists your three addresses
(lowercased) and the trades `demo_funded` and `demo_disputed`.

| Seeded trade | Status | Used in |
|---|---|---|
| `demo_funded` | FUNDED | Backup for step 3 if on-chain funding is slow |
| `demo_disputed` | DISPUTED, with a dispute "3 of 20 bags arrived water-damaged" | Backup for step 5 if you skip the live dispute |

### 1.4 Pre-flight check (2 minutes before the audience joins)

- [ ] `curl http://localhost:4000/health/ready` returns 200
- [ ] Each browser profile is connected to the right wallet in Freighter, on **Testnet**
- [ ] The buyer wallet has at least 100 of the trade token plus some XLM for fees
- [ ] Profile C (mediator) can open `/mediator/disputes`

---

## Part 2: The demo

Say the **bold lines** out loud. Actions are in normal text.

### Step 1: The problem (1 min, no clicks)

**"Farmers ship produce on trust. Buyers pay late or not at all, and when goods arrive damaged, nobody agrees who pays. Amana holds the payment in a smart contract until delivery, and settles damage with a split both sides agreed up front."**

### Step 2: Buyer creates the trade (3 min, profile B)

1. Open `http://localhost:3000`, connect the wallet and sign the login challenge.
2. Go to **Trades → Create trade**.
3. *(Optional, if the pilot cap is set)* Enter **1000** as the amount and continue to review.
   Point out the message: *"Trade amount exceeds the pilot limit of 500 USDC…"*
   **"During the pilot, trade size is capped to limit risk."** Change the amount to **100**.
4. Enter the **seller address** (from 1.1), amount **100**, and a loss split of **50 / 50**.
   **"The loss ratio is agreed now, before anything goes wrong. If the goods are damaged, this is how the loss is shared."**
5. Review and sign the transaction in Freighter. Open the new trade page.

### Step 3: Buyer funds the escrow (2 min, profile B)

1. On the trade page, click the deposit action and sign in Freighter.
2. The status changes to **FUNDED**.
   **"The money has left the buyer, but the seller doesn't have it yet. It's locked in the contract, and nobody, including us, can take it."**

> If testnet is slow, switch to the seeded `demo_funded` trade and carry on.

### Step 4: Seller dispatches with the driver's manifest (3 min, profile A)

1. Switch to profile A (seller) and open **Vault** from the top navigation.
2. Under **Driver/Vehicle Manifest**, click **Log Driver Details**. The form attaches to the seller's most recent
   FUNDED or DELIVERED trade, so this is the trade from step 3. Fill in the details
   for the **driver** role:
   - Driver Name: `Amina Khalid`
   - Driver Phone: `+234 803 000 0000`
   - License Plate: `GEG 1123 H`
3. Submit and sign the transaction in Freighter.
   **"The driver's identity is recorded against this shipment. Their name and ID number are hashed, so we can prove who carried the goods without exposing personal data."**

### Step 5: Delivery, the happy path or a dispute (4 min, profile B)

Pick **one** path for the audience. Path B is recommended because it shows the mediator.

**Path A: goods arrive fine**

1. Buyer clicks **Confirm Delivery** and signs.
2. Seller (profile A) clicks **Release Funds** and signs. The seller receives the funds minus the platform fee.
   **"The seller is paid the moment the buyer is satisfied. No invoices, no chasing."**

**Path B: goods arrive damaged**

1. Buyer clicks **Initiate Dispute** and enters a reason of at least 10 characters, e.g. `3 of 20 bags arrived water-damaged`.
2. Attach the evidence video if prompted.
   **"In a real delivery, the buyer films the damage with the driver present, so the driver affirms the condition of the goods on camera."**
3. The status changes to **DISPUTED**. Funds stay locked.

> To skip the live dispute, use the seeded `demo_disputed` trade in step 6.

### Step 6: Mediator resolves the dispute (3 min, profile C)

1. Switch to profile C (mediator) and open **`/mediator/disputes`**.
2. Open the disputed trade and click **Mediator Panel**. Show the evidence preview.
3. Click **Resolve Dispute**, choose the seller's share (e.g. 50%, the agreed loss ratio), and click **Confirm Resolution**. Sign in Freighter.
   **"The mediator can't send the money anywhere else. They can only choose how it is split between the buyer and the seller."**

### Step 7: Wrap-up (1 min)

- Open **Help** in the top navigation (`/help`) to show where pilot users find answers about fees, disputes and cNGN, and how to contact support.
- **"That's the full loop: agree, lock, dispatch, deliver, settle."**

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Mediator can't open `/mediator/disputes` (403) | The mediator address isn't in `ADMIN_STELLAR_PUBKEYS`. Restart the backend after changing it |
| Seeded trades don't show for the buyer or seller | `DEMO_*_ADDRESS` wasn't set before `npm run seed`. Set it and re-run the seed |
| "Trade amount exceeds the pilot limit" when you didn't expect it | Lower the amount, unset `PILOT_MAX_TRADE_AMOUNT_USDC`, or disable the `pilot_trade_cap` feature flag |
| Freighter shows the wrong network | Switch Freighter to **Testnet** in each profile |
| Transaction stuck or failing | Check the buyer has XLM for fees, then fall back to the seeded trades |
