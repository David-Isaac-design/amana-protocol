# Incident Communication Templates (Pilot Users)

Ready-to-send messages for pilot users during an incident. Used by the
**Comms** role in the [incident response runbook](./incident-response.md#immediate-response-steps).
Copy, fill in the `{placeholders}`, and send. Don't write messages from scratch
under pressure.

## Rules for every message

- **Say what users can and can't do right now.** Skip internal causes and jargon ("RPC", "migration", "5xx").
- **Never ask for a recovery phrase, private key or payment.** Every template ends by saying so, because scammers copy outage messages.
- **Only send the funds-safe message when it is confirmed true.** If funds might be affected, it is a P0: the IC and eng lead approve the wording before it goes out.
- **Give a time for the next update and keep it.** Send an update even if nothing has changed.
- **Use one channel per audience.** Use SMS/WhatsApp for affected users and email for everyone, and add the same text to the incident tracking issue.
- **Keep SMS under 160 characters.** The SMS versions below fit.

| Situation | Template | When to send |
|---|---|---|
| Service down | [Outage](#1-outage) | P0/P1: users can't create, fund, confirm or release trades |
| Partly working | [Degraded service](#2-degraded-service) | P1/P2: slow, or one feature (e.g. evidence upload) failing |
| Reassurance | [Funds are safe](#3-funds-are-safe) | Any incident where users may worry about locked funds, **once confirmed** |
| Fixed | [Resolved](#4-resolved) | After the [stand-down criteria](./incident-response.md#stand-down-criteria) are met |

---

## 1. Outage

**SMS**

```
Amana: We're having an outage. Trades can't be created or updated right now. Your funds stay locked in escrow. Next update by {time}.
```

**WhatsApp**

```
⚠️ *Amana service outage*

Since {start time}, you can't {create trades / fund, confirm or release trades} in Amana. We are working on it now.

What this means for you:
• Please don't retry payments until we confirm the service is back.
• Funds already in escrow stay locked in the smart contract.

Next update by {time}. Amana will never ask for your recovery phrase or private key.
```

**Email**

- Subject: `Amana service outage — we're working on it`

```
Hello,

Since {start time} {timezone}, Amana is unavailable: you can't {create trades / fund, confirm or release trades}.

What this means for you:
- Please don't retry payments until we confirm the service is back. This avoids duplicate transactions.
- Funds already in escrow stay locked in the smart contract. Nobody can move them while the service is down.

We will send the next update by {time} {timezone}, or sooner if it is fixed.

Questions: reply to this email or write to {support email}.
Amana will never ask for your recovery phrase, private key or a payment to "unlock" funds.

The Amana team
```

## 2. Degraded service

**SMS**

```
Amana: {feature} is slow or failing right now. Other features work. Funds in escrow are unaffected. Next update by {time}.
```

**WhatsApp**

```
🟡 *Amana: some features are affected*

Since {start time}, {feature, e.g. uploading evidence videos} is {slow / failing}. Everything else works normally.

{Workaround, e.g. "If an upload fails, wait 15 minutes and try again. Your dispute window is not affected."}

Next update by {time}. Amana will never ask for your recovery phrase or private key.
```

**Email**

- Subject: `Amana: {feature} is currently degraded`

```
Hello,

Since {start time} {timezone}, {feature} is {slow / failing for some users}. Everything else in Amana works normally.

What you can do:
- {Workaround}
- {If deadlines are involved: "Trades affected by this issue will not be penalised for missing a deadline. We will extend them if needed."}

Funds in escrow are not affected.

Next update by {time} {timezone}.

Questions: {support email}. Amana will never ask for your recovery phrase or private key.

The Amana team
```

## 3. Funds are safe

> Send only after the IC confirms: no escrow balance moved unexpectedly, and
> no admin key is suspected compromised. Otherwise hold, and escalate per the
> [escalation matrix](./incident-response.md#escalation-matrix).

**SMS**

```
Amana: Your funds are safe. Money in escrow is held by the smart contract and was not affected by today's issue. No action needed.
```

**WhatsApp**

```
🔒 *Your funds are safe*

We've checked: money in escrow was *not affected* by today's issue. It stays locked in the smart contract until the trade is completed or a dispute is resolved. Nobody, including the Amana team, can send it anywhere else.

You don't need to do anything. Amana will never ask you to move funds, share your recovery phrase, or pay to "unlock" a trade.
```

**Email**

- Subject: `Your Amana funds are safe`

```
Hello,

We know outages are worrying when money is involved, so to be clear: funds held in Amana escrow were not affected by {today's / the {date}} issue.

Escrowed funds are held by a smart contract on the Stellar network. They can only be released to the buyer or seller of the trade, when delivery is confirmed or a dispute is resolved.

You don't need to take any action. If anyone contacts you claiming to be Amana and asks for your recovery phrase, private key, or a payment to "unlock" funds, it is a scam. Please report it to {support email}.

The Amana team
```

## 4. Resolved

**SMS**

```
Amana: Resolved. All features are working again as of {time}. Funds in escrow were not affected. Thank you for your patience.
```

> Drop "Funds in escrow were not affected" from any resolved message unless the
> funds-safe confirmation above was actually made.

**WhatsApp**

```
✅ *Resolved*

Amana is working normally again as of {time}. {What users should do now, e.g. "If a trade action failed during the outage, please try it again." / "No action needed."}

Funds in escrow were not affected. Thank you for your patience.
```

**Email**

- Subject: `Resolved: Amana is working normally again`

```
Hello,

The issue that affected {feature / Amana} from {start time} to {end time} {timezone} is resolved.

What happened: {one plain-language sentence, e.g. "A faulty update stopped trade releases from being processed. We reversed it."}

What you should do: {"Nothing" / "If you tried to {action} during this time, please try again."}

{Funds in escrow were not affected.}

We are reviewing what happened so it doesn't happen again. Questions: {support email}.

The Amana team
```
