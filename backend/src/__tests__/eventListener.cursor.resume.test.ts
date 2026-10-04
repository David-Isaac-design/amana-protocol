/**
 * Integration test — event listener cursor resume after restart (#36)
 *
 * Verifies that:
 *  1. After processing N events, stopping, and restarting, the listener
 *     resumes from the stored cursor (lastLedger) and NOT from ledger 0.
 *  2. No events processed before the restart are re-dispatched (no duplicates).
 *  3. New events appearing after the restart are processed exactly once
 *     (no gaps).
 *
 * The test uses a fully mocked Prisma client and a mocked Soroban RPC
 * (same helpers as eventListener.test.ts) so no database or network
 * connections are required.
 */

import { jest } from "@jest/globals";

const vi = jest as any;

/* ------------------------------------------------------------------ */
/*  Hoisted mock variables                                            */
/* ------------------------------------------------------------------ */

const mockGetEvents = vi.fn();
const mockDispatchEvent = vi.fn().mockResolvedValue(undefined);

/* ------------------------------------------------------------------ */
/*  Module-level mocks                                                */
/* ------------------------------------------------------------------ */

vi.mock("@stellar/stellar-sdk", () => ({
  rpc: {
    Server: vi.fn().mockImplementation(() => ({
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    })),
  },
  scValToNative: vi.fn(),
}));

vi.mock("../config/eventListener.config", () => ({
  getEventListenerConfig: vi.fn(),
}));

vi.mock("../services/eventHandlers", () => ({
  dispatchEvent: (...args: unknown[]) => mockDispatchEvent(...args),
}));

import { EventListenerService } from "../services/eventListener.service";
import * as StellarSdk from "@stellar/stellar-sdk";
import { getEventListenerConfig } from "../config/eventListener.config";

const TEST_CONFIG = {
  rpcUrl: "https://test-rpc.example.com",
  contractId: "CONTRACT_CURSOR_RESUME",
  pollIntervalMs: 100,
  backoffInitialMs: 50,
  backoffMaxMs: 1000,
  processedLedgersCacheSize: 100,
  outboxMaxAttempts: 3,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

/** Build a minimal raw Soroban event for a given ledger sequence. */
function makeRawEvent(ledger: number, id = `evt-${ledger}`) {
  return {
    ledger,
    id,
    contractId: "CONTRACT_CURSOR_RESUME",
    topic: [{ _scval: "symbol" }, { _scval: "tradeId" }],
    value: { type: "test", value: {} },
  };
}

/**
 * Build a mocked Prisma client that:
 *  - Stores ProcessedEvent rows in an in-memory array (processedRows).
 *  - Simulates findMany (used by start() to hydrate the in-memory cache).
 *  - Simulates findUnique (used by isAlreadyProcessed).
 *  - Simulates $transaction (calls the callback with the mock tx).
 */
function createMockPrisma() {
  const processedRows: Array<{
    id: number;
    ledgerSequence: number;
    contractId: string;
    eventId: string;
    processedAt: Date;
  }> = [];

  let nextId = 1;

  const mockTx = {
    trade: { upsert: jest.fn() },
    processedEvent: {
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        processedRows.push({ id: nextId++, ...data, processedAt: new Date() });
        return {};
      }),
    },
  };

  return {
    processedRows,
    processedEvent: {
      /** findMany: return all stored rows, most recent ledger first. */
      findMany: jest.fn().mockImplementation(async ({ take }: any) => {
        const sorted = [...processedRows].sort(
          (a, b) => b.ledgerSequence - a.ledgerSequence,
        );
        return take ? sorted.slice(0, take) : sorted;
      }),
      /** findUnique: return the row if it exists. */
      findUnique: jest.fn().mockImplementation(async ({ where }: any) => {
        const key = where.ledgerSequence_contractId_eventId;
        return (
          processedRows.find(
            (r) =>
              r.ledgerSequence === key.ledgerSequence &&
              r.contractId === key.contractId &&
              r.eventId === key.eventId,
          ) ?? null
        );
      }),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        processedRows.push({ id: nextId++, ...data, processedAt: new Date() });
        return {};
      }),
    },
    $transaction: jest.fn().mockImplementation(async (cb: any) => {
      await cb(mockTx);
    }),
    _mockTx: mockTx,
  } as any;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                             */
/* ------------------------------------------------------------------ */

describe("[#36] EventListenerService — cursor resume after restart", () => {
  let mockPrisma: ReturnType<typeof createMockPrisma>;

  beforeEach(() => {
    mockGetEvents.mockReset().mockResolvedValue({ events: [] });
    mockDispatchEvent.mockReset().mockResolvedValue(undefined);
    (StellarSdk.scValToNative as any)
      .mockReset()
      .mockImplementation(() => "TradeFunded");
    vi.mocked(getEventListenerConfig).mockReturnValue(TEST_CONFIG);
    mockPrisma = createMockPrisma();
  });

  /**
   * Simulate processing N events, then stopping the service ("restart"),
   * and starting a new instance backed by the same Prisma store.
   */
  it("resumes from the stored cursor and does not re-process already-seen events", async () => {
    /* ---- Phase 1: initial run — process events at ledgers 1-3 ---- */

    const firstInstance = new EventListenerService(mockPrisma);
    (firstInstance as any).server = {
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    };

    // Seed DB with N=3 already-processed events (simulating prior run)
    const preProcessed = [
      makeRawEvent(1, "evt-1"),
      makeRawEvent(2, "evt-2"),
      makeRawEvent(3, "evt-3"),
    ];

    (StellarSdk.scValToNative as any)
      .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("trade-1")
      .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("trade-2")
      .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("trade-3");

    mockGetEvents.mockResolvedValueOnce({ events: preProcessed });

    await firstInstance.start();
    await firstInstance.pollEvents();

    const cursorAfterFirstRun = await firstInstance.drain();

    // Sanity: cursor advanced to ledger 3
    expect(cursorAfterFirstRun).toBe(3);
    // Sanity: 3 events recorded in the DB
    expect(mockPrisma.processedRows).toHaveLength(3);
    // Sanity: dispatch was called 3 times
    expect(mockDispatchEvent).toHaveBeenCalledTimes(3);

    /* ---- Phase 2: restart — new instance, same Prisma store ---- */

    mockDispatchEvent.mockClear();

    const secondInstance = new EventListenerService(mockPrisma);
    (secondInstance as any).server = {
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    };

    // RPC returns only the NEW event at ledger 4 (nothing earlier)
    const newEvent = makeRawEvent(4, "evt-4");
    mockGetEvents.mockResolvedValueOnce({ events: [newEvent] });
    (StellarSdk.scValToNative as any)
      .mockReturnValueOnce("TradeFunded")
      .mockReturnValueOnce("trade-4");

    // start() hydrates in-memory cache from DB and sets lastLedger = 3
    await secondInstance.start();

    // Verify cursor was loaded from DB
    expect((secondInstance as any).lastLedger).toBe(3);

    await secondInstance.pollEvents();

    secondInstance.stop();

    /* ---- Assertions ---- */

    // Only the 1 new event should have been dispatched — no re-plays
    expect(mockDispatchEvent).toHaveBeenCalledTimes(1);
    expect(mockDispatchEvent).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ ledgerSequence: 4, eventId: "evt-4" }),
    );

    // Total DB rows: 3 (original) + 1 (new) = 4, no duplicates
    expect(mockPrisma.processedRows).toHaveLength(4);

    // No gap: ledger sequences are 1, 2, 3, 4 in the DB
    const ledgers = mockPrisma.processedRows
      .map((r: any) => r.ledgerSequence)
      .sort((a: number, b: number) => a - b);
    expect(ledgers).toEqual([1, 2, 3, 4]);
  });

  it("does not dispatch duplicate events when the same event arrives again after restart", async () => {
    /* Pre-populate DB with ledger 10 already processed */
    mockPrisma.processedRows.push({
      id: 1,
      ledgerSequence: 10,
      contractId: "CONTRACT_CURSOR_RESUME",
      eventId: "evt-10",
      processedAt: new Date(),
    });

    mockDispatchEvent.mockClear();

    const service = new EventListenerService(mockPrisma);
    (service as any).server = {
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    };

    // RPC naively returns evt-10 again (e.g. startLedger is off-by-one)
    const duplicateEvent = makeRawEvent(10, "evt-10");
    mockGetEvents.mockResolvedValueOnce({ events: [duplicateEvent] });
    (StellarSdk.scValToNative as any)
      .mockReturnValueOnce("TradeFunded")
      .mockReturnValueOnce("trade-10");

    await service.start();
    await service.pollEvents();
    service.stop();

    // Duplicate must be silently ignored — dispatch called 0 times
    expect(mockDispatchEvent).not.toHaveBeenCalled();
    // DB still has only the original row (no new insert for the duplicate)
    expect(mockPrisma.processedRows).toHaveLength(1);
  });

  it("processes events after the cursor gap without skipping ledgers", async () => {
    /* Simulate: last run stopped at ledger 50, new events at 51 and 52 */
    mockPrisma.processedRows.push({
      id: 1,
      ledgerSequence: 50,
      contractId: "CONTRACT_CURSOR_RESUME",
      eventId: "evt-50",
      processedAt: new Date(),
    });

    mockDispatchEvent.mockClear();

    const service = new EventListenerService(mockPrisma);
    (service as any).server = {
      getEvents: (...args: unknown[]) => mockGetEvents(...args),
    };

    const event51 = makeRawEvent(51, "evt-51");
    const event52 = makeRawEvent(52, "evt-52");
    mockGetEvents.mockResolvedValueOnce({ events: [event51, event52] });

    (StellarSdk.scValToNative as any)
      .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("trade-51")
      .mockReturnValueOnce("TradeFunded").mockReturnValueOnce("trade-52");

    await service.start();
    await service.pollEvents();
    service.stop();

    // Both events must be dispatched (no gap)
    expect(mockDispatchEvent).toHaveBeenCalledTimes(2);

    const dispatchedLedgers = (mockDispatchEvent as any).mock.calls.map(
      ([, evt]: [any, any]) => evt.ledgerSequence,
    );
    expect(dispatchedLedgers).toEqual(expect.arrayContaining([51, 52]));

    // DB: 1 (pre-existing) + 2 (new) = 3 rows
    expect(mockPrisma.processedRows).toHaveLength(3);

    // cursor advanced
    expect((service as any).lastLedger).toBe(52);
  });
});
