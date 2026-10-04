/**
 * Shared amount-formatting helper (issue #99).
 *
 * Mirrors the web app's `frontend/src/lib/formatAmount.ts` so that amounts
 * shown in the mobile UI are always consistent with what the web displays.
 *
 * Rules (matching the web output):
 *  - USDC / cNGN: 2 decimal places, thousands-separated (e.g. "1,234.56")
 *  - XLM / native Stellar assets: 7 decimal places maximum, trailing zeros stripped
 *  - Unknown assets: 2 decimal places as a safe fallback
 *
 * Usage:
 *   formatAmount("1234.5", "USDC")   → "1,234.50"
 *   formatAmount("0.1234567", "XLM") → "0.1234567"
 *   formatAmount(1000, "cNGN")       → "1,000.00"
 */

const FIAT_LIKE_ASSETS: ReadonlySet<string> = new Set(['USDC', 'CNGN', 'USDT', 'EURC']);
const STELLAR_ASSETS: ReadonlySet<string> = new Set(['XLM', 'NATIVE']);

/** Returns the number of decimal places to use for a given asset ticker. */
function decimalsFor(asset: string): number {
  const upper = asset.toUpperCase();
  if (FIAT_LIKE_ASSETS.has(upper)) return 2;
  if (STELLAR_ASSETS.has(upper)) return 7;
  return 2; // safe default
}

/**
 * Format an amount value with asset-appropriate decimals and thousands separators.
 *
 * @param value - numeric value or string representation (may include commas)
 * @param asset - asset ticker, e.g. "USDC", "XLM", "cNGN"
 * @returns formatted string, e.g. "1,234.50" or "0.1234567"
 */
export function formatAmount(value: string | number, asset: string): string {
  // Normalise: strip any existing commas so we can parse safely
  const raw = typeof value === 'string' ? value.replace(/,/g, '') : value;
  const num = typeof raw === 'string' ? parseFloat(raw) : raw;

  if (!Number.isFinite(num)) return String(value);

  const decimals = decimalsFor(asset);

  if (STELLAR_ASSETS.has(asset.toUpperCase())) {
    // Variable decimals: up to 7 dp, strip trailing zeros
    const fixed = num.toFixed(decimals);
    const trimmed = fixed.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
    // Add thousands separator to the integer part
    const [intPart, decPart] = trimmed.split('.');
    const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted;
  }

  // Fixed decimals with thousands separator
  const fixed = num.toFixed(decimals);
  const [intPart, decPart] = fixed.split('.');
  const intFormatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return decPart !== undefined ? `${intFormatted}.${decPart}` : intFormatted;
}
