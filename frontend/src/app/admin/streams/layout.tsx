import type { Metadata } from "next";
import type { ReactNode } from "react";

/**
 * Per-route metadata for /admin/streams.
 * Overrides the admin section's default title template.
 */
export const metadata: Metadata = {
  title: "Stream Management",
  description: "Monitor and manage active payment streams on the innov8 platform.",
};

export default function AdminStreamsLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
