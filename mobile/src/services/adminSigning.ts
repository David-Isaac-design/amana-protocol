import { adminApi } from '../api/admin';

export type SigningFailure = 'rejected' | 'failed' | 'timeout';

export class SigningError extends Error {
  constructor(
    public readonly reason: SigningFailure,
    message: string,
  ) {
    super(message);
    this.name = 'SigningError';
  }
}

/** SEP-7 deep link that mobile Stellar wallets register for. */
export function buildSep7Uri(unsignedXdr: string): string {
  return `web+stellar:tx?xdr=${encodeURIComponent(unsignedXdr)}`;
}

/**
 * Submits a wallet-signed XDR and polls until it is confirmed. Rejects with a
 * SigningError on failure or when `timeoutMs` elapses. Signed XDR is never logged.
 */
export async function submitAndConfirm(
  signedXdr: string,
  opts: { pollIntervalMs?: number; timeoutMs?: number } = {},
): Promise<string> {
  const { pollIntervalMs = 2000, timeoutMs = 60000 } = opts;
  const deadline = Date.now() + timeoutMs;
  const { hash } = await adminApi.submitSignedXdr(signedXdr);

  while (Date.now() < deadline) {
    const { status } = await adminApi.getTxStatus(hash);
    if (status === 'success') return hash;
    if (status === 'failed') {
      throw new SigningError('failed', 'Transaction failed on the network');
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new SigningError('timeout', 'Timed out waiting for confirmation');
}
