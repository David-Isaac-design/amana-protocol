import { DisputeStatus, EvidenceRequestStatus } from "@prisma/client";
import { DisputeService } from "../services/dispute.service";
import { ErrorCode } from "../errors/errorCodes";

const MEDIATOR = "GA_MEDIATOR_ASSIGNED";
const OTHER_MEDIATOR = "GA_MEDIATOR_OTHER";

function makeDispute(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 7,
    tradeId: "T-100",
    initiator: "ga_buyer",
    reason: "Damaged goods",
    status: DisputeStatus.UNDER_REVIEW,
    version: 1,
    mediatorAddress: MEDIATOR,
    resolvedAt: null,
    createdAt: now,
    updatedAt: now,
    trade: { buyerAddress: "GA_BUYER", sellerAddress: "GA_SELLER", amountUsdc: "100" },
    ...overrides,
  };
}

function createMockPrisma() {
  const tx = {
    disputeEvidenceRequest: {
      create: jest.fn(async ({ data }: any) => ({
        id: 11,
        status: EvidenceRequestStatus.OPEN,
        createdAt: new Date(),
        ...data,
      })),
    },
    inAppNotification: { create: jest.fn().mockResolvedValue({ id: 1 }) },
  };
  return {
    dispute: { findFirst: jest.fn() },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
    _tx: tx,
  };
}

describe("DisputeService – evidence requests", () => {
  let prisma: ReturnType<typeof createMockPrisma>;
  let service: DisputeService;
  const dueAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);

  beforeEach(() => {
    prisma = createMockPrisma();
    service = new DisputeService(prisma as any);
    process.env.ADMIN_STELLAR_PUBKEYS = `${MEDIATOR},${OTHER_MEDIATOR}`;
  });

  afterEach(() => {
    delete process.env.ADMIN_STELLAR_PUBKEYS;
  });

  it("lets the assigned mediator request evidence and notifies the party", async () => {
    prisma.dispute.findFirst.mockResolvedValue(makeDispute());

    const result = await service.createEvidenceRequest("T-100", MEDIATOR, {
      party: "seller",
      message: "Please upload the shipping receipt",
      dueAt,
    });

    expect(result).toMatchObject({
      tradeId: "T-100",
      requestedBy: MEDIATOR,
      requestedFrom: "ga_seller",
      status: "OPEN",
      dueAt: dueAt.toISOString(),
    });
    expect(prisma._tx.inAppNotification.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        userAddress: "ga_seller",
        type: "DISPUTE_EVIDENCE_REQUEST",
        metadata: expect.objectContaining({ evidenceRequestId: 11 }),
      }),
    });
  });

  it("rejects a mediator who is not assigned to the dispute", async () => {
    prisma.dispute.findFirst.mockResolvedValue(makeDispute());

    await expect(
      service.createEvidenceRequest("T-100", OTHER_MEDIATOR, { party: "buyer", message: "x", dueAt }),
    ).rejects.toMatchObject({ code: ErrorCode.AUTH_ERROR, statusCode: 403 });
    expect(prisma._tx.disputeEvidenceRequest.create).not.toHaveBeenCalled();
  });

  it("rejects when no mediator has been assigned yet", async () => {
    prisma.dispute.findFirst.mockResolvedValue(makeDispute({ mediatorAddress: null, status: DisputeStatus.OPEN }));

    await expect(
      service.createEvidenceRequest("T-100", MEDIATOR, { party: "buyer", message: "x", dueAt }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("rejects non-mediators and parties", async () => {
    await expect(
      service.createEvidenceRequest("T-100", "GA_BUYER", { party: "seller", message: "x", dueAt }),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(prisma.dispute.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a due date in the past", async () => {
    prisma.dispute.findFirst.mockResolvedValue(makeDispute());

    await expect(
      service.createEvidenceRequest("T-100", MEDIATOR, {
        party: "buyer",
        message: "x",
        dueAt: new Date(Date.now() - 1000),
      }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_ERROR, statusCode: 400 });
  });

  it("returns 404 when the dispute does not exist", async () => {
    prisma.dispute.findFirst.mockResolvedValue(null);

    await expect(
      service.createEvidenceRequest("T-404", MEDIATOR, { party: "buyer", message: "x", dueAt }),
    ).rejects.toMatchObject({ code: ErrorCode.DISPUTE_NOT_FOUND });
  });

  it("includes open evidence requests in the dispute detail for a party", async () => {
    const request = {
      id: 11,
      tradeId: "T-100",
      requestedBy: MEDIATOR,
      requestedFrom: "ga_seller",
      message: "Receipt please",
      dueAt,
      status: EvidenceRequestStatus.OPEN,
      createdAt: new Date(),
    };
    prisma.dispute.findFirst.mockResolvedValue(makeDispute({ evidenceRequests: [request] }));

    const detail = await service.getDisputeDetail("T-100", "GA_SELLER");

    expect(prisma.dispute.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        include: expect.objectContaining({
          evidenceRequests: expect.objectContaining({ where: { status: EvidenceRequestStatus.OPEN } }),
        }),
      }),
    );
    expect(detail.mediatorAddress).toBe(MEDIATOR);
    expect(detail.openEvidenceRequests).toEqual([
      expect.objectContaining({ id: 11, requestedFrom: "ga_seller", dueAt: dueAt.toISOString() }),
    ]);
  });

  it("denies dispute detail to unrelated callers", async () => {
    prisma.dispute.findFirst.mockResolvedValue(makeDispute({ evidenceRequests: [] }));

    await expect(service.getDisputeDetail("T-100", "GA_STRANGER")).rejects.toMatchObject({ statusCode: 403 });
  });
});
