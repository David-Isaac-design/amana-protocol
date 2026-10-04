import { ErrorCode } from "./errorCodes";

export interface ErrorCatalogEntry {
  code: ErrorCode;
  status: number;
  message: string;
}

/**
 * Single source of truth for client-facing error metadata.
 *
 * Typed as Record<ErrorCode, ...> so adding a new ErrorCode without a catalog
 * entry fails to compile. Served by GET /v1/meta/errors and rendered into
 * docs/api/errors.md (see scripts/generate-error-catalog.ts).
 */
const CATALOG: Record<ErrorCode, Omit<ErrorCatalogEntry, "code">> = {
  [ErrorCode.VALIDATION_ERROR]: { status: 400, message: "Validation failed" },
  [ErrorCode.AUTH_ERROR]: { status: 401, message: "Authentication required" },
  [ErrorCode.DOMAIN_ERROR]: { status: 400, message: "Business rule violated" },
  [ErrorCode.INFRA_ERROR]: { status: 503, message: "A dependency is unavailable" },
  [ErrorCode.NOT_FOUND]: { status: 404, message: "Resource not found" },
  [ErrorCode.INTERNAL_ERROR]: { status: 500, message: "Internal server error" },
  [ErrorCode.TRADE_NOT_FOUND]: { status: 404, message: "Trade not found" },
  [ErrorCode.TRADE_ACCESS_DENIED]: { status: 403, message: "Access to this trade is denied" },
  [ErrorCode.TRADE_INVALID_STATUS]: { status: 400, message: "Trade is not in a valid status for this action" },
  [ErrorCode.TRADE_BUILD_FAILED]: { status: 500, message: "Failed to build trade transaction" },
  [ErrorCode.DISPUTE_INVALID_CATEGORY]: { status: 400, message: "Invalid dispute category" },
  [ErrorCode.DISPUTE_STATUS_TRANSITION_INVALID]: { status: 400, message: "Invalid dispute status transition" },
  [ErrorCode.DISPUTE_STATUS_CONFLICT]: { status: 409, message: "Dispute was modified concurrently" },
  [ErrorCode.DISPUTE_NOT_FOUND]: { status: 404, message: "Dispute not found" },
  [ErrorCode.PAYMENT_PROVIDER_ERROR]: { status: 502, message: "Payment provider returned an error" },
  [ErrorCode.PAYMENT_PROVIDER_TIMEOUT]: { status: 504, message: "Payment provider timed out" },
  [ErrorCode.PAYMENT_INSUFFICIENT_FUNDS]: { status: 400, message: "Insufficient funds for the requested route" },
  [ErrorCode.RATE_LIMIT_EXCEEDED]: { status: 429, message: "Too many requests" },
  [ErrorCode.ADMIN_QUOTA_EXCEEDED]: { status: 429, message: "Admin operation quota exceeded" },
  [ErrorCode.ADMIN_OPERATION_TIMEOUT]: { status: 504, message: "Admin operation timed out" },
  [ErrorCode.CLAWBACK_UNAUTHORIZED]: { status: 403, message: "Caller is not authorized to claw back" },
  [ErrorCode.CLAWBACK_INSUFFICIENT_VESTED]: { status: 400, message: "Insufficient unvested balance for clawback" },
  [ErrorCode.CLAWBACK_INVALID_AMOUNT]: { status: 400, message: "Invalid clawback amount" },
  [ErrorCode.CLAWBACK_STREAM_NOT_FOUND]: { status: 404, message: "Stream not found" },
  [ErrorCode.CLAWBACK_INVALID_STATUS]: { status: 400, message: "Stream is not in a valid status for clawback" },
  [ErrorCode.CLAWBACK_TOO_LARGE]: { status: 400, message: "Clawback amount exceeds the allowed limit" },
  [ErrorCode.SUBMISSION_VALIDATION_ERROR]: { status: 400, message: "Submission failed validation" },
  [ErrorCode.SUBMISSION_NETWORK_ERROR]: { status: 502, message: "Submission failed due to a network error" },
  [ErrorCode.SUBMISSION_CONTRACT_ERROR]: { status: 422, message: "Contract rejected the submission" },
  [ErrorCode.SUBMISSION_AUTHORIZATION_ERROR]: { status: 403, message: "Submission was not authorized" },
};

export function getErrorCatalog(): ErrorCatalogEntry[] {
  return (Object.values(ErrorCode) as ErrorCode[]).map((code) => ({ code, ...CATALOG[code] }));
}

export const ERROR_CATALOG_START = "<!-- error-catalog:start -->";
export const ERROR_CATALOG_END = "<!-- error-catalog:end -->";

/** Renders the markdown table embedded in docs/api/errors.md. */
export function renderErrorCatalogMarkdown(): string {
  const rows = getErrorCatalog().map((e) => `| \`${e.code}\` | ${e.status} | ${e.message} |`);
  return [
    ERROR_CATALOG_START,
    "| Code | HTTP status | Default message |",
    "|---|---|---|",
    ...rows,
    ERROR_CATALOG_END,
  ].join("\n");
}
