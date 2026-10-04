import { TradeStatus } from "@prisma/client";
import {
  TradeTemplateNotFoundError,
  TradeTemplateValidationError,
  TradeTemplateService,
} from "../services/trade.template.service";

describe("TradeTemplateService", () => {
  const userAddress = "g-user";
  const template = {
    id: 7,
    userAddress,
    name: "Weekly maize sale",
    sellerAddress: `g${"a".repeat(55)}`,
    amountUsdc: "125.50",
    buyerLossBps: 5000,
    sellerLossBps: 5000,
  };
  const prisma = {
    tradeTemplate: { upsert: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    trade: { create: jest.fn() },
  };
  const contract = { buildCreateTradeTx: jest.fn() };
  const service = new TradeTemplateService(prisma as any, contract as any);

  beforeEach(() => jest.clearAllMocks());

  it("saves a user-scoped template", async () => {
    prisma.tradeTemplate.upsert.mockResolvedValue(template);
    await expect(service.save("G-USER", template)).resolves.toEqual(template);
    expect(prisma.tradeTemplate.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress_name: { userAddress, name: template.name } },
    }));
  });

  it("lists only the caller's templates", async () => {
    prisma.tradeTemplate.findMany.mockResolvedValue([template]);
    await expect(service.list("G-USER")).resolves.toEqual([template]);
    expect(prisma.tradeTemplate.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { userAddress },
    }));
  });

  it("creates a pending trade from a saved template", async () => {
    prisma.tradeTemplate.findFirst.mockResolvedValue(template);
    contract.buildCreateTradeTx.mockResolvedValue({ tradeId: "trade-1", unsignedXdr: "xdr" });
    prisma.trade.create.mockResolvedValue({});

    await expect(service.createTradeFromTemplate(7, "G-USER")).resolves.toEqual({
      tradeId: "trade-1", unsignedXdr: "xdr", templateId: 7,
    });
    expect(prisma.trade.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tradeId: "trade-1",
        buyerAddress: userAddress,
        status: TradeStatus.PENDING_SIGNATURE,
      }),
    });
  });

  it("does not expose another user's missing template", async () => {
    prisma.tradeTemplate.findFirst.mockResolvedValue(null);
    await expect(service.createTradeFromTemplate(404, userAddress)).rejects.toBeInstanceOf(
      TradeTemplateNotFoundError,
    );
  });

  it.each([
    ["invalid seller address", { sellerAddress: "g-stale" }, "sellerAddress"],
    ["invalid amount", { amountUsdc: "-5" }, "amountUsdc"],
    ["loss ratio not summing to 10000", { buyerLossBps: 7000 }, "buyerLossBps"],
  ])("rejects a stale template with %s", async (_n, override, field) => {
    prisma.tradeTemplate.findFirst.mockResolvedValue({ ...template, ...override });
    const error = await service.createTradeFromTemplate(7, "G-USER").catch((e) => e);
    expect(error).toBeInstanceOf(TradeTemplateValidationError);
    expect(error.fields).toHaveProperty(field);
    expect(contract.buildCreateTradeTx).not.toHaveBeenCalled();
    expect(prisma.trade.create).not.toHaveBeenCalled();
  });
});
