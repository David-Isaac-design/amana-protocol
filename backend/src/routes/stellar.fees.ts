import { Router, Request, Response } from "express";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";
import { alertService } from "../services/alert.service";
import {
  computeBufferedFee,
  feeBufferOptionsFromEnv,
} from "../services/feeEstimator.service";
import { cacheGet, cacheSet } from "../lib/cache";

const FEES_CACHE_KEY = "stellar:fees";
const FEES_CACHE_TTL_SECONDS = 7; // 7 seconds — within the 5-10s window

interface FeesPayload {
  feeCharged: unknown;
  maxFee: unknown;
  ledger: number;
  lastLedgerBaseFee: number;
  ledgerCapacityUsage: number;
  recommended: {
    perOperationFee: number;
    transactionFee: number;
    operations: number;
    percentile: number;
    percentileFee: number;
    multiplier: number;
    congested: boolean;
    cappedAtMax: boolean;
    minStroops: number;
    maxStroops: number;
  };
}

export function createStellarFeesRouter(): Router {
  const router = Router();

  router.get("/", async (req: Request, res: Response) => {
    try {
      // Optional operation count so callers can size a multi-op transaction fee.
      const opsRaw = Number.parseInt(String(req.query.operations ?? "1"), 10);
      const operations = Number.isFinite(opsRaw) && opsRaw > 0 ? Math.min(opsRaw, 100) : 1;

      // Try cache first (per-operations-count key when operations != 1)
      const cacheKey = operations === 1 ? FEES_CACHE_KEY : `${FEES_CACHE_KEY}:ops:${operations}`;
      const cached = await cacheGet<FeesPayload>(cacheKey);
      if (cached) {
        res.json({ ...cached, cached: true });
        return;
      }

      // Cache miss — fetch live from Horizon
      const feeStats = await horizonServer.feeStats();

      const opts = feeBufferOptionsFromEnv();
      const estimate = computeBufferedFee(feeStats, opts);

      const recommendedTxFee = estimate.bufferedFee * operations;

      if (estimate.congested) {
        void alertService.dispatch(
          "stellar_fee_congestion",
          "Stellar network congestion detected in fee estimation",
          {
            percentile: estimate.percentile,
            percentileFee: estimate.percentileFee,
            baseFee: estimate.baseFee,
            ledgerCapacityUsage: estimate.ledgerCapacityUsage,
            bufferedFee: estimate.bufferedFee,
            lastLedger: feeStats.last_ledger,
          },
        );
      }

      const payload: FeesPayload = {
        // Raw Horizon fee stats — unchanged, kept for backward compatibility.
        feeCharged: feeStats.fee_charged,
        maxFee: feeStats.max_fee,
        ledger: parseInt(feeStats.last_ledger, 10),
        lastLedgerBaseFee: parseInt(feeStats.last_ledger_base_fee, 10),
        ledgerCapacityUsage: estimate.ledgerCapacityUsage,
        // Buffered recommendation (issue #184).
        recommended: {
          perOperationFee: estimate.bufferedFee,
          transactionFee: recommendedTxFee,
          operations,
          percentile: estimate.percentile,
          percentileFee: estimate.percentileFee,
          multiplier: estimate.multiplier,
          congested: estimate.congested,
          cappedAtMax: estimate.cappedAtMax,
          minStroops: opts.minStroops,
          maxStroops: opts.maxStroops,
        },
      };

      // Store in cache — failures are swallowed inside cacheSet (graceful degradation)
      await cacheSet(cacheKey, payload, FEES_CACHE_TTL_SECONDS);

      res.json({ ...payload, cached: false });
    } catch (error) {
      appLogger.error({ error }, "Failed to fetch Stellar fee stats");
      res.status(502).json({
        error: "Failed to fetch fee data from Stellar network",
      });
    }
  });

  return router;
}

export const stellarFeesRoutes = createStellarFeesRouter();
