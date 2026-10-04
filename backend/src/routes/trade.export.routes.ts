import { Prisma, PrismaClient, TradeStatus } from "@prisma/client";
import { Response, Router } from "express";
import { z } from "zod";
import { Parser } from "json2csv";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { AuthRequest } from "../services/auth.service";
import { createWalletRateLimiter } from "../lib/rateLimit";
import { RATE_LIMIT_CONFIG } from "../config/rateLimit";

const tradeExportLimiter = createWalletRateLimiter(RATE_LIMIT_CONFIG.tradeExport);

const exportQuerySchema = z.object({
  format: z.enum(["csv", "json"]).default("json"),
  // status[] accepts multiple statuses; backward-compatible single value also works
  status: z
    .union([
      z.nativeEnum(TradeStatus),
      z.array(z.nativeEnum(TradeStatus)),
    ])
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      return Array.isArray(v) ? v : [v];
    }),
  // Accept both dateFrom/dateTo (legacy) and from/to (new) — from/to take precedence
  dateFrom: z.string().datetime().optional(),
  dateTo: z.string().datetime().optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(50),
}).transform((value) => ({
  ...value,
  // Resolve from/to vs dateFrom/dateTo — from/to take precedence
  resolvedFrom: value.from ?? value.dateFrom,
  resolvedTo: value.to ?? value.dateTo,
})).refine(
  (value) =>
    !value.resolvedFrom ||
    !value.resolvedTo ||
    new Date(value.resolvedFrom) <= new Date(value.resolvedTo),
  { message: "from must be before or equal to to", path: ["from"] },
);

const csvFields = [
  "tradeId",
  "buyerAddress",
  "sellerAddress",
  "amountUsdc",
  "status",
  "fundedAt",
  "deliveredAt",
  "completedAt",
  "createdAt",
  "updatedAt",
];

function caller(req: AuthRequest, res: Response): string | null {
  const walletAddress = req.user?.walletAddress?.trim();
  if (!walletAddress) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  return walletAddress;
}

function buildWhere(walletAddress: string, query: z.output<typeof exportQuerySchema>): Prisma.TradeWhereInput {
  const where: Prisma.TradeWhereInput = {
    OR: [{ buyerAddress: walletAddress }, { sellerAddress: walletAddress }],
  };

  if (query.status && query.status.length > 0) {
    where.status = query.status.length === 1
      ? query.status[0]
      : { in: query.status };
  }

  if (query.resolvedFrom || query.resolvedTo) {
    where.createdAt = {
      ...(query.resolvedFrom ? { gte: new Date(query.resolvedFrom) } : {}),
      ...(query.resolvedTo ? { lte: new Date(query.resolvedTo) } : {}),
    };
  }

  return where;
}

function serializeTrade(trade: Record<string, unknown>) {
  return {
    tradeId: trade.tradeId,
    buyerAddress: trade.buyerAddress,
    sellerAddress: trade.sellerAddress,
    amountUsdc: trade.amountUsdc,
    status: trade.status,
    fundedAt: trade.fundedAt,
    deliveredAt: trade.deliveredAt,
    completedAt: trade.completedAt,
    createdAt: trade.createdAt,
    updatedAt: trade.updatedAt,
  };
}

export function createTradeExportRouter(prisma: PrismaClient = defaultPrisma) {
  const router = Router();

  router.get(
    "/export",
    authMiddleware,
    tradeExportLimiter,
    validateRequest({ query: exportQuerySchema }),
    async (req: AuthRequest, res: Response, next) => {
      try {
        const walletAddress = caller(req, res);
        if (!walletAddress) return;

        const query = req.query as unknown as z.output<typeof exportQuerySchema>;
        const where = buildWhere(walletAddress, query);

        if (query.format === "csv") {
          const trades = await prisma.trade.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          });
          const rows = trades.map((trade: unknown) => serializeTrade(trade as any));
          const parser = new Parser({ fields: csvFields });
          const csv = parser.parse(rows);
          res.setHeader("Content-Type", "text/csv; charset=utf-8");
          res.setHeader("Content-Disposition", "attachment; filename=\"trades-export.csv\"");
          res.status(200).send(`\ufeff${csv}`);
          return;
        }

        const skip = (query.page - 1) * query.limit;
        const [trades, total] = await Promise.all([
          prisma.trade.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            skip,
            take: query.limit,
          }),
          prisma.trade.count({ where }),
        ]);

        res.status(200).json({
          items: trades.map((trade: unknown) => serializeTrade(trade as any)),
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        });
      } catch (error) {
        next(error);
      }
    },
  );

  return router;
}

export const tradeExportRoutes = createTradeExportRouter();
