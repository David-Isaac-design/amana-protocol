import request from "supertest";
import { createApp } from "../app";
import express from "express";

const mockFeeStats = jest.fn();
const mockCacheGet = jest.fn();
const mockCacheSet = jest.fn();

jest.mock("../config/stellar", () => ({
  horizonServer: {
    feeStats: mockFeeStats,
  },
  sorobanRpcClient: {},
  networkPassphrase: "Test SDF Network ; September 2015",
}));

jest.mock("../lib/cache", () => ({
  cacheGet: mockCacheGet,
  cacheSet: mockCacheSet,
}));

const validFeeStats = {
  last_ledger: "12345",
  last_ledger_base_fee: "100",
  ledger_capacity_usage: "0.5",
  fee_charged: {
    max: "1000",
    min: "100",
    mode: "100",
    p10: "100",
    p20: "100",
    p30: "100",
    p40: "100",
    p50: "100",
    p60: "100",
    p70: "100",
    p80: "100",
    p90: "100",
    p95: "100",
    p99: "100",
  },
  max_fee: {
    max: "10000",
    min: "100",
    mode: "100",
    p10: "100",
    p20: "100",
    p30: "100",
    p40: "100",
    p50: "100",
    p60: "100",
    p70: "100",
    p80: "100",
    p90: "100",
    p95: "100",
    p99: "100",
  },
};

describe("GET /stellar/fees", () => {
  let app: express.Application;

  beforeEach(() => {
    mockFeeStats.mockReset();
    mockCacheGet.mockReset();
    mockCacheSet.mockReset();
    // Default: cache miss
    mockCacheGet.mockResolvedValue(null);
    mockCacheSet.mockResolvedValue(undefined);
    app = createApp();
  });

  it("returns fee stats from Stellar network (cache miss)", async () => {
    mockFeeStats.mockResolvedValue(validFeeStats);

    const response = await request(app).get("/stellar/fees");

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty("feeCharged");
    expect(response.body).toHaveProperty("maxFee");
    expect(response.body).toHaveProperty("ledger");
    expect(response.body.ledger).toBe(12345);
    expect(response.body).toHaveProperty("lastLedgerBaseFee");
    expect(response.body.lastLedgerBaseFee).toBe(100);
    expect(response.body.cached).toBe(false);
    // Should populate the cache after a live fetch
    expect(mockCacheSet).toHaveBeenCalled();
  });

  it("returns cached response on cache hit without calling Horizon", async () => {
    const cachedPayload = {
      feeCharged: validFeeStats.fee_charged,
      maxFee: validFeeStats.max_fee,
      ledger: 12345,
      lastLedgerBaseFee: 100,
      ledgerCapacityUsage: 0.5,
      recommended: {
        perOperationFee: 110,
        transactionFee: 110,
        operations: 1,
        percentile: 90,
        percentileFee: 100,
        multiplier: 1.1,
        congested: false,
        cappedAtMax: false,
        minStroops: 100,
        maxStroops: 100000,
      },
    };
    mockCacheGet.mockResolvedValue(cachedPayload);

    const response = await request(app).get("/stellar/fees");

    expect(response.status).toBe(200);
    expect(response.body.cached).toBe(true);
    expect(response.body.ledger).toBe(12345);
    // Horizon should NOT have been called
    expect(mockFeeStats).not.toHaveBeenCalled();
  });

  it("falls back to live fetch when Redis is unavailable (cache get returns null)", async () => {
    // cacheGet returns null simulating Redis unavailability (graceful degradation)
    mockCacheGet.mockResolvedValue(null);
    mockFeeStats.mockResolvedValue(validFeeStats);

    const response = await request(app).get("/stellar/fees");

    expect(response.status).toBe(200);
    expect(response.body.cached).toBe(false);
    expect(mockFeeStats).toHaveBeenCalledTimes(1);
  });

  it("returns 502 when Horizon fails", async () => {
    mockFeeStats.mockRejectedValue(new Error("Horizon unavailable"));

    const response = await request(app).get("/stellar/fees");

    expect(response.status).toBe(502);
    expect(response.body).toHaveProperty("error");
  });
});
