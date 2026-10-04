const DEFAULT_MEDIATOR_ADDRESSES = ["GEXAMPLEMEDIATORPUBLICKEY1"];

/**
 * SLA threshold in hours. Disputes older than this are highlighted as
 * breaching the expected response time (72 h = 3 days).
 */
export const SLA_THRESHOLD_HOURS = 72;

/** Reads the mediator wallet allowlist from env, falling back to a dev default. */
export function getMediatorAddresses(
  envValue: string | undefined = process.env.NEXT_PUBLIC_MEDIATOR_WALLETS,
): string[] {
  const fromEnv = (envValue ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  return fromEnv.length > 0 ? fromEnv : DEFAULT_MEDIATOR_ADDRESSES;
}

export function isMediatorAddress(
  address: string | null | undefined,
  mediatorAddresses: string[],
): boolean {
  return Boolean(address && mediatorAddresses.includes(address));
}

/** Formats an ISO date string as "Mon D, YYYY" for dispute list rows. */
export function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Truncates a Stellar wallet address to "GABC...WXYZ"; short strings pass through untouched. */
export function formatAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Returns the age of a dispute in hours relative to a reference time.
 * The reference defaults to Date.now() but can be injected for testing.
 */
export function getDisputeAgeHours(
  createdAt: string,
  now: number = Date.now(),
): number {
  const created = new Date(createdAt).getTime();
  return (now - created) / (1000 * 60 * 60);
}

/**
 * Returns true if the dispute has exceeded the SLA threshold.
 * Uses an injectable `now` timestamp for deterministic tests.
 */
export function isBreachingSLA(
  createdAt: string,
  now: number = Date.now(),
): boolean {
  return getDisputeAgeHours(createdAt, now) > SLA_THRESHOLD_HOURS;
}

/**
 * Human-readable age string: "2h 15m", "3d 4h", etc.
 * Rounds down to the nearest unit.
 */
export function formatAge(createdAt: string, now: number = Date.now()): string {
  const totalMinutes = Math.floor((now - new Date(createdAt).getTime()) / 60_000);
  if (totalMinutes < 1) return "< 1m";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return remainingHours > 0 ? `${days}d ${remainingHours}h` : `${days}d`;
}

export type SortField = "age" | "amount";
export type SortDirection = "asc" | "desc";
