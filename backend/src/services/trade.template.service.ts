import { PrismaClient, TradeStatus } from "@prisma/client";
import { prisma as defaultPrisma } from "../lib/db";
import { ContractService } from "./contract.service";
import { createTradeInputSchema, fieldErrors } from "../schemas/domain/trade";

export class TradeTemplateNotFoundError extends Error {
  status = 404;
  constructor() {
    super("Trade template not found");
    this.name = "TradeTemplateNotFoundError";
  }
}

export class TradeTemplateValidationError extends Error {
  status = 400;
  constructor(public readonly fields: Record<string, string>) {
    super("Trade template no longer satisfies current trade policy");
    this.name = "TradeTemplateValidationError";
  }
}

export type TradeTemplateInput = {
  name: string;
  sellerAddress: string;
  amountUsdc: string;
  buyerLossBps: number;
  sellerLossBps: number;
};

type TemplateDatabase = Pick<PrismaClient, "tradeTemplate" | "trade">;

export class TradeTemplateService {
  constructor(
    private readonly prisma: TemplateDatabase = defaultPrisma,
    private readonly contractService = new ContractService(),
  ) {}

  async save(userAddress: string, input: TradeTemplateInput) {
    const normalizedUser = userAddress.toLowerCase();
    return this.prisma.tradeTemplate.upsert({
      where: { userAddress_name: { userAddress: normalizedUser, name: input.name } },
      create: {
        userAddress: normalizedUser,
        name: input.name,
        sellerAddress: input.sellerAddress.toLowerCase(),
        amountUsdc: input.amountUsdc,
        buyerLossBps: input.buyerLossBps,
        sellerLossBps: input.sellerLossBps,
      },
      update: {
        sellerAddress: input.sellerAddress.toLowerCase(),
        amountUsdc: input.amountUsdc,
        buyerLossBps: input.buyerLossBps,
        sellerLossBps: input.sellerLossBps,
      },
    });
  }

  async list(userAddress: string) {
    return this.prisma.tradeTemplate.findMany({
      where: { userAddress: userAddress.toLowerCase() },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
  }

  async createTradeFromTemplate(templateId: number, userAddress: string) {
    const buyerAddress = userAddress.toLowerCase();
    const template = await this.prisma.tradeTemplate.findFirst({
      where: { id: templateId, userAddress: buyerAddress },
    });
    if (!template) throw new TradeTemplateNotFoundError();

    // Templates may predate current policy: re-run trade creation validation.
    // The stored seller address is lowercased; the canonical schema expects uppercase keys.
    const validation = createTradeInputSchema.safeParse({
      sellerAddress: template.sellerAddress.toUpperCase(),
      amountUsdc: template.amountUsdc,
      buyerLossBps: template.buyerLossBps,
      sellerLossBps: template.sellerLossBps,
    });
    if (!validation.success) {
      throw new TradeTemplateValidationError(fieldErrors(validation.error));
    }

    const { tradeId, unsignedXdr } = await this.contractService.buildCreateTradeTx({
      buyerAddress,
      sellerAddress: template.sellerAddress,
      amountUsdc: template.amountUsdc,
      buyerLossBps: template.buyerLossBps,
      sellerLossBps: template.sellerLossBps,
    });
    await this.prisma.trade.create({
      data: {
        tradeId,
        buyerAddress,
        sellerAddress: template.sellerAddress,
        amountUsdc: template.amountUsdc,
        buyerLossBps: template.buyerLossBps,
        sellerLossBps: template.sellerLossBps,
        status: TradeStatus.PENDING_SIGNATURE,
      },
    });

    return { tradeId, unsignedXdr, templateId: template.id };
  }
}
