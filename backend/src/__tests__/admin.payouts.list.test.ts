import express from "express";
import request from "supertest";

const authMock = jest.fn((_req: any, _res: any, next: any) => next());
const adminMock = jest.fn((_req: any, _res: any, next: any) => next());

jest.mock("../middleware/auth.middleware", () => ({
  authMiddleware: (req: any, res: any, next: any) => authMock(req, res, next),
}));
jest.mock("../middleware/admin.middleware", () => ({
  adminMiddleware: (req: any, res: any, next: any) => adminMock(req, res, next),
}));
jest.mock("../middleware/logger", () => ({
  appLogger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));
jest.mock("../lib/metrics", () => ({ recordPayoutIntentOutcome: jest.fn() }));
jest.mock("../services/stellar.service", () => ({ StellarService: jest.fn() }));

import { createAdminPayoutsRouter } from "../routes/admin.payouts.routes";
import { PayoutIntentService } from "../services/payoutIntent.service";
import { InvalidCursorError, encodeCursor } from "../lib/cursorPagination";

function intent(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    idempotencyKey: `key-${id}`,
    kind: "RELEASE",
    tradeId: `trade-${id}`,
    milestoneIndex: null,
    amountUsdc: "10.00",
    destination: "GDEST",
    requestedBy: "GADMIN",
    status: "FAILED",
    txHash: null,
    duplicateAttempts: 0,
    lastError: "boom",
    submittedAt: null,
    confirmedAt: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

describe("GET /api/admin/payouts", () => {
  const list = jest.fn();
  const stellar = { getTransactionStatus: jest.fn() };

  function app() {
    const a = express();
    a.use(express.json());
    a.use(
      createAdminPayoutsRouter(
        { list, reconcile: jest.fn(), findUnresolved: jest.fn(), findByKey: jest.fn() } as any,
        stellar as any,
      ),
    );
    return a;
  }

  beforeEach(() => {
    jest.clearAllMocks();
    authMock.mockImplementation((_req, _res, next) => next());
    adminMock.mockImplementation((_req, _res, next) => next());
  });

  it("passes filters through and returns a cursor page", async () => {
    list.mockResolvedValue({
      items: [intent(3)],
      pageInfo: { nextCursor: "abc", hasNextPage: true, limit: 1 },
    });

    const res = await request(app())
      .get("/api/admin/payouts")
      .query({ status: "FAILED", from: "2026-01-01", to: "2026-02-01", limit: 1 });

    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.pageInfo).toEqual({ nextCursor: "abc", hasNextPage: true, limit: 1 });
    expect(list).toHaveBeenCalledWith({
      status: "FAILED",
      from: new Date("2026-01-01"),
      to: new Date("2026-02-01"),
      limit: 1,
    });
  });

  it("defaults the page size to 20", async () => {
    list.mockResolvedValue({ items: [], pageInfo: { nextCursor: null, hasNextPage: false, limit: 20 } });

    await request(app()).get("/api/admin/payouts").expect(200);

    expect(list).toHaveBeenCalledWith({ limit: 20 });
  });

  it.each([
    [{ status: "BOGUS" }],
    [{ from: "not-a-date" }],
    [{ from: "2026-02-01", to: "2026-01-01" }],
    [{ limit: 0 }],
    [{ limit: 101 }],
  ])("rejects invalid query %p with 400", async (query) => {
    const res = await request(app()).get("/api/admin/payouts").query(query);
    expect(res.status).toBe(400);
    expect(list).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed cursor", async () => {
    list.mockRejectedValue(new InvalidCursorError());
    const res = await request(app()).get("/api/admin/payouts").query({ cursor: "garbage" });
    expect(res.status).toBe(400);
  });

  it("is guarded by admin auth", async () => {
    adminMock.mockImplementation((_req, res: any) => res.status(403).json({ error: "Forbidden" }));
    const res = await request(app()).get("/api/admin/payouts");
    expect(res.status).toBe(403);
    expect(list).not.toHaveBeenCalled();
  });
});

describe("PayoutIntentService.list", () => {
  function service(rows: unknown[]) {
    const findMany = jest.fn().mockResolvedValue(rows);
    const svc = new PayoutIntentService({ payoutIntent: { findMany } } as any);
    return { svc, findMany };
  }

  it("builds status, date and cursor filters", async () => {
    const { svc, findMany } = service([]);
    const from = new Date("2026-01-01");
    const to = new Date("2026-02-01");

    await svc.list({ status: "FAILED", from, to, cursor: encodeCursor({ id: 50 }), limit: 10 });

    expect(findMany).toHaveBeenCalledWith({
      where: { status: "FAILED", createdAt: { gte: from, lte: to }, id: { lt: 50 } },
      orderBy: { id: "desc" },
      take: 11,
    });
  });

  it("returns a next cursor when more rows exist", async () => {
    const { svc } = service([intent(9), intent(8), intent(7)]);

    const page = await svc.list({ limit: 2 });

    expect(page.items.map((i) => i.id)).toEqual([9, 8]);
    expect(page.pageInfo).toEqual({ nextCursor: encodeCursor({ id: 8 }), hasNextPage: true, limit: 2 });
  });

  it("returns no cursor on the last page", async () => {
    const { svc } = service([intent(1)]);
    const page = await svc.list({ limit: 2 });
    expect(page.pageInfo).toEqual({ nextCursor: null, hasNextPage: false, limit: 2 });
  });

  it("rejects a malformed cursor", async () => {
    const { svc } = service([]);
    await expect(svc.list({ cursor: "!!", limit: 5 })).rejects.toBeInstanceOf(InvalidCursorError);
  });
});
