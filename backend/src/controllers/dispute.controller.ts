import { NextFunction, Response } from "express";
import { DisputeService, DisputeStatus } from "../services/dispute.service";
import { prisma as defaultPrisma } from "../lib/db";
import { authMiddleware, AuthRequest } from "../middleware/auth.middleware";
import { validateRequest } from "../middleware/validateRequest";
import { Router } from "express";
import { z } from "zod";
import { AppError } from "../errors/errorCodes";

const listDisputesQuerySchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "RESOLVED", "CLOSED"]).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

const disputeIdParamsSchema = z.object({
  id: z.string().trim().min(1).max(255),
});

const createEvidenceRequestSchema = z.object({
  party: z.enum(["buyer", "seller"]),
  message: z.string().trim().min(1).max(2000),
  dueAt: z.string().datetime({ offset: true }),
});

const transitionDisputeSchema = z.object({
  status: z.enum(["UNDER_REVIEW", "RESOLVED", "CLOSED"]),
});

export class DisputeController {
  constructor(private disputeService: DisputeService) {}

  public listMediatorDisputes = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const { status, page, limit } = req.query as any;

    try {
      const result = await this.disputeService.listMediatorDisputes(
        callerAddress,
        {
          status,
          page,
          limit,
        },
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      return next(error);
    }
  };

  public transitionDisputeStatus = async (
    req: AuthRequest,
    res: Response,
    next: NextFunction,
  ) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const tradeId = req.params.id as string;
    const { status } = req.body as { status: DisputeStatus };

    try {
      const result = await this.disputeService.transitionDisputeStatus(
        tradeId,
        callerAddress,
        status,
      );

      res.status(200).json(result);
    } catch (error) {
      if (error instanceof AppError) {
        return next(error);
      }
      return next(error);
    }
  };
}

export class DisputeEvidenceRequestController {
  constructor(private disputeService: DisputeService) {}

  public getDisputeDetail = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const result = await this.disputeService.getDisputeDetail(req.params.id as string, callerAddress);
      res.status(200).json(result);
    } catch (error) {
      return next(error);
    }
  };

  public createEvidenceRequest = async (req: AuthRequest, res: Response, next: NextFunction) => {
    const callerAddress = req.user?.walletAddress?.trim();
    if (!callerAddress) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    try {
      const body = req.body as z.infer<typeof createEvidenceRequestSchema>;
      const result = await this.disputeService.createEvidenceRequest(req.params.id as string, callerAddress, {
        party: body.party,
        message: body.message,
        dueAt: new Date(body.dueAt),
      });
      res.status(201).json(result);
    } catch (error) {
      return next(error);
    }
  };
}

export function createDisputeRouter(prisma = defaultPrisma) {
  const router = Router();
  const disputeService = new DisputeService(prisma);
  const disputeController = new DisputeController(disputeService);
  const evidenceRequestController = new DisputeEvidenceRequestController(disputeService);

  router.get(
    "/",
    authMiddleware,
    validateRequest({ query: listDisputesQuerySchema }),
    disputeController.listMediatorDisputes,
  );

  router.post(
    "/:id/transition",
    authMiddleware,
    validateRequest({ body: transitionDisputeSchema }),
    disputeController.transitionDisputeStatus,
  );

  router.get(
    "/:id",
    authMiddleware,
    validateRequest({ params: disputeIdParamsSchema }),
    evidenceRequestController.getDisputeDetail,
  );

  router.post(
    "/:id/evidence-requests",
    authMiddleware,
    validateRequest({ params: disputeIdParamsSchema, body: createEvidenceRequestSchema }),
    evidenceRequestController.createEvidenceRequest,
  );

  return router;
}
