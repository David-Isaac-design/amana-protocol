import { Prisma, TradeStatus } from "@prisma/client";

const mockNotifyWatchers = jest.fn();

jest.mock("../services/trade.watchlist.service", () => ({
  TradeWatchlistService: jest.fn().mockImplementation(() => ({
    notifyWatchers: (...args: unknown[]) => mockNotifyWatchers(...args),
  })),
}));
jest.mock("../services/webhook.service", () => ({
  webhookService: { dispatch: jest.fn() },
}));
jest.mock("../lib/escrowAudit", () => ({ logEscrowEvent: jest.fn() }));
jest.mock("../lib/metrics", () => ({
  recordTradeFunnelEvent: jest.fn(),
  recordTimeToFund: jest.fn(),
  recordTimeToRelease: jest.fn(),
  recordTradeGmv: jest.fn(),
}));

import {
  handleTradeCreated,
  handleTradeFunded,
  handleDeliveryConfirmed,
  handleFundsReleased,
  handleDisputeInitiated,
  handleDisputeResolved,
} from "../services/eventHandlers";
import { EventType, ParsedEvent } from "../types/events";

function txWith(existingStatus: TradeStatus | null, updated = 1) {
  return {
    trade: {
      findUnique: jest.fn(async () =>
        existingStatus ? { tradeId: "t-1", status: existingStatus, version: 1 } : null,
      ),
      create: jest.fn(async () => ({})),
      updateMany: jest.fn(async () => ({ count: updated })),
    },
  } as unknown as Prisma.TransactionClient;
}

const event = (eventType: EventType): ParsedEvent => ({
  eventType,
  tradeId: "t-1",
  ledgerSequence: 77,
  contractId: "C1",
  eventId: "evt-1",
  data: {},
});

describe("event handlers notify watchers once per applied transition", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockNotifyWatchers.mockResolvedValue(2);
  });

  const cases: Array<[string, typeof handleTradeFunded, EventType, TradeStatus, TradeStatus]> = [
    ["funded", handleTradeFunded, EventType.TradeFunded, TradeStatus.CREATED, TradeStatus.FUNDED],
    ["delivered", handleDeliveryConfirmed, EventType.DeliveryConfirmed, TradeStatus.FUNDED, TradeStatus.DELIVERED],
    ["completed (release)", handleFundsReleased, EventType.FundsReleased, TradeStatus.DELIVERED, TradeStatus.COMPLETED],
    ["disputed", handleDisputeInitiated, EventType.DisputeInitiated, TradeStatus.FUNDED, TradeStatus.DISPUTED],
    ["completed (resolution)", handleDisputeResolved, EventType.DisputeResolved, TradeStatus.DISPUTED, TradeStatus.COMPLETED],
  ];

  it.each(cases)("%s", async (_name, handler, eventType, from, to) => {
    await handler(txWith(from), event(eventType));

    expect(mockNotifyWatchers).toHaveBeenCalledTimes(1);
    expect(mockNotifyWatchers).toHaveBeenCalledWith("t-1", to, { ledger: 77 });
  });

  it.each(cases)("%s: a replayed event that does not transition notifies nobody", async (_n, handler, eventType, _from, to) => {
    // The trade is already past the valid predecessor, so the event is a no-op.
    await handler(txWith(to), event(eventType));

    expect(mockNotifyWatchers).not.toHaveBeenCalled();
  });

  it("does not notify when the transition loses a concurrency race", async () => {
    await expect(
      handleTradeFunded(txWith(TradeStatus.CREATED, 0), event(EventType.TradeFunded)),
    ).rejects.toThrow("Concurrency conflict");

    expect(mockNotifyWatchers).not.toHaveBeenCalled();
  });

  it("does not notify on trade creation", async () => {
    await handleTradeCreated(txWith(null), event(EventType.TradeCreated));

    expect(mockNotifyWatchers).not.toHaveBeenCalled();
  });

  it("a notification failure does not fail event handling", async () => {
    mockNotifyWatchers.mockRejectedValue(new Error("redis down"));

    await expect(
      handleTradeFunded(txWith(TradeStatus.CREATED), event(EventType.TradeFunded)),
    ).resolves.toBeUndefined();
  });
});
