// Mock BullMQ and IORedis before any imports
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
let workerProcessor: ((job: any) => Promise<unknown>) | null = null;

const MockWorker = jest.fn().mockImplementation(
  (_name: string, processor: (job: any) => Promise<unknown>) => {
    workerProcessor = processor;
    return { close: mockWorkerClose, on: jest.fn() };
  },
);

jest.mock("bullmq", () => ({
  Queue: jest.fn().mockImplementation(() => ({ add: jest.fn(), close: jest.fn() })),
  Worker: MockWorker,
}));

jest.mock("ioredis", () => jest.fn().mockImplementation(() => ({ quit: jest.fn() })));

jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock("../jobs/deadLetter", () => ({
  attachDeadLetterQueue: jest.fn(),
}));

const mockPing = jest.fn().mockResolvedValue(undefined);
jest.mock("../services/jobHeartbeat.service", () => ({
  jobHeartbeatService: { ping: mockPing },
  JobType: { WEBHOOK_PURGE: "webhook-purge" },
}));

const mockFindMany = jest.fn();
const mockDeleteMany = jest.fn();

jest.mock("../lib/db", () => ({
  prisma: {
    webhookDeliveryAttempt: {
      findMany: mockFindMany,
      deleteMany: mockDeleteMany,
    },
  },
}));

import { createWebhookPurgeWorker } from "../jobs/workers/webhookPurge.worker";

describe("Webhook purge worker", () => {
  beforeEach(() => {
    mockPing.mockClear();
    mockFindMany.mockClear();
    mockDeleteMany.mockClear();
    workerProcessor = null;
  });

  it("deletes old rows in batches until no rows remain", async () => {
    createWebhookPurgeWorker();
    expect(workerProcessor).not.toBeNull();

    // First batch returns 2 rows, second returns 0 (done)
    mockFindMany
      .mockResolvedValueOnce([{ id: 1 }, { id: 2 }])
      .mockResolvedValueOnce([]);
    mockDeleteMany.mockResolvedValue({ count: 2 });

    const result: any = await workerProcessor!({
      id: "purge-job-1",
      data: { retentionDays: 30, batchSize: 500 },
    });

    expect(result.totalDeleted).toBe(2);
    expect(result.retentionDays).toBe(30);
    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
  });

  it("handles multiple batches correctly", async () => {
    createWebhookPurgeWorker();

    // 3 batches: 500, 500, 0
    mockFindMany
      .mockResolvedValueOnce(Array.from({ length: 500 }, (_, i) => ({ id: i })))
      .mockResolvedValueOnce(Array.from({ length: 300 }, (_, i) => ({ id: i + 500 })))
      .mockResolvedValueOnce([]);
    mockDeleteMany
      .mockResolvedValueOnce({ count: 500 })
      .mockResolvedValueOnce({ count: 300 });

    const result: any = await workerProcessor!({
      id: "purge-job-2",
      data: { retentionDays: 30, batchSize: 500 },
    });

    expect(result.totalDeleted).toBe(800);
    expect(mockDeleteMany).toHaveBeenCalledTimes(2);
  });

  it("pings heartbeat on start and completion", async () => {
    createWebhookPurgeWorker();

    mockFindMany.mockResolvedValue([]);

    await workerProcessor!({
      id: "purge-job-3",
      data: { retentionDays: 30 },
    });

    expect(mockPing).toHaveBeenCalledWith("webhook-purge", { status: "started" });
    expect(mockPing).toHaveBeenCalledWith(
      "webhook-purge",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it("does nothing when no rows are older than the cutoff", async () => {
    createWebhookPurgeWorker();

    mockFindMany.mockResolvedValue([]);

    const result: any = await workerProcessor!({
      id: "purge-job-4",
      data: { retentionDays: 30, batchSize: 500 },
    });

    expect(result.totalDeleted).toBe(0);
    expect(mockDeleteMany).not.toHaveBeenCalled();
  });

  it("uses default retention of 30 days when not specified", async () => {
    createWebhookPurgeWorker();

    mockFindMany.mockResolvedValue([]);

    const result: any = await workerProcessor!({
      id: "purge-job-5",
      data: {},
    });

    expect(result.retentionDays).toBe(30);
  });
});
