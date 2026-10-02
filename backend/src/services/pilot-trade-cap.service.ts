import { AppError, ErrorCode } from "../errors/errorCodes";
import { formatStroopsToDecimal, parseDecimalToStroops } from "../lib/money";
import { appLogger } from "../middleware/logger";
import { FeatureFlagService, featureFlagService } from "./feature-flags.service";

/**
 * Per-trade amount cap for the pilot (#127).
 *
 * - `PILOT_MAX_TRADE_AMOUNT_USDC` (decimal USDC, e.g. "500") sets the cap. Unset
 *   or empty means no cap.
 * - The `pilot_trade_cap` feature flag is a kill switch: when the flag exists
 *   and is `enabled: false`, the cap is lifted without a redeploy. When the
 *   flag is missing, the env value alone decides.
 * - If the flag store (Redis) is unreachable, the cap stays enforced (fail closed).
 */
export const PILOT_TRADE_CAP_FLAG = "pilot_trade_cap";
export const PILOT_TRADE_CAP_ENV = "PILOT_MAX_TRADE_AMOUNT_USDC";

export class PilotTradeCapExceededError extends AppError {
  constructor(
    public readonly amountUsdc: string,
    public readonly maxAmountUsdc: string,
  ) {
    super(
      ErrorCode.TRADE_AMOUNT_EXCEEDS_PILOT_CAP,
      `Trade amount exceeds the pilot limit of ${maxAmountUsdc} USDC. Please enter ${maxAmountUsdc} USDC or less.`,
      400,
    );
    this.name = "PilotTradeCapExceededError";
  }
}

/** Parses the configured cap into stroops; returns null for "no cap". Throws on a misconfigured value. */
export function parsePilotCap(raw: string | undefined): bigint | null {
  const value = raw?.trim();
  if (!value) return null;
  const stroops = parseDecimalToStroops(value);
  if (stroops <= 0n) {
    throw new RangeError(`${PILOT_TRADE_CAP_ENV} must be a positive amount, got "${raw}"`);
  }
  return stroops;
}

/** Formats a stroop amount without trailing zeros, e.g. 5000000000n -> "500". */
function displayAmount(stroops: bigint): string {
  const decimal = formatStroopsToDecimal(stroops);
  return decimal.includes(".") ? decimal.replace(/\.?0+$/, "") : decimal;
}

export class PilotTradeCapService {
  constructor(
    private readonly flags: Pick<FeatureFlagService, "getFlag"> = featureFlagService,
    private readonly env: NodeJS.ProcessEnv = process.env,
  ) {}

  /** The cap in stroops currently in force, or null when there is none. */
  async getActiveCap(): Promise<bigint | null> {
    const cap = parsePilotCap(this.env[PILOT_TRADE_CAP_ENV]);
    if (cap === null) return null;

    try {
      const flag = await this.flags.getFlag(PILOT_TRADE_CAP_FLAG);
      if (flag && !flag.enabled) return null;
    } catch (error) {
      appLogger.warn({ error }, "Pilot trade cap flag lookup failed; enforcing cap");
    }
    return cap;
  }

  /** Throws PilotTradeCapExceededError when `amountUsdc` is above the active cap. The cap itself is allowed. */
  async assertWithinCap(amountUsdc: string): Promise<void> {
    const cap = await this.getActiveCap();
    if (cap === null) return;
    if (parseDecimalToStroops(amountUsdc) > cap) {
      throw new PilotTradeCapExceededError(amountUsdc, displayAmount(cap));
    }
  }
}

export const pilotTradeCapService = new PilotTradeCapService();
