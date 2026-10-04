/**
 * Outbox scan reports are persisted by the scan worker and readable through
 * the admin reports endpoint.
 */
import express from "express";
import request from "supertest";

const mockCreate = jest.fn();
const mockFindMany = jest.fn();

jest.mock("../lib/db", () => ({
  prisma: {
    outboxScanReport: {
      create: (...args: unknown[]) => mockCreate(...args),
      findMany: (...args: unknown[]) => mockFindMany(...args),
    },
  },
}));

jest.mock("../lib/outbox/outboxScanner", () => ({
  scanOutboxCompleteness: jest.fn(),
  generateOutboxGapReport: jest.fn(),
  exportOutboxGaps: jest.fn(),
}));

jest.mock("../services/alert.service", () => ({
  alertService: { dispatch: jest.fn().mockResolvedValue(undefined) },
}));

jest.mock("../middleware/admin.middleware", () => ({
  adminMiddleware: (_req: unknown, _res: unknown, next: () => void) => next(),
}));

import { processOutboxScanJob } from "../jobs/workers/outbox-scan.worker";
import { createOutboxRoutes } from "../routes/outbox.routes";
import { scanOutboxCompleteness } from "../lib/outbox/outboxScanner";
import { alertService } from "../services/alert.service";

const gap = {
  tradeId: "trade-1",
  expectedEventType: "TradeFunded",
  lastStateChange: new Date("2026-09-30T00:00:00Z"),
  detectedAt: new Date("2026-09-30T01:00:00Z"),
  severity: "critical" as const,
  context: { currentStatus: "FUNDED", timeSinceChange: 3_600_000 },
};

function report(gaps: (typeof gap)[]) {
  return {
    scanStartTime: new Date("2026-09-30T01:00:00Z"),
    scanEndTime: new Date("2026-09-30T00:00:00Z"),
    totalTradesScanned: 7,
    gapsDetected: gaps,
    summary: {
      criticalGaps: gaps.filter((g) => g.severity === "critical").length,
      warningGaps: 0,
      infoGaps: 0,
    },
  };
}

const job = (data: object = {}) => ({ id: "job-42", data }) as any;

describe("outbox scan report persistence", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCreate.mockResolvedValue({ id: 1 });
  });

  it("persists a scan result that found gaps", async () => {
    (scanOutboxCompleteness as jest.Mock).mockResolvedValue(report([gap]));

    await processOutboxScanJob(job({ timeWindowMinutes: 120 }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({
      jobId: "job-42",
      timeWindowMinutes: 120,
      totalTradesScanned: 7,
      gapCount: 1,
      criticalGaps: 1,
      warningGaps: 0,
      infoGaps: 0,
      gaps: [gap],
    });
  });

  it("persists a clean scan result too", async () => {
    (scanOutboxCompleteness as jest.Mock).mockResolvedValue(report([]));

    await processOutboxScanJob(job());

    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockCreate.mock.calls[0][0].data).toMatchObject({
      gapCount: 0,
      gaps: [],
    });
  });

  it("still alerts on critical gaps when persistence fails", async () => {
    (scanOutboxCompleteness as jest.Mock).mockResolvedValue(report([gap]));
    mockCreate.mockRejectedValue(new Error("db down"));

    await expect(processOutboxScanJob(job())).resolves.toBeDefined();

    expect(alertService.dispatch).toHaveBeenCalledWith(
      "outbox_critical_gaps",
      expect.any(String),
      expect.any(Object),
    );
  });
});

describe("GET /admin/outbox/reports", () => {
  const app = express().use(createOutboxRoutes());

  beforeEach(() => {
    jest.clearAllMocks();
    mockFindMany.mockResolvedValue([{ id: 2 }, { id: 1 }]);
  });

  it("returns recent reports newest first", async () => {
    const res = await request(app).get("/admin/outbox/reports");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ reports: [{ id: 2 }, { id: 1 }], count: 2 });
    expect(mockFindMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 20,
    });
  });

  it("honours limit and caps it at 100", async () => {
    await request(app).get("/admin/outbox/reports?limit=5");
    expect(mockFindMany.mock.calls[0][0].take).toBe(5);

    await request(app).get("/admin/outbox/reports?limit=5000");
    expect(mockFindMany.mock.calls[1][0].take).toBe(100);
  });
});
