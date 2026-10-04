import { Router, Request, Response } from "express";
import * as StellarSdk from "@stellar/stellar-sdk";
import { horizonServer } from "../config/stellar";
import { appLogger } from "../middleware/logger";

/**
 * Maps raw Horizon result codes to human-readable messages and suggested actions.
 * Raw codes are still returned in the response for debugging purposes.
 */
interface ResultCodeInfo {
  message: string;
  action: string;
}

const TRANSACTION_RESULT_CODE_MAP: Record<string, ResultCodeInfo> = {
  tx_success: {
    message: "Transaction was successful.",
    action: "No action required.",
  },
  tx_failed: {
    message: "One or more operations in the transaction failed.",
    action: "Inspect the operation result codes for details and retry with corrected parameters.",
  },
  tx_too_early: {
    message: "Transaction's time bounds specify a minTime that has not yet been reached.",
    action: "Wait until the minTime is reached before submitting.",
  },
  tx_too_late: {
    message: "Transaction's time bounds specify a maxTime that has already passed.",
    action: "Rebuild the transaction with updated time bounds and resubmit.",
  },
  tx_missing_operation: {
    message: "Transaction has no operations.",
    action: "Add at least one operation to the transaction before submitting.",
  },
  tx_bad_seq: {
    message: "Transaction sequence number is incorrect.",
    action: "Fetch the latest account sequence number and rebuild the transaction.",
  },
  tx_bad_auth: {
    message: "Transaction has too few valid signatures or the wrong signers.",
    action: "Ensure all required signers have signed the transaction.",
  },
  tx_insufficient_balance: {
    message: "Account does not have enough XLM to cover the fee and minimum balance.",
    action: "Fund the source account with more XLM.",
  },
  tx_no_source_account: {
    message: "Source account does not exist on the ledger.",
    action: "Create the source account before submitting transactions.",
  },
  tx_insufficient_fee: {
    message: "Fee is too low for the current network load.",
    action: "Increase the fee and resubmit. Use /stellar/fees for the current recommendation.",
  },
  tx_bad_auth_extra: {
    message: "Transaction includes unused signatures.",
    action: "Remove unnecessary signatures and resubmit.",
  },
  tx_internal_error: {
    message: "An internal Horizon error occurred.",
    action: "Retry the transaction. If the error persists, contact support.",
  },
};

const OPERATION_RESULT_CODE_MAP: Record<string, ResultCodeInfo> = {
  op_success: {
    message: "Operation was successful.",
    action: "No action required.",
  },
  op_bad_auth: {
    message: "Operation has insufficient signatures or wrong signers.",
    action: "Ensure the correct signers have signed for this operation.",
  },
  op_no_source_account: {
    message: "Source account for this operation does not exist.",
    action: "Create the source account before submitting.",
  },
  op_not_supported: {
    message: "Operation type is not supported.",
    action: "Use a supported Stellar operation type.",
  },
  op_too_many_subentries: {
    message: "Account has too many subentries (trustlines, offers, etc.).",
    action: "Remove unused trustlines or offers to reduce subentry count.",
  },
  op_exceeded_work_limit: {
    message: "Operation exceeded the Stellar network work limit.",
    action: "Simplify the transaction and retry.",
  },
  // Payment operation codes
  payment_underfunded: {
    message: "Source account does not have enough funds for this payment.",
    action: "Add more funds to the source account or reduce the payment amount.",
  },
  payment_src_no_trust: {
    message: "Source account does not have a trustline for the asset being sent.",
    action: "Create a trustline for the asset on the source account.",
  },
  payment_src_not_authorized: {
    message: "Source account is not authorized to send this asset.",
    action: "Contact the asset issuer for authorization.",
  },
  payment_no_destination: {
    message: "Destination account does not exist.",
    action: "Create the destination account before sending.",
  },
  payment_no_trust: {
    message: "Destination account does not have a trustline for this asset.",
    action: "Ask the recipient to create a trustline for the asset.",
  },
  payment_not_authorized: {
    message: "Destination account is not authorized to receive this asset.",
    action: "Contact the asset issuer to authorize the destination account.",
  },
  payment_line_full: {
    message: "Destination account's trustline balance would exceed the limit.",
    action: "Reduce the payment amount or ask the recipient to increase their trustline limit.",
  },
  payment_no_issuer: {
    message: "The asset issuer does not exist.",
    action: "Verify the asset issuer account exists on the network.",
  },
  // Underfunded (generic)
  op_underfunded: {
    message: "Source account does not have sufficient funds for this operation.",
    action: "Add more funds to the source account and retry.",
  },
  // Manage offer codes
  manage_offer_sell_no_trust: {
    message: "Account does not have a trustline for the asset being sold.",
    action: "Create a trustline for the sell asset.",
  },
  manage_offer_buy_no_trust: {
    message: "Account does not have a trustline for the asset being bought.",
    action: "Create a trustline for the buy asset.",
  },
  manage_offer_sell_not_authorized: {
    message: "Account is not authorized to sell this asset.",
    action: "Contact the asset issuer for authorization.",
  },
  manage_offer_buy_not_authorized: {
    message: "Account is not authorized to buy this asset.",
    action: "Contact the asset issuer for authorization.",
  },
  manage_offer_line_full: {
    message: "Buying would exceed the trustline limit.",
    action: "Increase the buy asset trustline limit.",
  },
  manage_offer_underfunded: {
    message: "Account does not have enough funds to create this offer.",
    action: "Add more funds and retry.",
  },
  manage_offer_cross_self: {
    message: "Offer would cross your own existing offer.",
    action: "Cancel the conflicting offer before placing this one.",
  },
  manage_offer_sell_no_issuer: {
    message: "Asset issuer for sell asset does not exist.",
    action: "Verify the sell asset issuer.",
  },
  manage_offer_buy_no_issuer: {
    message: "Asset issuer for buy asset does not exist.",
    action: "Verify the buy asset issuer.",
  },
  manage_offer_not_found: {
    message: "Offer to modify was not found.",
    action: "Verify the offer ID and try again.",
  },
  manage_offer_low_reserve: {
    message: "Account does not have enough XLM to cover the additional offer's reserve.",
    action: "Add more XLM to the source account.",
  },
};

/**
 * Look up a human-readable description for a raw result code.
 * Returns null if the code is unknown — callers fall back to the raw code.
 */
export function getResultCodeInfo(code: string): ResultCodeInfo | null {
  return (
    TRANSACTION_RESULT_CODE_MAP[code] ??
    OPERATION_RESULT_CODE_MAP[code] ??
    null
  );
}

function parseResultCodes(resultXdr: string): {
  transaction: string;
  operations: string[];
  transactionInfo: ResultCodeInfo | null;
  operationInfos: (ResultCodeInfo | null)[];
} {
  try {
    const xdr = Buffer.from(resultXdr, "base64");
    const result = StellarSdk.xdr.TransactionResult.fromXDR(xdr);
    const resultCode = result.result().switch();
    const transactionCode = (resultCode as any).name || "unknown";

    const opResults = result.result().results() || [];
    const operationCodes = opResults.map((op) => {
      const opResult = op.tr().switch();
      return (opResult as any).name || "unknown";
    });

    return {
      transaction: transactionCode,
      operations: operationCodes,
      transactionInfo: getResultCodeInfo(transactionCode),
      operationInfos: operationCodes.map(getResultCodeInfo),
    };
  } catch {
    return {
      transaction: "unknown",
      operations: [],
      transactionInfo: null,
      operationInfos: [],
    };
  }
}

export function createStellarTxStatusRouter(): Router {
  const router = Router();

  router.get("/:hash/status", async (req: Request, res: Response) => {
    const hash = req.params.hash as string;

    if (!hash || hash.length !== 64) {
      res.status(400).json({ error: "Invalid transaction hash" });
      return;
    }

    try {
      const txResponse = await horizonServer
        .transactions()
        .transaction(hash)
        .call();

      const resultCodes = parseResultCodes(txResponse.result_xdr);
      const status = txResponse.successful ? "success" : "failed";

      res.json({
        status,
        resultCodes,
        ledger: txResponse.ledger,
        hash: txResponse.id,
        createdAt: txResponse.created_at,
      });
    } catch (error: any) {
      if (error?.response?.status === 404) {
        res.status(404).json({
          status: "pending",
          hash,
          message: "Transaction not found on Stellar network (may still be pending)",
        });
        return;
      }

      appLogger.error({ error, hash }, "Failed to fetch transaction status");
      res.status(502).json({
        error: "Failed to fetch transaction status from Stellar network",
      });
    }
  });

  return router;
}

export const stellarTxStatusRoutes = createStellarTxStatusRouter();
