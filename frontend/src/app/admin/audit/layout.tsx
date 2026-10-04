import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Per-route metadata for /admin/audit.
 * Overrides the admin section's default title template.
 */
export const metadata: Metadata = {
  title: "Audit History",
  description: "View the complete history of admin actions on the innov8 platform.",
};

export default function AdminAuditLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
