import crypto from "crypto";
import { Prisma, PrismaClient, PayoutIntent, PayoutIntentStatus, PayoutKind } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { appLogger } from "../middleware/logger";
import { recordPayoutIntentOutcome } from "../lib/metrics";
import {
  CursorPageResult,
  decodeCursor,
  encodeCursor,
} from "../lib/cursorPagination";

/**
 * Idempotent execution of fund-moving contract calls.
 *
 * A release or refund can succeed on-chain and then fail before the DB commit —
 * the process dies, the connection drops, the transaction rolls back. A client
 * or job retry then looks like a brand-new request and pays out a second time.
 * For an escrow protocol that is direct fund loss, so the guard has to survive a
 * crash at any point in the window.
 *
 * The durable record is written *before* the transaction is built, and the
 * `idempotencyKey` unique constraint does the enforcing: a concurrent duplicate
 * loses at the database, not in application logic that a crash could skip.
 */

/** Statuses a retry must not re-submit against. */
const TERMINAL_STATUSES: readonly PayoutIntentStatus[] = ["CONFIRMED"];

/** Statuses the reconciliation sweep still has to resolve against the chain. */
const UNRESOLVED_STATUSES: readonly PayoutIntentStatus[] = ["PENDING", "SUBMITTED"];

export interface PayoutIntentInput {
  /**
   * Caller-supplied idempotency key. Omit to derive a deterministic one from
   * the payout's identity, so a retry that forgets the header is still
   * recognised as the same payout.
   */
  idempotencyKey?: string;
  kind: PayoutKind;
  tradeId: string;
  milestoneIndex?: number | null;
  amountUsdc: string;
  destination: string;
  requestedBy: string;
}

export interface PayoutIntentResult {
  intent: PayoutIntent;
  /**
   * True when this call found an existing intent rather than creating one. The
   * caller must not build or submit another transaction — return the recorded
   * result instead.
   */
  duplicate: boolean;
}

/** Raised when a retry arrives for a payout that already settled on-chain. */
export class DuplicatePayoutError extends Error {
  constructor(
    readonly intent: PayoutIntent,
  ) {
    super(
      `Payout ${intent.idempotencyKey} already completed on-chain${
        intent.txHash ? ` as ${intent.txHash}` : ""
      }`,
    );
    this.name = "DuplicatePayoutError";
  }
}

/** Prisma's unique-constraint violation. */
function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
  );
}

/**
 * Derives a stable key from the payout's identity.
 *
 * Two requests describing the same payout hash to the same key, so a retry that
 * omits the `Idempotency-Key` header still collides with the original. The
 * amount is included: changing it is a genuinely different payout and must not
 * be silently swallowed as a duplicate.
 */
export function derivePayoutIdempotencyKey(input: PayoutIntentInput): string {
  const parts = [
    input.kind,
    input.tradeId,
    input.milestoneIndex ?? "-",
    input.amountUsdc,
    input.destination.toLowerCase(),
  ].join("|");
  return `derived:${crypto.createHash("sha256").update(parts).digest("hex")}`;
}

export interface PayoutIntentListFilters {
  status?: PayoutIntentStatus;
  /** Inclusive lower bound on `createdAt`. */
  from?: Date;
  /** Inclusive upper bound on `createdAt`. */
  to?: Date;
  /** Opaque cursor from a previous page's `pageInfo.nextCursor`. */
  cursor?: string;
  limit: number;
}

export class PayoutIntentService {
  constructor(private readonly prisma: PrismaClient = defaultPrisma) {}

  /**
   * Claims the right to execute a payout.
   *
   * Call this before building or submitting anything. On a fresh payout it
   * writes a `PENDING` intent and returns `duplicate: false`. On a retry it
   * returns the existing intent with `duplicate: true` and counts the attempt.
   *
   * @param input - The payout's identity and amount.
   * @returns The intent and whether this call was a duplicate.
   * @throws DuplicatePayoutError if the payout already settled on-chain — that
   * is the case that must never reach a second submission.
   */
  async claim(input: PayoutIntentInput): Promise<PayoutIntentResult> {
    const idempotencyKey = input.idempotencyKey ?? derivePayoutIdempotencyKey(input);

    try {
      const intent = await this.prisma.payoutIntent.create({
        data: {
          idempotencyKey,
          kind: input.kind,
          tradeId: input.tradeId,
          milestoneIndex: input.milestoneIndex ?? null,
          amountUsdc: input.amountUsdc,
          destination: input.destination,
          requestedBy: input.requestedBy,
          status: "PENDING",
        },
      });

      recordPayoutIntentOutcome(input.kind, "claimed");
      return { intent, duplicate: false };
    } catch (error) {
      if (!isUniqueViolation(error)) {
        throw error;
      }
      // Someone else got there first — either an earlier request or a
      // concurrent one that won the insert.
      return this.handleExisting(idempotencyKey, input.kind);
    }
  }

  private async handleExisting(
    idempotencyKey: string,
    kind: PayoutKind,
  ): Promise<PayoutIntentResult> {
    const existing = await this.prisma.payoutIntent.update({
      where: { idempotencyKey },
      data: { duplicateAttempts: { increment: 1 } },
    });

    recordPayoutIntentOutcome(kind, "duplicate");
    appLogger.warn(
      {
        idempotencyKey,
        kind,
        tradeId: existing.tradeId,
        status: existing.status,
        txHash: existing.txHash,
        duplicateAttempts: existing.duplicateAttempts,
      },
      "Duplicate payout attempt short-circuited",
    );

    if (TERMINAL_STATUSES.includes(existing.status)) {
      throw new DuplicatePayoutError(existing);
    }

    // PENDING or SUBMITTED: the first attempt may still be in flight, or may
    // have died mid-window. Reconciliation decides; re-submitting here is
    // exactly the double-payout this guard exists to prevent.
    return { intent: existing, duplicate: true };
  }

  /**
   * Records the transaction hash returned by the first successful submission.
   *
   * Writing the hash is what lets reconciliation ask the chain what happened,
   * so it must land before the caller does anything else with the result.
   *
   * @param idempotencyKey - Key of the claimed intent.
   * @param txHash - Soroban transaction hash.
   */
  async recordSubmission(idempotencyKey: string, txHash: string): Promise<PayoutIntent> {
    const intent = await this.prisma.payoutIntent.update({
      where: { idempotencyKey },
      data: { status: "SUBMITTED", txHash, submittedAt: new Date() },
    });
    recordPayoutIntentOutcome(intent.kind, "submitted");
    return intent;
  }

  /**
   * Marks a payout settled. Terminal: any later attempt on this key raises
   * {@link DuplicatePayoutError}.
   *
   * @param idempotencyKey - Key of the submitted intent.
   * @param txHash - Confirmed transaction hash, if it was not recorded at
   * submission time.
   */
  async confirm(idempotencyKey: string, txHash?: string): Promise<PayoutIntent> {
    const intent = await this.prisma.payoutIntent.update({
      where: { idempotencyKey },
      data: {
        status: "CONFIRMED",
        confirmedAt: new Date(),
        ...(txHash ? { txHash } : {}),
      },
    });
    recordPayoutIntentOutcome(intent.kind, "confirmed");
    return intent;
  }

  /**
   * Marks a payout failed so the key can be retried.
   *
   * Only call this once the chain has been checked and the transaction is known
   * not to have applied — releasing the key on an unknown outcome reopens the
   * double-payout window.
   *
   * @param idempotencyKey - Key of the intent.
   * @param reason - Recorded on the intent for operators.
   */
  async fail(idempotencyKey: string, reason: string): Promise<PayoutIntent> {
    const intent = await this.prisma.payoutIntent.update({
      where: { idempotencyKey },
      data: { status: "FAILED", lastError: reason.slice(0, 2000) },
    });
    recordPayoutIntentOutcome(intent.kind, "failed");
    return intent;
  }

  /** Looks an intent up by key. */
  async findByKey(idempotencyKey: string): Promise<PayoutIntent | null> {
    return this.prisma.payoutIntent.findUnique({ where: { idempotencyKey } });
  }

  /**
   * Lists intents newest first with optional status and creation-date filters.
   *
   * @throws InvalidCursorError if `cursor` is malformed.
   */
  async list(filters: PayoutIntentListFilters): Promise<CursorPageResult<PayoutIntent>> {
    const after = decodeCursor(filters.cursor);
    const where: Prisma.PayoutIntentWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.from || filters.to) {
      where.createdAt = {
        ...(filters.from ? { gte: filters.from } : {}),
        ...(filters.to ? { lte: filters.to } : {}),
      };
    }
    if (after) where.id = { lt: after.id };

    const rows = await this.prisma.payoutIntent.findMany({
      where,
      orderBy: { id: "desc" },
      take: filters.limit + 1,
    });

    const hasNextPage = rows.length > filters.limit;
    const items = hasNextPage ? rows.slice(0, filters.limit) : rows;
    const last = items[items.length - 1];

    return {
      items,
      pageInfo: {
        nextCursor: hasNextPage && last ? encodeCursor({ id: last.id }) : null,
        hasNextPage,
        limit: filters.limit,
      },
    };
  }

  /**
   * Intents that have not reached a terminal state, oldest first.
   *
   * @param olderThanMs - Only return intents untouched for at least this long,
   * so an in-flight submission is not reconciled out from under itself.
   * @param limit - Batch size.
   */
  async findUnresolved(olderThanMs = 60_000, limit = 100): Promise<PayoutIntent[]> {
    return this.prisma.payoutIntent.findMany({
      where: {
        status: { in: [...UNRESOLVED_STATUSES] },
        updatedAt: { lt: new Date(Date.now() - olderThanMs) },
      },
      orderBy: { updatedAt: "asc" },
      take: limit,
    });
  }

  /**
   * Resolves stuck intents against the chain.
   *
   * A `SUBMITTED` intent has a hash, so its outcome is knowable: if the chain
   * says the transaction applied, the intent is CONFIRMED and no retry may
   * re-submit; if it definitively did not, the key is released as FAILED. A
   * `PENDING` intent never got a hash, so nothing was submitted and it can be
   * failed straight away.
   *
   * @param lookup - Returns the chain status for a transaction hash.
   * @param options - `olderThanMs` and `limit` for the batch.
   * @returns Counts of what the sweep did.
   */
  async reconcile(
    lookup: (txHash: string) => Promise<"SUCCESS" | "FAILED" | "NOT_FOUND">,
    options: { olderThanMs?: number; limit?: number } = {},
  ): Promise<{ scanned: number; confirmed: number; failed: number; pending: number }> {
    const intents = await this.findUnresolved(options.olderThanMs, options.limit);
    let confirmed = 0;
    let failed = 0;
    let pending = 0;

    for (const intent of intents) {
      if (!intent.txHash) {
        // Never reached submission — nothing can have moved on-chain.
        await this.fail(intent.idempotencyKey, "Reconciled: no transaction was submitted");
        failed += 1;
        continue;
      }

      const outcome = await lookup(intent.txHash);
      if (outcome === "SUCCESS") {
        await this.confirm(intent.idempotencyKey);
        confirmed += 1;
      } else if (outcome === "FAILED") {
        await this.fail(intent.idempotencyKey, "Reconciled: transaction failed on-chain");
        failed += 1;
      } else {
        // Still unknown to the RPC. Leave it unresolved — assuming either
        // outcome here is how a double payout or a stuck payout happens.
        pending += 1;
      }
    }

    return { scanned: intents.length, confirmed, failed, pending };
  }
}

export const payoutIntentService = new PayoutIntentService();
