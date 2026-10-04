import { TradeStatus } from "@prisma/client";
import { TradeWatchlistService } from "../services/trade.watchlist.service";

describe("TradeWatchlistService.notifyWatchers", () => {
  const prisma = {
    trade: { findUnique: jest.fn() },
    userWatchlist: { upsert: jest.fn(), deleteMany: jest.fn(), findMany: jest.fn() },
    notificationPreference: { findMany: jest.fn() },
  };
  const enqueue = jest.fn();
  const service = new TradeWatchlistService(prisma as any, enqueue);

  const watchers = (...addresses: string[]) =>
    prisma.userWatchlist.findMany.mockResolvedValue(
      addresses.map((userAddress) => ({ userAddress })),
    );

  beforeEach(() => {
    jest.clearAllMocks();
    enqueue.mockResolvedValue({});
    prisma.notificationPreference.findMany.mockResolvedValue([]);
  });

  it("enqueues exactly one in-app notification per watcher", async () => {
    watchers("g-a", "g-b", "g-c");

    const count = await service.notifyWatchers("trade-1", TradeStatus.FUNDED, { ledger: 9 });

    expect(count).toBe(3);
    expect(enqueue).toHaveBeenCalledTimes(3);
    const recipients = enqueue.mock.calls.map(([, data]) => data.userAddress).sort();
    expect(recipients).toEqual(["g-a", "g-b", "g-c"]);
    expect(enqueue.mock.calls[0][1]).toMatchObject({
      type: "in_app",
      title: "Watched trade funded",
      message: "Trade trade-1 is now funded.",
      metadata: { tradeId: "trade-1", status: "FUNDED", ledger: 9, watched: true },
    });
  });

  it("derives a deterministic job id per (trade, status, watcher)", async () => {
    watchers("g-a", "g-b");

    await service.notifyWatchers("trade-1", TradeStatus.DISPUTED);
    await service.notifyWatchers("trade-1", TradeStatus.DISPUTED);

    const ids = enqueue.mock.calls.map(([, , opts]) => opts.jobId);
    expect(ids).toEqual([
      "watch-trade-1-DISPUTED-g-a",
      "watch-trade-1-DISPUTED-g-b",
      "watch-trade-1-DISPUTED-g-a",
      "watch-trade-1-DISPUTED-g-b",
    ]);
    // Repeated attempts reuse the same ids, so the queue drops the duplicates.
    expect(new Set(ids).size).toBe(2);
  });

  it("de-duplicates a watcher that appears more than once", async () => {
    watchers("g-a", "g-a");

    await expect(service.notifyWatchers("trade-1", TradeStatus.DELIVERED)).resolves.toBe(1);
  });

  it("skips watchers whose preference for the event excludes in-app", async () => {
    watchers("g-a", "g-b", "g-c");
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userAddress: "g-a", preferences: { trade_completed: ["email"] } },
      { userAddress: "g-b", preferences: { trade_completed: ["in-app", "email"] } },
    ]);

    const count = await service.notifyWatchers("trade-1", TradeStatus.COMPLETED);

    expect(count).toBe(2);
    const recipients = enqueue.mock.calls.map(([, data]) => data.userAddress).sort();
    expect(recipients).toEqual(["g-b", "g-c"]);
  });

  it("skips a watcher who opted out with an empty channel list", async () => {
    watchers("g-a");
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userAddress: "g-a", preferences: { trade_funded: [] } },
    ]);

    await expect(service.notifyWatchers("trade-1", TradeStatus.FUNDED)).resolves.toBe(0);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("only applies the preference for the matching event", async () => {
    watchers("g-a");
    prisma.notificationPreference.findMany.mockResolvedValue([
      { userAddress: "g-a", preferences: { trade_delivered: ["email"] } },
    ]);

    await expect(service.notifyWatchers("trade-1", TradeStatus.FUNDED)).resolves.toBe(1);
  });

  it("notifies by default when a watcher has no stored preferences", async () => {
    watchers("g-a");

    await expect(service.notifyWatchers("trade-1", TradeStatus.FUNDED)).resolves.toBe(1);
  });

  it("does nothing when nobody watches the trade", async () => {
    watchers();

    await expect(service.notifyWatchers("trade-1", TradeStatus.FUNDED)).resolves.toBe(0);
    expect(prisma.notificationPreference.findMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("ignores statuses watchers are not told about", async () => {
    watchers("g-a");

    await expect(service.notifyWatchers("trade-1", TradeStatus.CREATED)).resolves.toBe(0);
    await expect(service.notifyWatchers("trade-1", TradeStatus.EXPIRED)).resolves.toBe(0);
    expect(prisma.userWatchlist.findMany).not.toHaveBeenCalled();
  });
});
