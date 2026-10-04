jest.mock("bullmq", () => ({ Worker: jest.fn(), Job: jest.fn() }));
jest.mock("../jobs/queue", () => ({ createQueueConnection: jest.fn() }));
jest.mock("../jobs/deadLetter", () => ({ attachDeadLetterQueue: jest.fn() }));
jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), error: jest.fn() },
}));
jest.mock("../services/tradeExpiry.service", () => ({
  tradeExpiryService: { sweepExpiredTrades: jest.fn() },
}));

import { Job } from "bullmq";
import {
  TradeExpiryMetricsRecorder,
  TradeExpirySweepMetrics,
  __resetTradeExpiryMetricsForTests,
  __setTradeExpiryRecorderForTests,
} from "../lib/metrics";
import { tradeExpiryService } from "../services/tradeExpiry.service";
import { processTradeExpirySweep, TradeExpirySweepJobData } from "../jobs/workers/tradeExpiry.worker";

describe("trade expiry worker metrics", () => {
  const sweepMock = tradeExpiryService.sweepExpiredTrades as jest.Mock;
  let recorded: TradeExpirySweepMetrics[];

  beforeEach(() => {
    recorded = [];
    const recorder: TradeExpiryMetricsRecorder = {
      recordTradeExpirySweep: (result) => { recorded.push(result); },
    };
    __setTradeExpiryRecorderForTests(recorder);
  });

  afterEach(() => {
    __resetTradeExpiryMetricsForTests();
    jest.clearAllMocks();
  });

  const job = { id: "job-1", data: { batchSize: 10 } } as unknown as Job<TradeExpirySweepJobData>;

  it("records swept, refunded and failed counts with a duration", async () => {
    sweepMock.mockResolvedValue({ scanned: 5, expired: 4, refunded: 2, errors: 1 });

    await processTradeExpirySweep(job);

    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ swept: 4, refunded: 2, failed: 1, status: "success" });
    expect(recorded[0].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("records an error duration when the sweep throws", async () => {
    sweepMock.mockRejectedValue(new Error("db down"));

    await expect(processTradeExpirySweep(job)).rejects.toThrow("db down");

    expect(recorded).toEqual([
      expect.objectContaining({ swept: 0, refunded: 0, failed: 0, status: "error" }),
    ]);
  });
});
