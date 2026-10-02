import { Router, Request, Response } from "express";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

const CNGN_ASSET_CODE = process.env.CNGN_ASSET_CODE ?? "cNGN";
const CNGN_ISSUER = process.env.CNGN_ISSUER ?? process.env.CNGN_CONTRACT_ID ?? "";

interface Balance {
  assetType: string;
  assetCode: string;
  issuer: string | null;
  balance: string;
  limit: string | null;
}

interface TrustlineInfo {
  hasTrustline: boolean;
  /** The trust limit set by the account, or null when no trustline exists. */
  limit: string | null;
  /** Whether the issuer has authorised this trustline (false = frozen/un-authorised). */
  authorized: boolean;
}

function parseBalances(rawBalances: any[]): Balance[] {
  return rawBalances.map((b) => {
    if (b.asset_type === "native") {
      return {
        assetType: "native",
        assetCode: "XLM",
        issuer: null,
        balance: b.balance,
        limit: null,
      };
    }
    return {
      assetType: b.asset_type,
      assetCode: b.asset_code ?? "",
      issuer: b.asset_issuer ?? null,
      balance: b.balance,
      limit: b.limit ?? null,
    };
  });
}

/**
 * Derive cNGN trustline info from the raw Horizon balance array.
 *
 * Horizon encodes trustline authorisation in `is_authorized` (boolean).
 * When the account has no trustline for the configured asset the fields are
 * `hasTrustline: false, limit: null, authorized: false`.
 */
function parseCngnTrustline(rawBalances: any[]): TrustlineInfo {
  const entry = rawBalances.find(
    (b) =>
      b.asset_type !== "native" &&
      b.asset_code === CNGN_ASSET_CODE &&
      (CNGN_ISSUER === "" || b.asset_issuer === CNGN_ISSUER),
  );

  if (!entry) {
    return { hasTrustline: false, limit: null, authorized: false };
  }

  return {
    hasTrustline: true,
    limit: entry.limit ?? null,
    authorized: entry.is_authorized === true,
  };
}

export function createStellarAccountBalanceRouter(): Router {
  const router = Router();

  // GET /stellar/account/:address/balance
  router.get("/:address/balance", async (req: Request, res: Response) => {
    const address = req.params.address as string;

    if (!address || address.length !== 56 || !address.startsWith("G")) {
      res.status(400).json({ error: "Invalid Stellar account address" });
      return;
    }

    try {
      const account = await horizonServer.loadAccount(address);
      const balances = parseBalances(account.balances);
      const trustline = parseCngnTrustline(account.balances);

      res.json({ address, balances, trustline });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        // Account exists on the Stellar network but is not funded
        res.json({
          address,
          balances: [],
          trustline: { hasTrustline: false, limit: null, authorized: false },
        });
        return;
      }

      appLogger.error({ error, address }, "Failed to fetch account balances");
      res.status(502).json({ error: "Failed to fetch account data from Stellar network" });
    }
  });

  return router;
}

export const stellarAccountBalanceRoutes = createStellarAccountBalanceRouter();
