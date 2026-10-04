import express from "express";
import request from "supertest";
import { bodyParsers, limitForPath, DEFAULT_BODY_LIMIT } from "../middleware/bodyLimits";

function buildApp() {
  const app = express();
  app.use(bodyParsers());
  app.use((_req, res) => res.status(200).json({ ok: true }));
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(err.status ?? 500).json({ error: err.type });
  });
  return app;
}

const payloadOf = (bytes: number) => ({ data: "x".repeat(bytes) });

describe("per-route body size limits", () => {
  it("uses the small default for ordinary routes", () => {
    expect(limitForPath("/api/v1/trades")).toBe(DEFAULT_BODY_LIMIT);
    expect(limitForPath("/auth/login")).toBe(DEFAULT_BODY_LIMIT);
  });

  it("raises the limit only for evidence and admin batch routes", () => {
    expect(limitForPath("/api/v1/evidence")).toBe("1mb");
    expect(limitForPath("/trades/abc/evidence")).toBe("1mb");
    expect(limitForPath("/admin/trades/batch/status")).toBe("1mb");
  });

  it("returns 413 for an oversized JSON payload on a default route", async () => {
    const res = await request(buildApp()).post("/api/v1/trades").send(payloadOf(200 * 1024));
    expect(res.status).toBe(413);
  });

  it("returns 413 for an oversized URL-encoded payload on a default route", async () => {
    const res = await request(buildApp())
      .post("/auth/login")
      .type("form")
      .send(`data=${"x".repeat(200 * 1024)}`);
    expect(res.status).toBe(413);
  });

  it("accepts a larger payload on an overridden route", async () => {
    const res = await request(buildApp()).post("/api/v1/evidence").send(payloadOf(200 * 1024));
    expect(res.status).toBe(200);
  });

  it("still returns 413 above the raised limit", async () => {
    const res = await request(buildApp()).post("/api/v1/evidence").send(payloadOf(2 * 1024 * 1024));
    expect(res.status).toBe(413);
  });
});
