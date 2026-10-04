import { AdminErrorView } from '../api/errors';

import { WEB_ORIGIN } from './links';

export const SUPPORT_EMAIL = 'support@amana.example';

/** Public Help & FAQ page (#129), served by the web app at /help. */
export const HELP_URL = `${WEB_ORIGIN}/help`;

/**
 * Compose a `mailto:` URL that surfaces the backend's `requestId` and
 * `code` plus the user's error message to support. Used by every admin
 * banner so the contact-support button always carries enough context
 * to correlate logs.
 */
export function buildSupportMailto(
  view: AdminErrorView | null,
  screenName: string,
): string {
  const id = view?.requestId ?? '';
  const subject = encodeURIComponent(`Admin ${screenName} error`);
  const body = encodeURIComponent(
    `Hello support,\n\nI hit an error on the admin ${screenName} screen.\nRequest id: ${id}\nError code: ${view?.code ?? 'unknown'}\nMessage: ${view?.message ?? ''}\n`,
  );
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
}
