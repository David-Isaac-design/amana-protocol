process.env.DATABASE_URL = "postgres://dummy";

import crypto from "crypto";
import { buildSignatureHeader, WebhookService } from "../services/webhook.service";
import { prisma } from "../lib/db";

jest.mock("../lib/db", () => ({
  prisma: { webhookSubscription: { findMany: jest.fn(), updateMany: jest.fn() } },
}));

const sig = (secret: string, body: string) =>
  crypto.createHmac("sha256", secret).update(body).digest("hex");

describe("webhook secret rotation", () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    (global as any).fetch = fetchMock.mockResolvedValue({ ok: true, status: 200 });
  });

  it("signs with both secrets so either verifies", () => {
    const header = buildSignatureHeader("body", "new", "old");
    expect(header).toBe(`v1=${sig("new", "body")},v1=${sig("old", "body")}`);
    expect(buildSignatureHeader("body", "new")).toBe(`v1=${sig("new", "body")}`);
  });

  it("sends both signatures during the grace period and only one after expiry", async () => {
    const svc = new WebhookService();
    const base = { id: 1, url: "https://example.com/h", secretHash: "new", previousSecretHash: "old" };
    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([
      { ...base, previousSecretExpiresAt: new Date(Date.now() + 60_000) },
    ]);
    await svc.dispatch("t1", "FUNDED" as any);
    expect(fetchMock.mock.calls[0][1].headers["X-Webhook-Signatures"].split(",")).toHaveLength(2);

    (prisma.webhookSubscription.findMany as jest.Mock).mockResolvedValueOnce([
      { ...base, previousSecretExpiresAt: new Date(Date.now() - 60_000) },
    ]);
    await svc.dispatch("t1", "FUNDED" as any);
    expect(fetchMock.mock.calls[1][1].headers["X-Webhook-Signatures"].split(",")).toHaveLength(1);
  });

  it("purges expired previous secrets", async () => {
    (prisma.webhookSubscription.updateMany as jest.Mock).mockResolvedValue({ count: 2 });
    const now = new Date();
    await expect(new WebhookService().purgeExpiredPreviousSecrets(now)).resolves.toBe(2);
    expect(prisma.webhookSubscription.updateMany).toHaveBeenCalledWith({
      where: { previousSecretExpiresAt: { lte: now } },
      data: { previousSecretHash: null, previousSecretExpiresAt: null },
    });
  });
});
