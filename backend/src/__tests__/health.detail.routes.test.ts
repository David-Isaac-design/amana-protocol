import express from "express";
import request from "supertest";
import { createHealthDetailRouter } from "../routes/health.detail.routes";
import { HealthService } from "../services/health.service";

jest.mock("../services/health.service");
jest.mock("../middleware/logger", () => ({ appLogger: { info: jest.fn(), error: jest.fn() } }));
jest.mock("../lib/metrics", () => ({
  recordEventListenerLag: jest.fn(),
  recordSorobanRpcHealth: jest.fn(),
}));

const upCheck = (latency = 5) => ({ status: "up" as const, message: "ok", responseTime: latency });
const downCheck = (msg = "timeout") => ({ status: "down" as const, message: msg, responseTime: 5000 });

function makeHealthResult(overrides: Partial<{
    status: "healthy" | "degraded" | "unhealthy";
    checks: object;
    details: object;
}> = {}) {
    return {
        status: "healthy" as const,
        timestamp: new Date().toISOString(),
        uptime: 100,
        checks: {
            database: upCheck(),
            indexer: upCheck(),
            stellar: upCheck(),
            ipfs: upCheck(),
            redis: upCheck(),
            config: upCheck(),
        },
        details: {
            indexerLagSeconds: 2,
            lastProcessedLedger: 1000,
        },
        ...overrides,
    };
}

function buildApp() {
    const app = express();
    app.use(express.json());
    app.use("/health", createHealthDetailRouter());
    return app;
}

describe("GET /health/detail (#729 + #35)", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 200 with per-service status and latency when all healthy", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(makeHealthResult() as any);

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("healthy");
        expect(res.body.checks.database).toMatchObject({ status: "up", latency: expect.any(Number) });
        expect(res.body.checks.redis).toMatchObject({ status: "up", latency: expect.any(Number) });
    });

    it("returns 200 with degraded status when one service is down", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                status: "degraded",
                checks: {
                    database: upCheck(),
                    indexer: downCheck("connection refused"),
                    stellar: upCheck(),
                    ipfs: upCheck(),
                    redis: upCheck(),
                    config: upCheck(),
                },
            }) as any
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.status).toBe("degraded");
        expect(res.body.checks.indexer.status).toBe("down");
        expect(res.body.checks.indexer.error).toBe("connection refused");
    });

    it("returns 503 when all services are down (unhealthy)", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                status: "unhealthy",
                checks: {
                    database: downCheck("DB unreachable"),
                    indexer: downCheck(),
                    stellar: downCheck(),
                    ipfs: downCheck(),
                    redis: downCheck(),
                    config: downCheck(),
                },
            }) as any
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("unhealthy");
    });

    it("does not include error field for healthy services", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(makeHealthResult() as any);

        const res = await request(buildApp()).get("/health/detail");

        expect(res.body.checks.database.error).toBeUndefined();
    });

    it("returns 503 with error field when performHealthCheck throws", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockRejectedValue(new Error("unexpected"));

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(503);
        expect(res.body.status).toBe("down");
        expect(res.body.error).toBeDefined();
    });

    // Issue #35 — event listener lag block
    it("includes eventListener block with lagSeconds and lastProcessedLedger", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                details: { indexerLagSeconds: 4, lastProcessedLedger: 1234 },
            }) as any
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.eventListener).toBeDefined();
        expect(res.body.eventListener.lagSeconds).toBe(4);
        expect(res.body.eventListener.lastProcessedLedger).toBe(1234);
        expect(res.body.eventListener.status).toBe("up");
    });

    it("marks eventListener degraded when lagSeconds exceeds threshold", async () => {
        // Default threshold is 100 ledgers * 5 s = 500 s
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                details: { indexerLagSeconds: 600, lastProcessedLedger: 900 },
            }) as any
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.status).toBe(200);
        expect(res.body.eventListener.status).toBe("degraded");
        expect(res.body.status).toBe("degraded");
    });

    it("marks eventListener down when no processed events exist (lagSeconds < 0)", async () => {
        jest.mocked(HealthService.prototype.performHealthCheck).mockResolvedValue(
            makeHealthResult({
                details: { indexerLagSeconds: -1, lastProcessedLedger: null },
            }) as any
        );

        const res = await request(buildApp()).get("/health/detail");

        expect(res.body.eventListener.status).toBe("down");
        expect(res.body.eventListener.lagSeconds).toBeNull();
    });
});
